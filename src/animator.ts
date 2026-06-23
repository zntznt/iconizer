import type { Cell } from './sample.ts';
import { poolCells } from './sample.ts';
import type { Settings } from './settings.ts';
import type { ParsedSvg } from './parseSvg.ts';
import { transformColor, adjustColor, adjustActive, schemeQuantizes, bayer, overlayColor, type RGB } from './color.ts';
import { cellDelay, hash01 } from './motion.ts';

// --- Canvas motion engine (C2) -------------------------------------------------
// CSS-animating thousands of SVG nodes crawls (~7fps at 100 cols). This draws the
// SAME look on a <canvas> sprite engine: bake each icon ONCE as a white alpha
// sprite, then per frame, per cell: setTransform(pos · rotation · scale) ->
// drawImage(tinted sprite). A per-cell tint cache (quantized colour -> pre-tinted
// sprite) keeps it to ~7ms/frame at 100 cols = butter at any column count.
//
// SOLID mosaics only. Layered/CMY/anaglyph keep the CSS path (their per-cell
// blend stacks don't reduce to a single tinted sprite); they're the rare/heavy
// case, already gated by the heavy-combo warning.
//
// FIDELITY: reproduces render()'s per-cell math (pool, scale-by-brightness,
// icon-pick, static rotation, fade, colour/scheme/overlay/dither) plus motion.ts
// /export.ts's motion transforms (same ease curve, same per-cell stagger delay,
// same pivots). Pixels match the static SVG; only the engine differs.

const CELL = 16;                 // matches render.ts internal cell size
const SPRITE = 64;               // baked icon sprite resolution (px); crisp when scaled
const ease = (x: number) => (x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2);

type Placement = {
  cx: number; cy: number;        // cell centre in canvas px
  size: number;                  // icon draw size in canvas px (square)
  icon: number;                  // which baked icon sprite (index)
  baseDeg: number;               // static rotation (rotate setting), degrees
  opacity: number;               // static fade-by-brightness
  r: number; g: number; b: number; // tint colour (0-255)
  delay: number;                 // per-cell animation-delay (s)
};

let raf = 0;
let running = false;
let paused = false;
const reduceMq = window.matchMedia('(prefers-reduced-motion: reduce)');

let canvas: HTMLCanvasElement | null = null;
let host: HTMLElement | null = null;
let svgEl: SVGElement | null = null;
let resizeObs: ResizeObserver | null = null;
let lastBoxW = 0, lastBoxH = 0;

let placements: Placement[] = [];
let period = 1;
let motion: Settings['motion'] = 'none';
let bg = '#000';
let t0 = 0;

// One white-alpha sprite per uploaded icon (baked once). Index = icon index.
let iconSprites: HTMLCanvasElement[] = [];
// quantized-colour -> pre-tinted sprite, per icon. Cleared on each (re)build.
let tintCache: Map<string, HTMLCanvasElement>[] = [];

/** Rasterize an icon's SVG to a white-alpha sprite canvas (shape in #fff, bg clear). */
function bakeIcon(icon: ParsedSvg): Promise<HTMLCanvasElement> {
  // force white fill via currentColor; transparent background.
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${icon.viewBox}" ` +
    `width="${SPRITE}" height="${SPRITE}" color="#fff" fill="#fff">${icon.innerSvg}</svg>`;
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  const img = new Image();
  return (img.decode ? ((img.src = url), img.decode()) : new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = rej; img.src = url; }))
    .then(() => {
      URL.revokeObjectURL(url);
      const c = document.createElement('canvas'); c.width = SPRITE; c.height = SPRITE;
      c.getContext('2d')!.drawImage(img, 0, 0, SPRITE, SPRITE);
      return c;
    });
}

/** A sprite tinted to `color`, cached per icon by quantized colour (5-bit/chan). */
function tinted(iconIdx: number, r: number, g: number, b: number): HTMLCanvasElement {
  const qr = r & 0xf8, qg = g & 0xf8, qb = b & 0xf8;     // quantize to 5 bits
  const key = `${qr},${qg},${qb}`;
  const cache = tintCache[iconIdx];
  let s = cache.get(key);
  if (s) return s;
  s = document.createElement('canvas'); s.width = SPRITE; s.height = SPRITE;
  const c = s.getContext('2d')!;
  c.drawImage(iconSprites[iconIdx], 0, 0);
  c.globalCompositeOperation = 'source-in';               // keep alpha, replace colour
  c.fillStyle = `rgb(${qr},${qg},${qb})`;
  c.fillRect(0, 0, SPRITE, SPRITE);
  cache.set(key, s);
  return s;
}

// --- per-cell math, mirrored from render.ts (solid path only) ------------------

