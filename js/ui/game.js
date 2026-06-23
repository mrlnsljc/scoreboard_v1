// =============================================================================
// ui/game.js — game detail / box score: header + linescores + top performers +
// team-stat comparison. Top performers link to player pages.
// =============================================================================

import { el } from '../util/dom.js';
import { skeletonView } from './skeleton.js';
import { errorState } from './render.js';

function backBar(label, onBack) { return el('button', { class: 'back-bar', onclick: onBack }, ['‹ ', label]); }

function teamLogo(side) {
  if (!side.logo) return el('div', { class: 'gh-logo mono' }, [(side.abbr || '?').slice(0, 3)]);
  const i = el('img', { class: 'gh-logo', src: side.logo, alt: '', referrerpolicy: 'no-referrer' });
  i.addEventListener('error', () => i.replaceWith(el('div', { class: 'gh-logo mono' }, [(side.abbr || '?').slice(0, 3)])));
  return i;
}

function teamScoreRow(side, isFinal) {
  const cls = 'gh-team' + (isFinal && side.winner ? ' winner' : '') + (isFinal && !side.winner ? ' loser' : '');
  return el('div', { class: cls }, [
    teamLogo(side),
    el('span', { class: 'gh-name' }, [side.name || side.abbr]),
    el('span', { class: 'gh-score' }, [side.score || '—']),
  ]);
}

// Win-probability bar (only when ESPN provides it and the game isn't pre-game).
function winProbBar(g) {
  if (!g.winProb || g.state === 'pre') return null;
  const homePct = g.winProb.homePct;
  const tiePct = g.winProb.tiePct > 1 ? g.winProb.tiePct : 0;
  const awayPct = Math.max(0, 100 - homePct - tiePct);
  const pct = (n) => `${Math.round(n)}%`;
  const seg = (cls, w, label) => (w > 0 ? el('div', { class: `wp-seg ${cls}`, style: { width: `${w}%` }, title: `${label} ${pct(w)}` }) : null);
  return el('div', { class: 'wp-wrap' }, [
    el('div', { class: 'wp-labels' }, [
      el('span', { class: 'wp-side' }, [(g.away.abbr || 'Away') + ' ', el('strong', {}, [pct(awayPct)])]),
      el('span', { class: 'wp-mid muted' }, ['Win probability']),
      el('span', { class: 'wp-side home' }, [el('strong', {}, [pct(homePct)]), ' ' + (g.home.abbr || 'Home')]),
    ]),
    el('div', { class: 'wp-bar' }, [
      seg('away', awayPct, g.away.abbr || 'Away'),
      seg('tie', tiePct, 'Tie'),
      seg('home', homePct, g.home.abbr || 'Home'),
    ]),
  ]);
}

function linescoreTable(g) {
  const n = Math.max(g.away.linescores.length, g.home.linescores.length);
  if (!n) return null;
  const cols = Array.from({ length: n }, (_, i) => i + 1);
  const row = (side) => el('tr', {}, [
    el('td', { class: 'c-team' }, [side.abbr]),
    ...cols.map((_, i) => el('td', { class: 'c-num' }, [side.linescores[i] || '—'])),
    el('td', { class: 'c-num c-total' }, [side.score || '—']),
  ]);
  return el('div', { class: 'table-wrap' }, [el('table', { class: 'line-table' }, [
    el('thead', {}, [el('tr', {}, [el('th', {}, ['']), ...cols.map((c) => el('th', { class: 'c-num' }, [String(c)])), el('th', { class: 'c-num' }, ['T'])])]),
    el('tbody', {}, [row(g.away), row(g.home)]),
  ])]);
}

function performers(g, onSelectPlayer) {
  if (!g.leaders.length) return null;
  const block = el('div', { class: 'perf-wrap' });
  g.leaders.forEach((tl) => {
    block.appendChild(el('div', { class: 'perf-team' }, [tl.team]));
    tl.cats.forEach((c) => {
      block.appendChild(el('div', { class: 'perf-row' }, [
        el('span', { class: 'perf-cat muted' }, [c.cat]),
        c.athleteId
          ? el('button', { class: 'link-team', onclick: () => onSelectPlayer(c.athleteId) }, [c.name])
          : el('span', {}, [c.name]),
        el('span', { class: 'perf-val' }, [c.value]),
      ]));
    });
  });
  return block;
}

