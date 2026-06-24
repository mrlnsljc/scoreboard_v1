// =============================================================================
// app.js — application controller: boot, state, fetch orchestration, the
// live-only refresh loop, header/settings wiring, and PWA registration.
// =============================================================================

import { APP_CONFIG, LEAGUES, getLeague, leaguesByGroup, REGIONS } from './config.js';
import { fetchScoreboard } from './data/espn.js';
import { enrichMissingLogos } from './data/logos.js';
import { clearResponseCache } from './data/http.js';
import { buildTeamIndex } from './data/teams.js';
import { fetchMajorByYear, MAJOR_LABELS, MAJOR_SHORT } from './data/golf.js';
import { fetchStandings } from './data/standings.js';
import { fetchLeaders, expandCategory } from './data/leaders.js';
import { fetchTeamDetail } from './data/team.js';
import { fetchTeamAdvancedStats } from './data/teamstats.js';
import { fetchPlayerDetail } from './data/player.js';
import { fetchGameSummary } from './data/game.js';
import { openSearch } from './ui/search.js';
import { buildStandingsView, buildLeadersExpandModal } from './ui/standings.js';
import { leaguePicker } from './ui/leaguePicker.js';
import { buildGolfArchive } from './ui/golf.js';
import { fetchRacing } from './data/racing.js';
import { buildRacingView } from './ui/racing.js';
import { fetchBracket, defaultBracketSeason } from './data/bracket.js';
import { buildBracketView } from './ui/bracket.js';
import { buildCalendarView } from './ui/calendar.js';
import { buildTeamView } from './ui/team.js';
// (golf is now part of the Standings page; the old standalone Golf tab was removed)
import { buildPlayerView } from './ui/player.js';
import { buildGameView } from './ui/game.js';
import { buildMyTeamsView } from './ui/myteams.js';
import { store, setAdapter, LocalStorageAdapter } from './store/store.js';
import { initAuth, signInGoogle, signOutUser, isConfigured as authConfigured, FirestoreAdapter } from './auth/firebase.js';
import {
  loadSettings, getSettings, updateSettings,
} from './store/settings.js';
import {
  loadFavorites, followedLeagueIds, isLeagueFollowed, toggleLeague,
  favoriteTeamList, isTeamFavorite, toggleTeam, setTeamFavorite,
  hasAnyFavorites, onFavoritesChange,
} from './store/favorites.js';
import { el, $, mount } from './util/dom.js';
import { timeAgo, yyyymmdd, yyyymmddRange, addDays, isSameLocalDay, relativeDayLabel, formatLocalDay, localDayKey, parseLocalDate, startOfMonth, endOfMonth, addMonths } from './util/dates.js';
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
  // standings view (mode = teams | leaders; selectedId 'golf' shows the golf archive)
  standings: { selectedId: null, season: null, mode: 'teams', scope: 'grouped', leadersAllTime: false, result: null, leaders: null, loading: false, leadersLoading: false, error: null, sortIndex: null, sortDir: 'desc' },
  golfArchive: { years: [], byMajor: {} }, // byMajor[label] = { year, leaderboard, loading, error }
  racing: { result: null, loading: false, error: null }, // F1 (under Standings, like golf)
  bracket: { result: null, loading: false, error: null, leagueId: null, season: null, loadedSeason: null }, // playoff/knockout bracket
  calendar: { monthDate: startOfMonth(new Date()), leagueId: null, games: [], loading: false, error: null }, // month grid
  myteams: { byKey: new Map() },           // favKey -> { result, loading, error }
  // team/player/game drill-down (overlays the active tab when type !== null)
  detail: { type: null, league: null, teamId: null, athleteId: null, gameId: null, result: null, loading: false, error: null },
  detailStack: [],
  gameTimer: null, // live refresh for an open in-progress game page
  ticker: { picks: [], timer: null }, // header live ticker for favorite teams
  user: null, // signed-in Firebase user (null = signed out / not configured)
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

// ---- header live ticker -----------------------------------------------------
// A thin, always-visible strip of the user's favorite teams' games (live first,
// then next up, then most-recent final). Self-contained: it fetches a short
// forward window of each favorite league's scoreboard (cached, cheap) and
// re-polls every ~30s while any favorite is live. Independent of the active tab.
function pickTickerGame(games) {
  if (!games.length) return null;
  const live = games.filter((g) => g.isLive).sort((a, b) => (a.startMs || 0) - (b.startMs || 0));
  if (live.length) return live[0];
  const now = Date.now();
  const upcoming = games.filter((g) => !g.isFinal && Number.isFinite(g.startMs) && g.startMs >= now - 3 * 3600 * 1000)
    .sort((a, b) => a.startMs - b.startMs);
  if (upcoming.length) return upcoming[0];
  const finals = games.filter((g) => g.isFinal).sort((a, b) => (a.startMs || 0) - (b.startMs || 0));
  return finals[finals.length - 1] || null;
}