function scaleFor(cell: Cell, s: Settings): number {
  let tonal = 1;
  if (s.sizeByBrightness) {
    const lo = Math.min(s.sizeRange[0], s.sizeRange[1]);
    const hi = Math.max(s.sizeRange[0], s.sizeRange[1]);
    const tt = 1 - cell.brightness;
    tonal = Math.sqrt(lo * lo + (hi * hi - lo * lo) * tt);
  }
  return Math.max(0.02, s.iconScale * tonal);
}
function rotationFor(cell: Cell, index: number, s: Settings): number {
  switch (s.rotate) {
    case 'fixed': return s.rotateDeg;
    case 'brightness': return s.rotateDeg * cell.brightness;
    case 'jitter': return (hash01(index) * 2 - 1) * s.rotateDeg;
    default: return 0;
  }
}
function opacityFor(cell: Cell, s: Settings): number {
  if (!s.fadeByBrightness) return 1;
  const [lo, hi] = s.fadeRange;
  return Math.max(0, Math.min(1, lo + (hi - lo) * cell.brightness));
}
function iconIndexFor(cell: Cell, count: number): number {
  if (count <= 1) return 0;
  return Math.min(count - 1, Math.floor(cell.brightness * count));
}

/** Build per-cell placements: reproduces render()'s grid (pool + colour stage),
 *  then maps each cell to a canvas placement. `scale` = canvas px per SVG unit. */
function buildPlacements(rawGrid: Cell[], settings: Settings, scale: number): Placement[] {
  let grid = poolCells(rawGrid, settings.cols, settings.blockSize);
  const cols = Math.max(...grid.map((c) => c.col)) + 1;
  const rows = Math.max(...grid.map((c) => c.row)) + 1;

  // colour stage (adjust -> dither -> scheme -> overlay) — identical to render().
  const { adjust, overlay } = settings;
  const doAdjust = adjustActive(adjust);
  const doScheme = settings.scheme.kind !== 'none';
  const doDither = settings.dither && schemeQuantizes(settings.scheme);
  const doOverlay = overlay.dir !== 'none' && overlay.strength > 0;
  if (doAdjust || doScheme || doDither || doOverlay) {
    const spread = settings.ditherStrength * 255;
    grid = grid.map((c) => {
      let rgb: RGB = { r: c.r, g: c.g, b: c.b };
      if (doAdjust) rgb = adjustColor(rgb, adjust);
      if (doDither) { const off = (bayer(c.col, c.row) - 0.5) * spread; rgb = { r: rgb.r + off, g: rgb.g + off, b: rgb.b + off }; }
      if (doScheme) rgb = transformColor(rgb, settings.scheme);
      if (doOverlay) rgb = overlayColor(rgb, overlayU(c.col, c.row, cols, rows, overlay.dir), overlay);
      return { ...c, r: rgb.r, g: rgb.g, b: rgb.b };
    });
  }

  const iconCount = iconSprites.length;
  const out: Placement[] = [];
  for (let i = 0; i < grid.length; i++) {
    const c = grid[i];
    out.push({
      cx: (c.col + 0.5) * CELL * scale,
      cy: (c.row + 0.5) * CELL * scale,
      size: CELL * scaleFor(c, settings) * scale,
      icon: iconIndexFor(c, iconCount),
      baseDeg: rotationFor(c, i, settings),
      opacity: opacityFor(c, settings),
      r: Math.round(c.r), g: Math.round(c.g), b: Math.round(c.b),
      delay: cellDelay(c, i, settings),
    });
  }
  return out;
}
// overlay direction -> u in [0,1] (mirrors render.ts overlayU).
function overlayU(col: number, row: number, cols: number, rows: number, dir: string): number {
  switch (dir) {
    case 'h': return cols > 1 ? col / (cols - 1) : 0;
    case 'v': return rows > 1 ? row / (rows - 1) : 0;
    case 'diag': return (col + row) / Math.max(1, cols - 1 + rows - 1);
    case 'radial': { const cx = (cols - 1) / 2, cy = (rows - 1) / 2; return Math.hypot(col - cx, row - cy) / (Math.hypot(cx, cy) || 1); }
    default: return 0;
  }
}

const D = Math.PI / 180;

