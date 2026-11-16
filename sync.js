// Sync dengan Firebase (Auth email/password + Firestore).
// Data utama selalu ada di perangkat (localStorage). Firestore hanya tempat sinkron antar perangkat.
//
// Struktur Firestore:
//   users/{uid}/meta/state        -> { materials, exams, settings, metaU }
//   users/{uid}/sessions/{id}     -> satu catatan belajar (atau { deleted: true })
//   users/{uid}/devices/{id}      -> { name, icon, lastSync }
// Setiap tulisan diberi `srv` (waktu server), sehingga perangkat lain cukup menarik
// catatan yang berubah sejak tarikan terakhir. Hemat kuota baca.

import { firebaseConfig } from './firebase-config.js';

const CDN = 'https://www.gstatic.com/firebasejs/10.12.2';
let fb = null, auth = null, db = null, current = null, hooks = null;
let timer = null, busy = false, again = false, status = 'off', statusInfo = '';

export const configured = () => !!(firebaseConfig && firebaseConfig.apiKey && !/^YOUR/.test(firebaseConfig.apiKey));
export const user = () => current;
export const getStatus = () => ({ status, info: statusInfo });

function setStatus(s, info = '') { status = s; statusInfo = info; hooks && hooks.onStatus(s, info); }

async function loadSdk() {
  if (fb) return fb;
  const [a, au, fs] = await Promise.all([
    import(`${CDN}/firebase-app.js`), import(`${CDN}/firebase-auth.js`), import(`${CDN}/firebase-firestore.js`),
  ]);
  fb = { ...a, ...au, ...fs };
  return fb;
}

export async function init(h) {
  hooks = h;
  if (!configured()) { setStatus('unconfigured'); return; }
  setStatus('loading');
  try {
    const f = await loadSdk();
    const app = f.initializeApp(firebaseConfig);
    auth = f.getAuth(app);
    db = f.getFirestore(app);
    f.onAuthStateChanged(auth, u => {
      current = u;
      hooks.onAuth(u);
      if (u) syncNow(); else setStatus('signedout');
    });
  } catch (e) {
    console.warn('Firebase could not load', e);
    setStatus('offline', 'Could not reach the sync server.');
  }
}

export function schedule(delay = 2500) {
  if (!current) return;
  clearTimeout(timer);
  timer = setTimeout(() => syncNow(), delay);
}

function mergeSession(d, s, r) {
  if (s.tomb.includes(r.id)) return;
  const i = d.sessions.findIndex(x => x.id === r.id);
  const local = i >= 0 ? d.sessions[i] : null;
  if (local && s.dirty.includes(r.id) && (local.u || 0) > (r.u || 0)) return; // perubahan lokal lebih baru
  if (r.deleted) { if (i >= 0) d.sessions.splice(i, 1); return; }
  const { srv, ...clean } = r;
  if (i >= 0) d.sessions[i] = clean; else d.sessions.push(clean);
}

function unionById(remote = [], local = []) {
  const ids = new Set(remote.map(x => x.id));
  return [...remote, ...local.filter(x => !ids.has(x.id))];
}

