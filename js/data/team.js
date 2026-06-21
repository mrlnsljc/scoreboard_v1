// =============================================================================
// data/team.js — team detail: overview (record/standing) + roster + schedule.
// All three endpoints are CORS-open (verified 2026-06):
//   teams/{id}            -> { team:{ record:{items:[{type,summary}]}, standingSummary, logos } }
//   teams/{id}/roster     -> { athletes:[{ id, displayName, jersey, position{abbreviation}, headshot{href}, ... }] }
//   teams/{id}/schedule   -> { events:[ <same shape as scoreboard events> ] }
// Roster names/headshots are inline here (no athlete-ref resolution needed).
// =============================================================================

import { getJSON } from './http.js';
import { getRegion } from '../config.js';
import { getSettings } from '../store/settings.js';
import { teamFavKey } from '../store/favorites.js';
import { normalizeEvent } from './espn.js';

const SITE = 'https://site.api.espn.com/apis/site/v2/sports';

function pickLogo(team) {
  if (team.logo) return team.logo;
  const l = team.logos;
  if (Array.isArray(l) && l.length) { const d = l.find((x) => (x.rel || []).includes('default')) || l[0]; return d?.href || ''; }
  return '';
}

export async function fetchTeamDetail(league, teamId) {
  const { region, lang } = getRegion(getSettings().regionCode);
  const q = `region=${region}&lang=${lang}`;
  const base = `${SITE}/${league.sport}/${league.league}/teams/${teamId}`;
  const [ov, ros, sch] = await Promise.allSettled([
    getJSON(`${base}?${q}`, { cacheKey: `team:${league.id}:${teamId}:${region}`, ttlMs: 60 * 60 * 1000 }),
    getJSON(`${base}/roster?${q}`, { cacheKey: `roster:${league.id}:${teamId}`, ttlMs: 24 * 3600 * 1000 }),
    getJSON(`${base}/schedule?${q}`, { cacheKey: `schedule:${league.id}:${teamId}`, ttlMs: 30 * 60 * 1000 }),
  ]);

  // ---- overview ----
  const t = (ov.status === 'fulfilled' && ov.value.data?.team) || {};
  const recBy = {};
  (t.record?.items || []).forEach((i) => { recBy[i.type] = i.summary; });
  const team = {
    id: String(t.id || teamId), name: t.displayName || t.name || '', abbr: t.abbreviation || '',
    logo: pickLogo(t), color: t.color ? `#${t.color}` : '', leagueId: league.id, sport: league.sport,
    favKey: teamFavKey(league.sport, String(t.id || teamId)),
    record: recBy.total || '', recordHome: recBy.home || '', recordRoad: recBy.road || '',
    standingSummary: t.standingSummary || '',
  };

  // ---- roster (flatten position-grouped rosters too) ----
  let roster = [];
  if (ros.status === 'fulfilled') {
    const arr = ros.value.data?.athletes || [];
    const flat = arr.flatMap((a) => (a.items ? a.items : [a]));
    roster = flat.map((p) => ({
      id: String(p.id), name: p.displayName || p.fullName || '', jersey: p.jersey || '',
      pos: (p.position || {}).abbreviation || (p.position || {}).name || '',
      headshot: (p.headshot || {}).href || '', height: p.displayHeight || '', weight: p.displayWeight || '',
      age: p.age || '', injured: !!(p.injuries && p.injuries.length),
    }));
  }

  // ---- schedule (reuse the game normalizer) ----
  let schedule = [];
  if (sch.status === 'fulfilled') {
    schedule = (sch.value.data?.events || [])
      .map((ev) => { try { return normalizeEvent(ev, league); } catch { return null; } })
      .filter(Boolean)
      .sort((a, b) => (a.startMs || 0) - (b.startMs || 0));
  }

  const fetchedAt = (ov.status === 'fulfilled' && ov.value.fetchedAt) || Date.now();
  const stale = [ov, ros, sch].some((r) => r.status === 'fulfilled' && r.value.stale);
  const error = ov.status === 'rejected' ? ov.reason : null;
  return { league, team, roster, schedule, fetchedAt, stale, error };
}
