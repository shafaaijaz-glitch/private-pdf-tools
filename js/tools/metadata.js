// Metadata: show what a PDF says about its author and the apps that made it, and remove it.
import { readMetadata, cleanMetadata } from '../ops.js';
import { h, fill, baseName, field } from '../ui.js';
import { panelHead, filePicker, saveButton } from './common.js';

const LABELS = {
  title: 'Title', author: 'Author', subject: 'Subject', keywords: 'Keywords',
  creator: 'Made with (app)', producer: 'Converted with (app)',
  creationDate: 'Created', modificationDate: 'Last changed',
};

const show = (key, value) => {
  if (!value) return h('span', { class: 'none' }, 'empty');
  if (key.endsWith('Date')) return new Date(value).toLocaleString();
  return value;
};

export const metadata = {
  id: 'metadata',
  label: 'Remove metadata',
  icon: 'metadata',
  mode: 'single',
  description: 'PDFs often carry your name, your company, the apps you used and when you worked on them. See exactly what is inside, then strip it before you share.',

  async render(panel, ctx) {
    const file = ctx.activeFile();
    fill(panel, panelHead(metadata), filePicker(ctx));
    const meta = await readMetadata(file.bytes);
    const found = Object.keys(LABELS).filter((k) => meta[k]).length + (meta.hasXmp ? 1 : 0);

    const keep = { title: '', author: '', subject: '', keywords: '' };
    const inputs = Object.keys(keep).map((k) => field(`New ${LABELS[k].toLowerCase()}`, h('input', {
      type: 'text', id: `meta-${k}`, placeholder: 'Leave empty to remove',
      oninput: (e) => { keep[k] = e.target.value.trim(); },
    })));

    fill(panel,
      h('div', { class: found ? 'note warn' : 'note' }, found
        ? `This file carries ${found} piece${found === 1 ? '' : 's'} of hidden information.`
        : 'No document information found. Cleaning will still remove anything an app may have hidden.'),
      h('div', { class: 'table-wrap' }, h('table', { class: 'meta-table' },
        h('tbody', {},
          ...Object.keys(LABELS).map((k) => h('tr', {}, h('th', {}, LABELS[k]), h('td', {}, show(k, meta[k])))),
          h('tr', {}, h('th', {}, 'Extended metadata (XMP)'), h('td', {}, meta.hasXmp ? 'Present' : h('span', { class: 'none' }, 'none')))))),
      h('div', {},
        h('h3', { style: 'margin:0 0 4px;font-size:.95rem' }, 'Optional: set your own'),
        h('p', { style: 'margin:0 0 10px;color:var(--ink-soft);font-size:.88rem' }, 'Apps, dates and extended metadata are always removed. Anything you type here is written into the cleaned file.')),
      h('div', { class: 'grid-form' }, ...inputs),
      h('div', { class: 'actions' }, saveButton('Clean and download', async () => {
        try {
          const out = await ctx.busy('Cleaning…', () => cleanMetadata(file.bytes, keep));
          await ctx.saveFile(out, `${baseName(file.name)}-clean.pdf`);
        } catch (err) { ctx.reportError(err); }
      })),
    );
  },
};
