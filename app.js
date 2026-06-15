const imageInput = document.getElementById('imageInput');
const templateInput = document.getElementById('templateInput');
const pickImageBtn = document.getElementById('pickImageBtn');
const pickTemplateBtn = document.getElementById('pickTemplateBtn');
const photoStatus = document.getElementById('photoStatus');
const templateStatus = document.getElementById('templateStatus');
const summary = document.getElementById('summary');
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

let photoImg = null, templateImg = null, detected = null, lastLegend = [], deferredPrompt = null, photoMask = null;
const SYMBOLS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789@#%&*+=?<>$';
const settingIds = ['darkThreshold','detectWidth','minArea','maxArea','edgeIgnore','subjectScale','offsetX','offsetY','colorCount','fillScale','bgMode','objectThreshold','bgThreshold','keepAspect','cropToSubject','fullCrossOnly','showCenters','showPreviewMask','showLegend'];
loadSettings();
settingIds.forEach(id=>document.getElementById(id).addEventListener('change', ()=>{ saveSettings(); if(photoImg) renderPhotoPreview(); }));

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', async ()=>{ try { await navigator.serviceWorker.register('./sw.js?v=4manual'); } catch(e){ console.error(e); } });
}
window.addEventListener('beforeinstallprompt', e=>{ e.preventDefault(); deferredPrompt=e; installBtn.classList.remove('hidden'); });
installBtn.addEventListener('click', async ()=>{ if(!deferredPrompt) return; deferredPrompt.prompt(); await deferredPrompt.userChoice; deferredPrompt=null; installBtn.classList.add('hidden'); });

pickImageBtn.addEventListener('click', ()=>{ imageInput.value=''; imageInput.click(); });
pickTemplateBtn.addEventListener('click', ()=>{ templateInput.value=''; templateInput.click(); });
imageInput.addEventListener('change', e=>loadImageFromFile(e.target.files?.[0], 'photo'));
templateInput.addEventListener('change', e=>loadImageFromFile(e.target.files?.[0], 'template'));
detectBtn.addEventListener('click', detectTemplate);
generateBtn.addEventListener('click', generateOverlay);
downloadBtn.addEventListener('click', ()=>downloadCanvas(outputCanvas, 'cross-stitch-manual-fit.png'));
legendBtn.addEventListener('click', downloadLegend);

function loadSettings(){ settingIds.forEach(id=>{ const el=document.getElementById(id); const v=localStorage.getItem('stitch_'+id); if(v!==null){ if(el.type==='checkbox') el.checked = v==='true'; else el.value = v; } }); }
function saveSettings(){ settingIds.forEach(id=>{ const el=document.getElementById(id); localStorage.setItem('stitch_'+id, el.type==='checkbox' ? String(el.checked) : String(el.value)); }); }
function num(id){ return parseFloat(document.getElementById(id).value || '0'); }
function clamp(v,min,max){ return Math.min(max, Math.max(min, v)); }
function fitCanvasPreview(canvas, ctx, img){ const maxW=900; const scale=Math.min(1, maxW/img.width); canvas.width=Math.max(1,Math.round(img.width*scale)); canvas.height=Math.max(1,Math.round(img.height*scale)); ctx.clearRect(0,0,canvas.width,canvas.height); ctx.drawImage(img,0,0,canvas.width,canvas.height); }
function rgbToHex([r,g,b]){ return '#' + [r,g,b].map(v=>v.toString(16).padStart(2,'0')).join('').toUpperCase(); }

function loadImageFromFile(file, kind){ if(!file) return; const status = kind==='photo' ? photoStatus : templateStatus; status.textContent=`Обрано: ${file.name}`; const url = URL.createObjectURL(file); const img = new Image(); img.onload = ()=>{ if(kind==='photo'){ photoImg=img; photoMask=null; renderPhotoPreview(); photoStatus.textContent=`Фото завантажено: ${file.name} (${img.width}×${img.height})`; if(detected) generateBtn.disabled=false; } else { templateImg=img; fitCanvasPreview(templateCanvas, templateCtx, img); templateStatus.textContent=`Шаблон завантажено: ${file.name} (${img.width}×${img.height})`; detectBtn.disabled=false; detected=null; generateBtn.disabled=true; downloadBtn.disabled=true; summary.textContent='Готово. Тепер натисни «Розпізнати шаблон»'; } URL.revokeObjectURL(url); }; img.onerror = ()=>{ status.textContent='Не вдалося завантажити файл'; URL.revokeObjectURL(url); }; img.src=url; }

