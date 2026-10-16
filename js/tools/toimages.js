// PDF to images: export pages as PNG or JPG.
import { parseRanges } from '../ops.js';
import { renderPage, canvasToBytes } from '../render.js';
import { h, fill, baseName, field } from '../ui.js';
import { panelHead, filePicker, saveButton } from './common.js';

export const toImages = {
  id: 'images',
  label: 'PDF to images',
  icon: 'images',
  mode: 'single',
  description: 'Save pages as PNG or JPG pictures, for slides, chats or social posts. Several pages download as a .zip.',

  render(panel, ctx) {
    const file = ctx.activeFile();
    const opts = toImages.opts ||= { format: 'png', dpi: 150, pages: '' };
    const err = h('div', { class: 'error' });

    const formats = h('div', { class: 'chips' }, ...[['png', 'PNG', 'Sharp, larger files'], ['jpg', 'JPG', 'Smaller, for photos']].map(([id, t, s]) => h('button', {
      class: 'chip', 'aria-pressed': String(opts.format === id), onclick: () => { opts.format = id; ctx.refresh(); },
    }, h('b', {}, t), h('small', {}, s))));

    const dpi = h('select', { id: 'img-dpi', onchange: (e) => { opts.dpi = Number(e.target.value); } },
      ...[[72, '72 dpi (screen)'], [150, '150 dpi (standard)'], [300, '300 dpi (print)']].map(([v, l]) => h('option', { value: String(v), selected: opts.dpi === v }, l)));
    const pages = h('input', { type: 'text', id: 'img-pages', placeholder: `All ${file.pageCount} pages`, value: opts.pages, oninput: (e) => { opts.pages = e.target.value; err.textContent = ''; } });

    const run = saveButton('Export images', async () => {
      try {
        const indices = opts.pages.trim() ? parseRanges(opts.pages, file.pageCount).flat() : [...Array(file.pageCount).keys()];
        const mime = opts.format === 'png' ? 'image/png' : 'image/jpeg';
        const out = await ctx.busy('Exporting…', async (progress) => {
          const files = [];
          for (const [n, i] of indices.entries()) {
            progress(`Exporting page ${n + 1} of ${indices.length}…`);
            const { canvas } = await renderPage(file, i, { scale: opts.dpi / 72, dpr: 1 });
            files.push({ name: `${baseName(file.name)}_page${String(i + 1).padStart(String(file.pageCount).length, '0')}.${opts.format}`, bytes: await canvasToBytes(canvas, mime, 0.9), type: mime });
            canvas.width = canvas.height = 0;
          }
          return files;
        });
        await ctx.saveMany(out, `${baseName(file.name)}_images.zip`);
      } catch (e) { err.textContent = e.message; }
    });

    fill(panel, panelHead(toImages), filePicker(ctx), formats,
      h('div', { class: 'row' }, field('Resolution', dpi), field('Pages', pages, 'Leave empty for all, or type ranges like 1-3, 7')),
      err, h('div', { class: 'actions' }, run));
  },
};
