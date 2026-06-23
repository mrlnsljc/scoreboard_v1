// =============================================================================
// ui/render.js — pure-ish view components that turn normalized Games into DOM.
// No data fetching here; callbacks are passed in from app.js.
// =============================================================================

import { el } from '../util/dom.js';
import { formatLocalTime } from '../util/dates.js';
import { isTeamFavorite } from '../store/favorites.js';

// ---- team logo / monogram fallback -----------------------------------------
function monogram(side) {
  const text = (side.abbr || side.displayName || '?').slice(0, 3).toUpperCase();
  const bg = side.color || '#3a4250';
  return el('div', { class: 'logo mono', style: { background: bg }, aria: { hidden: 'true' } }, [text]);
}

function teamLogo(side) {
  if (!side.logo) return monogram(side);
  const img = el('img', {
    class: 'logo', src: side.logo, alt: '', loading: 'lazy', decoding: 'async', referrerpolicy: 'no-referrer',
  });
  // If the CDN url 404s, swap in a monogram so we never show a broken image.
  img.addEventListener('error', () => img.replaceWith(monogram(side)));
  return img;
}

// ---- favorite star ----------------------------------------------------------
function favStar(side, onToggleTeam) {
  const active = isTeamFavorite(side.favKey);
  const btn = el('button', {
    class: 'star' + (active ? ' on' : ''),
    title: active ? `Unfavorite ${side.displayName}` : `Favorite ${side.displayName}`,
    aria: { label: active ? `Unfavorite ${side.displayName}` : `Favorite ${side.displayName}`, pressed: String(active) },
    onclick: (e) => { e.stopPropagation(); onToggleTeam(side); },
  }, [active ? '★' : '☆']);
  return btn;
}

// ---- status badge -----------------------------------------------------------
function statusBadge(game) {
  if (game.isLive) {
    return el('span', { class: 'badge live' }, [
      el('span', { class: 'live-dot' }),
      game.statusDetail || 'LIVE',
    ]);
  }
  if (game.isFinal) {
    return el('span', { class: 'badge final' }, [game.statusDetail || 'Final']);
  }
  // scheduled -> show local start time (ESPN's shortDetail is in a fixed zone)
  const t = Number.isFinite(game.startMs) ? formatLocalTime(new Date(game.startMs)) : (game.statusDetail || 'Scheduled');
  return el('span', { class: 'badge sched' }, [t]);
}

// ---- one team row -----------------------------------------------------------
function teamRow(side, game, onToggleTeam) {
  const showScore = !game.isPre; // hide "0" before tip-off
  const isWinner = game.isFinal && side.winner;
  const cls = 'team-row' + (isWinner ? ' winner' : '') + (game.isFinal && !side.winner && !game.isDraw ? ' loser' : '');

  return el('div', { class: cls }, [
    teamLogo(side),
    el('div', { class: 'team-meta' }, [
      el('span', { class: 'team-name' }, [side.displayName || 'TBD']),
      side.record ? el('span', { class: 'team-record' }, [side.record]) : null,
    ]),
    favStar(side, onToggleTeam),
    el('div', { class: 'team-score' }, [showScore ? (side.score || '0') : '']),
  ]);
}

