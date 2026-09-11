// Parallax hackathon deck generator (pptxgenjs). 10 slides, 16:9 (10" x 5.625").
const pptxgen = require('pptxgenjs');
const sharp = require('sharp');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const Lu = require('react-icons/lu');
const fs = require('fs');
const path = require('path');

const REPO = '/Users/moorthy/Downloads/Projects/Data&AI Hackathon/parallax';
const ASSETS = path.join(__dirname, 'assets');
const OUT_DIR = path.join(REPO, 'deck');
const OUT = path.join(OUT_DIR, 'Parallax.pptx');
const SHOT = (f) => path.join(REPO, 'docs/assets/screenshots', f);
const BRAND = (f) => path.join(REPO, 'docs/assets', f);

const C = {
  BG: '07090F', INDIGO: '6366F1', INDIGO_L: 'A5B4FC', CYAN: '22D3EE', CYAN_L: '67E8F9',
  TEXT: 'E6E9F2', MUTED: '9AA3B8', DIM: '5B6478', CARD: '0E1322', CARD2: '131B2E',
  BORDER: '1F2740', GREEN: '34D399', AMBER: 'FBBF24', RED: 'F87171', INK: '07090F',
};
const FONT = 'Helvetica';
const MONO = 'Menlo';
const FOOTER = 'Parallax · Data & AI Hackathon SF · 2026';
const TOTAL = 10;

const pres = new pptxgen();
pres.layout = 'LAYOUT_16x9';
pres.author = 'Moorthy (vnmoorthy)';
pres.company = 'Parallax';
pres.title = 'Parallax · Many agents. Many branches. One answer.';
pres.subject = 'Data & AI Hackathon SF 2026 pitch deck';

// ---------- helpers ----------
const iconCache = new Map();
async function iconData(name, color, px = 256) {
  const key = `${name}-${color}-${px}`;
  if (iconCache.has(key)) return iconCache.get(key);
  const Comp = Lu[name];
  if (!Comp) throw new Error('missing icon ' + name);
  let svg = renderToStaticMarkup(React.createElement(Comp, { size: px, strokeWidth: 1.75 }));
  svg = svg.replace(/currentColor/g, '#' + color);
  const buf = await sharp(Buffer.from(svg)).png().toBuffer();
  const data = 'image/png;base64,' + buf.toString('base64');
  iconCache.set(key, data);
  return data;
}
const NOLINE = () => ({ color: C.BG, transparency: 100, width: 0.1 });
const NOFILL = () => ({ color: C.BG, transparency: 100 });

