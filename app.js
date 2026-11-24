'use strict';
/* Shorts Cutter — সম্পূর্ণ ব্রাউজার-ভিত্তিক, কোনো লাইব্রেরি/সার্ভার ছাড়া */
const $ = s => document.querySelector(s);
const v = $('#video');
const S = { key: '', name: '', clips: [], marks: [], segs: [], hooks: [] };
let working = false, cancelFlag = false, previewEnd = null, objUrl = null;

/* ---------- ইউটিলিটি ---------- */
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Math.random().toString(36).slice(2, 8);
const sleep = ms => new Promise(r => setTimeout(r, ms));
function fmt(t, d = 1) {
  t = Math.max(0, +t || 0);
  t = Math.round(t * 10 ** d) / 10 ** d;
  const h = Math.floor(t / 3600), m = Math.floor(t % 3600 / 60), s = t % 60;
  const ss = (s < 10 ? '0' : '') + s.toFixed(d);
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}
function parseTime(str) {
  const p = String(str).trim().replace(',', '.').split(':').map(Number);
  if (!p.length || p.some(isNaN)) return NaN;
  return p.reduce((a, x) => a * 60 + x, 0);
}
let toastT;
function toast(msg) {
  const el = $('#toast'); el.textContent = msg; el.classList.add('show');
  clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove('show'), 2600);
}
function save() {
  try { localStorage.setItem('sc:' + S.key, JSON.stringify({ clips: S.clips, marks: S.marks, segs: S.segs })); } catch (e) {}
}
function load() {
  try {
    const d = JSON.parse(localStorage.getItem('sc:' + S.key) || 'null');
    S.clips = d?.clips || []; S.marks = d?.marks || []; S.segs = d?.segs || [];
  } catch (e) { S.clips = []; S.marks = []; S.segs = []; }
  S.hooks = [];
}
const once = (el, ev) => new Promise((res, rej) => {
  const ok = () => { el.removeEventListener('error', bad); res(); };
  const bad = () => { el.removeEventListener(ev, ok); rej(new Error('ভিডিও লোড/সিক ব্যর্থ')); };
  el.addEventListener(ev, ok, { once: true });
  el.addEventListener('error', bad, { once: true });
});

/* ---------- ভিডিও লোড ---------- */
$('#file').addEventListener('change', e => {
  const f = e.target.files[0]; if (!f) return;
  if (objUrl) URL.revokeObjectURL(objUrl);
  objUrl = URL.createObjectURL(f);
  v.removeAttribute('crossorigin'); v.crossOrigin = null;
  S.key = f.name + '|' + f.size; S.name = f.name;
  v.src = objUrl;
});
$('#loadUrl').addEventListener('click', () => {
  const u = $('#url').value.trim(); if (!u) return;
  v.crossOrigin = 'anonymous';
  S.key = u; S.name = u.split('/').pop().split('?')[0] || 'video';
  v.src = u;
  toast('লিংকে CORS অনুমতি না থাকলে এক্সপোর্ট কাজ করবে না — ফাইল ডাউনলোড করে নিন');
});
v.addEventListener('loadedmetadata', () => {
  $('#app').hidden = false; $('#fab').hidden = false;
  $('#dur').textContent = fmt(v.duration);
  load(); renderAll();
  $('#edEnd').value = fmt(Math.min(v.duration, 30));
  drawPreview();
});
v.addEventListener('error', () => toast('ভিডিও চালানো যাচ্ছে না (ফরম্যাট/লিংক সমস্যা)'));
v.addEventListener('timeupdate', () => {
  $('#cur').textContent = fmt(v.currentTime);
  if (v.duration) $('#seek').value = v.currentTime / v.duration * 1000;
  if (previewEnd !== null && v.currentTime >= previewEnd) { v.pause(); previewEnd = null; }
});
v.addEventListener('seeked', drawPreview);
v.addEventListener('play', () => requestAnimationFrame(previewLoop));
function previewLoop() { if (v.paused || v.ended || working) return; drawPreview(); requestAnimationFrame(previewLoop); }
$('#seek').addEventListener('input', e => { v.currentTime = e.target.value / 1000 * v.duration; });
document.querySelectorAll('[data-seek]').forEach(b => b.addEventListener('click', () => {
  v.currentTime = Math.min(v.duration, Math.max(0, v.currentTime + +b.dataset.seek));
}));
$('#speed').addEventListener('change', e => { v.playbackRate = +e.target.value; });

