// =============================================================================
// ui/bracket.js — playoff / knockout bracket: a season picker + rounds rendered
// as left→right columns of matchups. Handles single-game matchups (soccer
// knockouts) and best-of-N series (team-league playoffs, with the series score).
// =============================================================================

import { el } from '../util/dom.js';
import { skeletonView } from './skeleton.js';
import { emptyState, errorState } from './render.js';
import { formatLocalDay } from '../util/dates.js';

function logoEl(side) {
  return side.logo
    ? (() => { const i = el('img', { class: 'bk-logo', src: side.logo, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' }); i.addEventListener('error', () => i.replaceWith(el('span', { class: 'bk-logo mono' }, [(side.abbr || side.displayName || '?').slice(0, 1)]))); return i; })()
    : el('span', { class: 'bk-logo mono' }, [(side.abbr || side.displayName || '?').slice(0, 1)]);
}

// One row inside a matchup: logo, name, and a right-hand value (game score or series wins).
function row(side, value, isWinner, isLoser) {
  return el('div', { class: 'bk-team' + (isWinner ? ' win' : '') + (isLoser ? ' lose' : '') }, [
    logoEl(side),
    el('span', { class: 'bk-name' }, [side.abbr || side.displayName || 'TBD']),
    el('span', { class: 'bk-score' }, [value]),
  ]);
}

function seriesMatch(m, onSelectGame) {
  return el('button', { class: 'bk-match' + (m.live ? ' live' : ''), onclick: () => onSelectGame(m.game) }, [
    row(m.away, m.awayWins != null ? String(m.awayWins) : '', m.awayWin, m.homeWin),
    row(m.home, m.homeWins != null ? String(m.homeWins) : '', m.homeWin, m.awayWin),
    el('div', { class: 'bk-status muted' }, [m.summary || 'Series']),
  ]);
}

function gameMatch(g, onSelectGame) {
  const homeWin = g.isFinal && g.home.winner;
  const awayWin = g.isFinal && g.away.winner;
  const status = g.isLive ? (g.statusDetail || 'LIVE')
    : g.isFinal ? (g.isDraw ? 'Draw' : 'Final')
      : (Number.isFinite(g.startMs) ? formatLocalDay(new Date(g.startMs)) : 'TBD');
  const showScore = !g.isPre;
  return el('button', { class: 'bk-match' + (g.isLive ? ' live' : ''), onclick: () => onSelectGame(g) }, [
    row(g.away, showScore ? (g.away.score || '0') : '', awayWin, g.isFinal && !awayWin && !g.isDraw),
    row(g.home, showScore ? (g.home.score || '0') : '', homeWin, g.isFinal && !homeWin && !g.isDraw),
    el('div', { class: 'bk-status muted' }, [g.isLive ? el('span', { class: 'live-dot' }) : null, status]),
  ]);
}

function matchup(m, onSelectGame) {
  return m.kind === 'series' ? seriesMatch(m, onSelectGame) : gameMatch(m.game, onSelectGame);
}

function seasonBar(seasons, season, onSelectSeason) {
  if (!seasons || !seasons.length || !onSelectSeason) return null;
  const sel = el('select', { class: 'region-select season-select', aria: { label: 'Season' } },
    seasons.map((y) => el('option', { value: String(y) }, [String(y)])));
  sel.value = String(season);
  sel.addEventListener('change', () => onSelectSeason(Number(sel.value)));
  return el('div', { class: 'bk-seasonbar' }, [el('span', { class: 'small muted' }, ['Season']), sel]);
}

export function buildBracketView({ result, loading, error, seasons, season, onSelectSeason, onSelectGame, onRetry }) {
  const wrap = el('div', { class: 'bracket-view' });
  const bar = seasonBar(seasons, season, onSelectSeason);
  if (bar) wrap.appendChild(bar);

  if (loading) { wrap.appendChild(skeletonView(1)); return wrap; }
  if (error || !result) { wrap.appendChild(errorState('Couldn’t load bracket', error?.message || 'Bracket data was unavailable.', { onRetry })); return wrap; }
  if (result.empty) {
    wrap.appendChild(emptyState('No bracket for this season', 'No knockout/playoff games found for this league & season. Pick another season above — or this league may not have a bracket (regular-league tables show under “Teams”).'));
    return wrap;
  }

  wrap.appendChild(el('p', { class: 'muted small tap-hint' }, ['Tap a matchup for details. Series show the series score; upcoming knockout slots fill in as earlier rounds finish.']));
  const scroller = el('div', { class: 'bk-scroller' });
  for (const round of result.rounds) {
    scroller.appendChild(el('div', { class: 'bk-round' }, [
      el('div', { class: 'bk-round-label' }, [round.label]),
      ...round.matches.map((m) => matchup(m, onSelectGame)),
    ]));
  }
  wrap.appendChild(scroller);
  return wrap;
}
