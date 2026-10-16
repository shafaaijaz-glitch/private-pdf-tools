// App shell: the file library, importing, downloads, and switching between tools.
import { imagesToPdf, makeSamplePdf, EncryptedPdfError } from './ops.js';
import { renderPage, countPages, closeDoc, canvasToBytes } from './render.js';
import { h, $, fill, formatBytes, baseName, icons } from './ui.js';
import { tools } from './tools/index.js';

const FILE_COLORS = ['#1F4BFF', '#0E7A55', '#B5560B', '#7A3DB8', '#C62828', '#2E6E8E', '#8A6D00'];

export const state = {
  files: [],        // { id, name, bytes, pageCount, color, sample }
  pages: [],        // organize view: { key, fileId, index, rotate }
  activeId: null,   // file the single-file tools work on
  tool: 'organize',
  imageSize: 'a4',  // how dropped images become pages
};

let nextId = 1;
const uid = () => `f${nextId++}`;

// ---------------------------------------------------------------------------
// Feedback: busy overlay and toasts
// ---------------------------------------------------------------------------

export async function busy(text, fn) {
  const veil = $('#busy');
  $('#busy-text').textContent = text;
  veil.hidden = false;
  // let the overlay paint before heavy work starts
  await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
  try {
    return await fn((progress) => { $('#busy-text').textContent = progress; });
  } finally {
    veil.hidden = true;
  }
}

let toastTimer;
export function toast(message, kind = '') {
  const el = $('#toast');
  el.textContent = message;
  el.className = `toast ${kind}`;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, kind === 'bad' ? 6000 : 3200);
}

export function reportError(err) {
  console.error(err);
  toast(err instanceof EncryptedPdfError || err?.userFacing ? err.message : `Something went wrong: ${err?.message || err}`, 'bad');
}

// ---------------------------------------------------------------------------
// Saving files: a plain browser download, nothing leaves the device.
// ---------------------------------------------------------------------------

export async function saveFile(bytes, filename, type = 'application/pdf') {
  const blob = bytes instanceof Blob ? bytes : new Blob([bytes], { type });
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  toast(`Downloaded ${filename}`);
}

/** Save several files: one file directly, more than one as a .zip. */
export async function saveMany(files, zipName) {
  if (files.length === 1) return saveFile(files[0].bytes, files[0].name, files[0].type);
  const zip = new window.JSZip();
  for (const f of files) zip.file(f.name, f.bytes);
  const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE' });
  return saveFile(blob, zipName, 'application/zip');
}

// ---------------------------------------------------------------------------
// Library
// ---------------------------------------------------------------------------

export function activeFile() {
  return state.files.find((f) => f.id === state.activeId) || state.files[state.files.length - 1] || null;
}

export function fileById(id) {
  return state.files.find((f) => f.id === id);
}

/** Add PDF bytes to the library. Returns the new file object. */
export async function addPdf(bytes, name, { sample = false, select = true } = {}) {
  const file = { id: uid(), name, bytes, pageCount: 0, color: FILE_COLORS[(nextId - 2) % FILE_COLORS.length], sample };
  try {
    file.pageCount = await countPages(file);
  } catch (err) {
    closeDoc(file);
    const e = new Error(/password/i.test(err?.message || err?.name || '')
      ? `${name} is password-protected. Remove the password in your PDF reader first, then add it again.`
      : `${name} couldn't be opened. It may be damaged or not a real PDF.`);
    e.userFacing = true;
    throw e;
  }
  state.files.push(file);
  for (let i = 0; i < file.pageCount; i++) state.pages.push({ key: `${file.id}:${i}:${Math.random().toString(36).slice(2, 7)}`, fileId: file.id, index: i, rotate: 0 });
  if (select) state.activeId = file.id;
  return file;
}

export function removeFile(id) {
  const file = fileById(id);
  if (!file) return;
  closeDoc(file);
  state.files = state.files.filter((f) => f.id !== id);
  state.pages = state.pages.filter((p) => p.fileId !== id);
  if (state.activeId === id) state.activeId = state.files.at(-1)?.id ?? null;
  refresh();
}

