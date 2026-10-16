// Pure PDF operations built on pdf-lib.
// Nothing in this file touches the DOM, so every function runs in the browser
// and in Node (see tests/ops.test.mjs).

import {
  PDFDocument,
  PDFName,
  StandardFonts,
  degrees,
  rgb,
} from '../vendor/pdf-lib.esm.min.js';

/** Thrown when a PDF can't be processed because it is password-protected. */
export class EncryptedPdfError extends Error {
  constructor(name = 'This PDF') {
    super(`${name} is password-protected. Remove the password in your PDF reader first, then try again.`);
    this.name = 'EncryptedPdfError';
  }
}

/** Load a PDF with pdf-lib, turning encryption errors into a readable message. */
export async function loadPdf(bytes, name) {
  try {
    return await PDFDocument.load(bytes, { updateMetadata: false });
  } catch (err) {
    if (/encrypted/i.test(String(err && err.message))) throw new EncryptedPdfError(name);
    throw err;
  }
}

/**
 * Parse a page-range string such as "1-3, 5, 8-" into groups of 0-based page indices.
 * Each comma-separated part becomes one group (one output file when splitting).
 * "8-" means page 8 to the end, "-3" means pages 1 to 3.
 */
export function parseRanges(input, pageCount) {
  const text = String(input || '').trim();
  if (!text) throw new Error('Enter at least one page or range, for example 1-3, 5.');
  const groups = [];
  for (const raw of text.split(',')) {
    const part = raw.trim();
    if (!part) continue;
    const m = part.match(/^(\d*)\s*-\s*(\d*)$/);
    let start;
    let end;
    if (m) {
      start = m[1] ? Number(m[1]) : 1;
      end = m[2] ? Number(m[2]) : pageCount;
    } else if (/^\d+$/.test(part)) {
      start = end = Number(part);
    } else {
      throw new Error(`"${part}" isn't a page or range. Use numbers like 4 or 2-6.`);
    }
    if (start < 1 || end < 1) throw new Error('Page numbers start at 1.');
    if (start > pageCount || end > pageCount) {
      throw new Error(`"${part}" goes past the last page. This file has ${pageCount} page${pageCount === 1 ? '' : 's'}.`);
    }
    const group = [];
    const step = start <= end ? 1 : -1; // "5-2" gives pages in reverse order
    for (let p = start; p !== end + step; p += step) group.push(p - 1);
    groups.push(group);
  }
  if (!groups.length) throw new Error('Enter at least one page or range, for example 1-3, 5.');
  return groups;
}

/**
 * Build one PDF from a list of pages taken from one or more source files.
 * sources: { [id]: Uint8Array }
 * pages:   [{ source: id, index: 0-based page, rotate: extra degrees (multiple of 90) }]
 */
export async function assemblePages(sources, pages) {
  if (!pages.length) throw new Error('There are no pages to save.');
  const out = await PDFDocument.create();
  const loaded = new Map();
  for (const p of pages) {
    if (!loaded.has(p.source)) loaded.set(p.source, await loadPdf(sources[p.source], p.source));
  }
  for (const p of pages) {
    const src = loaded.get(p.source);
    const [copied] = await out.copyPages(src, [p.index]);
    const extra = ((p.rotate || 0) % 360 + 360) % 360;
    if (extra) {
      const current = copied.getRotation().angle || 0;
      copied.setRotation(degrees((current + extra) % 360));
    }
    out.addPage(copied);
  }
  return out.save();
}

/** Split one PDF into several, one per page group (from parseRanges or everyNPages). */
export async function splitPdf(bytes, groups) {
  const src = await loadPdf(bytes);
  const results = [];
  for (const group of groups) {
    const out = await PDFDocument.create();
    const copied = await out.copyPages(src, group);
    copied.forEach((pg) => out.addPage(pg));
    results.push({ pages: group, bytes: await out.save() });
  }
  return results;
}

/** Page groups of size n: [[0..n-1], [n..2n-1], ...] */
export function everyNPages(pageCount, n) {
  const size = Math.max(1, Math.floor(n));
  const groups = [];
  for (let i = 0; i < pageCount; i += size) {
    groups.push(Array.from({ length: Math.min(size, pageCount - i) }, (_, k) => i + k));
  }
  return groups;
}

// ---------------------------------------------------------------------------
// Drawing on rotated pages
// A page can carry a /Rotate value, so the way it looks on screen ("visual")
// differs from its internal coordinates. These helpers let the rest of the
// code think in visual coordinates (origin bottom-left of what you see).
// ---------------------------------------------------------------------------

export function visualSize(page) {
  const { width, height } = page.getSize();
  const r = normalizedRotation(page);
  return r === 90 || r === 270 ? { width: height, height: width } : { width, height };
}

function normalizedRotation(page) {
  return (((page.getRotation().angle || 0) % 360) + 360) % 360;
}