async function loadTicker() {
  const favs = favoriteTeamList();
  if (!favs.length) { state.ticker.picks = []; clearTimeout(state.ticker.timer); renderTicker(); return; }
  const leagues = [...new Set(favs.map((f) => f.leagueId))].map(getLeague).filter(Boolean);
  const start = new Date();
  const end = addDays(start, 7);
  const results = await Promise.allSettled(leagues.map((lg) => fetchScoreboard(lg, yyyymmddRange(start, end))));
  const games = [];
  results.forEach((r) => { if (r.status === 'fulfilled') games.push(...r.value.games); });
  const picks = [];
  for (const f of favs) {
    const mine = games.filter((g) => g.home.favKey === f.favKey || g.away.favKey === f.favKey);
    const g = pickTickerGame(mine);
    if (g) picks.push({ fav: f, game: g });
  }
  // live first, then soonest upcoming, then finals
  const phase = (g) => (g.isLive ? 0 : g.isPre ? 1 : 2);
  picks.sort((a, b) => phase(a.game) - phase(b.game) || (a.game.startMs || 0) - (b.game.startMs || 0));
  state.ticker.picks = picks;
  renderTicker();
  scheduleTickerRefresh();
}

function scheduleTickerRefresh() {
  clearTimeout(state.ticker.timer);
  state.ticker.timer = null;
  if (!state.ticker.picks.some((p) => p.game.isLive)) return; // only poll while live
  state.ticker.timer = setTimeout(loadTicker, APP_CONFIG.liveRefreshMs);
}

function tickerChip({ fav, game }) {
  const meHome = game.home.favKey === fav.favKey;
  const me = meHome ? game.home : game.away;
  const opp = meHome ? game.away : game.home;
  let score = '';
  if (game.isLive) score = `${me.score}-${opp.score}`;
  else if (game.isFinal) score = `${game.isDraw ? 'D' : me.winner ? 'W' : 'L'} ${me.score}-${opp.score}`;
  else score = Number.isFinite(game.startMs) ? formatLocalTime(new Date(game.startMs)) : '';

  const logo = (me.logo || fav.logo)
    ? (() => { const i = el('img', { class: 'tk-logo', src: me.logo || fav.logo, alt: '', referrerpolicy: 'no-referrer' }); i.addEventListener('error', () => i.remove()); return i; })()
    : null;
  return el('button', {
    class: 'ticker-chip' + (game.isLive ? ' live' : '') + (game.isFinal ? ' final' : ''),
    title: `${me.displayName} ${meHome ? 'vs' : '@'} ${opp.displayName}`,
    onclick: () => openGame(game),
  }, [
    logo,
    el('span', { class: 'tk-abbr' }, [me.abbr || me.displayName]),
    el('span', { class: 'tk-vs muted' }, [meHome ? 'vs' : '@']),
    el('span', { class: 'tk-abbr' }, [opp.abbr || opp.displayName]),
    game.isLive ? el('span', { class: 'live-dot' }) : null,
    el('span', { class: 'tk-score' }, [score]),
  ]);
}

function renderTicker() {
  const bar = $('#ticker');
  if (!bar) return;
  const picks = state.ticker.picks;
  if (!picks.length) { bar.style.display = 'none'; bar.replaceChildren(); return; }
  bar.style.display = '';
  mount(bar, el('div', { class: 'ticker-track' }, [
    el('span', { class: 'tk-label', aria: { hidden: 'true' } }, ['★']),
    ...picks.map(tickerChip),
  ]));
}

// ---- standings --------------------------------------------------------------
// Every configured league supports standings (they're all ESPN team sports);
// plus a Golf entry that shows the majors archive (major -> year).
const GOLF_OPTION = { id: 'golf', name: '⛳ Golf — Majors' };
// F1 is a non-team sport, so (like golf) it's a special Standings entry with its
// own data path, not a row in the LEAGUES registry. sport/league let the picker
// resolve its logo via leagueLogoUrl().
const F1_OPTION = { id: 'f1', name: 'F1 — Motorsport', sport: 'racing', league: 'f1' };
function standingsLeagues() { return [...LEAGUES, GOLF_OPTION, F1_OPTION]; }

async function loadStandings(force = false) {
  const st = state.standings;
  if (!st.selectedId || force) {
    // default to the first followed league that has standings, else the first one
    const followed = followedLeagueIds();
    st.selectedId = followed.find((id) => getLeague(id)) || standingsLeagues()[0]?.id || null;
  }
  await loadStandingsLeague(st.selectedId, { skeleton: true });
}

async function loadStandingsLeague(id, { skeleton = false } = {}) {
  const st = state.standings;
  const league = getLeague(id);
  if (!league) return;
  st.loading = skeleton && (!st.result || st.result.league.id !== id);
  st.error = null;
  if (getSettings().view === 'standings') render();
  try {
    st.result = await fetchStandings(league, st.season);
    st.season = st.result.season; // sync to whatever season actually loaded
  } catch (e) {
    st.error = e; st.result = null;
  }
  st.loading = false;
  if (getSettings().view === 'standings') render();
}