/* ---------- সেটিংস ও ফ্রেম ড্র ---------- */
function getSettings() {
  const q = +$('#quality').value, r = $('#ratio').value;
  let W, H;
  if (r === '9:16') { W = q; H = q * 16 / 9; }
  else if (r === '1:1') { W = q; H = q; }
  else if (r === '4:5') { W = q; H = q * 5 / 4; }
  else if (r === '16:9') { W = q * 16 / 9; H = q; }
  else {
    const sw = v.videoWidth || 1280, sh = v.videoHeight || 720;
    const k = Math.min(1, q / Math.min(sw, sh)); W = sw * k; H = sh * k;
  }
  W = Math.round(W / 2) * 2; H = Math.round(H / 2) * 2;
  const fps = +$('#fps').value;
  const bitrate = Math.min(12e6, Math.round(W * H * fps * 0.1));
  return { W, H, r, mode: $('#fit').value, pan: $('#pan').value / 100, fps, bitrate };
}
function drawCover(ctx, src, W, H, pan) {
  const sw = src.videoWidth, sh = src.videoHeight, sr = sw / sh, tr = W / H;
  let cw, ch;
  if (sr > tr) { ch = sh; cw = sh * tr; } else { cw = sw; ch = sw / tr; }
  ctx.drawImage(src, (sw - cw) * pan, (sh - ch) * pan, cw, ch, 0, 0, W, H);
}
function drawFrame(ctx, src, W, H, mode, pan, tmp) {
  const sw = src.videoWidth, sh = src.videoHeight;
  if (!sw || !sh) return;
  if (mode === 'cover') return drawCover(ctx, src, W, H, pan);
  const sr = sw / sh, tr = W / H;
  let dw, dh;
  if (sr > tr) { dw = W; dh = W / sr; } else { dh = H; dw = H * sr; }
  if (mode === 'blur') {
    tmp.width = 40; tmp.height = Math.max(2, Math.round(40 * H / W));
    drawCover(tmp.getContext('2d'), src, tmp.width, tmp.height, 0.5);
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(tmp, 0, 0, W, H);
    ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.fillRect(0, 0, W, H);
  } else { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H); }
  ctx.drawImage(src, (W - dw) / 2, (H - dh) / 2, dw, dh);
}
const pv = $('#pv'), pctx = pv.getContext('2d'), ptmp = document.createElement('canvas');
function drawPreview() {
  if (!v.videoWidth) return;
  const { W, H, mode, pan } = getSettings();
  pv.width = Math.round(240 * W / H); pv.height = 240;
  drawFrame(pctx, v, pv.width, pv.height, mode, pan, ptmp);
}
['ratio', 'quality', 'fit', 'pan'].forEach(id => $('#' + id).addEventListener('input', drawPreview));

