// =============================================================================
// data/bracket.js — playoff / knockout BRACKET, current or any past season.
//
// Two shapes of postseason exist in ESPN's data:
//  • SOCCER tournaments (World Cup, UCL, …) tag each game with a round via
//    `event.season.slug` (round-of-32 / quarterfinals / final / …) → clean rounds.
//  • TEAM-LEAGUE playoffs (NBA/NHL/MLB/NFL) tag every game `post-season` with NO
//    round, but each game carries `competition.series` (summary like "NY wins 4-2",
//    competitors' wins). We reconstruct SERIES by team-pair and CLUSTER them into
//    rounds by start-date gaps (rounds are separated in time).
//
// A `season` (year) lets you view completed seasons' brackets. Per-sport playoff
// date windows are used because ESPN's seasontype filter is unreliable and full
// season ranges get truncated by the result limit.
// =============================================================================

import { getJSON } from './http.js';
import { normalizeEvent } from './espn.js';
import { getRegion } from '../config.js';
import { getSettings } from '../store/settings.js';

const SITE = 'https://site.api.espn.com/apis/site/v2/sports';
const KNOCKOUT_SLUG = /round-of|final|quarter|semi|knockout|round-16|round-32|place/i;
const NOT_BRACKET = /group|regular|preseason|friendl|qualif/i;

const ROUND_LABELS = {
  'round-of-64': 'Round of 64', 'round-of-32': 'Round of 32', 'round-of-16': 'Round of 16',
  quarterfinals: 'Quarterfinals', quarterfinal: 'Quarterfinals',
  semifinals: 'Semifinals', semifinal: 'Semifinals',
  final: 'Final', 'third-place-match': '3rd Place', '3rd-place-match': '3rd Place',
};
const titleCase = (s) => String(s || '').replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

// Date window(s) (YYYYMMDD-YYYYMMDD) where a given season's postseason lives.
function postseasonRanges(sport, year) {
  switch (sport) {
    case 'basketball':
    case 'hockey':   return [`${year}0401-${year}0720`];          // playoffs Apr–mid-Jul
    case 'baseball': return [`${year}0928-${year}1120`];          // Oct–mid-Nov
    case 'football': return [`${year + 1}0101-${year + 1}0220`];  // NFL playoffs are the NEXT Jan/Feb
    default:         return [`${year}0101-${year}1231`];          // soccer tournaments fall within the year
  }
}

// A sensible default season: the most recently COMPLETED postseason for the sport.
export function defaultBracketSeason(sport) {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth(); // 0-11
  if (sport === 'basketball' || sport === 'hockey') return m >= 5 ? y : y - 1; // ends ~June
  if (sport === 'baseball') return m >= 10 ? y : y - 1;                        // ends ~Nov
  if (sport === 'football') return m >= 2 ? y - 1 : y - 2;                     // season Y → plays out Jan Y+1
  return y; // soccer tournaments
}

function statSeriesWinner(summary, homeWins, awayWins) {
  const decided = /win/i.test(summary || '');
  return {
    homeWin: decided && (homeWins ?? -1) > (awayWins ?? -1),
    awayWin: decided && (awayWins ?? -1) > (homeWins ?? -1),
  };
}

function buildSlugRounds(games) {
  const byRound = new Map();
  for (const g of games) {
    const slug = g._slug;
    if (!slug || NOT_BRACKET.test(slug) || !KNOCKOUT_SLUG.test(slug)) continue;
    if (!byRound.has(slug)) byRound.set(slug, []);
    byRound.get(slug).push(g);
  }
  return [...byRound.entries()].map(([slug, gs]) => ({
    label: ROUND_LABELS[slug] || titleCase(slug),
    minMs: Math.min(...gs.map((g) => (Number.isFinite(g.startMs) ? g.startMs : Infinity))),
    matches: gs.sort((a, b) => (a.startMs || 0) - (b.startMs || 0)).map((g) => ({ kind: 'game', game: g })),
  })).sort((a, b) => a.minMs - b.minMs);
}