function selectStandingsLeague(id) {
  const st = state.standings;
  st.selectedId = id;
  if (id === 'golf') { loadGolfArchive(); render(); return; }
  if (id === 'f1') { loadRacing(); render(); return; }
  st.season = null;   // reset to current season when switching leagues
  st.result = null;   // drop the previous league's team table
  st.leaders = null;  // leaders are per-league
  st.sortIndex = null; st.sortDir = 'desc'; // back to the league's default sort
  if (st.mode === 'leaders') loadLeaders();
  else if (st.mode === 'bracket') { state.bracket.result = null; state.bracket.leagueId = null; state.bracket.season = null; loadBracket(); }
  else if (st.mode === 'calendar') { state.calendar.games = []; state.calendar.leagueId = null; loadCalendarMonth(true); }
  else loadStandingsLeague(id, { skeleton: true });
}

// ---- golf archive (under Standings): major -> year ----
function loadGolfArchive() {
  const ga = state.golfArchive;
  if (!ga.years.length) {
    const cur = new Date().getFullYear();
    ga.years = Array.from({ length: 6 }, (_, i) => cur - i); // cur .. cur-5
  }
  MAJOR_LABELS.forEach((label) => {
    if (!ga.byMajor[label]) ga.byMajor[label] = { year: ga.years[0], leaderboard: null, loading: false, error: null };
    if (!ga.byMajor[label].leaderboard && !ga.byMajor[label].loading) loadMajorYear(label, ga.byMajor[label].year);
  });
}

async function loadMajorYear(label, year) {
  const ga = state.golfArchive;
  ga.byMajor[label] = { year, leaderboard: ga.byMajor[label]?.leaderboard || null, loading: true, error: null };
  const onGolf = () => getSettings().view === 'standings' && state.standings.selectedId === 'golf';
  if (onGolf()) render();
  try {
    const r = await fetchMajorByYear(label, year);
    ga.byMajor[label] = { year, leaderboard: r.leaderboard, loading: false, error: null };
  } catch (e) {
    ga.byMajor[label] = { year, leaderboard: null, loading: false, error: e };
  }
  if (onGolf()) render();
}

function selectGolfYear(label, year) { loadMajorYear(label, year); }

// ---- F1 / motorsport (under Standings, like golf) ----
async function loadRacing() {
  const rc = state.racing;
  rc.loading = !rc.result;
  rc.error = null;
  const onF1 = () => getSettings().view === 'standings' && state.standings.selectedId === 'f1';
  if (onF1()) render();
  try { rc.result = await fetchRacing(F1_OPTION); }
  catch (e) { rc.error = e; rc.result = null; }
  rc.loading = false;
  if (onF1()) render();
}

// ---- month calendar (a Standings mode) ----
async function loadCalendarMonth(force = false) {
  const st = state.standings;
  const league = getLeague(st.selectedId);
  if (!league) return; // golf/f1 have no month grid
  const cal = state.calendar;
  const sameMonth = cal.leagueId === league.id && isSameLocalDay(cal.loadedMonth || new Date(0), cal.monthDate);
  if (cal.games.length && sameMonth && !force && !cal.error) return;
  cal.loading = true; cal.error = null; cal.leagueId = league.id;
  const onCal = () => getSettings().view === 'standings' && state.standings.mode === 'calendar';
  if (onCal()) render();
  try {
    const r = await fetchScoreboard(league, yyyymmddRange(startOfMonth(cal.monthDate), endOfMonth(cal.monthDate)));
    cal.games = r.games; cal.loadedMonth = new Date(cal.monthDate);
  } catch (e) { cal.error = e; cal.games = []; }
  cal.loading = false;
  if (onCal()) render();
}

function calendarStep(n) {
  state.calendar.monthDate = addMonths(state.calendar.monthDate, n);
  state.calendar.games = [];
  loadCalendarMonth(true);
}
function calendarThisMonth() {
  state.calendar.monthDate = startOfMonth(new Date());
  state.calendar.games = [];
  loadCalendarMonth(true);
}

// ---- playoff / knockout bracket (a third Standings mode) ----
async function loadBracket() {
  const st = state.standings;
  const league = getLeague(st.selectedId);
  if (!league) return; // golf/f1 have no bracket
  const b = state.bracket;
  if (b.season == null) b.season = defaultBracketSeason(league.sport);
  if (b.result && b.leagueId === league.id && b.loadedSeason === b.season && !b.error) return; // cached for this league+season
  b.loading = true; b.error = null; b.leagueId = league.id;
  const onBracket = () => getSettings().view === 'standings' && state.standings.mode === 'bracket';
  if (onBracket()) render();
  try { b.result = await fetchBracket(league, b.season); b.loadedSeason = b.season; b.season = b.result.season; }
  catch (e) { b.error = e; b.result = null; }
  b.loading = false;
  if (onBracket()) render();
}

