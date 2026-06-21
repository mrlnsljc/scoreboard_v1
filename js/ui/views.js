// =============================================================================
// ui/views.js — pure view builders: (normalized games + flags) -> DOM.
// Fetching/state lives in app.js; this file only arranges + renders.
// =============================================================================

import { el } from '../util/dom.js';
import { gameCard, section, emptyState } from './render.js';
import { hasFavoriteSide } from '../store/favorites.js';
import { LEAGUES } from '../config.js';
import { localDayKey, relativeDayLabel } from '../util/dates.js';

// Ordering within a group: LIVE first, then upcoming by time, finals last.
function orderKey(g) {
  const phase = g.isLive ? 0 : g.isPre ? 1 : 2;
  return phase * 1e15 + (g.startMs || 0);
}
function byOrder(a, b) { return orderKey(a) - orderKey(b); }

const leagueOrder = Object.fromEntries(LEAGUES.map((l, i) => [l.id, i]));

// ---------------------------------------------------------------------------
// TODAY: a "Following" section (favorite-team games, pinned + highlighted) on
// top, then one section per followed league.
// ---------------------------------------------------------------------------
export function buildTodayView(games, { onToggleTeam, onOpenGame, favoritesOnly, hasFavorites, dateLabel = 'today' }) {
  const wrap = el('div', { class: 'sections' });
  // lower-case for inline copy ("No games yesterday"), keep "Today"->"today"
  const dayWord = /^(today|yesterday|tomorrow)$/i.test(dateLabel) ? dateLabel.toLowerCase() : `on ${dateLabel}`;

  const fav = games.filter(hasFavoriteSide).sort(byOrder);
  const favIds = new Set(fav.map((g) => g.id));
  const rest = games.filter((g) => !favIds.has(g.id));

  if (favoritesOnly) {
    if (fav.length === 0) {
      wrap.appendChild(hasFavorites
        ? emptyState('Nothing for your favorites', `None of your favorite teams play ${dayWord}. Turn off “Favorites only” to see everything, or check Upcoming.`)
        : emptyState('No favorites yet', 'Use 🔍 Search (or tap the ☆ on a team) to favorite teams and leagues, then flip on “Favorites only”.'));
      return wrap;
    }
    wrap.appendChild(section('★ Following', fav.map((g) => gameCard(g, { onToggleTeam, onOpenGame, showLeague: true, pinned: true })), { accent: true }));
    return wrap;
  }

  if (games.length === 0) {
    wrap.appendChild(emptyState(`No games ${dayWord}`, 'None of your followed leagues have games on this day. Try another day or the Upcoming tab.'));
    return wrap;
  }

  if (fav.length) {
    wrap.appendChild(section('★ Following', fav.map((g) => gameCard(g, { onToggleTeam, onOpenGame, showLeague: true, pinned: true })), { accent: true }));
  }

  // Group the rest by league, in registry order.
  const byLeague = new Map();
  for (const g of rest) {
    if (!byLeague.has(g.leagueId)) byLeague.set(g.leagueId, []);
    byLeague.get(g.leagueId).push(g);
  }
  const leagueIds = [...byLeague.keys()].sort((a, b) => (leagueOrder[a] ?? 99) - (leagueOrder[b] ?? 99));
  for (const lid of leagueIds) {
    const list = byLeague.get(lid).sort(byOrder);
    const liveCount = list.filter((g) => g.isLive).length;
    wrap.appendChild(section(list[0].league.name, list.map((g) => gameCard(g, { onToggleTeam, onOpenGame })), {
      sub: liveCount ? `${liveCount} live` : '',
    }));
  }
  return wrap;
}

// ---------------------------------------------------------------------------
// UPCOMING: grouped by local day; mixed leagues per day so each card shows a
// league tag; favorite-team games are pinned to the top of each day + highlighted.
// ---------------------------------------------------------------------------
export function buildUpcomingView(games, { onToggleTeam, onOpenGame, favoritesOnly, hasFavorites }) {
  const wrap = el('div', { class: 'sections' });

  let list = games.slice();
  if (favoritesOnly) list = list.filter(hasFavoriteSide);

  if (list.length === 0) {
    wrap.appendChild(favoritesOnly
      ? emptyState('Nothing scheduled for your favorites', hasFavorites ? 'No upcoming games for your favorite teams in this window.' : 'Add some favorites first (☆ on a team).')
      : emptyState('Nothing scheduled', 'No upcoming games for your followed leagues in this window.'));
    return wrap;
  }

  // Group by local calendar day.
  const byDay = new Map();
  for (const g of list) {
    if (!Number.isFinite(g.startMs)) continue;
    const key = localDayKey(new Date(g.startMs));
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key).push(g);
  }
  const dayKeys = [...byDay.keys()].sort();

  for (const key of dayKeys) {
    const dayGames = byDay.get(key);
    // favorites first within the day, then by time
    dayGames.sort((a, b) => {
      const fa = hasFavoriteSide(a) ? 0 : 1;
      const fb = hasFavoriteSide(b) ? 0 : 1;
      return fa - fb || byOrder(a, b);
    });
    const label = relativeDayLabel(new Date(dayGames[0].startMs));
    const cards = dayGames.map((g) => gameCard(g, {
      onToggleTeam, onOpenGame, showLeague: true, pinned: hasFavoriteSide(g),
    }));
    wrap.appendChild(section(label, cards));
  }
  return wrap;
}