function percentile(arr,p){ if(!arr.length) return 0; const a=[...arr].sort((x,y)=>x-y); const idx=Math.min(a.length-1,Math.max(0,Math.floor(a.length*p/100))); return a[idx]; }
function median(arr){ const a=[...arr].sort((x,y)=>x-y); return a[Math.floor(a.length/2)] || 0; }

function computePhotoMask(){
  if(!photoImg) return null;
  if(photoMask) return photoMask;
  const targetW = 600;
  const scale = Math.min(1, targetW / photoImg.width);
  const w = Math.max(1, Math.round(photoImg.width * scale));
  const h = Math.max(1, Math.round(photoImg.height * scale));
  const c=document.createElement('canvas'); c.width=w; c.height=h; const ctx=c.getContext('2d', {willReadFrequently:true}); ctx.drawImage(photoImg,0,0,w,h);
  const data=ctx.getImageData(0,0,w,h).data;
  const bgMode=document.getElementById('bgMode').value;
  const objectThreshold=clamp(num('objectThreshold'), 10, 200);
  const bgThreshold=clamp(num('bgThreshold'), 200, 255);

  let mask = new Uint8Array(w*h);
  let bbox = {x:0,y:0,w:w,h:h};

  if(bgMode === 'none'){
    mask.fill(1);
  } else if(bgMode === 'bright'){
    let minX=w, minY=h, maxX=-1, maxY=-1;
    for(let y=0;y<h;y++) for(let x=0;x<w;x++){
      const i=(y*w+x)*4; const bright=(data[i]+data[i+1]+data[i+2])/3; if(bright < bgThreshold){ mask[y*w+x]=1; if(x<minX)minX=x; if(y<minY)minY=y; if(x>maxX)maxX=x; if(y>maxY)maxY=y; }
    }
    if(maxX>=0) bbox={x:minX,y:minY,w:maxX-minX+1,h:maxY-minY+1};
  } else {
    // corners mode
    const border = Math.max(6, Math.round(Math.min(w,h)*0.06));
    const br=[], bg=[], bb=[], scores=[];
    function add(i){ br.push(data[i]); bg.push(data[i+1]); bb.push(data[i+2]); }
    for(let y=0;y<h;y++) for(let x=0;x<w;x++) if(x<border || y<border || x>=w-border || y>=h-border) add((y*w+x)*4);
    const back=[median(br), median(bg), median(bb)], backBright=(back[0]+back[1]+back[2])/3;
    const score = new Float32Array(w*h);
    for(let y=0;y<h;y++) for(let x=0;x<w;x++){
      const i=(y*w+x)*4, r=data[i], g=data[i+1], b=data[i+2], bright=(r+g+b)/3, sat=Math.max(r,g,b)-Math.min(r,g,b);
      const dist=Math.sqrt((r-back[0])**2 + (g-back[1])**2 + (b-back[2])**2);
      const s = dist + sat*0.9 + Math.abs(bright-backBright)*0.35 + (bright < bgThreshold ? 5 : 0);
      score[y*w+x]=s; if(x<border || y<border || x>=w-border || y>=h-border) scores.push(s);
    }
    const th = Math.max(objectThreshold, percentile(scores, 97) + 8);
    for(let i=0;i<score.length;i++) mask[i] = score[i] > th ? 1 : 0;

    // largest connected component
    const visited=new Uint8Array(w*h), dirs=[[1,0],[-1,0],[0,1],[0,-1]]; let best=null;
    for(let y=0;y<h;y++) for(let x=0;x<w;x++){
      const start=y*w+x; if(!mask[start]||visited[start]) continue;
      let qx=[x], qy=[y], head=0, area=0, minX=x,maxX=x,minY=y,maxY=y;
      visited[start]=1;
      while(head<qx.length){ const cx=qx[head], cy=qy[head]; head++; area++; if(cx<minX)minX=cx; if(cx>maxX)maxX=cx; if(cy<minY)minY=cy; if(cy>maxY)maxY=cy;
        for(const [dx,dy] of dirs){ const nx=cx+dx, ny=cy+dy; if(nx<0||ny<0||nx>=w||ny>=h) continue; const ni=ny*w+nx; if(mask[ni] && !visited[ni]){ visited[ni]=1; qx.push(nx); qy.push(ny); } }
      }
      if(!best || area > best.area) best={area,minX,maxX,minY,maxY};
    }
    if(best){
      bbox={x:best.minX,y:best.minY,w:best.maxX-best.minX+1,h:best.maxY-best.minY+1};
      const filtered=new Uint8Array(w*h);
      for(let y=best.minY;y<=best.maxY;y++) for(let x=best.minX;x<=best.maxX;x++){ const idx=y*w+x; if(mask[idx]) filtered[idx]=1; }
      mask=filtered;
    }
  }

  // padding bbox
  const padX=Math.max(4, Math.round(bbox.w*0.04)), padY=Math.max(4, Math.round(bbox.h*0.04));
  bbox.x=Math.max(0,bbox.x-padX); bbox.y=Math.max(0,bbox.y-padY); bbox.w=Math.min(w-bbox.x,bbox.w+padX*2); bbox.h=Math.min(h-bbox.y,bbox.h+padY*2);

  const maskCanvas=document.createElement('canvas'); maskCanvas.width=w; maskCanvas.height=h; const mctx=maskCanvas.getContext('2d'); const imgD=mctx.createImageData(w,h);
  for(let i=0;i<mask.length;i++){ const v=mask[i] ? 255 : 0; imgD.data[i*4]=v; imgD.data[i*4+1]=v; imgD.data[i*4+2]=v; imgD.data[i*4+3]=255; }
  mctx.putImageData(imgD,0,0);
  photoMask = {procCanvas:c, maskCanvas, mask, w, h, bbox, scaleBack:1/scale};
  return photoMask;
}

