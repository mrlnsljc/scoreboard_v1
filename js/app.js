// =============================================================================
// app.js — application controller: boot, state, fetch orchestration, the
// live-only refresh loop, header/settings wiring, and PWA registration.
// =============================================================================

import { APP_CONFIG, LEAGUES, getLeague, leaguesByGroup, REGIONS } from './config.js';
import { fetchScoreboard } from './data/espn.js';
import { enrichMissingLogos } from './data/logos.js';
import { clearResponseCache } from './data/http.js';
import { buildTeamIndex } from './data/teams.js';
import { openSearch } from './ui/search.js';
import {
  loadSettings, getSettings, updateSettings,
} from './store/settings.js';
import {
  loadFavorites, followedLeagueIds, isLeagueFollowed, toggleLeague,
  favoriteTeamList, isTeamFavorite, toggleTeam, setTeamFavorite,
  hasAnyFavorites, onFavoritesChange,
} from './store/favorites.js';
import { el, $, mount } from './util/dom.js';
import { timeAgo, yyyymmdd, yyyymmddRange, addDays, isSameLocalDay, relativeDayLabel, formatLocalDay } from './util/dates.js';
import { skeletonView } from './ui/skeleton.js';
import { buildTodayView, buildUpcomingView } from './ui/views.js';
import { errorState } from './ui/render.js';

// ---- app state --------------------------------------------------------------
const state = {
  // per-view, per-league results: Map<leagueId, {games, stale, error, fetchedAt}>
  today: new Map(),
  upcoming: new Map(),
  loadingView: null,     // which view is mid initial-load
  refreshTimer: null,    // live auto-refresh handle
  installPrompt: null,   // captured beforeinstallprompt event
  viewDate: new Date(),  // the day shown in the Today/Scores view (steppable)
};

const isViewingToday = () => isSameLocalDay(state.viewDate, new Date());

// ---- league set we actually fetch ------------------------------------------
// followed leagues PLUS the leagues of any favorited teams (so e.g. a favorited
// Croatia shows up even if you don't "follow" the whole competition).
function fetchLeagueSet() {
  const ids = new Set(followedLeagueIds());
  for (const t of favoriteTeamList()) if (t.leagueId) ids.add(t.leagueId);
  // Fall back to the default set if the user somehow follows nothing.
  if (ids.size === 0) APP_CONFIG.defaultFollowedLeagues.forEach((id) => ids.add(id));
  return [...ids].map(getLeague).filter(Boolean);
}

// Whether to keep a game given the favorites/follow rules (see views design):
// followed-league games show in full; an unfollowed league's games show only if
// they involve a favorite team.
function keepGame(g) {
  if (isLeagueFollowed(g.leagueId)) return true;
  return g.home && (isTeamFavorite(g.home.favKey) || isTeamFavorite(g.away.favKey));
}

// ---- fetching ---------------------------------------------------------------
async function fetchTodayLeague(league) {
  // "Today" view is really a single-day view driven by state.viewDate, so past
  // days (finished games) and other days can be browsed with the date stepper.
  const r = await fetchScoreboard(league, yyyymmdd(state.viewDate));
  return r;
}

async function fetchUpcomingLeague(league) {
  const start = new Date();
  const end = addDays(start, APP_CONFIG.upcomingDays);
  const r = await fetchScoreboard(league, yyyymmddRange(start, end));
  return r;
}

// Load an entire view (parallel across leagues). `force` bypasses skeleton skip.
async function loadView(view, { showSkeleton = true } = {}) {
  const leagues = fetchLeagueSet();
  const map = view === 'today' ? state.today : state.upcoming;

  if (showSkeleton && map.size === 0) {
    state.loadingView = view;
    render();
  }

  const fetcher = view === 'today' ? fetchTodayLeague : fetchUpcomingLeague;
  const results = await Promise.allSettled(leagues.map((lg) => fetcher(lg)));

  // rebuild the map fresh so unfollowed leagues drop out
  const next = new Map();
  results.forEach((res, i) => {
    const league = leagues[i];
    if (res.status === 'fulfilled') {
      next.set(league.id, {
        games: res.value.games, stale: res.value.stale,
        error: res.value.error, fetchedAt: res.value.fetchedAt,
      });
    } else {
      // total failure with no cache -> record the error for the banner/empty state
      next.set(league.id, { games: [], stale: true, error: res.reason, fetchedAt: 0 });
    }
  });
  if (view === 'today') state.today = next; else state.upcoming = next;
  state.loadingView = null;
  render();

  // Opportunistically fill any missing logos from TheSportsDB, then re-render.
  const allGames = flatten(next);
  enrichMissingLogos(allGames).then((changed) => { if (changed) render(); });

  scheduleLiveRefresh();
}

