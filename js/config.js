// =============================================================================
// FIREBASE (optional) — enables "Sign in with Google" + cross-device sync of
// favorites/settings. Leave null to keep sign-in disabled (the app works fully
// without it, storing everything locally). To enable: follow the README
// "Sign in with Google" steps, then paste your Firebase web config here:
//
//   export const FIREBASE_CONFIG = {
//     apiKey: "AIza...", authDomain: "your-app.firebaseapp.com",
//     projectId: "your-app", appId: "1:123:web:abc",
//   };
// =============================================================================
export const FIREBASE_CONFIG = null;

// =============================================================================
// config.js  —  App configuration + the LEAGUE REGISTRY.
//
// This is the single place you touch to add a sport/league. Everything else
// (data fetching, parsing, favorites, rendering) is driven by these entries.
//
// HOW ESPN ENDPOINTS MAP TO A LEAGUE ENTRY
// ----------------------------------------
// ESPN's public scoreboard URL is:
//   https://site.api.espn.com/apis/site/v2/sports/{sport}/{league}/scoreboard
// e.g. hockey/nhl, basketball/nba, soccer/eng.1
// So a league entry just needs { sport, league } plus display metadata.
//
// To ADD A LEAGUE: copy a row below, set `sport` + `league` to the ESPN path
// segments, give it an id/name, and (for soccer) set hasDraws:true. Done.
// =============================================================================

export const APP_CONFIG = {
  appName: 'Scoreboard',

  // ---- CORS / proxy -------------------------------------------------------
  // ESPN's site.api currently returns `Access-Control-Allow-Origin: *`, so
  // browser-direct calls usually work with NO proxy. If that ever changes (or
  // you hit a network that blocks it), flip `useProxy` to true and point
  // `proxyBase` at your deployed Worker / Node proxy (see /proxy). The proxy is
  // also handy because it can cache responses server-side.
  //
  // This default can be overridden at runtime in Settings (persisted to
  // localStorage); see store/settings.js.
  useProxy: false,
  proxyBase: '', // e.g. 'https://espn-proxy.<you>.workers.dev' or 'http://localhost:8787'

  // ---- refresh behaviour --------------------------------------------------
  liveRefreshMs: 30000,   // auto-refresh cadence while >=1 game is live
  upcomingDays: 7,        // how many days the Upcoming view looks ahead
  requestTimeoutMs: 12000,// per-request network timeout before falling back to cache

  // ---- caching ------------------------------------------------------------
  // TTL after which a cached payload is considered "stale" (still shown, but
  // flagged). Network success always refreshes the cache regardless of TTL.
  scoreboardTtlMs: 60 * 1000,        // 1 min for scores/schedules
  metadataTtlMs: 7 * 24 * 60 * 60 * 1000, // 7 days for logos/badges (TheSportsDB)

  // First-run defaults: which leagues to follow so the app isn't empty on
  // first load. After first run we never re-seed (the user is in control).
  defaultFollowedLeagues: ['nhl', 'fifa.world'],

  // Default region code (see REGIONS). Controls the `region`+`lang` params sent
  // to ESPN, which localize broadcast listings + team names where ESPN has data.
  defaultRegion: 'us',

  // How many days back the day-stepper / past-results browsing allows.
  maxPastDays: 60,
};

// -----------------------------------------------------------------------------
// REGIONS — the "location" picker for broadcast localization.
//
// ESPN accepts `region` + `lang` on its endpoints. They localize the broadcast
// listings (and some team-name spellings) WHERE ESPN HAS THAT DATA. Coverage is
// most complete for the US; other regions vary, and ESPN also geolocates by the
// caller's IP, so a user calling direct from their own country often gets their
// local networks automatically. Pick the closest match.
// -----------------------------------------------------------------------------
export const REGIONS = [
  { code: 'us',    label: 'United States',     region: 'us', lang: 'en' },
  { code: 'ca',    label: 'Canada',            region: 'ca', lang: 'en' },
  { code: 'ca-fr', label: 'Canada (Français)', region: 'ca', lang: 'fr' },
  { code: 'gb',    label: 'United Kingdom',     region: 'gb', lang: 'en' },
  { code: 'ie',    label: 'Ireland',            region: 'ie', lang: 'en' },
  { code: 'au',    label: 'Australia',          region: 'au', lang: 'en' },
  { code: 'in',    label: 'India',              region: 'in', lang: 'en' },
  { code: 'de',    label: 'Germany',            region: 'de', lang: 'de' },
  { code: 'es',    label: 'Spain',              region: 'es', lang: 'es' },
  { code: 'it',    label: 'Italy',              region: 'it', lang: 'it' },
  { code: 'fr',    label: 'France',             region: 'fr', lang: 'fr' },
  { code: 'br',    label: 'Brazil',             region: 'br', lang: 'pt' },
  { code: 'mx',    label: 'Mexico',             region: 'mx', lang: 'es' },
];