function selectBracketSeason(year) {
  state.bracket.season = year;
  state.bracket.result = null;
  loadBracket();
}

// Recent seasons offered in the bracket's season picker (current year back 8).
function bracketSeasonOptions() {
  const y = new Date().getFullYear();
  return Array.from({ length: 9 }, (_, i) => y - i);
}

function sortStandings(i) {
  const st = state.standings;
  const effective = st.sortIndex != null ? st.sortIndex : (st.result?.defaultSortIndex ?? 0);
  st.sortDir = (i === effective) ? (st.sortDir === 'asc' ? 'desc' : 'asc') : 'desc';
  st.sortIndex = i;
  render();
}

function setStandingsScope(scope) {
  state.standings.scope = scope;
  render();
}

function selectStandingsSeason(year) {
  const st = state.standings;
  st.season = year;
  if (st.mode === 'leaders') { st.leaders = null; loadLeaders(); }
  else loadStandingsLeague(st.selectedId, { skeleton: true });
}

function setLeadersAllTime(allTime) {
  const st = state.standings;
  if (st.leadersAllTime === allTime) return;
  st.leadersAllTime = allTime;
  st.leaders = null;
  loadLeaders();
}

// Expand a leaders category to its full top-50 in a modal.
async function openLeadersExpand(category) {
  const league = state.standings.leaders?.league;
  if (!league) return;
  const hsSlug = league.sport === 'soccer' ? 'soccer' : league.league;
  const modal = buildLeadersExpandModal({
    title: category.name,
    hsSlug,
    rows: category.rows,            // instant top-5 while the rest resolve
    onSelectPlayer: (id) => openPlayer(league, id),
  });
  document.body.appendChild(modal.overlay);
  try {
    const full = await expandCategory(category);
    modal.update(full);
  } catch { modal.update(category.rows); }
}

function setStandingsMode(mode) {
  const st = state.standings;
  if (st.mode === mode) return;
  st.mode = mode;
  render();
  if (mode === 'leaders' && !st.leaders) loadLeaders();
  else if (mode === 'bracket') loadBracket();
  else if (mode === 'calendar') loadCalendarMonth();
  else if (mode === 'teams' && !st.result) loadStandingsLeague(st.selectedId, { skeleton: true });
}

async function loadLeaders() {
  const st = state.standings;
  const league = getLeague(st.selectedId);
  if (!league) return;
  // ESPN's no-season ("all-time") leaders form is empty for soccer, so always use
  // a season there. Other sports keep the Season/All-time choice.
  const allTime = league.sport === 'soccer' ? false : st.leadersAllTime;
  // leaders are season-scoped; discover the current season if we don't have one.
  // (soccer needs this too — without a season it would hit the empty all-time form.)
  if (!st.season && !allTime) {
    try { const s = await fetchStandings(league); st.season = s.season; if (!st.result) st.result = s; } catch { /* ignore */ }
  }
  st.leadersLoading = !st.leaders;
  if (getSettings().view === 'standings') render();
  try {
    st.leaders = await fetchLeaders(league, st.season, { allTime });
    // The current season can be empty (e.g. soccer's not-yet-played season): walk
    // back a couple seasons until one actually has published leaders.
    if (!allTime && st.season && st.leaders && !st.leaders.categories.length) {
      for (let back = 1; back <= 2; back++) {
        const alt = await fetchLeaders(league, st.season - back, { allTime: false }).catch(() => null); // eslint-disable-line no-await-in-loop
        if (alt && alt.categories.length) { st.leaders = alt; st.season = st.season - back; break; }
      }
    }
  } catch (e) { st.leaders = null; st.error = e; }
  st.leadersLoading = false;
  if (getSettings().view === 'standings') render();
}

// ---- team / player / game drill-down (with a back-stack) --------------------
// state.detail = current page; state.detailStack = pages to return to. A page
// keeps its loaded `result` so going Back is instant (no refetch).
const blankDetail = () => ({ type: null, league: null, teamId: null, athleteId: null, gameId: null, result: null, loading: false, error: null, schedView: 'table', calMonth: startOfMonth(new Date()) });

// Team page: toggle its schedule between a list and a month calendar, + step months.
function setTeamSchedView(v) { if (state.detail.type === 'team') { state.detail.schedView = v; render(); } }
function teamCalStep(n) { if (state.detail.type === 'team') { state.detail.calMonth = addMonths(state.detail.calMonth, n); render(); } }

function pushDetail(next) {
  clearTimeout(state.gameTimer); state.gameTimer = null;
  if (state.detail.type) state.detailStack.push(state.detail);
  state.detail = next;
  render();
}
function isCurrent(type, key, val) { return state.detail.type === type && state.detail[key] === val; }

function openTeam(leagueId, teamId) {
  const league = getLeague(leagueId);
  if (!league) return;
  pushDetail({ ...blankDetail(), type: 'team', league, teamId, loading: true });
  fetchTeamDetail(league, teamId)
    .then((r) => { if (isCurrent('team', 'teamId', teamId)) { state.detail.result = r; state.detail.loading = false; render(); loadTeamAdvanced(league, teamId); } })
    .catch((e) => { if (isCurrent('team', 'teamId', teamId)) { state.detail.error = e; state.detail.loading = false; render(); } });
}

