// =============================================================================
// ui/myteams.js — "My Teams" dashboard: each favorite team's record + standing +
// last result + next game, all at a glance. Tap a team or a game to drill in.
// =============================================================================

import { el } from '../util/dom.js';
import { formatLocalDay, formatLocalTime } from '../util/dates.js';
import { emptyState } from './render.js';

function logoEl(team) {
  if (!team.logo) return el('div', { class: 'mt-logo mono', style: { background: team.color || '#3a4250' } }, [(team.abbr || team.name).slice(0, 3)]);
  const i = el('img', { class: 'mt-logo', src: team.logo, alt: '', referrerpolicy: 'no-referrer' });
  i.addEventListener('error', () => i.replaceWith(el('div', { class: 'mt-logo mono' }, [(team.abbr || team.name).slice(0, 3)])));
  return i;
}

function gameLine(label, game, teamId, onSelectGame) {
  if (!game) return el('div', { class: 'mt-line muted' }, [el('span', { class: 'mt-line-label' }, [label]), el('span', {}, ['—'])]);
  const me = game.home.teamId === teamId ? game.home : game.away;
  const opp = game.home.teamId === teamId ? game.away : game.home;
  const home = game.home.teamId === teamId;
  const oppName = opp.abbr || opp.displayName;
  let txt;
  if (game.isFinal) {
    const tag = game.isDraw ? 'D' : (me.winner ? 'W' : 'L');
    txt = `${tag} ${me.score}-${opp.score} ${home ? 'vs' : '@'} ${oppName}`;
  } else if (game.isLive) {
    txt = `LIVE ${me.score}-${opp.score} ${home ? 'vs' : '@'} ${oppName}`;
  } else {
    const when = Number.isFinite(game.startMs) ? `${formatLocalDay(new Date(game.startMs))} · ${formatLocalTime(new Date(game.startMs))}` : '';
    txt = `${home ? 'vs' : '@'} ${oppName} · ${when}`;
  }
  return el('button', { class: 'mt-line link', onclick: () => onSelectGame(game) }, [
    el('span', { class: 'mt-line-label' }, [label]),
    el('span', { class: game.isLive ? 'mt-live' : '' }, [txt]),
  ]);
}

export function buildMyTeamsView({ cards, hasFavorites, onSelectTeam, onSelectGame, onOpenSearch }) {
  const wrap = el('div', { class: 'sections' });

  if (!hasFavorites) {
    wrap.appendChild(emptyState('No favorite teams yet', 'Tap the ☆ on any team, or use search to add some — they’ll show up here at a glance.'));
    wrap.appendChild(el('div', { style: { textAlign: 'center', marginTop: '-8px' } }, [
      el('button', { class: 'btn', onclick: onOpenSearch }, ['🔍  Search teams']),
    ]));
    return wrap;
  }

  const grid = el('div', { class: 'card-grid' });
  for (const c of cards) {
    if (c.loading || !c.result) {
      grid.appendChild(el('div', { class: 'card mt-card' }, [
        el('div', { class: 'mt-head' }, [
          el('div', { class: 'mt-logo mono' }, [(c.fav.abbr || c.fav.displayName || '?').slice(0, 2)]),
          el('span', { class: 'mt-name' }, [c.fav.displayName]),
        ]),
        el('p', { class: 'muted small' }, [c.error ? 'Couldn’t load.' : 'Loading…']),
      ]));
      continue;
    }
    const t = c.result.team;
    grid.appendChild(el('div', { class: 'card mt-card' }, [
      el('div', { class: 'mt-head' }, [
        logoEl(t),
        el('button', { class: 'mt-name link-team', onclick: () => onSelectTeam(t.leagueId, t.id) }, [t.name]),
      ]),
      el('div', { class: 'mt-sub' }, [
        t.record ? el('span', { class: 'rec' }, [t.record]) : null,
        t.standingSummary ? el('span', { class: 'muted small' }, [t.standingSummary]) : null,
      ]),
      gameLine('Last', c.result.lastGame, t.id, onSelectGame),
      gameLine('Next', c.result.nextGame, t.id, onSelectGame),
    ]));
  }
  wrap.appendChild(grid);
  return wrap;
}
