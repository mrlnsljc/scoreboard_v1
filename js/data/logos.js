// =============================================================================
// data/logos.js — logo resolution policy: ESPN first, TheSportsDB as fallback.
//
// Rendering is synchronous and ESPN logos cover ~all our cases, so the UI draws
// `side.logo` immediately (or a monogram placeholder). For the rare team with no
// ESPN logo, `enrichMissingLogos` asynchronously fills it from TheSportsDB and
// the caller re-renders. We never block first paint on TheSportsDB.
// =============================================================================

import { badgeFor } from './thesportsdb.js';
import { getLeague } from '../config.js';

// Mutates sides that lack a logo, filling from TheSportsDB where possible.
// Returns true if anything changed (so the caller can re-render).
export async function enrichMissingLogos(games) {
  const missing = [];
  for (const g of games) {
    for (const side of [g.home, g.away]) {
      if (!side.logo && side.displayName && side.displayName !== 'TBD') missing.push(side);
    }
  }
  if (!missing.length) return false;

  let changed = false;
  // De-dupe by favKey so we don't resolve the same team twice.
  const seen = new Map();
  await Promise.all(missing.map(async (side) => {
    if (seen.has(side.favKey)) { return; }
    seen.set(side.favKey, true);
    const league = getLeague(side.leagueId);
    const badge = await badgeFor(league?.tsdb, side.displayName, side.name);
    if (badge) {
      // apply to every side sharing this favKey
      for (const g of games) {
        for (const s of [g.home, g.away]) {
          if (s.favKey === side.favKey && !s.logo) { s.logo = badge; changed = true; }
        }
      }
    }
  }));
  return changed;
}
