// Thin wrapper around PDF.js for drawing pages onto <canvas> elements.
import * as pdfjsLib from '../vendor/pdf.min.mjs';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdf.worker.min.mjs', import.meta.url).href;

const docCache = new WeakMap(); // file object -> Promise<PDFDocumentProxy>

/** Open (once) the PDF.js document for a library file. */
export function openDoc(file) {
  if (!docCache.has(file)) {
    // PDF.js takes ownership of the buffer it is given, so pass a copy.
    const task = pdfjsLib.getDocument({ data: file.bytes.slice(), isEvalSupported: false });
    docCache.set(file, task.promise);
  }
  return docCache.get(file);
}

/** Forget a cached document (after a file is removed or replaced). */
export async function closeDoc(file) {
  const p = docCache.get(file);
  docCache.delete(file);
  if (p) { try { (await p).destroy(); } catch { /* already gone */ } }
}

/**
 * Render one page (0-based) into a new canvas.
 * opts.width  - target CSS width in px (scale is derived from it), or
 * opts.scale  - explicit scale (1 = 72 dpi)
 * opts.rotate - extra rotation on top of the page's own
 */
export async function renderPage(file, index, opts = {}) {
  const doc = await openDoc(file);
  const page = await doc.getPage(index + 1);
  const rotation = ((page.rotate + (opts.rotate || 0)) % 360 + 360) % 360;
  const base = page.getViewport({ scale: 1, rotation });
  const ratio = opts.dpr ?? Math.min(window.devicePixelRatio || 1, 2);
  const scale = opts.scale ?? (opts.width ? opts.width / base.width : 1);
  const viewport = page.getViewport({ scale: scale * ratio, rotation });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  canvas.style.width = `${Math.round(viewport.width / ratio)}px`;
  const ctx = canvas.getContext('2d', { alpha: false });
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport }).promise;
  page.cleanup();
  return { canvas, width: base.width, height: base.height };
}

/** Page size in points as it appears on screen (rotation applied). */
export async function pageSize(file, index) {
  const doc = await openDoc(file);
  const page = await doc.getPage(index + 1);
  const vp = page.getViewport({ scale: 1 });
  return { width: vp.width, height: vp.height };
}

/** Number of pages, read with PDF.js (also validates that the file opens). */
export async function countPages(file) {
  const doc = await openDoc(file);
  return doc.numPages;
}

/** Render bytes that are not in the library (used for live previews). */
export async function renderBytesFirstPage(bytes, width) {
  const temp = { bytes };
  try {
    return await renderPage(temp, 0, { width });
  } finally {
    closeDoc(temp);
  }
}

/** Convert a canvas to bytes. */
export function canvasToBytes(canvas, type = 'image/png', quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(async (blob) => {
      if (!blob) return reject(new Error('Could not encode the image.'));
      resolve(new Uint8Array(await blob.arrayBuffer()));
    }, type, quality);
  });
}
