// =============================================================================
// data/espn.js — ESPN endpoint builders + per-sport response NORMALIZERS.
//
// All shapes below were verified against live responses on 2026-06-13 from:
//   https://site.api.espn.com/apis/site/v2/sports/{sport}/{league}/scoreboard
//
// VERIFIED RESPONSE SHAPE (identical across NHL/NBA/NFL/MLB/soccer):
//   {
//     leagues: [ { name, slug, ... } ],
//     events: [ {
//       id, uid, date: "2026-06-15T00:00Z" (ISO-8601 UTC),
//       name: "Carolina Hurricanes at Vegas Golden Knights",
//       shortName: "CAR @ VGK",
//       status: {
//         clock, displayClock, period,
//         type: { state: "pre"|"in"|"post", completed: bool,
//                 description, detail, shortDetail }   // <- the friendly labels
//       },
//       competitions: [ {
//         neutralSite, venue:{fullName}, notes:[{headline}], broadcasts:[...],
//         competitors: [ {
//           homeAway: "home"|"away",
//           score: "3",                 // STRING; "0"/absent before start
//           winner: true|false,         // both false => DRAW (soccer/NFL tie)
//           record: [ {type:"total", summary:"10-5-2"} ],
//           form: "WWDWW",              // soccer only
//           team: { id, abbreviation, displayName, shortDisplayName, name,
//                   location, color, alternateColor, logo }  // logo is a CDN url
//         } x2 ]
//       } ]
//     } ]
//   }
//
// PER-SPORT QUIRKS handled below:
//   • Soccer can DRAW: status shows "FT" with neither competitor winner:true.
//   • Soccer adds `form` (recent results) and `notes[0].headline` (e.g. "Group F").
//   • Hockey "Final/OT", "Final/SO"; baseball/basketball "Final"; all live states
//     come pre-formatted in status.type.shortDetail (e.g. "2nd 5:23", "HT").
//   • Logos: present for the four majors AND national teams. Where absent we fall
//     back to TheSportsDB (see data/logos.js).
// =============================================================================

import { getJSON } from './http.js';
import { teamFavKey } from '../store/favorites.js';
import { APP_CONFIG, getRegion } from '../config.js';
import { getSettings } from '../store/settings.js';
import { fetchTsdbScoreboard } from './tsdb-league.js';

const SITE_API = 'https://site.api.espn.com/apis/site/v2/sports';

// Language from the user's region picker (localizes team-name spelling).
function langParam() {
  return getRegion(getSettings().regionCode).lang || 'en';
}

// ---- Endpoint builders ------------------------------------------------------
export function scoreboardUrl(league, datesParam) {
  const base = `${SITE_API}/${league.sport}/${league.league}/scoreboard`;
  // NOTE: we always request region=us for broadcasts. ESPN's free API only
  // carries US TV listings — region=ca/gb/etc. return EMPTY broadcasts (not local
  // networks), which left the broadcast line blank. Using `us` shows the (US)
  // national listing instead of nothing. `lang` still follows the user's region.
  const params = new URLSearchParams({ limit: '300', region: 'us', lang: langParam() });
  if (datesParam) params.set('dates', datesParam);
  return `${base}?${params.toString()}`;
}

// ---- Normalizers ------------------------------------------------------------
// Turn one ESPN competitor into our flat, sport-agnostic "team side".
function normalizeSide(competitor, league) {
  const t = competitor.team || {};
  const teamId = String(t.id ?? '');
  // Records can arrive as an array of {type, summary} or occasionally a string.
  let record = '';
  const recs = competitor.records || competitor.record;
  if (Array.isArray(recs)) {
    const total = recs.find((r) => r.type === 'total') || recs[0];
    record = total?.summary || '';
  } else if (typeof recs === 'string') {
    record = recs;
  }
  // Hide uninformative all-zero records (e.g. "0-0-0" pre-tournament).
  if (/^[0\s\-–]+$/.test(record)) record = '';

  const logo = t.logo || (Array.isArray(t.logos) && t.logos[0]?.href) || '';
  // score is a string on the scoreboard but an object {value, displayValue} on
  // the team-schedule endpoint — normalize both to a plain string.
  let scoreRaw = competitor.score;
  if (scoreRaw && typeof scoreRaw === 'object') scoreRaw = scoreRaw.displayValue ?? scoreRaw.value;
  const scoreStr = scoreRaw != null ? String(scoreRaw) : '';

  return {
    favKey: teamFavKey(league.sport, teamId), // sport-scoped so nat'l teams unify
    teamId,
    sport: league.sport,
    leagueId: league.id,
    abbr: t.abbreviation || t.shortDisplayName || '',
    name: t.shortDisplayName || t.name || t.displayName || '',
    displayName: t.displayName || t.name || t.abbreviation || 'TBD',
    location: t.location || '',
    color: t.color ? `#${t.color}` : '',
    altColor: t.alternateColor ? `#${t.alternateColor}` : '',
    logo,
    score: scoreStr,
    scoreNum: scoreStr === '' ? null : Number(scoreStr),
    winner: competitor.winner === true,
    record,
    form: competitor.form || '',
  };
}

