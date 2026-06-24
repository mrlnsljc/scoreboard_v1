// =============================================================================
// ui/bracket.js — playoff / knockout bracket: rounds rendered as left→right
// columns of matchups. Each matchup is clickable (opens the game page).
// =============================================================================

import { el } from '../util/dom.js';
import { skeletonView } from './skeleton.js';
import { emptyState, errorState } from './render.js';
import { formatLocalDay } from '../util/dates.js';

function teamRow(side, game, isWinner) {
  const logo = side.logo
    ? (() => { const i = el('img', { class: 'bk-logo', src: side.logo, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' }); i.addEventListener('error', () => i.replaceWith(el('span', { class: 'bk-logo mono' }, [(side.abbr || side.displayName || '?').slice(0, 1)]))); return i; })()
    : el('span', { class: 'bk-logo mono' }, [(side.abbr || side.displayName || '?').slice(0, 1)]);
  const showScore = !game.isPre;
  return el('div', { class: 'bk-team' + (isWinner ? ' win' : '') + (game.isFinal && !isWinner && !game.isDraw ? ' lose' : '') }, [
    logo,
    el('span', { class: 'bk-name' }, [side.abbr || side.displayName || 'TBD']),
    el('span', { class: 'bk-score' }, [showScore ? (side.score || '0') : '']),
  ]);
}

function matchup(game, onSelectGame) {
  const homeWin = game.isFinal && game.home.winner;
  const awayWin = game.isFinal && game.away.winner;
  const status = game.isLive ? (game.statusDetail || 'LIVE')
    : game.isFinal ? (game.isDraw ? 'Draw' : 'Final')
      : (Number.isFinite(game.startMs) ? formatLocalDay(new Date(game.startMs)) : 'TBD');
  return el('button', { class: 'bk-match' + (game.isLive ? ' live' : ''), onclick: () => onSelectGame(game) }, [
    teamRow(game.away, game, awayWin),
    teamRow(game.home, game, homeWin),
    el('div', { class: 'bk-status muted' }, [game.isLive ? el('span', { class: 'live-dot' }) : null, status]),
  ]);
}

export function buildBracketView({ result, loading, error, onSelectGame, onRetry }) {
  const wrap = el('div', { class: 'bracket-view' });
  if (loading) { wrap.appendChild(skeletonView(1)); return wrap; }
  if (error || !result) { wrap.appendChild(errorState('Couldn’t load bracket', error?.message || 'Bracket data was unavailable.', { onRetry })); return wrap; }
  if (result.empty) {
    wrap.appendChild(emptyState('No active bracket', 'No knockout or playoff bracket for this league right now. Brackets appear during tournaments & playoffs — e.g. the World Cup knockouts, or NBA / NHL / NFL playoffs.'));
    return wrap;
  }

  wrap.appendChild(el('p', { class: 'muted small tap-hint' }, ['Tap any matchup for the game details. Upcoming knockout slots fill in as earlier rounds finish.']));
  const scroller = el('div', { class: 'bk-scroller' });
  for (const round of result.rounds) {
    scroller.appendChild(el('div', { class: 'bk-round' }, [
      el('div', { class: 'bk-round-label' }, [round.label]),
      ...round.games.map((g) => matchup(g, onSelectGame)),
    ]));
  }
  wrap.appendChild(scroller);
  return wrap;
}