export async function syncNow() {
  if (!current) { setStatus(configured() ? 'signedout' : 'unconfigured'); return false; }
  if (busy) { again = true; return false; }
  busy = true; setStatus('syncing');
  const f = fb, d = hooks.getData(), s = hooks.getSync(), uid = current.uid;
  const ref = (...p) => f.doc(db, 'users', uid, ...p);
  try {
    const metaRef = ref('meta', 'state');
    // Sinkron pertama di perangkat ini: gabungkan daftar buku & ujian lokal dengan yang di server
    if (s.first) {
      const r = await f.getDoc(metaRef);
      if (r.exists()) {
        const m = r.data();
        d.materials = unionById(m.materials, d.materials);
        d.exams = unionById(m.exams, d.exams);
        d.settings = Object.assign({}, d.settings, m.settings);
      }
      d.metaU = Date.now(); s.dirtyMeta = true;
    }

    // 1) Kirim perubahan lokal
    const dirtyU = {}; s.dirty.forEach(id => { const x = d.sessions.find(y => y.id === id); dirtyU[id] = x ? x.u : null; });
    const tomb = [...s.tomb], pushMeta = s.dirtyMeta, metaU = d.metaU;
    const writes = [];
    Object.keys(dirtyU).forEach(id => { const x = d.sessions.find(y => y.id === id); if (x) writes.push([ref('sessions', id), { ...x, srv: f.serverTimestamp() }]); });
    tomb.forEach(id => writes.push([ref('sessions', id), { id, deleted: true, u: Date.now(), srv: f.serverTimestamp() }]));
    if (pushMeta) writes.push([metaRef, { materials: d.materials, exams: d.exams, settings: d.settings, metaU: d.metaU || Date.now(), srv: f.serverTimestamp() }]);
    for (let i = 0; i < writes.length; i += 400) {
      const b = f.writeBatch(db);
      writes.slice(i, i + 400).forEach(([r, v]) => b.set(r, v));
      await b.commit();
    }
    s.dirty = s.dirty.filter(id => !(id in dirtyU) || (d.sessions.find(y => y.id === id) || {}).u !== dirtyU[id]);
    s.tomb = s.tomb.filter(id => !tomb.includes(id));
    if (pushMeta && d.metaU === metaU) s.dirtyMeta = false;

    // 2) Tarik catatan yang berubah sejak tarikan terakhir
    const q = f.query(f.collection(db, 'users', uid, 'sessions'), f.where('srv', '>=', f.Timestamp.fromMillis(s.lastPull || 0)), f.orderBy('srv'));
    const snap = await f.getDocs(q);
    let max = s.lastPull || 0;
    snap.forEach(ds => { const r = ds.data(); const ms = r.srv && r.srv.toMillis ? r.srv.toMillis() : 0; if (ms > max) max = ms; mergeSession(d, s, r); });

    // 3) Tarik daftar buku, ujian, pengaturan
    const mr = await f.getDoc(metaRef);
    if (mr.exists()) {
      const m = mr.data();
      if (!s.dirtyMeta && (m.metaU || 0) > (d.metaU || 0)) {
        d.materials = m.materials || []; d.exams = m.exams || []; d.settings = Object.assign({}, d.settings, m.settings); d.metaU = m.metaU;
      }
    }

    // 4) Catat perangkat ini
    await f.setDoc(ref('devices', s.deviceId), { name: s.deviceName, icon: hooks.deviceIcon(), lastSync: f.serverTimestamp() }, { merge: true });

    s.lastPull = max; s.lastSync = Date.now(); s.first = false;
    hooks.saveLocal();
    setStatus('synced');
    return true;
  } catch (e) {
    console.warn('Sync failed', e);
    hooks.saveLocal();
    setStatus(navigator.onLine ? 'error' : 'offline', e.code || e.message || '');
    return false;
  } finally {
    busy = false;
    if (again) { again = false; schedule(500); }
  }
}

const AUTH_MSG = {
  'auth/invalid-credential': 'Wrong email or password.',
  'auth/wrong-password': 'Wrong email or password.',
  'auth/user-not-found': 'No account with this email. Tap "Create account".',
  'auth/email-already-in-use': 'This email already has an account. Sign in instead.',
  'auth/weak-password': 'Password needs at least 6 characters.',
  'auth/invalid-email': 'That email address does not look right.',
  'auth/missing-password': 'Enter your password.',
  'auth/network-request-failed': 'No internet connection. Try again when you are online.',
  'auth/too-many-requests': 'Too many attempts. Wait a few minutes and try again.',
  'auth/operation-not-allowed': 'Email sign-in is not turned on in Firebase yet (Authentication → Sign-in method).',
};
export const authMessage = e => AUTH_MSG[e && e.code] || (e && e.message) || 'Something went wrong.';

export async function signIn(email, pw) { await loadSdk(); await fb.signInWithEmailAndPassword(auth, email, pw); }
export async function signUp(email, pw) { await loadSdk(); await fb.createUserWithEmailAndPassword(auth, email, pw); }
export async function resetPassword(email) { await loadSdk(); await fb.sendPasswordResetEmail(auth, email); }
export async function signOut() { if (auth) await fb.signOut(auth); }

export async function listDevices() {
  if (!current) return [];
  const snap = await fb.getDocs(fb.collection(db, 'users', current.uid, 'devices'));
  return snap.docs.map(x => { const v = x.data(); return { id: x.id, name: v.name, icon: v.icon, lastSync: v.lastSync && v.lastSync.toMillis ? v.lastSync.toMillis() : 0 }; });
}
export async function renameDevice(id, name) { await fb.setDoc(fb.doc(db, 'users', current.uid, 'devices', id), { name }, { merge: true }); }
export async function removeDevice(id) { await fb.deleteDoc(fb.doc(db, 'users', current.uid, 'devices', id)); }
