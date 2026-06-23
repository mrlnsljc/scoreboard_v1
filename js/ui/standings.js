// =============================================================================
// ui/standings.js — league standings tables. A league picker + one table per
// group (conference/division/flat table). Favorited teams' rows are highlighted.
// Pure rendering; app.js handles fetching/state.
// =============================================================================

import { el } from '../util/dom.js';
import { skeletonView } from './skeleton.js';
import { emptyState, errorState } from './render.js';
import { isTeamFavorite } from '../store/favorites.js';
import { leaguePicker } from './leaguePicker.js';

const CLINCH = { x: 'Clinched playoff spot', y: 'Clinched division', z: 'Clinched top seed', p: 'Clinched best record', '*': 'Clinched', c: 'Clinched', e: 'Eliminated', o: 'Eliminated' };
function clinchBadge(c) {
  if (!c) return null;
  const elim = /^[eo]$/i.test(c);
  return el('span', { class: 'clinch ' + (elim ? 'elim' : 'in'), title: CLINCH[c.toLowerCase()] || 'Clinched' }, [c]);
}

function teamCell(row, onSelectTeam) {
  const logo = row.logo
    ? (() => { const i = el('img', { class: 'logo sm', src: row.logo, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' }); i.addEventListener('error', () => i.replaceWith(el('span', { class: 'logo sm mono' }, [(row.abbr || row.name).slice(0, 2)]))); return i; })()
    : el('span', { class: 'logo sm mono' }, [(row.abbr || row.name).slice(0, 2)]);
  return el('td', { class: 'c-team' }, [
    logo,
    el('button', { class: 'link-team', onclick: () => onSelectTeam(row.teamId), title: `View ${row.name}` }, [row.name]),
    clinchBadge(row.clinch),
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

function leadersBody(leaders, loading, allTime, onSelectPlayer, onSetAllTime, onExpandCategory, onRetry) {
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
  const hsSlug = leaders.league.sport === 'soccer' ? 'soccer' : leaders.league.league;
  const headshot = (id) => {
    const img = el('img', { class: 'leader-head', src: `https://a.espncdn.com/i/headshots/${hsSlug}/players/full/${id}.png`, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' });
    img.addEventListener('error', () => img.remove());
    return img;
  };
  const grid = el('div', { class: 'leaders-grid' });
  for (const c of leaders.categories) {
    grid.appendChild(el('div', { class: 'leader-card' }, [
      el('button', { class: 'leader-cat-btn', onclick: () => onExpandCategory(c), title: `See the top ${Math.min(c.count || 0, 50)}` }, [
        el('span', { class: 'leader-cat' }, [c.name]),
        c.count > c.rows.length ? el('span', { class: 'leader-more' }, [`Top ${Math.min(c.count, 50)} ›`]) : null,
      ]),
      el('ol', { class: 'leader-list' }, c.rows.map((r) => el('li', {}, [
        r.athleteId ? headshot(r.athleteId) : null,
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

export function buildStandingsView({ leagues, selectedId, mode = 'teams', scope = 'grouped', result, leaders, loading, leadersLoading, error, sortIndex, sortDir = 'desc', seasons, activeSeason, leadersAllTime, onSelectLeague, onSelectSeason, onSelectTeam, onSelectPlayer, onSetMode, onSetAllTime, onSetScope, onExpandCategory, onSort, onRetry }) {
  const wrap = el('div', { class: 'standings-view' });

  // league picker (custom control so each league shows its logo)
  const bar = el('div', { class: 'standings-bar' }, [
    el('span', { class: 'small muted' }, ['League']),
    leaguePicker({ leagues, selectedId, onSelect: onSelectLeague }),
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
    wrap.appendChild(leadersBody(leaders, leadersLoading, leadersAllTime, onSelectPlayer, onSetAllTime, onExpandCategory, onRetry));
    return wrap;
  }

  // ---- teams mode ----
  if (loading) { wrap.appendChild(skeletonView(1)); return wrap; }
  if (error && !result) { wrap.appendChild(errorState('Couldn’t load standings', error.message, { onRetry })); return wrap; }
  if (!result || !result.groups.length) {
    wrap.appendChild(emptyState('No standings', 'Standings aren’t available for this league/season (it may be between seasons).'));
    return wrap;
  }

  // Grouped (by conference) vs Overall (all teams in one table) — only when
  // the league actually has more than one group.
  const multiGroup = result.groups.length > 1;
  const controls = el('div', { class: 'std-controls' }, [
    el('p', { class: 'muted small tap-hint' }, ['Tap a team for its schedule/roster, or a column header to sort.']),
  ]);
  if (multiGroup) {
    const mk = (id, label) => el('button', { class: 'seg' + (scope === id ? ' active' : ''), onclick: () => onSetScope(id) }, [label]);
    controls.appendChild(el('div', { class: 'seg-toggle' }, [mk('grouped', 'By group'), mk('overall', 'Overall')]));
  }
  wrap.appendChild(controls);

  const si = sortIndex != null ? sortIndex : (result.defaultSortIndex ?? 0);
  const groups = (scope === 'overall' && multiGroup)
    ? [{ name: '', rows: result.groups.flatMap((g) => g.rows) }]
    : result.groups;
  for (const group of groups) {
    if (group.name) wrap.appendChild(el('h2', { class: 'std-group' }, [group.name]));
    wrap.appendChild(groupTable(group, result.columns, onSelectTeam, si, sortDir, onSort));
  }

  // clinch legend (only if any team has a marker)
  if (result.groups.some((g) => g.rows.some((r) => r.clinch))) {
    wrap.appendChild(el('p', { class: 'muted small clinch-legend' }, ['x = clinched playoff · y = division · z = top seed · e = eliminated']));
  }
  return wrap;
}

// ---------------------------------------------------------------------------
// Expanded category modal (top 50 of one stat). Starts showing the already-
// resolved top 5 with a "loading more…" note, then `update(fullRows)` swaps in
// the complete list once the extra athlete names resolve.
// ---------------------------------------------------------------------------
export function buildLeadersExpandModal({ title, rows, hsSlug, onSelectPlayer, onClose }) {
  const headshot = (id) => {
    if (!id) return el('span', { class: 'lx-head mono' }, ['']);
    const i = el('img', { class: 'lx-head', src: `https://a.espncdn.com/i/headshots/${hsSlug}/players/full/${id}.png`, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' });
    i.addEventListener('error', () => i.replaceWith(el('span', { class: 'lx-head mono' }, [''])));
    return i;
  };
  let loadingMore = true;
  const list = el('div', { class: 'search-results lx-list' });

  function render() {
    list.replaceChildren(...rows.map((r) => el('div', { class: 'lx-row' }, [
      el('span', { class: 'lx-rank' }, [String(r.rank)]),
      headshot(r.athleteId),
      r.athleteId
        ? el('button', { class: 'link-team lx-name', onclick: () => onSelectPlayer(r.athleteId) }, [r.name])
        : el('span', { class: 'lx-name' }, [r.name]),
      el('span', { class: 'lx-val' }, [r.value]),
    ])));
    if (loadingMore) list.appendChild(el('div', { class: 'muted small lx-loading' }, ['Loading the rest…']));
  }

  function onKey(e) { if (e.key === 'Escape') close(); }
  function close() { document.removeEventListener('keydown', onKey); overlay.remove(); if (onClose) onClose(); }

  const overlay = el('div', { class: 'overlay search-overlay', onclick: (e) => { if (e.target === overlay) close(); } }, [
    el('div', { class: 'search-modal', role: 'dialog', aria: { label: title } }, [
      el('div', { class: 'search-head' }, [
        el('span', { class: 'lx-title' }, [title]),
        el('span', { class: 'spacer' }),
        el('button', { class: 'btn ghost icon-btn', onclick: close, aria: { label: 'Close' } }, ['✕']),
      ]),
      list,
    ]),
  ]);
  document.addEventListener('keydown', onKey);
  render();
  return { overlay, update(newRows) { rows = newRows; loadingMore = false; render(); } };
}