function renderPhotoPreview(){
  if(!photoImg){ sourceCanvas.width=10; sourceCanvas.height=10; return; }
  fitCanvasPreview(sourceCanvas, sourceCtx, photoImg);
  if(document.getElementById('showPreviewMask').checked){
    const info = computePhotoMask();
    const scale = sourceCanvas.width / photoImg.width;
    sourceCtx.strokeStyle='rgba(34,197,94,.95)'; sourceCtx.lineWidth=2;
    sourceCtx.strokeRect(info.bbox.x*info.scaleBack*scale, info.bbox.y*info.scaleBack*scale, info.bbox.w*info.scaleBack*scale, info.bbox.h*info.scaleBack*scale);
  }
}

function detectTemplate(){
  saveSettings(); if(!templateImg) return;
  const darkThreshold=clamp(num('darkThreshold'),60,240), detectWidth=clamp(num('detectWidth'),500,1400), minArea=clamp(num('minArea'),5,3000), maxArea=clamp(num('maxArea'),50,10000), edgeIgnore=clamp(num('edgeIgnore'),0,200), showCenters=document.getElementById('showCenters').checked;
  const scale=Math.min(1,detectWidth/templateImg.width), w=Math.max(1,Math.round(templateImg.width*scale)), h=Math.max(1,Math.round(templateImg.height*scale));
  const off=document.createElement('canvas'); off.width=w; off.height=h; const ctx=off.getContext('2d',{willReadFrequently:true}); ctx.drawImage(templateImg,0,0,w,h);
  const data=ctx.getImageData(0,0,w,h).data, mask=new Uint8Array(w*h);
  for(let i=0;i<data.length;i+=4){ const bright=(data[i]+data[i+1]+data[i+2])/3; mask[i/4] = (data[i+3]>0 && bright<darkThreshold) ? 1 : 0; }
  const visited=new Uint8Array(w*h), comps=[], dirs=[[1,0],[-1,0],[0,1],[0,-1]];
  for(let y=0;y<h;y++) for(let x=0;x<w;x++){
    const start=y*w+x; if(!mask[start]||visited[start]) continue;
    let qx=[x], qy=[y], head=0, minX=x,maxX=x,minY=y,maxY=y, area=0; visited[start]=1;
    while(head<qx.length){ const cx=qx[head], cy=qy[head]; head++; area++; if(cx<minX)minX=cx; if(cx>maxX)maxX=cx; if(cy<minY)minY=cy; if(cy>maxY)maxY=cy;
      for(const [dx,dy] of dirs){ const nx=cx+dx, ny=cy+dy; if(nx<0||ny<0||nx>=w||ny>=h) continue; const ni=ny*w+nx; if(mask[ni] && !visited[ni]){ visited[ni]=1; qx.push(nx); qy.push(ny); } }
    }
    const bw=maxX-minX+1, bh=maxY-minY+1, aspect=bw/bh, nearEdge=minX<=edgeIgnore || minY<=edgeIgnore || maxX>=w-1-edgeIgnore || maxY>=h-1-edgeIgnore;
    if(area>=minArea && area<=maxArea && bw>=4 && bh>=4 && aspect>0.45 && aspect<2.2 && !nearEdge) comps.push({x:(minX+maxX)/2,y:(minY+maxY)/2,bw,bh,area});
  }
  if(!comps.length){ detected=null; summary.textContent='Не вдалося знайти комірки шаблону. Підкрути threshold / area.'; fitCanvasPreview(templateCanvas, templateCtx, templateImg); return; }
  const widths=comps.map(c=>c.bw).sort((a,b)=>a-b), heights=comps.map(c=>c.bh).sort((a,b)=>a-b), medW=widths[Math.floor(widths.length/2)], medH=heights[Math.floor(heights.length/2)];
  const filtered=comps.filter(c=>c.bw>medW*0.55 && c.bw<medW*1.8 && c.bh>medH*0.55 && c.bh<medH*1.8); filtered.sort((a,b)=>a.y-b.y || a.x-b.x); const rowThreshold=Math.max(4,medH*0.7);
  const rows=[]; for(const c of filtered){ let row = rows.find(r=>Math.abs(r.y-c.y)<=rowThreshold); if(!row){ row={y:c.y,items:[]}; rows.push(row); } row.items.push(c); row.y=row.items.reduce((s,it)=>s+it.y,0)/row.items.length; }
  rows.sort((a,b)=>a.y-b.y); rows.forEach(r=>r.items.sort((a,b)=>a.x-b.x));
  const scaleBack=1/scale, gridW=rows.reduce((m,r)=>Math.max(m,r.items.length),0), gridH=rows.length;
  detected={scaleBack, comps:filtered, rows, gridW, gridH};
  fitCanvasPreview(templateCanvas, templateCtx, templateImg);
  if(showCenters){ const s = templateCanvas.width / templateImg.width; templateCtx.fillStyle='rgba(239,68,68,.85)'; for(const c of detected.comps){ templateCtx.beginPath(); templateCtx.arc(c.x*detected.scaleBack*s,c.y*detected.scaleBack*s,2.2,0,Math.PI*2); templateCtx.fill(); } }
  summary.textContent=`Шаблон знайдено: ${gridW}×${gridH} комірок. Тепер підкрути масштаб і зсув, потім генеруй.`; if(photoImg) generateBtn.disabled=false;
}