// flatten a results map into a filtered, deduped game list
function flatten(map) {
  const out = [];
  const seen = new Set();
  for (const { games } of map.values()) {
    for (const g of games) {
      if (seen.has(g.id)) continue;
      if (!keepGame(g)) continue;
      seen.add(g.id);
      out.push(g);
    }
  }
  return out;
}

// For the Upcoming window, keep games from ~now forward (drop already-finished).
function upcomingWindow(games) {
  const lo = Date.now() - 2 * 3600 * 1000;          // keep in-progress
  const hi = Date.now() + (APP_CONFIG.upcomingDays + 1) * 86400 * 1000;
  return games.filter((g) => Number.isFinite(g.startMs) && g.startMs >= lo && g.startMs <= hi);
}

// ---- live-only refresh loop -------------------------------------------------
// Refresh every ~30s ONLY while something is live, and only refetch the leagues
// that actually have a live game. Nothing live -> no timer at all.
function scheduleLiveRefresh() {
  clearTimeout(state.refreshTimer);
  state.refreshTimer = null;
  const s = getSettings();
  if (s.view !== 'today') return; // live polling is a Today concern
  if (!isViewingToday()) return;  // don't poll while browsing a past/other day

  const liveLeagueIds = [];
  for (const [lid, r] of state.today) {
    if (r.games.some((g) => g.isLive)) liveLeagueIds.push(lid);
  }
  if (liveLeagueIds.length === 0) return; // nothing live -> stop polling

  state.refreshTimer = setTimeout(async () => {
    const leagues = liveLeagueIds.map(getLeague).filter(Boolean);
    const results = await Promise.allSettled(leagues.map(fetchTodayLeague));
    results.forEach((res, i) => {
      if (res.status === 'fulfilled') {
        const lg = leagues[i];
        state.today.set(lg.id, {
          games: res.value.games, stale: res.value.stale,
          error: res.value.error, fetchedAt: res.value.fetchedAt,
        });
      }
    });
    render();
    scheduleLiveRefresh(); // re-arm based on the new live set
  }, APP_CONFIG.liveRefreshMs);
}

// ---- date stepper (browse previous/finished days & other days) --------------
function todayDateBar() {
  const today = isViewingToday();
  const label = relativeDayLabel(state.viewDate);   // Today / Yesterday / date
  const full = formatLocalDay(state.viewDate);
  return el('div', { class: 'date-bar' }, [
    el('button', { class: 'btn ghost icon-btn', title: 'Previous day', aria: { label: 'Previous day' }, onclick: () => stepDay(-1) }, ['‹']),
    el('div', { class: 'date-label' }, [
      el('span', { class: 'date-main' }, [label]),
      label !== full ? el('span', { class: 'date-sub' }, [full]) : null,
    ]),
    el('button', { class: 'btn ghost icon-btn', title: 'Next day', aria: { label: 'Next day' }, onclick: () => stepDay(1) }, ['›']),
    !today ? el('button', { class: 'btn ghost small jump-today', onclick: jumpToday }, ['Jump to today']) : null,
  ]);
}

function stepDay(n) {
  const next = addDays(state.viewDate, n);
  // clamp how far back you can browse (configurable); allow generous future.
  const minDate = addDays(new Date(), -APP_CONFIG.maxPastDays);
  if (next < minDate && n < 0) return;
  state.viewDate = next;
  state.today = new Map();   // drop the previous day's data so a skeleton shows
  loadView('today', { showSkeleton: true });
}
function jumpToday() {
  if (isViewingToday()) return;
  state.viewDate = new Date();
  state.today = new Map();
  loadView('today', { showSkeleton: true });
}

// ---- rendering --------------------------------------------------------------
function aggregate(map) {
  let anyStale = false, anyData = false, oldest = Infinity, errors = 0, total = 0;
  for (const r of map.values()) {
    total++;
    if (r.games.length) anyData = true;
    if (r.stale) anyStale = true;
    if (r.error) errors++;
    if (r.fetchedAt) oldest = Math.min(oldest, r.fetchedAt);
  }
  return { anyStale, anyData, oldest: oldest === Infinity ? 0 : oldest, allFailed: total > 0 && errors === total && !anyData, errors };
}

