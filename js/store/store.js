// =============================================================================
// store/store.js — the swappable persistence layer.
//
// Everything user-owned (favorites, settings) goes through a `Store` backed by a
// `StorageAdapter`. The adapter interface is intentionally ASYNC so that the
// localStorage implementation today can be replaced by a remote/sync backend
// tomorrow WITHOUT changing any caller:
//
//   class MyApiAdapter extends StorageAdapter {
//     async getItem(k) { return (await fetch(`/kv/${k}`)).text(); }
//     async setItem(k, v) { await fetch(`/kv/${k}`, {method:'PUT', body:v}); }
//     ...
//   }
//   setAdapter(new MyApiAdapter());
//
// The rest of the app only ever talks to the exported `store` + the model
// modules (settings.js / favorites.js), so swapping the adapter is a one-liner.
// =============================================================================

// ---- Adapter interface (override these) ------------------------------------
export class StorageAdapter {
  /** @returns {Promise<string|null>} */ async getItem(_key) { throw new Error('not implemented'); }
  /** @returns {Promise<void>}       */ async setItem(_key, _value) { throw new Error('not implemented'); }
  /** @returns {Promise<void>}       */ async removeItem(_key) { throw new Error('not implemented'); }
  /** @returns {Promise<string[]>}   */ async keys() { throw new Error('not implemented'); }
}

// ---- Default adapter: localStorage -----------------------------------------
export class LocalStorageAdapter extends StorageAdapter {
  constructor(namespace = 'sb:data:') {
    super();
    this.ns = namespace;
  }
  _k(key) { return this.ns + key; }

  async getItem(key) {
    return localStorage.getItem(this._k(key));
  }
  async setItem(key, value) {
    localStorage.setItem(this._k(key), value);
  }
  async removeItem(key) {
    localStorage.removeItem(this._k(key));
  }
  async keys() {
    const out = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(this.ns)) out.push(k.slice(this.ns.length));
    }
    return out;
  }
}

// ---- Store: JSON convenience on top of an adapter --------------------------
export class Store {
  constructor(adapter) { this.adapter = adapter; }

  async get(key, fallback = null) {
    const raw = await this.adapter.getItem(key);
    if (raw == null) return fallback;
    try { return JSON.parse(raw); } catch { return fallback; }
  }
  async set(key, value) {
    await this.adapter.setItem(key, JSON.stringify(value));
  }
  async remove(key) {
    await this.adapter.removeItem(key);
  }
  async keys() {
    return this.adapter.keys();
  }
}

// Singleton used across the app. Swap the backend with setAdapter().
export const store = new Store(new LocalStorageAdapter());

export function setAdapter(adapter) {
  store.adapter = adapter;
}
