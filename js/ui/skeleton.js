// =============================================================================
// ui/skeleton.js — loading placeholders so we never show a blank screen.
// =============================================================================
import { el } from '../util/dom.js';

function skeletonCard() {
  return el('div', { class: 'card skeleton-card' }, [
    el('div', { class: 'sk sk-status' }),
    el('div', { class: 'team-row' }, [
      el('div', { class: 'sk sk-logo' }),
      el('div', { class: 'sk sk-name' }),
      el('div', { class: 'sk sk-score' }),
    ]),
    el('div', { class: 'team-row' }, [
      el('div', { class: 'sk sk-logo' }),
      el('div', { class: 'sk sk-name' }),
      el('div', { class: 'sk sk-score' }),
    ]),
  ]);
}

export function skeletonView(n = 6) {
  const wrap = el('div', { class: 'sections' });
  wrap.appendChild(el('div', { class: 'section-head' }, [el('div', { class: 'sk sk-head' })]));
  const grid = el('div', { class: 'card-grid' });
  for (let i = 0; i < n; i++) grid.appendChild(skeletonCard());
  wrap.appendChild(grid);
  return wrap;
}