/** Map a visual point to internal page coordinates, plus the extra rotation to apply. */
export function toPageCoords(page, vx, vy) {
  const { width: w, height: h } = page.getSize();
  switch (normalizedRotation(page)) {
    case 90: return { x: w - vy, y: vx, rotate: 90 };
    case 180: return { x: w - vx, y: h - vy, rotate: 180 };
    case 270: return { x: vy, y: h - vx, rotate: 270 };
    default: return { x: vx, y: vy, rotate: 0 };
  }
}

function drawVisualText(page, text, { vx, vy, size, font, color, opacity = 1, angle = 0 }) {
  const p = toPageCoords(page, vx, vy);
  page.drawText(text, {
    x: p.x, y: p.y, size, font, color, opacity,
    rotate: degrees((p.rotate + angle) % 360),
  });
}

export function hexToRgb(hex) {
  const m = String(hex).replace('#', '').match(/^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!m) return rgb(0, 0, 0);
  return rgb(parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255);
}

/**
 * Add page numbers.
 * opts: { format: 'Page {n} of {total}', position: 'bottom-center' | 'bottom-right' | 'bottom-left'
 *         | 'top-center' | 'top-right' | 'top-left', size, margin, start, skipFirst, color }
 */
export async function addPageNumbers(bytes, opts = {}) {
  const {
    format = '{n}', position = 'bottom-center', size = 11, margin = 28,
    start = 1, skipFirst = false, color = '#222222',
  } = opts;
  const doc = await loadPdf(bytes);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const pages = doc.getPages();
  const numbered = skipFirst ? pages.length - 1 : pages.length;
  pages.forEach((page, i) => {
    if (skipFirst && i === 0) return;
    const n = start + (skipFirst ? i - 1 : i);
    const label = format.replaceAll('{n}', String(n)).replaceAll('{total}', String(numbered + start - 1));
    const tw = font.widthOfTextAtSize(label, size);
    const { width, height } = visualSize(page);
    const [vert, horiz] = position.split('-');
    const vx = horiz === 'left' ? margin : horiz === 'right' ? width - margin - tw : (width - tw) / 2;
    const vy = vert === 'top' ? height - margin - size * 0.75 : margin;
    drawVisualText(page, label, { vx, vy, size, font, color: hexToRgb(color) });
  });
  return doc.save();
}

/** Add a text watermark to every page. opts: { text, size, opacity, angle, color } */
export async function addWatermark(bytes, opts = {}) {
  const { text = 'CONFIDENTIAL', size = 64, opacity = 0.18, angle = 45, color = '#C62828' } = opts;
  if (!text.trim()) throw new Error('Type the watermark text first.');
  const doc = await loadPdf(bytes);
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  const tw = font.widthOfTextAtSize(text, size);
  const th = size * 0.7; // cap height is roughly 70% of the font size
  const rad = (angle * Math.PI) / 180;
  for (const page of doc.getPages()) {
    const { width, height } = visualSize(page);
    // Start the baseline so the text's centre lands on the page centre.
    const vx = width / 2 - (Math.cos(rad) * tw) / 2 + (Math.sin(rad) * th) / 2;
    const vy = height / 2 - (Math.sin(rad) * tw) / 2 - (Math.cos(rad) * th) / 2;
    drawVisualText(page, text, { vx, vy, size, font, color: hexToRgb(color), opacity, angle });
  }
  return doc.save();
}

/**
 * Stamp images (signatures) and text onto pages.
 * Positions are fractions of the visible page, measured from the top-left,
 * which matches how people place things on screen.
 * items: [{ type: 'image', page, x, y, w, h, png: Uint8Array }
 *         | { type: 'text', page, x, y, text, size, color }]
 */
export async function stampItems(bytes, items) {
  const doc = await loadPdf(bytes);
  const pages = doc.getPages();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const imageCache = new Map();
  for (const item of items) {
    const page = pages[item.page];
    if (!page) continue;
    const { width, height } = visualSize(page);
    const left = item.x * width;
    const top = (1 - item.y) * height;
    if (item.type === 'image') {
      let img = imageCache.get(item.png);
      if (!img) { img = await doc.embedPng(item.png); imageCache.set(item.png, img); }
      const w = item.w * width;
      const h = item.h * height;
      const p = toPageCoords(page, left, top - h);
      page.drawImage(img, { x: p.x, y: p.y, width: w, height: h, rotate: degrees(p.rotate) });
    } else if (item.type === 'text' && item.text) {
      const size = item.size || 14;
      drawVisualText(page, item.text, {
        vx: left, vy: top - size * 0.8, size, font, color: hexToRgb(item.color || '#111111'),
      });
    }
  }
  return doc.save();
}

