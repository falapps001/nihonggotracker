import * as Sync from './sync.js';

const VERSION = '1.0.1';

/* ---------- utils ---------- */
const LEVELS = ['N5', 'N4', 'N3', 'N2', 'N1'];
const LADDERS = { slow: [1, 2, 4, 7, 10, 14, 21, 30, 45, 60, 90, 120, 180, 240], normal: [2, 4, 7, 14, 30, 60, 120, 240], fast: [3, 7, 21, 60, 180, 365] };
const SCORES = { 1: 'Forgot', 2: 'Weak', 3: 'Okay', 4: 'Good', 5: 'Mastered' };
const MAX_NEW_PER_DAY = 3;
const pad = n => String(n).padStart(2, '0');
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parse = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return ymd(d); };
const diff = (a, b) => Math.round((parse(b) - parse(a)) / 864e5);
const today = () => ymd(new Date());
const fmt = (s, o = { weekday: 'short', day: 'numeric', month: 'short' }) => parse(s).toLocaleDateString('en-GB', o);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const rel = n => n === 0 ? 'today' : n === 1 ? 'tomorrow' : n > 0 ? `in ${n} days` : `${-n}d overdue`;
const firstSunday = (y, m) => { const d = new Date(y, m, 1); d.setDate(1 + (7 - d.getDay()) % 7); return ymd(d); };
const relTime = ms => { if (!ms) return 'never'; const x = (Date.now() - ms) / 1000; if (x < 60) return 'just now'; if (x < 3600) return `${Math.floor(x / 60)} min ago`; if (x < 86400) return `${Math.floor(x / 3600)} h ago`; return `${Math.floor(x / 86400)} d ago`; };
const TRASH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg>';

/* ---------- storage ---------- */
const KEY = 'nt-data-v1', SKEY = 'nt-sync-v1', UKEY = 'nt-ui-v1';
const read = k => { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } };
const blank = () => ({ materials: [], sessions: [], exams: [], settings: { speed: 'normal' }, metaU: 0, owner: null });
let data = Object.assign(blank(), read(KEY) || {});
let sync = Object.assign({ deviceId: uid(), deviceName: null, lastPull: 0, lastSync: 0, lastBackup: 0, dirty: [], tomb: [], dirtyMeta: false, first: true }, read(SKEY) || {});
let ui = Object.assign({ tab: 'today', level: null, histLimit: 15, hmPick: null, year: null, open: [], fcPick: null }, read(UKEY) || {}, { hmPick: null, fcPick: null });
if (!sync.deviceName) sync.deviceName = thisDevice()[1];
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(data)); localStorage.setItem(SKEY, JSON.stringify(sync)); localStorage.setItem(UKEY, JSON.stringify(ui)); }
  catch (e) { toast('Could not save on this device. Storage may be full.'); }
}
try { navigator.storage && navigator.storage.persist && navigator.storage.persist(); } catch (e) {}

// Setiap perubahan ditandai supaya ikut terkirim saat sync
function touchMeta() { data.metaU = Date.now(); sync.dirtyMeta = true; }
function touchSession(s) { s.u = Date.now(); if (!sync.dirty.includes(s.id)) sync.dirty.push(s.id); }
function dropSession(id) { data.sessions = data.sessions.filter(x => x.id !== id); sync.dirty = sync.dirty.filter(x => x !== id); if (!sync.tomb.includes(id)) sync.tomb.push(id); }
function commit() { save(); render(); Sync.schedule(); }

