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

export async function fetchStandings(league) {
  const { region, lang } = getRegion(getSettings().regionCode);
  const url = `${STANDINGS}/${league.sport}/${league.league}/standings?region=${region}&lang=${lang}`;
  const res = await getJSON(url, { cacheKey: `standings:${league.id}:${region}`, ttlMs: 5 * 60 * 1000 });

  const cols = columnsFor(league.sport);
  const raw = [];
  collectGroups(res.data || {}, raw);

  const groups = raw.map((g) => ({
    name: g.name,
    rows: g.entries.map((e, i) => {
      const t = e.team || {};
      const sm = {};
      (e.stats || []).forEach((s) => { if (s && s.name != null) sm[s.name] = s.displayValue; });
      return {
        rank: String(i + 1), // entries arrive pre-sorted in table order
        teamId: String(t.id || ''),
        name: t.displayName || t.shortDisplayName || t.name || '',
        abbr: t.abbreviation || '',
        logo: pickLogo(t),
        favKey: teamFavKey(league.sport, String(t.id || '')),
        cells: cols.map(([k]) => (sm[k] != null && sm[k] !== '' ? sm[k] : '—')),
      };
    }),
  }));

  return { league, groups, columns: cols, fetchedAt: res.fetchedAt, stale: res.stale, error: res.error };
}
