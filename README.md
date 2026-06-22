# Scoreboard — multi-sport live scores & schedules (installable PWA)

A fast, installable, offline-tolerant Progressive Web App for live scores and
schedules across **NHL, NBA, NFL, MLB and world soccer** (Premier League, La Liga,
Bundesliga, Serie A, Champions League, plus international fixtures so you can
follow a national team like **Croatia**).

Runs in any modern browser on Windows and macOS, installs to the taskbar/dock,
caches the last-fetched data, and degrades gracefully to a clearly-flagged stale
state when there's no connection.

- **No build step, no framework.** Plain HTML + CSS + ES modules. Read it, fork it.
- **No backend, no account.** Favorites and settings live in `localStorage`.
- **One source of truth for leagues.** Adding a sport is a single config entry.

---

## Features

| | |
|---|---|
| **Today / any day** | All of a day's games for your followed leagues. A date stepper (‹ › / “Jump to today”) browses **previous days to see finished games & scores**, or future days. Live scores auto-refresh ~every 30s **only while a game is live and you're on today** (no polling otherwise). Status: scheduled / in-progress / final. Start times in your local timezone. |
| **Upcoming** | Schedule for the next several days, grouped by day. |
| **Search** | A 🔍 command-palette to find and favorite **any team or league directly** — no scrolling the schedule hoping it shows up. Type “Croatia”, “Celtics”, “Real Madrid”… and star it. |
| **Favorites** | Favorite whole **leagues** and individual **teams**. Favorited teams' games are pinned to a highlighted "Following" section (or the top of each day) and highlighted. A **Favorites-only** toggle filters everything down to just what you follow. |
| **Region** | A location setting (US, Canada, UK, …) that localizes broadcast listings + team-name spelling via ESPN's `region`/`lang` params. |
| **Multi-sport** | NHL, NBA, NFL, MLB, and soccer (club + international) from day one. |
| **Offline-tolerant** | App shell + last-fetched scores + team logos are cached at two layers (service worker + `localStorage`). Offline shows the last data with a "Showing cached data" banner — never a blank screen. |
| **Theming** | Dark by default, light toggle. Responsive from phone width to a wide desktop window. |
| **States** | Loading skeletons, empty states ("No games today"), and explicit error states ("ESPN endpoint unreachable"). |

---

## Run it locally

The app must be served over HTTP (service workers and ES modules don't work from
`file://`). Any static server works. From the project folder:

**Option A — included dev server** (correct MIME types + no-store so edits show up):

```bash
python3 devserver.py 8770 .
# open http://localhost:8770
```

**Option B — stdlib one-liner:**

```bash
python3 -m http.server 8770
# open http://localhost:8770
```

**Option C — Node, if you have it:**

```bash
npx serve .        # or: npx http-server -p 8770
```

That's it — there's nothing to build or install for the app itself.

> The repo also ships a `.claude/launch.json` (one level up) so the in-editor
> preview can start the dev server; you can ignore it.

---

## Install as a PWA

Once it's loaded over `http://localhost` (or any HTTPS host), it's installable.

**Windows — Chrome or Edge**
1. Open the app in the browser.
2. Click the **install icon** in the address bar (a monitor/⊕ glyph), or
   menu **⋯ → Apps → Install this site as an app** (Edge: **Apps → Install**).
3. It gets its own window and a Start-menu/taskbar entry. Right-click the taskbar
   icon → **Pin to taskbar** to keep it.

**macOS — Safari 17+**
1. Open the app in Safari.
2. **File → Add to Dock…** → **Add**.
3. Launches as a standalone Dock app.

**macOS — Chrome**
1. Open the app.
2. Address-bar **install icon**, or **⋮ → Cast, save & share → Install page as app…**
3. Appears in Launchpad / Applications.

The in-app header also shows an **⤓ Install** button when the browser offers the
native install prompt.

---

## How the league config works

Everything is driven by one registry in [`js/config.js`](js/config.js). ESPN's
public scoreboard URL is:

```
https://site.api.espn.com/apis/site/v2/sports/{sport}/{league}/scoreboard
```

so a league is just `{ sport, league }` plus display metadata:

```js
{
  id: 'nhl',            // stable id used in storage
  name: 'NHL',          // full name
  short: 'NHL',         // compact label
  sport: 'hockey',      // ESPN sport path segment
  league: 'nhl',        // ESPN league path segment
  group: 'Hockey',      // UI grouping
  hasDraws: false,      // soccer => true (a finished game can be a draw)
  intl: false,          // national-team competition?
  tsdb: 'NHL',          // TheSportsDB league name (logo fallback only)
}
```

### Add a new sport/league (a single entry)

Find the ESPN `sport`/`league` path segments (open
`https://site.api.espn.com/apis/site/v2/sports/<sport>/<league>/scoreboard` in a
browser — if it returns JSON, it works), then add one row to `LEAGUES`:

```js
// e.g. add WNBA
{ id: 'wnba', name: 'WNBA', short: 'WNBA', sport: 'basketball', league: 'wnba',
  group: 'Basketball', hasDraws: false, intl: false, tsdb: 'WNBA' },

// e.g. add Ligue 1 (French soccer)
{ id: 'fra.1', name: 'Ligue 1', short: 'Ligue 1', sport: 'soccer', league: 'fra.1',
  group: 'Soccer', hasDraws: true, intl: false, tsdb: 'French Ligue 1' },
```

No other code changes are needed — fetching, parsing, favorites, grouping and the
settings UI all pick it up automatically. Common ESPN segments:

| Sport | `sport` | example `league` values |
|---|---|---|
| Hockey | `hockey` | `nhl` |
| Basketball | `basketball` | `nba`, `wnba`, `mens-college-basketball` |
| Football | `football` | `nfl`, `college-football` |
| Baseball | `baseball` | `mlb` |
| Soccer | `soccer` | `eng.1`, `esp.1`, `ger.1`, `ita.1`, `fra.1`, `uefa.champions`, `uefa.europa`, `fifa.world`, `uefa.nations`, `fifa.worldq.uefa`, `fifa.friendly`, `mex.1`, `usa.1` |

---

## Architecture

```
index.html              app shell (header / status bar / content / footer)
manifest.webmanifest    PWA manifest
sw.js                   service worker: precache shell + runtime caching
devserver.py            optional dev static server (no-store + correct MIME)
css/styles.css          all styling; theming via [data-theme]

js/
  config.js             APP_CONFIG + the LEAGUE REGISTRY  ← edit to add sports
  util/
    dom.js              tiny element factory (no framework)
    dates.js            local-timezone formatting + day grouping
  data/                 ── DATA / API LAYER ──
    http.js             fetch wrapper: proxy flag, timeout, localStorage cache,
                        offline fallback (returns a `stale` flag)
    espn.js             ESPN endpoints + per-sport response NORMALIZERS
                        (heavily commented with the real JSON shape)
    teams.js            team index for search (scoreboard harvest + core-API
                        fallback; works around the non-CORS /teams endpoint)
    thesportsdb.js      logo/badge FALLBACK (one cached call per league)
    logos.js            logo resolution policy (ESPN first, TSDB fallback)
  store/                ── STORAGE LAYER (swappable) ──
    store.js            StorageAdapter interface + LocalStorageAdapter
    settings.js         settings model (theme, view, proxy override…)
    favorites.js        followed leagues + favorite teams model
  ui/                   ── UI LAYER ──
    skeleton.js         loading placeholders
    render.js           game card / status badge / team row / states
    views.js            Today + Upcoming view assembly
    search.js           command-palette search for teams & leagues
  app.js                controller: boot, fetch orchestration, live refresh loop,
                        header + settings drawer, PWA install + SW registration

proxy/                  ── OPTIONAL CORS PROXY ──
  cloudflare-worker.js  deploy-in-2-minutes Worker
  node/server.js        zero-dependency self-hosted Node proxy
  node/package.json
```