function thisDevice() {
  const u = navigator.userAgent;
  return /iPhone/.test(u) ? ['📱', 'iPhone'] : /iPad/.test(u) ? ['📱', 'iPad'] : /Android/.test(u) ? ['📱', 'Android']
    : /Windows/.test(u) ? ['💻', /Edg\//.test(u) ? 'Edge on Windows' : 'Chrome on Windows'] : /Mac/.test(u) ? ['💻', 'Mac'] : ['💻', 'Browser'];
}

/* ---------- jadwal review per chapter ---------- */
const speed = () => (data.settings && data.settings.speed) || 'normal';
function nextCard(prev, score, date) {
  const L = LADDERS[speed()];
  let step, interval;
  if (score <= 2) { step = 0; interval = 1; }
  else if (!prev) { step = score === 5 ? 1 : 0; interval = L[step]; }
  else if (score === 3) { step = Math.min(prev.step, L.length - 1); interval = L[step]; }
  else { step = Math.min(prev.step + (score === 5 ? 2 : 1), L.length - 1); interval = L[step]; }
  return { step, interval, due: addDays(date, interval), reps: (prev ? prev.reps : 0) + 1, last: date, score };
}
function cardsFrom(sessions) {
  const cards = {};
  sessions.filter(s => s.kind === 'bab').sort((a, b) => a.date.localeCompare(b.date) || a.t - b.t).forEach(s => {
    const k = s.m + ':' + s.ch;
    cards[k] = Object.assign(nextCard(cards[k], s.score, s.date), { m: s.m, ch: s.ch });
  });
  return cards;
}
const mastery = c => !c ? 'none' : c.score >= 4 ? 'good' : c.score === 3 ? 'mid' : 'bad';

function defaultMaterials() {
  return [
    { id: 'mnn1', level: 'N5', name: 'Minna no Nihongo I', start: 1, count: 25 },
    { id: 'mnn2', level: 'N4', name: 'Minna no Nihongo II', start: 26, count: 25 },
    { id: 'sm-bunpou', level: 'N3', name: 'Sou Matome N3 Bunpou', start: 1, count: 42 },
    { id: 'sm-kotoba', level: 'N3', name: 'Sou Matome N3 Kotoba', start: 1, count: 36 },
    { id: 'sm-kanji', level: 'N3', name: 'Sou Matome N3 Kanji', start: 1, count: 42 },
  ];
}

const mat = id => data.materials.find(m => m.id === id);
const uName = () => 'Chapter';
const short = m => (m ? m.name : '?').replace(/^Sou Matome N\d /, '');
const inLevel = mId => (mat(mId) || {}).level === ui.level;
const levelSessions = () => data.sessions.filter(s => s.kind === 'bab' && inLevel(s.m));
const units = m => [...Array(m.count)].map((_, i) => m.start + i);
function summary(m, cards = cardsFrom(data.sessions)) {
  const r = { good: 0, mid: 0, bad: 0, none: 0, due: 0 }; const t = today();
  units(m).forEach(u => { const c = cards[m.id + ':' + u]; r[mastery(c)]++; if (c && c.due <= t) r.due++; });
  r.done = m.count - r.none; return r;
}
const nextUnit = (m, cards = cardsFrom(data.sessions)) => units(m).find(u => !cards[m.id + ':' + u]) ?? null;
const stackBar = (s, total) => `<div class="stack" role="img" aria-label="${s.good} mastered, ${s.mid} shaky, ${s.bad} weak, ${s.none} not started">${['good', 'mid', 'bad'].map(k => s[k] ? `<i style="width:${s[k] / total * 100}%;background:var(--m-${k})"></i>` : '').join('')}</div>`;
function streaks() {
  const days = new Set(levelSessions().map(s => s.date)); const t = today();
  let cur = 0, d = days.has(t) ? t : addDays(t, -1);
  while (days.has(d)) { cur++; d = addDays(d, -1); }
  let best = 0, r = 0, prev = null;
  [...days].sort().forEach(x => { r = prev && diff(prev, x) === 1 ? r + 1 : 1; best = Math.max(best, r); prev = x; });
  return { cur, best, totalDays: days.size };
}
function activeLevel() {
  const t = today(); const cards = cardsFrom(data.sessions);
  const e = data.exams.filter(x => x.date >= t).sort((a, b) => a.date.localeCompare(b.date)).find(x => data.materials.some(m => m.level === x.level && nextUnit(m, cards) !== null));
  if (e) return e.level;
  const m = data.materials.find(m => nextUnit(m, cards) !== null); return m ? m.level : null;
}

/* ---------- views ---------- */
function examCard(e) {
  const t = today(); const left = diff(t, e.date); const weeks = Math.max(1, left / 7); const cards = cardsFrom(data.sessions);
  const n1 = x => (Math.round(x * 10) / 10).toString();
  const rows = data.materials.filter(m => m.level === e.level).map(m => {
    const s = summary(m, cards); const remain = s.none;
    if (!remain) return `<span>${esc(short(m))}</span><span class="num">${m.count}/${m.count}</span><span class="num">–</span><span class="fin ok">Finished</span>`;
    const need = remain / weeks; // target chapter baru per minggu supaya selesai sebelum ujian
    const first = {}; data.sessions.filter(x => x.kind === 'bab' && x.m === m.id).forEach(x => { if (!first[x.ch] || x.date < first[x.ch]) first[x.ch] = x.date; });
    const pace = Object.values(first).filter(d => diff(d, t) < 28).length / 4; // kecepatan nyata: 4 minggu terakhir
    const finish = pace > 0 ? addDays(t, Math.ceil(remain / pace * 7)) : null;
    const ok = finish && finish <= e.date;
    const finTxt = finish ? fmt(finish, { month: 'short', year: '2-digit' }).replace(' ', " '") : 'stalled';
    return `<span>${esc(short(m))}</span><span class="num">${s.done}/${m.count}</span><span class="num"><b class="${ok ? 'ok' : 'bad'}">${n1(pace)}</b> / ${n1(need)}</span><span class="fin ${ok ? 'ok' : 'bad'}">${finTxt}</span>`;
  }).join('');
  return `<div class="exhead"><b class="days">${left}</b><span class="grow"><span class="t">days to ${esc(e.name)}</span> <span class="small muted">· ${fmt(e.date, { day: 'numeric', month: 'short', year: 'numeric' })}</span></span><button class="del" data-delexam="${e.id}" aria-label="Delete exam" title="Delete exam">${TRASH}</button></div>
  ${rows ? `<div class="pgrid"><span></span><span class="h">done</span><span class="h">weekly pace</span><span class="h">finish</span>${rows}</div>` : ''}`;
}
function planCard() {
  const t = today(); const cards = cardsFrom(data.sessions);
  const isFirst = s => !data.sessions.some(x => x.kind === 'bab' && x.m === s.m && x.ch === s.ch && (x.date < s.date || (x.date === s.date && x.t < s.t)));
  const todays = data.sessions.filter(s => s.date === t && s.kind === 'bab' && inLevel(s.m) && isFirst(s)).sort((a, b) => a.t - b.t);
  const doneBooks = new Set(todays.map(s => s.m));
  const slots = Math.max(0, MAX_NEW_PER_DAY - todays.length);
  const mats = data.materials.filter(m => inLevel(m.id) && !doneBooks.has(m.id) && nextUnit(m, cards) !== null).slice(0, slots); // 1 chapter baru per buku per hari, maks 3
  const doneRows = todays.map(s => `<div class="item"><span class="check on">✓</span><div class="grow"><div class="t">${esc(short(mat(s.m)))} · ${uName()} ${s.ch}</div><div class="small muted">${SCORES[s.score]}</div></div></div>`).join('');
  const nextRows = mats.map(m => { const u = nextUnit(m, cards); return `<div class="item"><span class="check"></span><div class="grow"><div class="t">${esc(short(m))} · ${uName()} ${u}</div></div><button class="btn sm" data-log="${m.id}:${u}">Log</button></div>`; }).join('');
  const total = todays.length + mats.length; const hasBooks = data.materials.some(m => inLevel(m.id));
  return `<section class="card compact"><div class="row"><h2>Today's plan</h2><span class="small muted">${total ? `${todays.length}/${total} done` : fmt(t, { weekday: 'long', day: 'numeric', month: 'short' })}</span></div>
    <div class="list">${doneRows}${nextRows}${!total && hasBooks ? '<div class="muted small">Every book in this level is started. Keep up with your reviews.</div>' : ''}</div>
    ${todays.length && !mats.length ? '<p class="note">Done for today ✓ The next chapters show up tomorrow.</p>' : ''}
    ${!hasBooks ? `<p class="note">No books in ${ui.level} yet. Add one in the Books tab.</p>` : ''}</section>`;
}
const reviewItem = c => { const d = diff(today(), c.due); return `<div class="item"><span class="dot" style="background:var(--m-${mastery(c)})"></span>
  <div class="grow"><div class="t" title="Last ${fmt(c.last)} · ${SCORES[c.score]}">${esc(short(mat(c.m)))} · ${uName()} ${c.ch}</div></div>
  <span class="pill ${d < 0 ? 'bad' : 'warn'}">${rel(d)}</span><button class="btn sm primary" data-log="${c.m}:${c.ch}">Review</button></div>`; };
function viewToday() {
  const t = today();
  const cards = Object.values(cardsFrom(data.sessions)).filter(c => inLevel(c.m));
  const due = cards.filter(c => c.due <= t).sort((a, b) => a.due.localeCompare(b.due));
  const exam = data.exams.filter(e => e.date >= t && e.level === ui.level).sort((a, b) => a.date.localeCompare(b.date))[0];
  let forecast = '';
  if (cards.length) {
    const days = [...Array(7)].map((_, i) => addDays(t, i + 1)); const n = days.map(d => cards.filter(c => c.due === d).length);
    const pick = days.includes(ui.fcPick) ? ui.fcPick : null;
    const list = pick ? cards.filter(c => c.due === pick).sort((a, b) => a.m.localeCompare(b.m) || a.ch - b.ch) : [];
    forecast = `<div class="fc7"><span class="fl">Next 7 days</span>${days.map((d, i) => `<button class="fd${!n[i] ? ' zero' : ''}${d === pick ? ' sel' : ''}" data-fcday="${d}" aria-pressed="${d === pick}" aria-label="${fmt(d)}: ${n[i]} due"><small>${parse(d).toLocaleDateString('en-GB', { weekday: 'short' })}</small><b>${n[i]}</b></button>`).join('')}</div>
      ${pick ? `<div class="fclist"><div class="lday">${fmt(pick)} · ${rel(diff(t, pick))}</div>${list.length ? list.map(c => `<div class="lrow"><i class="dot" style="background:var(--m-${mastery(c)})"></i><span class="grow">${esc(short(mat(c.m)))} · ${uName()} ${c.ch}</span><button class="btn sm" data-log="${c.m}:${c.ch}">Review now</button></div>`).join('') : '<div class="small muted">Nothing due this day.</div>'}</div>` : ''}`;
  }
  return `${exam ? `<section class="card">${examCard(exam)}</section>` : '<button class="addexam" data-addexam>＋ Add exam date</button>'}
  ${planCard()}
  <section class="card compact due"><div class="row"><h2>Due for review</h2><span class="small muted">${due.length || ''}</span></div>
    <div class="list">${due.length ? due.map(reviewItem).join('') : '<div class="muted small">Nothing to review today.</div>'}</div>${forecast}</section>`;
}
function heatmap(year) {
  const t = today(); const jan1 = `${year}-01-01`, dec31 = `${year}-12-31`;
  const start = addDays(jan1, -((parse(jan1).getDay() + 6) % 7));
  const end = addDays(dec31, 6 - (parse(dec31).getDay() + 6) % 7);
  const weeks = (diff(start, end) + 1) / 7;
  const counts = {}; levelSessions().forEach(x => counts[x.date] = (counts[x.date] || 0) + 1);
  let cells = '', months = '', todayCol = weeks;
  for (let w = 0; w < weeks; w++) {
    const wStart = addDays(start, w * 7);
    const first = [...Array(7)].map((_, i) => addDays(wStart, i)).find(d => d.endsWith('-01') && d >= jan1 && d <= dec31);
    months += `<span>${first ? parse(first).toLocaleDateString('en-GB', { month: 'short' }) : ''}</span>`;
    for (let i = 0; i < 7; i++) {
      const d = addDays(wStart, i);
      if (d === t) todayCol = w;
      if (d < jan1 || d > dec31) { cells += '<i class="out"></i>'; continue; }
      if (d > t) { cells += '<i class="future"></i>'; continue; }
      const n = counts[d] || 0;
      cells += `<i class="l${Math.min(n, 4)}${d === t ? ' today' : ''}${d === ui.hmPick ? ' picked' : ''}" data-hm="${d}" title="${fmt(d)}: ${n} logged"></i>`;
    }
  }
  return `<div class="hm-scroll" data-scroll-to="${todayCol}"><div class="hm-wrap"><div></div><div class="hm-months">${months}</div>
    <div class="hm-days"><span>Mon</span><span>Tue</span><span>Wed</span><span>Thu</span><span>Fri</span><span>Sat</span><span>Sun</span></div><div class="hm">${cells}</div></div></div>`;
}
function viewMateri() {
  const t = today(); const cards = cardsFrom(data.sessions); const L = ui.level;
  const mats = data.materials.filter(m => m.level === L);
  if (!mats.length) return `<section class="card"><div class="empty">No books for ${L} yet.<button class="btn sm primary" data-addmat="${L}">＋ Add book to ${L}</button>${!data.materials.length ? '<button class="btn sm" data-defaults>Use default books (Minna + Sou Matome N3)</button>' : ''}</div></section>`;
  return mats.map(m => {
    const s = summary(m, cards); const nu = nextUnit(m, cards); const open = ui.open.includes(m.id);
    const chips = open ? units(m).map(u => { const c = cards[m.id + ':' + u];
      const cls = c ? mastery(c) + (c.due < t ? ' over' : c.due === t ? ' due' : '') : u === nu ? 'next' : '';
      return `<button class="ch ${cls}" data-log="${m.id}:${u}" title="${uName()} ${u}${c ? ` · ${SCORES[c.score]} · review ${fmt(c.due)}` : ''}">${u}</button>`; }).join('') : '';
    return `<section class="card"><div class="row bookhead" data-toggle="${m.id}" role="button" tabindex="0" aria-expanded="${open}"><div class="bookname"><svg class="chev2${open ? ' open' : ''}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>${esc(m.name)}</div><div class="row" style="gap:8px"><span class="small muted">${s.done}/${m.count}${s.due ? ` · <b style="color:var(--accent)">${s.due} due</b>` : ''}</span><button class="del" data-delmat="${m.id}" aria-label="Delete ${esc(m.name)}" title="Delete book">${TRASH}</button></div></div>
      ${stackBar(s, m.count)}${open ? `<div class="chapters">${chips}</div>` : ''}</section>`;
  }).join('') + `<div><button class="btn sm" data-addmat="${L}">＋ Add book to ${L}</button></div>`;
}
function viewRiwayat() {
  const st = streaks(); const t = today(); const cy = parse(t).getFullYear();
  const all = levelSessions();
  const minY = Math.min(cy, ...all.map(x => +x.date.slice(0, 4)));
  if (!ui.year || ui.year > cy || ui.year < minY) ui.year = cy;
  const picked = ui.hmPick;
  const ss = all.filter(x => !picked || x.date === picked).sort((a, b) => b.date.localeCompare(a.date) || b.t - a.t);
  const limit = picked ? ss.length : ui.histLimit;
  let list = '', last = null;
  ss.slice(0, limit).forEach(x => {
    if (!picked && x.date !== last) { list += `<div class="lday">${fmt(x.date, { weekday: 'short', day: 'numeric', month: 'short', year: x.date.slice(0, 4) == cy ? undefined : 'numeric' })}</div>`; last = x.date; }
    list += `<div class="lrow"><i class="dot" style="background:var(--m-${mastery(x)})"></i><span class="grow">${esc(short(mat(x.m)))} · Ch ${x.ch}${x.note ? `<span class="lnote">${esc(x.note)}</span>` : ''}</span><span class="small muted">${SCORES[x.score]}</span></div>`;
  });
  return `<section class="card"><div class="row"><h2>Study calendar</h2><div class="yr"><button data-yr="-1" ${ui.year <= minY ? 'disabled' : ''} aria-label="Previous year">‹</button><b>${ui.year}</b><button data-yr="1" ${ui.year >= cy ? 'disabled' : ''} aria-label="Next year">›</button></div></div>${heatmap(ui.year)}</section>
  <section class="card"><div class="stats"><div class="stat"><b>🔥 ${st.cur}</b><span>current streak</span></div><div class="stat"><b>${st.best}</b><span>longest streak</span></div><div class="stat"><b>${st.totalDays}</b><span>total study days</span></div></div></section>
  <section class="card"><div class="row"><h2>${picked ? fmt(picked, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) : 'Study log'}</h2><div class="row" style="gap:10px">${picked ? '<button class="linkbtn" data-unpick>Show all</button>' : ''}<label class="finddate"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 9h18M8 2v4M16 2v4"/></svg>Find date<input type="date" id="pickDate" max="${t}" value="${picked || ''}" aria-label="Find a date"></label></div></div>
    <div class="log">${list || `<div class="muted small">${picked ? 'Nothing logged on this day.' : 'No entries yet.'}</div>`}</div>
    ${!picked && ss.length > limit ? '<button class="btn" data-more>Show more</button>' : ''}
    ${!picked && ss.length ? '<p class="note">Tip: tap a day in the calendar to see only that day.</p>' : ''}</section>`;
}

/* ---------- settings ---------- */
let devices = null, devLoading = false;
async function loadDevices() {
  if (devLoading || !Sync.user()) return; devLoading = true;
  try { devices = await Sync.listDevices(); } catch (e) { devices = devices || []; }
  devLoading = false; if (ui.tab === 'settings' && !form) render();
}
function syncLine() {
  const { status, info } = Sync.getStatus();
  if (status === 'syncing') return 'Syncing…';
  if (status === 'offline') return `Offline · last synced ${relTime(sync.lastSync)}`;
  if (status === 'error') return `Sync failed (${esc(info)}) · last synced ${relTime(sync.lastSync)}`;
  return `Synced ${relTime(sync.lastSync)}`;
}
function viewSettings() {
  const u = Sync.user(); const { status } = Sync.getStatus();
  const entries = data.sessions.filter(x => x.kind === 'bab').length;
  const srow = (title, sub, attr) => `<button class="srow" ${attr}><span class="grow"><span class="t">${title}</span><span class="small muted">${sub}</span></span><span class="chev">›</span></button>`;
  const opt = (key, title, desc, label) => `<div class="item"><div class="grow"><div class="t">${title}</div><div class="small muted">${desc}</div></div><button class="btn sm danger" data-reset="${key}">${label}</button></div>`;
  let account;
  if (status === 'unconfigured') account = '<div class="t">Sync is not set up</div><div class="small muted">Add your Firebase settings to firebase-config.js to sync between devices. Your data is saved on this device.</div>';
  else if (u) account = `<div class="row"><div style="min-width:0"><div class="t">${esc(u.email)}</div><div class="small muted">${syncLine()}</div></div><button class="btn" data-sync>Sync</button></div>
    <div><button class="linkbtn danger-t" data-signout>Sign out</button><div class="small muted">Removes data from this device; your data on the server stays safe.</div></div>`;
  else account = `<form class="auth" id="authForm"><div class="small muted">Sign in to sync your phone and laptop. Your data is saved on this device either way.</div>
    <input id="a-email" type="email" autocomplete="email" placeholder="Email" required>
    <input id="a-pw" type="password" autocomplete="current-password" placeholder="Password (min. 6 characters)" required>
    <div class="err" id="a-err" hidden></div>
    <div class="row2"><button class="btn primary" type="submit" data-auth="in">Sign in</button><button class="btn" type="submit" data-auth="up">Create account</button></div>
    <button type="button" class="linkbtn" data-forgot style="align-self:flex-start">Forgot password?</button></form>`;
  let devHtml = '';
  if (u) {
    if (devices === null) loadDevices();
    const list = (devices || []).slice();
    if (!list.some(d => d.id === sync.deviceId)) list.push({ id: sync.deviceId, name: sync.deviceName, icon: thisDevice()[0], lastSync: sync.lastSync });
    list.sort((a, b) => (b.id === sync.deviceId) - (a.id === sync.deviceId) || b.lastSync - a.lastSync);
    devHtml = `<div class="sec">Devices</div><section class="card list">${list.map(d => `<button class="devrow" data-device="${d.id}"><span class="dev">${d.icon || '💻'}</span><span class="grow"><span class="t">${esc(d.name || 'Device')}${d.id === sync.deviceId ? ' <span class="pill neutral">this device</span>' : ''}</span><span class="small muted" style="display:block">Last synced ${relTime(d.id === sync.deviceId ? sync.lastSync : d.lastSync)}</span></span><span class="chev">›</span></button>`).join('')}</section>`;
  }
  return `<div class="sec">Sync</div><section class="card">${account}</section>${devHtml}
  <div class="sec">Review speed</div><section class="card"><div class="seg3">${['slow', 'normal', 'fast'].map(k => `<button data-speed="${k}" aria-pressed="${speed() === k}">${k[0].toUpperCase() + k.slice(1)}</button>`).join('')}</div>
    <div class="small muted">Gaps: ${LADDERS[speed()].slice(0, 8).join(' → ')}${LADDERS[speed()].length > 8 ? ' → …' : ''} days. ${{ slow: 'More reviews, stronger memory.', normal: 'Balanced.', fast: 'Fewer reviews, more time for new chapters.' }[speed()]}</div></section>
  <div class="sec">Data</div><section class="card list">
    ${srow('Export CSV', `${entries} entries · open in Excel or Google Sheets`, 'data-export="csv"')}
    ${srow('Backup (JSON)', sync.lastBackup ? `Last backup ${relTime(sync.lastBackup)}` : 'Never backed up', 'data-export="json"')}
    ${srow('Restore from backup', 'Choose a backup .json file', 'data-restore')}</section>
  <p class="note" style="padding:0 4px">Back up once a month and keep the file in Google Drive.</p>
  <div class="sec">Reset</div><section class="card list">
    ${opt('progress', 'Reset progress', `Delete all study logs and exams${u ? ' on all your devices' : ''}. Your books stay.`, 'Reset')}
    ${opt('all', 'Delete everything', `Start from scratch, books included${u ? ', on all your devices' : ''}.`, 'Delete')}</section>
  <div class="ver">Nihongo Tracker ${VERSION}</div>`;
}
function toCSV() {
  const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = data.sessions.filter(x => x.kind === 'bab').sort((a, b) => a.date.localeCompare(b.date)).map(x => { const m = mat(x.m) || {}; return [x.date, m.level, m.name, x.ch, x.score, SCORES[x.score], x.note].map(q).join(','); });
  return '﻿' + ['date,level,book,chapter,score,label,note', ...rows].join('\n');
}
async function saveFile(name, text, type) {
  const file = new File([text], name, { type });
  try { if (navigator.canShare && navigator.canShare({ files: [file] }) && /iPhone|iPad|Android/.test(navigator.userAgent)) { await navigator.share({ files: [file], title: name }); return true; } }
  catch (e) { if (e.name === 'AbortError') return false; }
  const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000); return true;
}

