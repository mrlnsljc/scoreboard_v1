// =============================================================================
// ui/standings.js — league standings tables. A league picker + one table per
// group (conference/division/flat table). Favorited teams' rows are highlighted.
// Pure rendering; app.js handles fetching/state.
// =============================================================================

import { el } from '../util/dom.js';
import { skeletonView } from './skeleton.js';
import { emptyState, errorState } from './render.js';
import { isTeamFavorite } from '../store/favorites.js';

function teamCell(row, onSelectTeam) {
  const logo = row.logo
    ? (() => { const i = el('img', { class: 'logo sm', src: row.logo, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' }); i.addEventListener('error', () => i.replaceWith(el('span', { class: 'logo sm mono' }, [(row.abbr || row.name).slice(0, 2)]))); return i; })()
    : el('span', { class: 'logo sm mono' }, [(row.abbr || row.name).slice(0, 2)]);
  return el('td', { class: 'c-team' }, [
    logo,
    el('button', { class: 'link-team', onclick: () => onSelectTeam(row.teamId), title: `View ${row.name}` }, [row.name]),
  ]);
}

function groupTable(group, columns, onSelectTeam, sortIndex, sortDir, onSort) {
  // sort a copy of rows by the active column's numeric value (NaN sinks)
  const sorted = group.rows.slice().sort((a, b) => {
    const av = a.values[sortIndex]; const bv = b.values[sortIndex];
    const an = Number.isFinite(av) ? av : -Infinity; const bn = Number.isFinite(bv) ? bv : -Infinity;
    return sortDir === 'asc' ? an - bn : bn - an;
  });

  const arrow = (i) => (i === sortIndex ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '');
  const head = el('tr', {}, [
    el('th', { class: 'c-rank' }, ['#']),
    el('th', { class: 'c-team' }, ['Team']),
    ...columns.map(([, label], i) => el('th', {
      class: 'c-num sortable' + (i === sortIndex ? ' sorted' : ''),
      title: `Sort by ${label}`,
      onclick: () => onSort(i),
    }, [label + arrow(i)])),
  ]);
  const rows = sorted.map((r, i) => el('tr', { class: isTeamFavorite(r.favKey) ? 'fav' : '' }, [
    el('td', { class: 'c-rank' }, [String(i + 1)]),
    teamCell(r, onSelectTeam),
    ...r.cells.map((v, ci) => el('td', { class: 'c-num' + (ci === sortIndex ? ' sorted' : '') }, [v])),
  ]));
  return el('div', { class: 'table-wrap' }, [
    el('table', { class: 'std-table' }, [el('thead', {}, [head]), el('tbody', {}, rows)]),
  ]);
}

function modeToggle(mode, onSetMode) {
  const mk = (id, label) => el('button', { class: 'seg' + (mode === id ? ' active' : ''), onclick: () => onSetMode(id) }, [label]);
  return el('div', { class: 'seg-toggle' }, [mk('teams', 'Teams'), mk('leaders', 'Leaders')]);
}

function leadersBody(leaders, loading, allTime, onSelectPlayer, onSetAllTime, onRetry) {
  const wrap = el('div', {});
  // Season vs All-time toggle
  const mk = (id, label, on) => el('button', { class: 'seg' + (on ? ' active' : ''), onclick: () => onSetAllTime(id === 'all') }, [label]);
  wrap.appendChild(el('div', { class: 'leaders-scope' }, [
    el('span', { class: 'small muted' }, ['Stats']),
    el('div', { class: 'seg-toggle' }, [mk('season', 'Season', !allTime), mk('all', 'All-time', allTime)]),
  ]));

  if (loading) { wrap.appendChild(skeletonView(1)); return wrap; }
  if (!leaders) { wrap.appendChild(errorState('Couldn’t load leaders', 'Stat leaders were unavailable for this league/season.', { onRetry })); return wrap; }
  if (!leaders.categories.length) { wrap.appendChild(emptyState('No leaders yet', 'Try a different season — stat leaders appear once games have been played.')); return wrap; }
  const grid = el('div', { class: 'leaders-grid' });
  for (const c of leaders.categories) {
    grid.appendChild(el('div', { class: 'leader-card' }, [
      el('div', { class: 'leader-cat' }, [c.name]),
      el('ol', { class: 'leader-list' }, c.rows.map((r) => el('li', {}, [
        r.athleteId
          ? el('button', { class: 'link-team', onclick: () => onSelectPlayer(r.athleteId, leaders.league) }, [r.name])
          : el('span', {}, [r.name]),
        el('span', { class: 'leader-val' }, [r.value]),
      ]))),
    ]));
  }
  wrap.appendChild(grid);
  return wrap;
}

export function buildStandingsView({ leagues, selectedId, mode = 'teams', result, leaders, loading, leadersLoading, error, sortIndex, sortDir = 'desc', seasons, activeSeason, leadersAllTime, onSelectLeague, onSelectSeason, onSelectTeam, onSelectPlayer, onSetMode, onSetAllTime, onSort, onRetry }) {
  const wrap = el('div', { class: 'standings-view' });

  // league picker
  const select = el('select', { class: 'region-select league-select', aria: { label: 'League' } },
    leagues.map((l) => el('option', { value: l.id }, [l.name])));
  select.value = selectedId || '';
  select.addEventListener('change', () => onSelectLeague(select.value));

  const bar = el('div', { class: 'standings-bar' }, [
    el('span', { class: 'small muted' }, ['League']),
    select,
    modeToggle(mode, onSetMode),
  ]);

  // season picker — shown in teams mode, and in leaders mode unless All-time.
  const seasonList = seasons || result?.seasons || [];
  const curSeason = activeSeason ?? result?.season;
  const showSeason = seasonList.length && (mode === 'teams' || (mode === 'leaders' && !leadersAllTime));
  if (showSeason) {
    const ssel = el('select', { class: 'region-select season-select', aria: { label: 'Season' } },
      seasonList.map((s) => el('option', { value: String(s.year) }, [s.label])));
    ssel.value = String(curSeason);
    ssel.addEventListener('change', () => onSelectSeason(Number(ssel.value)));
    bar.appendChild(el('span', { class: 'small muted' }, ['Season']));
    bar.appendChild(ssel);
  }
  wrap.appendChild(bar);

  // ---- leaders mode ----
  if (mode === 'leaders') {
    wrap.appendChild(leadersBody(leaders, leadersLoading, leadersAllTime, onSelectPlayer, onSetAllTime, onRetry));
    return wrap;
  }

  // ---- teams mode ----
  if (loading) { wrap.appendChild(skeletonView(1)); return wrap; }
  if (error && !result) { wrap.appendChild(errorState('Couldn’t load standings', error.message, { onRetry })); return wrap; }
  if (!result || !result.groups.length) {
    wrap.appendChild(emptyState('No standings', 'Standings aren’t available for this league/season (it may be between seasons).'));
    return wrap;
  }

  wrap.appendChild(el('p', { class: 'muted small tap-hint' }, ['Tip: tap a team for its schedule/roster, or tap a column header to sort.']));
  const si = sortIndex != null ? sortIndex : (result.defaultSortIndex ?? 0);
  for (const group of result.groups) {
    if (group.name) wrap.appendChild(el('h2', { class: 'std-group' }, [group.name]));
    wrap.appendChild(groupTable(group, result.columns, onSelectTeam, si, sortDir, onSort));
  }
  return wrap;
}
