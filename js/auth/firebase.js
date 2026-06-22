// =============================================================================
// auth/firebase.js — optional "Sign in with Google" + cloud sync.
//
// Enabled only when FIREBASE_CONFIG is set in config.js. The Firebase SDK is
// loaded lazily from the CDN (so users who never sign in don't download it).
//
// Sync works through the app's swappable StorageAdapter: when signed in we point
// the store at a FirestoreAdapter (one doc per user at users/{uid}); on sign-out
// we revert to localStorage. No build step / npm needed.
// =============================================================================

import { FIREBASE_CONFIG } from '../config.js';
import { StorageAdapter } from '../store/store.js';

const SDK = '10.12.0';
let _sdk = null; let _app = null; let _auth = null; let _db = null;

export function isConfigured() {
  return !!(FIREBASE_CONFIG && FIREBASE_CONFIG.apiKey && FIREBASE_CONFIG.projectId);
}

// Lazy-load + init the Firebase SDK from the CDN (once).
async function load() {
  if (_sdk) return _sdk;
  const base = `https://www.gstatic.com/firebasejs/${SDK}`;
  const [appM, authM, fsM] = await Promise.all([
    import(`${base}/firebase-app.js`),
    import(`${base}/firebase-auth.js`),
    import(`${base}/firebase-firestore.js`),
  ]);
  _app = appM.initializeApp(FIREBASE_CONFIG);
  _auth = authM.getAuth(_app);
  _db = fsM.getFirestore(_app);
  _sdk = { appM, authM, fsM };
  return _sdk;
}

// Subscribe to auth changes (fires once on load with the restored user or null).
export async function initAuth(onUser) {
  if (!isConfigured()) return;
  try {
    const { authM } = await load();
    authM.onAuthStateChanged(_auth, (user) => onUser(user || null));
  } catch (e) {
    console.warn('[auth] init failed', e);
  }
}

export async function signInGoogle() {
  const { authM } = await load();
  const provider = new authM.GoogleAuthProvider();
  return authM.signInWithPopup(_auth, provider);
}

export async function signOutUser() {
  const { authM } = await load();
  return authM.signOut(_auth);
}

// Firestore-backed adapter: stores the user's kv pairs as fields on users/{uid}.
// Values are already JSON strings (the Store serializes), so we store them as-is.
export class FirestoreAdapter extends StorageAdapter {
  constructor(uid) { super(); this.uid = uid; }
  async _ref() { const { fsM } = await load(); return fsM.doc(_db, 'users', this.uid); }
  async _data() {
    const { fsM } = await load();
    const snap = await fsM.getDoc(await this._ref());
    return snap.exists() ? (snap.data() || {}) : {};
  }
  async getItem(key) { const v = (await this._data())[key]; return v == null ? null : v; }
  async setItem(key, value) { const { fsM } = await load(); await fsM.setDoc(await this._ref(), { [key]: value }, { merge: true }); }
  async removeItem(key) { const { fsM } = await load(); await fsM.setDoc(await this._ref(), { [key]: fsM.deleteField() }, { merge: true }); }
  async keys() { return Object.keys(await this._data()); }
}