function render() {
  const s = getSettings();
  renderHeader(s);

  const content = $('#content');
  const view = s.view;
  const map = view === 'today' ? state.today : state.upcoming;

  // date bar shown above the single-day ("Today"/Scores) view only
  const bar = view === 'today' ? todayDateBar() : null;

  // initial loading skeleton
  if (state.loadingView === view && map.size === 0) {
    mount(content, [bar, skeletonView(view === 'today' ? 6 : 8)].filter(Boolean));
    renderStatusBar(s, null);
    return;
  }

  const agg = aggregate(map);

  // hard failure with nothing to show
  if (agg.allFailed) {
    const sampleErr = [...map.values()].find((r) => r.error)?.error;
    const err = errorState(
      'ESPN endpoint unreachable',
      sampleErr?.message || 'Could not reach the scores API and no cached data is available.',
      { onRetry: () => loadView(view, { showSkeleton: true }), showProxyHint: !!sampleErr?.canRetryWithProxy }
    );
    mount(content, [bar, err].filter(Boolean));
    renderStatusBar(s, agg);
    return;
  }

  let games = flatten(map);
  if (view === 'upcoming') games = upcomingWindow(games);

  const opts = {
    onToggleTeam: onToggleTeam,
    favoritesOnly: s.favoritesOnly,
    hasFavorites: hasAnyFavorites(),
    dateLabel: relativeDayLabel(state.viewDate),
  };
  const node = view === 'today' ? buildTodayView(games, opts) : buildUpcomingView(games, opts);
  mount(content, [bar, node].filter(Boolean));
  renderStatusBar(s, agg);
}

// ---- header -----------------------------------------------------------------
function renderHeader(s) {
  const header = $('#app-header');
  if (!header) return;

  const liveCount = [...state.today.values()].reduce((n, r) => n + r.games.filter((g) => g.isLive).length, 0);

  mount(header, el('div', { class: 'header-inner' }, [
    el('div', { class: 'brand' }, [
      el('img', { class: 'brand-logo', src: 'icons/icon-192.png', alt: '' }),
      el('span', { class: 'brand-name' }, [APP_CONFIG.appName]),
      liveCount ? el('span', { class: 'live-pill' }, [el('span', { class: 'live-dot' }), `${liveCount} live`]) : null,
    ]),

    el('nav', { class: 'tabs' }, [
      tabButton('today', 'Today', s.view),
      tabButton('upcoming', 'Upcoming', s.view),
    ]),

    el('div', { class: 'header-actions' }, [
      state.installPrompt ? el('button', { class: 'btn ghost', title: 'Install app', onclick: doInstall }, ['⤓ Install']) : null,
      el('button', {
        class: 'btn ghost icon-btn', title: 'Search teams & leagues', aria: { label: 'Search teams and leagues' },
        onclick: () => openSearch(afterFavoritesChanged),
      }, ['🔍']),
      el('button', {
        class: 'btn ghost icon-btn', title: 'Refresh now', aria: { label: 'Refresh' },
        onclick: () => loadView(s.view, { showSkeleton: false }),
      }, ['⟳']),
      el('button', {
        class: 'btn ghost toggle' + (s.favoritesOnly ? ' on' : ''),
        title: 'Show only favorites', aria: { pressed: String(s.favoritesOnly) },
        onclick: async () => { await updateSettings({ favoritesOnly: !s.favoritesOnly }); render(); },
      }, [s.favoritesOnly ? '★ Favorites' : '☆ Favorites']),
      el('button', {
        class: 'btn ghost icon-btn', title: 'Toggle theme', aria: { label: 'Toggle light/dark' },
        onclick: toggleTheme,
      }, [s.theme === 'dark' ? '☀' : '☾']),
      el('button', {
        class: 'btn ghost icon-btn', title: 'Settings', aria: { label: 'Settings' },
        onclick: openSettings,
      }, ['⚙']),
    ]),
  ]));
}

function tabButton(id, label, active) {
  return el('button', {
    class: 'tab' + (active === id ? ' active' : ''),
    aria: { selected: String(active === id) },
    onclick: async () => {
      if (getSettings().view === id) return;
      await updateSettings({ view: id });
      render();
      // load the view if we don't have it yet (or refresh in background)
      const map = id === 'today' ? state.today : state.upcoming;
      loadView(id, { showSkeleton: map.size === 0 });
    },
  }, [label]);
}

