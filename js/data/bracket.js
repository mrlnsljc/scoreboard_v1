// =============================================================================
// data/bracket.js — best-effort playoff / knockout BRACKET.
//
// ESPN tags each event with a round via `event.season.slug` (verified on the
// 2026 World Cup: group-stage, round-of-32, round-of-16, quarterfinals,
// semifinals, final, 3rd-place-match). We fetch a window around "now", drop the
// group/regular-season rounds, and group the rest into ordered rounds. Future
// knockout games carry placeholder names ("Round of 32 1 Winner") that fill in
// with real teams as the tournament progresses.
//
// This is intentionally generic: any league whose schedule exposes knockout
// round slugs renders (World Cup / UCL knockouts now; NBA/NHL/NFL playoffs when
// active). Leagues without knockout structure return empty -> clean empty state.
// =============================================================================

import { getJSON } from './http.js';
import { normalizeEvent } from './espn.js';
import { yyyymmdd, yyyymmddRange, addDays } from '../util/dates.js';
import { getRegion } from '../config.js';
import { getSettings } from '../store/settings.js';

const SITE = 'https://site.api.espn.com/apis/site/v2/sports';

// Rounds that are NOT part of a knockout bracket.
const NOT_BRACKET = /group|regular|preseason|friendl|qualif/i;

// Pretty labels for the common knockout slugs; unknown slugs are title-cased.
const ROUND_LABELS = {
  'round-of-64': 'Round of 64', 'round-of-32': 'Round of 32', 'round-of-16': 'Round of 16',
  quarterfinals: 'Quarterfinals', quarterfinal: 'Quarterfinals',
  semifinals: 'Semifinals', semifinal: 'Semifinals',
  final: 'Final', 'third-place-match': '3rd Place', '3rd-place-match': '3rd Place',
  'first-round': 'First Round', 'conference-quarterfinals': 'Conf. Quarterfinals',
  'conference-semifinals': 'Conf. Semifinals', 'conference-finals': 'Conf. Finals',
  'nba-finals': 'Finals', 'stanley-cup-final': 'Stanley Cup Final', 'world-series': 'World Series',
};

const titleCase = (s) => String(s || '').replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

export async function fetchBracket(league) {
  const { region, lang } = getRegion(getSettings().regionCode);
  // A window around now captures current knockout stages without relying on the
  // (often wrong) season end date. ~150 days back covers a full playoff run.
  const start = addDays(new Date(), -150);
  const end = addDays(new Date(), 75);
  const url = `${SITE}/${league.sport}/${league.league}/scoreboard?dates=${yyyymmddRange(start, end)}&limit=300&region=${region}&lang=${lang}`;
  const res = await getJSON(url, { cacheKey: `bracket:${league.id}:${yyyymmdd(start)}`, ttlMs: 10 * 60 * 1000 });

  const events = res.data?.events || [];
  const byRound = new Map();
  for (const ev of events) {
    const slug = ev.season?.slug || ev.competitions?.[0]?.notes?.[0]?.headline || '';
    if (!slug || NOT_BRACKET.test(slug)) continue;
    let g;
    try { g = normalizeEvent(ev, league); } catch { continue; }
    if (!byRound.has(slug)) byRound.set(slug, []);
    byRound.get(slug).push(g);
  }

  // Order rounds chronologically (R32 → R16 → QF → SF → Final happen in order),
  // which also naturally orders league playoff rounds.
  const rounds = [...byRound.entries()]
    .map(([slug, games]) => ({
      slug,
      label: ROUND_LABELS[slug] || titleCase(slug),
      minMs: Math.min(...games.map((g) => (Number.isFinite(g.startMs) ? g.startMs : Infinity))),
      games: games.sort((a, b) => (a.startMs || 0) - (b.startMs || 0)),
    }))
    .sort((a, b) => a.minMs - b.minMs);

  return { league, rounds, empty: rounds.length === 0, fetchedAt: res.fetchedAt, stale: res.stale };
}