function statComparison(g) {
  if (!g.teamStats.length) return null;
  return el('div', { class: 'table-wrap' }, [el('table', { class: 'cmp-table' }, [
    el('thead', {}, [el('tr', {}, [el('th', { class: 'c-num' }, [g.away.abbr]), el('th', { class: 'c-stat' }, ['']), el('th', { class: 'c-num' }, [g.home.abbr])])]),
    el('tbody', {}, g.teamStats.map((s) => el('tr', {}, [
      el('td', { class: 'c-num' }, [s.away]),
      el('td', { class: 'c-stat muted' }, [s.label]),
      el('td', { class: 'c-num' }, [s.home]),
    ]))),
  ])]);
}

function boxScore(result, onSelectPlayer) {
  if (!result.playerBox || !result.playerBox.length) return null;
  const wrap = el('div', { class: 'box-wrap' });
  for (const grp of result.playerBox) {
    if (!grp.blocks.length) continue;
    wrap.appendChild(el('div', { class: 'box-team' }, [grp.team]));
    for (const blk of grp.blocks) {
      const head = el('tr', {}, [
        el('th', { class: 'c-player' }, [blk.title || 'Player']),
        ...blk.labels.map((l) => el('th', { class: 'c-num' }, [l])),
      ]);
      const rows = blk.players.map((p) => {
        const nameCell = el('td', { class: 'c-player' + (p.starter ? ' starter' : '') }, [
          p.id ? el('button', { class: 'link-team', onclick: () => onSelectPlayer(p.id) }, [p.name]) : el('span', {}, [p.name]),
        ]);
        if (p.dnp || !p.stats.length) {
          return el('tr', { class: 'dnp' }, [nameCell, el('td', { class: 'c-num dnp-note', colspan: String(blk.labels.length) }, ['DNP' + (p.reason ? ` — ${p.reason}` : '')])]);
        }
        return el('tr', {}, [nameCell, ...p.stats.map((s) => el('td', { class: 'c-num' }, [s || '—']))]);
      });
      wrap.appendChild(el('div', { class: 'table-wrap' }, [el('table', { class: 'box-table' }, [el('thead', {}, [head]), el('tbody', {}, rows)])]));
    }
  }
  return wrap;
}

export function buildGameView({ result, loading, error, onBack, onSelectPlayer, onRetry }) {
  const wrap = el('div', { class: 'detail-view' });
  wrap.appendChild(backBar('Back', onBack));
  if (loading) { wrap.appendChild(skeletonView(1)); return wrap; }
  if (error || !result) { wrap.appendChild(errorState('Couldn’t load game', error?.message || 'Game data was unavailable.', { onRetry })); return wrap; }

  wrap.appendChild(el('div', { class: 'game-head' }, [
    teamScoreRow(result.away, result.isFinal),
    el('div', { class: 'gh-status' + (result.isLive ? ' live' : '') }, [result.isLive ? el('span', { class: 'live-dot' }) : null, result.status || '']),
    teamScoreRow(result.home, result.isFinal),
  ]));

  const wp = winProbBar(result);
  if (wp) wrap.appendChild(wp);

  const ls = linescoreTable(result);
  if (ls) { wrap.appendChild(el('h3', { class: 'detail-section' }, ['By period'])); wrap.appendChild(ls); }

  const perf = performers(result, onSelectPlayer);
  if (perf) { wrap.appendChild(el('h3', { class: 'detail-section' }, ['Top performers'])); wrap.appendChild(perf); }

  const cmp = statComparison(result);
  if (cmp) { wrap.appendChild(el('h3', { class: 'detail-section' }, ['Team stats'])); wrap.appendChild(cmp); }

  const box = boxScore(result, onSelectPlayer);
  if (box) { wrap.appendChild(el('h3', { class: 'detail-section' }, ['Box score'])); wrap.appendChild(box); }

  if (!ls && !perf && !cmp && !box) wrap.appendChild(el('p', { class: 'muted small' }, ['Detailed stats aren’t available for this game yet.']));
  return wrap;
}