/** Decode any browser-supported image to PNG/JPEG bytes pdf-lib can embed. */
async function normalizeImage(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (file.type === 'image/jpeg' || file.type === 'image/png') return { bytes, type: file.type };
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) {
    const e = new Error(`${file.name} is an image format this browser can't read. Convert it to JPG or PNG first.`);
    e.userFacing = true;
    throw e;
  }
  const canvas = h('canvas', { width: bitmap.width, height: bitmap.height });
  canvas.getContext('2d').drawImage(bitmap, 0, 0);
  return { bytes: await canvasToBytes(canvas, 'image/png'), type: 'image/png' };
}

export async function importFiles(fileList) {
  const list = [...fileList];
  if (!list.length) return;
  const isPdf = (f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name);
  const pdfs = list.filter(isPdf);
  const images = list.filter((f) => !isPdf(f) && (f.type.startsWith('image/') || /\.(png|jpe?g|webp|gif|bmp|heic)$/i.test(f.name)));
  const skipped = list.length - pdfs.length - images.length;
  // Remove the sample once the person adds their own files.
  state.files.filter((f) => f.sample).forEach((f) => removeFile(f.id));
  await busy('Reading files…', async (progress) => {
    let n = 0;
    for (const f of pdfs) {
      progress(`Reading ${++n} of ${pdfs.length + (images.length ? 1 : 0)}…`);
      try { await addPdf(new Uint8Array(await f.arrayBuffer()), f.name); } catch (err) { reportError(err); }
    }
    if (images.length) {
      progress(`Converting ${images.length} image${images.length > 1 ? 's' : ''}…`);
      try {
        const decoded = [];
        for (const img of images) decoded.push(await normalizeImage(img));
        const bytes = await imagesToPdf(decoded, { pageSize: state.imageSize, margin: state.imageSize === 'fit' ? 0 : 24 });
        const name = images.length === 1 ? `${baseName(images[0].name)}.pdf` : `Images (${images.length}).pdf`;
        await addPdf(bytes, name);
      } catch (err) { reportError(err); }
    }
  });
  if (skipped) toast(`Skipped ${skipped} file${skipped > 1 ? 's' : ''} that ${skipped > 1 ? "aren't" : "isn't"} a PDF or image.`, 'bad');
  refresh();
}

// ---------------------------------------------------------------------------
// Rendering the shell
// ---------------------------------------------------------------------------

function renderTools() {
  const nav = $('#tools');
  nav.replaceChildren(...tools.map((t) => h('button', {
    class: 'tool-tab',
    'aria-current': String(t.id === state.tool),
    onclick: () => { state.tool = t.id; try { history.replaceState(null, '', `#${t.id}`); } catch { /* sandboxed */ } refresh(); },
    html: `${icons[t.icon]}<span>${t.label}</span>`,
  })));
}

const thumbCache = new Map(); // fileId -> canvas (first page)
async function fileThumb(file) {
  if (!thumbCache.has(file.id)) {
    thumbCache.set(file.id, renderPage(file, 0, { width: 40 }).then((r) => r.canvas).catch(() => null));
  }
  const c = await thumbCache.get(file.id);
  return c ? copyCanvas(c) : null;
}
function copyCanvas(src) {
  const c = h('canvas', { width: src.width, height: src.height });
  c.style.width = src.style.width;
  c.getContext('2d').drawImage(src, 0, 0);
  return c;
}