function seriesRoundLabel(i, total) {
  if (i === total - 1) return 'Final';
  if (i === total - 2) return total >= 4 ? 'Conference Finals' : 'Semifinals';
  if (i === total - 3) return 'Conference Semifinals';
  return `Round ${i + 1}`;
}

function buildSeriesRounds(games) {
  const pog = games.filter((g) => /post-season/i.test(g._slug));
  if (!pog.length) return [];

  // group games into series by unordered team-pair
  const byPair = new Map();
  for (const g of pog) {
    if (!g.home.teamId || !g.away.teamId) continue;
    const key = [g.home.teamId, g.away.teamId].sort().join('~');
    if (!byPair.has(key)) byPair.set(key, []);
    byPair.get(key).push(g);
  }

  const series = [...byPair.values()].map((gs) => {
    gs.sort((a, b) => (a.startMs || 0) - (b.startMs || 0));
    const last = gs[gs.length - 1];
    const s = last._series;
    let homeWins = null;
    let awayWins = null;
    for (const c of (s?.competitors || [])) {
      const tid = String(c.team?.id ?? c.id ?? '');
      if (tid === last.home.teamId) homeWins = c.wins;
      else if (tid === last.away.teamId) awayWins = c.wins;
    }
    const { homeWin, awayWin } = statSeriesWinner(s?.summary, homeWins, awayWins);
    return {
      kind: 'series', startMs: gs[0].startMs, game: last, home: last.home, away: last.away,
      homeWins, awayWins, homeWin, awayWin, summary: s?.summary || '', live: gs.some((g) => g.isLive),
    };
  }).sort((a, b) => (a.startMs || 0) - (b.startMs || 0));

  // cluster into rounds: a new round starts when a series begins >4 days after the
  // latest start in the current round (rounds are separated in time).
  const rounds = [];
  let cur = null;
  for (const s of series) {
    if (!cur || (s.startMs - cur.maxStart) > 4 * 86400000) { cur = { items: [], maxStart: s.startMs }; rounds.push(cur); }
    cur.items.push(s);
    cur.maxStart = Math.max(cur.maxStart, s.startMs);
  }
  const n = rounds.length;
  return rounds.map((r, i) => ({ label: seriesRoundLabel(i, n), matches: r.items }));
}

export async function fetchBracket(league, year) {
  // Non-ESPN leagues (Croatian HNL) have no bracket feed.
  if (league.source === 'tsdb') return { league, season: year || defaultBracketSeason(league.sport), rounds: [], empty: true };
  const { region, lang } = getRegion(getSettings().regionCode);
  const yr = year || defaultBracketSeason(league.sport);
  const ranges = postseasonRanges(league.sport, yr);

  const events = [];
  let stale = false;
  for (const range of ranges) {
    const url = `${SITE}/${league.sport}/${league.league}/scoreboard?dates=${range}&limit=300&region=${region}&lang=${lang}`;
    try {
      const res = await getJSON(url, { cacheKey: `bracket:${league.id}:${yr}:${range}`, ttlMs: 30 * 60 * 1000 }); // eslint-disable-line no-await-in-loop
      events.push(...(res.data?.events || []));
      stale = stale || res.stale;
    } catch { /* skip this range */ }
  }

  const games = [];
  for (const ev of events) {
    let g;
    try { g = normalizeEvent(ev, league); } catch { continue; }
    g._slug = ev.season?.slug || ev.competitions?.[0]?.notes?.[0]?.headline || '';
    g._series = ev.competitions?.[0]?.series || null;
    games.push(g);
  }

  // Prefer real knockout-slug rounds (soccer tournaments); else reconstruct series.
  let rounds = buildSlugRounds(games);
  if (!rounds.length) rounds = buildSeriesRounds(games);

  return { league, season: yr, rounds, empty: rounds.length === 0, stale };
}
