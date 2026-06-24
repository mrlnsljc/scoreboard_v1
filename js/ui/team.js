// =============================================================================
// ui/team.js — team detail page: header (record/standing), schedule, roster.
// Clicking a roster player calls onSelectPlayer(athleteId).
// =============================================================================

import { el } from '../util/dom.js';
import { formatLocalDay, formatLocalTime } from '../util/dates.js';
import { skeletonView } from './skeleton.js';
import { emptyState, errorState, formPills } from './render.js';
import { downloadTeamICS } from '../util/ics.js';
import { buildCalendarView } from './calendar.js';
import { startOfMonth, endOfMonth } from '../util/dates.js';

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

// Advanced/season stats panel (lazy-filled by app.js). `adv` is undefined until
// it loads, an empty-stats object if ESPN had nothing, else { stats, note }.
function advancedPanel(adv) {
  if (!adv) return null;
  if (!adv.stats.length) {
    return adv.note
      ? el('div', { class: 'adv-wrap' }, [el('h3', { class: 'detail-section' }, ['Advanced stats']), el('p', { class: 'muted small' }, [adv.note])])
      : null;
  }
  return el('div', { class: 'adv-wrap' }, [
    el('h3', { class: 'detail-section' }, ['Advanced stats']),
    el('div', { class: 'adv-grid' }, adv.stats.map((s) => el('div', { class: 'adv-cell', title: s.desc || s.label }, [
      el('span', { class: 'adv-label' }, [s.label]),
      el('span', { class: 'adv-val' }, [s.value]),
      s.desc ? el('span', { class: 'adv-desc' }, [s.desc]) : null,
    ]))),
    adv.note ? el('p', { class: 'muted small adv-note' }, [adv.note]) : null,
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

export function buildTeamView({ result, loading, error, schedView = 'table', calMonth, onSetSchedView, onTeamCalPrev, onTeamCalNext, onSelectGame, onBack, onSelectPlayer, onToggleFav, isFav, onRetry }) {
  const wrap = el('div', { class: 'detail-view' });
  wrap.appendChild(backBar('Standings', onBack));

  if (loading) { wrap.appendChild(skeletonView(1)); return wrap; }
  if (error || !result) { wrap.appendChild(errorState('Couldn’t load team', error?.message || 'Team data was unavailable.', { onRetry })); return wrap; }

  const t = result.team;
  wrap.appendChild(el('div', { class: 'detail-head' + (t.color ? ' accented' : ''), style: t.color ? { '--team-accent': t.color } : null }, [
    teamLogo(t),
    el('div', { class: 'detail-head-meta' }, [
      el('h2', {}, [t.name]),
      el('div', { class: 'detail-sub' }, [
        t.record ? el('span', { class: 'rec' }, [t.record]) : null,
        t.standingSummary ? el('span', { class: 'muted' }, [t.standingSummary]) : null,
      ]),
      (t.recordHome || t.recordRoad) ? el('div', { class: 'muted small' }, [`Home ${t.recordHome || '—'} · Away ${t.recordRoad || '—'}`]) : null,
      formPills(result.schedule, t.id),
    ]),
    el('button', { class: 'star big' + (isFav ? ' on' : ''), title: isFav ? 'Unfavorite' : 'Favorite', onclick: onToggleFav }, [isFav ? '★' : '☆']),
  ]));

  // advanced / season stats (lazy-loaded; appears once it resolves)
  const adv = advancedPanel(result.advanced);
  if (adv) wrap.appendChild(adv);

  // schedule: list or month-calendar, + one-tap .ics export
  const seg = (id, label) => el('button', { class: 'seg' + (schedView === id ? ' active' : ''), onclick: () => onSetSchedView && onSetSchedView(id) }, [label]);
  wrap.appendChild(el('div', { class: 'detail-section-row' }, [
    el('h3', { class: 'detail-section' }, ['Schedule']),
    el('div', { class: 'sched-actions' }, [
      result.schedule.length ? el('div', { class: 'seg-toggle' }, [seg('table', 'List'), seg('calendar', 'Calendar')]) : null,
      result.schedule.length ? el('button', { class: 'btn ghost small ics-btn', title: 'Download an .ics for Google / Apple Calendar', onclick: () => downloadTeamICS(t, result.schedule) }, ['⤓ Add to calendar']) : null,
    ]),
  ]));
  if (!result.schedule.length) {
    wrap.appendChild(el('p', { class: 'muted small' }, ['No schedule available.']));
  } else if (schedView === 'calendar') {
    const month = calMonth || startOfMonth(new Date());
    const lo = startOfMonth(month).getTime();
    const hi = endOfMonth(month).getTime() + 86400000;
    const monthGames = result.schedule.filter((g) => Number.isFinite(g.startMs) && g.startMs >= lo && g.startMs < hi);
    wrap.appendChild(buildCalendarView({
      monthDate: month, games: monthGames, teamId: t.id,
      onPrev: onTeamCalPrev, onNext: onTeamCalNext, onSelectGame,
    }));
  } else {
    wrap.appendChild(el('div', { class: 'table-wrap' }, [
      el('table', { class: 'sched-table' }, [
        el('thead', {}, [el('tr', {}, [el('th', {}, ['Date']), el('th', {}, ['Matchup']), el('th', { class: 'c-result' }, ['Result'])])]),
        el('tbody', {}, result.schedule.map((g) => scheduleRow(g, t.id))),
      ]),
    ]));
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