// ---- game card --------------------------------------------------------------
export function gameCard(game, { onToggleTeam, onOpenGame, showLeague = false, pinned = false } = {}) {
  const followed = pinned; // pinned cards are favorite-involving -> highlight
  // Team-color accent: tint with a favorited side's color, else the home side's.
  const accentSide = isTeamFavorite(game.home.favKey) ? game.home
    : isTeamFavorite(game.away.favKey) ? game.away : game.home;
  const accent = accentSide.color || accentSide.altColor || '';
  const card = el('div', {
    class: 'card game-card' + (game.isLive ? ' is-live' : '') + (followed ? ' pinned' : '') + (onOpenGame ? ' clickable' : '') + (accent ? ' accented' : ''),
    dataset: { gameId: game.id, leagueId: game.leagueId },
    style: accent ? { '--team-accent': accent } : null,
    onclick: onOpenGame ? () => onOpenGame(game) : undefined,
  }, [
    el('div', { class: 'card-top' }, [
      showLeague ? el('span', { class: 'league-tag' }, [game.league.short]) : null,
      game.note ? el('span', { class: 'note-tag', title: game.note }, [game.note]) : null,
      el('span', { class: 'spacer' }),
      statusBadge(game),
    ]),
    // Away on top, home on the bottom (standard "AWAY @ HOME").
    teamRow(game.away, game, onToggleTeam),
    teamRow(game.home, game, onToggleTeam),
    (game.broadcast || game.venue) ? el('div', { class: 'card-foot' }, [
      game.broadcast ? el('span', { class: 'foot-item' }, [game.broadcast]) : null,
      (game.broadcast && game.venue) ? el('span', { class: 'foot-sep' }, ['·']) : null,
      game.venue ? el('span', { class: 'foot-item muted' }, [game.venue]) : null,
    ]) : null,
  ]);
  return card;
}

// ---- form guide (last-5 W/L/D pills) ----------------------------------------
// Given a team's normalized schedule + its teamId, render up to 5 pills for the
// most recent finished games (oldest → newest), color-coded W/L/D. Returns null
// if there's nothing finished to show.
export function formPills(schedule, teamId, { max = 5 } = {}) {
  const finals = (schedule || []).filter((g) => g.isFinal && (g.home?.teamId === teamId || g.away?.teamId === teamId));
  const last = finals.slice(-max);
  if (!last.length) return null;
  const pills = last.map((g) => {
    const me = g.home.teamId === teamId ? g.home : g.away;
    const opp = g.home.teamId === teamId ? g.away : g.home;
    const res = g.isDraw ? 'D' : (me.winner ? 'W' : 'L');
    const cls = res === 'W' ? 'win' : res === 'L' ? 'loss' : 'draw';
    const score = (me.score !== '' && opp.score !== '') ? `${me.score}-${opp.score}` : '';
    return el('span', { class: `form-pill ${cls}`, title: `${res} ${score} vs ${opp.abbr || opp.displayName}`.trim() }, [res]);
  });
  return el('div', { class: 'form-guide', aria: { label: 'Recent form, last 5 games' } }, pills);
}

// ---- section -----------------------------------------------------------------
export function section(title, cards, { sub = '', accent = false } = {}) {
  const head = el('div', { class: 'section-head' + (accent ? ' accent' : '') }, [
    el('h2', {}, [title]),
    sub ? el('span', { class: 'section-sub' }, [sub]) : null,
    el('span', { class: 'count' }, [String(cards.length)]),
  ]);
  const grid = el('div', { class: 'card-grid' });
  cards.forEach((c) => grid.appendChild(c));
  return el('section', { class: 'sec' }, [head, grid]);
}

// ---- generic empty / error / banner blocks ----------------------------------
export function emptyState(title, msg) {
  return el('div', { class: 'empty' }, [
    el('div', { class: 'empty-emoji', aria: { hidden: 'true' } }, ['🗓️']),
    el('div', { class: 'empty-title' }, [title]),
    msg ? el('div', { class: 'empty-msg' }, [msg]) : null,
  ]);
}

export function errorState(title, msg, { onRetry, showProxyHint } = {}) {
  return el('div', { class: 'empty error' }, [
    el('div', { class: 'empty-emoji', aria: { hidden: 'true' } }, ['⚠️']),
    el('div', { class: 'empty-title' }, [title]),
    msg ? el('div', { class: 'empty-msg' }, [msg]) : null,
    showProxyHint ? el('div', { class: 'empty-msg hint' }, [
      'If this is a CORS/network block, enable the proxy in Settings (⚙) — see the README.',
    ]) : null,
    onRetry ? el('button', { class: 'btn', onclick: onRetry }, ['Retry']) : null,
  ]);
}