// Advanced/season team stats are a second, lazy fetch (CORS-open core API) that
// fills in once the team page has already painted.
function loadTeamAdvanced(league, teamId) {
  fetchTeamAdvancedStats(league, teamId)
    .then((adv) => { if (isCurrent('team', 'teamId', teamId) && state.detail.result) { state.detail.result.advanced = adv; render(); } })
    .catch(() => { /* panel just stays hidden */ });
}

function openPlayer(league, athleteId) {
  if (!league) return;
  pushDetail({ ...blankDetail(), type: 'player', league, athleteId, loading: true });
  fetchPlayerDetail(league, athleteId)
    .then((r) => { if (isCurrent('player', 'athleteId', athleteId)) { state.detail.result = r; state.detail.loading = false; render(); } })
    .catch((e) => { if (isCurrent('player', 'athleteId', athleteId)) { state.detail.error = e; state.detail.loading = false; render(); } });
}

function openGame(game) {
  const league = getLeague(game.leagueId);
  if (!league) return;
  pushDetail({ ...blankDetail(), type: 'game', league, gameId: game.id, loading: true });
  fetchGameSummary(league, game.id)
    .then((r) => { if (isCurrent('game', 'gameId', game.id)) { state.detail.result = r; state.detail.loading = false; render(); scheduleGameRefresh(); } })
    .catch((e) => { if (isCurrent('game', 'gameId', game.id)) { state.detail.error = e; state.detail.loading = false; render(); } });
}

// Refresh an open game page every ~30s while it's in progress.
function scheduleGameRefresh() {
  clearTimeout(state.gameTimer);
  state.gameTimer = null;
  const d = state.detail;
  if (d.type !== 'game' || !d.result?.isLive) return;
  const gid = d.gameId;
  state.gameTimer = setTimeout(async () => {
    if (!isCurrent('game', 'gameId', gid)) return;
    try {
      const r = await fetchGameSummary(d.league, gid);
      if (isCurrent('game', 'gameId', gid)) { state.detail.result = r; render(); }
    } catch { /* keep showing what we have */ }
    scheduleGameRefresh();
  }, APP_CONFIG.liveRefreshMs);
}

function backFromDetail() {
  clearTimeout(state.gameTimer); state.gameTimer = null;
  const prev = state.detailStack.pop();
  state.detail = prev || blankDetail();
  render();
  scheduleGameRefresh(); // re-arm if we landed back on a live game
}
function clearDetail() { clearTimeout(state.gameTimer); state.gameTimer = null; state.detail = blankDetail(); state.detailStack = []; }

async function toggleDetailTeamFav() {
  const t = state.detail.result?.team;
  if (!t) return;
  await toggleTeam({ favKey: t.favKey, teamId: t.id, sport: t.sport, leagueId: t.leagueId, name: t.name, displayName: t.name, logo: t.logo, abbr: t.abbr });
  render();
}

function standingsAgg() {
  const r = state.standings.result;
  if (!r) return null;
  return { anyStale: !!r.stale, anyData: !!r.groups.length, oldest: r.fetchedAt || 0, allFailed: false };
}

// ---- My Teams dashboard -----------------------------------------------------
function loadMyTeams() {
  const favs = favoriteTeamList();
  const valid = new Set(favs.map((f) => f.favKey));
  // drop cards for teams no longer favorited
  for (const k of [...state.myteams.byKey.keys()]) if (!valid.has(k)) state.myteams.byKey.delete(k);
  // load any new favorites
  for (const f of favs) {
    if (!state.myteams.byKey.has(f.favKey)) {
      state.myteams.byKey.set(f.favKey, { loading: true });
      loadOneMyTeam(f);
    }
  }
  if (getSettings().view === 'myteams') render();
}

async function loadOneMyTeam(fav) {
  const league = getLeague(fav.leagueId);
  if (!league) { state.myteams.byKey.set(fav.favKey, { error: true, loading: false }); return; }
  try {
    const d = await fetchTeamDetail(league, fav.teamId);
    const now = Date.now();
    const finals = d.schedule.filter((g) => g.isFinal);
    const lastGame = finals[finals.length - 1] || null;
    const nextGame = d.schedule.find((g) => g.isLive || (!g.isFinal && Number.isFinite(g.startMs) && g.startMs >= now - 3 * 3600 * 1000)) || null;
    const recentForm = finals.slice(-5); // last 5 finals for the form pills
    state.myteams.byKey.set(fav.favKey, { result: { team: d.team, lastGame, nextGame, recentForm, schedule: d.schedule }, loading: false });
  } catch (e) {
    state.myteams.byKey.set(fav.favKey, { error: true, loading: false });
  }
  if (getSettings().view === 'myteams') render();
}