function generateOverlay(){
  saveSettings(); if(!photoImg || !templateImg || !detected) return;
  const colorCount=clamp(num('colorCount'),2,32), fillScale=clamp(num('fillScale'),30,100)/100, subjectScale=clamp(num('subjectScale'),30,300)/100;
  const offsetX=Math.round(num('offsetX')), offsetY=Math.round(num('offsetY')), keepAspect=document.getElementById('keepAspect').checked, cropToSubject=document.getElementById('cropToSubject').checked, showLegend=document.getElementById('showLegend').checked;
  const info=computePhotoMask(); const srcBox = cropToSubject ? info.bbox : {x:0,y:0,w:info.w,h:info.h};
  const ratio=srcBox.w/srcBox.h, gridW=detected.gridW, gridH=detected.gridH;

  // base fit in integer cell counts
  let fitCols=gridW, fitRows=gridH;
  if(keepAspect){
    fitCols=Math.min(gridW, Math.max(1, Math.floor(Math.sqrt((gridW*gridH)*ratio))));
    fitRows=Math.max(1, Math.round(fitCols/ratio));
    if(fitRows>gridH){ fitRows=gridH; fitCols=Math.max(1, Math.round(fitRows*ratio)); }
    if(fitCols>gridW){ fitCols=gridW; fitRows=Math.max(1, Math.round(fitCols/ratio)); }
  }
  fitCols = clamp(Math.round(fitCols*subjectScale), 1, gridW);
  fitRows = clamp(Math.round(fitRows*subjectScale), 1, gridH);
  // keep aspect after scaling rounding
  if(keepAspect){
    let corrRows=Math.max(1, Math.round(fitCols/ratio));
    if(corrRows<=gridH){ fitRows=corrRows; }
    else { fitRows=gridH; fitCols=Math.max(1, Math.round(fitRows*ratio)); }
  }

  const startCol = Math.floor((gridW-fitCols)/2) + offsetX;
  const startRow = Math.floor((gridH-fitRows)/2) + offsetY;

  const sampleImgCanvas=document.createElement('canvas'); sampleImgCanvas.width=fitCols; sampleImgCanvas.height=fitRows; const sctx=sampleImgCanvas.getContext('2d',{willReadFrequently:true}); sctx.fillStyle='#fff'; sctx.fillRect(0,0,fitCols,fitRows); sctx.drawImage(info.procCanvas, srcBox.x, srcBox.y, srcBox.w, srcBox.h, 0,0,fitCols,fitRows);
  const sampleMaskCanvas=document.createElement('canvas'); sampleMaskCanvas.width=fitCols; sampleMaskCanvas.height=fitRows; const mctx=sampleMaskCanvas.getContext('2d',{willReadFrequently:true}); mctx.imageSmoothingEnabled=false; mctx.fillStyle='#000'; mctx.fillRect(0,0,fitCols,fitRows); mctx.drawImage(info.maskCanvas, srcBox.x, srcBox.y, srcBox.w, srcBox.h, 0,0,fitCols,fitRows);
  const imgData=sctx.getImageData(0,0,fitCols,fitRows).data, maskData=mctx.getImageData(0,0,fitCols,fitRows).data;

  const samples=[]; const assigned=[];
  for(let r=0;r<fitRows;r++) for(let c=0;c<fitCols;c++){
    const idx=(r*fitCols+c)*4; if(maskData[idx] < 127){ assigned.push(-1); continue; }
    const rgb=[imgData[idx], imgData[idx+1], imgData[idx+2]]; samples.push(rgb); assigned.push(rgb);
  }

  const palette=buildPalette(samples, colorCount); const counts=new Array(palette.length).fill(0);
  for(let i=0;i<assigned.length;i++) if(assigned[i]!==-1){ const k=nearestColorIndex(assigned[i], palette); assigned[i]=k; counts[k]+=1; }

  outputCanvas.width=templateImg.width; outputCanvas.height=templateImg.height; outputCtx.clearRect(0,0,outputCanvas.width,outputCanvas.height); outputCtx.drawImage(templateImg,0,0,outputCanvas.width,outputCanvas.height);
  for(let rowIdx=0; rowIdx<detected.rows.length; rowIdx++){
    const row=detected.rows[rowIdx];
    for(let colIdx=0; colIdx<row.items.length; colIdx++){
      const localRow=rowIdx-startRow, localCol=colIdx-startCol; if(localRow<0||localCol<0||localRow>=fitRows||localCol>=fitCols) continue; const a=assigned[localRow*fitCols+localCol]; if(a===-1) continue;
      const comp=row.items[colIdx], [r,g,b]=palette[a]; const cx=comp.x*detected.scaleBack, cy=comp.y*detected.scaleBack, rx=(comp.bw*detected.scaleBack/2)*fillScale, ry=(comp.bh*detected.scaleBack/2)*fillScale;
      outputCtx.beginPath(); outputCtx.fillStyle=`rgb(${r},${g},${b})`; outputCtx.ellipse(cx,cy,rx,ry,0,0,Math.PI*2); outputCtx.fill();
    }
  }

  const active=palette.map((rgb,i)=>({rgb,count:counts[i],symbol:SYMBOLS[i%SYMBOLS.length]})).filter(x=>x.count>0).sort((a,b)=>b.count-a.count); active.forEach((it,i)=>it.symbol=SYMBOLS[i%SYMBOLS.length]);
  summary.textContent=`ОК. Фото вписано у ${fitCols}×${fitRows} комірок. Якщо об'єкт замалий/зміщений — збільш «Масштаб об'єкта» і підкрути offset X/Y.`;
  renderLegend(active, fitCols*fitRows, showLegend); downloadBtn.disabled=false; legendBtn.disabled=!showLegend;
}

