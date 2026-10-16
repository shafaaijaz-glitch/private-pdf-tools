// Pieces several tools share: the panel header, the file picker and live previews.
import { h, icons, debounce } from '../ui.js';
import { renderBytesFirstPage } from '../render.js';

/** Header with the tool name, a description and optional action buttons. */
export function panelHead(tool, ...actions) {
  return h('div', { class: 'panel-head' },
    h('div', { style: 'min-width:0' }, h('h2', {}, tool.label), h('p', {}, tool.description)),
    actions.length ? h('div', { class: 'actions' }, ...actions) : null);
}

/** "Working on [file ▾]" picker for tools that operate on one file. */
export function filePicker(ctx) {
  const file = ctx.activeFile();
  if (ctx.state.files.length < 2) {
    return h('div', { class: 'note' }, 'Working on ', h('b', {}, file.name), ` (${file.pageCount} page${file.pageCount === 1 ? '' : 's'}).`);
  }
  const select = h('select', {
    id: 'file-pick',
    onchange: (e) => { ctx.state.activeId = e.target.value; ctx.refresh(); },
  }, ...ctx.state.files.map((f) => h('option', { value: f.id, selected: f === file }, `${f.name} · ${f.pageCount} p.`)));
  return h('label', { class: 'field', style: 'max-width:420px' }, h('span', {}, 'Working on'), select);
}

/** A primary button that downloads. */
export function saveButton(label, onclick) {
  return h('button', { class: 'btn btn-primary', html: `${icons.download}<span>${label}</span>`, onclick });
}

/**
 * Live preview of the first affected page. `build` returns { bytes, page } or bytes.
 * Returns { el, update } — call update() whenever the options change.
 */
export function livePreview(build, caption = 'Preview of page 1') {
  const box = h('div', { class: 'preview' }, h('div', { class: 'spinner' }));
  const cap = h('div', { class: 'preview-cap' }, caption);
  let run = 0;
  const update = debounce(async () => {
    const mine = ++run;
    try {
      const bytes = await build();
      if (!bytes || mine !== run) return;
      const { canvas } = await renderBytesFirstPage(bytes, 260);
      if (mine === run) box.replaceChildren(canvas);
    } catch (err) {
      if (mine === run) box.replaceChildren(h('div', { class: 'error' }, err.message));
    }
  }, 300);
  update();
  return { el: h('div', {}, box, cap), update };
}
