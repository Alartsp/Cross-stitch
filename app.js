const imageInput = document.getElementById('imageInput');
const templateInput = document.getElementById('templateInput');
const pickImageBtn = document.getElementById('pickImageBtn');
const pickTemplateBtn = document.getElementById('pickTemplateBtn');
const photoStatus = document.getElementById('photoStatus');
const templateStatus = document.getElementById('templateStatus');
const detectSummary = document.getElementById('detectSummary');
const sourceCanvas = document.getElementById('sourceCanvas');
const templateCanvas = document.getElementById('templateCanvas');
const outputCanvas = document.getElementById('outputCanvas');
const sourceCtx = sourceCanvas.getContext('2d');
const templateCtx = templateCanvas.getContext('2d');
const outputCtx = outputCanvas.getContext('2d');
const detectBtn = document.getElementById('detectBtn');
const generateBtn = document.getElementById('generateBtn');
const downloadBtn = document.getElementById('downloadBtn');
const legendBtn = document.getElementById('legendBtn');
const legendEl = document.getElementById('legend');
const installBtn = document.getElementById('installBtn');

let photoImg = null, templateImg = null, detected = null, deferredPrompt = null, lastLegend = [], photoMaskInfo = null;
const SYMBOLS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789@#%&*+=?<>$';
const settingIds = ['darkThreshold','detectWidth','minArea','maxArea','fillScale','colorCount','bgThreshold','edgeIgnore','removeBg','keepAspect','autoCropPhoto','fullCrossOnly','showCenters','showMaskPreview','showLegend','objectThreshold','photoProcessWidth'];
loadSettings();
settingIds.forEach(id=>document.getElementById(id).addEventListener('change', saveSettings));

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', async ()=>{ try { await navigator.serviceWorker.register('./sw.js?v=3.4mask'); } catch(e){ console.error(e); } });
}
window.addEventListener('beforeinstallprompt', (e)=>{ e.preventDefault(); deferredPrompt=e; installBtn.classList.remove('hidden'); });
installBtn.addEventListener('click', async ()=>{ if(!deferredPrompt) return; deferredPrompt.prompt(); await deferredPrompt.userChoice; deferredPrompt=null; installBtn.classList.add('hidden'); });
pickImageBtn.addEventListener('click', ()=>{ imageInput.value=''; imageInput.click(); });
pickTemplateBtn.addEventListener('click', ()=>{ templateInput.value=''; templateInput.click(); });
imageInput.addEventListener('change', (e)=>loadImageFromFile(e.target.files?.[0], 'photo'));
templateInput.addEventListener('change', (e)=>loadImageFromFile(e.target.files?.[0], 'template'));
detectBtn.addEventListener('click', detectTemplate);
generateBtn.addEventListener('click', generateOverlay);
downloadBtn.addEventListener('click', ()=>downloadCanvas(outputCanvas, 'exact-template-object-mask-fix.png'));
legendBtn.addEventListener('click', downloadLegend);

function loadSettings(){ settingIds.forEach(id=>{ const el=document.getElementById(id); const v=localStorage.getItem('stitch_'+id); if(v!==null){ if(el.type==='checkbox') el.checked=v==='true'; else el.value=v; } }); }
function saveSettings(){ settingIds.forEach(id=>{ const el=document.getElementById(id); localStorage.setItem('stitch_'+id, el.type==='checkbox' ? String(el.checked) : String(el.value)); }); }
function num(id){ return parseFloat(document.getElementById(id).value || '0'); }
function clamp(v,min,max){ return Math.min(max, Math.max(min, v)); }
function rgbToHex([r,g,b]){ return '#' + [r,g,b].map(v=>v.toString(16).padStart(2,'0')).join('').toUpperCase(); }

function loadImageFromFile(file, kind){
  if(!file) return;
  const status = kind === 'photo' ? photoStatus : templateStatus;
  status.textContent = `Обрано: ${file.name}`;
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = ()=>{
    if(kind==='photo'){
      photoImg = img; photoMaskInfo = null; renderPhotoPreview(); photoStatus.textContent = `Фото завантажено: ${file.name} (${img.width}×${img.height})`; if(detected) generateBtn.disabled = false;
    } else {
      templateImg = img; fitCanvasPreview(templateCanvas, templateCtx, img); templateStatus.textContent = `Шаблон завантажено: ${file.name} (${img.width}×${img.height})`; detectBtn.disabled = false; detected = null; generateBtn.disabled = true; downloadBtn.disabled = true; detectSummary.textContent = 'Шаблон завантажено. Натисни “Розпізнати шаблон”.';
    }
    URL.revokeObjectURL(url);
  };
  img.onerror = ()=>{ status.textContent = 'Не вдалося завантажити файл'; URL.revokeObjectURL(url); };
  img.src = url;
}