/* ---------- ক্লিপ ---------- */
function addClip(start, end, title) {
  start = Math.max(0, start); end = Math.min(v.duration, end);
  if (!(end - start >= 0.5)) return toast('ক্লিপ অন্তত ০.৫ সেকেন্ড হতে হবে');
  S.clips.push({ id: uid(), title: title || 'Clip ' + (S.clips.length + 1), start, end, sel: true });
  save(); renderClips(); toast('ক্লিপ যোগ হয়েছে');
}
$('#setStart').addEventListener('click', () => {
  const t = v.currentTime; $('#edStart').value = fmt(t);
  const e = parseTime($('#edEnd').value);
  if (!(e > t)) $('#edEnd').value = fmt(Math.min(v.duration, t + 30));
});
$('#setEnd').addEventListener('click', () => { $('#edEnd').value = fmt(v.currentTime); });
$('#addClip').addEventListener('click', () => {
  const s = parseTime($('#edStart').value), e = parseTime($('#edEnd').value);
  if (isNaN(s) || isNaN(e)) return toast('সময়ের ফরম্যাট ভুল (যেমন 1:23.5)');
  addClip(s, e);
});
function renderClips() {
  const el = $('#clips');
  if (!S.clips.length) { el.innerHTML = '<p class="muted">এখনো কোনো ক্লিপ নেই।</p>'; return; }
  el.innerHTML = S.clips.map(c => `<div class="item" data-id="${c.id}">
    <div class="itemhead"><input type="checkbox" data-f="sel" ${c.sel ? 'checked' : ''}>
      <input class="title" data-f="title" value="${esc(c.title)}"><span class="pill">${(c.end - c.start).toFixed(1)}s</span></div>
    <div class="row"><input data-f="start" inputmode="decimal" value="${fmt(c.start)}"><span>→</span><input data-f="end" inputmode="decimal" value="${fmt(c.end)}"></div>
    <div class="row"><button class="btn" data-act="play">▶ প্রিভিউ</button><button class="btn" data-act="one">⬇ এক্সপোর্ট</button><button class="btn danger" data-act="del">🗑</button></div>
  </div>`).join('');
}
$('#clips').addEventListener('change', e => {
  const id = e.target.closest('.item')?.dataset.id, f = e.target.dataset.f;
  const c = S.clips.find(x => x.id === id); if (!c || !f) return;
  if (f === 'sel') c.sel = e.target.checked;
  else if (f === 'title') c.title = e.target.value;
  else {
    const t = parseTime(e.target.value);
    if (isNaN(t)) return toast('সময়ের ফরম্যাট ভুল');
    c[f] = Math.min(v.duration, Math.max(0, t));
    if (c.end <= c.start) { toast('শেষ > শুরু হতে হবে'); if (f === 'end') c.end = Math.min(v.duration, c.start + 1); else c.start = Math.max(0, c.end - 1); }
  }
  save(); renderClips();
});
$('#clips').addEventListener('click', e => {
  const act = e.target.dataset.act; if (!act) return;
  const id = e.target.closest('.item').dataset.id, c = S.clips.find(x => x.id === id);
  if (act === 'del') { S.clips = S.clips.filter(x => x !== c); save(); renderClips(); }
  if (act === 'play') { v.currentTime = c.start; previewEnd = c.end; v.play(); window.scrollTo({ top: 0, behavior: 'smooth' }); }
  if (act === 'one') runExport([c]);
});

/* ---------- মার্কার ---------- */
function addMark() {
  if (!v.duration) return;
  S.marks.push({ id: uid(), t: v.currentTime, note: $('#markNote').value.trim() });
  S.marks.sort((a, b) => a.t - b.t);
  $('#markNote').value = ''; save(); renderMarks();
  toast('🔖 মার্ক: ' + fmt(v.currentTime));
  if (navigator.vibrate) navigator.vibrate(30);
}
$('#markBtn').addEventListener('click', addMark);
$('#fab').addEventListener('click', addMark);
function renderMarks() {
  $('#marks').innerHTML = S.marks.map(m => `<div class="item" data-id="${m.id}">
    <div class="itemhead"><span class="pill">${fmt(m.t)}</span><input class="title" data-f="note" value="${esc(m.note)}" placeholder="নোট"></div>
    <div class="row"><button class="btn" data-act="jump">⏩ যান</button><button class="btn" data-act="clip">✂️ ক্লিপ</button><button class="btn danger" data-act="del">🗑</button></div>
  </div>`).join('');
}
$('#marks').addEventListener('change', e => {
  const m = S.marks.find(x => x.id === e.target.closest('.item')?.dataset.id);
  if (m && e.target.dataset.f === 'note') { m.note = e.target.value; save(); }
});
$('#marks').addEventListener('click', e => {
  const act = e.target.dataset.act; if (!act) return;
  const m = S.marks.find(x => x.id === e.target.closest('.item').dataset.id);
  if (act === 'jump') { v.currentTime = m.t; window.scrollTo({ top: 0, behavior: 'smooth' }); }
  if (act === 'del') { S.marks = S.marks.filter(x => x !== m); save(); renderMarks(); }
  if (act === 'clip') addClip(m.t - (+$('#pre').value || 0), m.t + (+$('#post').value || 25), m.note);
});
$('#marksToClips').addEventListener('click', () => {
  S.marks.forEach(m => addClip(m.t - (+$('#pre').value || 0), m.t + (+$('#post').value || 25), m.note));
});

