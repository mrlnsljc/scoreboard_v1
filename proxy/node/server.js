#!/usr/bin/env node
/**
 * server.js — optional self-hosted CORS proxy for the Scoreboard PWA.
 *
 * Zero dependencies: uses Node's built-in http + global fetch (Node >= 18).
 * (An Express version would be ~the same; this keeps install to nothing.)
 *
 * The app calls:  GET http://localhost:8787/?url=<URL-encoded ESPN/TSDB url>
 * This server fetches that URL server-side, adds CORS headers, and caches each
 * response in memory for 30s to ease upstream rate limits.
 *
 * RUN:
 *   node server.js                 # listens on :8787
 *   PORT=9000 node server.js       # custom port
 *
 * Then in the app: Settings → CORS proxy → enable, set base URL to
 * http://localhost:8787 → Save. (Or set APP_CONFIG.proxyBase in js/config.js.)
 *
 * Only an all-list of upstream hosts is permitted so this isn't an open proxy.
 */

const http = require('http');

const PORT = process.env.PORT || 8787;
const TTL_MS = 30 * 1000;

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

const cache = new Map(); // url -> { expires, status, contentType, body(Buffer) }

function sendJSON(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json', ...CORS });
  res.end(JSON.stringify(obj));
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') { res.writeHead(204, CORS); return res.end(); }
  if (req.method !== 'GET') return sendJSON(res, 405, { error: 'Only GET supported' });

  const reqUrl = new URL(req.url, `http://${req.headers.host}`);
  const target = reqUrl.searchParams.get('url');
  if (!target) return sendJSON(res, 400, { error: 'Missing ?url= parameter' });

  let upstream;
  try { upstream = new URL(target); } catch { return sendJSON(res, 400, { error: 'Bad url' }); }
  if (!ALLOWED_HOSTS.has(upstream.hostname)) {
    return sendJSON(res, 403, { error: `Host not allowed: ${upstream.hostname}` });
  }

  const key = upstream.toString();
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && hit.expires > now) {
    res.writeHead(hit.status, { 'Content-Type': hit.contentType, 'X-Proxy-Cache': 'HIT', ...CORS });
    return res.end(hit.body);
  }

  try {
    const upstreamRes = await fetch(key, {
      headers: { Accept: 'application/json', 'User-Agent': 'scoreboard-pwa-proxy' },
    });
    const buf = Buffer.from(await upstreamRes.arrayBuffer());
    const contentType = upstreamRes.headers.get('content-type') || 'application/json';
    cache.set(key, { expires: now + TTL_MS, status: upstreamRes.status, contentType, body: buf });
    res.writeHead(upstreamRes.status, { 'Content-Type': contentType, 'X-Proxy-Cache': 'MISS', ...CORS });
    res.end(buf);
  } catch (e) {
    // serve a stale cache entry if we have one, else error
    if (hit) {
      res.writeHead(hit.status, { 'Content-Type': hit.contentType, 'X-Proxy-Cache': 'STALE', ...CORS });
      return res.end(hit.body);
    }
    sendJSON(res, 502, { error: 'Upstream fetch failed', detail: String(e) });
  }
});

server.listen(PORT, () => {
  console.log(`Scoreboard CORS proxy listening on http://localhost:${PORT}`);
  console.log(`Try: http://localhost:${PORT}/?url=${encodeURIComponent('https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/scoreboard')}`);
});
