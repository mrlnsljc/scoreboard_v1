// =============================================================================
// ui/leaguePicker.js — a custom league dropdown that shows each league's LOGO.
// A native <select> can't render per-option images, so this is a button (current
// league's logo + name) that opens a popover list. Used in Standings + Calendar.
//
// Accepts the same shape the old <select> did: a list of {id, name, ...} leagues
// (including the synthetic "golf"/"f1" Standings options) + selectedId + onSelect.
// =============================================================================

import { el } from '../util/dom.js';
import { leagueLogoUrl } from '../config.js';

// Logo (or emoji/monogram fallback) for one league option.
function leagueIcon(league, cls = 'lp-logo') {
  // Golf has no logo — it carries an emoji in its name; show the emoji.
  if (league.id === 'golf') return el('span', { class: `${cls} emoji`, aria: { hidden: 'true' } }, ['⛳']);
  const url = leagueLogoUrl(league);
  if (!url) return el('span', { class: `${cls} mono` }, [(league.short || league.name || '?').slice(0, 3)]);
  const img = el('img', { class: cls, src: url, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' });
  img.addEventListener('error', () => img.replaceWith(el('span', { class: `${cls} mono` }, [(league.short || league.name || '?').slice(0, 3)])));
  return img;
}

// Display name without a leading emoji (the golf option embeds "⛳ " in its name).
function cleanName(league) {
  return (league.name || '').replace(/^[^\w(]+\s*/, '').trim() || league.name || '';
}

// Returns the picker button element. `onSelect(id)` fires on choice.
export function leaguePicker({ leagues, selectedId, onSelect, ariaLabel = 'League' }) {
  const current = leagues.find((l) => l.id === selectedId) || leagues[0];

  const menu = el('div', { class: 'lp-menu', role: 'listbox', aria: { label: ariaLabel } });
  const btn = el('button', {
    class: 'lp-btn', type: 'button', aria: { haspopup: 'listbox', expanded: 'false', label: ariaLabel },
  }, [
    current ? leagueIcon(current) : null,
    el('span', { class: 'lp-current' }, [current ? cleanName(current) : 'Select']),
    el('span', { class: 'lp-caret', aria: { hidden: 'true' } }, ['▾']),
  ]);

  const wrap = el('div', { class: 'league-picker' }, [btn, menu]);
  let open = false;

  function close() {
    if (!open) return;
    open = false;
    wrap.classList.remove('open');
    btn.setAttribute('aria-expanded', 'false');
    document.removeEventListener('keydown', onKey, true);
    document.removeEventListener('click', onOutside, true);
  }
  function onKey(e) { if (e.key === 'Escape') { close(); btn.focus(); } }
  function onOutside(e) { if (!wrap.contains(e.target)) close(); }

  function openMenu() {
    if (open) return;
    open = true;
    wrap.classList.add('open');
    btn.setAttribute('aria-expanded', 'true');
    // build (or rebuild) the option rows each open so the selection mark is fresh
    menu.replaceChildren(...leagues.map((l) => el('button', {
      class: 'lp-opt' + (l.id === selectedId ? ' on' : ''), type: 'button', role: 'option',
      aria: { selected: String(l.id === selectedId) },
      onclick: () => { close(); if (l.id !== selectedId) onSelect(l.id); },
    }, [
      leagueIcon(l, 'lp-logo sm'),
      el('span', { class: 'lp-opt-name' }, [cleanName(l)]),
      l.id === selectedId ? el('span', { class: 'lp-check', aria: { hidden: 'true' } }, ['✓']) : null,
    ])));
    // defer listener attach so the opening click doesn't immediately close it
    setTimeout(() => {
      document.addEventListener('keydown', onKey, true);
      document.addEventListener('click', onOutside, true);
      const sel = menu.querySelector('.lp-opt.on') || menu.querySelector('.lp-opt');
      if (sel) sel.focus();
    }, 0);
  }

  btn.addEventListener('click', () => (open ? close() : openMenu()));
  return wrap;
}
