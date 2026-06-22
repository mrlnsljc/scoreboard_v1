// =============================================================================
// data/player.js — player detail: bio + per-game summary (with league ranks) +
// season-by-season stat table. CORS-open (verified 2026-06):
//   common/v3/.../athletes/{id}       -> { athlete:{...}, statsSummary:{displayName, statistics:[{shortDisplayName, displayValue, rankDisplayValue}]} }
//   common/v3/.../athletes/{id}/stats -> { categories:[{ displayName, labels:[...], statistics:[{season:{displayName}, stats:[...]}] }] }
// =============================================================================

import { getJSON } from './http.js';
import { getRegion } from '../config.js';
import { getSettings } from '../store/settings.js';

const WEB = 'https://site.web.api.espn.com/apis/common/v3/sports';

export async function fetchPlayerDetail(league, athleteId) {
  const { lang } = getRegion(getSettings().regionCode);
  const base = `${WEB}/${league.sport}/${league.league}/athletes/${athleteId}`;
  const [ov, stx] = await Promise.allSettled([
    getJSON(`${base}?lang=${lang}`, { cacheKey: `player:${league.id}:${athleteId}`, ttlMs: 6 * 3600 * 1000 }),
    getJSON(`${base}/stats?lang=${lang}`, { cacheKey: `playerstats:${league.id}:${athleteId}`, ttlMs: 6 * 3600 * 1000 }),
  ]);

  const od = (ov.status === 'fulfilled' && ov.value.data) || {};
  const ath = od.athlete || {};
  const summaryStats = od.statsSummary?.statistics || ath.statsSummary?.statistics || [];
  const player = {
    id: String(ath.id || athleteId),
    name: ath.displayName || ath.fullName || '',
    headshot: (ath.headshot || {}).href || '',
    pos: (ath.position || {}).abbreviation || (ath.position || {}).name || '',
    jersey: ath.jersey || '',
    team: (ath.team || {}).displayName || '',
    height: ath.displayHeight || '', weight: ath.displayWeight || '', age: ath.age || '',
    college: (ath.college || {}).name || '',
    flag: (ath.flag || {}).href || '',                    // nationality flag (soccer etc.)
    citizenship: ath.citizenship || (ath.birthPlace || {}).country || '',
    summaryLabel: od.statsSummary?.displayName || '',
    summary: summaryStats.map((s) => ({
      label: s.shortDisplayName || s.abbreviation || s.displayName,
      value: s.displayValue, rank: s.rankDisplayValue || '',
    })),
  };

  // season-by-season table (prefer per-game "averages")
  let table = null;
  if (stx.status === 'fulfilled') {
    const cats = stx.value.data?.categories || [];
    const cat = cats.find((c) => c.name === 'averages') || cats[0];
    if (cat) {
      table = {
        name: cat.displayName || cat.name,
        labels: cat.labels || cat.names || [],
        rows: (cat.statistics || []).map((r) => ({
          season: (r.season || {}).displayName || (r.season || {}).year || '',
          stats: r.stats || [],
        })),
      };
    }
  }

  const fetchedAt = (ov.status === 'fulfilled' && ov.value.fetchedAt) || Date.now();
  const stale = [ov, stx].some((r) => r.status === 'fulfilled' && r.value.stale);
  const error = ov.status === 'rejected' ? ov.reason : null;
  return { league, player, table, fetchedAt, stale, error };
}