// ---- status / stale banner --------------------------------------------------
function renderStatusBar(s, agg) {
  const bar = $('#status-bar');
  if (!bar) return;
  const online = navigator.onLine;
  const children = [];

  if (!online) {
    children.push(el('span', { class: 'status-chip warn' }, ['● Offline — showing last saved data']));
  } else if (agg && agg.anyStale) {
    children.push(el('span', { class: 'status-chip warn' }, ['● Showing cached data (couldn’t reach ESPN)']));
  }
  if (agg && agg.oldest) {
    children.push(el('span', { class: 'status-chip muted' }, [`Updated ${timeAgo(agg.oldest)}`]));
  }
  if (s.useProxy && s.proxyBase) {
    children.push(el('span', { class: 'status-chip muted' }, ['via proxy']));
  }
  mount(bar, children);
  bar.style.display = children.length ? '' : 'none';
}

// ---- actions ----------------------------------------------------------------
async function onToggleTeam(side) {
  await toggleTeam({
    favKey: side.favKey, teamId: side.teamId, sport: side.sport, leagueId: side.leagueId,
    name: side.name, displayName: side.displayName, logo: side.logo, abbr: side.abbr,
  });
  afterFavoritesChanged();
}

// Favorites/follows can change the fetch set (e.g. favoriting a team in an
// unfollowed league) — re-render immediately and reload the view in background.
function afterFavoritesChanged() {
  render();
  loadView(getSettings().view, { showSkeleton: false });
}

async function toggleTheme() {
  const s = getSettings();
  const theme = s.theme === 'dark' ? 'light' : 'dark';
  await updateSettings({ theme });
  applyTheme(theme);
  render();
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', theme === 'dark' ? '#0d1117' : '#f5f7fa');
}

// ---- settings drawer --------------------------------------------------------
function openSettings() {
  const s = getSettings();
  const overlay = el('div', { class: 'overlay', onclick: (e) => { if (e.target === overlay) overlay.remove(); } });
  const drawer = el('div', { class: 'drawer', role: 'dialog', aria: { label: 'Settings' } });

  // Leagues management, grouped
  const leagueGroups = el('div', { class: 'setting-group' }, [el('h3', {}, ['Followed leagues'])]);
  for (const [group, leagues] of leaguesByGroup()) {
    leagueGroups.appendChild(el('div', { class: 'group-label' }, [group]));
    const chips = el('div', { class: 'chips' });
    for (const lg of leagues) {
      chips.appendChild(el('button', {
        class: 'chip' + (isLeagueFollowed(lg.id) ? ' on' : ''),
        onclick: async (e) => {
          await toggleLeague(lg.id);
          e.target.classList.toggle('on');
          loadView(getSettings().view, { showSkeleton: false });
        },
      }, [lg.name]));
    }
    leagueGroups.appendChild(chips);
  }

  // Favorite teams list
  const favTeams = favoriteTeamList();
  const favBlock = el('div', { class: 'setting-group' }, [
    el('h3', {}, ['Favorite teams']),
    favTeams.length
      ? el('div', { class: 'fav-team-list' }, favTeams.map((t) => el('div', { class: 'fav-team' }, [
          t.logo ? el('img', { class: 'logo sm', src: t.logo, alt: '' }) : el('span', { class: 'logo sm mono' }, [(t.abbr || t.displayName).slice(0, 2)]),
          el('span', { class: 'fav-team-name' }, [t.displayName]),
          el('span', { class: 'muted small' }, [getLeague(t.leagueId)?.short || '']),
          el('button', {
            class: 'btn ghost small', title: 'Remove',
            onclick: async (e) => { await setTeamFavorite(t, false); e.target.closest('.fav-team').remove(); loadView(getSettings().view, { showSkeleton: false }); },
          }, ['Remove']),
        ])))
      : el('p', { class: 'muted small' }, ['Tap the ☆ next to any team to favorite it. Favorited teams are pinned to the top and highlighted.']),
  ]);

  // Proxy settings
  const proxyEnabled = el('input', { type: 'checkbox', id: 'cfg-proxy' });
  if (s.useProxy) proxyEnabled.checked = true;
  const proxyUrl = el('input', { type: 'url', id: 'cfg-proxy-url', placeholder: 'https://your-proxy.workers.dev', value: s.proxyBase || '' });
  const proxyBlock = el('div', { class: 'setting-group' }, [
    el('h3', {}, ['CORS proxy (optional)']),
    el('p', { class: 'muted small' }, ['ESPN usually works directly. Enable this only if direct calls are blocked on your network. See README → “CORS proxy”.']),
    el('label', { class: 'row' }, [proxyEnabled, el('span', {}, ['Use proxy'])]),
    el('label', { class: 'field' }, [el('span', { class: 'small muted' }, ['Proxy base URL']), proxyUrl]),
    el('button', {
      class: 'btn', onclick: async () => {
        await updateSettings({ useProxy: proxyEnabled.checked, proxyBase: proxyUrl.value.trim() });
        clearResponseCache();
        render();
        loadView(getSettings().view, { showSkeleton: true });
      },
    }, ['Save & reload data']),
  ]);

  // Search shortcut (also available from the header 🔍)
  const searchBlock = el('div', { class: 'setting-group' }, [
    el('button', {
      class: 'btn search-btn', onclick: () => { overlay.remove(); openSearch(afterFavoritesChanged); },
    }, ['🔍  Search teams & leagues']),
    el('p', { class: 'muted small' }, ['Find and favorite any team or league directly — no need to wait for it on the schedule.']),
  ]);

  // Region / location for broadcast listings
  const regionSelect = el('select', { class: 'region-select', aria: { label: 'Region' } },
    REGIONS.map((r) => el('option', { value: r.code }, [r.label])));
  regionSelect.value = s.regionCode;
  regionSelect.addEventListener('change', async () => {
    await updateSettings({ regionCode: regionSelect.value });
    render();
    loadView(getSettings().view, { showSkeleton: true });
  });
  const regionBlock = el('div', { class: 'setting-group' }, [
    el('h3', {}, ['Region · broadcasts']),
    el('p', { class: 'muted small' }, ['Sets your location for broadcast listings (and local team-name spelling). ESPN’s broadcast data is most complete for the US; coverage for other regions varies.']),
    el('label', { class: 'field' }, [el('span', { class: 'small muted' }, ['Location']), regionSelect]),
  ]);

  // Data / cache
  const dataBlock = el('div', { class: 'setting-group' }, [
    el('h3', {}, ['Data']),
    el('button', {
      class: 'btn ghost', onclick: () => { clearResponseCache(); loadView(getSettings().view, { showSkeleton: true }); },
    }, ['Clear cached data']),
    el('p', { class: 'muted small' }, [`Source: ESPN public API · logos via ESPN/TheSportsDB · v${APP_VERSION}`]),
  ]);

  drawer.appendChild(el('div', { class: 'drawer-head' }, [
    el('h2', {}, ['Settings']),
    el('button', { class: 'btn ghost icon-btn', onclick: () => overlay.remove(), aria: { label: 'Close' } }, ['✕']),
  ]));
  drawer.appendChild(searchBlock);
  drawer.appendChild(leagueGroups);
  drawer.appendChild(favBlock);
  drawer.appendChild(regionBlock);
  drawer.appendChild(proxyBlock);
  drawer.appendChild(dataBlock);

  overlay.appendChild(drawer);
  document.body.appendChild(overlay);
}

