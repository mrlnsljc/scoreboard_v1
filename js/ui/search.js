// =============================================================================
// ui/search.js — command-palette style search to find & favorite any team or
// league directly, without waiting for it to appear on the schedule.
//
// Leagues come from the registry; teams come from data/teams.js (one cached
// roster fetch per league). Results have inline follow/favorite toggles.
// =============================================================================

import { el } from '../util/dom.js';
import { LEAGUES, getLeague, leaguesByGroup } from '../config.js';
import { buildTeamIndex } from '../data/teams.js';
import { searchPlayers } from '../data/playersearch.js';
import {
  isLeagueFollowed, toggleLeague,
  isTeamFavorite, toggleTeam,
} from '../store/favorites.js';

// strip combining diacritics so "türkiye" matches "turkiye", "córdoba" etc.
function norm(s) { return (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''); }

export function openSearch(onChange = () => {}, onOpenPlayer = () => {}) {
  let teams = null;          // loaded team index (null = still loading)
  let query = '';
  let players = [];          // async player-search results
  let playersLoading = false;
  let pSeq = 0; let pTimer = null;

  const input = el('input', {
    type: 'search', class: 'search-input', placeholder: 'Search teams, players or leagues…',
    autocomplete: 'off', spellcheck: 'false', aria: { label: 'Search teams, players or leagues' },
  });
  const results = el('div', { class: 'search-results' });

  const overlay = el('div', {
    class: 'overlay search-overlay',
    onclick: (e) => { if (e.target === overlay) close(); },
  }, [
    el('div', { class: 'search-modal', role: 'dialog', aria: { label: 'Search' } }, [
      el('div', { class: 'search-head' }, [
        el('span', { class: 'search-icon', aria: { hidden: 'true' } }, ['🔍']),
        input,
        el('button', { class: 'btn ghost icon-btn', onclick: close, aria: { label: 'Close' } }, ['✕']),
      ]),
      results,
    ]),
  ]);

  function close() {
    document.removeEventListener('keydown', onKey);
    overlay.remove();
  }
  function onKey(e) { if (e.key === 'Escape') close(); }

  // ---- result rows ----
  function leagueRow(lg) {
    const following = isLeagueFollowed(lg.id);
    const btn = el('button', {
      class: 'chip' + (following ? ' on' : ''),
      onclick: async () => {
        await toggleLeague(lg.id);
        const on = isLeagueFollowed(lg.id);
        btn.classList.toggle('on', on);
        btn.textContent = on ? 'Following' : 'Follow';
        onChange();
      },
    }, [following ? 'Following' : 'Follow']);
    return el('div', { class: 'search-row' }, [
      el('span', { class: 'logo sm mono', style: { background: '#2f3947' } }, [lg.short.slice(0, 2)]),
      el('div', { class: 'search-row-meta' }, [
        el('span', { class: 'search-row-name' }, [lg.name]),
        el('span', { class: 'muted small' }, [`League · ${lg.group}`]),
      ]),
      btn,
    ]);
  }

  function teamRow(t) {
    const fav = isTeamFavorite(t.favKey);
    const star = el('button', {
      class: 'star' + (fav ? ' on' : ''),
      title: fav ? 'Unfavorite' : 'Favorite',
      onclick: async () => {
        await toggleTeam(t);
        const on = isTeamFavorite(t.favKey);
        star.classList.toggle('on', on);
        star.textContent = on ? '★' : '☆';
        onChange();
      },
    }, [fav ? '★' : '☆']);
    return el('div', { class: 'search-row' }, [
      t.logo
        ? el('img', { class: 'logo sm', src: t.logo, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' })
        : el('span', { class: 'logo sm mono' }, [(t.abbr || t.displayName).slice(0, 2)]),
      el('div', { class: 'search-row-meta' }, [
        el('span', { class: 'search-row-name' }, [t.displayName]),
        el('span', { class: 'muted small' }, [getLeague(t.leagueId)?.name || '']),
      ]),
      star,
    ]);
  }

  function playerRow(p) {
    return el('div', { class: 'search-row' }, [
      el('span', { class: 'logo sm mono' }, [p.name.slice(0, 1)]),
      el('div', { class: 'search-row-meta' }, [
        el('span', { class: 'search-row-name' }, [p.name]),
        el('span', { class: 'muted small' }, [[p.team, (p.leagueSlug || p.sport || '').toUpperCase()].filter(Boolean).join(' · ')]),
      ]),
      el('button', { class: 'btn ghost small', onclick: () => { close(); onOpenPlayer(p); } }, ['View']),
    ]);
  }

  // debounced player search (ESPN site search)
  function schedulePlayers() {
    clearTimeout(pTimer);
    const q = query.trim();
    if (q.length < 2) { players = []; playersLoading = false; return; }
    playersLoading = true;
    pTimer = setTimeout(async () => {
      const seq = ++pSeq;
      const res = await searchPlayers(q);
      if (seq === pSeq) { players = res; playersLoading = false; render(); }
    }, 250);
  }

  function sectionLabel(text) { return el('div', { class: 'search-section' }, [text]); }

  function render() {
    results.replaceChildren();
    const q = norm(query.trim());

    // --- empty query: browse all leagues to follow, plus a hint ---
    if (!q) {
      results.appendChild(sectionLabel('Leagues'));
      for (const [group, leagues] of leaguesByGroup()) {
        results.appendChild(el('div', { class: 'muted small group-label' }, [group]));
        leagues.forEach((lg) => results.appendChild(leagueRow(lg)));
      }
      results.appendChild(el('div', { class: 'muted small search-hint' }, [
        teams ? 'Type a team name to favorite it (e.g. “Croatia”, “Celtics”).' : 'Loading team list…',
      ]));
      return;
    }

    // --- matching leagues ---
    const lgMatches = LEAGUES.filter((lg) => norm(lg.name).includes(q) || norm(lg.short).includes(q));
    if (lgMatches.length) {
      results.appendChild(sectionLabel('Leagues'));
      lgMatches.forEach((lg) => results.appendChild(leagueRow(lg)));
    }

    // --- matching teams ---
    const scored = [];
    if (teams === null) {
      results.appendChild(el('div', { class: 'muted small search-hint' }, ['Loading teams…']));
    } else {
      for (const t of teams) {
        const hay = norm(`${t.displayName} ${t.name} ${t.abbr}`);
        const idx = hay.indexOf(q);
        if (idx === -1) continue;
        const rank = norm(t.displayName).startsWith(q) ? 0 : (norm(t.displayName).includes(q) ? 1 : 2);
        scored.push({ t, key: rank * 1000 + idx });
      }
      scored.sort((a, b) => a.key - b.key || a.t.displayName.localeCompare(b.t.displayName));
      if (scored.length) {
        results.appendChild(sectionLabel(`Teams (${scored.length})`));
        scored.slice(0, 40).forEach(({ t }) => results.appendChild(teamRow(t)));
      }
    }

    // --- players (async via ESPN site search) ---
    if (playersLoading) {
      results.appendChild(el('div', { class: 'muted small search-hint' }, ['Searching players…']));
    } else if (players.length) {
      results.appendChild(sectionLabel(`Players (${players.length})`));
      players.forEach((p) => results.appendChild(playerRow(p)));
    }

    if (teams !== null && !lgMatches.length && !scored.length && !players.length && !playersLoading) {
      results.appendChild(el('div', { class: 'empty-msg muted' }, [`Nothing matches “${query.trim()}”.`]));
    }
  }

  input.addEventListener('input', () => { query = input.value; render(); schedulePlayers(); });
  document.addEventListener('keydown', onKey);

  document.body.appendChild(overlay);
  input.focus();
  render();

  // load the team index (cached after first time), then re-render
  buildTeamIndex().then((list) => { teams = list; render(); }).catch(() => { teams = []; render(); });
}