function fitCanvasPreview(canvas, ctx, img){ const maxW = 900; const scale = Math.min(1, maxW / img.width); canvas.width = Math.max(1, Math.round(img.width * scale)); canvas.height = Math.max(1, Math.round(img.height * scale)); ctx.clearRect(0,0,canvas.width,canvas.height); ctx.drawImage(img,0,0,canvas.width,canvas.height); }

function median(arr){ const a = [...arr].sort((x,y)=>x-y); return a[Math.floor(a.length/2)] || 0; }

function buildPhotoMaskInfo(){
  if(!photoImg) return null;
  const targetW = clamp(num('photoProcessWidth'), 300, 1000);
  const scale = Math.min(1, targetW / photoImg.width);
  const w = Math.max(1, Math.round(photoImg.width * scale));
  const h = Math.max(1, Math.round(photoImg.height * scale));
  const objectThreshold = clamp(num('objectThreshold'), 20, 180);
  const bgThreshold = clamp(num('bgThreshold'), 200, 255);
  const c = document.createElement('canvas'); c.width=w; c.height=h; const ctx=c.getContext('2d', {willReadFrequently:true}); ctx.drawImage(photoImg,0,0,w,h);
  const data = ctx.getImageData(0,0,w,h).data;

  // Estimate background from border pixels (robust against non-white backgrounds)
  const borderR=[], borderG=[], borderB=[], borderScore=[];
  const border = Math.max(6, Math.round(Math.min(w,h)*0.06));
  function pushRGB(i){ borderR.push(data[i]); borderG.push(data[i+1]); borderB.push(data[i+2]); }
  for(let y=0;y<h;y++) for(let x=0;x<w;x++){
    if(x<border || y<border || x>=w-border || y>=h-border){ pushRGB((y*w+x)*4); }
  }
  const bg = [median(borderR), median(borderG), median(borderB)];
  const bgBright = (bg[0]+bg[1]+bg[2])/3;

  const score = new Float32Array(w*h);
  let maxScore = 0;
  for(let y=0;y<h;y++) for(let x=0;x<w;x++){
    const i = (y*w+x)*4; const r=data[i], g=data[i+1], b=data[i+2];
    const bright=(r+g+b)/3;
    const sat=Math.max(r,g,b)-Math.min(r,g,b);
    const dist=Math.sqrt((r-bg[0])**2 + (g-bg[1])**2 + (b-bg[2])**2);
    // strong if different from border bg OR saturated OR contrast to bg brightness
    const s = dist + sat*0.85 + Math.abs(bright-bgBright)*0.35 + (bright < bgThreshold ? 8 : 0);
    score[y*w+x] = s;
    if((x<border || y<border || x>=w-border || y>=h-border)) borderScore.push(s);
    if(s > maxScore) maxScore = s;
  }
  const dynThreshold = Math.max(objectThreshold, percentile(borderScore, 97) + 8);
  const mask = new Uint8Array(w*h);
  for(let i=0;i<score.length;i++) mask[i] = score[i] > dynThreshold ? 1 : 0;

  // Largest component only
  const visited = new Uint8Array(w*h); const dirs=[[1,0],[-1,0],[0,1],[0,-1]]; let best=null;
  for(let y=0;y<h;y++) for(let x=0;x<w;x++){
    const start=y*w+x; if(!mask[start] || visited[start]) continue;
    let qx=[x], qy=[y], head=0, area=0, minX=x,maxX=x,minY=y,maxY=y;
    visited[start]=1;
    while(head<qx.length){ const cx=qx[head], cy=qy[head]; head++; area++; if(cx<minX)minX=cx; if(cx>maxX)maxX=cx; if(cy<minY)minY=cy; if(cy>maxY)maxY=cy;
      for(const [dx,dy] of dirs){ const nx=cx+dx, ny=cy+dy; if(nx<0||ny<0||nx>=w||ny>=h) continue; const ni=ny*w+nx; if(mask[ni] && !visited[ni]){ visited[ni]=1; qx.push(nx); qy.push(ny); } }
    }
    if(!best || area > best.area) best = {area, minX, maxX, minY, maxY};
  }
  if(!best){
    return { procCanvas:c, mask, w, h, bbox:{x:0,y:0,w:w,h:h}, scaleBack:1/scale, bg, dynThreshold };
  }
  // Slight padding
  const padX = Math.max(3, Math.round((best.maxX-best.minX+1)*0.04));
  const padY = Math.max(3, Math.round((best.maxY-best.minY+1)*0.04));
  best.minX = Math.max(0, best.minX-padX); best.minY=Math.max(0,best.minY-padY); best.maxX=Math.min(w-1,best.maxX+padX); best.maxY=Math.min(h-1,best.maxY+padY);

  // Keep only pixels in component bbox + foreground score threshold; create preview mask canvas
  const maskCanvas = document.createElement('canvas'); maskCanvas.width=w; maskCanvas.height=h; const mctx=maskCanvas.getContext('2d');
  const maskImg = mctx.createImageData(w,h);
  for(let y=0;y<h;y++) for(let x=0;x<w;x++){
    const idx=y*w+x; const i=idx*4; const inBox = x>=best.minX && x<=best.maxX && y>=best.minY && y<=best.maxY && mask[idx];
    const v = inBox ? 255 : 0; maskImg.data[i]=v; maskImg.data[i+1]=v; maskImg.data[i+2]=v; maskImg.data[i+3]=255;
  }
  mctx.putImageData(maskImg,0,0);
  return { procCanvas:c, maskCanvas, w, h, mask, bbox:{x:best.minX,y:best.minY,w:best.maxX-best.minX+1,h:best.maxY-best.minY+1}, scaleBack:1/scale, bg, dynThreshold };
}