function frame(now: number) {
  if (!running) return;
  raf = requestAnimationFrame(frame);
  if (paused || document.hidden || !canvas) return;
  const ctx = canvas.getContext('2d')!;
  const t = (now - t0) / 1000;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  for (const pl of placements) {
    let p = ((t - pl.delay) / period) % 1; if (p < 0) p += 1;
    const tri = ease(1 - Math.abs(1 - 2 * p));
    // motion transform (mirrors export.ts motionRuleAt), composed with the cell's
    // static base rotation.
    let deg = pl.baseDeg, sc = 1, ty = 0, alpha = pl.opacity;
    switch (motion) {
      case 'spin': deg += 360 * p; break;
      case 'wiggle': deg += -6 + 12 * tri; break;
      case 'swing': deg += -12 + 24 * tri; break;        // pivots at TOP centre (below)
      case 'pulse': sc = 1 + 0.2 * tri; break;
      case 'bob': ty = -0.30 * pl.size * tri; break;      // translateY(-30% of cell height)
      case 'shimmer': alpha *= 1 - 0.6 * tri; break;
    }
    ctx.globalAlpha = alpha;
    const tile = tinted(pl.icon, pl.r, pl.g, pl.b);
    const h = pl.size / 2;
    if (motion === 'swing') {
      // pivot around the cell's TOP centre: origin at top, rotate, draw downward.
      const a = deg * D, cos = Math.cos(a), sin = Math.sin(a);
      ctx.setTransform(cos, sin, -sin, cos, pl.cx, pl.cy - h);
      ctx.drawImage(tile, -h, 0, pl.size, pl.size);
    } else if (deg === 0 && sc === 1 && ty === 0) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(tile, pl.cx - h, pl.cy - h, pl.size, pl.size);
    } else {
      const a = deg * D, cos = Math.cos(a) * sc, sin = Math.sin(a) * sc;
      ctx.setTransform(cos, sin, -sin, cos, pl.cx, pl.cy + ty);
      ctx.drawImage(tile, -h, -h, pl.size, pl.size);
    }
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

/** (Re)build canvas + placements for the SVG's current box. */
function rebuild(rawGrid: Cell[], settings: Settings): boolean {
  if (!svgEl) return false;
  const rect = svgEl.getBoundingClientRect();
  if (rect.width < 1 || rect.height < 1) return false;
  lastBoxW = Math.round(rect.width); lastBoxH = Math.round(rect.height);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.round(rect.width * dpr), h = Math.round(rect.height * dpr);
  const vbW = Number(svgEl.getAttribute('width')) || w;
  const scale = w / vbW;
  tintCache = iconSprites.map(() => new Map());
  placements = buildPlacements(rawGrid, settings, scale);
  if (placements.length === 0) return false;
  if (!canvas) {
    canvas = document.createElement('canvas');
    canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none';
    host!.style.position = host!.style.position || 'relative';
    host!.appendChild(canvas);
    svgEl.style.visibility = 'hidden';
    svgEl.querySelector('style')?.remove(); // stop the (now redundant) CSS animation
  }
  canvas.width = w; canvas.height = h;
  return true;
}

/**
 * Animate the SOLID mosaic on a canvas overlaying `svg`. Reproduces render()'s
 * per-cell look from `rawGrid` + `icons`, drawing each cell as a tinted sprite
 * per frame. No-op for motion='none', reduced-motion, or layered styles.
 */
export async function startAnimator(
  outHost: HTMLElement, svg: SVGElement, rawGrid: Cell[], icons: ParsedSvg[],
  bgColor: string, settings: Settings,
): Promise<void> {
  stopAnimator();
  if (settings.motion === 'none' || settings.layered || reduceMq.matches || icons.length === 0) return;
  host = outHost; svgEl = svg;
  motion = settings.motion;
  period = settings.motionSpeed;
  bg = bgColor;
  running = true;
  t0 = performance.now();

  try { iconSprites = await Promise.all(icons.map(bakeIcon)); }
  catch { stopAnimator(); return; }       // bake failed -> CSS SVG fallback
  if (!running) return;

  if (!rebuild(rawGrid, settings)) { stopAnimator(); return; }

  resizeObs = new ResizeObserver(() => {
    if (!running || !svgEl) return;
    const r = svgEl.getBoundingClientRect();
    if (Math.round(r.width) !== lastBoxW || Math.round(r.height) !== lastBoxH) rebuild(rawGrid, settings);
  });
  resizeObs.observe(svg);
  raf = requestAnimationFrame(frame);
}

/** Stop: cancel the loop, remove the canvas, reveal the static SVG. */
export function stopAnimator(): void {
  running = false;
  if (raf) { cancelAnimationFrame(raf); raf = 0; }
  if (resizeObs) { resizeObs.disconnect(); resizeObs = null; }
  if (canvas) { canvas.remove(); canvas = null; }
  if (svgEl) { svgEl.style.visibility = ''; svgEl = null; }
  placements = []; iconSprites = []; tintCache = []; host = null;
}

/** Pause/resume for export. */
export function pauseAnimator(p: boolean): void { paused = p; }
