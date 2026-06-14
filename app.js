const imageInput = document.getElementById('imageInput');
const pickImageBtn = document.getElementById('pickImageBtn');
const fileStatus = document.getElementById('fileStatus');
const sourceCanvas = document.getElementById('sourceCanvas');
const outputCanvas = document.getElementById('outputCanvas');
const sourceCtx = sourceCanvas.getContext('2d');
const outputCtx = outputCanvas.getContext('2d');
const generateBtn = document.getElementById('generateBtn');
const downloadBtn = document.getElementById('downloadBtn');
const legendBtn = document.getElementById('legendBtn');
const legendEl = document.getElementById('legend');
const installBtn = document.getElementById('installBtn');

let currentImage = null;
let deferredPrompt = null;
let lastLegend = [];
const SYMBOLS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789@#%&*+=?<>$';

console.log('Cross Stitch PWA v1.2 init');

if (!imageInput || !pickImageBtn || !fileStatus) {
  console.error('Не знайдено imageInput / pickImageBtn / fileStatus');
}

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', async () => {
    try {
      await navigator.serviceWorker.register('./sw.js?v=1.2');
      console.log('SW registered');
    } catch (e) {
      console.error('SW register error', e);
    }
  });
}

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  if (installBtn) installBtn.classList.remove('hidden');
});

if (installBtn) {
  installBtn.addEventListener('click', async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
    installBtn.classList.add('hidden');
  });
}

pickImageBtn.addEventListener('click', () => {
  imageInput.value = '';
  imageInput.click();
});

imageInput.addEventListener('change', (e) => {
  const file = e.target.files && e.target.files[0];
  console.log('imageInput change', file);

  if (!file) {
    fileStatus.textContent = 'Файл не обрано';
    return;
  }

  fileStatus.textContent = `Обрано: ${file.name}`;

  if (!file.type.startsWith('image/')) {
    fileStatus.textContent = 'Це не файл зображення';
    alert('Оберіть JPG, PNG, WebP або BMP');
    return;
  }

  try {
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();

    img.onload = () => {
      currentImage = img;
      fitCanvasPreview(sourceCanvas, sourceCtx, img);
      fileStatus.textContent = `Фото завантажено: ${file.name} (${img.width}×${img.height})`;
      generateBtn.disabled = false;
      URL.revokeObjectURL(objectUrl);
    };

    img.onerror = () => {
      fileStatus.textContent = 'Не вдалося завантажити фото';
      alert('Не вдалося прочитати фото. Спробуй JPG або PNG.');
      URL.revokeObjectURL(objectUrl);
    };

    img.src = objectUrl;
  } catch (err) {
    console.error(err);
    fileStatus.textContent = 'Помилка завантаження';
    alert('Помилка завантаження фото');
  }
});

generateBtn.addEventListener('click', () => {
  if (!currentImage) {
    alert('Спочатку обери зображення.');
    return;
  }
  generatePattern();
});

downloadBtn.addEventListener('click', () => downloadCanvas(outputCanvas, 'cross-stitch-pattern.png'));
legendBtn.addEventListener('click', () => downloadLegend());

function fitCanvasPreview(canvas, ctx, img) {
  const maxW = 800;
  const scale = Math.min(1, maxW / img.width);
  canvas.width = Math.max(1, Math.round(img.width * scale));
  canvas.height = Math.max(1, Math.round(img.height * scale));
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
}

