// =============================================================================
// store/settings.js — app settings model (theme, active view, proxy override…).
//
// Kept in memory for synchronous reads during render; hydrated from + written
// through to the swappable `store`. http.js reads getSettings() on every fetch,
// so the in-memory object is initialised with defaults at import time (before
// the async load completes) to avoid any race.
// =============================================================================

import { store } from './store.js';
import { APP_CONFIG } from '../config.js';

const KEY = 'settings';

const DEFAULTS = {
  theme: 'dark',          // 'dark' | 'light'
  view: 'today',          // 'today' | 'upcoming'
  favoritesOnly: false,   // global "Favorites only" filter
  regionCode: APP_CONFIG.defaultRegion, // broadcast/location region (see REGIONS)
  useProxy: APP_CONFIG.useProxy,     // runtime override of the config flag
  proxyBase: APP_CONFIG.proxyBase,   // runtime override of the proxy URL
  seeded: false,          // have we applied first-run default follows yet?
};

// In-memory snapshot (always defined).
let current = { ...DEFAULTS };
const listeners = new Set();

export function getSettings() { return current; }

export function onSettingsChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit() { listeners.forEach((fn) => fn(current)); }

// Load persisted settings via the (async) adapter, merging over defaults.
export async function loadSettings() {
  const saved = await store.get(KEY, {});
  current = { ...DEFAULTS, ...saved };
  return current;
}

// Patch + persist + notify.
export async function updateSettings(patch) {
  current = { ...current, ...patch };
  await store.set(KEY, current);
  emit();
  return current;
}