/* ---------- ট্রান্সক্রিপ্ট ও হুক ---------- */
function parseTranscript(txt) {
  const out = []; txt = txt.replace(/\r/g, '');
  const re = /((?:\d+:)?\d+:\d+(?:[.,]\d+)?)\s*-->\s*((?:\d+:)?\d+:\d+(?:[.,]\d+)?)[^\n]*\n([\s\S]*?)(?=\n\s*\n|$)/g;
  let m;
  while ((m = re.exec(txt))) out.push({ s: parseTime(m[1]), e: parseTime(m[2]), text: m[3].replace(/<[^>]+>/g, '').replace(/\n/g, ' ').trim() });
  if (out.length) return out;
  const pts = [];
  for (const ln of txt.split('\n')) {
    const mm = ln.match(/^\s*\[?((?:\d+:)?\d+:\d+(?:[.,]\d+)?)\]?\s*[-–]?\s*(.+)$/);
    if (mm) pts.push({ s: parseTime(mm[1]), text: mm[2].trim() });
  }
  pts.forEach((p, i) => out.push({ s: p.s, e: i + 1 < pts.length ? pts[i + 1].s : p.s + 5, text: p.text }));
  return out;
}
$('#trFile').addEventListener('change', async e => {
  const f = e.target.files[0]; if (!f) return;
  const segs = parseTranscript(await f.text());
  if (!segs.length) return toast('টাইমস্ট্যাম্প পাওয়া যায়নি (SRT/VTT বা "0:12 লেখা" ফরম্যাট দিন)');
  S.segs = segs; save(); renderSegInfo(); analyze();
});
function renderSegInfo() { $('#segInfo').textContent = S.segs.length ? `ট্রান্সক্রিপ্ট: ${S.segs.length} টি সেগমেন্ট লোড আছে` : ''; }
const KW = ['wow', 'omg', 'crazy', 'insane', 'secret', 'never', 'best', 'worst', 'shocking', 'unbelievable', 'mistake', 'free', 'money', 'win', 'clutch', 'ace', 'headshot', 'how to', 'why',
  'আশ্চর্য', 'অবিশ্বাস্য', 'গোপন', 'সবচেয়ে', 'কেন', 'কীভাবে', 'জানেন', 'সাবধান', 'ভুল', 'টাকা', 'ফ্রি', 'অসাধারণ', 'ভয়ংকর', 'বিপদ', 'সত্যি', 'আসল'];
