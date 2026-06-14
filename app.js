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

const settingIds = ['gridWidth','gridHeight','colorCount','bgThreshold','cellSize','strokeWidth','ovalWidth','ovalHeight','pagePadding','fillScale','removeBg','keepAspect','showLegend'];
loadSettings();

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', async () => {
    try { await navigator.serviceWorker.register('./sw.js?v=2template'); } catch(e) { console.error(e); }
  });
}
window.addEventListener('beforeinstallprompt', (e)=>{ e.preventDefault(); deferredPrompt=e; installBtn.classList.remove('hidden'); });
installBtn.addEventListener('click', async ()=>{ if(!deferredPrompt) return; deferredPrompt.prompt(); await deferredPrompt.userChoice; deferredPrompt=null; installBtn.classList.add('hidden'); });
pickImageBtn.addEventListener('click', ()=>{ imageInput.value=''; imageInput.click(); });
imageInput.addEventListener('change', onFilePicked);
generateBtn.addEventListener('click', generatePattern);
downloadBtn.addEventListener('click', ()=> downloadCanvas(outputCanvas, 'oval-template-pattern.png'));
legendBtn.addEventListener('click', downloadLegend);
settingIds.forEach(id => { const el = document.getElementById(id); el.addEventListener('change', saveSettings); });

function loadSettings(){
  settingIds.forEach(id => {
    const el = document.getElementById(id);
    const saved = localStorage.getItem('stitch_' + id);
    if(saved !== null){
      if(el.type === 'checkbox') el.checked = saved === 'true';
      else el.value = saved;
    }
  });
}
function saveSettings(){
  settingIds.forEach(id => {
    const el = document.getElementById(id);
    localStorage.setItem('stitch_' + id, el.type === 'checkbox' ? String(el.checked) : String(el.value));
  });
}

async function onFilePicked(e){
  const file = e.target.files && e.target.files[0];
  if(!file){ fileStatus.textContent='Файл не обрано'; return; }
  fileStatus.textContent = `Обрано: ${file.name}`;
  try {
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();
    img.onload = ()=>{
      currentImage = img;
      fitCanvasPreview(sourceCanvas, sourceCtx, img);
      fileStatus.textContent = `Фото завантажено: ${file.name} (${img.width}×${img.height})`;
      generateBtn.disabled = false;
      URL.revokeObjectURL(objectUrl);
    };
    img.onerror = ()=>{ fileStatus.textContent = 'Не вдалося завантажити фото'; URL.revokeObjectURL(objectUrl); };
    img.src = objectUrl;
  } catch(err){
    console.error(err); fileStatus.textContent = 'Помилка завантаження';
  }
}

function fitCanvasPreview(canvas, ctx, img){
  const maxW = 900;
  const scale = Math.min(1, maxW / img.width);
  canvas.width = Math.max(1, Math.round(img.width * scale));
  canvas.height = Math.max(1, Math.round(img.height * scale));
  ctx.clearRect(0,0,canvas.width,canvas.height);
  ctx.drawImage(img,0,0,canvas.width,canvas.height);
}

function generatePattern(){
  if(!currentImage) return;
  saveSettings();
  const gridW = clamp(num('gridWidth'), 20, 180);
  const gridH = clamp(num('gridHeight'), 20, 220);
  const colorCount = clamp(num('colorCount'), 2, 32);
  const bgThreshold = clamp(num('bgThreshold'), 200, 255);
  const cellSize = clamp(num('cellSize'), 8, 28);
  const strokeWidth = clamp(num('strokeWidth'), 1, 4);
  const ovalWidth = clamp(num('ovalWidth'), 40, 95) / 100;
  const ovalHeight = clamp(num('ovalHeight'), 50, 115) / 100;
  const pagePadding = clamp(num('pagePadding'), 10, 80);
  const fillScale = clamp(num('fillScale'), 35, 100) / 100;
  const removeBg = document.getElementById('removeBg').checked;
  const keepAspect = document.getElementById('keepAspect').checked;
  const showLegend = document.getElementById('showLegend').checked;

  const sampleCanvas = document.createElement('canvas');
  sampleCanvas.width = gridW;
  sampleCanvas.height = gridH;
  const sctx = sampleCanvas.getContext('2d', {willReadFrequently:true});
  if(keepAspect){
    sctx.fillStyle = '#ffffff';
    sctx.fillRect(0,0,gridW,gridH);
    const scale = Math.min(gridW / currentImage.width, gridH / currentImage.height);
    const drawW = Math.round(currentImage.width * scale);
    const drawH = Math.round(currentImage.height * scale);
    const dx = Math.floor((gridW - drawW)/2);
    const dy = Math.floor((gridH - drawH)/2);
    sctx.drawImage(currentImage, dx, dy, drawW, drawH);
  } else {
    sctx.drawImage(currentImage, 0, 0, gridW, gridH);
  }

  const imageData = sctx.getImageData(0,0,gridW,gridH);
  const pixels = imageData.data;
  const samples = [];
  const alphaMap = new Array(gridW * gridH).fill(255);
  for(let i=0;i<pixels.length;i+=4){
    const r=pixels[i], g=pixels[i+1], b=pixels[i+2];
    const bright = (r+g+b)/3;
    const idx = i/4;
    if(removeBg && bright >= bgThreshold){ alphaMap[idx] = 0; continue; }
    samples.push([r,g,b]);
  }

  const palette = buildPalette(samples, colorCount);
  const assignments = new Array(gridW * gridH).fill(-1);
  const counts = new Array(palette.length).fill(0);
  for(let i=0;i<pixels.length;i+=4){
    const idx = i/4;
    if(alphaMap[idx] === 0) continue;
    const nearest = nearestColorIndex([pixels[i], pixels[i+1], pixels[i+2]], palette);
    assignments[idx] = nearest;
    counts[nearest] += 1;
  }

  const pitchX = cellSize;
  const pitchY = Math.round(cellSize * 0.85);
  const extraOffset = Math.round(pitchX / 2);
  const width = pagePadding * 2 + gridW * pitchX + extraOffset;
  const height = pagePadding * 2 + Math.max(0, gridH - 1) * pitchY + cellSize;
  outputCanvas.width = width;
  outputCanvas.height = height;
  outputCtx.clearRect(0,0,width,height);
  outputCtx.fillStyle = '#ffffff';
  outputCtx.fillRect(0,0,width,height);

  const outline = '#6b7280';
  const activePalette = palette.map((rgb, i) => ({ rgb, count: counts[i], symbol: SYMBOLS[i % SYMBOLS.length] })).filter(x=>x.count>0).sort((a,b)=>b.count-a.count);
  activePalette.forEach((item, idx) => item.symbol = SYMBOLS[idx % SYMBOLS.length]);

  for(let row=0; row<gridH; row++){
    const rowOffset = (row % 2) ? extraOffset : 0;
    for(let col=0; col<gridW; col++){
      const idx = row * gridW + col;
      const cx = pagePadding + rowOffset + col * pitchX + pitchX/2;
      const cy = pagePadding + row * pitchY + cellSize/2;
      const rx = (cellSize * ovalWidth) / 2;
      const ry = (cellSize * ovalHeight) / 2;

      // Outer contour like template image
      outputCtx.beginPath();
      outputCtx.lineWidth = strokeWidth;
      outputCtx.strokeStyle = outline;
      outputCtx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
      outputCtx.stroke();

      // Fill only if the sampled cell contains image information
      const assigned = assignments[idx];
      if(assigned !== -1){
        const [r,g,b] = palette[assigned];
        outputCtx.beginPath();
        outputCtx.fillStyle = `rgb(${r},${g},${b})`;
        outputCtx.ellipse(cx, cy, rx * fillScale, ry * fillScale, 0, 0, Math.PI * 2);
        outputCtx.fill();
      }
    }
  }

  renderLegend(activePalette, gridW * gridH, showLegend);
  downloadBtn.disabled = false;
  legendBtn.disabled = !showLegend;
}

