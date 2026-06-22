// =============================================================================
// ui/player.js — player detail: header + per-game summary chips + season table.
// =============================================================================

import { el } from '../util/dom.js';
import { skeletonView } from './skeleton.js';
import { errorState } from './render.js';

function backBar(label, onBack) {
  return el('button', { class: 'back-bar', onclick: onBack }, ['‹ ', label]);
}

// A season stats table whose columns sort in place when you click a header.
// Column 0 is Season; columns 1.. are the stat labels. Values parse the leading
// number (handles "6.7-12.3" -> 6.7); non-numeric sink to the bottom.
function sortableStatTable(labels, rows) {
  let sortCol = -1;        // -1 = as-fetched (newest season first)
  let sortDir = 'desc';

  const valOf = (row, col) => {
    const raw = col === 0 ? row.season : row.stats[col - 1];
    const m = /-?\d+(\.\d+)?/.exec(String(raw ?? ''));
    return m ? parseFloat(m[0]) : NaN;
  };

  const head = el('tr', {});
  const body = el('tbody', {});

  const renderHead = () => head.replaceChildren(
    el('th', { class: 'c-season sortable' + (sortCol === 0 ? ' sorted' : ''), onclick: () => onSort(0) },
      ['Season' + (sortCol === 0 ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '')]),
    ...labels.map((l, i) => el('th', { class: 'c-num sortable' + (sortCol === i + 1 ? ' sorted' : ''), onclick: () => onSort(i + 1) },
      [l + (sortCol === i + 1 ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '')])),
  );

  const renderBody = () => {
    let r = rows.slice();
    if (sortCol >= 0) {
      r.sort((a, b) => {
        const av = valOf(a, sortCol); const bv = valOf(b, sortCol);
        const an = Number.isFinite(av) ? av : -Infinity; const bn = Number.isFinite(bv) ? bv : -Infinity;
        return sortDir === 'asc' ? an - bn : bn - an;
      });
    }
    body.replaceChildren(...r.map((row) => el('tr', {}, [
      el('td', { class: 'c-season' }, [row.season]),
      ...row.stats.map((v, i) => el('td', { class: 'c-num' + (i + 1 === sortCol ? ' sorted' : '') }, [v])),
    ])));
  };

  function onSort(col) {
    if (col === sortCol) sortDir = sortDir === 'asc' ? 'desc' : 'asc';
    else { sortCol = col; sortDir = 'desc'; }
    renderHead(); renderBody();
  }

  renderHead(); renderBody();
  return el('div', { class: 'table-wrap' }, [el('table', { class: 'player-table' }, [el('thead', {}, [head]), body])]);
}

export function buildPlayerView({ result, loading, error, backLabel, onBack, onRetry }) {
  const wrap = el('div', { class: 'detail-view' });
  wrap.appendChild(backBar(backLabel || 'Back', onBack));

  if (loading) { wrap.appendChild(skeletonView(1)); return wrap; }
  if (error || !result) { wrap.appendChild(errorState('Couldn’t load player', error?.message || 'Player data was unavailable.', { onRetry })); return wrap; }

  const p = result.player;
  const head = p.headshot
    ? (() => { const i = el('img', { class: 'player-head', src: p.headshot, alt: '', referrerpolicy: 'no-referrer' }); i.addEventListener('error', () => i.replaceWith(el('div', { class: 'player-head mono' }, [p.name.slice(0, 1)]))); return i; })()
    : el('div', { class: 'player-head mono' }, [p.name.slice(0, 1)]);

  const flagEl = p.flag ? (() => {
    const i = el('img', { class: 'player-flag', src: p.flag, alt: p.citizenship || '', title: p.citizenship || '', referrerpolicy: 'no-referrer' });
    i.addEventListener('error', () => i.remove());
    return i;
  })() : null;

  wrap.appendChild(el('div', { class: 'detail-head' }, [
    head,
    el('div', { class: 'detail-head-meta' }, [
      el('h2', {}, [p.name]),
      el('div', { class: 'detail-sub muted' }, [
        flagEl,
        el('span', {}, [[p.jersey ? `#${p.jersey}` : '', p.pos, p.team].filter(Boolean).join(' · ')]),
      ]),
      (p.height || p.weight || p.age || p.citizenship) ? el('div', { class: 'muted small' }, [[p.height, p.weight, p.age ? `Age ${p.age}` : '', p.citizenship, p.college].filter(Boolean).join(' · ')]) : null,
    ]),
  ]));

  // summary stat chips (with league rank where present)
  if (p.summary && p.summary.length) {
    if (p.summaryLabel) wrap.appendChild(el('h3', { class: 'detail-section' }, [p.summaryLabel]));
    wrap.appendChild(el('div', { class: 'stat-chips' }, p.summary.map((s) => el('div', { class: 'stat-chip' }, [
      el('span', { class: 'sc-val' }, [s.value]),
      el('span', { class: 'sc-label' }, [s.label]),
      s.rank ? el('span', { class: 'sc-rank muted' }, [s.rank]) : null,
    ]))));
  }

  // season-by-season table (sortable — click any column header)
  if (result.table && result.table.rows.length) {
    wrap.appendChild(el('h3', { class: 'detail-section' }, [result.table.name || 'By season']));
    wrap.appendChild(el('p', { class: 'muted small tap-hint' }, ['Tap a column header to sort by it.']));
    wrap.appendChild(sortableStatTable(result.table.labels, result.table.rows));
  } else {
    wrap.appendChild(el('p', { class: 'muted small' }, ['No season stats available for this player.']));
  }

  return wrap;
}