function analyze() {
  if (!S.segs.length) return toast('আগে ট্রান্সক্রিপ্ট দিন');
  const kws = KW.concat($('#kw').value.split(',').map(x => x.trim().toLowerCase()).filter(Boolean));
  const win = +$('#hookLen').value || 25;
  const score = S.segs.map(g => {
    const t = g.text.toLowerCase(); let s = 0;
    kws.forEach(k => { if (t.includes(k)) s += 2; });
    s += (t.match(/!/g) || []).length * 1.5 + (t.match(/\?/g) || []).length + (t.match(/\d+/g) || []).length * 0.5;
    s += Math.min(3, t.split(/\s+/).length / Math.max(0.5, g.e - g.s) / 2);
    return s;
  });
  const cands = S.segs.map((g, i) => {
    let sum = 0, end = g.e;
    for (let j = i; j < S.segs.length && S.segs[j].s < g.s + win; j++) { sum += score[j]; end = S.segs[j].e; }
    return { s: g.s, e: Math.min(end, g.s + win), score: sum, text: g.text };
  }).sort((a, b) => b.score - a.score);
  const picked = [];
  for (const c of cands) {
    if (picked.length >= 8) break;
    if (picked.every(p => c.e <= p.s || c.s >= p.e)) picked.push(c);
  }
  S.hooks = picked; renderHooks();
}
function renderHooks() {
  $('#hooks').innerHTML = S.hooks.map((h, i) => `<div class="item" data-i="${i}">
    <div class="itemhead"><span class="pill">${fmt(h.s, 0)}–${fmt(h.e, 0)}</span><span class="pill">★ ${h.score.toFixed(1)}</span></div>
    <div class="hooktxt">${esc(h.text)}</div>
    <div class="row"><button class="btn" data-act="jump">⏩ যান</button><button class="btn" data-act="clip">✂️ ক্লিপ</button><button class="btn" data-act="mark">🔖 মার্ক</button></div>
  </div>`).join('') || '<p class="muted">কোনো হুক পাওয়া যায়নি।</p>';
}
$('#hooks').addEventListener('click', e => {
  const act = e.target.dataset.act; if (!act) return;
  const h = S.hooks[+e.target.closest('.item').dataset.i];
  if (act === 'jump') { v.currentTime = h.s; window.scrollTo({ top: 0, behavior: 'smooth' }); }
  if (act === 'clip') addClip(h.s, h.e, h.text.slice(0, 40));
  if (act === 'mark') { S.marks.push({ id: uid(), t: h.s, note: h.text.slice(0, 40) }); S.marks.sort((a, b) => a.t - b.t); save(); renderMarks(); toast('মার্ক হয়েছে'); }
});
$('#analyzeBtn').addEventListener('click', analyze);

/* ---------- মিডিয়া হেল্পার ---------- */
/* মূল ভিডিও এলিমেন্টই ব্যবহার হয় (অনেক ফোনে দ্বিতীয় ডিকোডার চালু হয় না) */
let AG = null;
function audioGraph() {
  if (AG) return AG;
  const ac = new (window.AudioContext || window.webkitAudioContext)();
  const src = ac.createMediaElementSource(v);
  const mon = ac.createGain(); src.connect(mon); mon.connect(ac.destination);
  const dest = ac.createMediaStreamDestination(); src.connect(dest);
  return AG = { ac, mon, dest };
}
async function makeVideo() {
  v.pause(); previewEnd = null; v.controls = false; v.playbackRate = 1;
  if (v.readyState < 1) await once(v, 'loadedmetadata');
  return v;
}
async function seekTo(ev, t) {
  t = Math.max(t, 0.001);
  if (Math.abs(ev.currentTime - t) < 0.02 && ev.readyState >= 2) return;
  ev.currentTime = t; await once(ev, 'seeked');
}
function dispose() {
  try { v.pause(); v.playbackRate = +$('#speed').value; v.controls = true; if (AG) AG.mon.gain.value = 1; } catch (e) {}
  drawPreview();
}
function waitEnd(ev, end, tick) {
  return new Promise((res, rej) => {
    const iv = setInterval(() => {
      if (cancelFlag) { clearInterval(iv); rej(new Error('বাতিল করা হয়েছে')); return; }
      tick && tick();
      if (ev.currentTime >= end || ev.ended) { clearInterval(iv); res(); }
    }, 80);
  });
}
function pickMime() {
  return ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']
    .find(m => MediaRecorder.isTypeSupported(m)) || '';
}