function generatePattern() {
  const gridW = clamp(parseInt(document.getElementById('gridWidth').value || '70', 10), 20, 300);
  const gridH = clamp(parseInt(document.getElementById('gridHeight').value || '120', 10), 20, 400);
  const colorCount = clamp(parseInt(document.getElementById('colorCount').value || '10', 10), 2, 32);
  const cellSize = clamp(parseInt(document.getElementById('cellSize').value || '10', 10), 6, 30);
  const bgThreshold = clamp(parseInt(document.getElementById('bgThreshold').value || '245', 10), 200, 255);
  const renderMode = document.getElementById('renderMode').value;
  const removeBg = document.getElementById('removeBg').checked;
  const showGrid = document.getElementById('showGrid').checked;
  const keepAspect = document.getElementById('keepAspect').checked;

  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = gridW;
  tempCanvas.height = gridH;
  const tempCtx = tempCanvas.getContext('2d', { willReadFrequently: true });

  if (keepAspect) {
    tempCtx.fillStyle = 'rgb(255,255,255)';
    tempCtx.fillRect(0, 0, gridW, gridH);
    const scale = Math.min(gridW / currentImage.width, gridH / currentImage.height);
    const drawW = Math.round(currentImage.width * scale);
    const drawH = Math.round(currentImage.height * scale);
    const dx = Math.floor((gridW - drawW) / 2);
    const dy = Math.floor((gridH - drawH) / 2);
    tempCtx.drawImage(currentImage, dx, dy, drawW, drawH);
  } else {
    tempCtx.drawImage(currentImage, 0, 0, gridW, gridH);
  }

  const imageData = tempCtx.getImageData(0, 0, gridW, gridH);
  const pixels = imageData.data;
  const samples = [];
  const alphaMap = new Array(gridW * gridH).fill(255);

  for (let i = 0; i < pixels.length; i += 4) {
    const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2];
    const bright = (r + g + b) / 3;
    const idx = i / 4;
    if (removeBg && bright >= bgThreshold) {
      alphaMap[idx] = 0;
      continue;
    }
    samples.push([r, g, b]);
  }

  const palette = buildPalette(samples, colorCount);
  const assignments = new Array(gridW * gridH).fill(-1);
  const counts = new Array(palette.length).fill(0);

  for (let i = 0; i < pixels.length; i += 4) {
    const idx = i / 4;
    if (alphaMap[idx] === 0) continue;
    const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2];
    const nearest = nearestColorIndex([r, g, b], palette);
    assignments[idx] = nearest;
    counts[nearest] += 1;
  }

  outputCanvas.width = gridW * cellSize;
  outputCanvas.height = gridH * cellSize;
  outputCtx.clearRect(0, 0, outputCanvas.width, outputCanvas.height);
  outputCtx.fillStyle = '#ffffff';
  outputCtx.fillRect(0, 0, outputCanvas.width, outputCanvas.height);

  const activePalette = palette
    .map((rgb, i) => ({ rgb, count: counts[i], symbol: SYMBOLS[i % SYMBOLS.length] }))
    .filter(x => x.count > 0)
    .sort((a, b) => b.count - a.count);

  const symbolByOriginalIndex = new Map();
  activePalette.forEach((item, idx) => item.symbol = SYMBOLS[idx % SYMBOLS.length]);
  palette.forEach((rgb, originalIndex) => {
    const found = activePalette.find(x => x.rgb === rgb || (x.rgb[0] === rgb[0] && x.rgb[1] === rgb[1] && x.rgb[2] === rgb[2]));
    if (found) symbolByOriginalIndex.set(originalIndex, found.symbol);
  });

  for (let y = 0; y < gridH; y++) {
    for (let x = 0; x < gridW; x++) {
      const idx = y * gridW + x;
      const aIdx = assignments[idx];
      if (aIdx === -1) continue;
      const [r, g, b] = palette[aIdx];
      const px = x * cellSize;
      const py = y * cellSize;

      if (renderMode === 'symbols') {
        outputCtx.fillStyle = '#ffffff';
        outputCtx.fillRect(px, py, cellSize, cellSize);
        outputCtx.fillStyle = '#111827';
        outputCtx.font = `${Math.max(8, Math.floor(cellSize * 0.72))}px sans-serif`;
        outputCtx.textAlign = 'center';
        outputCtx.textBaseline = 'middle';
        outputCtx.fillText(symbolByOriginalIndex.get(aIdx) || '?', px + cellSize / 2, py + cellSize / 2 + 1);
      } else if (renderMode === 'template') {
        outputCtx.fillStyle = '#ffffff';
        outputCtx.fillRect(px, py, cellSize, cellSize);
        outputCtx.beginPath();
        outputCtx.fillStyle = `rgb(${r},${g},${b})`;
        outputCtx.strokeStyle = 'rgba(17,24,39,.45)';
        outputCtx.lineWidth = Math.max(1, cellSize * 0.08);
        outputCtx.ellipse(px + cellSize / 2, py + cellSize / 2, cellSize * 0.36, cellSize * 0.42, Math.PI / 8, 0, Math.PI * 2);
        outputCtx.fill();
        outputCtx.stroke();
      } else {
        outputCtx.fillStyle = `rgb(${r},${g},${b})`;
        outputCtx.fillRect(px, py, cellSize, cellSize);
      }

      if (showGrid) {
        outputCtx.strokeStyle = 'rgba(31,41,55,0.22)';
        outputCtx.lineWidth = 1;
        outputCtx.strokeRect(px, py, cellSize, cellSize);
      }
    }
  }

  renderLegend(activePalette, gridW * gridH);
  downloadBtn.disabled = false;
  legendBtn.disabled = false;
}

