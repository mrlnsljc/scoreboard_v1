// =============================================================================
// ui/golf.js — golf majors view: a selector for the four majors + a leaderboard.
// Pure rendering; app.js handles fetching/state.
// =============================================================================

import { el } from '../util/dom.js';
import { formatLocalDay } from '../util/dates.js';
import { skeletonView } from './skeleton.js';
import { emptyState, errorState } from './render.js';

function statusPill(major) {
  if (major.status === 'live') return el('span', { class: 'gchip-status live' }, [el('span', { class: 'live-dot' }), 'LIVE']);
  if (major.status === 'final') return el('span', { class: 'gchip-status done' }, ['Final']);
  return el('span', { class: 'gchip-status up' }, [formatLocalDay(new Date(major.startDate))]);
}

function majorChips(majors, selectedLabel, onSelect) {
  return el('div', { class: 'major-chips' }, majors.map((m) => el('button', {
    class: 'major-chip' + (m.label === selectedLabel ? ' active' : '') + (m.status === 'live' ? ' is-live' : ''),
    onclick: () => onSelect(m.label),
  }, [
    el('span', { class: 'mc-name' }, [m.short]),
    statusPill(m),
  ])));
}

function flag(p) {
  if (!p.flagHref) return null;
  const img = el('img', { class: 'flag', src: p.flagHref, alt: p.flagAlt || '', loading: 'lazy', referrerpolicy: 'no-referrer' });
  img.addEventListener('error', () => img.remove());
  return img;
}

function leaderboardTable(lb) {
  const live = lb.isLive;
  const nRounds = Math.min(lb.maxRounds || 0, 4);
  const roundCols = Array.from({ length: nRounds }, (_, i) => `R${i + 1}`);

  const head = el('tr', {}, [
    el('th', { class: 'c-pos' }, ['Pos']),
    el('th', { class: 'c-player' }, ['Player']),
    live ? el('th', { class: 'c-num' }, ['Today']) : null,
    live ? el('th', { class: 'c-num' }, ['Thru']) : null,
    el('th', { class: 'c-num c-total' }, ['Total']),
    ...roundCols.map((r) => el('th', { class: 'c-num c-round' }, [r])),
  ]);

  const rows = lb.players.map((p) => el('tr', { class: p.isWinner ? 'winner' : '' }, [
    el('td', { class: 'c-pos' }, [p.posText || '—']),
    el('td', { class: 'c-player' }, [flag(p), el('span', { class: 'pl-name' }, [p.name])]),
    live ? el('td', { class: 'c-num' }, [p.today || '—']) : null,
    live ? el('td', { class: 'c-num thru' }, [p.thru || '—']) : null,
    el('td', { class: 'c-num c-total' }, [p.total]),
    ...roundCols.map((_, i) => el('td', { class: 'c-num c-round' }, [p.rounds[i] || '—'])),
  ]));

  return el('div', { class: 'table-wrap' }, [
    el('table', { class: 'lb-table' }, [el('thead', {}, [head]), el('tbody', {}, rows)]),
  ]);
}

export function buildGolfView({ majors, selectedLabel, leaderboard, loading, error, onSelect, onRetry }) {
  const wrap = el('div', { class: 'golf-view' });

  if (!majors || majors.length === 0) {
    wrap.appendChild(loading ? skeletonView(1) : errorState('Couldn’t load golf', error?.message || 'The golf schedule was unavailable.', { onRetry }));
    return wrap;
  }

  wrap.appendChild(majorChips(majors, selectedLabel, onSelect));

  const sel = majors.find((m) => m.label === selectedLabel);
  const header = el('div', { class: 'golf-head' }, [
    el('h2', {}, [sel ? sel.label : 'Major']),
    sel ? el('span', { class: 'golf-sub' }, [
      sel.status === 'live' ? 'In progress' : sel.status === 'final' ? 'Final' : `Starts ${formatLocalDay(new Date(sel.startDate))}`,
    ]) : null,
  ]);
  wrap.appendChild(header);

  if (loading) { wrap.appendChild(skeletonView(1)); return wrap; }
  if (error && !leaderboard) { wrap.appendChild(errorState('Couldn’t load leaderboard', error.message, { onRetry })); return wrap; }

  if (!leaderboard || !leaderboard.players.length) {
    wrap.appendChild(sel && sel.status === 'upcoming'
      ? emptyState('Field not set yet', `${sel.label} starts ${formatLocalDay(new Date(sel.startDate))}. Check back closer to tee-off.`)
      : emptyState('No leaderboard', 'No player data is available for this event yet.'));
    return wrap;
  }

  if (leaderboard.isFinal && leaderboard.players[0]) {
    const w = leaderboard.players[0];
    wrap.appendChild(el('div', { class: 'golf-winner' }, [
      el('span', { class: 'trophy', aria: { hidden: 'true' } }, ['🏆']),
      el('span', {}, ['Champion: ']), el('strong', {}, [w.name]), el('span', { class: 'muted' }, [` (${w.total})`]),
    ]));
  }

  wrap.appendChild(leaderboardTable(leaderboard));
  return wrap;
}
