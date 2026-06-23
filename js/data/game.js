// =============================================================================
// data/game.js — game detail / box score from the summary endpoint (CORS-open):
//   GET .../{sport}/{league}/summary?event={id}
//     header.competitions[0]: competitors[{homeAway, team, score, linescores[]}], status
//     leaders[]: per team -> [{ displayName, leaders:[{displayValue, athlete:{id,displayName}}] }]
//     boxscore.teams[]: { team, statistics:[{label, displayValue}] }  (team comparison)
// Generic across sports (period count + stat labels just differ).
// =============================================================================

import { getJSON } from './http.js';
import { getRegion } from '../config.js';
import { getSettings } from '../store/settings.js';

const SITE = 'https://site.api.espn.com/apis/site/v2/sports';

function pickLogo(t) {
  if (!t) return '';
  if (t.logo) return t.logo;
  const l = t.logos;
  if (Array.isArray(l) && l.length) { const d = l.find((x) => (x.rel || []).includes('default')) || l[0]; return d?.href || ''; }
  return '';
}
function num(v) { return v && typeof v === 'object' ? (v.displayValue ?? v.value) : v; }

export async function fetchGameSummary(league, gameId) {
  const { lang } = getRegion(getSettings().regionCode);
  // region=us for broadcasts (ESPN only has US listings); lang follows the user.
  const url = `${SITE}/${league.sport}/${league.league}/summary?event=${gameId}&region=us&lang=${lang}`;
  const res = await getJSON(url, { cacheKey: `summary:${league.id}:${gameId}:${lang}`, ttlMs: 30 * 1000 });
  const d = res.data || {};

  const hc = d.header?.competitions?.[0] || {};
  const type = hc.status?.type || {};
  const comps = hc.competitors || [];
  const side = (c) => {
    const t = c.team || {};
    return {
      abbr: t.abbreviation || '', name: t.displayName || t.shortDisplayName || t.name || '',
      logo: pickLogo(t), teamId: String(t.id || ''),
      score: c.score != null ? String(num(c.score)) : '',
      winner: c.winner === true,
      linescores: (c.linescores || []).map((ls) => String(num(ls.displayValue ?? ls.value) ?? '')),
    };
  };
  const home = side(comps.find((c) => c.homeAway === 'home') || comps[0] || {});
  const away = side(comps.find((c) => c.homeAway === 'away') || comps[1] || {});

  // top performers (clickable to player pages)
  const leaders = (d.leaders || []).map((tl) => ({
    team: (tl.team || {}).abbreviation || '',
    cats: (tl.leaders || []).map((cat) => {
      const x = (cat.leaders || [])[0] || {};
      const a = x.athlete || {};
      return { cat: cat.displayName || cat.name, value: x.displayValue || '', name: a.displayName || '', athleteId: String(a.id || '') };
    }).filter((c) => c.name),
  })).filter((tl) => tl.cats.length);

  // team stat comparison, aligned by stat label
  const bteams = d.boxscore?.teams || [];
  const byAbbr = {};
  bteams.forEach((ts) => { byAbbr[(ts.team || {}).abbreviation] = (ts.statistics || []); });
  const baseStats = byAbbr[away.abbr] || bteams[0]?.statistics || [];
  const teamStats = baseStats.map((s, i) => ({
    label: s.label || s.name || '',
    away: (byAbbr[away.abbr]?.[i]?.displayValue) ?? '—',
    home: (byAbbr[home.abbr]?.[i]?.displayValue) ?? '—',
  }));

  // full per-player box score (per team -> one or more stat blocks, e.g. MLB
  // has batting + pitching). Labels + each athlete's parallel `stats` array.
  const playerBox = (d.boxscore?.players || []).map((grp) => ({
    team: (grp.team || {}).abbreviation || '',
    blocks: (grp.statistics || []).map((blk) => ({
      title: blk.text || blk.name || '',
      labels: blk.labels || blk.names || [],
      players: (blk.athletes || []).map((a) => ({
        id: String(a.athlete?.id || ''),
        name: a.athlete?.shortName || a.athlete?.displayName || '',
        starter: !!a.starter,
        dnp: !!a.didNotPlay,
        reason: a.reason || '',
        stats: a.stats || [],
      })),
    })),
  }));

  // Win probability — ESPN ships a per-play `winprobability` array (present on
  // MLB/NBA, often absent on NHL/NFL/soccer). The last entry is the live/current
  // home win %. We surface just that; the UI hides the bar when it's null.
  const wpArr = Array.isArray(d.winprobability) ? d.winprobability : [];
  const wpLast = wpArr.length ? wpArr[wpArr.length - 1] : null;
  const winProb = (wpLast && typeof wpLast.homeWinPercentage === 'number')
    ? {
        homePct: Math.max(0, Math.min(100, wpLast.homeWinPercentage * 100)),
        tiePct: Math.max(0, Math.min(100, (wpLast.tiePercentage || 0) * 100)),
      }
    : null;

  return {
    league, gameId, home, away,
    status: type.shortDetail || type.detail || '',
    state: type.state || 'pre', isLive: type.state === 'in', isFinal: type.state === 'post',
    leaders, teamStats, playerBox, winProb,
    venue: hc.venue?.fullName || '',
    fetchedAt: res.fetchedAt, stale: res.stale, error: res.error,
  };
}