function renderPhotoPreview(){
  if(!photoImg){ sourceCanvas.width=10; sourceCanvas.height=10; return; }
  fitCanvasPreview(sourceCanvas, sourceCtx, photoImg);
  if(document.getElementById('showMaskPreview').checked){
    photoMaskInfo = buildPhotoMaskInfo();
    const scale = sourceCanvas.width / photoImg.width;
    const box = photoMaskInfo.bbox;
    sourceCtx.strokeStyle = 'rgba(34,197,94,.95)'; sourceCtx.lineWidth = 2;
    sourceCtx.strokeRect(box.x * photoMaskInfo.scaleBack * scale, box.y * photoMaskInfo.scaleBack * scale, box.w * photoMaskInfo.scaleBack * scale, box.h * photoMaskInfo.scaleBack * scale);
  }
}

function percentile(arr, p){ if(!arr.length) return 0; const a=[...arr].sort((x,y)=>x-y); const idx=Math.min(a.length-1, Math.max(0, Math.floor(a.length*p/100))); return a[idx]; }

function detectTemplate(){
  saveSettings(); if(!templateImg) return;
  const darkThreshold = clamp(num('darkThreshold'), 60, 240), detectWidth = clamp(num('detectWidth'), 500, 1400), minArea = clamp(num('minArea'), 5, 3000), maxArea = clamp(num('maxArea'), 50, 10000), edgeIgnore = clamp(num('edgeIgnore'), 0, 200), showCenters = document.getElementById('showCenters').checked;
  const scale = Math.min(1, detectWidth / templateImg.width), w = Math.max(1, Math.round(templateImg.width * scale)), h = Math.max(1, Math.round(templateImg.height * scale));
  const off = document.createElement('canvas'); off.width = w; off.height = h; const ctx = off.getContext('2d', {willReadFrequently:true}); ctx.drawImage(templateImg, 0, 0, w, h);
  const data = ctx.getImageData(0,0,w,h).data; const mask = new Uint8Array(w*h);
  for(let i=0;i<data.length;i+=4){ const bright=(data[i]+data[i+1]+data[i+2])/3; const idx=i/4; mask[idx] = (data[i+3]>0 && bright < darkThreshold) ? 1 : 0; }
  const visited = new Uint8Array(w*h), comps = [], dirs = [[1,0],[-1,0],[0,1],[0,-1]];
  for(let y=0;y<h;y++) for(let x=0;x<w;x++){
    const start = y*w+x; if(!mask[start] || visited[start]) continue;
    let qx=[x], qy=[y], head=0, minX=x,maxX=x,minY=y,maxY=y,area=0; visited[start]=1;
    while(head<qx.length){ const cx=qx[head], cy=qy[head]; head++; area++; if(cx<minX)minX=cx; if(cx>maxX)maxX=cx; if(cy<minY)minY=cy; if(cy>maxY)maxY=cy;
      for(const [dx,dy] of dirs){ const nx=cx+dx, ny=cy+dy; if(nx<0||ny<0||nx>=w||ny>=h) continue; const ni=ny*w+nx; if(mask[ni] && !visited[ni]){ visited[ni]=1; qx.push(nx); qy.push(ny); } }
    }
    const bw=maxX-minX+1, bh=maxY-minY+1, aspect=bw/bh; const nearEdge = minX<=edgeIgnore || minY<=edgeIgnore || maxX>=w-1-edgeIgnore || maxY>=h-1-edgeIgnore;
    if(area>=minArea && area<=maxArea && bw>=4 && bh>=4 && aspect>0.45 && aspect<2.2 && !nearEdge) comps.push({x:(minX+maxX)/2, y:(minY+maxY)/2, bw, bh, area});
  }
  if(!comps.length){ detected=null; detectSummary.textContent='Не вдалося знайти комірки. Спробуй підняти поріг темних контурів або збільшити max area.'; fitCanvasPreview(templateCanvas, templateCtx, templateImg); return; }
  const widths = comps.map(c=>c.bw).sort((a,b)=>a-b), heights = comps.map(c=>c.bh).sort((a,b)=>a-b), medW = widths[Math.floor(widths.length/2)], medH = heights[Math.floor(heights.length/2)];
  const filtered = comps.filter(c => c.bw > medW*0.55 && c.bw < medW*1.8 && c.bh > medH*0.55 && c.bh < medH*1.8);
  const rowThreshold = Math.max(4, medH*0.7); filtered.sort((a,b)=>a.y-b.y || a.x-b.x);
  const rows = [];
  for(const c of filtered){ let row = rows.find(r => Math.abs(r.y-c.y)<=rowThreshold); if(!row){ row={y:c.y,items:[]}; rows.push(row); } row.items.push(c); row.y = row.items.reduce((s,it)=>s+it.y,0)/row.items.length; }
  rows.sort((a,b)=>a.y-b.y); rows.forEach(r=>r.items.sort((a,b)=>a.x-b.x));
  const gridH = rows.length, gridW = rows.reduce((m,r)=>Math.max(m,r.items.length), 0), scaleBack = 1/scale;
  let bbMinX=Infinity, bbMinY=Infinity, bbMaxX=-Infinity, bbMaxY=-Infinity;
  for(const c of filtered){ const cx=c.x*scaleBack, cy=c.y*scaleBack, rx=(c.bw*scaleBack)/2, ry=(c.bh*scaleBack)/2; bbMinX=Math.min(bbMinX,cx-rx); bbMinY=Math.min(bbMinY,cy-ry); bbMaxX=Math.max(bbMaxX,cx+rx); bbMaxY=Math.max(bbMaxY,cy+ry); }
  detected = { scaleBack, comps:filtered, rows, gridW, gridH, medW, medH, bbox:{x:bbMinX,y:bbMinY,w:bbMaxX-bbMinX,h:bbMaxY-bbMinY} };
  renderTemplatePreview(showCenters);
  detectSummary.textContent = `Знайдено ${filtered.length} комірок | рядів: ${gridH} | макс. комірок у ряду: ${gridW}`;
  generateBtn.disabled = !photoImg;
}

