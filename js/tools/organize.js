// Organize & merge: every page of every file in one grid. Drag to reorder,
// rotate or delete pages, then save them as a single PDF.
import { assemblePages } from '../ops.js';
import { renderPage } from '../render.js';
import { h, fill, icons, baseName } from '../ui.js';
import { panelHead, saveButton } from './common.js';

const thumbs = new Map(); // "fileId:index" -> Promise<canvas>

function thumbFor(file, index) {
  const key = `${file.id}:${index}`;
  if (!thumbs.has(key)) thumbs.set(key, renderPage(file, index, { width: 120 }).then((r) => r.canvas));
  return thumbs.get(key);
}

function cloneCanvas(src) {
  const c = document.createElement('canvas');
  c.width = src.width; c.height = src.height; c.style.width = src.style.width;
  c.getContext('2d').drawImage(src, 0, 0);
  return c;
}

export const organize = {
  id: 'organize',
  label: 'Organize & merge',
  icon: 'organize',
  mode: 'all',
  description: 'Every page from every file, in one place. Drag pages to reorder them, rotate or remove pages, then save everything as one PDF.',

  render(panel, ctx) {
    const { state } = ctx;
    let dragKey = null;

    const move = (from, to) => {
      if (from === to || from < 0 || to < 0 || to > state.pages.length) return;
      const [item] = state.pages.splice(from, 1);
      state.pages.splice(to > from ? to - 1 : to, 0, item);
      draw();
    };

    const grid = h('div', { class: 'page-grid' });
    const count = h('span');

    function card(p, i) {
      const file = ctx.fileById(p.fileId);
      const thumb = h('div', { class: 'page-thumb' });
      thumbFor(file, p.index).then((c) => {
        const canvas = cloneCanvas(c);
        const sideways = p.rotate % 180 !== 0;
        canvas.style.transform = `rotate(${p.rotate}deg)${sideways ? ' scale(0.74)' : ''}`;
        thumb.append(canvas);
      }).catch(() => thumb.append(h('span', { class: 'error' }, '!')));

      const btn = (icon, label, fn, disabled) => h('button', {
        class: 'icon-btn', title: label, 'aria-label': `${label}, page ${i + 1}`, html: icons[icon], disabled,
        onclick: (e) => { e.stopPropagation(); fn(); },
      });

      const el = h('div', {
        class: 'page-card', draggable: 'true', 'data-key': p.key,
        ondragstart: (e) => { dragKey = p.key; el.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', p.key); },
        ondragend: () => { dragKey = null; el.classList.remove('dragging'); clearMarks(); },
        ondragover: (e) => {
          if (!dragKey) return;
          e.preventDefault();
          clearMarks();
          const r = el.getBoundingClientRect();
          el.classList.add(e.clientX < r.left + r.width / 2 ? 'drop-before' : 'drop-after');
        },
        ondrop: (e) => {
          if (!dragKey) return;
          e.preventDefault();
          e.stopPropagation(); // keep the window-level file drop handler out of this
          const from = state.pages.findIndex((x) => x.key === dragKey);
          const r = el.getBoundingClientRect();
          const to = i + (e.clientX < r.left + r.width / 2 ? 0 : 1);
          move(from, to);
        },
      },
      thumb,
      h('div', { class: 'page-label' },
        h('b', {}, String(i + 1)),
        h('span', { title: file.name }, h('span', { class: 'swatch', style: `background:${file.color}` }), `p.${p.index + 1}`)),
      h('div', { class: 'page-tools' },
        btn('left', 'Move earlier', () => move(i, i - 1), i === 0),
        btn('rotL', 'Rotate left', () => { p.rotate = (p.rotate + 270) % 360; draw(); }),
        btn('rotR', 'Rotate right', () => { p.rotate = (p.rotate + 90) % 360; draw(); }),
        btn('trash', 'Remove page', () => { state.pages.splice(i, 1); draw(); }),
        btn('right', 'Move later', () => move(i, i + 2), i === state.pages.length - 1)));
      return el;
    }

    function clearMarks() {
      grid.querySelectorAll('.drop-before,.drop-after').forEach((n) => n.classList.remove('drop-before', 'drop-after'));
    }

    function draw() {
      count.textContent = `Save PDF (${state.pages.length} page${state.pages.length === 1 ? '' : 's'})`;
      saveBtn.disabled = !state.pages.length;
      grid.replaceChildren(...state.pages.map(card));
      if (!state.pages.length) grid.append(h('div', { class: 'empty', style: 'grid-column:1/-1' }, h('strong', {}, 'No pages left'), 'Use Reset to bring back the pages you removed.'));
    }

    const saveBtn = saveButton('', async () => {
      try {
        const sources = Object.fromEntries(state.files.map((f) => [f.id, f.bytes]));
        const bytes = await ctx.busy('Building your PDF…', () => assemblePages(sources, state.pages.map((p) => ({ source: p.fileId, index: p.index, rotate: p.rotate }))));
        const usedFiles = new Set(state.pages.map((p) => p.fileId));
        const name = usedFiles.size === 1 ? `${baseName(ctx.fileById([...usedFiles][0]).name)}-organized.pdf` : 'merged.pdf';
        await ctx.saveFile(bytes, name);
      } catch (err) { ctx.reportError(err); }
    });
    saveBtn.querySelector('span').replaceWith(count);

    const reset = () => {
      state.pages = state.files.flatMap((f) => Array.from({ length: f.pageCount }, (_, i) => ({ key: `${f.id}:${i}:${Math.random().toString(36).slice(2, 7)}`, fileId: f.id, index: i, rotate: 0 })));
      draw();
    };

    fill(panel,
      panelHead(organize,
        h('button', { class: 'btn btn-small btn-quiet', onclick: () => { state.pages.reverse(); draw(); } }, 'Reverse'),
        h('button', { class: 'btn btn-small btn-quiet', onclick: () => { state.pages.forEach((p) => { p.rotate = (p.rotate + 90) % 360; }); draw(); } }, 'Rotate all'),
        h('button', { class: 'btn btn-small btn-quiet', onclick: reset }, 'Reset'),
        saveBtn),
      state.files.length > 1 ? h('div', { class: 'note' }, `Pages from ${state.files.length} files are shown in the order you added them. The colour dot shows which file a page came from.`) : null,
      grid,
    );
    draw();
  },
};
