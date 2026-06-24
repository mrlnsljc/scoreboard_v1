// =============================================================================
// ui/racing.js — F1 / motorsport view (under Standings, like Golf): next + last
// race cards, last race result, and the Drivers + Constructors championships.
// =============================================================================

import { el } from '../util/dom.js';
import { skeletonView } from './skeleton.js';
import { errorState, emptyState } from './render.js';
import { formatLocalDay, formatLocalTime } from '../util/dates.js';

function flagImg(href) {
  if (!href) return null;
  const i = el('img', { class: 'rc-flag', src: href, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' });
  i.addEventListener('error', () => i.remove());
  return i;
}

function raceCard(label, race) {
  if (!race) return null;
  const when = Number.isFinite(race.startMs) ? `${formatLocalDay(new Date(race.startMs))} · ${formatLocalTime(new Date(race.startMs))}` : '';
  return el('div', { class: 'card rc-race' + (race.state === 'in' ? ' is-live' : '') }, [
    el('div', { class: 'rc-race-label' }, [label, race.state === 'in' ? el('span', { class: 'rc-live' }, [' ● LIVE']) : null]),
    el('div', { class: 'rc-race-name' }, [race.name]),
    el('div', { class: 'rc-race-sub muted small' }, [[race.circuit, race.location, when].filter(Boolean).join(' · ')]),
  ]);
}

function resultsTable(race) {
  if (!race || !race.results.length) return null;
  return el('div', { class: 'rc-block' }, [
    el('h3', { class: 'detail-section' }, [`Result · ${race.short || race.name}`]),
    el('div', { class: 'table-wrap' }, [el('table', { class: 'std-table' }, [
      el('thead', {}, [el('tr', {}, [el('th', { class: 'c-rank' }, ['Pos']), el('th', { class: 'c-team' }, ['Driver'])])]),
      el('tbody', {}, race.results.map((r) => el('tr', { class: r.winner ? 'fav' : '' }, [
        el('td', { class: 'c-rank' }, [String(r.order || '')]),
        el('td', { class: 'c-team' }, [flagImg(r.flag), el('span', {}, [r.driver])]),
      ]))),
    ])]),
  ]);
}

function championship(table) {
  return el('div', { class: 'rc-block' }, [
    el('h3', { class: 'detail-section' }, [table.name]),
    el('div', { class: 'table-wrap' }, [el('table', { class: 'std-table' }, [
      el('thead', {}, [el('tr', {}, [
        el('th', { class: 'c-rank' }, ['#']),
        el('th', { class: 'c-team' }, [table.drivers ? 'Driver' : 'Constructor']),
        el('th', { class: 'c-num' }, ['PTS']),
      ])]),
      el('tbody', {}, table.rows.map((r) => el('tr', {}, [
        el('td', { class: 'c-rank' }, [String(r.rank || '')]),
        el('td', { class: 'c-team' }, [table.drivers ? flagImg(r.flag) : null, el('span', {}, [r.name])]),
        el('td', { class: 'c-num' }, [r.points || '—']),
      ]))),
    ])]),
  ]);
}

export function buildRacingView({ leagueSelect, result, loading, error, onRetry }) {
  const wrap = el('div', { class: 'standings-view racing-view' });
  if (leagueSelect) wrap.appendChild(leagueSelect);

  if (loading) { wrap.appendChild(skeletonView(1)); return wrap; }
  if (error || !result) { wrap.appendChild(errorState('Couldn’t load F1', error?.message || 'Racing data was unavailable.', { onRetry })); return wrap; }
  if (!result.tables.length && !result.races.length) { wrap.appendChild(emptyState('No F1 data', 'Racing standings & results aren’t available right now.')); return wrap; }

  const cards = [raceCard('Next race', result.nextRace), raceCard('Last race', result.lastRace)].filter(Boolean);
  if (cards.length) wrap.appendChild(el('div', { class: 'rc-races' }, cards));

  const res = resultsTable(result.lastRace);
  if (res) wrap.appendChild(res);

  for (const t of result.tables) wrap.appendChild(championship(t));
  return wrap;
}