function renderLegend(paletteWithCounts,totalCells,showLegend){ lastLegend=paletteWithCounts; legendEl.innerHTML=''; legendEl.style.display=showLegend?'grid':'none'; if(!showLegend) return; const tpl=document.getElementById('legendRowTemplate'); paletteWithCounts.forEach(item=>{ const node=tpl.content.cloneNode(true); node.querySelector('.legend-color').style.background=`rgb(${item.rgb[0]},${item.rgb[1]},${item.rgb[2]})`; const percent=((item.count/Math.max(1,totalCells))*100).toFixed(1); node.querySelector('.legend-text').textContent=`${item.symbol} — ${rgbToHex(item.rgb)} — ${item.count} комірок (${percent}%)`; legendEl.appendChild(node); }); }
function buildPalette(samples,k){ if(!samples.length) return [[255,255,255],[0,0,0]].slice(0,k); const picked=[]; const step=Math.max(1,Math.floor(samples.length/k)); for(let i=0;i<k;i++) picked.push(samples[Math.min(i*step,samples.length-1)].slice()); for(let iter=0; iter<10; iter++){ const buckets=Array.from({length:picked.length},()=>({sum:[0,0,0],count:0})); for(const s of samples){ const idx=nearestColorIndex(s,picked); buckets[idx].sum[0]+=s[0]; buckets[idx].sum[1]+=s[1]; buckets[idx].sum[2]+=s[2]; buckets[idx].count+=1; } for(let i=0;i<picked.length;i++) if(buckets[i].count) picked[i]=buckets[i].sum.map(v=>Math.round(v/buckets[i].count)); } const unique=[]; const seen=new Set(); for(const c of picked){ const key=c.join(','); if(!seen.has(key)){ seen.add(key); unique.push(c); } } return unique; }
function nearestColorIndex(rgb,palette){ let best=0,bestDist=Infinity; for(let i=0;i<palette.length;i++){ const p=palette[i]; const dr=rgb[0]-p[0], dg=rgb[1]-p[1], db=rgb[2]-p[2]; const dist=dr*dr+dg*dg+db*db; if(dist<bestDist){ bestDist=dist; best=i; } } return best; }
function downloadCanvas(canvas,fileName){ canvas.toBlob(blob=>{ const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=fileName; a.click(); URL.revokeObjectURL(a.href); }, 'image/png'); }
function downloadLegend(){ const lines=['Легенда кольорів']; lastLegend.forEach(item=>lines.push(`${item.symbol}\t${rgbToHex(item.rgb)}\t${item.count} cells`)); const blob=new Blob([lines.join('\n')], {type:'text/plain;charset=utf-8'}); const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='cross-stitch-legend.txt'; a.click(); URL.revokeObjectURL(a.href); }