/* ---------- এক্সপোর্ট (Canvas + MediaRecorder) ---------- */
async function exportClip(clip, prog) {
  const { W, H, mode, pan, fps, bitrate } = getSettings();
  const ev = await makeVideo();
  const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d', { alpha: false });
  const tmp = document.createElement('canvas');
  let rec, running = true;
  try {
    await seekTo(ev, clip.start);
    const g = audioGraph(); g.mon.gain.value = 0; // স্পিকারে নিঃশব্দ, শুধু রেকর্ডে যাবে
    const ac = g.ac;
    const stream = canvas.captureStream(fps);
    g.dest.stream.getAudioTracks().forEach(t => stream.addTrack(t));
    const mime = pickMime();
    rec = new MediaRecorder(stream, { mimeType: mime || undefined, videoBitsPerSecond: bitrate, audioBitsPerSecond: 128000 });
    const chunks = []; rec.ondataavailable = e => e.data.size && chunks.push(e.data);
    const stopped = new Promise(r => rec.onstop = r);
    drawFrame(ctx, ev, W, H, mode, pan, tmp);
    rec.start(1000);
    await ac.resume();
    await ev.play();
    const sched = () => ('requestVideoFrameCallback' in ev) ? ev.requestVideoFrameCallback(loop) : requestAnimationFrame(loop);
    const loop = () => { if (!running) return; drawFrame(ctx, ev, W, H, mode, pan, tmp); sched(); };
    sched();
    await waitEnd(ev, clip.end, () => prog(Math.min(1, (ev.currentTime - clip.start) / (clip.end - clip.start))));
    running = false; ev.pause(); await sleep(150);
    rec.stop(); await stopped;
    const type = (mime || 'video/webm').split(';')[0];
    return { blob: new Blob(chunks, { type }), ext: type.includes('mp4') ? 'mp4' : 'webm' };
  } finally {
    running = false;
    try { if (rec && rec.state !== 'inactive') rec.stop(); } catch (e) {}
    dispose();
  }
}
function setWorking(b) {
  working = b;
  $('#exAll').disabled = b; $('#exCancel').hidden = !b; $('#groqBtn').disabled = b;
}
async function runExport(list) {
  if (working) return;
  if (!list.length) return toast('কমপক্ষে একটি ক্লিপ নির্বাচন করুন');
  if (!window.MediaRecorder) return toast('Chrome ব্যবহার করুন (MediaRecorder নেই)');
  if (list.some(c => c.end - c.start > 300)) toast('৫ মিনিটের বেশি ক্লিপে RAM বেশি লাগে — Termux স্ক্রিপ্ট ভালো');
  setWorking(true); cancelFlag = false; $('#bar').value = 0;
  let wl = null; try { wl = await navigator.wakeLock?.request('screen'); } catch (e) {}
  try {
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      $('#exStatus').textContent = `ক্লিপ ${i + 1}/${list.length}: ${c.title}`;
      const r = await exportClip(c, p => { $('#bar').value = (i + p) / list.length * 100; });
      addResult(c, r, i);
    }
    $('#bar').value = 100; $('#exStatus').textContent = 'সম্পন্ন ✅'; toast('এক্সপোর্ট শেষ ✅');
  } catch (e) { $('#exStatus').textContent = 'ত্রুটি: ' + e.message; toast('ত্রুটি: ' + e.message); }
  finally { setWorking(false); try { wl && wl.release(); } catch (e) {} }
}
$('#exAll').addEventListener('click', () => runExport(S.clips.filter(c => c.sel)));
$('#exCancel').addEventListener('click', () => { cancelFlag = true; });
function addResult(c, r, i) {
  const base = (S.name || 'video').replace(/\.[^.]+$/, '').replace(/[^\w\u0980-\u09FF-]+/g, '_').slice(0, 40);
  const name = `${base}_${S.clips.indexOf(c) + 1}_${fmt(c.start, 0)}-${fmt(c.end, 0)}`.replace(/:/g, '-') + '.' + r.ext;
  const url = URL.createObjectURL(r.blob);
  const div = document.createElement('div'); div.className = 'item res';
  div.innerHTML = `<div class="hooktxt">${esc(name)} <span class="pill">${(r.blob.size / 1048576).toFixed(1)} MB</span></div>
    <video controls playsinline src="${url}"></video>
    <div class="row"><a class="btn" style="flex:1;text-decoration:none" href="${url}" download="${esc(name)}">💾 সেভ</a><button class="btn" style="flex:1">📤 শেয়ার</button></div>`;
  div.querySelector('button').addEventListener('click', async () => {
    const file = new File([r.blob], name, { type: r.blob.type });
    try {
      if (navigator.canShare && navigator.canShare({ files: [file] })) await navigator.share({ files: [file], title: name });
      else toast('এই ডিভাইসে শেয়ার সাপোর্ট নেই — "সেভ" ব্যবহার করুন');
    } catch (e) {}
  });
  $('#results').prepend(div);
}

