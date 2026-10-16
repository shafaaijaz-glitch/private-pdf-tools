// Page numbers and watermark: both stamp text on every page and show a live preview.
import { addPageNumbers, addWatermark, splitPdf } from '../ops.js';
import { h, fill, baseName, field } from '../ui.js';
import { panelHead, filePicker, saveButton, livePreview } from './common.js';

export const numbers = {
  id: 'numbers',
  label: 'Page numbers',
  icon: 'numbers',
  mode: 'single',
  description: 'Number every page. Choose where the number sits, how it reads, and whether the cover page is skipped.',

  render(panel, ctx) {
    const file = ctx.activeFile();
    const o = numbers.opts ||= { format: 'Page {n} of {total}', position: 'bottom-center', size: 11, start: 1, skipFirst: false, color: '#222222' };
    // Preview the first numbered page: build a 2-page cut when the cover is skipped.
    const preview = livePreview(async () => {
      const out = await addPageNumbers(file.bytes, o);
      return o.skipFirst && file.pageCount > 1 ? (await splitPdf(out, [[1]]))[0].bytes : out;
    }, 'Preview of the first numbered page');
    const set = (k, v) => { o[k] = v; preview.update(); };

    const pos = h('select', { id: 'num-pos', onchange: (e) => set('position', e.target.value) },
      ...[['bottom-center', 'Bottom centre'], ['bottom-right', 'Bottom right'], ['bottom-left', 'Bottom left'], ['top-center', 'Top centre'], ['top-right', 'Top right'], ['top-left', 'Top left']]
        .map(([v, l]) => h('option', { value: v, selected: o.position === v }, l)));
    const fmt = h('select', { id: 'num-fmt', onchange: (e) => set('format', e.target.value) },
      ...['{n}', 'Page {n}', 'Page {n} of {total}', '{n} / {total}', '- {n} -'].map((v) => h('option', { value: v, selected: o.format === v }, v.replace('{n}', '3').replace('{total}', '12'))));

    fill(panel, panelHead(numbers), filePicker(ctx), h('div', { class: 'split-view' },
      h('div', { class: 'side-col' },
        h('div', { class: 'grid-form' },
          field('Position', pos),
          field('Format', fmt),
          field('Font size', h('input', { type: 'number', id: 'num-size', min: '6', max: '48', value: String(o.size), oninput: (e) => set('size', Math.min(48, Math.max(6, Number(e.target.value) || 11))) })),
          field('First number', h('input', { type: 'number', id: 'num-start', min: '0', value: String(o.start), oninput: (e) => set('start', Number(e.target.value) || 0) })),
          field('Colour', h('input', { type: 'color', id: 'num-color', value: o.color, oninput: (e) => set('color', e.target.value) }))),
        h('label', { class: 'check' }, h('input', { type: 'checkbox', id: 'num-skip', checked: o.skipFirst, onchange: (e) => set('skipFirst', e.target.checked) }), 'Skip the first page (cover)'),
        h('div', { class: 'actions' }, saveButton('Add numbers and download', async () => {
          try {
            const out = await ctx.busy('Adding page numbers…', () => addPageNumbers(file.bytes, o));
            await ctx.saveFile(out, `${baseName(file.name)}-numbered.pdf`);
          } catch (err) { ctx.reportError(err); }
        }))),
      preview.el));
  },
};

export const watermark = {
  id: 'watermark',
  label: 'Watermark',
  icon: 'watermark',
  mode: 'single',
  description: 'Stamp a word like DRAFT, CONFIDENTIAL or COPY across every page, so a shared document is clearly marked.',

  render(panel, ctx) {
    const file = ctx.activeFile();
    const o = watermark.opts ||= { text: 'CONFIDENTIAL', size: 64, opacity: 0.18, angle: 45, color: '#C62828' };
    const preview = livePreview(() => addWatermark(file.bytes, o));
    const set = (k, v) => { o[k] = v; preview.update(); };
    const range = (id, k, min, max, step, fmt) => {
      const out = h('output', { for: id }, fmt(o[k]));
      return field(k[0].toUpperCase() + k.slice(1), h('div', { class: 'row', style: 'align-items:center;flex-wrap:nowrap' },
        h('input', { type: 'range', id, min: String(min), max: String(max), step: String(step), value: String(o[k]), oninput: (e) => { set(k, Number(e.target.value)); out.textContent = fmt(o[k]); } }),
        out));
    };

    fill(panel, panelHead(watermark), filePicker(ctx), h('div', { class: 'split-view' },
      h('div', { class: 'side-col' },
        field('Text', h('input', { type: 'text', id: 'wm-text', value: o.text, maxlength: '60', oninput: (e) => set('text', e.target.value) })),
        h('div', { class: 'grid-form' },
          range('wm-size', 'size', 16, 140, 2, (v) => `${v} pt`),
          range('wm-opacity', 'opacity', 0.05, 1, 0.05, (v) => `${Math.round(v * 100)}%`),
          range('wm-angle', 'angle', -90, 90, 5, (v) => `${v}°`),
          field('Colour', h('input', { type: 'color', id: 'wm-color', value: o.color, oninput: (e) => set('color', e.target.value) }))),
        h('div', { class: 'actions' }, saveButton('Add watermark and download', async () => {
          try {
            const out = await ctx.busy('Adding watermark…', () => addWatermark(file.bytes, o));
            await ctx.saveFile(out, `${baseName(file.name)}-watermarked.pdf`);
          } catch (err) { ctx.reportError(Object.assign(err, { userFacing: true })); }
        }))),
      preview.el));
  },
};
