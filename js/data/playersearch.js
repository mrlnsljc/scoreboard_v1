// =============================================================================
// data/playersearch.js — on-demand player search via ESPN's site search.
//   GET site.web.api.espn.com/apis/search/v2?query=...  (CORS-open)
//   -> results:[ { type:'player', contents:[{ displayName, subtitle(team),
//        sport, defaultLeagueSlug, uid:"s:..~a:<athleteId>", link:{web} }] } ]
// We pull the athlete id from the uid (or the /id/<n>/ in the link).
// =============================================================================

import { getJSON } from './http.js';

const SEARCH = 'https://site.web.api.espn.com/apis/search/v2';

function athleteIdFrom(item) {
  const m = /a:(\d+)/.exec(item.uid || '') || /\/id\/(\d+)/.exec(item.link?.web || '');
  return m ? m[1] : '';
}

export async function searchPlayers(query) {
  const q = query.trim();
  if (q.length < 2) return [];
  const url = `${SEARCH}?region=us&lang=en&limit=12&query=${encodeURIComponent(q)}`;
  let data;
  try {
    const res = await getJSON(url, { cacheKey: `psearch:${q.toLowerCase()}`, ttlMs: 60 * 60 * 1000 });
    data = res.data;
  } catch { return []; }

  const groups = data?.results || [];
  const pg = groups.find((g) => g.type === 'player');
  const items = pg?.contents || pg?.items || [];
  return items.map((it) => ({
    athleteId: athleteIdFrom(it),
    name: it.displayName || '',
    team: it.subtitle || '',
    sport: it.sport || '',
    leagueSlug: it.defaultLeagueSlug || '',
  })).filter((p) => p.athleteId && p.name);
}
