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
// Each pick: { n: statName, label: header, desc: plain-English meaning, cat?: category
// to disambiguate name collisions (e.g. MLB homeRuns/strikeouts exist in batting & pitching) }.
const PICKS = {
  basketball: [
    { n: 'avgPoints', label: 'Points / Game', desc: 'Average points scored per game' },
    { n: 'paceFactor', label: 'Pace', desc: 'Possessions per 48 minutes' },
    { n: 'pointsPerEstimatedPossessions', label: 'Points / Possession', desc: 'Offensive efficiency (≈ offensive rating ÷ 100)' },
    { n: 'shootingEfficiency', label: 'Shooting Efficiency', desc: 'Points produced per shot taken' },
    { n: 'pointsInPaint', label: 'Points in Paint', desc: 'Total points scored near the basket' },
    { n: 'fastBreakPoints', label: 'Fast-Break Points', desc: 'Total points off transition / fast breaks' },
  ],
  hockey: [
    { n: 'avgGoals', label: 'Goals / Game', desc: 'Average goals scored per game', cat: 'offensive' },
    { n: 'avgGoalsAgainst', label: 'Goals Against / Game', desc: 'Average goals allowed per game', cat: 'defensive' },
    { n: 'goalDifferential', label: 'Goal Differential', desc: 'Goals scored minus goals allowed', cat: 'general' },
    { n: 'powerPlayPct', label: 'Power Play %', desc: 'Share of power plays that produce a goal', cat: 'offensive' },
    { n: 'penaltyKillPct', label: 'Penalty Kill %', desc: 'Share of penalties killed without allowing a goal', cat: 'defensive' },
    { n: 'avgShots', label: 'Shots / Game', desc: 'Average shots on goal per game', cat: 'offensive' },
    { n: 'faceoffPercent', label: 'Faceoff %', desc: 'Share of faceoffs won', cat: 'offensive' },
    { n: 'savePct', label: 'Save %', desc: 'Share of shots faced that were saved', cat: 'defensive' },
  ],
  football: [
    { n: 'totalPointsPerGame', label: 'Points / Game', desc: 'Average points scored per game', cat: 'passing' },
    { n: 'yardsPerGame', label: 'Total Yards / Game', desc: 'Average total offensive yards per game', cat: 'passing' },
    { n: 'passingYardsPerGame', label: 'Pass Yards / Game', desc: 'Average passing yards per game', cat: 'passing' },
    { n: 'rushingYardsPerGame', label: 'Rush Yards / Game', desc: 'Average rushing yards per game', cat: 'rushing' },
    { n: 'completionPct', label: 'Completion %', desc: 'Share of pass attempts completed', cat: 'passing' },
    { n: 'yardsPerRushAttempt', label: 'Yards / Rush', desc: 'Average yards gained per rushing attempt', cat: 'rushing' },
    { n: 'QBRating', label: 'Passer Rating', desc: 'NFL passer rating (0–158.3 scale)', cat: 'passing' },
  ],
  baseball: [
    { n: 'avg', label: 'Batting Average', desc: 'Hits per at-bat (AVG)', cat: 'batting' },
    { n: 'onBasePct', label: 'On-Base %', desc: 'How often a batter reaches base (OBP)', cat: 'batting' },
    { n: 'slugAvg', label: 'Slugging %', desc: 'Total bases per at-bat (SLG)', cat: 'batting' },
    { n: 'OPS', label: 'OPS', desc: 'On-base plus slugging', cat: 'batting' },
    { n: 'homeRuns', label: 'Home Runs', desc: 'Total home runs hit', cat: 'batting' },
    { n: 'runs', label: 'Runs', desc: 'Total runs scored', cat: 'batting' },
    { n: 'ERA', label: 'Team ERA', desc: 'Earned runs allowed per 9 innings', cat: 'pitching' },
    { n: 'WHIP', label: 'WHIP', desc: 'Walks + hits allowed per inning pitched', cat: 'pitching' },
  ],
  soccer: [
    { n: 'totalGoals', label: 'Goals', desc: 'Total goals scored this season', cat: 'offensive' },
    { n: 'avgGoals', label: 'Goals / Game', desc: 'Average goals scored per match', cat: 'offensive' },
    { n: 'totalShots', label: 'Shots', desc: 'Total shots taken this season', cat: 'offensive' },
    { n: 'shotsOnTarget', label: 'Shots on Target', desc: 'Shots that were on goal', cat: 'offensive' },
    { n: 'possessionPct', label: 'Possession %', desc: 'Average share of ball possession', cat: 'offensive' },
    { n: 'goalConversion', label: 'Goal Conversion %', desc: 'Share of shots that became goals', cat: 'offensive' },
    { n: 'goalsConceded', label: 'Goals Conceded', desc: 'Total goals allowed this season', cat: 'goalKeeping' },
    { n: 'cleanSheet', label: 'Clean Sheets', desc: 'Matches without conceding a goal', cat: 'goalKeeping' },
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
  for (const p of picks) {
    const v = p.cat ? (byCat[p.cat] || {})[p.n] : anyCat[p.n];
    if (v != null && v !== '') out.push({ label: p.label, value: String(v), desc: p.desc || '' });
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