// Turn one ESPN event into our normalized Game.
export function normalizeEvent(ev, league) {
  const comp = (ev.competitions && ev.competitions[0]) || {};
  const status = ev.status || comp.status || {};
  const type = status.type || {};
  const state = type.state || 'pre'; // 'pre' | 'in' | 'post'

  const competitors = comp.competitors || [];
  const homeC = competitors.find((c) => c.homeAway === 'home') || competitors[0] || {};
  const awayC = competitors.find((c) => c.homeAway === 'away') || competitors[1] || {};

  const home = normalizeSide(homeC, league);
  const away = normalizeSide(awayC, league);

  // Broadcast networks for the selected region. The shape varies, so we gather
  // unique names from every available field (broadcasts[].names/shortName +
  // geoBroadcasts[].media.shortName), which is what the `region` param localizes.
  const nets = new Set();
  for (const b of comp.broadcasts || []) {
    (b.names || []).forEach((n) => n && nets.add(n));
    if (b.shortName) nets.add(b.shortName);
    if (b.media?.shortName) nets.add(b.media.shortName);
  }
  for (const g of comp.geoBroadcasts || []) {
    if (g.media?.shortName) nets.add(g.media.shortName);
  }
  if (typeof comp.broadcast === 'string' && comp.broadcast) nets.add(comp.broadcast);
  const broadcast = [...nets].slice(0, 4).join(' / ');

  const dateUTC = ev.date || comp.date;
  const startMs = dateUTC ? Date.parse(dateUTC) : NaN;

  return {
    id: String(ev.id),
    leagueId: league.id,
    league,                       // keep a ref for grouping/labels
    sport: league.sport,
    hasDraws: !!league.hasDraws,

    dateUTC,
    startMs,

    state,
    isPre: state === 'pre',
    isLive: state === 'in',
    isFinal: state === 'post',
    completed: !!type.completed,

    // Pre-formatted, sport-correct status strings straight from ESPN.
    statusDetail: type.shortDetail || type.detail || type.description || '',
    statusFull: type.detail || type.description || '',
    statusDescription: type.description || '',
    displayClock: status.displayClock || '',
    period: status.period || 0,

    // A finished soccer match where neither side "won" is a DRAW.
    isDraw: state === 'post' && league.hasDraws && !home.winner && !away.winner
            && home.scoreNum != null && away.scoreNum != null,

    neutralSite: !!comp.neutralSite,
    venue: comp.venue?.fullName || '',
    note: (Array.isArray(comp.notes) && comp.notes[0]?.headline) || '',
    broadcast,

    home,
    away,
  };
}

// Parse a full scoreboard payload into normalized games (sorted by start time).
export function normalizeScoreboard(data, league) {
  const events = (data && data.events) || [];
  return events
    .map((ev) => {
      try { return normalizeEvent(ev, league); }
      catch (e) { console.warn('[espn] failed to parse event', league.id, e); return null; }
    })
    .filter(Boolean)
    .sort((a, b) => (a.startMs || 0) - (b.startMs || 0));
}

// ---- Fetchers ---------------------------------------------------------------
// Returns { league, games, fetchedAt, stale, source, error? }. Never throws for
// "no games"; only throws if there's no data AND no cache to fall back to.
export async function fetchScoreboard(league, datesParam, { ttlMs } = {}) {
  // Non-ESPN leagues (e.g. Croatian HNL) route to their own adapter.
  if (league.source === 'tsdb') return fetchTsdbScoreboard(league, datesParam);
  const url = scoreboardUrl(league, datesParam);
  // region in the key so US/CA/etc. payloads don't collide in the cache.
  const cacheKey = `scoreboard:${league.id}:${getSettings().regionCode}:${datesParam || 'now'}`;
  const res = await getJSON(url, { cacheKey, ttlMs: ttlMs ?? APP_CONFIG.scoreboardTtlMs });
  return {
    league,
    games: normalizeScoreboard(res.data, league),
    fetchedAt: res.fetchedAt,
    stale: res.stale,
    source: res.source,
    error: res.error,
  };
}
