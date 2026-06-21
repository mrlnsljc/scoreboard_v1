// =============================================================================
// ui/player.js — player detail: header + per-game summary chips + season table.
// =============================================================================

import { el } from '../util/dom.js';
import { skeletonView } from './skeleton.js';
import { errorState } from './render.js';

function backBar(label, onBack) {
  return el('button', { class: 'back-bar', onclick: onBack }, ['‹ ', label]);
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

  wrap.appendChild(el('div', { class: 'detail-head' }, [
    head,
    el('div', { class: 'detail-head-meta' }, [
      el('h2', {}, [p.name]),
      el('div', { class: 'detail-sub muted' }, [[p.jersey ? `#${p.jersey}` : '', p.pos, p.team].filter(Boolean).join(' · ')]),
      (p.height || p.weight || p.age) ? el('div', { class: 'muted small' }, [[p.height, p.weight, p.age ? `Age ${p.age}` : '', p.college].filter(Boolean).join(' · ')]) : null,
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

  // season-by-season table
  if (result.table && result.table.rows.length) {
    wrap.appendChild(el('h3', { class: 'detail-section' }, [result.table.name || 'By season']));
    wrap.appendChild(el('div', { class: 'table-wrap' }, [
      el('table', { class: 'player-table' }, [
        el('thead', {}, [el('tr', {}, [el('th', { class: 'c-season' }, ['Season']), ...result.table.labels.map((l) => el('th', { class: 'c-num' }, [l]))])]),
        el('tbody', {}, result.table.rows.map((r) => el('tr', {}, [
          el('td', { class: 'c-season' }, [r.season]),
          ...r.stats.map((v) => el('td', { class: 'c-num' }, [v])),
        ]))),
      ]),
    ]));
  } else {
    wrap.appendChild(el('p', { class: 'muted small' }, ['No season stats available for this player.']));
  }

  return wrap;
}
