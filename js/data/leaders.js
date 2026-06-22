// =============================================================================
// data/leaders.js — league-wide statistical leaders.
//
// Source: core API (CORS-open) current-season leaders:
//   GET sports.core.api.espn.com/v2/sports/{sport}/leagues/{league}/leaders
//     -> { categories:[{ displayName, abbreviation, leaders:[{ displayValue, athlete:{$ref} }] }] }
// Athlete names aren't inline (they're $refs), so we resolve the top few per
// category and cache them (http:->https to avoid mixed content). Works for
// NBA/NHL/NFL/MLB; soccer needs a season-scoped form, so we mark it unsupported.
// =============================================================================

import { getJSON } from './http.js';

const CORE = 'https://sports.core.api.espn.com/v2/sports';
const TOP_N = 5;       // leaders shown per category
const MAX_CATS = 8;    // categories shown

function idFromRef(ref) { const m = /\/athletes\/(\d+)/.exec(ref || ''); return m ? m[1] : ''; }

async function resolveAthletes(refs) {
  const out = new Map();
  const list = [...refs];
  const C = 8;
  for (let i = 0; i < list.length; i += C) {
    // eslint-disable-next-line no-await-in-loop
    await Promise.allSettled(list.slice(i, i + C).map(async (ref) => {
      const id = idFromRef(ref);
      try {
        const d = await getJSON(ref, { cacheKey: `athref:${id}`, ttlMs: 7 * 24 * 3600 * 1000 });
        out.set(ref, { id: String(d.data?.id || id), name: d.data?.displayName || d.data?.fullName || '' });
      } catch { out.set(ref, { id, name: '' }); }
    }));
  }
  return out;
}

export async function fetchLeaders(league, season, { allTime = false } = {}) {
  // Soccer uses season-type 1; the other sports use 2. Season-scoped = that
  // season's leaders; the no-season form returns all-time/career totals.
  const type = league.sport === 'soccer' ? 1 : 2;
  const seasonPath = (!allTime && season) ? `/seasons/${season}/types/${type}` : '';
  const url = `${CORE}/${league.sport}/leagues/${league.league}${seasonPath}/leaders?lang=en&region=us`;
  let res;
  try {
    res = await getJSON(url, { cacheKey: `leaders:${league.id}:${allTime ? 'all' : season || 'cur'}`, ttlMs: 6 * 3600 * 1000 });
  } catch (e) {
    // a season with no published leaders 404s — treat as "no leaders" (not an error)
    return { league, categories: [], season, allTime, error: e };
  }

  // de-dupe categories by display name (soccer repeats some) and cap.
  const cats = [];
  const seen = new Set();
  for (const c of (res.data?.categories || [])) {
    const name = c.displayName || c.name;
    if (!(c.leaders || []).length || seen.has(name)) continue;
    seen.add(name);
    cats.push({ name, abbr: c.abbreviation || '', leaders: (c.leaders || []).slice(0, TOP_N) });
    if (cats.length >= MAX_CATS) break;
  }

  const refs = new Set();
  cats.forEach((c) => c.leaders.forEach((l) => { const r = (l.athlete?.$ref || '').replace(/^http:/, 'https:'); if (r) refs.add(r); }));
  const resolved = await resolveAthletes(refs);

  const categories = cats.map((c) => ({
    name: c.name, abbr: c.abbr,
    rows: c.leaders.map((l) => {
      const r = (l.athlete?.$ref || '').replace(/^http:/, 'https:');
      const a = resolved.get(r) || { id: idFromRef(r), name: '' };
      // ESPN's soccer displayValue is verbose ("Matches: 35, Goals: 27"); when
      // it's bloated, prefer the clean numeric value for the category.
      const dv = l.displayValue || '';
      const n = l.value;
      const value = (dv && dv.length <= 7 && !/[:,]/.test(dv)) ? dv
        : (Number.isFinite(n) ? (Number.isInteger(n) ? String(n) : n.toFixed(1)) : dv);
      return { value, athleteId: a.id, name: a.name || 'Unknown' };
    }),
  }));

  return { league, categories, season, allTime, fetchedAt: res.fetchedAt, stale: res.stale, error: res.error };
}
