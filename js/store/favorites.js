// =============================================================================
// store/favorites.js — favorites model: followed LEAGUES + favorited TEAMS.
//
// Team favorites are keyed by `${sport}:${teamId}` (the "favKey"). Why sport and
// not league? A national team (e.g. Croatia) keeps the same ESPN team id across
// every soccer competition (World Cup, Nations League, friendlies…), so keying
// by sport makes one "favorite Croatia" highlight its games everywhere, while
// still avoiding cross-sport id collisions (NHL team 5 vs NBA team 5).
//
// Like settings, this is an in-memory model hydrated from + written through to
// the swappable store, so renders can read it synchronously.
// =============================================================================

import { store } from './store.js';

const LEAGUES_KEY = 'followedLeagues';
const TEAMS_KEY = 'favoriteTeams';

// In-memory model
let followedLeagues = new Set();          // Set<leagueId>
let favoriteTeams = new Map();            // Map<favKey, teamMeta>

const listeners = new Set();
export function onFavoritesChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function emit() { listeners.forEach((fn) => fn()); }

// Stable favorite key for a team.
export function teamFavKey(sport, teamId) { return `${sport}:${teamId}`; }

export async function loadFavorites() {
  const leagues = await store.get(LEAGUES_KEY, []);
  const teams = await store.get(TEAMS_KEY, []); // array of teamMeta
  followedLeagues = new Set(leagues);
  favoriteTeams = new Map(teams.map((t) => [t.favKey, t]));
}

async function persist() {
  await store.set(LEAGUES_KEY, [...followedLeagues]);
  await store.set(TEAMS_KEY, [...favoriteTeams.values()]);
  emit();
}

// ---- Leagues ---------------------------------------------------------------
export function isLeagueFollowed(id) { return followedLeagues.has(id); }
export function followedLeagueIds() { return [...followedLeagues]; }
export function hasAnyFollowedLeague() { return followedLeagues.size > 0; }

export async function setLeagueFollowed(id, on) {
  if (on) followedLeagues.add(id); else followedLeagues.delete(id);
  await persist();
}
export async function toggleLeague(id) {
  await setLeagueFollowed(id, !followedLeagues.has(id));
}

// ---- Teams -----------------------------------------------------------------
// teamMeta: { favKey, teamId, sport, leagueId, name, displayName, logo, abbr }
export function isTeamFavorite(favKey) { return favoriteTeams.has(favKey); }
export function favoriteTeamList() {
  return [...favoriteTeams.values()].sort((a, b) => a.displayName.localeCompare(b.displayName));
}
export function hasAnyFavoriteTeam() { return favoriteTeams.size > 0; }

export async function setTeamFavorite(meta, on) {
  if (on) favoriteTeams.set(meta.favKey, meta);
  else favoriteTeams.delete(meta.favKey);
  await persist();
}
export async function toggleTeam(meta) {
  await setTeamFavorite(meta, !favoriteTeams.has(meta.favKey));
}

// Does this normalized game involve any favorited team / followed league?
export function hasFavoriteSide(game) {
  return favoriteTeams.has(game.home.favKey) || favoriteTeams.has(game.away.favKey);
}

// Any favorites at all (used by the "Favorites only" empty state).
export function hasAnyFavorites() { return hasAnyFollowedLeague() || hasAnyFavoriteTeam(); }
