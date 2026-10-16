// Sign & fill: draw or type a signature, add text such as names and dates,
// drag everything into place on the page, then save.
import { stampItems } from '../ops.js';
import { renderPage, pageSize, canvasToBytes } from '../render.js';
import { h, fill, icons, baseName, field } from '../ui.js';
import { panelHead, filePicker, saveButton } from './common.js';

const SIGN_FONT = '"Segoe Script", "Brush Script MT", "Snell Roundhand", "Apple Chancery", cursive';
const INK = { black: '#111111', blue: '#1A3BB8' };

/** Crop a canvas to its drawn pixels and return PNG bytes plus a preview URL. */
async function cropToInk(canvas) {
  const ctx = canvas.getContext('2d');
  const { width, height } = canvas;
  const data = ctx.getImageData(0, 0, width, height).data;
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > 8) {
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  const pad = 6;
  minX = Math.max(0, minX - pad); minY = Math.max(0, minY - pad);
  maxX = Math.min(width - 1, maxX + pad); maxY = Math.min(height - 1, maxY + pad);
  const out = document.createElement('canvas');
  out.width = maxX - minX + 1; out.height = maxY - minY + 1;
  out.getContext('2d').drawImage(canvas, minX, minY, out.width, out.height, 0, 0, out.width, out.height);
  const png = await canvasToBytes(out, 'image/png');
  return { png, url: out.toDataURL('image/png'), aspect: out.height / out.width };
}

/** A small drawing pad. Returns { el, clear, export, isEmpty } */
function drawPad(color) {
  const canvas = h('canvas');
  const wrap = h('div', { class: 'pad-wrap' }, canvas, h('div', { class: 'pad-line' }));
  let drawing = false, last = null, empty = true;
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  const fit = () => {
    const r = canvas.getBoundingClientRect();
    if (!r.width) return;
    canvas.width = Math.round(r.width * ratio * 1.5);
    canvas.height = Math.round(140 * ratio * 1.5);
    empty = true;
  };
  requestAnimationFrame(fit);
  const pos = (e) => {
    const r = canvas.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * canvas.width, y: ((e.clientY - r.top) / r.height) * canvas.height };
  };
  canvas.addEventListener('pointerdown', (e) => {
    if (!canvas.width) fit();
    drawing = true; last = pos(e); canvas.setPointerCapture(e.pointerId);
    const c = canvas.getContext('2d');
    c.fillStyle = color(); c.beginPath(); c.arc(last.x, last.y, 1.6 * ratio, 0, Math.PI * 2); c.fill();
    empty = false;
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drawing) return;
    const p = pos(e);
    const c = canvas.getContext('2d');
    c.strokeStyle = color(); c.lineWidth = 3.2 * ratio; c.lineCap = 'round'; c.lineJoin = 'round';
    c.beginPath(); c.moveTo(last.x, last.y);
    const mid = { x: (last.x + p.x) / 2, y: (last.y + p.y) / 2 };
    c.quadraticCurveTo(last.x, last.y, mid.x, mid.y); c.lineTo(p.x, p.y); c.stroke();
    last = p;
  });
  const end = () => { drawing = false; };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  return {
    el: wrap,
    clear: () => { canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height); empty = true; },
    isEmpty: () => empty,
    export: () => cropToInk(canvas),
  };
}

async function typedSignature(text, color) {
  const canvas = document.createElement('canvas');
  const size = 120;
  const c = canvas.getContext('2d');
  c.font = `${size}px ${SIGN_FONT}`;
  canvas.width = Math.ceil(c.measureText(text).width + 40);
  canvas.height = Math.ceil(size * 1.6);
  c.font = `${size}px ${SIGN_FONT}`; // resizing resets the context
  c.fillStyle = color; c.textBaseline = 'middle';
  c.fillText(text, 20, canvas.height / 2);
  return cropToInk(canvas);
}