function buildPalette(samples, k) {
  if (!samples.length) return [[255,255,255], [0,0,0]].slice(0, k);
  const picked = [];
  const step = Math.max(1, Math.floor(samples.length / k));
  for (let i = 0; i < k; i++) picked.push(samples[Math.min(i * step, samples.length - 1)].slice());

  for (let iter = 0; iter < 8; iter++) {
    const buckets = Array.from({ length: picked.length }, () => ({ sum: [0,0,0], count: 0 }));
    for (const s of samples) {
      const idx = nearestColorIndex(s, picked);
      buckets[idx].sum[0] += s[0];
      buckets[idx].sum[1] += s[1];
      buckets[idx].sum[2] += s[2];
      buckets[idx].count += 1;
    }
    for (let i = 0; i < picked.length; i++) {
      if (!buckets[i].count) continue;
      picked[i] = buckets[i].sum.map(v => Math.round(v / buckets[i].count));
    }
  }

  const unique = [];
  const seen = new Set();
  for (const c of picked) {
    const key = c.join(',');
    if (!seen.has(key)) {
      unique.push(c);
      seen.add(key);
    }
  }
  return unique;
}

function nearestColorIndex(rgb, palette) {
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < palette.length; i++) {
    const p = palette[i];
    const dr = rgb[0] - p[0];
    const dg = rgb[1] - p[1];
    const db = rgb[2] - p[2];
    const dist = dr * dr + dg * dg + db * db;
    if (dist < bestDist) {
      bestDist = dist;
      best = i;
    }
  }
  return best;
}

function renderLegend(paletteWithCounts, totalCells) {
  lastLegend = paletteWithCounts;
  legendEl.innerHTML = '';
  const template = document.getElementById('legendRowTemplate');
  paletteWithCounts.forEach((item) => {
    const node = template.content.cloneNode(true);
    node.querySelector('.legend-color').style.background = `rgb(${item.rgb[0]},${item.rgb[1]},${item.rgb[2]})`;
    const percent = ((item.count / totalCells) * 100).toFixed(1);
    node.querySelector('.legend-text').textContent = `${item.symbol} — ${rgbToHex(item.rgb)} — ${item.count} стібків (${percent}%)`;
    legendEl.appendChild(node);
  });
}

function downloadCanvas(canvas, filename) {
  canvas.toBlob((blob) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
  }, 'image/png');
}

function downloadLegend() {
  const lines = ['Легенда кольорів'];
  lastLegend.forEach(item => lines.push(`${item.symbol}	${rgbToHex(item.rgb)}	${item.count} stitches`));
  const blob = new Blob([lines.join('
')], { type: 'text/plain;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'cross-stitch-legend.txt';
  a.click();
  URL.revokeObjectURL(a.href);
}

function rgbToHex([r, g, b]) {
  return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('').toUpperCase();
}

function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}
