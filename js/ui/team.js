// =============================================================================
// ui/team.js — team detail page: header (record/standing), schedule, roster.
// Clicking a roster player calls onSelectPlayer(athleteId).
// =============================================================================

import { el } from '../util/dom.js';
import { formatLocalDay, formatLocalTime } from '../util/dates.js';
import { skeletonView } from './skeleton.js';
import { emptyState, errorState } from './render.js';

function backBar(label, onBack) {
  return el('button', { class: 'back-bar', onclick: onBack }, ['‹ ', label]);
}

function teamLogo(team, cls = 'detail-logo') {
  if (!team.logo) return el('div', { class: `${cls} mono`, style: { background: team.color || '#3a4250' } }, [(team.abbr || team.name).slice(0, 3)]);
  const img = el('img', { class: cls, src: team.logo, alt: '', referrerpolicy: 'no-referrer' });
  img.addEventListener('error', () => img.replaceWith(el('div', { class: `${cls} mono` }, [(team.abbr || team.name).slice(0, 3)])));
  return img;
}

// one schedule row from this team's perspective
function scheduleRow(game, teamId) {
  const me = game.home.teamId === teamId ? game.home : game.away;
  const opp = game.home.teamId === teamId ? game.away : game.home;
  const home = game.home.teamId === teamId;
  let result = '';
  let cls = '';
  if (game.isFinal) {
    const tag = game.isDraw ? 'D' : (me.winner ? 'W' : 'L');
    cls = game.isDraw ? '' : (me.winner ? 'win' : 'loss');
    result = `${tag} ${me.score}-${opp.score}`;
  } else if (game.isLive) {
    cls = 'live'; result = `${me.score}-${opp.score} · LIVE`;
  } else {
    result = Number.isFinite(game.startMs) ? formatLocalTime(new Date(game.startMs)) : '—';
  }
  return el('tr', {}, [
    el('td', { class: 'c-date' }, [Number.isFinite(game.startMs) ? formatLocalDay(new Date(game.startMs)) : '—']),
    el('td', { class: 'c-match' }, [
      el('span', { class: 'muted' }, [home ? 'vs ' : '@ ']),
      opp.logo ? (() => { const i = el('img', { class: 'logo sm', src: opp.logo, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' }); i.addEventListener('error', () => i.remove()); return i; })() : null,
      el('span', { class: 'opp-name' }, [opp.displayName]),
    ]),
    el('td', { class: 'c-result ' + cls }, [result]),
  ]);
}

function rosterCard(p, onSelectPlayer) {
  const head = p.headshot
    ? (() => { const i = el('img', { class: 'rost-head', src: p.headshot, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' }); i.addEventListener('error', () => i.replaceWith(el('div', { class: 'rost-head mono' }, [p.name.slice(0, 1)]))); return i; })()
    : el('div', { class: 'rost-head mono' }, [p.name.slice(0, 1)]);
  return el('button', { class: 'rost-card', onclick: () => onSelectPlayer(p.id) }, [
    head,
    el('div', { class: 'rost-meta' }, [
      el('span', { class: 'rost-name' }, [p.name, p.injured ? el('span', { class: 'inj', title: 'Injured' }, [' ✚']) : null]),
      el('span', { class: 'rost-sub muted small' }, [[p.jersey ? `#${p.jersey}` : '', p.pos].filter(Boolean).join(' · ')]),
    ]),
  ]);
}

export function buildTeamView({ result, loading, error, onBack, onSelectPlayer, onToggleFav, isFav, onRetry }) {
  const wrap = el('div', { class: 'detail-view' });
  wrap.appendChild(backBar('Standings', onBack));

  if (loading) { wrap.appendChild(skeletonView(1)); return wrap; }
  if (error || !result) { wrap.appendChild(errorState('Couldn’t load team', error?.message || 'Team data was unavailable.', { onRetry })); return wrap; }

  const t = result.team;
  wrap.appendChild(el('div', { class: 'detail-head' }, [
    teamLogo(t),
    el('div', { class: 'detail-head-meta' }, [
      el('h2', {}, [t.name]),
      el('div', { class: 'detail-sub' }, [
        t.record ? el('span', { class: 'rec' }, [t.record]) : null,
        t.standingSummary ? el('span', { class: 'muted' }, [t.standingSummary]) : null,
      ]),
      (t.recordHome || t.recordRoad) ? el('div', { class: 'muted small' }, [`Home ${t.recordHome || '—'} · Away ${t.recordRoad || '—'}`]) : null,
    ]),
    el('button', { class: 'star big' + (isFav ? ' on' : ''), title: isFav ? 'Unfavorite' : 'Favorite', onclick: onToggleFav }, [isFav ? '★' : '☆']),
  ]));

  // schedule
  wrap.appendChild(el('h3', { class: 'detail-section' }, ['Schedule']));
  if (result.schedule.length) {
    wrap.appendChild(el('div', { class: 'table-wrap' }, [
      el('table', { class: 'sched-table' }, [
        el('thead', {}, [el('tr', {}, [el('th', {}, ['Date']), el('th', {}, ['Matchup']), el('th', { class: 'c-result' }, ['Result'])])]),
        el('tbody', {}, result.schedule.map((g) => scheduleRow(g, t.id))),
      ]),
    ]));
  } else {
    wrap.appendChild(el('p', { class: 'muted small' }, ['No schedule available.']));
  }

  // roster
  wrap.appendChild(el('h3', { class: 'detail-section' }, [`Roster${result.roster.length ? ` (${result.roster.length})` : ''}`]));
  if (result.roster.length) {
    wrap.appendChild(el('div', { class: 'roster-grid' }, result.roster.map((p) => rosterCard(p, onSelectPlayer))));
  } else {
    wrap.appendChild(el('p', { class: 'muted small' }, ['No roster available for this league.']));
  }

  return wrap;
}
