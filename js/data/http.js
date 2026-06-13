// =============================================================================
// data/http.js — network layer with:
//   • optional CORS proxy (single runtime flag)
//   • per-request timeout (AbortController)
//   • offline-tolerant localStorage cache: on any network failure we serve the
//     last-good payload and mark it `stale` so the UI can show a banner.
//
// This module is deliberately separate from the user-data store: the response
// cache is ALWAYS local (it's just a perf/offline aid), whereas favorites/
// settings live in the swappable store (see store/). Keeping them apart means a
// future sync backend never has to deal with cached API blobs.
// =============================================================================

import { APP_CONFIG } from '../config.js';
import { getSettings } from '../store/settings.js';

const CACHE_PREFIX = 'sb:cache:';

// Typed error so the UI can show the right message (and hint at the proxy).
export class FetchError extends Error {
  constructor(message, { kind, status, canRetryWithProxy = false } = {}) {
    super(message);
    this.name = 'FetchError';
    this.kind = kind;            // 'http' | 'network' | 'timeout'
    this.status = status;        // HTTP status when kind === 'http'
    this.canRetryWithProxy = canRetryWithProxy;
  }
}

// Resolve the effective request URL based on the current proxy setting.
// Proxy convention: GET `${proxyBase}/?url=<encoded full ESPN url>`.
// Both the Cloudflare Worker and the Node proxy in /proxy implement this.
function resolveUrl(targetUrl) {
  const s = getSettings();
  const useProxy = s.useProxy ?? APP_CONFIG.useProxy;
  const base = (s.proxyBase || APP_CONFIG.proxyBase || '').replace(/\/$/, '');
  if (useProxy && base) {
    return `${base}/?url=${encodeURIComponent(targetUrl)}`;
  }
  return targetUrl;
}

function readCache(cacheKey) {
  if (!cacheKey) return null;
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + cacheKey);
    if (!raw) return null;
    return JSON.parse(raw); // { data, fetchedAt }
  } catch {
    return null;
  }
}

function writeCache(cacheKey, data) {
  if (!cacheKey) return;
  try {
    localStorage.setItem(CACHE_PREFIX + cacheKey, JSON.stringify({ data, fetchedAt: Date.now() }));
  } catch (e) {
    // Quota exceeded — drop the oldest cache entries and retry once.
    pruneCache();
    try {
      localStorage.setItem(CACHE_PREFIX + cacheKey, JSON.stringify({ data, fetchedAt: Date.now() }));
    } catch { /* give up silently; cache is best-effort */ }
  }
}

// Crude LRU-ish prune: remove ~half of cache entries when quota is hit.
function pruneCache() {
  const keys = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith(CACHE_PREFIX)) keys.push(k);
  }
  keys.slice(0, Math.ceil(keys.length / 2)).forEach((k) => localStorage.removeItem(k));
}

/**
 * Fetch JSON with caching + offline fallback.
 * @returns {Promise<{data:any, fetchedAt:number, stale:boolean, source:'network'|'cache', error?:FetchError}>}
 *   On total failure with no cache, throws FetchError.
 */
export async function getJSON(targetUrl, { cacheKey, ttlMs = APP_CONFIG.scoreboardTtlMs, timeoutMs = APP_CONFIG.requestTimeoutMs } = {}) {
  const url = resolveUrl(targetUrl);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
      // We never send credentials to ESPN; keeps it a "simple" CORS request.
      credentials: 'omit',
      cache: 'no-store',
    });
    clearTimeout(timer);

    if (!res.ok) {
      // Non-2xx (e.g. ESPN changed an endpoint -> 404). Prefer cache if we have it.
      const cached = readCache(cacheKey);
      const err = new FetchError(`HTTP ${res.status} for ${targetUrl}`, { kind: 'http', status: res.status });
      if (cached) return { ...cached, stale: true, source: 'cache', error: err };
      throw err;
    }

    const data = await res.json();
    writeCache(cacheKey, data);
    return { data, fetchedAt: Date.now(), stale: false, source: 'network' };
  } catch (e) {
    clearTimeout(timer);

    // Distinguish timeout/abort from a generic network/CORS failure. A bare
    // "TypeError: Failed to fetch" with no proxy active is the classic CORS/
    // offline signature -> hint that enabling the proxy may help.
    const isTimeout = e.name === 'AbortError';
    const s = getSettings();
    const proxyActive = (s.useProxy ?? APP_CONFIG.useProxy) && (s.proxyBase || APP_CONFIG.proxyBase);
    const err = e instanceof FetchError ? e : new FetchError(
      isTimeout ? `Request timed out: ${targetUrl}` : `Network error: ${targetUrl} (${e.message})`,
      { kind: isTimeout ? 'timeout' : 'network', canRetryWithProxy: !proxyActive }
    );

    const cached = readCache(cacheKey);
    if (cached) return { ...cached, stale: true, source: 'cache', error: err };
    throw err;
  }
}

// Expose cache age (ms) for a key without fetching — used by the UI to decide
// whether a payload it already has is past its freshness TTL.
export function cacheAge(cacheKey) {
  const c = readCache(cacheKey);
  return c ? Date.now() - c.fetchedAt : Infinity;
}

export function clearResponseCache() {
  const keys = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith(CACHE_PREFIX)) keys.push(k);
  }
  keys.forEach((k) => localStorage.removeItem(k));
}
