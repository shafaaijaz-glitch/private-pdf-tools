// Small DOM helpers shared by the tools. No framework needed.

/** Create an element: h('button', { class: 'btn', onclick }, 'Save') */
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (value == null || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key === 'html') el.innerHTML = value; // only ever used with static markup (icons)
    else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2), value);
    else if (key in el && typeof value !== 'string') el[key] = value;
    else el.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat()) {
    if (child == null || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

/** Append children, skipping null/false (Element.append would print them as text). */
export function fill(el, ...children) {
  el.append(...children.flat().filter((c) => c != null && c !== false));
  return el;
}

export const $ = (sel, root = document) => root.querySelector(sel);

export function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`;
  return `${(n / 1024 / 1024).toFixed(n < 10 * 1024 * 1024 ? 2 : 1)} MB`;
}

/** File name without the .pdf extension, safe for building new names. */
export function baseName(name) {
  return String(name || 'document').replace(/\.(pdf|png|jpe?g|webp|gif|bmp)$/i, '').replace(/[\\/:*?"<>|]+/g, '-') || 'document';
}

export function debounce(fn, ms = 250) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

/** A labelled form field. */
export function field(label, control, hint) {
  return h('label', { class: 'field' }, h('span', {}, label), control, hint ? h('small', { class: 'hint' }, hint) : null);
}

// Inline SVG icons (stroke-based, 20x20)
const path = (d) => `<svg viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
export const icons = {
  organize: path('<rect x="3" y="3" width="6" height="6" rx="1"/><rect x="11" y="3" width="6" height="6" rx="1"/><rect x="3" y="11" width="6" height="6" rx="1"/><rect x="11" y="11" width="6" height="6" rx="1"/>'),
  split: path('<path d="M5 3v14M15 3v14"/><path d="M8 10h4M10.5 8l2 2-2 2"/>'),
  compress: path('<path d="M7 3v4H3M13 3v4h4M7 17v-4H3M13 17v-4h4"/>'),
  sign: path('<path d="M3 15c2-3 3-8 5-8s0 7 2 7 2-3 3-3 1 2 3 2"/><path d="M3 18h14"/>'),
  numbers: path('<rect x="4" y="2.5" width="12" height="15" rx="1.5"/><path d="M8.5 13.5h3M10 13.5V9l-1.2.8"/>'),
  watermark: path('<rect x="4" y="2.5" width="12" height="15" rx="1.5"/><path d="M6.5 13l7-6"/>'),
  images: path('<rect x="3" y="4" width="14" height="12" rx="1.5"/><circle cx="7.5" cy="8.5" r="1.3"/><path d="M17 13l-4-4-7 7"/>'),
  metadata: path('<path d="M10 2.5l6 2.5v4.5c0 4-2.7 6.7-6 8-3.3-1.3-6-4-6-8V5z"/><path d="M7.5 10l2 2 3-3.5"/>'),
  rotL: path('<path d="M4 8a6 6 0 1 1 1.5 6"/><path d="M4 3.5V8h4.5"/>'),
  rotR: path('<path d="M16 8a6 6 0 1 0-1.5 6"/><path d="M16 3.5V8h-4.5"/>'),
  trash: path('<path d="M4 6h12M8 6V4h4v2M6 6l1 11h6l1-11"/>'),
  left: path('<path d="M12 4l-6 6 6 6"/>'),
  right: path('<path d="M8 4l6 6-6 6"/>'),
  x: path('<path d="M5 5l10 10M15 5L5 15"/>'),
  download: path('<path d="M10 3v10M6 9l4 4 4-4M4 16h12"/>'),
  shield: path('<path d="M10 2.5l6 2.5v4.5c0 4-2.7 6.7-6 8-3.3-1.3-6-4-6-8V5z"/><path d="M7.5 10l2 2 3-3.5"/>'),
  grip: path('<path d="M8 14l6-6M11 14l3-3"/>'),
};
