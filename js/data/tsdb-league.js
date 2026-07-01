// =============================================================================
// data/tsdb-league.js — data adapter for a league powered by TheSportsDB instead
// of ESPN (currently the Croatian HNL, which ESPN doesn't carry). Provides the
// same normalized shapes the ESPN fetchers return, so the rest of the app is
// unchanged — a league with `source: 'tsdb'` just routes here.
//
// TheSportsDB v1 (CORS-open). Default free key "123" (what a free account shows).
// NOTE: TheSportsDB's FREE tier caps the standings table at ~5 rows and the season
// schedule at ~15 events — that's their limit, not ours. The full table/schedule
// needs their paid tier (a personal key), which can be set in Settings to override.
//   Schedule: eventsseason.php?id={tsdbLeagueId}&s=YYYY-YYYY
//   Table:    lookuptable.php?l={tsdbLeagueId}&s=YYYY-YYYY
// =============================================================================

import { getJSON } from './http.js';
import { teamFavKey } from '../store/favorites.js';
import { getSettings } from '../store/settings.js';

const BASE = 'https://www.thesportsdb.com/api/v1/json';

// Free default is "123"; a personal (paid) key set in Settings overrides it.
function apiKey() { return (getSettings().tsdbKey || '').trim() || '123'; }
function stripTiny(u) { return (u || '').replace(/\/tiny$/, ''); }

// European seasons run Aug→May; we key them by their START year (numeric, so the
// existing numeric-season plumbing works). 2025 ⇒ the "2025-2026" season.
export function currentTsdbStartYear(d = new Date()) {
  return d.getMonth() >= 7 ? d.getFullYear() : d.getFullYear() - 1;
}
const seasonStr = (startYear) => `${startYear}-${startYear + 1}`;
const seasonForMs = (ms) => currentTsdbStartYear(new Date(ms));

function ymdToMs(ymd) {
  if (!ymd || ymd.length < 8) return NaN;
  return new Date(Number(ymd.slice(0, 4)), Number(ymd.slice(4, 6)) - 1, Number(ymd.slice(6, 8))).getTime();
}

function normalizeTsdbEvent(ev, league) {
  const hs = ev.intHomeScore;
  const as = ev.intAwayScore;
  const hasScore = hs != null && hs !== '' && as != null && as !== '';
  const startMs = ev.strTimestamp ? Date.parse(ev.strTimestamp)
    : (ev.dateEvent ? Date.parse(`${ev.dateEvent}T${ev.strTime || '00:00:00'}Z`) : NaN);
  const status = (ev.strStatus || '').toUpperCase();
  const postponed = /^(y|pp|postp)/i.test(ev.strPostponed || '') || /POSTP|CANC/.test(status);
  const finished = /FT|AET|PEN|FINISH/.test(status)
    || (hasScore && Number.isFinite(startMs) && startMs < Date.now() - 3 * 3600 * 1000);
  const state = finished ? 'post' : 'pre';

  const side = (name, id, badge, score) => ({
    favKey: teamFavKey('soccer', String(id || '')),
    teamId: String(id || ''), sport: 'soccer', leagueId: league.id,
    abbr: (name || '').replace(/^(NK|HNK|GNK)\s+/i, '').slice(0, 3).toUpperCase(),
    name: name || '', displayName: name || 'TBD', location: '', color: '', altColor: '',
    logo: stripTiny(badge || ''),
    score: hasScore ? String(score) : '', scoreNum: hasScore ? Number(score) : null,
    winner: false, record: '', form: '',
  });
  const home = side(ev.strHomeTeam, ev.idHomeTeam, ev.strHomeTeamBadge, hs);
  const away = side(ev.strAwayTeam, ev.idAwayTeam, ev.strAwayTeamBadge, as);
  if (finished && hasScore) { home.winner = Number(hs) > Number(as); away.winner = Number(as) > Number(hs); }
  const isDraw = finished && hasScore && Number(hs) === Number(as);

  return {
    id: String(ev.idEvent), leagueId: league.id, league, sport: 'soccer', hasDraws: true, source: 'tsdb',
    dateUTC: ev.strTimestamp || ev.dateEvent, startMs,
    state, isPre: state === 'pre', isLive: false, isFinal: state === 'post', completed: finished,
    statusDetail: postponed ? 'Postponed' : (finished ? 'FT' : ''), statusFull: '', statusDescription: '',
    displayClock: '', period: 0, isDraw,
    neutralSite: false, venue: ev.strVenue || '', note: ev.intRound ? `Round ${ev.intRound}` : '', broadcast: '',
    home, away,
  };
}

