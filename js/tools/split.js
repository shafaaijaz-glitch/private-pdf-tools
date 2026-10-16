// Split: cut one PDF into several, by page ranges or into equal chunks.
import { parseRanges, everyNPages, splitPdf } from '../ops.js';
import { h, fill, baseName, field } from '../ui.js';
import { panelHead, filePicker, saveButton } from './common.js';

const describe = (g) => (g.length === 1 ? `page ${g[0] + 1}` : `pages ${g[0] + 1}–${g[g.length - 1] + 1}`);

export const split = {
  id: 'split',
  label: 'Split',
  icon: 'split',
  mode: 'single',
  description: 'Cut a PDF into separate files. Pick page ranges, one file per page, or equal chunks. Several files download together as a .zip.',

  render(panel, ctx) {
    const file = ctx.activeFile();
    const opts = split.opts ||= { mode: 'ranges', ranges: '', n: 2 };
    const summary = h('div', { class: 'note' });

    const groups = () => {
      if (opts.mode === 'every') return everyNPages(file.pageCount, 1);
      if (opts.mode === 'chunks') return everyNPages(file.pageCount, opts.n);
      return parseRanges(opts.ranges, file.pageCount);
    };

    const button = saveButton('Split and download', async () => {
      try {
        const g = groups();
        const parts = await ctx.busy('Splitting…', () => splitPdf(file.bytes, g));
        const base = baseName(file.name);
        await ctx.saveMany(parts.map((p) => ({
          name: `${base}_${p.pages.length === 1 ? `p${p.pages[0] + 1}` : `p${p.pages[0] + 1}-${p.pages.at(-1) + 1}`}.pdf`,
          bytes: p.bytes,
          type: 'application/pdf',
        })), `${base}_split.zip`);
      } catch (err) { ctx.reportError(Object.assign(err, { userFacing: true })); }
    });

    function update() {
      try {
        const g = groups();
        const shown = g.slice(0, 6).map(describe).join(', ');
        summary.className = 'note';
        summary.textContent = `You'll get ${g.length} file${g.length === 1 ? '' : 's'}: ${shown}${g.length > 6 ? `, and ${g.length - 6} more` : ''}.`;
        button.disabled = false;
      } catch (err) {
        summary.className = 'note error';
        summary.textContent = err.message;
        button.disabled = true;
      }
    }

    const modes = [
      ['ranges', 'Page ranges', 'Each range becomes a file'],
      ['every', 'Every page', `${file.pageCount} single-page files`],
      ['chunks', 'Equal chunks', 'Every N pages'],
    ];
    const chips = h('div', { class: 'chips' }, ...modes.map(([id, title, sub]) => h('button', {
      class: 'chip', 'aria-pressed': String(opts.mode === id),
      onclick: () => { opts.mode = id; ctx.refresh(); },
    }, h('b', {}, title), h('small', {}, sub))));

    if (!opts.ranges) opts.ranges = file.pageCount > 2 ? `1-${Math.ceil(file.pageCount / 2)}, ${Math.ceil(file.pageCount / 2) + 1}-${file.pageCount}` : '1';

    const extra = opts.mode === 'ranges'
      ? field('Ranges', h('input', { type: 'text', id: 'split-ranges', value: opts.ranges, oninput: (e) => { opts.ranges = e.target.value; update(); } }),
        'Separate files with commas. Examples: 1-3, 4-6  ·  1, 3, 5  ·  8- (page 8 to the end)')
      : opts.mode === 'chunks'
        ? field('Pages per file', h('input', { type: 'number', id: 'split-n', min: '1', max: String(file.pageCount), value: String(opts.n), oninput: (e) => { opts.n = Math.max(1, Number(e.target.value) || 1); update(); } }))
        : null;

    fill(panel, panelHead(split), filePicker(ctx), chips, extra, summary, h('div', { class: 'actions' }, button));
    update();
  },
};