/* ---------- modals ---------- */
let form = null;
const sameDay = (m, ch, date) => data.sessions.find(x => x.kind === 'bab' && x.m === m && x.ch === ch && x.date === date);
function prefill() { const x = sameDay(form.m, form.ch, form.date); if (x) { form.score = x.score; form.note = x.note || ''; } }
function renderModal() {
  const el = document.getElementById('modal');
  if (!form) { el.innerHTML = ''; return; }
  const head = title => `<div class="row"><h3>${title}</h3><button type="button" class="btn sm" data-close>Close</button></div>`;
  const wrap = (label, inner) => `<div class="overlay" data-close><form class="sheet${form._shown ? ' noanim' : ''}" id="f" role="dialog" aria-label="${label}">${inner}</form></div>`;
  if (form.kind === 'log') {
    const m = mat(form.m); if (!m) { form = null; el.innerHTML = ''; return; }
    const same = sameDay(form.m, form.ch, form.date);
    const prior = cardsFrom(data.sessions.filter(s => s.date <= form.date && s !== same))[form.m + ':' + form.ch];
    const nc = nextCard(prior, form.score, form.date);
    const hist = data.sessions.filter(s => s.kind === 'bab' && s.m === form.m && s.ch === form.ch).sort((a, b) => b.date.localeCompare(a.date));
    el.innerHTML = wrap('Log study', `${head(`${esc(m.name)}<br><span style="color:var(--accent)">${uName()} ${form.ch}</span>`)}
      ${hist.length ? `<div class="hist"><div class="hlist">${hist.map(s => `<span><i class="dot" style="background:var(--m-${mastery(s)})"></i> ${fmt(s.date, { day: 'numeric', month: 'short', year: 'numeric' })} · ${SCORES[s.score]}${s.note ? ` · <span class="muted">${esc(s.note)}</span>` : ''}<button type="button" class="x" data-delsess="${s.id}" aria-label="Delete this entry">×</button></span>`).join('')}</div></div>` : '<div class="src">Not studied yet</div>'}
      <div class="field"><label for="f-d">Date</label><input id="f-d" type="date" value="${form.date}" max="${today()}"></div>
      <div class="field"><label>How well do you know it?</label><div class="scores">${[1, 2, 3, 4, 5].map(s => `<button type="button" data-score="${s}" aria-pressed="${s === form.score}"><b>${s}</b><span>${SCORES[s]}</span></button>`).join('')}</div></div>
      <div class="field"><label for="f-n">Note (optional)</label><textarea id="f-n" rows="2" placeholder="e.g. mixing up ～わけだ vs ～はずだ">${esc(form.note)}</textarea></div>
      <div class="preview">${prior ? `Review #${prior.reps} for this chapter.` : 'First time studying this.'}<br>Next review: <b>${fmt(nc.due, { weekday: 'long', day: 'numeric', month: 'long' })}</b> (${rel(diff(today(), nc.due))})</div>
      ${same ? `<p class="note">Already logged on this day (${SCORES[same.score]}). Saving will update it.</p>` : ''}
      <button class="btn primary" type="submit">${same ? 'Update' : 'Save'}</button>`);
  } else if (form.kind === 'mat') {
    el.innerHTML = wrap('Add book', `${head(`Add ${form.level} book`)}
      <div class="field"><label for="m-n">Book name</label><input id="m-n" placeholder="e.g. Sou Matome N2 Kanji" required></div>
      <div class="two"><div class="field"><label for="m-s">First chapter</label><input id="m-s" type="number" min="1" value="1"></div>
      <div class="field"><label for="m-c">Number of chapters</label><input id="m-c" type="number" min="1" max="300" value="25"></div></div>
      <button class="btn primary" type="submit">Add</button>`);
  } else if (form.kind === 'exam') {
    const t = today(); const y = parse(t).getFullYear();
    const sug = [firstSunday(y, 6), firstSunday(y, 11), firstSunday(y + 1, 6), firstSunday(y + 1, 11)].find(d => d >= t);
    el.innerHTML = wrap('Add exam', `${head(`Add ${form.level} exam`)}
      <div class="field"><label for="e-d">Date</label><input id="e-d" type="date" value="${sug}" min="${t}"></div>
      <button class="btn primary" type="submit">Add</button>`);
  } else if (form.kind === 'device') {
    const isMe = form.id === sync.deviceId;
    el.innerHTML = wrap('Device', `${head('Device')}
      <div class="field"><label for="d-n">Name</label><input id="d-n" value="${esc(form.name)}" maxlength="40" required></div>
      <button class="btn primary" type="submit">Save name</button>
      ${isMe ? '<p class="note">This is the device you are using now.</p>' : '<button type="button" class="btn danger" data-rmdevice>Remove from list</button><p class="note">Removing only hides it here. If that device syncs again, it shows up again.</p>'}`);
  }
  form._shown = true;
}

/* ---------- render ---------- */
function render() {
  if (!LEVELS.includes(ui.level)) ui.level = activeLevel() || 'N5';
  if (!['today', 'materi', 'riwayat', 'settings'].includes(ui.tab)) ui.tab = 'today';
  const lv = document.getElementById('levels');
  lv.innerHTML = LEVELS.map(L => `<button class="chip" data-level="${L}" aria-pressed="${ui.level === L}">${L}</button>`).join('');
  lv.hidden = ui.tab === 'settings';
  document.querySelectorAll('#tabs button, header [data-tab]').forEach(b => b.setAttribute('aria-current', b.dataset.tab === ui.tab ? 'page' : 'false'));
  const v = document.getElementById('view');
  const keepAuth = ui.tab === 'settings' && document.getElementById('a-email') ? [document.getElementById('a-email').value, document.getElementById('a-pw').value] : null;
  v.innerHTML = { today: viewToday, materi: viewMateri, riwayat: viewRiwayat, settings: viewSettings }[ui.tab]();
  v.className = 'col gutter view-' + ui.tab;
  if (keepAuth && document.getElementById('a-email')) { document.getElementById('a-email').value = keepAuth[0]; document.getElementById('a-pw').value = keepAuth[1]; }
  if (ui.tab === 'settings') { let g = null; [...v.children].forEach(k => { if (k.classList.contains('sec')) { g = document.createElement('div'); g.className = 'grp'; v.insertBefore(g, k); } if (g) g.appendChild(k); }); }
  document.querySelectorAll('[data-scroll-to]').forEach(e => e.scrollLeft = +e.dataset.scrollTo * 15 - e.clientWidth + 90);
}
function toast(msg) { const t = document.getElementById('toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast.h); toast.h = setTimeout(() => t.hidden = true, 3000); }
function closeModal() { form = null; renderModal(); }
function armed(b, label) { if (b.dataset.armed) return true; b.dataset.armed = 1; b.textContent = label; return false; }
function setSpin(on) { document.querySelectorAll('[data-sync]').forEach(b => b.classList.toggle('spin', on)); }

/* ---------- events ---------- */
document.addEventListener('click', async e => {
  const q = s => e.target.closest(s); let b;
  if ((b = q('[data-tab]'))) { ui.tab = b.dataset.tab; ui.hmPick = null; ui.histLimit = 15; if (ui.tab === 'settings') devices = null; save(); render(); scrollTo(0, 0); }
  else if ((b = q('[data-level]'))) { ui.level = b.dataset.level; ui.fcPick = null; save(); render(); }
  else if ((b = q('[data-log]'))) { const [m, ch] = b.dataset.log.split(':'); form = { kind: 'log', m, ch: +ch, date: today(), score: 4, note: '' }; prefill(); renderModal(); }
  else if (q('[data-sync]')) {
    if (!Sync.configured()) { toast('Sync is not set up yet.'); return; }
    if (!Sync.user()) { ui.tab = 'settings'; render(); toast('Sign in to sync your devices.'); return; }
    const ok = await Sync.syncNow(); devices = null; render(); toast(ok ? 'Synced ✓' : 'Sync failed. Check your connection.');
  }
  else if ((b = q('[data-signout]'))) {
    if (!armed(b, 'Tap again to sign out')) return;
    await Sync.signOut();
    data = blank(); const keepId = sync.deviceId, keepName = sync.deviceName;
    sync = { deviceId: keepId, deviceName: keepName, lastPull: 0, lastSync: 0, lastBackup: 0, dirty: [], tomb: [], dirtyMeta: false, first: true };
    devices = null; save(); render(); toast('Signed out');
  }
  else if (q('[data-forgot]')) {
    const email = document.getElementById('a-email').value.trim(); const err = document.getElementById('a-err');
    if (!email) { err.hidden = false; err.textContent = 'Type your email first, then tap "Forgot password?".'; return; }
    try { await Sync.resetPassword(email); toast('Password reset email sent.'); } catch (er) { err.hidden = false; err.textContent = Sync.authMessage(er); }
  }
  else if ((b = q('[data-device]'))) { const d = (devices || []).find(x => x.id === b.dataset.device) || { id: sync.deviceId, name: sync.deviceName }; form = { kind: 'device', id: d.id, name: d.name || '' }; renderModal(); }
  else if ((b = q('[data-rmdevice]'))) { if (!armed(b, 'Tap again to remove')) return; try { await Sync.removeDevice(form.id); devices = (devices || []).filter(x => x.id !== form.id); closeModal(); render(); toast('Device removed'); } catch (er) { toast('Could not remove. Check your connection.'); } }
  else if ((b = q('[data-export]'))) {
    if (b.dataset.export === 'csv') await saveFile(`nihongo-tracker-${today()}.csv`, toCSV(), 'text/csv');
    else { const ok = await saveFile(`nihongo-tracker-backup-${today()}.json`, JSON.stringify({ app: 'nihongo-tracker', version: 1, exported: new Date().toISOString(), materials: data.materials, sessions: data.sessions, exams: data.exams, settings: data.settings }, null, 1), 'application/json'); if (ok) { sync.lastBackup = Date.now(); save(); render(); } }
  }
  else if (q('[data-restore]')) document.getElementById('restoreFile').click();
  else if ((b = q('[data-reset]'))) {
    if (!armed(b, 'Sure? Tap again')) return;
    data.sessions.map(s => s.id).forEach(dropSession);
    data.exams = []; if (b.dataset.reset === 'all') data.materials = [];
    touchMeta(); commit(); toast('Data reset');
  }
  else if (q('[data-defaults]')) { const ids = new Set(data.materials.map(m => m.id)); data.materials.push(...defaultMaterials().filter(m => !ids.has(m.id))); touchMeta(); commit(); }
  else if ((b = q('[data-delmat]'))) {
    if (!armed(b, 'Tap again to delete this book and its logs')) return;
    const id = b.dataset.delmat; data.materials = data.materials.filter(m => m.id !== id); data.sessions.filter(s => s.m === id).map(s => s.id).forEach(dropSession);
    touchMeta(); commit(); toast('Book deleted');
  }
  else if ((b = q('[data-delsess]'))) { if (!armed(b, 'Delete?')) return; dropSession(b.dataset.delsess); form.score = 4; form.note = ''; prefill(); save(); renderModal(); render(); Sync.schedule(); toast('Entry deleted'); }
  else if ((b = q('[data-hm]'))) { const sc = document.querySelector('.hm-scroll').scrollLeft; ui.hmPick = ui.hmPick === b.dataset.hm ? null : b.dataset.hm; render(); document.querySelector('.hm-scroll').scrollLeft = sc; }
  else if ((b = q('[data-speed]'))) { data.settings = Object.assign({}, data.settings, { speed: b.dataset.speed }); touchMeta(); commit(); toast(`Review speed: ${b.dataset.speed}. Schedules updated.`); }
  else if ((b = q('[data-toggle]'))) { const id = b.dataset.toggle; ui.open = ui.open.includes(id) ? ui.open.filter(x => x !== id) : [...ui.open, id]; save(); render(); }
  else if ((b = q('[data-fcday]'))) { ui.fcPick = ui.fcPick === b.dataset.fcday ? null : b.dataset.fcday; render(); }
  else if (q('.finddate') && !e.target.matches('input')) { const i = document.getElementById('pickDate'); try { i.showPicker(); } catch (er) { i.focus(); } }
  else if (q('[data-unpick]')) { ui.hmPick = null; render(); }
  else if ((b = q('[data-yr]'))) { ui.year += +b.dataset.yr; ui.hmPick = null; render(); }
  else if (q('[data-more]')) { ui.histLimit += 30; render(); }
  else if ((b = q('[data-addmat]'))) { form = { kind: 'mat', level: b.dataset.addmat }; renderModal(); }
  else if (q('[data-addexam]')) { form = { kind: 'exam', level: ui.level }; renderModal(); }
  else if ((b = q('[data-delexam]'))) { if (!armed(b, 'Tap again to delete')) return; data.exams = data.exams.filter(x => x.id !== b.dataset.delexam); touchMeta(); commit(); toast('Exam deleted'); }
  else if ((b = q('[data-score]'))) { form.score = +b.dataset.score; form.note = document.getElementById('f-n').value; renderModal(); }
  else if (e.target.matches('[data-close]')) closeModal();
});
document.addEventListener('change', e => {
  if (e.target.id === 'pickDate') { if (e.target.value) { ui.hmPick = e.target.value; ui.year = +e.target.value.slice(0, 4); render(); } return; }
  if (e.target.id === 'restoreFile' && e.target.files[0]) {
    const r = new FileReader();
    r.onload = () => {
      try {
        const d = JSON.parse(r.result); if (!Array.isArray(d.materials) || !Array.isArray(d.sessions)) throw new Error('bad');
        const keep = new Set(d.sessions.map(s => s.id));
        data.sessions.filter(s => !keep.has(s.id)).map(s => s.id).forEach(dropSession);
        data.sessions = d.sessions.filter(s => s.kind === 'bab'); data.sessions.forEach(touchSession);
        data.materials = d.materials; data.exams = d.exams || []; data.settings = Object.assign({ speed: 'normal' }, d.settings);
        touchMeta(); commit(); toast('Backup restored ✓');
      } catch (er) { toast('This file is not a valid backup.'); }
      e.target.value = '';
    };
    r.readAsText(e.target.files[0]); return;
  }
  if (!form || form.kind !== 'log' || e.target.id !== 'f-d') return;
  form.note = document.getElementById('f-n').value; form.date = e.target.value || today(); prefill(); renderModal();
});
document.addEventListener('submit', async e => {
  e.preventDefault();
  if (e.target.id === 'authForm') {
    const mode = (e.submitter && e.submitter.dataset.auth) || 'in';
    const email = document.getElementById('a-email').value.trim(), pw = document.getElementById('a-pw').value, err = document.getElementById('a-err');
    err.hidden = true;
    try { if (mode === 'up') await Sync.signUp(email, pw); else await Sync.signIn(email, pw); toast('Signed in ✓'); }
    catch (er) { err.hidden = false; err.textContent = Sync.authMessage(er); }
    return;
  }
  if (!form) return;
  if (form.kind === 'log') {
    const note = document.getElementById('f-n').value.trim();
    let s = sameDay(form.m, form.ch, form.date); // 1 chapter = maksimal 1 catatan per hari
    if (s) { s.score = form.score; s.note = note; }
    else { s = { id: uid(), t: Date.now(), kind: 'bab', date: form.date, m: form.m, ch: form.ch, score: form.score, note }; data.sessions.push(s); }
    touchSession(s);
    const c = cardsFrom(data.sessions)[s.m + ':' + s.ch];
    toast(`Saved. Next review of ${uName()} ${s.ch}: ${fmt(c.due)} (${rel(diff(today(), c.due))})`);
  } else if (form.kind === 'mat') {
    const name = document.getElementById('m-n').value.trim(); if (!name) { document.getElementById('m-n').focus(); return; }
    data.materials.push({ id: uid(), level: form.level, name, start: Math.max(1, +document.getElementById('m-s').value || 1), count: Math.min(300, Math.max(1, +document.getElementById('m-c').value || 1)) });
    touchMeta(); toast('Book added');
  } else if (form.kind === 'exam') {
    const date = document.getElementById('e-d').value; if (!date) return;
    data.exams = data.exams.filter(x => !(x.level === form.level && x.date >= today()));
    data.exams.push({ id: uid(), level: form.level, date, name: `JLPT ${form.level}` });
    touchMeta(); toast('Exam added');
  } else if (form.kind === 'device') {
    const name = document.getElementById('d-n').value.trim(); if (!name) return;
    if (form.id === sync.deviceId) sync.deviceName = name;
    try { await Sync.renameDevice(form.id, name); devices = (devices || []).map(x => x.id === form.id ? { ...x, name } : x); toast('Name saved'); }
    catch (er) { toast(form.id === sync.deviceId ? 'Name saved. It will update on the next sync.' : 'Could not save. Check your connection.'); }
  } else return;
  form = null; renderModal(); commit();
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && form) closeModal();
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches && e.target.matches('[data-toggle]')) { e.preventDefault(); e.target.click(); }
});
// Saat aplikasi dibuka lagi: segarkan tanggal dan sync
document.addEventListener('visibilitychange', () => { if (document.hidden) return; if (!form) render(); if (Sync.user() && Date.now() - sync.lastSync > 60e3) Sync.schedule(300); });
window.addEventListener('online', () => Sync.schedule(500));

/* ---------- start ---------- */
render();
Sync.init({
  getData: () => data,
  getSync: () => sync,
  deviceIcon: () => thisDevice()[0],
  saveLocal: () => { save(); if (!form) render(); },
  onStatus: s => { setSpin(s === 'syncing'); if (ui.tab === 'settings' && !form && !document.activeElement?.closest?.('#authForm')) render(); },
  onAuth: u => {
    if (u && data.owner && data.owner !== u.uid) { // akun lain: mulai bersih
      data = blank(); Object.assign(sync, { lastPull: 0, lastSync: 0, dirty: [], tomb: [], dirtyMeta: false });
    }
    if (u && data.owner !== u.uid) { // login pertama di perangkat ini: data lokal ikut dikirim
      data.owner = u.uid; sync.first = true; sync.lastPull = 0;
      data.sessions.forEach(s => { if (!sync.dirty.includes(s.id)) sync.dirty.push(s.id); });
    }
    devices = null; save(); render();
  },
});
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
