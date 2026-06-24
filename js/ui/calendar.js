// =============================================================================
// ui/calendar.js — full-month schedule grid (7 cols). Games are pre-fetched and
// passed in; this just lays them onto calendar days. Used for a league's month
// (under Standings) and a single team's month (on the team page).
// =============================================================================

import { el } from '../util/dom.js';
import { skeletonView } from './skeleton.js';
import { localDayKey, formatLocalTime } from '../util/dates.js';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// A compact game chip inside a day cell. `teamId` (optional) renders it from one
// team's perspective (W/L + opponent); otherwise it's "AWY @ HOM".
function dayChip(game, teamId, onSelectGame) {
  let label;
  let right;
  if (teamId && (game.home.teamId === teamId || game.away.teamId === teamId)) {
    const me = game.home.teamId === teamId ? game.home : game.away;
    const opp = game.home.teamId === teamId ? game.away : game.home;
    const home = game.home.teamId === teamId;
    label = `${home ? 'vs' : '@'} ${opp.abbr || (opp.displayName || '').slice(0, 3)}`;
    if (game.isFinal) right = `${game.isDraw ? 'D' : me.winner ? 'W' : 'L'} ${me.score}-${opp.score}`;
    else if (game.isLive) right = 'LIVE';
    else right = Number.isFinite(game.startMs) ? formatLocalTime(new Date(game.startMs)) : '';
  } else {
    label = `${game.away.abbr || (game.away.displayName || '').slice(0, 3)} @ ${game.home.abbr || (game.home.displayName || '').slice(0, 3)}`;
    if (game.isFinal) right = `${game.away.score}-${game.home.score}`;
    else if (game.isLive) right = 'LIVE';
    else right = Number.isFinite(game.startMs) ? formatLocalTime(new Date(game.startMs)) : '';
  }
  return el('button', {
    class: 'cal-chip' + (game.isLive ? ' live' : '') + (game.isFinal ? ' final' : ''),
    title: `${game.away.displayName} @ ${game.home.displayName}`,
    onclick: (e) => { e.stopPropagation(); onSelectGame(game); },
  }, [el('span', { class: 'cal-chip-m' }, [label]), el('span', { class: 'cal-chip-r' }, [right])]);
}

export function buildCalendarView({ monthDate, games, loading, teamId = null, headerExtra, onPrev, onNext, onToday, onSelectGame }) {
  const wrap = el('div', { class: 'calendar-view' });
  const y = monthDate.getFullYear();
  const m = monthDate.getMonth();

  wrap.appendChild(el('div', { class: 'cal-head' }, [
    headerExtra || null,
    el('div', { class: 'cal-nav' }, [
      el('button', { class: 'btn ghost icon-btn', onclick: onPrev, title: 'Previous month', aria: { label: 'Previous month' } }, ['‹']),
      el('div', { class: 'cal-title' }, [`${MONTHS[m]} ${y}`]),
      el('button', { class: 'btn ghost icon-btn', onclick: onNext, title: 'Next month', aria: { label: 'Next month' } }, ['›']),
      onToday ? el('button', { class: 'btn ghost small', onclick: onToday }, ['This month']) : null,
    ]),
  ]));

  if (loading) { wrap.appendChild(skeletonView(1)); return wrap; }

  // group games by local calendar day
  const byDay = new Map();
  for (const g of (games || [])) {
    if (!Number.isFinite(g.startMs)) continue;
    const k = localDayKey(new Date(g.startMs));
    if (!byDay.has(k)) byDay.set(k, []);
    byDay.get(k).push(g);
  }

  const grid = el('div', { class: 'cal-grid' });
  WEEKDAYS.forEach((d) => grid.appendChild(el('div', { class: 'cal-wd' }, [d])));

  const startOffset = new Date(y, m, 1).getDay();
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const todayKey = localDayKey(new Date());
  for (let i = 0; i < startOffset; i++) grid.appendChild(el('div', { class: 'cal-cell empty' }));
  for (let d = 1; d <= daysInMonth; d++) {
    const key = localDayKey(new Date(y, m, d));
    const dayGames = (byDay.get(key) || []).sort((a, b) => (a.startMs || 0) - (b.startMs || 0));
    const cell = el('div', { class: 'cal-cell' + (key === todayKey ? ' today' : '') + (dayGames.length ? ' has-games' : '') }, [
      el('div', { class: 'cal-day' }, [String(d)]),
    ]);
    dayGames.slice(0, 4).forEach((g) => cell.appendChild(dayChip(g, teamId, onSelectGame)));
    if (dayGames.length > 4) cell.appendChild(el('div', { class: 'cal-more muted' }, [`+${dayGames.length - 4} more`]));
    grid.appendChild(cell);
  }
  wrap.appendChild(grid);

  if (!games || !games.length) {
    wrap.appendChild(el('p', { class: 'muted small cal-empty' }, ['No games scheduled this month.']));
  }
  return wrap;
}