The three layers are deliberately separate: **data/** knows about ESPN,
**store/** knows about persistence, **ui/** knows about the DOM. They meet only in
`app.js`.

### Data sources

- **ESPN public JSON API** (`site.api.espn.com`) — primary source for scores,
  status and schedules. No key required. All scoreboards share one response shape;
  per-sport quirks (soccer draws, "Final/OT", live clocks) are documented inline in
  [`js/data/espn.js`](js/data/espn.js). ESPN also returns team logo URLs, which the
  app uses directly.
- **TheSportsDB** (free dev key `3`) — used **only** as a fallback for team
  badges where ESPN has none. One cached request per league (not per team) to
  respect rate limits; cached for 7 days.

### Storage layer is swap-ready

Favorites and settings go through a `Store` backed by a `StorageAdapter`
(`js/store/store.js`). The adapter interface is intentionally **async**, so a
future sync backend is a drop-in:

```js
import { setAdapter, StorageAdapter } from './js/store/store.js';

class MyApiAdapter extends StorageAdapter {
  async getItem(k)        { return (await fetch(`/kv/${k}`)).text(); }
  async setItem(k, v)     { await fetch(`/kv/${k}`, { method: 'PUT', body: v }); }
  async removeItem(k)     { await fetch(`/kv/${k}`, { method: 'DELETE' }); }
  async keys()            { return (await fetch('/kv')).json(); }
}
setAdapter(new MyApiAdapter());   // nothing else changes
```

The API response cache stays local on purpose (it's just a perf/offline aid) and
is kept separate from this user-data store.

---

## CORS proxy (optional)

**You probably don't need it.** ESPN's `site.api.espn.com` currently sends
`Access-Control-Allow-Origin: *`, so browser-direct calls work out of the box —
that's the default (`APP_CONFIG.useProxy = false`).

Enable a proxy only if your network blocks the direct calls, or if you want
server-side caching. The app routes every request through the proxy as
`GET <proxyBase>/?url=<encoded ESPN url>` — both proxies below implement that and
only allow ESPN/TheSportsDB hosts (not an open proxy).

Turn it on either in **Settings → CORS proxy** (enable + paste the URL + Save), or
by editing [`js/config.js`](js/config.js):

```js
useProxy: true,
proxyBase: 'https://espn-proxy.<you>.workers.dev',  // or http://localhost:8787
```

### Cloudflare Worker (free, ~2 minutes)

```bash
npm i -g wrangler          # or use npx
wrangler login
# save proxy/cloudflare-worker.js as worker.js, add a minimal wrangler.toml:
#   name = "espn-proxy"
#   main = "worker.js"
#   compatibility_date = "2024-11-01"
wrangler deploy
# -> copy the printed https://espn-proxy.<you>.workers.dev into the app
```

### Self-hosted Node proxy (zero dependencies, Node ≥ 18)

```bash
cd proxy/node
node server.js                  # listens on http://localhost:8787
# PORT=9000 node server.js      # custom port
```

Then set the app's proxy base URL to `http://localhost:8787`.

---

## Behavior notes

- **Live refresh:** after each Today render the app checks for live games; if any
  are live it refetches **only the leagues with a live game** every ~30s, and stops
  entirely when nothing is live (or when you've stepped to another day). It also
  refreshes on tab refocus and when connectivity returns.
- **Browsing other days:** the date stepper on the Today view fetches that day's
  scoreboard, so past days show finished games with final scores. Live polling is
  paused unless you're on the current day.
- **Region / broadcasts:** Settings → *Region · broadcasts* sends ESPN's
  `region`+`lang` params (cache is keyed per-region). ESPN's broadcast data is
  **most complete for the US**; other regions vary, and ESPN also geolocates by
  the caller's IP — so when calling direct (no proxy) from your own country you
  often get your local networks automatically.
- **Search data:** ESPN's full-roster `/teams` endpoint is *not* CORS-enabled, so
  the search index is built from CORS-clean sources that still carry real ESPN
  team ids (needed so favorites match games): a wide **scoreboard harvest** per
  league, topped up from the **core API** for any off-season league a harvest
  leaves sparse. Rosters are cached 7 days. See [`js/data/teams.js`](js/data/teams.js).
- **Timezones:** ESPN event times are absolute (UTC). Everything displayed —
  start times, day grouping — is rendered in your browser's local timezone via
  `Intl`.
- **First run:** seeds a couple of followed leagues (NHL + World Cup) so the app
  isn't empty. After that you're in full control; clearing favorites won't re-seed.
- **Caching/versioning:** bump `CACHE_VERSION` in `sw.js` to push new assets to
  installed clients.

## Sign in with Google (optional cross-device sync)

The app works fully without an account (everything saved locally). Turn on
"Sign in with Google" to **sync your favorites & settings across devices** via
Firebase. It's free. Step by step:

1. Go to **https://console.firebase.google.com** and sign in with your Google account.
2. Click **Add project** → name it (e.g. `scoreboard`) → Continue. You can
   **disable Google Analytics** (simpler) → Create project.
3. On the project home, click the **web icon `</>`** ("Add app to get started").
   Give it a nickname, **leave "Firebase Hosting" unchecked**, click **Register app**.
4. It shows a `const firebaseConfig = { … }` block. **Copy that object.** (The
   `apiKey` here is *not* a secret — it's safe in your code; access is protected
   by login + security rules below.)
5. Left sidebar → **Build → Authentication → Get started**. Open the
   **Sign-in method** tab → click **Google** → toggle **Enable** → pick a support
   email → **Save**.
6. Still in Authentication → **Settings** tab → **Authorized domains** → **Add domain**
   → enter `mrlnsljc.github.io` (your live site). `localhost` is already allowed for testing.
7. Left sidebar → **Build → Firestore Database → Create database** → **Start in
   production mode** → choose a location → **Enable**.
8. Firestore → **Rules** tab → replace everything with the rules below → **Publish**:
   ```
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       match /users/{uid} {
         allow read, write: if request.auth != null && request.auth.uid == uid;
       }
     }
   }
   ```
   (This makes each person able to read/write **only their own** data.)
9. Open **`js/config.js`** and paste your config into `FIREBASE_CONFIG`, e.g.:
   ```js
   export const FIREBASE_CONFIG = {
     apiKey: "AIza…",
     authDomain: "scoreboard-xxxx.firebaseapp.com",
     projectId: "scoreboard-xxxx",
     appId: "1:123…:web:abc…",
   };
   ```
10. Re-publish the site (commit/push). Open the app → **⚙ Settings → Account →
    Sign in with Google**. On first sign-in your existing local favorites are
    pushed to the cloud; after that every device you sign into stays in sync.

If `FIREBASE_CONFIG` stays `null`, the Account section just says it isn't set up
and the app behaves exactly as before (local-only).

## Limitations

- ESPN's API is undocumented and can change without notice. Parsing is defensive
  and isolated to `js/data/espn.js`; if a shape changes, that's the one file to
  fix. The UI shows an explicit error state rather than breaking.
- Not affiliated with or endorsed by ESPN or TheSportsDB.
