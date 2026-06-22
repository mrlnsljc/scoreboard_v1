// =============================================================================
// data/standings.js — league standings tables (CORS-open, verified 2026-06).
//
//   GET https://site.api.espn.com/apis/v2/sports/{sport}/{league}/standings
//     -> { name, children:[ { name, standings:{ entries:[ {
//            team:{ id, displayName, abbreviation, logos:[{href,rel}] },
//            stats:[ { name, displayValue } ]   // generic name/value pairs
//          } ] } } ] }
//
// Grouping varies: soccer = one flat table; NHL/NBA = conferences; NFL =
// conferences -> divisions (nested). We recursively collect any node that has
// `standings.entries`. The `stats` array is generic, so we map per-sport which
// stat names become which columns.
// =============================================================================

import { getJSON } from './http.js';
import { getRegion } from '../config.js';
import { getSettings } from '../store/settings.js';
import { teamFavKey } from '../store/favorites.js';

const STANDINGS = 'https://site.api.espn.com/apis/v2/sports';

// Per-sport column sets: [statName, headerLabel]. Missing stats render as "—".
const COLUMNS = {
  hockey:     [['gamesPlayed', 'GP'], ['wins', 'W'], ['losses', 'L'], ['otLosses', 'OTL'], ['points', 'PTS'], ['pointDifferential', 'DIFF']],
  basketball: [['wins', 'W'], ['losses', 'L'], ['winPercent', 'PCT'], ['gamesBehind', 'GB'], ['streak', 'STRK']],
  football:   [['wins', 'W'], ['losses', 'L'], ['ties', 'T'], ['winPercent', 'PCT'], ['pointsFor', 'PF'], ['pointsAgainst', 'PA'], ['differential', 'DIFF']],
  baseball:   [['wins', 'W'], ['losses', 'L'], ['winPercent', 'PCT'], ['gamesBehind', 'GB'], ['streak', 'STRK']],
  soccer:     [['gamesPlayed', 'P'], ['wins', 'W'], ['ties', 'D'], ['losses', 'L'], ['pointsFor', 'GF'], ['pointsAgainst', 'GA'], ['pointDifferential', 'GD'], ['points', 'PTS']],
  _default:   [['wins', 'W'], ['losses', 'L']],
};

export function columnsFor(sport) { return COLUMNS[sport] || COLUMNS._default; }

function pickLogo(team) {
  if (team.logo) return team.logo;
  const l = team.logos;
  if (Array.isArray(l) && l.length) {
    const d = l.find((x) => (x.rel || []).includes('default')) || l[0];
    return d?.href || '';
  }
  return '';
}

// Recursively gather leaf groups that actually contain entries.
function collectGroups(node, out) {
  if (!node || typeof node !== 'object') return;
  if (node.standings && Array.isArray(node.standings.entries) && node.standings.entries.length) {
    out.push({ name: node.name || '', entries: node.standings.entries });
  }
  (node.children || []).forEach((c) => collectGroups(c, out));
}

export async function fetchStandings(league, season) {
  const { region, lang } = getRegion(getSettings().regionCode);
  const params = new URLSearchParams({ region, lang });
  if (season) params.set('season', String(season));
  const url = `${STANDINGS}/${league.sport}/${league.league}/standings?${params.toString()}`;
  // historical seasons never change -> long TTL; current season -> short.
  const ttl = season ? 7 * 24 * 3600 * 1000 : 5 * 60 * 1000;
  const res = await getJSON(url, { cacheKey: `standings:${league.id}:${region}:${season || 'cur'}`, ttlMs: ttl });

  // available seasons + the active one (for the season dropdown)
  const seasonsRaw = res.data?.seasons || [];
  const seasons = seasonsRaw.map((s) => ({ year: s.year, label: s.displayName || String(s.year) }));
  const currentSeason = res.data?.season?.year || (seasons[0] && seasons[0].year) || null;

  // ESPN's "current season" pointer can be a not-yet-started season that isn't
  // in the selectable `seasons` list (e.g. off-season 2026-27 NBA). When the
  // caller didn't ask for a specific season, fall back to the most recent season
  // that actually has standings and re-fetch it so the table matches the dropdown.
  if (!season) {
    const years = seasons.map((s) => s.year);
    const want = years.includes(currentSeason) ? currentSeason : years[0];
    if (want && want !== currentSeason) return fetchStandings(league, want);
    season = want || currentSeason;
  }

  const cols = columnsFor(league.sport);
  const raw = [];
  collectGroups(res.data || {}, raw);

  const groups = raw.map((g) => ({
    name: g.name,
    rows: g.entries.map((e, i) => {
      const t = e.team || {};
      const sm = {};  // displayValue by stat name
      const sv = {};  // numeric value by stat name (for sorting)
      (e.stats || []).forEach((s) => {
        if (!s || s.name == null) return;
        sm[s.name] = s.displayValue;
        sv[s.name] = typeof s.value === 'number' ? s.value : parseFloat(String(s.displayValue).replace(/[^0-9.\-]/g, ''));
      });
      return {
        teamId: String(t.id || ''),
        name: t.displayName || t.shortDisplayName || t.name || '',
        abbr: t.abbreviation || '',
        logo: pickLogo(t),
        favKey: teamFavKey(league.sport, String(t.id || '')),
        clinch: sm.clincher || '',  // x=clinched playoff, y=division, z=top seed, e=eliminated
        cells: cols.map(([k]) => (sm[k] != null && sm[k] !== '' ? sm[k] : '—')),
        values: cols.map(([k]) => (Number.isFinite(sv[k]) ? sv[k] : NaN)),
      };
    }),
  }));

  // default sort column per sport (so e.g. NFL shows most wins first)
  const PRIMARY = { hockey: 'points', basketball: 'wins', football: 'wins', baseball: 'wins', soccer: 'points' };
  let defaultSortIndex = cols.findIndex(([k]) => k === PRIMARY[league.sport]);
  if (defaultSortIndex < 0) defaultSortIndex = 0;

  return { league, groups, columns: cols, defaultSortIndex, seasons, currentSeason, season: season || currentSeason, fetchedAt: res.fetchedAt, stale: res.stale, error: res.error };
}