/* ---------- Groq Whisper (ঐচ্ছিক) ---------- */
async function recordAudio(s, e, rate, prog) {
  const ev = await makeVideo(); let rec;
  try {
    await seekTo(ev, s);
    ev.playbackRate = rate;
    const g = audioGraph(); g.mon.gain.value = 0;
    const ac = g.ac, dest = g.dest;
    const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find(m => MediaRecorder.isTypeSupported(m)) || '';
    rec = new MediaRecorder(dest.stream, { mimeType: mime || undefined, audioBitsPerSecond: 32000 });
    const chunks = []; rec.ondataavailable = x => x.data.size && chunks.push(x.data);
    const stopped = new Promise(r => rec.onstop = r);
    rec.start(1000); await ac.resume(); await ev.play();
    await waitEnd(ev, e, () => prog(Math.min(1, (ev.currentTime - s) / (e - s))));
    ev.pause(); rec.stop(); await stopped;
    return new Blob(chunks, { type: (mime || 'audio/webm').split(';')[0] });
  } finally { try { if (rec && rec.state !== 'inactive') rec.stop(); } catch (x) {} dispose(); }
}
$('#groqBtn').addEventListener('click', async () => {
  const key = $('#groqKey').value.trim(); if (!key) return toast('Groq API key দিন');
  const s = parseTime($('#edStart').value), e = parseTime($('#edEnd').value);
  if (!(e > s)) return toast('"নতুন ক্লিপ" অংশে শুরু–শেষ ঠিক করুন');
  if (e - s > 900) return toast('একবারে সর্বোচ্চ ১৫ মিনিট');
  try { localStorage.setItem('sc:groq', key); } catch (x) {}
  const rate = +$('#asr').value;
  if (working) return;
  setWorking(true); cancelFlag = false; $('#bar').value = 0;
  let wl = null; try { wl = await navigator.wakeLock?.request('screen'); } catch (x) {}
  try {
    $('#exStatus').textContent = 'অডিও রেকর্ড হচ্ছে…';
    const blob = await recordAudio(s, e, rate, p => { $('#bar').value = p * 100; });
    $('#exStatus').textContent = 'Groq-তে পাঠানো হচ্ছে…';
    const fd = new FormData();
    fd.append('file', blob, 'audio.webm'); fd.append('model', 'whisper-large-v3-turbo'); fd.append('response_format', 'verbose_json');
    if ($('#lang').value) fd.append('language', $('#lang').value);
    const res = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', { method: 'POST', headers: { Authorization: 'Bearer ' + key }, body: fd });
    if (!res.ok) throw new Error('Groq: ' + (await res.text()).slice(0, 160));
    const j = await res.json();
    const segs = (j.segments || []).map(x => ({ s: s + x.start * rate, e: s + x.end * rate, text: (x.text || '').trim() }));
    S.segs = S.segs.filter(x => x.e <= s || x.s >= e).concat(segs).sort((a, b) => a.s - b.s);
    save(); renderSegInfo(); analyze(); $('#exStatus').textContent = 'ট্রান্সক্রিপ্ট তৈরি ✅';
  } catch (x) { $('#exStatus').textContent = 'ত্রুটি: ' + x.message; toast('ত্রুটি: ' + x.message); }
  finally { setWorking(false); try { wl && wl.release(); } catch (x) {} }
});