// Same return shape as data/espn.js fetchScoreboard.
export async function fetchTsdbScoreboard(league, datesParam) {
  // Pick the season from the requested window's start date (so past months in the
  // calendar work); default to the current season for "today"/upcoming.
  let startYear = currentTsdbStartYear();
  if (datesParam) {
    const startMs = ymdToMs(datesParam.split('-')[0]);
    if (Number.isFinite(startMs)) startYear = seasonForMs(startMs);
  }
  const season = seasonStr(startYear);
  const url = `${BASE}/${apiKey()}/eventsseason.php?id=${league.tsdbLeagueId}&s=${season}`;
  const res = await getJSON(url, { cacheKey: `tsdb:events:${league.id}:${season}`, ttlMs: 10 * 60 * 1000 });

  let games = (res.data?.events || [])
    .map((ev) => { try { return normalizeTsdbEvent(ev, league); } catch { return null; } })
    .filter(Boolean);

  if (datesParam) {
    const [a, b] = datesParam.split('-');
    const lo = ymdToMs(a);
    const hi = (b ? ymdToMs(b) : lo) + 86400000;
    games = games.filter((g) => Number.isFinite(g.startMs) && g.startMs >= lo && g.startMs < hi);
  }
  games.sort((x, y) => (x.startMs || 0) - (y.startMs || 0));
  return { league, games, fetchedAt: res.fetchedAt, stale: res.stale, source: 'tsdb', error: res.error };
}

const TABLE_COLS = [['P', 'P'], ['W', 'W'], ['D', 'D'], ['L', 'L'], ['GF', 'GF'], ['GA', 'GA'], ['GD', 'GD'], ['PTS', 'PTS']];

// Same return shape as data/standings.js fetchStandings.
export async function fetchTsdbStandings(league, season) {
  const curY = currentTsdbStartYear();
  const startYear = season || curY;
  const s = seasonStr(startYear);
  const url = `${BASE}/${apiKey()}/lookuptable.php?l=${league.tsdbLeagueId}&s=${s}`;
  const res = await getJSON(url, { cacheKey: `tsdb:table:${league.id}:${s}`, ttlMs: 10 * 60 * 1000 });

  const rows = (res.data?.table || []).map((t) => {
    const vals = [t.intPlayed, t.intWin, t.intDraw, t.intLoss, t.intGoalsFor, t.intGoalsAgainst, t.intGoalDifference, t.intPoints].map(Number);
    return {
      teamId: String(t.idTeam || ''), name: t.strTeam || '', abbr: (t.strTeam || '').slice(0, 3).toUpperCase(),
      logo: stripTiny(t.strBadge || ''), favKey: teamFavKey('soccer', String(t.idTeam || '')),
      clinch: '', noTeamPage: true, form: t.strForm || '',
      cells: vals.map((v) => (Number.isFinite(v) ? String(v) : '—')),
      values: vals.map((v) => (Number.isFinite(v) ? v : NaN)),
    };
  });
  const seasons = Array.from({ length: 6 }, (_, i) => ({ year: curY - i, label: `${curY - i}-${String(curY - i + 1).slice(2)}` }));
  return {
    league, groups: rows.length ? [{ name: '', rows }] : [],
    columns: TABLE_COLS, defaultSortIndex: 7 /* PTS */,
    seasons, currentSeason: curY, season: startYear,
    fetchedAt: res.fetchedAt, stale: res.stale, error: res.error,
  };
}