export const sign = {
  id: 'sign',
  label: 'Sign & fill',
  icon: 'sign',
  mode: 'single',
  description: 'Draw or type your signature, add names, dates or notes, and place them anywhere on the page. No account, no upload.',

  items: {},   // fileId -> [{ id, type, page, x, y, w, h, png, url, text, size }]
  page: {},    // fileId -> current page index
  mode: 'draw',
  ink: 'black',

  async render(panel, ctx) {
    const file = ctx.activeFile();
    const items = (sign.items[file.id] ||= []);
    let pageIndex = Math.min(sign.page[file.id] || 0, file.pageCount - 1);
    let selected = null;

    // ---------------- stage (the page you place things on) ----------------
    const stage = h('div', { class: 'stage' });
    const pager = h('div', { class: 'pager' });
    const stageWrap = h('div', { class: 'stage-wrap' }, pager, stage);
    let pts = { width: 595, height: 842 }; // page size in points (visual)

    const pxPerPt = () => stage.getBoundingClientRect().width / pts.width || 1;

    function stampEl(item) {
      const el = h('div', { class: `stamp${selected === item.id ? ' selected' : ''}`, tabindex: '0', 'aria-label': item.type === 'text' ? `Text: ${item.text}` : 'Signature' });
      el.style.left = `${item.x * 100}%`;
      el.style.top = `${item.y * 100}%`;
      if (item.type === 'image') {
        el.style.width = `${item.w * 100}%`;
        el.style.height = `${item.h * 100}%`;
        el.append(h('img', { src: item.url, alt: '' }));
      } else {
        el.append(h('div', { class: 'stamp-text', style: `font-size:${item.size * pxPerPt()}px` }, item.text));
      }
      const del = h('button', { class: 'del', 'aria-label': 'Remove', html: icons.x, onpointerdown: (e) => e.stopPropagation(), onclick: () => { items.splice(items.indexOf(item), 1); drawStamps(); updateCount(); } });
      const grip = h('button', { class: 'grip', 'aria-label': 'Resize', tabindex: '-1' });
      el.append(del, grip);

      // drag to move
      el.addEventListener('pointerdown', (e) => {
        if (e.target === grip) return;
        e.preventDefault();
        selected = item.id;
        stage.querySelectorAll('.stamp').forEach((s) => s.classList.toggle('selected', s === el));
        const r = stage.getBoundingClientRect();
        const start = { x: e.clientX, y: e.clientY, ix: item.x, iy: item.y };
        el.setPointerCapture(e.pointerId);
        const move = (ev) => {
          const bw = el.offsetWidth / r.width, bh = el.offsetHeight / r.height;
          item.x = Math.min(1 - bw, Math.max(0, start.ix + (ev.clientX - start.x) / r.width));
          item.y = Math.min(1 - bh, Math.max(0, start.iy + (ev.clientY - start.y) / r.height));
          el.style.left = `${item.x * 100}%`; el.style.top = `${item.y * 100}%`;
        };
        const up = () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); };
        el.addEventListener('pointermove', move);
        el.addEventListener('pointerup', up);
      });
      // drag the corner to resize
      grip.addEventListener('pointerdown', (e) => {
        e.preventDefault(); e.stopPropagation();
        const r = stage.getBoundingClientRect();
        const start = { x: e.clientX, w: item.w, size: item.size, width: el.offsetWidth };
        grip.setPointerCapture(e.pointerId);
        const move = (ev) => {
          const dx = ev.clientX - start.x;
          if (item.type === 'image') {
            const ratio = item.h / item.w;
            item.w = Math.min(1 - item.x, Math.max(0.04, start.w + dx / r.width));
            item.h = item.w * ratio;
            el.style.width = `${item.w * 100}%`; el.style.height = `${item.h * 100}%`;
          } else {
            item.size = Math.max(6, Math.min(72, start.size * ((start.width + dx) / start.width)));
            el.querySelector('.stamp-text').style.fontSize = `${item.size * pxPerPt()}px`;
          }
        };
        const up = () => { grip.removeEventListener('pointermove', move); grip.removeEventListener('pointerup', up); };
        grip.addEventListener('pointermove', move);
        grip.addEventListener('pointerup', up);
      });
      // keyboard nudging for accessibility
      el.addEventListener('keydown', (e) => {
        const step = e.shiftKey ? 0.05 : 0.01;
        const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
        if (d) { e.preventDefault(); item.x = Math.max(0, item.x + d[0]); item.y = Math.max(0, item.y + d[1]); el.style.left = `${item.x * 100}%`; el.style.top = `${item.y * 100}%`; }
        if (e.key === 'Delete' || e.key === 'Backspace') { items.splice(items.indexOf(item), 1); drawStamps(); updateCount(); }
      });
      return el;
    }

    function drawStamps() {
      stage.querySelectorAll('.stamp').forEach((n) => n.remove());
      items.filter((i) => i.page === pageIndex).forEach((i) => stage.append(stampEl(i)));
    }

    async function drawPage() {
      sign.page[file.id] = pageIndex;
      pager.replaceChildren(
        h('button', { class: 'icon-btn', 'aria-label': 'Previous page', html: icons.left, disabled: pageIndex === 0, onclick: () => { pageIndex--; drawPage(); } }),
        h('span', {}, `Page ${pageIndex + 1} of ${file.pageCount}`),
        h('button', { class: 'icon-btn', 'aria-label': 'Next page', html: icons.right, disabled: pageIndex >= file.pageCount - 1, onclick: () => { pageIndex++; drawPage(); } }));
      const width = Math.min(stageWrap.clientWidth - 28 || 600, 760);
      pts = await pageSize(file, pageIndex);
      const { canvas } = await renderPage(file, pageIndex, { width });
      stage.replaceChildren(canvas);
      drawStamps();
    }

    // ---------------- side panel ----------------
    const color = () => INK[sign.ink];
    const pad = drawPad(color);
    const typed = h('input', { type: 'text', id: 'sign-typed', placeholder: 'Type your name', class: 'typed-sign', style: `font-family:${SIGN_FONT};font-size:1.8rem` });

    const addImage = (sig) => {
      const w = 0.3;
      const hFrac = w * sig.aspect * (pts.width / pts.height);
      items.push({ id: Math.random().toString(36).slice(2), type: 'image', page: pageIndex, x: 0.55, y: 0.78, w, h: hFrac, png: sig.png, url: sig.url });
      drawStamps(); updateCount();
    };

    const useSignature = async () => {
      const sig = sign.mode === 'draw'
        ? (pad.isEmpty() ? null : await pad.export())
        : (typed.value.trim() ? await typedSignature(typed.value.trim(), color()) : null);
      if (!sig) { ctx.toast(sign.mode === 'draw' ? 'Draw your signature in the box first.' : 'Type your name first.', 'bad'); return; }
      addImage(sig);
      ctx.toast('Signature added. Drag it into place.');
    };

    const seg = (key, options, onpick) => h('div', { class: 'seg', role: 'group' }, ...options.map(([v, l]) => h('button', {
      'aria-pressed': String(sign[key] === v), onclick: () => { sign[key] = v; onpick(); },
    }, l)));

    const sigBody = h('div', { class: 'side-col', style: 'gap:10px' });
    const drawSigBody = () => {
      sigBody.replaceChildren(
        h('div', { class: 'row', style: 'justify-content:space-between;align-items:center' },
          seg('mode', [['draw', 'Draw'], ['type', 'Type']], drawSigBody),
          seg('ink', [['black', 'Black'], ['blue', 'Blue']], () => { typed.style.color = color(); drawSigBody(); })),
        sign.mode === 'draw' ? pad.el : typed,
        h('div', { class: 'actions' },
          h('button', { class: 'btn btn-primary btn-small', onclick: useSignature }, 'Place on page'),
          sign.mode === 'draw' ? h('button', { class: 'btn btn-small btn-quiet', onclick: pad.clear }, 'Clear') : null));
      typed.style.color = color();
    };
    drawSigBody();

    const textIn = h('input', { type: 'text', id: 'sign-text', placeholder: 'Name, date, initials…' });
    const sizeIn = h('input', { type: 'number', id: 'sign-size', min: '6', max: '72', value: '14' });
    const addText = (text) => {
      if (!text) { ctx.toast('Type some text first.', 'bad'); return; }
      items.push({ id: Math.random().toString(36).slice(2), type: 'text', page: pageIndex, x: 0.1, y: 0.82, text, size: Number(sizeIn.value) || 14, color: '#111111' });
      drawStamps(); updateCount();
    };

    const count = h('div', { class: 'note' });
    const updateCount = () => {
      const pages = new Set(items.map((i) => i.page)).size;
      count.textContent = items.length
        ? `${items.length} item${items.length === 1 ? '' : 's'} on ${pages} page${pages === 1 ? '' : 's'}. Drag to move, use the corner to resize.`
        : 'Nothing placed yet. Add a signature or text, then drag it where it belongs.';
      saveBtn.disabled = !items.length;
    };

    const saveBtn = saveButton('Save signed PDF', async () => {
      try {
        const out = await ctx.busy('Signing…', () => stampItems(file.bytes, items));
        await ctx.saveFile(out, `${baseName(file.name)}-signed.pdf`);
      } catch (err) { ctx.reportError(err); }
    });

    fill(panel, panelHead(sign), filePicker(ctx), h('div', { class: 'sign-layout' },
      stageWrap,
      h('div', { class: 'side-col' },
        h('h3', {}, 'Your signature'), sigBody,
        h('h3', {}, 'Text'),
        h('div', { class: 'row' }, field('Text', textIn), field('Size', sizeIn)),
        h('div', { class: 'actions' },
          h('button', { class: 'btn btn-small', onclick: () => { addText(textIn.value.trim()); textIn.value = ''; } }, 'Place text'),
          h('button', { class: 'btn btn-small btn-quiet', onclick: () => addText(new Date().toLocaleDateString()) }, "Add today's date")),
        count, h('div', { class: 'actions' }, saveBtn))));
    updateCount();
    await drawPage();
  },
};
