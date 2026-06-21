// =============================================================================
// ui/standings.js — league standings tables. A league picker + one table per
// group (conference/division/flat table). Favorited teams' rows are highlighted.
// Pure rendering; app.js handles fetching/state.
// =============================================================================

import { el } from '../util/dom.js';
import { skeletonView } from './skeleton.js';
import { emptyState, errorState } from './render.js';
import { isTeamFavorite } from '../store/favorites.js';

function teamCell(row) {
  const logo = row.logo
    ? (() => { const i = el('img', { class: 'logo sm', src: row.logo, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' }); i.addEventListener('error', () => i.replaceWith(el('span', { class: 'logo sm mono' }, [(row.abbr || row.name).slice(0, 2)]))); return i; })()
    : el('span', { class: 'logo sm mono' }, [(row.abbr || row.name).slice(0, 2)]);
  return el('td', { class: 'c-team' }, [logo, el('span', { class: 'st-name' }, [row.name])]);
}

function groupTable(group, columns) {
  const head = el('tr', {}, [
    el('th', { class: 'c-rank' }, ['#']),
    el('th', { class: 'c-team' }, ['Team']),
    ...columns.map(([, label]) => el('th', { class: 'c-num' }, [label])),
  ]);
  const rows = group.rows.map((r) => el('tr', { class: isTeamFavorite(r.favKey) ? 'fav' : '' }, [
    el('td', { class: 'c-rank' }, [r.rank]),
    teamCell(r),
    ...r.cells.map((v) => el('td', { class: 'c-num' }, [v])),
  ]));
  return el('div', { class: 'table-wrap' }, [
    el('table', { class: 'std-table' }, [el('thead', {}, [head]), el('tbody', {}, rows)]),
  ]);
}

export function buildStandingsView({ leagues, selectedId, result, loading, error, onSelectLeague, onRetry }) {
  const wrap = el('div', { class: 'standings-view' });

  // league picker
  const select = el('select', { class: 'region-select league-select', aria: { label: 'League' } },
    leagues.map((l) => el('option', { value: l.id }, [l.name])));
  select.value = selectedId || '';
  select.addEventListener('change', () => onSelectLeague(select.value));
  wrap.appendChild(el('div', { class: 'standings-bar' }, [
    el('span', { class: 'small muted' }, ['League']),
    select,
  ]));

  if (loading) { wrap.appendChild(skeletonView(1)); return wrap; }
  if (error && !result) { wrap.appendChild(errorState('Couldn’t load standings', error.message, { onRetry })); return wrap; }

  if (!result || !result.groups.length) {
    wrap.appendChild(emptyState('No standings', 'Standings aren’t available for this league right now (it may be between seasons).'));
    return wrap;
  }

  for (const group of result.groups) {
    if (group.name) wrap.appendChild(el('h2', { class: 'std-group' }, [group.name]));
    wrap.appendChild(groupTable(group, result.columns));
  }
  return wrap;
}