function renderLibrary() {
  const lib = $('#library');
  const total = state.files.reduce((s, f) => s + f.bytes.length, 0);
  const tool = tools.find((t) => t.id === state.tool);
  const items = state.files.map((f) => {
    const thumb = h('div', { class: 'file-thumb' });
    fileThumb(f).then((c) => c && thumb.append(c));
    const selectable = tool?.mode === 'single';
    const li = h('li', {
      class: `file-item${selectable && activeFile() === f ? ' active' : ''}`,
      style: selectable ? 'cursor:pointer' : null,
      onclick: selectable ? () => { state.activeId = f.id; refresh(); } : null,
      title: selectable ? `Use ${f.name} with ${tool.label}` : f.name,
    },
    thumb,
    h('div', { style: 'min-width:0' },
      h('div', { class: 'file-name', title: f.name }, h('span', { class: 'swatch', style: `background:${f.color}` }), f.name),
      h('div', { class: 'file-meta' }, `${f.pageCount} page${f.pageCount === 1 ? '' : 's'} · ${formatBytes(f.bytes.length)}`, f.sample ? h('span', { class: 'tag' }, 'Sample') : null)),
    h('button', { class: 'icon-btn', title: `Remove ${f.name}`, 'aria-label': `Remove ${f.name}`, html: icons.x, onclick: (e) => { e.stopPropagation(); removeFile(f.id); } }));
    return li;
  });

  const sizeSelect = h('select', { id: 'image-size', onchange: (e) => { state.imageSize = e.target.value; } },
    ...[['a4', 'A4 pages'], ['letter', 'Letter pages'], ['fit', 'Same size as image']].map(([v, l]) => h('option', { value: v, selected: state.imageSize === v }, l)));

  lib.replaceChildren();
  fill(lib,
    h('div', { class: 'lib-head' }, h('h2', {}, 'Your files'), state.files.length ? h('small', {}, `${state.files.length} · ${formatBytes(total)}`) : null),
    items.length ? h('ul', { class: 'file-list' }, items) : null,
    h('label', { class: 'dropzone', for: 'file-input' }, h('strong', {}, 'Drop PDFs or images here'), 'or click to choose. JPG and PNG photos become pages.'),
    h('label', { class: 'field' }, h('span', {}, 'Images become'), sizeSelect),
    h('div', { class: 'privacy-note', html: `${icons.shield}<span>Files are processed by your own browser. This page has no server to upload to, and it keeps working offline.</span>` }),
  );
}

export function refresh() {
  renderTools();
  renderLibrary();
  const panel = $('#panel');
  const tool = tools.find((t) => t.id === state.tool) || tools[0];
  panel.replaceChildren();
  if (!state.files.length) {
    fill(panel,
      h('div', { class: 'panel-head' }, h('div', {}, h('h2', {}, tool.label), h('p', {}, tool.description))),
      h('div', { class: 'empty' },
        h('strong', {}, 'Add a PDF to get started'),
        h('p', {}, 'Drop files anywhere on this page, or try it with a sample file.'),
        h('div', { class: 'actions', style: 'justify-content:center' },
          h('label', { class: 'btn btn-primary', for: 'file-input' }, 'Choose files'),
          h('button', { class: 'btn', onclick: loadSample }, 'Load a sample'))),
    );
    return;
  }
  Promise.resolve(tool.render(panel, ctx)).catch(reportError);
}

async function loadSample() {
  await addPdf(await makeSamplePdf(4), 'sample.pdf', { sample: true });
  refresh();
}

/** Everything a tool needs, passed in so tools don't import the app module. */
const ctx = {
  state, activeFile, fileById, addPdf, saveFile, saveMany, busy, toast, reportError, refresh,
};

// ---------------------------------------------------------------------------
// Start-up
// ---------------------------------------------------------------------------

function wireImport() {
  const input = $('#file-input');
  input.addEventListener('change', () => { importFiles(input.files); input.value = ''; });
  let depth = 0;
  const veil = $('#dropveil');
  const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
  window.addEventListener('dragenter', (e) => { if (!hasFiles(e)) return; e.preventDefault(); depth++; veil.hidden = false; });
  window.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
  window.addEventListener('dragleave', (e) => { if (!hasFiles(e)) return; depth = Math.max(0, depth - 1); if (!depth) veil.hidden = true; });
  window.addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault(); depth = 0; veil.hidden = true;
    importFiles(e.dataTransfer.files);
  });
  // Paste a PDF or screenshot with Ctrl/Cmd+V
  window.addEventListener('paste', (e) => {
    const files = [...(e.clipboardData?.files || [])];
    if (files.length) importFiles(files);
  });
}

function registerServiceWorker() {
  // Makes the app installable and usable offline when hosted (e.g. on GitHub Pages).
  if (!('serviceWorker' in navigator) || !/^https?:$/.test(location.protocol)) return;
  navigator.serviceWorker.register('sw.js').catch(() => { /* offline support is optional */ });
}

async function start() {
  const fromHash = location.hash.slice(1);
  if (tools.some((t) => t.id === fromHash)) state.tool = fromHash;
  wireImport();
  registerServiceWorker();
  // Open in a working state with a clearly-labelled sample file.
  try { await loadSample(); } catch (err) { reportError(err); refresh(); }
}

start();
