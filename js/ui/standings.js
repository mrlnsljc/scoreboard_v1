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

function groupTable(group, columns, onSelectTeam) {
  const head = el('tr', {}, [
    el('th', { class: 'c-rank' }, ['#']),
    el('th', { class: 'c-team' }, ['Team']),
    ...columns.map(([, label]) => el('th', { class: 'c-num' }, [label])),
  ]);
  const rows = group.rows.map((r) => el('tr', { class: isTeamFavorite(r.favKey) ? 'fav' : '' }, [
    el('td', { class: 'c-rank' }, [r.rank]),
    teamCell(r, onSelectTeam),
    ...r.cells.map((v) => el('td', { class: 'c-num' }, [v])),
  ]));
  return el('div', { class: 'table-wrap' }, [
    el('table', { class: 'std-table' }, [el('thead', {}, [head]), el('tbody', {}, rows)]),
  ]);
}

function modeToggle(mode, onSetMode) {
  const mk = (id, label) => el('button', { class: 'seg' + (mode === id ? ' active' : ''), onclick: () => onSetMode(id) }, [label]);
  return el('div', { class: 'seg-toggle' }, [mk('teams', 'Teams'), mk('leaders', 'Leaders')]);
}

function leadersBody(leaders, loading, onSelectPlayer, onRetry) {
  if (loading) return skeletonView(1);
  if (leaders?.unsupported) return emptyState('Leaders not available', 'ESPN doesn’t expose stat leaders for this league here. Try NBA, NHL, NFL or MLB.');
  if (!leaders) return errorState('Couldn’t load leaders', 'Stat leaders were unavailable.', { onRetry });
  if (!leaders.categories.length) return emptyState('No leaders yet', 'Stat leaders will appear once the season is underway.');
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
  return grid;
}

export function buildStandingsView({ leagues, selectedId, mode = 'teams', result, leaders, loading, leadersLoading, error, onSelectLeague, onSelectSeason, onSelectTeam, onSelectPlayer, onSetMode, onRetry }) {
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

  // season picker (teams mode only, and only when seasons are known)
  if (mode === 'teams' && result && result.seasons && result.seasons.length) {
    const ssel = el('select', { class: 'region-select season-select', aria: { label: 'Season' } },
      result.seasons.map((s) => el('option', { value: String(s.year) }, [s.label])));
    ssel.value = String(result.season);
    ssel.addEventListener('change', () => onSelectSeason(Number(ssel.value)));
    bar.appendChild(el('span', { class: 'small muted' }, ['Season']));
    bar.appendChild(ssel);
  }
  wrap.appendChild(bar);

  // ---- leaders mode ----
  if (mode === 'leaders') {
    wrap.appendChild(leadersBody(leaders, leadersLoading, onSelectPlayer, onRetry));
    return wrap;
  }

  // ---- teams mode ----
  if (loading) { wrap.appendChild(skeletonView(1)); return wrap; }
  if (error && !result) { wrap.appendChild(errorState('Couldn’t load standings', error.message, { onRetry })); return wrap; }
  if (!result || !result.groups.length) {
    wrap.appendChild(emptyState('No standings', 'Standings aren’t available for this league/season (it may be between seasons).'));
    return wrap;
  }

  wrap.appendChild(el('p', { class: 'muted small tap-hint' }, ['Tip: tap a team to see its schedule, roster & stats.']));
  for (const group of result.groups) {
    if (group.name) wrap.appendChild(el('h2', { class: 'std-group' }, [group.name]));
    wrap.appendChild(groupTable(group, result.columns, onSelectTeam));
  }
  return wrap;
}