// ---- PWA install ------------------------------------------------------------
async function doInstall() {
  const e = state.installPrompt;
  if (!e) return;
  e.prompt();
  await e.userChoice;
  state.installPrompt = null;
  render();
}

// ---- boot -------------------------------------------------------------------
const APP_VERSION = '1.0.0';

async function boot() {
  await loadSettings();
  await loadFavorites();

  const s = getSettings();
  // First-run: seed default follows so the app isn't empty.
  if (!s.seeded) {
    for (const id of APP_CONFIG.defaultFollowedLeagues) {
      if (!isLeagueFollowed(id)) await toggleLeague(id); // eslint-disable-line no-await-in-loop
    }
    await updateSettings({ seeded: true });
  }

  applyTheme(getSettings().theme);
  render();
  loadView(getSettings().view, { showSkeleton: true });

  // Pre-warm the search team index in the background so the first 🔍 search is
  // instant. Deferred to idle so it doesn't compete with the initial scores
  // fetch, and persisted for a day so it doesn't re-harvest on every launch.
  const prewarm = () => buildTeamIndex().catch(() => {});
  if ('requestIdleCallback' in window) requestIdleCallback(prewarm, { timeout: 5000 });
  else setTimeout(prewarm, 3000);

  // refresh on regaining focus / connectivity (cheap correctness wins)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') loadView(getSettings().view, { showSkeleton: false });
  });
  window.addEventListener('online', () => { render(); loadView(getSettings().view, { showSkeleton: false }); });
  window.addEventListener('offline', () => render());

  // keep "updated Xs ago" honest
  setInterval(() => { if (document.visibilityState === 'visible') renderStatusBar(getSettings(), aggregate(getSettings().view === 'today' ? state.today : state.upcoming)); }, 15000);

  onFavoritesChange(() => {/* re-render handled by callers */});

  // capture install prompt
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    state.installPrompt = e;
    render();
  });

  registerServiceWorker();
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch((e) => console.warn('[sw] registration failed', e));
  });
}

boot();
