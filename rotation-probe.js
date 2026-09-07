/* Opt-in local diagnostics. Does not change the pie renderer or send data. */
(() => {
  'use strict';
  if (window.AssetRotationProbe) return;
  const panel = document.createElement('section');
  panel.id = 'rotationProbePanel';
  panel.style.cssText = 'position:fixed;z-index:2147483647;left:8px;right:8px;top:8px;padding:12px;background:#111e2a;color:#fff;border:1px solid #6b93ab;border-radius:12px;font:14px sans-serif;max-height:45vh;overflow:auto';
  panel.innerHTML = '<div>旋转诊断（不修改动效）</div><p id="rotationProbeStatus">先切换到饼图，再点记录。面板会隐藏，请连续转动 15 秒。只记录触摸与帧时间，不记录资产金额，不上传。</p><button id="rotationProbeStart" type="button">记录 15 秒</button> <button id="rotationProbeSave" type="button" hidden>保存诊断文件</button><textarea id="rotationProbeOutput" readonly hidden aria-label="诊断记录" style="width:100%;height:100px;user-select:text;-webkit-user-select:text"></textarea>';
  document.body.append(panel);
  const startButton = panel.querySelector('#rotationProbeStart');
  const saveButton = panel.querySelector('#rotationProbeSave');
  const output = panel.querySelector('#rotationProbeOutput');
  const status = panel.querySelector('#rotationProbeStatus');
  let recording = false, report = null, began = 0, lastFrame = 0, raf = 0, timer = 0, observer = null;
  const held = new Set();
  const types = ['pointerdown','pointermove','pointerup','pointercancel','gotpointercapture','lostpointercapture'];
  const round = n => Math.round(n * 100) / 100;
  const append = (list, entry) => { if (list.length < 10000) list.push(entry); else report.truncated = true; };
  function input(event) {
    if (!recording) return;
    const inPie = event.target instanceof Element && event.target.closest('.assetPieViewport');
    if (!inPie && !held.has(event.pointerId)) return;
    if (event.type === 'pointerdown') held.add(event.pointerId);
    append(report.inputs, {type:event.type,t:round(performance.now()-began),eventTime:round(event.timeStamp),id:event.pointerId,pointerType:event.pointerType,x:round(event.clientX),y:round(event.clientY)});
    if (event.type === 'pointerup' || event.type === 'pointercancel' || event.type === 'lostpointercapture') held.delete(event.pointerId);
  }
  function frame() {
    if (!recording) return;
    const now = performance.now();
    append(report.frames, {t:round(now-began),gap:round(now-lastFrame),held:held.size>0});
    lastFrame = now;
    raf = requestAnimationFrame(frame);
  }
  function stop() {
    if (!recording) return report;
    recording = false;
    clearTimeout(timer); cancelAnimationFrame(raf); observer?.disconnect();
    types.forEach(type=>document.removeEventListener(type,input,true));
    report.durationMs = round(performance.now()-began);
    report.summary = {moves:report.inputs.filter(e=>e.type==='pointermove').length,frameCallbacks:report.frames.length,rotationWrites:report.commits.length,maxCallbackGapMs:Math.max(0,...report.frames.map(e=>e.gap))};
    held.clear();
    output.value = JSON.stringify(report,null,2);
    output.hidden = false; saveButton.hidden = false; panel.hidden = false;
    status.textContent = `已记录 ${report.summary.moves} 次移动、${report.summary.rotationWrites} 次旋转写入。请保存文件发回。帧回调间隔不等于屏幕实际绘制帧率。`;
    return report;
  }
  function start() {
    if (recording) return;
    const compositor = document.querySelector('.assetPieCompositor');
    const rotator = document.querySelector('.pieRotator');
    if (!compositor || !rotator) { status.textContent = '请先切换到饼图，再开始记录。'; return; }
    began = lastFrame = performance.now(); held.clear();
    report = {schema:1,startedAt:new Date().toISOString(),userAgent:navigator.userAgent,viewport:[innerWidth,innerHeight],dpr:devicePixelRatio,reduceMotion:matchMedia('(prefers-reduced-motion: reduce)').matches,scripts:[...document.scripts].filter(s=>s.src).map(s=>new URL(s.src).pathname.split('/').pop()+new URL(s.src).search),inputs:[],frames:[],commits:[],truncated:false};
    recording = true; panel.hidden = true;
    types.forEach(type=>document.addEventListener(type,input,{capture:true,passive:true}));
    observer = new MutationObserver(records=>{
      if (!recording) return;
      for (const target of new Set(records.map(r=>r.target))) append(report.commits,{t:round(performance.now()-began),layer:target===compositor?'compositor':'svg',transform:target===compositor?target.style.transform:target.getAttribute('transform')});
    });
    observer.observe(compositor,{attributes:true,attributeFilter:['style']});
    observer.observe(rotator,{attributes:true,attributeFilter:['transform']});
    raf = requestAnimationFrame(frame); timer = setTimeout(stop,15000);
  }
  startButton.addEventListener('click',start);
  saveButton.addEventListener('click',()=>{
    const url = URL.createObjectURL(new Blob([output.value],{type:'application/json'}));
    const link = document.createElement('a'); link.href=url; link.download='asset-rotation-diagnostics.json'; link.click();
    setTimeout(()=>URL.revokeObjectURL(url),30000);
  });
  window.AssetRotationProbe = {start,stop};
})();