export const REGION_BY_CODE = Object.fromEntries(REGIONS.map((r) => [r.code, r]));

export function getRegion(code) {
  return REGION_BY_CODE[code] || REGION_BY_CODE[APP_CONFIG.defaultRegion] || REGIONS[0];
}

// -----------------------------------------------------------------------------
// LEAGUE REGISTRY
// -----------------------------------------------------------------------------
// Fields:
//   id        unique stable id used in storage + URLs (keep it short/kebab).
//   name      full display name.
//   short     compact label for chips/tabs.
//   sport     ESPN sport path segment (hockey|basketball|football|baseball|soccer).
//   league    ESPN league path segment (nhl, nba, eng.1, fifa.world, ...).
//   group     UI section grouping ("Hockey", "Soccer", "International", ...).
//   hasDraws  true for soccer — a finished game can end with no winner (draw).
//   intl      true for national-team competitions (affects copy + grouping).
//   tsdb      TheSportsDB league name, used only as a logo/badge fallback source.
//
// NOTE: the same physical league registry powers the "single sport" build and
// the full multi-sport build — the only difference is which ids the user follows.
// -----------------------------------------------------------------------------
export const LEAGUES = [
  // ---- North American major leagues ----
  { id: 'nhl', name: 'NHL', short: 'NHL', sport: 'hockey', league: 'nhl',
    group: 'Hockey', hasDraws: false, intl: false, tsdb: 'NHL' },

  { id: 'nba', name: 'NBA', short: 'NBA', sport: 'basketball', league: 'nba',
    group: 'Basketball', hasDraws: false, intl: false, tsdb: 'NBA' },

  { id: 'nfl', name: 'NFL', short: 'NFL', sport: 'football', league: 'nfl',
    group: 'Football', hasDraws: true /* ties are rare but possible */, intl: false, tsdb: 'NFL' },

  { id: 'mlb', name: 'MLB', short: 'MLB', sport: 'baseball', league: 'mlb',
    group: 'Baseball', hasDraws: false, intl: false, tsdb: 'MLB' },

  // ---- Club soccer ----
  { id: 'eng.1', name: 'Premier League', short: 'EPL', sport: 'soccer', league: 'eng.1',
    group: 'Soccer', hasDraws: true, intl: false, tsdb: 'English Premier League' },

  { id: 'esp.1', name: 'La Liga', short: 'La Liga', sport: 'soccer', league: 'esp.1',
    group: 'Soccer', hasDraws: true, intl: false, tsdb: 'Spanish La Liga' },

  { id: 'ger.1', name: 'Bundesliga', short: 'Bundesliga', sport: 'soccer', league: 'ger.1',
    group: 'Soccer', hasDraws: true, intl: false, tsdb: 'German Bundesliga' },

  { id: 'ita.1', name: 'Serie A', short: 'Serie A', sport: 'soccer', league: 'ita.1',
    group: 'Soccer', hasDraws: true, intl: false, tsdb: 'Italian Serie A' },

  { id: 'uefa.champions', name: 'Champions League', short: 'UCL', sport: 'soccer', league: 'uefa.champions',
    group: 'Soccer', hasDraws: true, intl: false, tsdb: 'UEFA Champions League' },

  // ---- International soccer (follow the Croatia national team here) ----
  // A national team keeps the SAME ESPN team id across these competitions, so
  // favoriting "Croatia" in any one of them highlights its games in all of them.
  { id: 'fifa.world', name: 'World Cup', short: 'World Cup', sport: 'soccer', league: 'fifa.world',
    group: 'International', hasDraws: true, intl: true, tsdb: '' },

  { id: 'uefa.nations', name: 'UEFA Nations League', short: 'Nations', sport: 'soccer', league: 'uefa.nations',
    group: 'International', hasDraws: true, intl: true, tsdb: '' },

  { id: 'fifa.worldq.uefa', name: 'World Cup Qualifying (UEFA)', short: 'WCQ', sport: 'soccer', league: 'fifa.worldq.uefa',
    group: 'International', hasDraws: true, intl: true, tsdb: '' },

  { id: 'fifa.friendly', name: 'Int’l Friendlies', short: 'Friendlies', sport: 'soccer', league: 'fifa.friendly',
    group: 'International', hasDraws: true, intl: true, tsdb: '' },
];

// Convenience lookups ---------------------------------------------------------
export const LEAGUE_BY_ID = Object.fromEntries(LEAGUES.map((l) => [l.id, l]));

export function getLeague(id) {
  return LEAGUE_BY_ID[id] || null;
}

// Leagues grouped by their `group` field, preserving registry order. Used to
// render the league picker and the grouped sections in the views.
export function leaguesByGroup() {
  const groups = new Map();
  for (const l of LEAGUES) {
    if (!groups.has(l.group)) groups.set(l.group, []);
    groups.get(l.group).push(l);
  }
  return groups;
}
