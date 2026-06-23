// =============================================================================
// data/teamstats.js — advanced / season team stats from ESPN's CORE API, which
// (unlike site.api /teams) IS CORS-open. Stats are inline name/displayValue pairs
// grouped into categories:
//   GET sports.core.api.espn.com/v2/sports/{sport}/leagues/{league}/seasons/{yr}/
//       types/{type}/teams/{id}/statistics  ->  { splits: { categories:[{name, stats:[{name,displayValue}]}] } }
//
// We curate a fan-relevant subset per sport (stat NAMES verified live 2026-06).
// Notes on honesty:
//   • ESPN doesn't label literal offensive/defensive/net "rating" — we surface the
//     real metrics it does expose (pace, points/possession, GF-GA, PP%/PK%, ...).
//   • Soccer season possession IS here (possessionPct); xG is NOT in the free feed.
// =============================================================================

import { getJSON } from './http.js';

const CORE = 'https://sports.core.api.espn.com/v2/sports';

// [statName, label, category?] — category disambiguates name collisions
// (e.g. MLB `homeRuns`/`strikeouts` exist in both batting and pitching).
const PICKS = {
  basketball: [
    ['avgPoints', 'Points / Game'], ['paceFactor', 'Pace'],
    ['pointsPerEstimatedPossessions', 'Points / Poss.'], ['shootingEfficiency', 'Shooting Eff.'],
    ['pointsInPaint', 'Points in Paint'], ['fastBreakPoints', 'Fast-Break Pts'],
  ],
  hockey: [
    ['avgGoals', 'Goals / Game', 'offensive'], ['avgGoalsAgainst', 'Goals Against / Game', 'defensive'],
    ['goalDifferential', 'Goal Differential', 'general'], ['powerPlayPct', 'Power Play %', 'offensive'],
    ['penaltyKillPct', 'Penalty Kill %', 'defensive'], ['avgShots', 'Shots / Game', 'offensive'],
    ['faceoffPercent', 'Faceoff %', 'offensive'], ['savePct', 'Save %', 'defensive'],
  ],
  football: [
    ['totalPointsPerGame', 'Points / Game', 'passing'], ['yardsPerGame', 'Total Yards / Game', 'passing'],
    ['passingYardsPerGame', 'Pass Yards / Game', 'passing'], ['rushingYardsPerGame', 'Rush Yards / Game', 'rushing'],
    ['completionPct', 'Completion %', 'passing'], ['yardsPerRushAttempt', 'Yards / Rush', 'rushing'],
    ['QBRating', 'Passer Rating', 'passing'],
  ],
  baseball: [
    ['avg', 'Batting AVG', 'batting'], ['onBasePct', 'OBP', 'batting'], ['slugAvg', 'SLG', 'batting'],
    ['OPS', 'OPS', 'batting'], ['homeRuns', 'Home Runs', 'batting'], ['runs', 'Runs', 'batting'],
    ['ERA', 'Team ERA', 'pitching'], ['WHIP', 'WHIP', 'pitching'],
  ],
  soccer: [
    ['totalGoals', 'Goals', 'offensive'], ['avgGoals', 'Goals / Game', 'offensive'],
    ['totalShots', 'Shots', 'offensive'], ['shotsOnTarget', 'Shots on Target', 'offensive'],
    ['possessionPct', 'Possession %', 'offensive'], ['goalConversion', 'Goal Conversion %', 'offensive'],
    ['goalsConceded', 'Goals Conceded', 'goalKeeping'], ['cleanSheet', 'Clean Sheets', 'goalKeeping'],
  ],
};

const seasonType = (sport) => (sport === 'soccer' ? 1 : 2);

function readStats(data, picks) {
  const cats = (data && data.splits && data.splits.categories) || [];
  const byCat = {};      // category -> { statName: displayValue }
  const anyCat = {};     // first-seen statName -> displayValue
  for (const c of cats) {
    byCat[c.name] = byCat[c.name] || {};
    for (const s of (c.stats || [])) {
      if (!s || s.name == null) continue;
      byCat[c.name][s.name] = s.displayValue;
      if (!(s.name in anyCat)) anyCat[s.name] = s.displayValue;
    }
  }
  const out = [];
  for (const [name, label, cat] of picks) {
    const v = cat ? (byCat[cat] || {})[name] : anyCat[name];
    if (v != null && v !== '') out.push({ label, value: String(v) });
  }
  return out;
}

// Returns { stats:[{label,value}], season, note }. Never throws — empty stats just
// hide the panel. Tries the current season year then the previous (handles e.g.
// NFL in the offseason, where the new season's regular-season stats don't exist yet).
export async function fetchTeamAdvancedStats(league, teamId) {
  const picks = PICKS[league.sport];
  if (!picks) return { stats: [] };
  const type = seasonType(league.sport);
  const y = new Date().getFullYear();
  for (const yr of [y, y - 1]) {
    const url = `${CORE}/${league.sport}/leagues/${league.league}/seasons/${yr}/types/${type}/teams/${teamId}/statistics`;
    try {
      const res = await getJSON(url, { cacheKey: `teamstats:${league.id}:${teamId}:${yr}`, ttlMs: 6 * 3600 * 1000 });
      const stats = readStats(res.data, picks);
      if (stats.length) {
        return {
          stats, season: yr,
          note: league.sport === 'soccer' ? 'Season averages. Per-match possession & shots appear on each game page. (xG isn’t in ESPN’s free data.)' : '',
        };
      }
    } catch { /* try the previous season */ }
  }
  return { stats: [], note: '' };
}
