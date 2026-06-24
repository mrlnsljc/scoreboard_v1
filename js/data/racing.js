// =============================================================================
// data/racing.js — F1 / motorsport: championship STANDINGS (drivers +
// constructors) and RACE RESULTS, both CORS-open (verified 2026-06).
//
//   Standings: site.api.espn.com/apis/v2/sports/racing/f1/standings
//     -> children: [Driver Standings, Constructor Standings], each
//        standings.entries[] with athlete|team + stats[{name:'rank'|'championshipPts'}]
//   Schedule:  site.api.espn.com/apis/site/v2/sports/racing/f1/scoreboard?dates=YYYY0101-YYYY1231
//     -> events[] = GP weekends; competitions[] = sessions (FP/Qualifying/Race);
//        the Race competition's competitors[] carry { order, winner, athlete }.
//
// Racing has no home/away "team sport" shape, so this is its own module (the
// generic scoreboard normalizer doesn't apply). Surfaced under Standings, like Golf.
// =============================================================================

import { getJSON } from './http.js';

const SITE = 'https://site.api.espn.com/apis/site/v2/sports';
const STANDINGS = 'https://site.api.espn.com/apis/v2/sports';

function statsMap(entry) {
  const m = {};
  (entry.stats || []).forEach((s) => { if (s && s.name != null) m[s.name] = s.displayValue; });
  return m;
}

// Find the Race competition within a GP weekend (fall back to the last session).
function raceCompetition(ev) {
  const comps = ev.competitions || [];
  return comps.slice().reverse().find((c) => /race/i.test(c.type?.abbreviation || c.type?.text || c.type?.id || '')) || comps[comps.length - 1] || {};
}

export async function fetchRacing(league = { sport: 'racing', league: 'f1' }) {
  const slug = league.league || 'f1';
  const year = new Date().getFullYear();
  const [stRes, sbRes] = await Promise.allSettled([
    getJSON(`${STANDINGS}/racing/${slug}/standings`, { cacheKey: `racing:standings:${slug}`, ttlMs: 30 * 60 * 1000 }),
    getJSON(`${SITE}/racing/${slug}/scoreboard?dates=${year}0101-${year}1231`, { cacheKey: `racing:sched:${slug}:${year}`, ttlMs: 30 * 60 * 1000 }),
  ]);

  // ---- championship standings (drivers + constructors) ----
  const tables = [];
  if (stRes.status === 'fulfilled') {
    for (const child of (stRes.value.data?.children || [])) {
      const drivers = /driver/i.test(child.name || '');
      const rows = (child.standings?.entries || []).map((e) => {
        const sm = statsMap(e);
        return {
          name: drivers ? (e.athlete?.displayName || '') : (e.team?.displayName || e.team?.name || ''),
          flag: drivers ? (e.athlete?.flag?.href || '') : '',
          rank: sm.rank || '',
          points: sm.championshipPts || sm.points || sm.championshipPoints || '',
        };
      }).filter((r) => r.name);
      if (rows.length) tables.push({ name: child.name, drivers, rows });
    }
  }

  // ---- season schedule -> races, last result, next race ----
  let races = [];
  if (sbRes.status === 'fulfilled') {
    races = (sbRes.value.data?.events || []).map((ev) => {
      const rc = raceCompetition(ev);
      const startMs = Date.parse(ev.date || rc.date || '');
      return {
        id: String(ev.id), name: ev.name || ev.shortName || '', short: ev.shortName || '',
        date: ev.date, startMs,
        state: ev.status?.type?.state || rc.status?.type?.state || 'pre',
        statusDetail: ev.status?.type?.shortDetail || '',
        circuit: rc.venue?.fullName || ev.competitions?.[0]?.venue?.fullName || '',
        location: [rc.venue?.address?.city, rc.venue?.address?.country].filter(Boolean).join(', '),
        results: (rc.competitors || [])
          .slice()
          .sort((a, b) => (Number(a.order) || 99) - (Number(b.order) || 99))
          .slice(0, 10)
          .map((c) => ({ order: c.order, driver: c.athlete?.displayName || '', flag: c.athlete?.flag?.href || '', winner: !!c.winner })),
      };
    }).sort((a, b) => (a.startMs || 0) - (b.startMs || 0));
  }

  const now = Date.now();
  const lastRace = races.filter((r) => r.state === 'post').slice(-1)[0] || null;
  const nextRace = races.find((r) => r.state !== 'post' && Number.isFinite(r.startMs) && r.startMs >= now - 6 * 3600 * 1000)
    || races.find((r) => r.state === 'pre') || null;

  const stale = [stRes, sbRes].some((r) => r.status === 'fulfilled' && r.value.stale);
  return { league, tables, races, lastRace, nextRace, season: year, stale };
}