function text(slide, str, o) {
  slide.addText(str, Object.assign({ fontFace: FONT, color: C.TEXT, margin: 0, isTextBox: true, valign: 'top', fontSize: 11 }, o));
}
function card(slide, x, y, w, h, o = {}) {
  slide.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x, y, w, h, fill: { color: o.fill || C.CARD, transparency: o.ft || 0 },
    line: { color: o.line || C.BORDER, width: o.lw || 0.75, transparency: o.lt || 0 }, rectRadius: o.r == null ? 0.08 : o.r,
  });
}
function outline(slide, x, y, w, h, color, o = {}) {
  slide.addShape(o.round ? pres.shapes.ROUNDED_RECTANGLE : pres.shapes.RECTANGLE, {
    x, y, w, h, fill: NOFILL(), line: { color, width: o.lw || 1.25, dashType: o.dash || 'solid', transparency: o.lt || 0 }, rectRadius: o.round ? 0.06 : undefined,
  });
}
function line(slide, x1, y1, x2, y2, o = {}) {
  const x = Math.min(x1, x2), y = Math.min(y1, y2), w = Math.abs(x2 - x1), h = Math.abs(y2 - y1);
  const opts = { x, y, w, h, line: { color: o.color || C.CYAN, width: o.width || 1.25, dashType: o.dash || 'solid', transparency: o.lt || 0 } };
  if (o.arrow) opts.line.endArrowType = 'triangle';
  if (x1 > x2) opts.flipH = true;
  if (y1 > y2) opts.flipV = true;
  slide.addShape(pres.shapes.LINE, opts);
}
function oval(slide, cx, cy, d, o = {}) {
  slide.addShape(pres.shapes.OVAL, {
    x: cx - d / 2, y: cy - d / 2, w: d, h: d,
    fill: o.fill ? { color: o.fill, transparency: o.ft || 0 } : NOFILL(),
    line: o.line ? { color: o.line, width: o.lw || 1, transparency: o.lt || 0 } : NOLINE(),
  });
}
function dbNode(slide, cx, cy, r, color) {
  oval(slide, cx, cy, r * 3.2, { fill: color, ft: 90 });
  oval(slide, cx, cy, r * 2, { fill: C.BG, line: color, lw: 1.5 });
  oval(slide, cx, cy, r * 0.84, { fill: color });
}
function chip(slide, x, y, str, color, o = {}) {
  const w = o.w || (str.length * (o.mono ? 0.075 : 0.066) + 0.3);
  const h = o.h || 0.28;
  slide.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y, w, h, fill: { color, transparency: 88 }, line: { color, transparency: 45, width: 0.75 }, rectRadius: 0.14 });
  text(slide, str, { x, y, w, h, fontSize: o.fs || 8.5, bold: true, color, align: 'center', valign: 'middle', fontFace: o.mono ? MONO : FONT });
  return w;
}
function numCircle(slide, cx, cy, d, n, color = C.CYAN) {
  oval(slide, cx, cy, d, { fill: color });
  text(slide, String(n), { x: cx - d / 2, y: cy - d / 2, w: d, h: d, fontSize: Math.round(d * 30), bold: true, color: C.INK, align: 'center', valign: 'middle' });
}
async function iconCircle(slide, x, y, d, name, color) {
  oval(slide, x + d / 2, y + d / 2, d, { fill: color, ft: 86, line: color, lt: 60, lw: 0.75 });
  const s = d * 0.5;
  slide.addImage({ data: await iconData(name, color), x: x + (d - s) / 2, y: y + (d - s) / 2, w: s, h: s });
}
async function icon(slide, x, y, s, name, color) {
  slide.addImage({ data: await iconData(name, color), x, y, w: s, h: s });
}
function mono(slide, str, o) {
  text(slide, str, Object.assign({ fontFace: MONO, fontSize: 8.5, color: C.CYAN_L }, o));
}
function header(slide, eyebrow, title, n, o = {}) {
  slide.background = { path: path.join(ASSETS, o.title ? 'flat-bg-title.png' : 'flat-bg.png') };
  if (eyebrow) text(slide, eyebrow, { x: 0.5, y: 0.34, w: 9, h: 0.22, fontSize: 9.5, bold: true, color: C.CYAN, charSpacing: 2 });
  if (title) text(slide, title, { x: 0.5, y: 0.56, w: 9, h: 0.5, fontSize: 26, bold: true, color: C.TEXT });
  text(slide, FOOTER, { x: 0.5, y: 5.28, w: 6, h: 0.22, fontSize: 8.5, color: C.DIM });
  text(slide, `${n} / ${TOTAL}`, { x: 8.5, y: 5.28, w: 1.0, h: 0.22, fontSize: 8.5, color: C.DIM, align: 'right' });
}
function quote(slide, str) {
  text(slide, str, { x: 0.5, y: 1.1, w: 9, h: 0.28, fontSize: 10.5, italic: true, color: C.MUTED });
}
function codeChip(slide, x, y, str, w) {
  const ww = w || (str.length * 0.074 + 0.36);
  slide.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y, w: ww, h: 0.26, fill: { color: C.CARD2 }, line: { color: C.BORDER, width: 0.75 }, rectRadius: 0.05 });
  mono(slide, str, { x: x + 0.12, y, w: ww - 0.2, h: 0.26, fontSize: 8.5, color: C.CYAN_L, valign: 'middle' });
  return ww;
}
function bigStat(slide, x, y, w, h, value, label, color, o = {}) {
  card(slide, x, y, w, h);
  text(slide, value, { x: x + 0.15, y: y + 0.12, w: w - 0.3, h: h * 0.58, fontSize: o.fs || 30, bold: true, color, valign: 'middle', wrap: false });
  text(slide, label, { x: x + 0.15, y: y + h - 0.42, w: w - 0.3, h: 0.34, fontSize: 9, color: C.MUTED, valign: 'top' });
}

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  // brand art without the strapline row at the bottom of the banner crop
  const forkart = path.join(ASSETS, 'forkart2.png');
  await sharp(path.join(ASSETS, 'forkart.png')).extract({ left: 0, top: 0, width: 1560, height: 870 }).png().toFile(forkart);

  // =============== 1. TITLE ===============
  {
    const s = pres.addSlide();
    header(s, null, null, 1, { title: true });
    s.addImage({ path: forkart, x: 5.25, y: 0.65, w: 4.6, h: 4.6 * 870 / 1560 });
    s.addImage({ path: path.join(ASSETS, 'wordmark.png'), x: 0.58, y: 1.0, w: 3.5, h: 3.5 * 300 / 990 });
    text(s, [{ text: 'Many agents. Many branches.', options: { breakLine: true } }, { text: 'One answer.' }], { x: 0.62, y: 2.16, w: 4.5, h: 0.75, fontSize: 20, bold: true });
    text(s, 'A multi-agent data-analysis swarm. Fork a database per hypothesis and explore them all at once.', { x: 0.62, y: 2.98, w: 4.5, h: 0.55, fontSize: 12, color: C.MUTED });
    s.addImage({ path: path.join(ASSETS, 'pills.png'), x: 0.62, y: 3.58, w: 3.6, h: 3.6 * 84 / 1180 });
    text(s, 'Data & AI Hackathon 2026', { x: 0.62, y: 4.0, w: 4.5, h: 0.3, fontSize: 12.5, bold: true });
    text(s, 'Real job. Real AI. Real scale.', { x: 0.62, y: 4.28, w: 4.5, h: 0.26, fontSize: 10.5, italic: true, color: C.CYAN_L });
    text(s, 'AWS Builder Loft, San Francisco · Sept 11 · presented by Devnovate', { x: 0.62, y: 4.53, w: 4.6, h: 0.26, fontSize: 10.5, color: C.MUTED });
    text(s, [
      { text: 'Moorthy', options: { bold: true, color: C.TEXT } },
      { text: '  ·  github.com/vnmoorthy/parallax', options: { color: C.CYAN } },
    ], { x: 0.62, y: 4.78, w: 4.6, h: 0.26, fontSize: 10.5 });
    text(s, 'RocketRide · Hotdata · Cognee · Snyk', { x: 5.25, y: 4.78, w: 4.6, h: 0.26, fontSize: 9.5, color: C.DIM, align: 'right' });
    s.addNotes('Hook (20 s). Every analytics team has the same bottleneck: one analyst, one query at a time, one hypothesis at a time. Parallax removes it: fork the database once per hypothesis, let a swarm of agents explore all of them at once, write one cited answer, remember what it learned.');
  }

  // =============== 2. PROBLEM ===============
  {
    const s = pres.addSlide();
    header(s, '01 · THE PROBLEM · A REAL JOB', 'One analyst. One query. One hypothesis at a time.', 2);
    // quote card
    card(s, 0.5, 1.28, 6.3, 1.2);
    await icon(s, 0.72, 1.47, 0.34, 'LuMessageSquare', C.CYAN);
    text(s, '“Why are customers churning and where is revenue at risk?”', { x: 1.2, y: 1.42, w: 5.4, h: 0.6, fontSize: 15, italic: true, color: C.TEXT });
    text(s, '→ eight questions', { x: 1.2, y: 2.08, w: 5.4, h: 0.3, fontSize: 11.5, bold: true, color: C.CYAN });
    // serial chain
    const items = [['plan', 'LuLayers'], ['region', 'LuGlobe'], ['feedback', 'LuMessageSquare'], ['idle days', 'LuHourglass'], ['NPS', 'LuGauge']];
    const bw = 0.86, gap = 0.3, by = 3.0, bh = 0.86;
    for (let i = 0; i < items.length; i++) {
      const bx = 0.5 + i * (bw + gap);
      card(s, bx, by, bw, bh, { fill: C.CARD2 });
      await icon(s, bx + bw / 2 - 0.13, by + 0.14, 0.26, items[i][1], C.INDIGO_L);
      text(s, items[i][0], { x: bx, y: by + 0.48, w: bw, h: 0.3, fontSize: 10, color: C.TEXT, align: 'center' });
      const nx = bx + bw + gap;
      line(s, bx + bw + 0.05, by + bh / 2, nx - 0.05, by + bh / 2, { color: C.DIM, width: 1, arrow: true });
    }
    const gx = 0.5 + items.length * (bw + gap);
    outline(s, gx, by, 0.5, bh, C.BORDER, { round: true, dash: 'dash', lw: 1 });
    text(s, '…', { x: gx, y: by, w: 0.5, h: bh, fontSize: 16, color: C.DIM, align: 'center', valign: 'middle' });
    // serial timeline bar: 8 segments = 8 hypotheses, one after another
    await icon(s, 0.5, 4.5, 0.3, 'LuUser', C.MUTED);
    const segs = 8, tx = 0.95, tw = 5.15, ty = 4.58, th = 0.16;
    for (let i = 0; i < segs; i++) {
      const w = tw / segs;
      s.addShape(pres.shapes.RECTANGLE, { x: tx + i * w, y: ty, w: w - 0.03, h: th, fill: { color: i % 2 ? C.INDIGO : C.CYAN, transparency: 35 + (i * 4) }, line: NOLINE() });
    }
    text(s, '≈ a day', { x: 6.15, y: 4.5, w: 0.7, h: 0.3, fontSize: 9.5, color: C.MUTED, valign: 'middle' });
    // right column
    const rows = [['LuClock', 'Serial hypotheses', C.CYAN], ['LuTriangleAlert', 'Agents collide on one DB', C.AMBER], ['LuEraser', 'Insights don’t persist', C.INDIGO_L]];
    for (let i = 0; i < rows.length; i++) {
      const y = 1.3 + i * 1.15;
      await iconCircle(s, 7.05, y, 0.52, rows[i][0], rows[i][2]);
      text(s, rows[i][1], { x: 7.7, y: y + 0.02, w: 1.85, h: 0.6, fontSize: 13, bold: true, color: C.TEXT });
    }
    s.addNotes('The demo question is really eight questions: by plan, by region, feedback text, idle days, NPS vs tickets, MRR at risk. One analyst does them serially, about a day. Pointing eight agents at one shared database does not help: temp tables and indexes collide and nobody can reproduce what any agent saw. And when the analyst is done, the insight lives in a slide, not in the system.');
  }

  // =============== 3. THE IDEA ===============
  {
    const s = pres.addSlide();
    header(s, '02 · THE IDEA', 'Fork the database per hypothesis.', 3);
    const cx = [1.55, 3.85, 6.15, 8.45];
    // strip: root -> forks -> report -> memory (+ dashed recall loop back to the root)
    dbNode(s, cx[0], 1.95, 0.2, C.CYAN);
    const fy = [1.42, 1.77, 2.13, 2.48], fc = [C.INDIGO_L, C.CYAN, C.GREEN, C.AMBER];
    for (let i = 0; i < 4; i++) {
      line(s, cx[0] + 0.22, 1.95, cx[1] - 0.13, fy[i], { color: C.CYAN, width: 1.25, lt: 25 });
      line(s, cx[1] + 0.13, fy[i], cx[2] - 0.7, 1.95, { color: C.AMBER, width: 1, lt: 45 });
      dbNode(s, cx[1], fy[i], 0.1, fc[i]);
    }
    card(s, cx[2] - 0.7, 1.62, 1.4, 0.66, { fill: C.CARD2, line: C.AMBER, lw: 1 });
    await icon(s, cx[2] - 0.17, 1.78, 0.34, 'LuFileText', C.AMBER);
    line(s, cx[2] + 0.7, 1.95, cx[3] - 0.36, 1.95, { color: C.GREEN, width: 1.25, arrow: true });
    oval(s, cx[3], 1.95, 0.7, { fill: C.CARD2, line: C.GREEN, lw: 1 });
    await icon(s, cx[3] - 0.17, 1.78, 0.34, 'LuBrain', C.GREEN);
    line(s, cx[3], 1.6, cx[3], 1.22, { color: C.GREEN, width: 1, dash: 'dash', lt: 20 });
    line(s, cx[3], 1.22, cx[0], 1.22, { color: C.GREEN, width: 1, dash: 'dash', lt: 20 });
    line(s, cx[0], 1.22, cx[0], 1.66, { color: C.GREEN, width: 1, dash: 'dash', lt: 20, arrow: true });
    mono(s, 'recall', { x: 4.7, y: 1.05, w: 0.9, h: 0.2, fontSize: 8, color: C.GREEN, align: 'center' });
    // four step cards
    const steps = [
      ['Fork', 'one root, one fork per hypothesis', 'LuGitFork', C.CYAN],
      ['Explore', 'N agents at once: SQL · BM25 · vector', 'LuZap', C.INDIGO_L],
      ['Synthesize', 'one report, every claim cites [branch:id]', 'LuFileText', C.AMBER],
      ['Remember', 'Cognee memory primes the next plan', 'LuBrain', C.GREEN],
    ];
    for (let i = 0; i < 4; i++) {
      const x = 0.5 + i * 2.3, y = 2.95, w = 2.1, h = 2.05;
      card(s, x, y, w, h);
      numCircle(s, x + 0.38, y + 0.38, 0.36, i + 1, steps[i][3]);
      await iconCircle(s, x + w - 0.72, y + 0.18, 0.52, steps[i][2], steps[i][3]);
      text(s, steps[i][0], { x: x + 0.2, y: y + 0.82, w: w - 0.4, h: 0.36, fontSize: 16, bold: true });
      text(s, steps[i][1], { x: x + 0.2, y: y + 1.22, w: w - 0.4, h: 0.7, fontSize: 10.5, color: C.MUTED });
    }
    s.addNotes('Fork the database per hypothesis. One root database per run; the planner, primed by memory, proposes N hypotheses; the root is forked once per hypothesis. N agents run concurrently, each with its own snapshot, indexes, scratch tables and notes. A synthesizer writes one report where every claim cites the branch and the SQL that produced it. The run is written to Cognee, and recalled before the next plan.');
  }

  // =============== 4. LIVE DEMO ===============
  {
    const s = pres.addSlide();
    header(s, '03 · LIVE DEMO', 'Mission Control: watch the swarm run.', 4);
    const ix = 0.5, iy = 1.15, iw = 6.24, ih = 3.9, kx = iw / 1600, ky = ih / 1000;
    s.addImage({ path: SHOT('mission-control-saas.png'), x: ix, y: iy, w: iw, h: ih });
    outline(s, ix, iy, iw, ih, C.BORDER, { lw: 0.75 });
    const R = (px0, py0, px1, py1) => [ix + px0 * kx, iy + py0 * ky, (px1 - px0) * kx, (py1 - py0) * ky];
    const regions = [
      { r: R(192, 228, 1408, 303), c: C.CYAN, n: 1, mark: 'tl', title: 'Metrics strip', sub: 'peak concurrency, p50 / p95' },
      { r: R(192, 318, 472, 1000), c: C.INDIGO_L, n: 2, mark: 'tr', title: 'Lineage tree', sub: 'real forks from GET /lineage' },
      { r: R(488, 318, 940, 1000), c: C.GREEN, n: 3, mark: 'tr', title: 'Agent cards', sub: 'think → SQL → observe → finding' },
      { r: R(958, 318, 1408, 1000), c: C.AMBER, n: 4, mark: 'tr', title: 'Cited report', sub: '[branch:id] chips jump to evidence' },
    ];
    for (const g of regions) {
      const [x, y, w, h] = g.r;
      outline(s, x, y, w, h, g.c, { lw: 1.25 });
      const mx = g.mark === 'tl' ? x : x + w, my = y;
      numCircle(s, mx, my, 0.28, g.n, g.c);
    }
    for (let i = 0; i < regions.length; i++) {
      const g = regions[i], y = 1.3 + i * 0.88;
      numCircle(s, 7.12, y + 0.17, 0.34, g.n, g.c);
      text(s, g.title, { x: 7.45, y: y, w: 2.05, h: 0.3, fontSize: 12.5, bold: true });
      text(s, g.sub, { x: 7.45, y: y + 0.3, w: 2.05, h: 0.5, fontSize: 9.5, color: C.MUTED });
    }
    text(s, 'local run: 5 agents, Ollama', { x: 6.95, y: 4.78, w: 2.55, h: 0.26, fontSize: 9, color: C.DIM });
    s.addNotes('Switch to the live app here. Status stepper provision -> plan -> explore -> synthesize -> done. Metrics strip: databases, forks, queries, peak concurrency, p50/p95, LLM calls by provider, time to first finding. Lineage tree on the left is the lineage API response, one node per real fork. Agent cards in the middle: think, SQL / BM25 / vector, observe, up to four steps, then a finding with a confidence score. Report on the right with [branch:id] chips that highlight the branch that produced the claim.');
  }

  // =============== 5. ARCHITECTURE ===============
  {
    const s = pres.addSlide();
    header(s, '04 · ARCHITECTURE', 'Every cloud piece has a zero-key local twin.', 5);
    s.addImage({ path: BRAND('architecture.png'), x: 0.5, y: 1.15, w: 6.1, h: 6.1 * 1000 / 1600 });
    outline(s, 0.5, 1.15, 6.1, 6.1 * 1000 / 1600, C.BORDER, { lw: 0.75 });
    const rows = [
      ['LuMonitor', C.INDIGO_L, 'SSE-driven UI', 'Next.js ⇄ FastAPI, replay then live'],
      ['LuDatabase', C.CYAN, 'DataEngine protocol', 'Hotdata over HTTP · DuckDB locally'],
      ['LuShuffle', C.AMBER, 'LLM router', 'rocketride → anthropic → ollama, per call'],
      ['LuBrain', C.GREEN, 'Memory protocol', 'Cognee graph · local JSON fallback'],
    ];
    for (let i = 0; i < rows.length; i++) {
      const y = 1.22 + i * 0.95;
      await iconCircle(s, 6.85, y, 0.48, rows[i][0], rows[i][1]);
      text(s, rows[i][2], { x: 7.45, y: y - 0.02, w: 2.1, h: 0.3, fontSize: 12, bold: true });
      text(s, rows[i][3], { x: 7.45, y: y + 0.28, w: 2.1, h: 0.55, fontSize: 9.5, color: C.MUTED });
    }
    s.addNotes('Next.js Mission Control talks to a FastAPI orchestrator; the UI is driven by an SSE stream that replays a per-run buffer and then streams live, so a refresh or a shared link rebuilds the same Mission Control. The orchestrator only talks to a DataEngine protocol: Hotdata over HTTP or DuckDB files locally. LLM calls go through a router with a per-call fallback chain and provider attribution. Memory is a protocol too: Cognee graph, or local JSON.');
  }

  // =============== 6. HOTDATA ===============
  {
    const s = pres.addSlide();
    header(s, '05 · HOTDATA · BEST USE', 'Many agents, many forks, no contention.', 6);
    quote(s, '“…multiple agents or users need to search, query, or analyze data concurrently.”');
    // fork tree
    const rx = 1.35, ry = 3.25;
    const fy = [1.85, 2.55, 3.25, 3.95, 4.65];
    const approaches = [['SQL', C.INDIGO_L], ['BM25', C.CYAN], ['VECTOR', C.GREEN], ['SQL', C.INDIGO_L], ['MIXED', C.AMBER]];
    for (let i = 0; i < 5; i++) line(s, rx + 0.26, ry, 3.55 - 0.15, fy[i], { color: C.CYAN, width: 1.5, lt: 20 });
    oval(s, rx, ry, 0.24 * 3.4, { fill: C.CYAN, ft: 90 });
    oval(s, rx, ry, 0.56, { fill: C.CARD2, line: C.CYAN, lw: 1.5 });
    await icon(s, rx - 0.15, ry - 0.15, 0.3, 'LuDatabase', C.CYAN);
    for (let i = 0; i < 5; i++) {
      dbNode(s, 3.55, fy[i], 0.13, approaches[i][1]);
      chip(s, 3.9, fy[i] - 0.14, approaches[i][0], approaches[i][1], { w: 0.82 });
    }
    mono(s, 'fork · lineage · bm25_search() · vector_search()', { x: 0.5, y: 4.9, w: 5.1, h: 0.22, fontSize: 8.5 });
    // burst stats
    card(s, 5.6, 1.5, 3.9, 3.2);
    text(s, 'BURST', { x: 5.8, y: 1.62, w: 2, h: 0.2, fontSize: 8.5, bold: true, color: C.CYAN, charSpacing: 2 });
    const tiles = [['100', 'reads · 5 forks', C.TEXT], ['50', 'in-flight', C.TEXT], ['15 ms', 'p50', C.CYAN], ['30 ms', 'p95', C.CYAN]];
    for (let i = 0; i < 4; i++) {
      const tx = 5.8 + (i % 2) * 1.8, ty = 1.9 + Math.floor(i / 2) * 1.38;
      text(s, tiles[i][0], { x: tx, y: ty, w: 1.7, h: 0.7, fontSize: 34, bold: true, color: tiles[i][2], valign: 'middle' });
      text(s, tiles[i][1], { x: tx, y: ty + 0.72, w: 1.7, h: 0.3, fontSize: 9.5, color: C.MUTED });
    }
    codeChip(s, 5.6, 4.86, 'backend/app/data/hotdata.py');
    s.addNotes('Hotdata is the data plane. One root database per run, loaded with inline CSV loads; one fork per hypothesis via POST /databases/{id}/fork; the lineage tree in the UI is GET /lineage. Each branch gets a BM25 index on the text column and a vector index on a data_vec copy, created lazily because forks do not carry indexes. Agent notes are per-database context docs; findings land in a per-branch findings table. Burst mode fires 100 concurrent reads across the forks: p50 15 ms, p95 30 ms, 50 in flight, measured today.');
  }

  // =============== 7. ROCKETRIDE ===============
  {
    const s = pres.addSlide();
    header(s, '06 · ROCKETRIDE · BEST USE', 'The analyst is a pipeline. Nothing to host.', 7);
    quote(s, '“…deploy an AI pipeline without managing any infrastructure.”');
    card(s, 0.5, 1.5, 5.6, 3.2, { fill: C.CARD, ft: 40 });
    const node = (x, y, w, h, label, color, sub) => {
      card(s, x, y, w, h, { fill: C.CARD2, line: color, lw: sub ? 1.25 : 0.75 });
      mono(s, label, { x, y: sub ? y + 0.14 : y, w, h: sub ? 0.3 : h, fontSize: sub ? 9 : 8, color, bold: !!sub, align: 'center', valign: 'middle' });
      if (sub) text(s, sub, { x, y: y + 0.42, w, h: 0.28, fontSize: 9, color: C.MUTED, align: 'center' });
    };
    node(0.75, 2.05, 1.15, 0.5, 'chat_1', C.TEXT);
    node(2.45, 1.9, 1.9, 0.8, 'agent_rocketride_1', C.AMBER, 'Parallax Analyst');
    node(4.62, 2.05, 1.33, 0.5, 'response_answers_1', C.TEXT);
    line(s, 1.9, 2.3, 2.45, 2.3, { color: C.MUTED, width: 1.25, arrow: true });
    line(s, 4.35, 2.3, 4.62, 2.3, { color: C.MUTED, width: 1.25, arrow: true });
    const ctl = [[0.75, 1.2, 'llm_anthropic_1', C.INDIGO_L, 2.9], [2.05, 1.25, 'memory_internal_1', C.MUTED, 3.2], [3.4, 1.15, 'db_hotdata_1', C.CYAN, 3.6], [4.65, 1.3, 'tool_cognee_1', C.GREEN, 3.9]];
    for (const [x, w, label, color, ax] of ctl) {
      node(x, 3.6, w, 0.5, label, color);
      line(s, x + w / 2, 3.6, ax, 2.7, { color, width: 1, dash: 'dash', lt: 20, arrow: true });
    }
    mono(s, 'pipelines/parallax-analyst.pipe', { x: 0.7, y: 4.4, w: 3, h: 0.2, fontSize: 8, color: C.DIM });
    // right cards
    card(s, 6.35, 1.5, 3.15, 1.5);
    await iconCircle(s, 6.55, 1.68, 0.46, 'LuArrowRightLeft', C.INDIGO_L);
    text(s, 'parallax-llm.pipe', { x: 7.12, y: 1.66, w: 2.3, h: 0.3, fontSize: 12, bold: true });
    text(s, 'every LLM call', { x: 7.12, y: 1.95, w: 2.3, h: 0.25, fontSize: 9.5, color: C.MUTED });
    mono(s, 'chat → llm_anthropic → response_answers', { x: 6.55, y: 2.48, w: 2.85, h: 0.3, fontSize: 8.5 });
    card(s, 6.35, 3.2, 3.15, 1.5);
    await iconCircle(s, 6.55, 3.38, 0.46, 'LuCloud', C.AMBER);
    text(s, 'RocketRide Cloud', { x: 7.12, y: 3.36, w: 2.3, h: 0.3, fontSize: 12, bold: true });
    oval(s, 7.2, 3.78, 0.1, { fill: C.GREEN });
    text(s, 'deployable', { x: 7.32, y: 3.65, w: 2.1, h: 0.25, fontSize: 9.5, color: C.MUTED });
    mono(s, 'ROCKETRIDE_URI=https://api.rocketride.ai', { x: 6.55, y: 4.18, w: 2.85, h: 0.3, fontSize: 8.5 });
    codeChip(s, 6.35, 4.86, 'backend/app/llm/rocketride_llm.py');
    s.addNotes('Two pipes. parallax-llm.pipe is the gateway: every planner, agent and synthesizer call the backend makes goes through it with the rocketride SDK: use() once, chat() per call. parallax-analyst.pipe is the deployable analyst: an agent_rocketride node controlling Claude, internal memory, a db_hotdata tool with execute allowed, and a tool_cognee node doing GRAPH_COMPLETION on the parallax dataset. Point ROCKETRIDE_URI at api.rocketride.ai and it runs on Cloud; the same file runs on the local Docker engine. Three pipes, all validated by the engine.');
  }

  // =============== 8. COGNEE + SNYK ===============
  {
    const s = pres.addSlide();
    header(s, '07 · COGNEE · BEST USE  +  SNYK', 'Cognee remembers. Snyk watches.', 8);
    quote(s, '“Build persistent memory and context for your AI agents.”');
    const mw = 5.3, mh = 5.3 * 650 / 1280;
    s.addImage({ path: path.join(ASSETS, 'memory-crop.png'), x: 0.5, y: 1.5, w: mw, h: mh });
    outline(s, 0.5, 1.5, mw, mh, C.BORDER, { lw: 0.75 });
    // recall -> plan -> remember loop
    const pills = [['recall', C.GREEN, 0.5], ['plan', C.INDIGO_L, 2.55], ['remember', C.GREEN, 4.6]];
    for (const [t, c, x] of pills) chip(s, x, 4.42, t, c, { w: 1.2, h: 0.34, fs: 10 });
    line(s, 1.75, 4.59, 2.5, 4.59, { color: C.MUTED, width: 1.25, arrow: true });
    line(s, 3.8, 4.59, 4.55, 4.59, { color: C.MUTED, width: 1.25, arrow: true });
    line(s, 5.2, 4.78, 5.2, 5.0, { color: C.GREEN, width: 1, dash: 'dash', lt: 20 });
    line(s, 5.2, 5.0, 1.1, 5.0, { color: C.GREEN, width: 1, dash: 'dash', lt: 20 });
    line(s, 1.1, 5.0, 1.1, 4.78, { color: C.GREEN, width: 1, dash: 'dash', lt: 20, arrow: true });
    // cognee card
    card(s, 6.1, 1.5, 3.4, 1.7);
    await iconCircle(s, 6.3, 1.68, 0.46, 'LuBrain', C.GREEN);
    text(s, 'Primes the next plan', { x: 6.88, y: 1.66, w: 2.5, h: 0.3, fontSize: 12, bold: true });
    mono(s, 'add → cognify → search(GRAPH_COMPLETION)', { x: 6.3, y: 2.26, w: 3.05, h: 0.25, fontSize: 8.5 });
    // tiny graph glyph
    const gn = [[6.55, 2.85], [7.05, 2.68], [7.5, 2.95], [7.95, 2.7], [8.45, 2.92], [8.95, 2.72]];
    const ge = [[0, 1], [1, 2], [2, 3], [1, 3], [3, 4], [4, 5], [2, 4]];
    for (const [a, b] of ge) line(s, gn[a][0], gn[a][1], gn[b][0], gn[b][1], { color: C.GREEN, width: 0.75, lt: 45 });
    gn.forEach(([x, y], i) => oval(s, x, y, i === 1 ? 0.16 : 0.11, { fill: i === 1 ? C.GREEN : C.CARD2, line: C.GREEN, lw: 1 }));
    // snyk card
    card(s, 6.1, 3.4, 3.4, 1.3);
    await iconCircle(s, 6.3, 3.58, 0.46, 'LuShieldCheck', C.INDIGO_L);
    text(s, 'Snyk on every push and PR', { x: 6.88, y: 3.56, w: 2.5, h: 0.3, fontSize: 12, bold: true });
    oval(s, 6.96, 3.98, 0.1, { fill: C.CYAN });
    text(s, 'read-only SQL guard', { x: 7.1, y: 3.85, w: 2.3, h: 0.25, fontSize: 9.5, color: C.MUTED });
    mono(s, '.github/workflows/ci.yml', { x: 6.3, y: 4.24, w: 3.05, h: 0.25, fontSize: 8.5, color: C.DIM });
    codeChip(s, 6.1, 4.86, 'backend/app/memory/cognee_memory.py');
    s.addNotes('After every run, the question and findings go to Cognee with cognee.add plus cognify in a background task, node sets per dataset and per run. Before every plan, cognee.search with GRAPH_COMPLETION; the hits are streamed as run.recalled and injected into the planner prompt, so the second run on a dataset starts from what the first one learned. The /memory page shows the graph and a recall box. Snyk runs snyk test and snyk code test on every push and PR; SQL is read-only by construction and by an orchestrator guard: SELECT or WITH only, LIMIT injected; forks expire after 24 hours.');
  }

  // =============== 9. REAL SCALE ===============
  {
    const s = pres.addSlide();
    header(s, '08 · REAL SCALE · MEASURED IN LOCAL RUNS TODAY', 'Measured, not claimed.', 9);
    const tiles = [
      ['15 ms', 'p50 · burst', C.CYAN, 24], ['30 ms', 'p95 · burst', C.CYAN, 24], ['110', 'queries · 4 agents', C.TEXT, 30],
      ['1.2 s', 'first finding', C.CYAN, 30], ['65', 'tests passing', C.TEXT, 30], ['6,102', 'real Airbnb listings', C.TEXT, 30],
    ];
    for (let i = 0; i < 6; i++) {
      const x = 0.5 + (i % 3) * 1.625, y = 1.2 + Math.floor(i / 3) * 1.3;
      bigStat(s, x, y, 1.45, 1.15, tiles[i][0], tiles[i][1], tiles[i][2], { fs: tiles[i][3] });
    }
    card(s, 0.5, 3.9, 4.7, 1.15);
    await iconCircle(s, 0.7, 4.08, 0.46, 'LuPlugZap', C.CYAN);
    text(s, 'Zero-key mode: DuckDB + Ollama', { x: 1.3, y: 4.06, w: 3.8, h: 0.3, fontSize: 12, bold: true });
    mono(s, 'Hotdata→DuckDB · RocketRide→Anthropic→Ollama→fake · Cognee→JSON', { x: 0.7, y: 4.58, w: 4.35, h: 0.3, fontSize: 8.5 });
    // next
    card(s, 5.5, 1.2, 4.0, 3.85);
    text(s, 'NEXT', { x: 5.7, y: 1.36, w: 2, h: 0.2, fontSize: 8.5, bold: true, color: C.CYAN, charSpacing: 2 });
    const next = [['LuGitMerge', C.INDIGO_L, 'Merge branches'], ['LuBoxes', C.CYAN, 'Bulk 10k tenant DBs'], ['LuMousePointerClick', C.AMBER, 'One-click deploy']];
    for (let i = 0; i < 3; i++) {
      const y = 1.8 + i * 1.05;
      await iconCircle(s, 5.7, y, 0.52, next[i][0], next[i][1]);
      text(s, next[i][2], { x: 6.35, y: y + 0.1, w: 3.0, h: 0.35, fontSize: 13, bold: true });
    }
    s.addNotes('Numbers, not adjectives, all from real local runs today. A burst of 100 concurrent reads across 5 forked databases: p50 15 ms, p95 30 ms, 50 in flight. A 4-agent run made 110 queries with peak concurrency 50. Time to first finding 1.2 s after moving embedding off the critical path. 65 backend tests pass. Three bundled datasets: 6,000 SaaS customers, 8,000 e-commerce orders, 6,102 real SF Airbnb listings. Three RocketRide pipelines validated by the engine. Zero-key mode runs the identical code path offline on DuckDB and Ollama. Next: merge branches, bulk-create 10k tenant databases, a deploy button in the Pipeline tab.');
  }

  // =============== 10. CLOSE ===============
  {
    const s = pres.addSlide();
    header(s, '09 · TRY IT', 'Try it in three commands.', 10, { title: true });
    card(s, 0.5, 1.3, 5.3, 2.0, { fill: '0A0E18' });
    [C.RED, C.AMBER, C.GREEN].forEach((c, i) => oval(s, 0.78 + i * 0.18, 1.5, 0.1, { fill: c }));
    const lines = [
      [{ text: '$ ', options: { color: C.DIM } }, { text: 'git clone https://github.com/vnmoorthy/parallax', options: { color: C.TEXT } }],
      [{ text: '$ ', options: { color: C.DIM } }, { text: 'cd parallax && make setup', options: { color: C.TEXT } }],
      [{ text: '$ ', options: { color: C.DIM } }, { text: 'make demo', options: { color: C.TEXT } }, { text: '     # zero keys: DuckDB + fake LLM', options: { color: C.DIM } }],
      [{ text: '→ http://localhost:3000', options: { color: C.CYAN, bold: true } }],
    ];
    lines.forEach((runs, i) => s.addText(runs, { x: 0.78, y: 1.78 + i * 0.34, w: 4.9, h: 0.3, fontFace: MONO, fontSize: 11, margin: 0, isTextBox: true, valign: 'middle' }));
    s.addImage({ path: path.join(ASSETS, 'wordmark.png'), x: 0.5, y: 3.6, w: 2.2, h: 2.2 * 300 / 990 });
    text(s, 'Many agents. Many branches. One answer.', { x: 0.5, y: 4.34, w: 5.3, h: 0.3, fontSize: 13, bold: true });
    text(s, 'Built in 8 hours at the Data & AI Hackathon.', { x: 0.5, y: 4.68, w: 5.3, h: 0.3, fontSize: 10.5, color: C.MUTED });
    // right card
    card(s, 6.1, 1.3, 3.4, 3.5);
    await iconCircle(s, 6.35, 1.52, 0.5, 'LuGithub', C.INDIGO_L);
    text(s, 'Moorthy', { x: 7.0, y: 1.52, w: 2.3, h: 0.3, fontSize: 14, bold: true });
    text(s, 'github.com/vnmoorthy', { x: 7.0, y: 1.82, w: 2.3, h: 0.25, fontSize: 10, color: C.CYAN });
    mono(s, 'github.com/vnmoorthy/parallax', { x: 6.35, y: 2.32, w: 3.0, h: 0.3, fontSize: 10, color: C.TEXT });
    text(s, 'Thanks to', { x: 6.35, y: 2.9, w: 3, h: 0.25, fontSize: 9.5, color: C.DIM });
    s.addImage({ path: path.join(ASSETS, 'pills.png'), x: 6.35, y: 3.18, w: 3.0, h: 3.0 * 84 / 1180 });
    text(s, 'Devnovate · AWS Builder Loft, San Francisco', { x: 6.35, y: 3.55, w: 3.0, h: 0.3, fontSize: 10, color: C.MUTED });
    text(s, 'Real job. Real AI. Real scale.', { x: 6.35, y: 4.25, w: 3, h: 0.3, fontSize: 11, italic: true, color: C.CYAN_L });
    s.addNotes('Close (15 s). Clone, make setup, make demo: no keys, DuckDB forks and a fake LLM, same UI, same events. Add keys and the same code runs on Hotdata, RocketRide Cloud and Cognee. Repo: github.com/vnmoorthy/parallax. Thanks to RocketRide, Hotdata, Cognee, Snyk, Devnovate and AWS Builder Loft. Parallax: many agents, many branches, one answer.');
  }

  await pres.writeFile({ fileName: OUT });
  console.log('wrote', OUT);
})().catch((e) => { console.error(e); process.exit(1); });