function renderTemplatePreview(showCenters){ fitCanvasPreview(templateCanvas, templateCtx, templateImg); if(!detected) return; const scale = templateCanvas.width / templateImg.width; if(showCenters){ templateCtx.fillStyle='rgba(239,68,68,.85)'; for(const c of detected.comps){ templateCtx.beginPath(); templateCtx.arc(c.x*detected.scaleBack*scale,c.y*detected.scaleBack*scale,2.2,0,Math.PI*2); templateCtx.fill(); } } }

function generateOverlay(){
  saveSettings(); if(!photoImg || !templateImg || !detected) return;
  const colorCount = clamp(num('colorCount'),2,32), fillScale = clamp(num('fillScale'),30,100)/100;
  const removeBg = document.getElementById('removeBg').checked, keepAspect = document.getElementById('keepAspect').checked, autoCropPhoto = document.getElementById('autoCropPhoto').checked, showLegend = document.getElementById('showLegend').checked;
  const gridW = detected.gridW, gridH = detected.gridH;

  photoMaskInfo = buildPhotoMaskInfo();
  renderPhotoPreview();
  let srcBox = {x:0,y:0,w:photoMaskInfo.w,h:photoMaskInfo.h};
  if(autoCropPhoto) srcBox = photoMaskInfo.bbox;
  const contentRatio = srcBox.w / srcBox.h;

  let fitCols = gridW, fitRows = gridH;
  if(keepAspect){
    fitCols = Math.min(gridW, Math.max(1, Math.floor(Math.sqrt((gridW*gridH) * contentRatio))));
    fitRows = Math.max(1, Math.round(fitCols / contentRatio));
    if(fitRows > gridH){ fitRows = gridH; fitCols = Math.max(1, Math.round(fitRows * contentRatio)); }
    if(fitCols > gridW){ fitCols = gridW; fitRows = Math.max(1, Math.round(fitCols / contentRatio)); }
  }
  fitCols = Math.max(1, Math.min(gridW, fitCols));
  fitRows = Math.max(1, Math.min(gridH, fitRows));
  const startCol = Math.floor((gridW - fitCols) / 2);
  const startRow = Math.floor((gridH - fitRows) / 2);

  const sampleImgCanvas = document.createElement('canvas'); sampleImgCanvas.width = fitCols; sampleImgCanvas.height = fitRows; const sctx = sampleImgCanvas.getContext('2d', {willReadFrequently:true}); sctx.fillStyle='#ffffff'; sctx.fillRect(0,0,fitCols,fitRows); sctx.drawImage(photoMaskInfo.procCanvas, srcBox.x, srcBox.y, srcBox.w, srcBox.h, 0, 0, fitCols, fitRows);
  const sampleMaskCanvas = document.createElement('canvas'); sampleMaskCanvas.width = fitCols; sampleMaskCanvas.height = fitRows; const mctx = sampleMaskCanvas.getContext('2d', {willReadFrequently:true}); mctx.imageSmoothingEnabled = false; mctx.fillStyle='#000'; mctx.fillRect(0,0,fitCols,fitRows); mctx.drawImage(photoMaskInfo.maskCanvas, srcBox.x, srcBox.y, srcBox.w, srcBox.h, 0, 0, fitCols, fitRows);

  const imgData = sctx.getImageData(0,0,fitCols,fitRows).data; const maskData = mctx.getImageData(0,0,fitCols,fitRows).data;
  const samples=[]; const assignedGrid=[];
  for(let r=0;r<fitRows;r++) for(let c=0;c<fitCols;c++){
    const idx=(r*fitCols+c)*4; const maskV = maskData[idx];
    if(removeBg && maskV < 127){ assignedGrid.push(-1); continue; }
    const rgb=[imgData[idx], imgData[idx+1], imgData[idx+2]]; samples.push(rgb); assignedGrid.push(rgb);
  }
  const palette = buildPalette(samples, colorCount); const counts = new Array(palette.length).fill(0);
  for(let i=0;i<assignedGrid.length;i++){
    const rgb = assignedGrid[i]; if(rgb === -1){ continue; } const k = nearestColorIndex(rgb, palette); assignedGrid[i] = k; counts[k] += 1;
  }

  outputCanvas.width = templateImg.width; outputCanvas.height = templateImg.height; outputCtx.clearRect(0,0,outputCanvas.width,outputCanvas.height); outputCtx.drawImage(templateImg,0,0,outputCanvas.width,outputCanvas.height);
  for(let rowIdx=0; rowIdx<detected.rows.length; rowIdx++){
    const row = detected.rows[rowIdx];
    for(let colIdx=0; colIdx<row.items.length; colIdx++){
      if(rowIdx < startRow || rowIdx >= startRow + fitRows || colIdx < startCol || colIdx >= startCol + fitCols) continue;
      const localRow = rowIdx - startRow, localCol = colIdx - startCol; const assigned = assignedGrid[localRow * fitCols + localCol]; if(assigned === -1) continue;
      const comp = row.items[colIdx]; const [r,g,b] = palette[assigned]; const cx = comp.x * detected.scaleBack, cy = comp.y * detected.scaleBack, rx = (comp.bw * detected.scaleBack / 2) * fillScale, ry = (comp.bh * detected.scaleBack / 2) * fillScale;
      outputCtx.beginPath(); outputCtx.fillStyle = `rgb(${r},${g},${b})`; outputCtx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI*2); outputCtx.fill();
    }
  }

  const activePalette = palette.map((rgb,i)=>({rgb,count:counts[i],symbol:SYMBOLS[i % SYMBOLS.length]})).filter(x=>x.count>0).sort((a,b)=>b.count-a.count); activePalette.forEach((item, idx)=>item.symbol=SYMBOLS[idx % SYMBOLS.length]);
  detectSummary.textContent = `Шаблон: ${gridW}×${gridH} | Маска об'єкта: ${srcBox.w}×${srcBox.h} px (proc) | Вписано в ${fitCols}×${fitRows} цілих комірок`;
  renderLegend(activePalette, fitCols*fitRows, showLegend); downloadBtn.disabled = false; legendBtn.disabled = !showLegend;
}

