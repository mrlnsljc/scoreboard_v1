// =============================================================================
// data/thesportsdb.js — FALLBACK source for team badges/logos only.
//
// ESPN already returns `team.logo` for all the leagues we ship, so this is used
// only when an ESPN logo is missing. TheSportsDB free tier is rate-limited, so
// we fetch ONE list per league (all teams) and cache it for `metadataTtlMs`,
// then resolve individual badges from that cached list — never one call per team.
//
// Free tier uses the public dev key "3".
// =============================================================================

import { getJSON } from './http.js';
import { APP_CONFIG } from '../config.js';

const TSDB = 'https://www.thesportsdb.com/api/v1/json/3';

// Normalize team names for fuzzy matching between ESPN and TheSportsDB.
function norm(s) {
  return (s || '')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(fc|cf|afc|sc|ac|club|de|the)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// In-memory index: tsdbLeagueName -> Map(normName -> badgeUrl)
const indexCache = new Map();

async function getLeagueIndex(tsdbLeagueName) {
  if (!tsdbLeagueName) return null;
  if (indexCache.has(tsdbLeagueName)) return indexCache.get(tsdbLeagueName);

  const url = `${TSDB}/search_all_teams.php?l=${encodeURIComponent(tsdbLeagueName)}`;
  let map = new Map();
  try {
    const res = await getJSON(url, { cacheKey: `tsdb:teams:${tsdbLeagueName}`, ttlMs: APP_CONFIG.metadataTtlMs });
    const teams = (res.data && res.data.teams) || [];
    for (const t of teams) {
      const badge = t.strBadge || t.strTeamBadge || '';
      if (!badge) continue;
      map.set(norm(t.strTeam), badge);
      if (t.strAlternate) norm(t.strAlternate).split(',').forEach((a) => map.set(norm(a), badge));
    }
  } catch (e) {
    console.warn('[tsdb] league index failed', tsdbLeagueName, e.message);
  }
  indexCache.set(tsdbLeagueName, map);
  return map;
}

// Resolve a badge URL for a team within a league, or '' if not found.
export async function badgeFor(tsdbLeagueName, teamDisplayName, teamShortName) {
  const idx = await getLeagueIndex(tsdbLeagueName);
  if (!idx || idx.size === 0) return '';
  const candidates = [teamDisplayName, teamShortName].filter(Boolean).map(norm);
  for (const c of candidates) {
    if (idx.has(c)) return idx.get(c);
  }
  // loose contains match
  for (const c of candidates) {
    for (const [k, v] of idx) {
      if (k.includes(c) || c.includes(k)) return v;
    }
  }
  return '';
}