function renderLegend(paletteWithCounts, totalCells, showLegend){
  lastLegend = paletteWithCounts;
  legendEl.innerHTML = '';
  legendEl.style.display = showLegend ? 'grid' : 'none';
  if(!showLegend) return;
  const template = document.getElementById('legendRowTemplate');
  paletteWithCounts.forEach(item => {
    const node = template.content.cloneNode(true);
    node.querySelector('.legend-color').style.background = `rgb(${item.rgb[0]},${item.rgb[1]},${item.rgb[2]})`;
    const percent = ((item.count / totalCells) * 100).toFixed(1);
    node.querySelector('.legend-text').textContent = `${item.symbol} — ${rgbToHex(item.rgb)} — ${item.count} комірок (${percent}%)`;
    legendEl.appendChild(node);
  });
}

function buildPalette(samples, k){
  if(!samples.length) return [[255,255,255],[0,0,0]].slice(0,k);
  const picked=[];
  const step=Math.max(1,Math.floor(samples.length/k));
  for(let i=0;i<k;i++) picked.push(samples[Math.min(i*step,samples.length-1)].slice());
  for(let iter=0; iter<10; iter++){
    const buckets=Array.from({length:picked.length},()=>({sum:[0,0,0],count:0}));
    for(const s of samples){ const idx=nearestColorIndex(s,picked); buckets[idx].sum[0]+=s[0]; buckets[idx].sum[1]+=s[1]; buckets[idx].sum[2]+=s[2]; buckets[idx].count+=1; }
    for(let i=0;i<picked.length;i++) if(buckets[i].count) picked[i]=buckets[i].sum.map(v=>Math.round(v/buckets[i].count));
  }
  const unique=[]; const seen=new Set();
  for(const c of picked){ const key=c.join(','); if(!seen.has(key)){ seen.add(key); unique.push(c);} }
  return unique;
}
function nearestColorIndex(rgb, palette){ let best=0, bestDist=Infinity; for(let i=0;i<palette.length;i++){ const p=palette[i]; const dr=rgb[0]-p[0], dg=rgb[1]-p[1], db=rgb[2]-p[2]; const dist=dr*dr+dg*dg+db*db; if(dist<bestDist){ bestDist=dist; best=i; }} return best; }
function rgbToHex([r,g,b]){ return '#' + [r,g,b].map(v=>v.toString(16).padStart(2,'0')).join('').toUpperCase(); }
function clamp(v,min,max){ return Math.min(max, Math.max(min, v)); }
function num(id){ return parseFloat(document.getElementById(id).value || '0'); }
function downloadCanvas(canvas, filename){ canvas.toBlob(blob => { const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=filename; a.click(); URL.revokeObjectURL(a.href); }, 'image/png'); }
function downloadLegend(){ const lines=['Легенда кольорів']; lastLegend.forEach(item => lines.push(`${item.symbol}\t${rgbToHex(item.rgb)}\t${item.count} cells`)); const blob=new Blob([lines.join('\n')], {type:'text/plain;charset=utf-8'}); const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='oval-template-legend.txt'; a.click(); URL.revokeObjectURL(a.href); }
