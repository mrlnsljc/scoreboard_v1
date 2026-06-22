// =============================================================================
// data/golf.js — golf MAJOR tracking (a different shape from team sports).
//
// Verified shapes (2026-06, ESPN, all CORS-open):
//   GET https://site.api.espn.com/apis/site/v2/sports/golf/pga/scoreboard
//     -> { leagues:[{ calendar:[{ label, startDate, endDate }] }],   // season schedule
//          events:[{ name, status:{type:{state,completed,shortDetail}},
//                    competitions:[{ competitors:[{
//                      athlete:{ displayName, shortName, flag:{href,alt} },
//                      score:"-5",                       // total to par (string)
//                      linescores:[{ displayValue:"-6", linescores:[ <holes> ] }] // per round
//                    }]}]}] }
//   GET .../golf/pga/scoreboard?dates=YYYYMMDD  -> the tournament around that date
//      (so a past major's final leaderboard + winner is fetchable by its date).
//
// The four majors are identified by their calendar labels.
// Positions are computed from to-par (ESPN doesn't always inline them), with
// ties marked "T". today/thru for live rounds are best-effort from linescores.
// =============================================================================

import { getJSON } from './http.js';
import { APP_CONFIG } from '../config.js';

const PGA_SCOREBOARD = 'https://site.api.espn.com/apis/site/v2/sports/golf/pga/scoreboard';

// Calendar labels ESPN uses for the four men's majors, in calendar order.
export const MAJOR_LABELS = ['Masters Tournament', 'PGA Championship', 'U.S. Open', 'The Open'];
// Friendlier short names for the UI.
export const MAJOR_SHORT = {
  'Masters Tournament': 'The Masters',
  'PGA Championship': 'PGA Champ.',
  'U.S. Open': 'U.S. Open',
  'The Open': 'The Open',
};

function parToNum(s) {
  if (s == null) return null;
  const t = String(s).trim().toUpperCase();
  if (t === 'E') return 0;
  const n = parseInt(t.replace('+', ''), 10);
  return Number.isNaN(n) ? null : n;
}

// Pretty total: 0 -> "E", 3 -> "+3", -5 -> "-5"
function fmtPar(n) {
  if (n == null) return '—';
  if (n === 0) return 'E';
  return n > 0 ? `+${n}` : `${n}`;
}

// Normalize one tournament event into a leaderboard.
function normalizeEvent(ev) {
  if (!ev) return null;
  const comp = (ev.competitions && ev.competitions[0]) || {};
  const type = (ev.status && ev.status.type) || {};
  const state = type.state || 'pre';

  const competitors = comp.competitors || [];
  const players = competitors.map((c) => {
    const ath = c.athlete || {};
    const totalNum = parToNum(c.score);
    const rounds = (c.linescores || []).map((l) => l.displayValue || '');
    // best-effort live "today" + "thru" from the current (last) round's holes
    let today = '';
    let thru = '';
    if (state === 'in' && c.linescores && c.linescores.length) {
      const cur = c.linescores[c.linescores.length - 1];
      today = cur.displayValue || '';
      const holes = (cur.linescores || []).filter((h) => h && (h.value != null)).length;
      thru = holes >= 18 ? 'F' : (holes ? String(holes) : '');
    }
    return {
      name: ath.displayName || ath.shortName || 'TBD',
      shortName: ath.shortName || ath.displayName || '',
      flagHref: ath.flag?.href || '',
      flagAlt: ath.flag?.alt || '',
      total: fmtPar(totalNum),
      totalNum,
      rounds,
      today,
      thru,
    };
  });

  // sort by to-par (lower is better); unknown scores to the bottom
  players.sort((a, b) => {
    const av = a.totalNum == null ? 9999 : a.totalNum;
    const bv = b.totalNum == null ? 9999 : b.totalNum;
    return av - bv;
  });

  // assign positions with ties ("T5"); blank for unscored
  let lastScore = null; let lastPos = 0;
  players.forEach((p, i) => {
    if (p.totalNum == null) { p.posText = '—'; return; }
    if (p.totalNum !== lastScore) { lastPos = i + 1; lastScore = p.totalNum; }
    const tied = players.filter((q) => q.totalNum === p.totalNum).length > 1;
    p.rank = lastPos;
    p.posText = (tied ? 'T' : '') + lastPos;
  });
  if (players[0] && state === 'post') players[0].isWinner = players[0].rank === 1;

  const maxRounds = players.reduce((m, p) => Math.max(m, p.rounds.length), 0);

  return {
    name: ev.name || '',
    state,
    isLive: state === 'in',
    isFinal: state === 'post',
    isPre: state === 'pre',
    statusDetail: type.shortDetail || type.detail || (state === 'in' ? 'In Progress' : state === 'post' ? 'Final' : 'Scheduled'),
    maxRounds,
    players,
  };
}

