/**
 * cloudflare-worker.js — optional CORS proxy for the Scoreboard PWA.
 *
 * The app calls:   GET https://<your-worker>/?url=<URL-encoded ESPN/TSDB url>
 * The worker fetches that URL server-side, adds permissive CORS headers, and
 * caches the response at Cloudflare's edge to ease rate limits.
 *
 * WHY YOU MIGHT NEED THIS
 *   ESPN's site.api usually already sends `Access-Control-Allow-Origin: *`, so
 *   the app works WITHOUT a proxy. Use this only if your network blocks the
 *   direct calls, or if you want server-side caching.
 *
 * SECURITY: we only allow a small all-list of upstream hosts so this can't be
 * abused as an open proxy.
 *
 * DEPLOY (2 minutes, free tier):
 *   1. Install wrangler:   npm i -g wrangler   (or: npx wrangler ...)
 *   2. wrangler login
 *   3. Save this file as `worker.js` and create `wrangler.toml`:
 *        name = "espn-proxy"
 *        main = "worker.js"
 *        compatibility_date = "2024-11-01"
 *   4. wrangler deploy
 *   5. Copy the printed URL (e.g. https://espn-proxy.<you>.workers.dev) into the
 *      app's Settings → CORS proxy, enable "Use proxy", Save. (Or set
 *      APP_CONFIG.useProxy/proxyBase in js/config.js.)
 */

const ALLOWED_HOSTS = new Set([
  'site.api.espn.com',
  'sports.core.api.espn.com',
  'site.web.api.espn.com',
  'www.thesportsdb.com',
  'a.espncdn.com',
]);

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Accept',
  'Access-Control-Max-Age': '86400',
};

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS });
    }
    if (request.method !== 'GET') {
      return json({ error: 'Only GET supported' }, 405);
    }

    const incoming = new URL(request.url);
    const target = incoming.searchParams.get('url');
    if (!target) return json({ error: 'Missing ?url= parameter' }, 400);

    let upstream;
    try { upstream = new URL(target); } catch { return json({ error: 'Bad url' }, 400); }
    if (!ALLOWED_HOSTS.has(upstream.hostname)) {
      return json({ error: `Host not allowed: ${upstream.hostname}` }, 403);
    }

    // Edge cache: serve from cache when possible, store for 30s.
    const cache = caches.default;
    const cacheKey = new Request(upstream.toString(), { method: 'GET' });
    let res = await cache.match(cacheKey);
    if (!res) {
      const fetched = await fetch(upstream.toString(), {
        headers: { 'Accept': 'application/json', 'User-Agent': 'scoreboard-pwa-proxy' },
        cf: { cacheTtl: 30, cacheEverything: true },
      });
      res = new Response(fetched.body, fetched);
      res.headers.set('Cache-Control', 'public, max-age=30');
      ctx.waitUntil(cache.put(cacheKey, res.clone()));
    }

    // re-emit with CORS headers
    const out = new Response(res.body, res);
    for (const [k, v] of Object.entries(CORS)) out.headers.set(k, v);
    return out;
  },
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status, headers: { 'Content-Type': 'application/json', ...CORS },
  });
}