function renderLegend(paletteWithCounts, totalCells, showLegend){ lastLegend = paletteWithCounts; legendEl.innerHTML=''; legendEl.style.display = showLegend ? 'grid' : 'none'; if(!showLegend) return; const tpl=document.getElementById('legendRowTemplate'); paletteWithCounts.forEach(item=>{ const node=tpl.content.cloneNode(true); node.querySelector('.legend-color').style.background=`rgb(${item.rgb[0]},${item.rgb[1]},${item.rgb[2]})`; const percent=((item.count/Math.max(1,totalCells))*100).toFixed(1); node.querySelector('.legend-text').textContent=`${item.symbol} — ${rgbToHex(item.rgb)} — ${item.count} комірок (${percent}%)`; legendEl.appendChild(node); }); }
function buildPalette(samples, k){ if(!samples.length) return [[255,255,255],[0,0,0]].slice(0,k); const picked=[]; const step=Math.max(1,Math.floor(samples.length/k)); for(let i=0;i<k;i++) picked.push(samples[Math.min(i*step,samples.length-1)].slice()); for(let iter=0; iter<10; iter++){ const buckets=Array.from({length:picked.length}, ()=>({sum:[0,0,0],count:0})); for(const s of samples){ const idx=nearestColorIndex(s,picked); buckets[idx].sum[0]+=s[0]; buckets[idx].sum[1]+=s[1]; buckets[idx].sum[2]+=s[2]; buckets[idx].count+=1; } for(let i=0;i<picked.length;i++) if(buckets[i].count) picked[i]=buckets[i].sum.map(v=>Math.round(v/buckets[i].count)); } const unique=[]; const seen=new Set(); for(const c of picked){ const key=c.join(','); if(!seen.has(key)){ seen.add(key); unique.push(c); } } return unique; }
function nearestColorIndex(rgb,palette){ let best=0,bestDist=Infinity; for(let i=0;i<palette.length;i++){ const p=palette[i]; const dr=rgb[0]-p[0], dg=rgb[1]-p[1], db=rgb[2]-p[2]; const dist=dr*dr+dg*dg+db*db; if(dist<bestDist){bestDist=dist; best=i;} } return best; }
function downloadCanvas(canvas, fileName){ canvas.toBlob(blob=>{ const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=fileName; a.click(); URL.revokeObjectURL(a.href); }, 'image/png'); }
function downloadLegend(){ const lines=['Легенда кольорів']; lastLegend.forEach(item=>lines.push(`${item.symbol}\t${rgbToHex(item.rgb)}\t${item.count} cells`)); const blob=new Blob([lines.join('\n')], {type:'text/plain;charset=utf-8'}); const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='exact-template-legend.txt'; a.click(); URL.revokeObjectURL(a.href); }
