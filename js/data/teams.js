// =============================================================================
// data/teams.js — team index for the search feature (find & favorite any team
// without waiting for it on the schedule).
//
// CORS REALITY (verified 2026-06-13): ESPN's full-roster endpoint
//   site.api.espn.com/.../{sport}/{league}/teams
// does NOT send CORS headers, so a browser can't call it directly. We therefore
// build the index from two CORS-CLEAN sources that still carry real ESPN team
// ids (favorites must match scoreboard games by id, so name-only sources like
// TheSportsDB won't do — "Türkiye" vs "Turkey" etc.):
//
//   1. SCOREBOARD HARVEST — the scoreboard endpoint *is* CORS-enabled and embeds
//      full team objects. Harvesting a wide date window yields every team that
//      plays in that window (≈ all active teams in season). 1 request/league.
//
//   2. CORE-API FALLBACK — sports.core.api.espn.com *is* CORS-enabled. For a
//      non-international league a harvest leaves empty (e.g. an off-season major
//      like the NFL in June), we resolve the league's team list there: the list
//      gives `$ref` ids, and each team's detail gives name + logo. Cached 7 days.
//
// (If you enable the proxy, the harvest still works and is plenty; the proxy
//  isn't required for search.)
// =============================================================================

import { getJSON } from './http.js';
import { APP_CONFIG, LEAGUES, getRegion } from '../config.js';
import { teamFavKey } from '../store/favorites.js';
import { getSettings } from '../store/settings.js';
import { fetchScoreboard } from './espn.js';
import { addDays, yyyymmddRange } from '../util/dates.js';

const CORE_API = 'https://sports.core.api.espn.com/v2/sports';

function pickLogo(team) {
  if (team.logo) return team.logo;
  const logos = team.logos;
  if (!Array.isArray(logos) || !logos.length) return '';
  const def = logos.find((l) => (l.rel || []).includes('default')) || logos[0];
  return def?.href || '';
}

// --- source 1: harvest teams from a wide scoreboard window -------------------
async function harvestLeagueTeams(league) {
  const start = addDays(new Date(), -10);
  const end = addDays(new Date(), 45);
  const r = await fetchScoreboard(league, yyyymmddRange(start, end), { ttlMs: APP_CONFIG.metadataTtlMs });
  const byId = new Map();
  for (const g of r.games) {
    for (const s of [g.home, g.away]) {
      if (!s.teamId || s.displayName === 'TBD') continue;
      if (!byId.has(s.teamId)) {
        byId.set(s.teamId, {
          favKey: s.favKey, teamId: s.teamId, sport: s.sport, leagueId: league.id,
          name: s.name, displayName: s.displayName, abbr: s.abbr, logo: s.logo,
        });
      }
    }
  }
  return [...byId.values()];
}

// --- source 2: core-API roster (CORS-ok) for empty non-intl leagues ----------
async function coreLeagueTeams(league) {
  const { lang } = getRegion(getSettings().regionCode);
  const listUrl = `${CORE_API}/${league.sport}/leagues/${league.league}/teams?limit=100&lang=${lang}`;
  const res = await getJSON(listUrl, { cacheKey: `coreteamlist:${league.id}`, ttlMs: APP_CONFIG.metadataTtlMs });
  const items = res.data?.items || [];

  // each item is a { $ref } whose path ends in /teams/<id>; rewrite http->https
  // (refs come back as http:, which would be blocked as mixed content on https).
  const refs = items
    .map((it) => {
      const ref = (it.$ref || '').replace(/^http:/, 'https:');
      const m = /\/teams\/(\d+)/.exec(ref);
      return m ? { id: m[1], ref } : null;
    })
    .filter(Boolean);

  if (refs.length > 120) return []; // guard against huge intl rosters (shouldn't hit; intl is skipped)

  const out = [];
  const CONCURRENCY = 8;
  for (let i = 0; i < refs.length; i += CONCURRENCY) {
    const batch = await Promise.allSettled(refs.slice(i, i + CONCURRENCY).map(async ({ id, ref }) => {
      const d = await getJSON(ref, { cacheKey: `coreteam:${league.sport}:${id}`, ttlMs: APP_CONFIG.metadataTtlMs });
      const t = d.data || {};
      return {
        favKey: teamFavKey(league.sport, String(t.id ?? id)),
        teamId: String(t.id ?? id), sport: league.sport, leagueId: league.id,
        name: t.shortDisplayName || t.name || t.displayName || '',
        displayName: t.displayName || t.name || t.abbreviation || '',
        abbr: t.abbreviation || '', logo: pickLogo(t),
      };
    }));
    batch.forEach((p) => { if (p.status === 'fulfilled' && p.value.displayName) out.push(p.value); });
  }
  return out;
}

// A real in-season league has well over a dozen teams playing across the
// harvest window; far fewer means it's off-season or down to a playoff handful
// (e.g. NHL/NBA finals in June), so we top up the roster from the core API.
const SPARSE_HARVEST = 12;

async function fetchLeagueTeamsForSearch(league) {
  const teams = await harvestLeagueTeams(league).catch(() => []);
  if (league.intl || teams.length >= SPARSE_HARVEST) return teams;

  // top up an off-season / playoff-only league with its full roster (cached 7d)
  const core = await coreLeagueTeams(league).catch(() => []);
  const seen = new Set(teams.map((t) => t.favKey)); // prefer harvest entries (scoreboard logos)
  for (const c of core) if (!seen.has(c.favKey)) { seen.add(c.favKey); teams.push(c); }
  return teams;
}

// The built index is persisted (under the response-cache prefix so the "Clear
// cached data" button sweeps it). It's reused for a day so the startup pre-warm
// doesn't re-harvest every launch (getJSON always hits the network otherwise).
const INDEX_KEY = 'sb:cache:teamindex';
const INDEX_TTL = 24 * 60 * 60 * 1000;

function loadPersistedIndex() {
  try {
    const r = JSON.parse(localStorage.getItem(INDEX_KEY) || 'null');
    if (r && Array.isArray(r.teams) && Date.now() - r.builtAt < INDEX_TTL) return r.teams;
  } catch { /* ignore */ }
  return null;
}
function persistIndex(teams) {
  try { localStorage.setItem(INDEX_KEY, JSON.stringify({ builtAt: Date.now(), teams })); }
  catch { /* best-effort */ }
}

// Build a de-duplicated index across every configured league. National teams
// that recur across competitions are kept once (first by registry order), so
// e.g. Croatia appears as a single result.
let _indexPromise = null;
export function buildTeamIndex({ force = false } = {}) {
  if (_indexPromise && !force) return _indexPromise;
  _indexPromise = (async () => {
    if (!force) {
      const persisted = loadPersistedIndex();
      if (persisted) return persisted;
    }
    const results = await Promise.allSettled(LEAGUES.map(fetchLeagueTeamsForSearch));
    const teams = [];
    const seen = new Set();
    results.forEach((r) => {
      if (r.status !== 'fulfilled') return;
      for (const t of r.value) {
        if (seen.has(t.favKey)) continue;
        seen.add(t.favKey);
        teams.push(t);
      }
    });
    if (teams.length) persistIndex(teams);
    return teams;
  })();
  return _indexPromise;
}