/** Read the document information fields people usually care about. */
export async function readMetadata(bytes) {
  const doc = await loadPdf(bytes);
  const safe = (fn) => { try { return fn() ?? ''; } catch { return ''; } };
  const date = (d) => (d instanceof Date && !isNaN(d) ? d.toISOString() : '');
  return {
    title: safe(() => doc.getTitle()),
    author: safe(() => doc.getAuthor()),
    subject: safe(() => doc.getSubject()),
    keywords: safe(() => doc.getKeywords()),
    creator: safe(() => doc.getCreator()),
    producer: safe(() => doc.getProducer()),
    creationDate: date(safe(() => doc.getCreationDate())),
    modificationDate: date(safe(() => doc.getModificationDate())),
    hasXmp: !!doc.catalog.get(PDFName.of('Metadata')),
    pageCount: doc.getPageCount(),
  };
}

/**
 * Remove or rewrite metadata.
 * fields: { title, author, subject, keywords } — strings to keep; empty strings are removed.
 * Always removes the XMP metadata stream, creator/producer apps and dates.
 */
export async function cleanMetadata(bytes, fields = {}) {
  const doc = await loadPdf(bytes);
  // Wipe the whole Info dictionary, then add back only what the person chose to keep.
  const infoRef = doc.context.trailerInfo.Info;
  if (infoRef) {
    const info = doc.context.lookup(infoRef);
    if (info && info.keys) for (const key of info.keys()) info.delete(key);
  }
  doc.catalog.delete(PDFName.of('Metadata'));
  if (fields.title) doc.setTitle(fields.title);
  if (fields.author) doc.setAuthor(fields.author);
  if (fields.subject) doc.setSubject(fields.subject);
  if (fields.keywords) doc.setKeywords(String(fields.keywords).split(',').map((s) => s.trim()).filter(Boolean));
  return doc.save({ updateFieldAppearances: false });
}

/** Lossless re-save: object streams often shrink files without touching quality. */
export async function resaveCompact(bytes) {
  const doc = await loadPdf(bytes);
  return doc.save({ useObjectStreams: true });
}

/**
 * Build a PDF from images.
 * images: [{ bytes: Uint8Array, type: 'image/png' | 'image/jpeg' }]
 * opts:   { pageSize: 'fit' | 'a4' | 'letter', margin (points) }
 * pages: [{ jpeg?: Uint8Array, png?: Uint8Array, width, height }] is also accepted
 */
export async function imagesToPdf(images, opts = {}) {
  const { pageSize = 'fit', margin = 0 } = opts;
  const sizes = { a4: [595.28, 841.89], letter: [612, 792] };
  const doc = await PDFDocument.create();
  for (const im of images) {
    const img = im.type === 'image/png' ? await doc.embedPng(im.bytes) : await doc.embedJpg(im.bytes);
    if (pageSize === 'fit' || !sizes[pageSize]) {
      const w = im.width || img.width;
      const h = im.height || img.height;
      const page = doc.addPage([w + margin * 2, h + margin * 2]);
      page.drawImage(img, { x: margin, y: margin, width: w, height: h });
    } else {
      let [pw, ph] = sizes[pageSize];
      if (img.width > img.height) [pw, ph] = [ph, pw]; // landscape images get landscape pages
      const page = doc.addPage([pw, ph]);
      const scale = Math.min((pw - margin * 2) / img.width, (ph - margin * 2) / img.height);
      const w = img.width * scale;
      const h = img.height * scale;
      page.drawImage(img, { x: (pw - w) / 2, y: (ph - h) / 2, width: w, height: h });
    }
  }
  return doc.save();
}

/** A small multi-page sample document, used for the demo and the tests. */
export async function makeSamplePdf(pages = 4) {
  const doc = await PDFDocument.create();
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const tints = ['#1F4BFF', '#0F8A6A', '#B5560B', '#7A3DB8', '#C62828', '#2E6E8E'];
  for (let i = 0; i < pages; i++) {
    const page = doc.addPage([595.28, 841.89]);
    const c = hexToRgb(tints[i % tints.length]);
    page.drawRectangle({ x: 0, y: 841.89 - 140, width: 595.28, height: 140, color: c, opacity: 0.12 });
    page.drawText(`Sample page ${i + 1}`, { x: 56, y: 841.89 - 96, size: 34, font: bold, color: c });
    const lines = [
      'This sample file was generated in your browser.',
      'Try reordering, rotating, splitting or signing it.',
      'Nothing is uploaded anywhere.',
    ];
    lines.forEach((l, k) => page.drawText(l, { x: 56, y: 600 - k * 24, size: 14, font: regular, color: rgb(0.2, 0.22, 0.25) }));
    page.drawText(String(i + 1), { x: 595.28 / 2 - 20, y: 300, size: 160, font: bold, color: c, opacity: 0.25 });
  }
  doc.setTitle('Private PDF Tools sample');
  doc.setAuthor('Sample Author');
  return doc.save();
}