function yyyymmddOf(iso) {
  return (iso || '').slice(0, 10).replace(/-/g, '');
}

// Fetch the *current* PGA scoreboard, which carries both the live tournament and
// the full season calendar (so we can derive the majors list in one call).
export async function fetchGolfState() {
  const res = await getJSON(`${PGA_SCOREBOARD}?_=majors`, { cacheKey: 'golf:current', ttlMs: APP_CONFIG.scoreboardTtlMs });
  const data = res.data || {};
  const calendar = data.leagues?.[0]?.calendar || [];
  const currentEvent = data.events?.[0] || null;
  const currentName = currentEvent?.name || '';
  const now = Date.now();

  const majors = MAJOR_LABELS
    .map((label) => {
      const cal = calendar.find((c) => (c.label || '') === label);
      if (!cal) return null;
      const start = Date.parse(cal.startDate);
      const end = Date.parse(cal.endDate) + 24 * 3600 * 1000; // tournaments run into the final day
      let status = 'upcoming';
      if (now > end) status = 'final';
      else if (now >= start) status = 'live';
      const isCurrent = currentName === label; // the scoreboard's active event
      return { label, short: MAJOR_SHORT[label] || label, startDate: cal.startDate, endDate: cal.endDate, status, isCurrent };
    })
    .filter(Boolean);

  return {
    majors,
    current: currentName,
    currentLeaderboard: normalizeEvent(currentEvent),
    fetchedAt: res.fetchedAt,
    stale: res.stale,
    error: res.error,
  };
}

// Fetch a specific major's leaderboard. If it's the current live event we reuse
// the current scoreboard; otherwise we fetch by the major's start date.
export async function fetchMajorLeaderboard(major) {
  const dateParam = yyyymmddOf(major.startDate);
  const res = await getJSON(`${PGA_SCOREBOARD}?dates=${dateParam}`, {
    cacheKey: `golf:major:${dateParam}`, ttlMs: APP_CONFIG.scoreboardTtlMs,
  });
  const ev = res.data?.events?.[0] || null;
  return { leaderboard: normalizeEvent(ev), fetchedAt: res.fetchedAt, stale: res.stale, error: res.error };
}

// Approx calendar windows (MMDD) each major falls in, so a PAST year's major can
// be located (the live calendar only covers the current season).
const MAJOR_WINDOWS = {
  'Masters Tournament': ['0401', '0416'],
  'PGA Championship': ['0508', '0527'],
  'U.S. Open': ['0610', '0626'],
  'The Open': ['0710', '0727'],
};

// Fetch a major's leaderboard for a specific calendar year (used by the golf
// archive under Standings). Queries the window and matches the event by name.
export async function fetchMajorByYear(label, year) {
  const w = MAJOR_WINDOWS[label];
  if (!w) return { leaderboard: null };
  const dates = `${year}${w[0]}-${year}${w[1]}`;
  const ttl = year < new Date().getFullYear() ? 7 * 24 * 3600 * 1000 : APP_CONFIG.scoreboardTtlMs;
  const res = await getJSON(`${PGA_SCOREBOARD}?dates=${dates}`, { cacheKey: `golf:major:${label}:${year}`, ttlMs: ttl });
  const ev = (res.data?.events || []).find((e) => (e.name || '') === label) || null;
  return { leaderboard: normalizeEvent(ev), fetchedAt: res.fetchedAt, stale: res.stale, error: res.error };
}
