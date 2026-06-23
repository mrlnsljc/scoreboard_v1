// =============================================================================
// util/dom.js — tiny DOM helpers so the UI code stays declarative & readable.
// No framework: just a tagged element factory + a couple of helpers.
// =============================================================================

// el('div', {class:'card', onclick}, [child, 'text']) -> HTMLElement
// Props: `class`/`className`, `dataset:{}`, `style:{}`, on*-handlers, attributes,
// and `html` for trusted innerHTML (we avoid html for anything user/API-derived).
export function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'class' || k === 'className') node.className = v;
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k === 'style' && typeof v === 'object') {
      // iterate so CSS custom properties (--foo) go through setProperty, which
      // Object.assign can't do. Normal props still assign as before.
      for (const [sk, sv] of Object.entries(v)) {
        if (sv == null) continue;
        if (sk.startsWith('--')) node.style.setProperty(sk, String(sv));
        else node.style[sk] = sv;
      }
    }
    else if (k === 'html') node.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'aria' && typeof v === 'object') {
      for (const [ak, av] of Object.entries(v)) node.setAttribute(`aria-${ak}`, av);
    } else node.setAttribute(k, v);
  }
  appendChildren(node, children);
  return node;
}

function appendChildren(node, children) {
  const arr = Array.isArray(children) ? children : [children];
  for (const c of arr) {
    if (c == null || c === false) continue;
    node.appendChild(typeof c === 'string' || typeof c === 'number'
      ? document.createTextNode(String(c))
      : c);
  }
}

// Replace all children of `node` with `content` (node | nodes | string).
export function mount(node, content) {
  node.replaceChildren();
  appendChildren(node, content);
  return node;
}

export function clear(node) {
  node.replaceChildren();
  return node;
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
