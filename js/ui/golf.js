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

function leaderboardTable(lb, limit) {
  const live = lb.isLive;
  const nRounds = Math.min(lb.maxRounds || 0, 4);
  const roundCols = Array.from({ length: nRounds }, (_, i) => `R${i + 1}`);
  const shown = limit ? lb.players.slice(0, limit) : lb.players;

  const head = el('tr', {}, [
    el('th', { class: 'c-pos' }, ['Pos']),
    el('th', { class: 'c-player' }, ['Player']),
    live ? el('th', { class: 'c-num' }, ['Today']) : null,
    live ? el('th', { class: 'c-num' }, ['Thru']) : null,
    el('th', { class: 'c-num c-total' }, ['Total']),
    ...roundCols.map((r) => el('th', { class: 'c-num c-round' }, [r])),
  ]);

  const rows = shown.map((p) => el('tr', { class: p.isWinner ? 'winner' : '' }, [
    el('td', { class: 'c-pos' }, [p.posText || '—']),
    el('td', { class: 'c-player' }, [flag(p), el('span', { class: 'pl-name' }, [p.name])]),
    live ? el('td', { class: 'c-num' }, [p.today || '—']) : null,
    live ? el('td', { class: 'c-num thru' }, [p.thru || '—']) : null,
    el('td', { class: 'c-num c-total' }, [p.total]),
    ...roundCols.map((_, i) => el('td', { class: 'c-num c-round' }, [p.rounds[i] || '—'])),
  ]));

  const wrap = el('div', { class: 'table-wrap' }, [
    el('table', { class: 'lb-table' }, [el('thead', {}, [head]), el('tbody', {}, rows)]),
  ]);
  if (limit && lb.players.length > limit) wrap.appendChild(el('div', { class: 'lb-more muted small' }, [`+${lb.players.length - limit} more`]));
  return wrap;
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

// ---------------------------------------------------------------------------
// Golf archive (lives under the Standings page): each major is a section with
// its own year selector and a compact leaderboard for the chosen year.
// `majors`: [{ label, short, year, leaderboard, loading, error }]
// ---------------------------------------------------------------------------
export function buildGolfArchive({ leagueSelect, years, majors, onSelectYear }) {
  const wrap = el('div', { class: 'golf-archive' });
  if (leagueSelect) wrap.appendChild(leagueSelect);

  for (const m of majors) {
    const yearSel = el('select', { class: 'region-select season-select', aria: { label: `${m.label} year` } },
      years.map((y) => el('option', { value: String(y) }, [String(y)])));
    yearSel.value = String(m.year);
    yearSel.addEventListener('change', () => onSelectYear(m.label, Number(yearSel.value)));

    const lb = m.leaderboard;
    const statusTxt = lb ? (lb.isFinal ? 'Final' : lb.isLive ? 'In progress' : 'Scheduled') : '';
    wrap.appendChild(el('div', { class: 'golf-major-head' }, [
      el('h2', { class: 'std-group' }, [m.label]),
      statusTxt ? el('span', { class: 'golf-sub' + (lb && lb.isLive ? ' live' : '') }, [statusTxt]) : null,
      el('span', { class: 'spacer' }),
      yearSel,
    ]));

    if (m.loading) { wrap.appendChild(skeletonView(1)); continue; }
    if (m.error) {
      wrap.appendChild(el('div', { class: 'muted small' }, [
        'Couldn’t load this year. ',
        el('button', { class: 'btn ghost small', onclick: () => onSelectYear(m.label, m.year) }, ['Retry']),
      ]));
      continue;
    }
    if (lb && lb.players.length) {
      if (lb.isFinal && lb.players[0]) {
        wrap.appendChild(el('div', { class: 'golf-winner' }, [
          el('span', { class: 'trophy', aria: { hidden: 'true' } }, ['🏆']),
          el('span', {}, ['Champion: ']), el('strong', {}, [lb.players[0].name]), el('span', { class: 'muted' }, [` (${lb.players[0].total})`]),
        ]));
      }
      wrap.appendChild(leaderboardTable(lb, 10));
    } else {
      wrap.appendChild(el('p', { class: 'muted small' }, ['No leaderboard for this year (the tournament may not have been played yet).']));
    }
  }
  return wrap;
}