function myTeamsCards() {
  return favoriteTeamList().map((f) => ({ fav: f, ...(state.myteams.byKey.get(f.favKey) || { loading: true }) }));
}

// ---- generic view routing (today/upcoming/golf/standings share these) -------
function refreshCurrentView(opts = {}) {
  const v = getSettings().view;
  if (v === 'myteams') return loadMyTeams();
  if (v === 'standings') return loadStandings(true);
  return loadView(v, opts);
}
function currentAgg() {
  const v = getSettings().view;
  if (v === 'standings') return standingsAgg();
  if (v === 'myteams') return null;
  return aggregate(v === 'today' ? state.today : state.upcoming);
}

// ---- date stepper (browse previous/finished days & other days) --------------
function todayDateBar() {
  const today = isViewingToday();
  const label = relativeDayLabel(state.viewDate);   // Today / Yesterday / date
  const full = formatLocalDay(state.viewDate);

  // Jump-to-date: a native date input so any day is one tap away (no stepping).
  const picker = el('input', {
    type: 'date', class: 'date-input', value: localDayKey(state.viewDate),
    min: localDayKey(addDays(new Date(), -APP_CONFIG.maxPastDays)),
    max: localDayKey(addDays(new Date(), 366)),
    title: 'Jump to a date', aria: { label: 'Jump to a date' },
  });
  picker.addEventListener('change', () => { const d = parseLocalDate(picker.value); if (d) goToDate(d); });

  return el('div', { class: 'date-bar' }, [
    el('button', { class: 'btn ghost icon-btn', title: 'Previous day', aria: { label: 'Previous day' }, onclick: () => stepDay(-1) }, ['‹']),
    el('div', { class: 'date-label' }, [
      el('span', { class: 'date-main' }, [label]),
      label !== full ? el('span', { class: 'date-sub' }, [full]) : null,
    ]),
    el('button', { class: 'btn ghost icon-btn', title: 'Next day', aria: { label: 'Next day' }, onclick: () => stepDay(1) }, ['›']),
    el('label', { class: 'date-jump', title: 'Jump to a date' }, [el('span', { class: 'date-jump-ico', aria: { hidden: 'true' } }, ['📅']), picker]),
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

// Jump straight to a chosen day (from the date picker).
function goToDate(date) {
  if (!date || isSameLocalDay(date, state.viewDate)) return;
  const minDate = addDays(new Date(), -APP_CONFIG.maxPastDays);
  if (date < minDate) date = minDate;
  state.viewDate = date;
  state.today = new Map();
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

  // team/player/game drill-down overlays whatever tab is active
  if (state.detail.type === 'team') {
    const d = state.detail;
    mount(content, buildTeamView({
      result: d.result, loading: d.loading, error: d.error,
      schedView: d.schedView, calMonth: d.calMonth,
      onSetSchedView: setTeamSchedView, onTeamCalPrev: () => teamCalStep(-1), onTeamCalNext: () => teamCalStep(1),
      onSelectGame: (game) => openGame(game),
      onBack: backFromDetail,
      onSelectPlayer: (athleteId) => openPlayer(d.league, athleteId),
      onToggleFav: toggleDetailTeamFav,
      isFav: d.result ? isTeamFavorite(d.result.team.favKey) : false,
      onRetry: () => { backFromDetail(); openTeam(d.league.id, d.teamId); },
    }));
    renderStatusBar(s, null);
    return;
  }
  if (state.detail.type === 'player') {
    const d = state.detail;
    mount(content, buildPlayerView({
      result: d.result, loading: d.loading, error: d.error,
      backLabel: state.detailStack.length ? 'Back' : 'Back',
      onBack: backFromDetail,
      onRetry: () => { backFromDetail(); openPlayer(d.league, d.athleteId); },
    }));
    renderStatusBar(s, null);
    return;
  }
  if (state.detail.type === 'game') {
    const d = state.detail;
    mount(content, buildGameView({
      result: d.result, loading: d.loading, error: d.error,
      onBack: backFromDetail,
      onSelectPlayer: (athleteId) => openPlayer(d.league, athleteId),
      onRetry: () => { backFromDetail(); openGame({ leagueId: d.league.id, id: d.gameId }); },
    }));
    renderStatusBar(s, null);
    return;
  }

  // My Teams dashboard
  if (view === 'myteams') {
    mount(content, buildMyTeamsView({
      cards: myTeamsCards(),
      hasFavorites: favoriteTeamList().length > 0,
      onSelectTeam: (leagueId, teamId) => openTeam(leagueId, teamId),
      onSelectGame: (game) => openGame(game),
      onOpenSearch: () => openSearch(afterFavoritesChanged, openPlayerFromSearch),
    }));
    renderStatusBar(s, null);
    return;
  }

  // standings has its own view shape (league picker + tables)
  if (view === 'standings') {
    const st = state.standings;

    // golf archive (selected via the league dropdown)
    if (st.selectedId === 'golf') {
      const leagueSelect = el('div', { class: 'standings-bar' }, [
        el('span', { class: 'small muted' }, ['League']),
        leaguePicker({ leagues: standingsLeagues(), selectedId: 'golf', onSelect: selectStandingsLeague }),
      ]);
      const ga = state.golfArchive;
      const majors = MAJOR_LABELS.map((label) => {
        const m = ga.byMajor[label] || {};
        return { label, short: MAJOR_SHORT[label] || label, year: m.year || ga.years[0], leaderboard: m.leaderboard, loading: m.loading, error: m.error };
      });
      mount(content, buildGolfArchive({ leagueSelect, years: ga.years, majors, onSelectYear: selectGolfYear }));
      renderStatusBar(s, null);
      return;
    }

    // F1 / motorsport (selected via the league dropdown)
    if (st.selectedId === 'f1') {
      const leagueSelect = el('div', { class: 'standings-bar' }, [
        el('span', { class: 'small muted' }, ['League']),
        leaguePicker({ leagues: standingsLeagues(), selectedId: 'f1', onSelect: selectStandingsLeague }),
      ]);
      mount(content, buildRacingView({
        leagueSelect, result: state.racing.result, loading: state.racing.loading, error: state.racing.error, onRetry: loadRacing,
      }));
      renderStatusBar(s, null);
      return;
    }

    mount(content, buildStandingsView({
      leagues: standingsLeagues(),
      selectedId: st.selectedId,
      mode: st.mode,
      scope: st.scope,
      result: st.result,
      leaders: st.leaders,
      loading: st.loading,
      leadersLoading: st.leadersLoading,
      error: st.error,
      sortIndex: st.sortIndex,
      sortDir: st.sortDir,
      seasons: st.result?.seasons,
      activeSeason: st.season ?? st.result?.season,
      leadersAllTime: st.leadersAllTime,
      bracketNode: st.mode === 'bracket' ? buildBracketView({
        result: state.bracket.result, loading: state.bracket.loading, error: state.bracket.error,
        seasons: bracketSeasonOptions(),
        season: state.bracket.season ?? defaultBracketSeason(getLeague(st.selectedId)?.sport || 'basketball'),
        onSelectSeason: selectBracketSeason,
        onSelectGame: (game) => openGame(game),
        onRetry: () => { state.bracket.result = null; loadBracket(); },
      }) : null,
      calendarNode: st.mode === 'calendar' ? buildCalendarView({
        monthDate: state.calendar.monthDate, games: state.calendar.games, loading: state.calendar.loading,
        onPrev: () => calendarStep(-1), onNext: () => calendarStep(1), onToday: calendarThisMonth,
        onSelectGame: (game) => openGame(game),
      }) : null,
      onSelectLeague: selectStandingsLeague,
      onSelectSeason: selectStandingsSeason,
      onSelectTeam: (teamId) => openTeam(st.selectedId, teamId),
      onSelectPlayer: (athleteId, league) => openPlayer(league || getLeague(st.selectedId), athleteId),
      onSetMode: setStandingsMode,
      onSetAllTime: setLeadersAllTime,
      onSetScope: setStandingsScope,
      onExpandCategory: openLeadersExpand,
      onSort: sortStandings,
      onRetry: () => (st.mode === 'leaders' ? loadLeaders() : loadStandings(true)),
    }));
    renderStatusBar(s, standingsAgg());
    return;
  }

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
    onOpenGame: openGame,
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
      tabButton('myteams', 'My Teams', s.view),
      tabButton('today', 'Today', s.view),
      tabButton('upcoming', 'Upcoming', s.view),
      tabButton('standings', 'Standings', s.view),
    ]),

    el('div', { class: 'header-actions' }, [
      state.installPrompt ? el('button', { class: 'btn ghost', title: 'Install app', onclick: doInstall }, ['⤓ Install']) : null,
      el('button', {
        class: 'btn ghost icon-btn', title: 'Search teams, players & leagues', aria: { label: 'Search teams, players and leagues' },
        onclick: () => openSearch(afterFavoritesChanged, openPlayerFromSearch),
      }, ['🔍']),
      el('button', {
        class: 'btn ghost icon-btn', title: 'Refresh now', aria: { label: 'Refresh' },
        onclick: () => refreshCurrentView({ showSkeleton: false }),
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
      clearDetail(); // leaving any team/player/game drill-down
      if (getSettings().view === id) { render(); return; }
      await updateSettings({ view: id });
      render();
      // load the view if we don't have it yet (or refresh in background)
      if (id === 'myteams') { loadMyTeams(); return; }
      if (id === 'standings') { loadStandings(); return; }
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
  refreshCurrentView({ showSkeleton: false });
  loadTicker();
}

// ---- account / cloud sync (Firebase) ---------------------------------------
async function onUserChange(user) {
  const wasSignedIn = !!state.user;
  state.user = user;
  if (user) {
    await syncOnSignIn(user.uid);
  } else if (wasSignedIn) {
    setAdapter(new LocalStorageAdapter());   // signed out -> back to local
    await loadSettings(); await loadFavorites();
    applyTheme(getSettings().theme);
  }
  render();
  refreshCurrentView({ showSkeleton: false });
}

async function syncOnSignIn(uid) {
  setAdapter(new FirestoreAdapter(uid));
  // fresh cloud account: seed it from whatever is currently local
  const cloud = await store.get('followedLeagues', null);
  if (cloud === null) {
    await store.set('followedLeagues', followedLeagueIds());
    await store.set('favoriteTeams', favoriteTeamList());
    await store.set('settings', getSettings());
  }
  await loadSettings(); await loadFavorites();
  applyTheme(getSettings().theme);
}

async function doSignIn() { try { await signInGoogle(); } catch (e) { console.warn('[auth] sign-in failed', e); } }
async function doSignOut() { try { await signOutUser(); } catch (e) { console.warn('[auth] sign-out failed', e); } }

// Map a player-search hit to a league object (a configured league when we have
// one, else a synthesized {sport, league} good enough for the player endpoints).
function openPlayerFromSearch(p) {
  const known = LEAGUES.find((l) => l.sport === p.sport && l.league === p.leagueSlug) || getLeague(p.leagueSlug);
  const league = known || { id: p.leagueSlug || p.sport, sport: p.sport, league: p.leagueSlug, name: (p.leagueSlug || p.sport || '').toUpperCase() };
  openPlayer(league, p.athleteId);
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

  // Account / cloud sync
  const u = state.user;
  const accountBlock = el('div', { class: 'setting-group' }, [
    el('h3', {}, ['Account']),
    !authConfigured()
      ? el('p', { class: 'muted small' }, ['“Sign in with Google” isn’t set up yet — see the README → “Sign in with Google” to turn on cross-device sync. (The app works fully without it.)'])
      : (u
          ? el('div', {}, [
              el('p', { class: 'small' }, ['Signed in as ', el('strong', {}, [u.displayName || u.email || 'you'])]),
              el('p', { class: 'muted small' }, ['Your favorites & settings sync across your devices.']),
              el('button', { class: 'btn ghost', onclick: () => { overlay.remove(); doSignOut(); } }, ['Sign out']),
            ])
          : el('div', {}, [
              el('button', { class: 'btn', onclick: () => { overlay.remove(); doSignIn(); } }, ['Sign in with Google']),
              el('p', { class: 'muted small' }, ['Sync your favorites & settings across all your devices.']),
            ])),
  ]);

  // Search shortcut (also available from the header 🔍)
  const searchBlock = el('div', { class: 'setting-group' }, [
    el('button', {
      class: 'btn search-btn', onclick: () => { overlay.remove(); openSearch(afterFavoritesChanged, openPlayerFromSearch); },
    }, ['🔍  Search teams, players & leagues']),
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
    el('h3', {}, ['Region · language']),
    el('p', { class: 'muted small' }, ['Sets team-name spelling/language. Note: ESPN’s free data only includes US TV listings, so the “on TV” line always shows the US national broadcast (there’s no free source for Canadian/other listings).']),
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
  drawer.appendChild(accountBlock);
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
const APP_VERSION = '1.1.0';

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

  // heal any stale persisted view (e.g. the removed golf tab).
  if (!['myteams', 'today', 'upcoming', 'standings'].includes(getSettings().view)) await updateSettings({ view: 'today' });

  applyTheme(getSettings().theme);
  render();
  const bootView = getSettings().view;
  if (bootView === 'myteams') loadMyTeams();
  else if (bootView === 'standings') loadStandings();
  else loadView(bootView, { showSkeleton: true });

  // Favorites live ticker — load independently of the active tab so it's always current.
  loadTicker();

  // Pre-warm the search team index in the background so the first 🔍 search is
  // instant. Deferred to idle so it doesn't compete with the initial scores
  // fetch, and persisted for a day so it doesn't re-harvest on every launch.
  const prewarm = () => buildTeamIndex().catch(() => {});
  if ('requestIdleCallback' in window) requestIdleCallback(prewarm, { timeout: 5000 });
  else setTimeout(prewarm, 3000);

  // refresh on regaining focus / connectivity (cheap correctness wins)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') { refreshCurrentView({ showSkeleton: false }); loadTicker(); }
  });
  window.addEventListener('online', () => { render(); refreshCurrentView({ showSkeleton: false }); loadTicker(); });
  window.addEventListener('offline', () => render());

  // keep "updated Xs ago" honest
  setInterval(() => { if (document.visibilityState === 'visible') renderStatusBar(getSettings(), currentAgg()); }, 15000);

  onFavoritesChange(() => {/* re-render handled by callers */});

  // capture install prompt
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    state.installPrompt = e;
    render();
  });

  registerServiceWorker();

  // If Firebase is configured, restore any signed-in session + start syncing.
  initAuth(onUserChange);
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch((e) => console.warn('[sw] registration failed', e));
  });
}

boot();