/* ---------- Termux স্ক্রিপ্ট জেনারেটর ---------- */
$('#genScript').addEventListener('click', () => {
  const { W, H, r, mode, pan, fps } = getSettings();
  const inName = ($('#termuxIn').value.trim() || S.name || 'input.mp4');
  const url = $('#termuxUrl').value.trim();
  const sel = S.clips.filter(c => c.sel);
  if (!sel.length) return toast('আগে ক্লিপ বানান ও নির্বাচন করুন');
  const sh = x => x.replace(/"/g, '\\"');
  let vf;
  if (r === 'orig') vf = '';
  else if (mode === 'cover') vf = `-vf "crop=w='min(iw\\,ih*${W}/${H})':h='min(ih\\,iw*${H}/${W})':x='(iw-ow)*${pan}':y='(ih-oh)*${pan}',scale=${W}:${H}"`;
  else if (mode === 'blur') vf = `-filter_complex "[0:v]split[a][b];[a]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},boxblur=20:5[bg];[b]scale=${W}:${H}:force_original_aspect_ratio=decrease[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2"`;
  else vf = `-vf "scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2"`;
  const lines = [
    '#!/data/data/com.termux/files/usr/bin/bash',
    '# প্রথমবার: pkg update -y && pkg install -y ffmpeg yt-dlp && termux-setup-storage',
    'mkdir -p "$HOME/storage/movies/shorts"',
  ];
  if (url) lines.push(`yt-dlp -f "bv*[height<=1080]+ba/b" --merge-output-format mp4 -o "$HOME/storage/downloads/${sh(inName)}" "${sh(url)}"`);
  lines.push(`IN="$HOME/storage/downloads/${sh(inName)}"`, 'OUT="$HOME/storage/movies/shorts"', '');
  S.clips.forEach((c, i) => {
    if (!c.sel) return;
    lines.push(`ffmpeg -y -ss ${c.start.toFixed(2)} -to ${c.end.toFixed(2)} -i "$IN" ${vf} -r ${fps} -c:v libx264 -preset veryfast -crf 23 -pix_fmt yuv420p -c:a aac -b:a 128k -movflags +faststart "$OUT/clip_${String(i + 1).padStart(2, '0')}.mp4"`);
  });
  lines.push('', 'echo "শেষ! ফাইল: Movies/shorts"');
  $('#script').value = lines.join('\n');
});
$('#copyScript').addEventListener('click', async () => {
  const t = $('#script').value; if (!t) return;
  try { await navigator.clipboard.writeText(t); toast('কপি হয়েছে'); } catch (e) { $('#script').select(); document.execCommand('copy'); toast('কপি হয়েছে'); }
});
$('#resetAll').addEventListener('click', () => {
  if (!confirm('এই ভিডিওর সব ক্লিপ ও মার্কার মুছবেন?')) return;
  S.clips = []; S.marks = []; S.segs = []; S.hooks = []; save(); renderAll();
});

function renderAll() { renderClips(); renderMarks(); renderSegInfo(); renderHooks(); }

/* ---------- PWA ---------- */
try { $('#groqKey').value = localStorage.getItem('sc:groq') || ''; } catch (e) {}
let deferred;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferred = e; $('#installBtn').hidden = false; });
$('#installBtn').addEventListener('click', async () => { if (deferred) { deferred.prompt(); deferred = null; $('#installBtn').hidden = true; } });
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
