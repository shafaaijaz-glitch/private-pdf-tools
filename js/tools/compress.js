// Compress: either a lossless re-save, or redraw each page as a JPEG at a lower resolution.
import { resaveCompact, imagesToPdf } from '../ops.js';
import { renderPage, pageSize, canvasToBytes } from '../render.js';
import { h, fill, formatBytes, baseName } from '../ui.js';
import { panelHead, filePicker, saveButton } from './common.js';

const PRESETS = [
  { id: 'lossless', title: 'Lossless', sub: 'Keeps text and quality. Small savings.', dpi: 0 },
  { id: 'light', title: 'Light', sub: '150 dpi images. Good for printing.', dpi: 150, quality: 0.8 },
  { id: 'balanced', title: 'Balanced', sub: '110 dpi. Good for email.', dpi: 110, quality: 0.65 },
  { id: 'strong', title: 'Strong', sub: '72 dpi. Smallest, for screens.', dpi: 72, quality: 0.5 },
];

/** Redraw every page as a JPEG and rebuild the PDF at the original page sizes. */
export async function rasterCompress(file, { dpi, quality }, progress) {
  const pages = [];
  for (let i = 0; i < file.pageCount; i++) {
    progress?.(`Compressing page ${i + 1} of ${file.pageCount}…`);
    const size = await pageSize(file, i);
    const { canvas } = await renderPage(file, i, { scale: dpi / 72, dpr: 1 });
    pages.push({ bytes: await canvasToBytes(canvas, 'image/jpeg', quality), type: 'image/jpeg', width: size.width, height: size.height });
    canvas.width = canvas.height = 0; // free memory early on long documents
  }
  return imagesToPdf(pages, { pageSize: 'fit' });
}

export const compress = {
  id: 'compress',
  label: 'Compress',
  icon: 'compress',
  mode: 'single',
  description: 'Make a PDF smaller for email or upload limits. Lossless keeps everything intact; the other levels redraw pages as images, which shrinks scans and photos the most.',

  render(panel, ctx) {
    const file = ctx.activeFile();
    const opts = compress.opts ||= { preset: 'balanced' };
    const preset = PRESETS.find((p) => p.id === opts.preset);
    const result = h('div');

    const chips = h('div', { class: 'chips' }, ...PRESETS.map((p) => h('button', {
      class: 'chip', 'aria-pressed': String(p.id === opts.preset),
      onclick: () => { opts.preset = p.id; ctx.refresh(); },
    }, h('b', {}, p.title), h('small', {}, p.sub))));

    const run = saveButton('Compress', async () => {
      try {
        const out = await ctx.busy('Compressing…', (progress) => (preset.dpi ? rasterCompress(file, preset, progress) : resaveCompact(file.bytes)));
        const before = file.bytes.length;
        const saved = before - out.length;
        if (saved <= 0) {
          const next = PRESETS[PRESETS.indexOf(preset) + 1];
          result.replaceChildren(h('div', { class: 'note warn' },
            `The ${preset.title} level would make this file bigger (${formatBytes(out.length)} instead of ${formatBytes(before)}), so there's nothing to download. `,
            next ? `Try ${next.title}.` : 'This file is mostly text and line art, which is already compact. Keep the original.'));
          return;
        }
        const pct = Math.round((saved / before) * 100);
        result.replaceChildren(h('div', { class: 'result' },
          h('div', { class: 'result-num' }, `${formatBytes(before)} → ${formatBytes(out.length)} `, h('span', { class: 'good' }, `−${pct}%`)),
          saveButton('Download', () => ctx.saveFile(out, `${baseName(file.name)}-compressed.pdf`))));
      } catch (err) { ctx.reportError(err); }
    });

    fill(panel,
      panelHead(compress), filePicker(ctx), chips,
      preset.dpi ? h('div', { class: 'note warn' }, 'Text on redrawn pages can no longer be selected, searched or copied. Use Lossless if you need that.') : null,
      h('div', { class: 'actions' }, run), result,
    );
  },
};
