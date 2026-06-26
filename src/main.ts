import { defaults, type Settings } from './settings.ts';
import { sample, type Cell } from './sample.ts';
import { parseSvg, type ParsedSvg } from './parseSvg.ts';
import { render } from './render.ts';
import { downloadSvg, downloadPng, downloadGif } from './export.ts';
import { PALETTES, GRADIENTS, type Scheme, type RGB } from './color.ts';
import { syncUrl, settingsFromUrl, rollRandom, rollWithLocks } from './permalink.ts';
import { PRESETS } from './presets.ts';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const out = $('out');

// --- "heavy combo" warning (layered + motion) -------------------------------

// Show the Win98 system-requirements modal; resolve true if the user proceeds.
function confirmHeavy(): Promise<boolean> {
  const modal = $('heavyModal');
  modal.hidden = false;
  return new Promise((resolve) => {
    const done = (ok: boolean) => {
      modal.hidden = true;
      $('heavyOk').removeEventListener('click', onOk);
      $('heavyCancel').removeEventListener('click', onCancel);
      resolve(ok);
    };
    const onOk = () => done(true);
    const onCancel = () => done(false);
    $('heavyOk').addEventListener('click', onOk);
    $('heavyCancel').addEventListener('click', onCancel);
  });
}

// Once the user accepts (or already runs the combo), don't nag again this session.
let heavyAccepted = false;
/** True if turning on `next` would create the layered+motion combo for the first
 *  time and the user hasn't already accepted it. */
function needsHeavyWarning(next: { layered?: boolean; motion?: boolean }): boolean {
  if (heavyAccepted) return false;
  const willLayer = next.layered ?? settings.layered;
  const willMove = (next.motion ?? settings.motion !== 'none');
  return willLayer && willMove;
}
// Load settings from the URL hash (a shared permalink) if present, else defaults.
const settings: Settings = settingsFromUrl() ?? { ...defaults };

// Inputs that don't change every render: cache the parsed results.
let cells: Cell[] | null = null;
let srcBitmap: ImageBitmap | null = null; // decoded once at load; resample reuses it
const icons: { name: string; svg: ParsedSvg }[] = []; // dark->light order
let lastSvg = ''; // latest render() output, reused by export (no re-render)

function redraw() {
  syncUrl(settings); // keep the permalink current even before an image is loaded
  if (!cells || icons.length === 0) return;
  const parsed = icons.map((i) => i.svg);
  // ON-SCREEN: inline-shapes form — the browser lays out a flat tree instead of
  // cloning a <symbol> shadow subtree per cell (~85x faster paint on big grids).
  out.innerHTML = render(cells, parsed, settings, 'live');
  // FOR EXPORT (svg/png/gif): the <symbol>+<use> form. It's the one that rasterizes
  // reliably — the inline 'live' form decodes faster in micro-benchmarks but breaks
  // <img>/canvas rasterization at full scale (spliced transforms), so exports use
  // this form, NOT the on-screen one.
  lastSvg = render(cells, parsed, settings, 'export');
  refreshExportState();
  refreshMotionPerfNudge();
  refreshPips();
  setStatus('ready');
  bootReveal(); // first successful render -> cascade the windows in (runs once)
}

// CSS motion animates every cell on the compositor; it stays buttery to a few
// thousand cells, then drops frames (≈7fps at 100 cols). We don't cap it (that
// would change the look) — just nudge when the animated grid is big enough to
// chug, so the user can lower columns / raise blockSize if they want it smooth.
// blockSize pools cells, so it shrinks the animated count by block².
const SMOOTH_CELL_BUDGET = 2500; // ≈ 50×50; motion is smooth at/below this
function refreshMotionPerfNudge() {
  const nudge = document.getElementById('motionPerfNudge');
  if (!nudge) return;
  const animated = settings.motion !== 'none' && !settings.layered;
  let heavy = false;
  if (animated && cells) {
    const rows = Math.max(...cells.map((c) => c.row)) + 1;
    const block = Math.max(1, settings.blockSize);
    const effectiveCells = (settings.cols * rows) / (block * block);
    heavy = effectiveCells > SMOOTH_CELL_BUDGET;
  }
  nudge.hidden = !(animated && heavy);
}

// Single source of truth for export button states (the taskbar Save menu rows).
// SVG/PNG enabled once a render exists; GIF additionally needs motion.
function refreshExportState() {
  const rendered = !!lastSvg;
  const animated = settings.motion !== 'none';
  ($('dlSvg') as HTMLButtonElement).disabled = !rendered;
  ($('dlPng') as HTMLButtonElement).disabled = !rendered;
  ($('dlGif') as HTMLButtonElement).disabled = !rendered || !animated;
}

// Debounce so dragging a slider doesn't thrash render() on every input event,
// then align the surviving redraw to a frame boundary (rAF) so the DOM swap +
// layout land in one paint pass instead of risking a mid-frame double layout.
let timer: number | undefined;
let raf = 0;
function scheduleRedraw() {
  clearTimeout(timer);
  timer = setTimeout(() => {
    if (raf) cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => { raf = 0; redraw(); });
  }, 50);
  commitHistory();
}

// --- undo / redo: a bounded ring of settings snapshots ----------------------
// Snapshots are debounced (a slider drag = ONE entry, not 30) and pushed only
// when settings actually changed, so the stack reads like discrete edits. Not
// persisted across reloads (the permalink already carries the latest state). The
// image/icons are NOT in here — undo steps the knobs, never your loaded files.
const HISTORY_CAP = 20;
const history: Settings[] = [structuredClone(settings)];
let histAt = 0; // index of the live state within `history`
let restoring = false; // true while undo/redo applies a snapshot (suppresses re-commit)
let histTimer: number | undefined;
function commitHistory() {
  if (restoring) return;
  clearTimeout(histTimer);
  histTimer = setTimeout(() => {
    if (JSON.stringify(settings) === JSON.stringify(history[histAt])) return; // no real change
    history.splice(histAt + 1); // drop any redo tail — a new edit forks the future
    history.push(structuredClone(settings));
    if (history.length > HISTORY_CAP) history.shift();
    histAt = history.length - 1;
    refreshUndoButtons();
  }, 500);
}
function applySnapshot(i: number) {
  histAt = i;
  restoring = true;
  Object.assign(settings, structuredClone(history[i]));
  syncControls();
  resample(); // cols/background live in settings, so the grid may need a re-sample
  redraw();
  restoring = false;
  refreshUndoButtons();
}
function undo() { if (histAt > 0) applySnapshot(histAt - 1); }
function redo() { if (histAt < history.length - 1) applySnapshot(histAt + 1); }
function refreshUndoButtons() {
  const u = document.getElementById('undoBtn') as HTMLButtonElement | null;
  const r = document.getElementById('redoBtn') as HTMLButtonElement | null;
  if (u) u.disabled = histAt <= 0;
  if (r) r.disabled = histAt >= history.length - 1;
}

/** Load + validate an image file. Returns true on success. */
async function loadImage(file: File): Promise<boolean> {
  if (!file.type.startsWith('image/')) return false;
  try {
    srcBitmap?.close();              // free the previous image
    srcBitmap = await createImageBitmap(file);
    cells = sample(srcBitmap, settings);
  } catch { return false; } // corrupt/undecodable image
  $('srcName').textContent = file.name;
  refreshPips();
  redraw();
  return true;
}

/** Parse + add SVG files. Returns the count successfully added. */
async function loadSvgFiles(files: FileList | File[]): Promise<number> {
  let added = 0;
  for (const file of Array.from(files)) {
    try {
      icons.push({ name: file.name, svg: parseSvg(await file.text()) });
      added++;
    } catch { /* invalid SVG — caller decides how to surface it */ }
  }
  if (added) { renderIconList(); refreshPips(); redraw(); }
  return added;
}

$('image').addEventListener('change', async (e) => {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  if (await loadImage(file)) setDwStage('need-svg');
  else flashBad("that's not a valid image!");
});

// --- "try a demo": instant first render with NO files of your own ------------
// Paints a vivid radial-rainbow source on a canvas (no bundled asset to ship) and
// pairs it with two distinct inline tiles (a filled disc for dark, a thin ring for
// light) so the brightness ramp AND the hue-pick toggle both visibly do something,
// then flips `layered` on so the channel-split machine lights up on first paint.
// Everything goes through the normal load paths.
const DEMO_TILES = [
  // dark/dense: a solid disc
  '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="12" r="10"/></svg>',
  // light/sparse: a heart outline (thin, reads as "less ink")
  '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M12 21s-7.5-4.9-9.8-9.3C.8 8.4 2.3 5 5.5 5c2 0 3.4 1.2 4.2 2.5C10.6 6.2 12 5 14 5c3.2 0 4.7 3.4 3.3 6.7C19.5 16.1 12 21 12 21z" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
];

function demoImageFile(): Promise<File> {
  // a 256x256 radial spectrum: rainbow hue around the centre, bright core to dark
  // rim. Saturated + full-hue so hue-pick and CMY split both have something to bite.
  const cv = document.createElement('canvas');
  cv.width = cv.height = 256;
  const g = cv.getContext('2d')!;
  const cx = 128, cy = 128;
  for (let y = 0; y < 256; y++) {
    for (let x = 0; x < 256; x++) {
      const dx = x - cx, dy = y - cy;
      const hue = ((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360;
      const dist = Math.min(1, Math.hypot(dx, dy) / 128);
      g.fillStyle = `hsl(${hue}, 90%, ${70 - dist * 55}%)`;
      g.fillRect(x, y, 1, 1);
    }
  }
  return new Promise((resolve) =>
    cv.toBlob((b) => resolve(new File([b!], 'demo-spectrum.png', { type: 'image/png' })), 'image/png'));
}

async function loadDemo() {
  if (icons.length) return; // already has tiles (e.g. a double-click) — don't pile on
  const ok = await loadImage(await demoImageFile());
  if (!ok) return;
  const names = ['demo-disc.svg', 'demo-heart.svg'];
  await loadSvgFiles(DEMO_TILES.map((s, i) => new File([s], names[i], { type: 'image/svg+xml' })));
  setDwStage('need-svg'); // (the well hides once the render lands anyway)
  // turn the differentiator on so the first thing a newcomer sees is the split look.
  settings.layered = true;
  syncControls();
  redraw();
  commitHistory();
}

// --- empty-state drop-well: two-stage onboarding (image -> svg) --------------

const dropwell = $('dropwell');
const dwErr = $('dwErr');
// stage = need-image until an image loads, then need-svg.
function dwStage() { return dropwell.getAttribute('data-stage'); }
function setDwStage(s: 'need-image' | 'need-svg') { dropwell.setAttribute('data-stage', s); }
let badTimer: number | undefined;
function flashBad(msg: string) {
  dwErr.textContent = `✖ BAD DISK ✖  ${msg}`;
  dropwell.classList.add('bad');
  clearTimeout(badTimer);
  badTimer = setTimeout(() => dropwell.classList.remove('bad'), 1600);
}

// click anywhere on the well opens the right file picker for the current stage.
dropwell.addEventListener('click', (e) => {
  if ((e.target as HTMLElement).closest('a')) return; // let the webring link through
  if ((e.target as HTMLElement).closest('#tryDemo')) return; // demo button has its own handler
  $(dwStage() === 'need-svg' ? 'svg' : 'image').click();
});
$('tryDemo').addEventListener('click', (e) => { e.stopPropagation(); loadDemo(); });
['dragenter', 'dragover'].forEach((ev) =>
  dropwell.addEventListener(ev, (e) => { e.preventDefault(); dropwell.classList.add('drop-hot'); }),
);
['dragleave', 'drop'].forEach((ev) =>
  dropwell.addEventListener(ev, () => dropwell.classList.remove('drop-hot')),
);
dropwell.addEventListener('drop', async (e) => {
  e.preventDefault();
  const file = (e as DragEvent).dataTransfer?.files?.[0];
  if (!file) return;
  if (dwStage() === 'need-image') {
    if (await loadImage(file)) setDwStage('need-svg');
    else flashBad("that's not a valid image!");
  } else {
    if (await loadSvgFiles([file])) { /* render() will hide the well */ }
    else flashBad("that's not a valid .svg!");
  }
});

// Paste an image straight from the clipboard (Ctrl+V) — screenshots and copied
// web images that never hit disk. Routes into the SAME load path as a file drop;
// only acts at the need-image stage so a paste mid-session can't clobber the pic.
// No clipboard.read()/permission dance: the paste event hands us the blob directly.
window.addEventListener('paste', async (e) => {
  if (dwStage() !== 'need-image') return;
  const item = Array.from(e.clipboardData?.items ?? []).find((it) => it.type.startsWith('image/'));
  const blob = item?.getAsFile();
  if (!blob) return; // clipboard held text, not an image -> no-op
  e.preventDefault();
  const file = new File([blob], 'pasted.png', { type: blob.type });
  if (await loadImage(file)) setDwStage('need-svg');
  else flashBad("couldn't read that pasted image!");
});

// Render the icon list with remove buttons. Order = dark->light draw order.
function renderIconList() {
  const list = $('iconList');
  list.innerHTML = '';
  icons.forEach((it, i) => {
    const row = document.createElement('div');
    row.className = 'icon-row';
    row.innerHTML = `<span>${i + 1}. ${it.name}</span><button data-i="${i}" type="button">×</button>`;
    list.appendChild(row);
  });
  // the ordering rule + the brightness/hue picker only matter with 2+ icons.
  const multi = icons.length >= 2;
  $('iconOrderHint').hidden = !multi;
  $('r-iconMetric').hidden = !multi;
  syncIconMetricUI();
}

// In 'hue' mode the icon list orders round the colour wheel, not dark->light, so
// reframe the order hint to avoid confusing the two. Hidden entirely with <2 icons.
function syncIconMetricUI() {
  const hue = settings.iconMetric === 'hue' && icons.length >= 2;
  $('iconMetricHint').hidden = !hue;
  $('iconOrderHint').hidden = settings.iconMetric === 'hue' || icons.length < 2;
}
$('iconMetric').addEventListener('change', (e) => {
  settings.iconMetric = (e.target as HTMLSelectElement).value as Settings['iconMetric'];
  syncIconMetricUI();
  scheduleRedraw();
});

// Add one or more SVGs to the list (the file input allows multiple).
$('svg').addEventListener('change', async (e) => {
  const input = e.target as HTMLInputElement;
  const files = input.files;
  if (!files?.length) return;
  const added = await loadSvgFiles(files);
  if (added < files.length) flashBad("some files weren't valid .svg and were skipped");
  input.value = ''; // allow re-adding the same file
});

// Remove an icon (event delegation on the list).
$('iconList').addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest('button');
  if (!btn) return;
  icons.splice(+btn.dataset.i!, 1);
  renderIconList();
  refreshPips();
  redraw();
});

// cols and background change the sampled grid, so they must re-sample — but the
// decoded bitmap is cached from load, so this is just a re-sample, no re-decode.
function resample() {
  if (!srcBitmap) return;
  cells = sample(srcBitmap, settings);
}

$('cols').addEventListener('input', (e) => {
  settings.cols = +(e.target as HTMLInputElement).value;
  $('colsVal').textContent = String(settings.cols);
  resample();
  scheduleRedraw();
});

// blockSize pools the already-sampled grid (no resample) — just redraw.
$('blockSize').addEventListener('input', (e) => {
  settings.blockSize = +(e.target as HTMLInputElement).value;
  const n = settings.blockSize;
  $('blockVal').textContent = n > 1 ? `${n}×${n} chonk` : '1×1';
  scheduleRedraw();
});

// iconScale only affects rendering (not sampling), so no resample — just redraw.
$('iconScale').addEventListener('input', (e) => {
  settings.iconScale = +(e.target as HTMLInputElement).value;
  $('iconScaleVal').textContent = String(settings.iconScale);
  scheduleRedraw();
});

$('background').addEventListener('input', (e) => {
  settings.background = (e.target as HTMLInputElement).value;
  resample();
  scheduleRedraw();
});

$('sizeByBrightness').addEventListener('change', (e) => {
  settings.sizeByBrightness = (e.target as HTMLInputElement).checked;
  disclose('p-sizeRange', (e.target as HTMLInputElement).checked);
  scheduleRedraw();
});
$('sizeMin').addEventListener('input', (e) => {
  settings.sizeRange[0] = +(e.target as HTMLInputElement).value;
  $('sizeMinVal').textContent = settings.sizeRange[0].toFixed(2);
  scheduleRedraw();
});
$('sizeMax').addEventListener('input', (e) => {
  settings.sizeRange[1] = +(e.target as HTMLInputElement).value;
  $('sizeMaxVal').textContent = settings.sizeRange[1].toFixed(2);
  scheduleRedraw();
});

// rotate icons: mode dropdown reveals the degrees knob; the hint reframes the
// knob ('±jitter' vs 'tilt') so the same slider reads right per mode.
const ROTATE_HINTS: Record<string, string> = {
  brightness: "▸ dark leans one way, light the other, like an orientation field ✦",
  jitter: "▸ scatter unlocked! &nbsp; each icon tilts up to ±this much",
  fixed: '▸ tilt every icon by this angle ✦',
};
function syncRotateUI() {
  const mode = ($('rotate') as HTMLSelectElement).value;
  disclose('p-rotate', mode !== 'none');
  if (mode !== 'none') $('rotateHint').innerHTML = ROTATE_HINTS[mode];
  $('rotateDegVal').textContent = `${($('rotateDeg') as HTMLInputElement).value}°`;
}
$('rotate').addEventListener('change', (e) => {
  settings.rotate = (e.target as HTMLSelectElement).value as Settings['rotate'];
  syncRotateUI();
  scheduleRedraw();
});
$('rotateDeg').addEventListener('input', (e) => {
  settings.rotateDeg = +(e.target as HTMLInputElement).value;
  $('rotateDegVal').textContent = `${settings.rotateDeg}°`;
  scheduleRedraw();
});
$('fadeByBrightness').addEventListener('change', (e) => {
  settings.fadeByBrightness = (e.target as HTMLInputElement).checked;
  disclose('p-fadeRange', (e.target as HTMLInputElement).checked);
  scheduleRedraw();
});
$('fadeMin').addEventListener('input', (e) => {
  settings.fadeRange[0] = +(e.target as HTMLInputElement).value;
  $('fadeMinVal').textContent = settings.fadeRange[0].toFixed(2);
  scheduleRedraw();
});
$('fadeMax').addEventListener('input', (e) => {
  settings.fadeRange[1] = +(e.target as HTMLInputElement).value;
  $('fadeMaxVal').textContent = settings.fadeRange[1].toFixed(2);
  scheduleRedraw();
});

$('layered').addEventListener('change', async (e) => {
  const cb = e.target as HTMLInputElement;
  if (cb.checked && needsHeavyWarning({ layered: true })) {
    if (!(await confirmHeavy())) { cb.checked = false; return; } // cancelled -> revert
    heavyAccepted = true;
  }
  settings.layered = cb.checked;
  disclose('p-layered', cb.checked);
  scheduleRedraw();
});
// "layers" (2 vs 3) only applies to cmy/ryb; the rest have a fixed layer count.
function syncLayerCountUI() {
  const st = settings.layerStyle;
  disclose('p-layerCount', st === 'cmy' || st === 'ryb');
  $('halftoneHint').hidden = st !== 'halftone';
}
$('layerStyle').addEventListener('change', (e) => {
  settings.layerStyle = (e.target as HTMLSelectElement).value as Settings['layerStyle'];
  syncLayerCountUI();
  scheduleRedraw();
});
$('layerCount').addEventListener('change', (e) => {
  settings.layerCount = +(e.target as HTMLSelectElement).value as 2 | 3;
  scheduleRedraw();
});
$('layerOffset').addEventListener('input', (e) => {
  settings.layerOffset = +(e.target as HTMLInputElement).value;
  $('layerOffsetVal').textContent = String(settings.layerOffset);
  scheduleRedraw();
});
$('perChannelIcons').addEventListener('change', (e) => {
  settings.perChannelIcons = (e.target as HTMLInputElement).checked;
  $('perChannelHint').hidden = !settings.perChannelIcons;
  scheduleRedraw();
});

// hex "#rrggbb" -> RGB
const hex2rgb = (h: string): RGB => ({
  r: parseInt(h.slice(1, 3), 16),
  g: parseInt(h.slice(3, 5), 16),
  b: parseInt(h.slice(5, 7), 16),
});

/** The preset name whose color list equals `colors`, or null (= custom). Lets
 *  a restored palette/gradient round-trip back to its named preset, not 'custom'. */
const matchPreset = (table: Record<string, RGB[]>, colors: RGB[]): string | null =>
  Object.keys(table).find((name) =>
    table[name].length === colors.length
    && table[name].every((c, i) => c.r === colors[i]?.r && c.g === colors[i]?.g && c.b === colors[i]?.b)) ?? null;

function readScheme(): Scheme {
  const kind = ($('scheme') as HTMLSelectElement).value;
  switch (kind) {
    case 'threshold':
      return { kind, cutoff: +($('thresh') as HTMLInputElement).value };
    case 'hue':
      return { kind, deg: +($('hueDeg') as HTMLInputElement).value };
    case 'posterize':
      return { kind, levels: +($('levels') as HTMLInputElement).value };
    case 'duotone':
      return { kind, dark: hex2rgb(($('duoDark') as HTMLInputElement).value),
        light: hex2rgb(($('duoLight') as HTMLInputElement).value) };
    case 'tritone':
      return { kind, dark: hex2rgb(($('triDark') as HTMLInputElement).value),
        mid: hex2rgb(($('triMid') as HTMLInputElement).value),
        light: hex2rgb(($('triLight') as HTMLInputElement).value) };
    case 'solarize':
      return { kind, cutoff: +($('solCutoff') as HTMLInputElement).value };
    case 'channelswap':
      return { kind, order: ($('swapOrder') as HTMLSelectElement).value };
    case 'palette': {
      const preset = ($('palettePreset') as HTMLSelectElement).value;
      const colors = preset === 'custom'
        ? ['pal0', 'pal1', 'pal2'].map((id) => hex2rgb(($(id) as HTMLInputElement).value))
        : PALETTES[preset];
      return { kind, colors };
    }
    case 'gradient': {
      const preset = ($('gradientPreset') as HTMLSelectElement).value;
      const stops = preset === 'custom'
        ? ['grad0', 'grad1', 'grad2', 'grad3'].map((id) => hex2rgb(($(id) as HTMLInputElement).value))
        : GRADIENTS[preset];
      return { kind, stops };
    }
    default:
      return { kind } as Scheme; // none | grayscale | invert | sepia
  }
}

// Toggle a disclosure wrapper: native [hidden] + aria-hidden in lockstep so
// collapsed controls leave the tab order / AT.
function disclose(id: string, show: boolean) {
  const el = $(id);
  el.hidden = !show;
  el.setAttribute('aria-hidden', String(!show));
}

function syncSchemeUI() {
  const kind = ($('scheme') as HTMLSelectElement).value;
  disclose('p-levels', kind === 'posterize');
  disclose('p-threshold', kind === 'threshold');
  disclose('p-hue', kind === 'hue');
  disclose('p-duotone', kind === 'duotone');
  disclose('p-tritone', kind === 'tritone');
  disclose('p-gradient', kind === 'gradient');
  disclose('p-solarize', kind === 'solarize');
  disclose('p-channelswap', kind === 'channelswap');
  disclose('p-palette', kind === 'palette');
  // palette preset 'custom' reveals the 3 hand-pick swatches; presets hide them.
  disclose('p-palette-custom', kind === 'palette'
    && ($('palettePreset') as HTMLSelectElement).value === 'custom');
  disclose('p-gradient-custom', kind === 'gradient'
    && ($('gradientPreset') as HTMLSelectElement).value === 'custom');
  $('levelsVal').textContent = `${($('levels') as HTMLInputElement).value} steps`;
  $('threshVal').textContent = (+($('thresh') as HTMLInputElement).value).toFixed(2);
  $('hueDegVal').textContent = `${($('hueDeg') as HTMLInputElement).value}°`;
  $('solCutoffVal').textContent = (+($('solCutoff') as HTMLInputElement).value).toFixed(2);
  $('schemeHint').hidden = kind !== 'none'; // hint only while nothing's picked
}

// The disclosure insets (scheme insets are handled by syncSchemeUI).
function syncDisclosure() {
  disclose('p-sizeRange', ($('sizeByBrightness') as HTMLInputElement).checked);
  disclose('p-fadeRange', ($('fadeByBrightness') as HTMLInputElement).checked);
  disclose('p-dither', ($('dither') as HTMLInputElement).checked);
  disclose('p-overlay', ($('overlayDir') as HTMLSelectElement).value !== 'none');
  disclose('p-layered', ($('layered') as HTMLInputElement).checked);
  disclose('p-motion', ($('motion') as HTMLSelectElement).value !== 'none');
  syncRotateUI();
  syncIconMetricUI();
  refreshExportState();
}

// --- adjust panel (sat/bright/contrast/temp) — pre-scheme, always live -------
function readAdjust(): Settings['adjust'] {
  return {
    brightness: +($('adjBright') as HTMLInputElement).value,
    contrast: +($('adjContrast') as HTMLInputElement).value,
    saturation: +($('adjSat') as HTMLInputElement).value,
    temperature: +($('adjTemp') as HTMLInputElement).value,
  };
}
for (const [id, label] of [['adjBright', 'adjBrightVal'], ['adjContrast', 'adjContrastVal'],
  ['adjSat', 'adjSatVal'], ['adjTemp', 'adjTempVal']] as const) {
  $(id).addEventListener('input', () => {
    settings.adjust = readAdjust();
    $(label).textContent = (+($(id) as HTMLInputElement).value).toFixed(2);
    scheduleRedraw();
  });
}

// --- dither (under quantising schemes) ---------------------------------------
$('dither').addEventListener('change', (e) => {
  settings.dither = (e.target as HTMLInputElement).checked;
  disclose('p-dither', settings.dither);
  scheduleRedraw();
});
$('ditherStrength').addEventListener('input', (e) => {
  settings.ditherStrength = +(e.target as HTMLInputElement).value;
  $('ditherStrengthVal').textContent = settings.ditherStrength.toFixed(2);
  scheduleRedraw();
});

// --- colour jitter (per-cell hue/sat scatter; pre-scheme, deterministic) ------
$('colorJitter').addEventListener('input', (e) => {
  settings.colorJitter = +(e.target as HTMLInputElement).value;
  $('colorJitterVal').textContent = settings.colorJitter.toFixed(2);
  scheduleRedraw();
});

// --- gradient overlay (post-scheme wash) -------------------------------------
function readOverlay(): Settings['overlay'] {
  return {
    dir: ($('overlayDir') as HTMLSelectElement).value as Settings['overlay']['dir'],
    preset: ($('overlayPreset') as HTMLSelectElement).value,
    blend: ($('overlayBlend') as HTMLSelectElement).value as Settings['overlay']['blend'],
    strength: +($('overlayStrength') as HTMLInputElement).value,
  };
}
for (const id of ['overlayDir', 'overlayPreset', 'overlayBlend', 'overlayStrength']) {
  $(id).addEventListener('input', () => {
    settings.overlay = readOverlay();
    disclose('p-overlay', settings.overlay.dir !== 'none');
    $('overlayStrengthVal').textContent = settings.overlay.strength.toFixed(2);
    scheduleRedraw();
  });
}

for (const id of ['scheme', 'levels', 'thresh', 'hueDeg', 'duoDark', 'duoLight',
  'triDark', 'triMid', 'triLight', 'palettePreset', 'pal0', 'pal1', 'pal2',
  'gradientPreset', 'grad0', 'grad1', 'grad2', 'grad3', 'solCutoff', 'swapOrder']) {
  $(id).addEventListener('input', () => {
    settings.scheme = readScheme();
    syncSchemeUI();
    scheduleRedraw();
  });
}

$('motion').addEventListener('change', async (e) => {
  const sel = e.target as HTMLSelectElement;
  const val = sel.value as Settings['motion'];
  if (val !== 'none' && needsHeavyWarning({ motion: true })) {
    if (!(await confirmHeavy())) { sel.value = 'none'; return; } // cancelled -> revert
    heavyAccepted = true;
  }
  settings.motion = val;
  disclose('p-motion', val !== 'none');
  refreshExportState(); // GIF becomes available/unavailable with motion
  scheduleRedraw();
});
$('motionSpeed').addEventListener('input', (e) => {
  settings.motionSpeed = +(e.target as HTMLInputElement).value;
  $('motionSpeedVal').textContent = `${settings.motionSpeed.toFixed(1)}×`;
  scheduleRedraw();
});
$('staggerMode').addEventListener('change', (e) => {
  settings.staggerMode = (e.target as HTMLSelectElement).value as Settings['staggerMode'];
  scheduleRedraw();
});
// Tell the p5 backdrop to pause while a raster export runs (it fights the encode
// for the main thread / GPU). The sketch listens for this on document.
const setExportBusy = (busy: boolean) =>
  document.dispatchEvent(new CustomEvent('iconizer:export', { detail: { busy } }));

$('dlSvg').addEventListener('click', () => {
  if (lastSvg) downloadSvg(lastSvg);
});
$('dlPng').addEventListener('click', async () => {
  if (!lastSvg) return;
  setStatus('exporting'); setProg(30);
  setExportBusy(true);
  try {
    await downloadPng(lastSvg, +($('scale') as HTMLSelectElement).value);
    setProg(100);
  } catch {
    // a failed raster (e.g. iOS canvas cap) must not leave the bar stuck on
    // "exporting" forever — surface it and recover.
    $('progText').textContent = '✖ PNG EXPORT FAILED';
  } finally {
    setExportBusy(false);
    setTimeout(() => { setStatus('ready'); setProg(0); }, 800);
  }
});
$('dlGif').addEventListener('click', async () => {
  if (!lastSvg || settings.motion === 'none') return;
  const btn = $('dlGif') as HTMLButtonElement;
  const old = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'encoding…';
  setStatus('exporting'); setProg(15);
  // coarse progress: the bar creeps while gif.js encodes (no per-frame callback wired).
  let p = 15;
  const creep = setInterval(() => { p = Math.min(90, p + 8); setProg(p); }, 200);
  setExportBusy(true);
  // Fewer frames on touch devices: 20 frames of held ImageData can OOM/freeze a
  // phone (and trip the encode timeout); 12 keeps it smooth at a tiny cost.
  const frames = matchMedia('(pointer: coarse)').matches ? 12 : 20;
  try {
    await downloadGif(lastSvg, settings.motion, settings.motionSpeed, +($('scale') as HTMLSelectElement).value, frames);
    setProg(100);
  } catch {
    $('progText').textContent = '✖ GIF EXPORT FAILED';
  } finally {
    setExportBusy(false);
    clearInterval(creep);
    btn.disabled = false;
    btn.textContent = old;
    setTimeout(() => { setStatus('ready'); setProg(0); }, 800);
  }
});

// --- Settings -> DOM controls (for permalink load + surprise me) ------------

const rgb2hex = (c: RGB) =>
  '#' + [c.r, c.g, c.b].map((n) => Math.round(n).toString(16).padStart(2, '0')).join('');

/** Push the current `settings` object back into every control + its value label. */
function syncControls() {
  const set = (id: string, v: string | number | boolean) => {
    const el = $(id) as HTMLInputElement;
    if (typeof v === 'boolean') el.checked = v;
    else el.value = String(v);
  };
  set('cols', settings.cols); $('colsVal').textContent = String(settings.cols);
  set('blockSize', settings.blockSize);
  $('blockVal').textContent = settings.blockSize > 1 ? `${settings.blockSize}×${settings.blockSize} chonk` : '1×1';
  set('iconScale', settings.iconScale); $('iconScaleVal').textContent = String(settings.iconScale);
  set('background', settings.background);
  set('sizeByBrightness', settings.sizeByBrightness);
  set('sizeMin', settings.sizeRange[0]); $('sizeMinVal').textContent = settings.sizeRange[0].toFixed(2);
  set('sizeMax', settings.sizeRange[1]); $('sizeMaxVal').textContent = settings.sizeRange[1].toFixed(2);
  set('rotate', settings.rotate);
  set('rotateDeg', settings.rotateDeg); $('rotateDegVal').textContent = `${settings.rotateDeg}°`;
  set('fadeByBrightness', settings.fadeByBrightness);
  set('fadeMin', settings.fadeRange[0]); $('fadeMinVal').textContent = settings.fadeRange[0].toFixed(2);
  set('fadeMax', settings.fadeRange[1]); $('fadeMaxVal').textContent = settings.fadeRange[1].toFixed(2);
  set('layered', settings.layered);
  set('layerStyle', settings.layerStyle);
  set('layerCount', settings.layerCount);
  set('layerOffset', settings.layerOffset); $('layerOffsetVal').textContent = String(settings.layerOffset);
  set('perChannelIcons', settings.perChannelIcons); $('perChannelHint').hidden = !settings.perChannelIcons;
  set('motion', settings.motion);
  set('motionSpeed', settings.motionSpeed); $('motionSpeedVal').textContent = `${settings.motionSpeed.toFixed(1)}×`;
  set('staggerMode', settings.staggerMode);
  // adjust panel
  set('adjBright', settings.adjust.brightness); $('adjBrightVal').textContent = settings.adjust.brightness.toFixed(2);
  set('adjContrast', settings.adjust.contrast); $('adjContrastVal').textContent = settings.adjust.contrast.toFixed(2);
  set('adjSat', settings.adjust.saturation); $('adjSatVal').textContent = settings.adjust.saturation.toFixed(2);
  set('adjTemp', settings.adjust.temperature); $('adjTempVal').textContent = settings.adjust.temperature.toFixed(2);
  // dither + overlay
  set('dither', settings.dither);
  set('ditherStrength', settings.ditherStrength); $('ditherStrengthVal').textContent = settings.ditherStrength.toFixed(2);
  set('colorJitter', settings.colorJitter); $('colorJitterVal').textContent = settings.colorJitter.toFixed(2);
  set('iconMetric', settings.iconMetric);
  set('overlayDir', settings.overlay.dir);
  set('overlayPreset', settings.overlay.preset);
  set('overlayBlend', settings.overlay.blend);
  set('overlayStrength', settings.overlay.strength); $('overlayStrengthVal').textContent = settings.overlay.strength.toFixed(2);
  // scheme + its conditional sub-controls
  set('scheme', settings.scheme.kind);
  if (settings.scheme.kind === 'posterize') set('levels', settings.scheme.levels);
  if (settings.scheme.kind === 'threshold') set('thresh', settings.scheme.cutoff);
  if (settings.scheme.kind === 'hue') set('hueDeg', settings.scheme.deg);
  if (settings.scheme.kind === 'duotone') {
    set('duoDark', rgb2hex(settings.scheme.dark));
    set('duoLight', rgb2hex(settings.scheme.light));
  }
  if (settings.scheme.kind === 'tritone') {
    set('triDark', rgb2hex(settings.scheme.dark));
    set('triMid', rgb2hex(settings.scheme.mid));
    set('triLight', rgb2hex(settings.scheme.light));
  }
  if (settings.scheme.kind === 'solarize') set('solCutoff', settings.scheme.cutoff);
  if (settings.scheme.kind === 'channelswap') set('swapOrder', settings.scheme.order);
  if (settings.scheme.kind === 'palette') {
    // Match the colors against a known preset; fall back to 'custom' + swatches.
    const colors = settings.scheme.colors;
    const presetName = matchPreset(PALETTES, colors);
    set('palettePreset', presetName ?? 'custom');
    if (!presetName) colors.slice(0, 3).forEach((c, i) => set(`pal${i}`, rgb2hex(c)));
  }
  if (settings.scheme.kind === 'gradient') {
    const stops = settings.scheme.stops;
    const presetName = matchPreset(GRADIENTS, stops);
    set('gradientPreset', presetName ?? 'custom');
    if (!presetName) stops.slice(0, 4).forEach((c, i) => set(`grad${i}`, rgb2hex(c)));
  }
  syncSchemeUI();
  syncLayerCountUI();
  syncDisclosure(); // restore the 3 new insets from current control values
}

// Apply settings loaded from a permalink to the controls on startup.
syncControls();
refreshPips(); // initial LED states (no image/svg/render yet)
// A permalink or roll can arrive with the heavy combo already on; don't nag about
// a state the user didn't just create by hand.
if (settings.layered && settings.motion !== 'none') heavyAccepted = true;

// --- Surprise Lab: hold reels, then roll -------------------------------------
// Held windows keep their settings; the rest reroll. The "hold" checkboxes live in
// the Surprise Lab.exe window; reading them at roll time gives the lock Set. The
// group->keys map and the merge (incl. the no-heavy-combo guard) live in
// permalink.ts so they stay unit-tested. Holds are session-only, NOT in the
// permalink, so a shared link still rolls cleanly for the recipient.
const HOLD_BOXES: Record<string, string> = {
  grid: 'hold-grid', layer: 'hold-layer', scheme: 'hold-scheme', motion: 'hold-motion',
};
function heldGroups(): Set<string> {
  const set = new Set<string>();
  for (const [group, id] of Object.entries(HOLD_BOXES))
    if (($(id) as HTMLInputElement).checked) set.add(group);
  return set;
}

// One roll, honouring the holds. Reachable from the Start menu (reroll from
// anywhere) AND from the button inside the Lab window.
function doRoll() {
  Object.assign(settings, rollWithLocks(settings, rollRandom(), heldGroups()));
  syncControls();
  redraw(); // immediate (also writes the new URL), so the link reflects the roll
  commitHistory(); // a roll is one undoable step
}
$('surprise').addEventListener('click', doRoll);
$('surpriseRoll').addEventListener('click', doRoll);

// Apply a whole Settings object at once (a curated preset). Shares Surprise's
// path, but a preset CAN carry the layered+motion heavy combo, so confirm it
// first (and remember the choice). Cancelling leaves the current look untouched.
async function applySettings(next: Settings) {
  if (next.layered && next.motion !== 'none' && needsHeavyWarning({ layered: true, motion: true })) {
    if (!(await confirmHeavy())) return;
    heavyAccepted = true;
  }
  Object.assign(settings, structuredClone(next));
  syncControls();
  redraw();
  commitHistory(); // one undoable step
}

// "My Favorites": a curated shelf of named looks, in a Win98 flyout submenu off the
// Start menu. Each loads a full Settings object in one click (the caption hints what
// the look does). No storage, no editing — a mixtape, not a save slot.
const presetList = $('presetList');
PRESETS.forEach((p, i) => {
  const item = document.createElement('div');
  item.className = 'sm-link';
  item.setAttribute('role', 'menuitem');
  item.tabIndex = 0;
  item.dataset.i = String(i);
  // single-line "emoji name" so a preset row reads exactly like the other
  // Start-menu items (🏀 Space Jam, etc). The caption rides along as the tooltip.
  item.textContent = `${p.icon} ${p.name}`;
  item.title = p.caption;
  presetList.appendChild(item);
});
function applyPreset(item: HTMLElement) {
  applySettings(PRESETS[+item.dataset.i!].settings);
  closeFav();
  setStart(false); // a chosen look closes the whole Start menu (Win98 behaviour)
}
presetList.addEventListener('click', (e) => {
  const item = (e.target as HTMLElement).closest<HTMLElement>('.sm-link');
  if (item) applyPreset(item);
});
presetList.addEventListener('keydown', (e) => {
  const item = (e.target as HTMLElement).closest<HTMLElement>('.sm-link');
  if (item && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); applyPreset(item); }
});

// The My Favorites flyout: open on hover or click/Enter of the parent, close on
// leave or Esc. aria-expanded on the wrapper drives the CSS reveal.
const favParent = $('favParent');
const favTrigger = favParent.querySelector('.sm-parent') as HTMLElement;
let favCloseTimer: number | undefined;
const cancelClose = () => { clearTimeout(favCloseTimer); favCloseTimer = undefined; };
const openFav = () => { cancelClose(); favParent.setAttribute('aria-expanded', 'true'); favTrigger.setAttribute('aria-expanded', 'true'); };
const closeFav = () => { cancelClose(); favParent.setAttribute('aria-expanded', 'false'); favTrigger.setAttribute('aria-expanded', 'false'); };
const closeSoon = () => { cancelClose(); favCloseTimer = setTimeout(closeFav, 220); };
// HOVER DEVICES ONLY. A single tap on a touch device synthesizes mouseenter ->
// click -> mouseleave, so wiring mouseleave here would arm the close timer right
// after the tap opened the menu and tear it back down (looked like "tap does
// nothing"). Gate on (hover: hover) so touch relies purely on tap-to-open +
// tap-outside-to-close (below). The flyout is position:fixed, sitting in a box
// detached from the row with a gap; the delayed close + cancel-on-reenter lets the
// cursor travel that gap to the submenu without it vanishing.
if (matchMedia('(hover: hover)').matches) {
  [favParent, presetList].forEach((el) => {
    el.addEventListener('mouseenter', openFav);
    el.addEventListener('mouseleave', closeSoon);
  });
}
// Click ALWAYS opens (idempotent), never toggles. Toggling fought touch: a tap
// emulates mouseenter (-> openFav) then click on the same element, so a toggle
// would immediately re-close and the tap would appear to do nothing. With open-
// only here, mobile users tap the label to reveal the submenu; the outside-click
// handler below is the sole close path for pointer/touch.
favTrigger.addEventListener('click', (e) => {
  e.stopPropagation(); // don't let the Start-menu's own click-close fire
  openFav();
});
// Close the flyout when clicking/tapping anything that's NOT the row or the
// submenu (covers mobile, where there's no mouseleave). #presetList is a child of
// #favParent, so one contains() check covers both. Capture phase so favTrigger's
// stopPropagation can't hide an outside click from us.
document.addEventListener('click', (e) => {
  if (favParent.getAttribute('aria-expanded') === 'true'
      && !favParent.contains(e.target as Node)) closeFav();
}, true);
favTrigger.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowRight') {
    e.preventDefault(); openFav();
    (presetList.querySelector('.sm-link') as HTMLElement)?.focus();
  } else if (e.key === 'Escape' || e.key === 'ArrowLeft') { closeFav(); }
});

$('undoBtn').addEventListener('click', undo);
$('redoBtn').addEventListener('click', redo);
// Ctrl/Cmd+Z = undo, Ctrl/Cmd+Y (or Shift+Z) = redo. No text inputs exist here,
// so a global listener never steals a real text-edit undo.
document.addEventListener('keydown', (e) => {
  if (!(e.ctrlKey || e.metaKey)) return;
  const k = e.key.toLowerCase();
  if (k === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
  else if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); redo(); }
});

$('share').addEventListener('click', async () => {
  syncUrl(settings);
  try {
    await navigator.clipboard.writeText(location.href);
    const btn = $('share');
    const old = btn.textContent;
    btn.textContent = 'copied!';
    setTimeout(() => { btn.textContent = old; }, 1200);
  } catch {
    prompt('Copy this link:', location.href);
  }
});

// --- decorative taskbar chrome (no render-path impact) ----------------------

// Live LCD clock.
const clock = $('clock');
function tick() {
  const d = new Date();
  clock.textContent = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
tick();
setInterval(tick, 15000);

// Honest localStorage visitor counter — counts THIS browser's visits, odometer-padded.
const n = (Number(localStorage.getItem('iconizer.visits')) || 0) + 1;
localStorage.setItem('iconizer.visits', String(n));
$('visitorCount').textContent = `#${String(n).padStart(6, '0')}`;

// --- header status: filename caption, readiness pips, export progress --------

function setPip(id: string, on: boolean, nudge = false) {
  const el = $(id);
  el.classList.toggle('on', on);
  el.classList.toggle('nudge', nudge && !on);
}
/** Refresh the three readiness LEDs from current state. */
function refreshPips() {
  setPip('pipImg', !!cells);
  setPip('pipSvg', icons.length > 0, /* nudge when missing: */ true);
  setPip('pipReady', !!lastSvg);
  $('pipImg').setAttribute('aria-label', cells ? 'picture: loaded ♡' : 'picture: not loaded');
  $('pipSvg').setAttribute('aria-label', icons.length ? 'icon .svg: ready ✦' : 'icon .svg: none yet, add one!');
  $('pipReady').setAttribute('aria-label', lastSvg ? 'render: ready to save ✦' : 'render: not ready');
}
function setStatus(s: 'idle' | 'rendering' | 'ready' | 'exporting') {
  $('sysbar').setAttribute('data-status', s);
  const txt = $('progText');
  if (s === 'idle') txt.textContent = '☆ Netscape Now! · best viewed at 800×600 ☆';
  else if (s === 'rendering') txt.textContent = 'RENDERING…';
  else if (s === 'ready') txt.textContent = 'READY.';
  else txt.textContent = 'EXPORTING… please hold ⏳';
}
function setProg(pct: number) {
  $('sysbar').style.setProperty('--prog', `${Math.round(pct)}%`);
}

// Maximize/restore the CRT: click the screen to fill the vertical space over the
// windows; click again, Enter/Space (it's role=button), or Esc to restore.
const crt = $('crt');
// Only maximize when there's actually a rendered mosaic — the empty/mascot state
// has nothing to zoom into. #out is empty until the first successful render.
const hasRender = () => out.childElementCount > 0;
function toggleMax(on?: boolean) {
  if (on !== false && !hasRender()) return; // ignore maximize requests with no image
  const next = on ?? !crt.classList.contains('maximized');
  crt.classList.toggle('maximized', next);
  crt.setAttribute('aria-pressed', String(next));
}
crt.addEventListener('click', () => toggleMax());
crt.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleMax(); }
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && crt.classList.contains('maximized')) toggleMax(false);
});

// --- taskbar: Start menu, quick-save proxy, task scroll-spy ------------------

const startBtn = $('startBtn');
const startMenu = $('startMenu');
function setStart(open: boolean) {
  startMenu.hidden = !open;
  startBtn.setAttribute('aria-expanded', String(open));
  if (open) (startMenu.querySelector('[role=menuitem]') as HTMLElement)?.focus();
}
startBtn.addEventListener('click', () => setStart(startMenu.hidden));
// close on outside-click / Esc / selecting an item
document.addEventListener('click', (e) => {
  if (!startMenu.hidden && !startMenu.contains(e.target as Node) && e.target !== startBtn)
    setStart(false);
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !startMenu.hidden) { setStart(false); startBtn.focus(); }
});
startMenu.addEventListener('click', (e) => {
  const item = (e.target as HTMLElement).closest('[role=menuitem]');
  // Surprise Me stays open so you can keep rerolling from the menu; every other
  // item closes it (Win98 behaviour).
  if (item && item.id !== 'surprise') setStart(false);
});

// quick-save split button: the menu rows (#dlSvg/#dlPng/#dlGif) ARE the canonical
// export buttons now — their own click handlers (above) run the download. Here we
// just open/close the menu; the rows' disabled state is set by refreshExportState.
const quickSave = $('quickSave') as HTMLButtonElement;
const qsMenu = $('quickSaveMenu');

quickSave.addEventListener('click', () => {
  qsMenu.hidden = !qsMenu.hidden;
  quickSave.setAttribute('aria-expanded', String(!qsMenu.hidden));
});
document.addEventListener('click', (e) => {
  if (!qsMenu.hidden && !qsMenu.contains(e.target as Node) && e.target !== quickSave) qsMenu.hidden = true;
});
// close the menu after picking a format (the export itself fires on the row's own
// handler). Skip close for a disabled row so the menu doesn't vanish on a no-op.
qsMenu.querySelectorAll<HTMLButtonElement>('.qs-item').forEach((item) => {
  item.addEventListener('click', () => { if (!item.disabled) qsMenu.hidden = true; });
});

// --- minimize / restore windows (genie animation) ---------------------------

const tasks = Array.from(document.querySelectorAll<HTMLButtonElement>('.task'));
const byWin = new Map(tasks.map((t) => [t.dataset.win!, t]));
const taskFor = (win: HTMLElement) => byWin.get(win.id);

// Two-phase genie: .minimizing runs the transform/fade transition while the window
// still holds its grid slot; on transitionend, .minimized (display:none) drops it
// out so the grid reflows. Restore reverses.
// FLIP: animate the OTHER windows sliding to their new spots when the layout
// reflows (a window leaving/entering), instead of teleporting. `mutate` performs
// the layout change; `except` is the window being toggled (it has its own genie).
function flipSiblings(except: HTMLElement, mutate: () => void) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) { mutate(); return; }
  const others = allWins.map((id) => document.getElementById(id)!)
    .filter((w) => w && w !== except && !w.classList.contains('minimized') && !w.classList.contains('minimizing'));
  const first = new Map(others.map((w) => [w, w.getBoundingClientRect()]));
  mutate(); // layout changes here
  for (const w of others) {
    const a = first.get(w)!;
    const b = w.getBoundingClientRect();
    const dx = a.left - b.left, dy = a.top - b.top;
    if (!dx && !dy) continue;
    w.style.transition = 'none';
    w.style.transform = `translate(${dx}px, ${dy}px)`; // invert: appear unmoved
    requestAnimationFrame(() => {
      w.style.transition = 'transform .28s cubic-bezier(.4,0,.6,1)';
      w.style.transform = ''; // play: slide to real position
      w.addEventListener('transitionend', () => { w.style.transition = ''; }, { once: true });
    });
  }
}

function minimizeWin(win: HTMLElement) {
  if (win.classList.contains('minimized') || win.classList.contains('minimizing')) return;
  const task = taskFor(win);
  task?.classList.add('stowed');
  task?.classList.remove('active'); // a minimized window is not "in view"
  // reduced-motion: skip the genie, hide instantly.
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) { win.classList.add('minimized'); return; }
  win.classList.add('minimizing');
  // guard on the transform end (two props transition) + a fallback so an interrupted
  // transition can't leave the window stuck in .minimizing forever (the wonky state).
  let done = false;
  const finish = () => {
    if (done) return; done = true;
    win.classList.remove('minimizing');
    flipSiblings(win, () => win.classList.add('minimized')); // others slide up to fill
  };
  win.addEventListener('transitionend', (e) => { if (e.propertyName === 'transform') finish(); }, { once: true });
  setTimeout(finish, 400);
}
function restoreWin(win: HTMLElement, scroll = true) {
  taskFor(win)?.classList.remove('stowed');
  if (!win.classList.contains('minimized')) return;
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) { win.classList.remove('minimized'); return; }
  // Pop back into the grid AT the shrunk state (.minimizing transform), force the
  // browser to actually PAINT that shrunk frame (reading offsetWidth flushes layout),
  // THEN remove .minimizing so the transform transitions from shrunk -> normal. Without
  // the forced reflow, going display:none -> grid + removing .minimizing in the same
  // frame gives the transition no "from" value, so it snaps with no genie.
  win.classList.add('minimizing');
  win.classList.remove('minimized');
  void win.offsetWidth; // force reflow so the shrunk state is the painted "from"
  requestAnimationFrame(() => win.classList.remove('minimizing'));
  if (scroll) win.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

// All control windows in boot order. On first load they start minimized (just the
// CRT shows); after the first successful render they cascade in one by one.
const allWins = ['winSurprise', 'winPics', 'winGrid', 'winLayer', 'winScheme', 'winMotion'];
function bootMinimizeAll() {
  document.body.classList.add('no-media'); // hide the task buttons until a render exists
  allWins.forEach((id) => {
    const w = document.getElementById(id);
    if (w) { w.classList.add('minimized'); taskFor(w)?.classList.add('stowed'); }
  });
}
let booted = false; // the cascade reveal runs once
function bootReveal() {
  if (booted) return;
  booted = true;
  document.body.classList.remove('no-media'); // taskbar buttons appear with the windows
  allWins.forEach((id, i) => {
    setTimeout(() => { const w = document.getElementById(id); if (w) restoreWin(w, false); }, i * 240);
  });
}

// win-bar _ and × buttons minimize their window (it's a toy — × just stows it too).
document.querySelectorAll<HTMLElement>('.win .mini').forEach((btn) => {
  const win = btn.closest('.win') as HTMLElement;
  const go = () => minimizeWin(win);
  btn.addEventListener('click', go);
  btn.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
});

// taskbar task button: minimized -> restore; visible -> minimize (Win98 toggle).
tasks.forEach((t) => t.addEventListener('click', () => {
  const win = $(t.dataset.win!);
  if (win.classList.contains('minimized')) restoreWin(win);
  else minimizeWin(win);
}));

// IntersectionObserver lights the in-view (non-minimized) window's task button.
const spy = new IntersectionObserver((entries) => {
  for (const en of entries) {
    if (en.isIntersecting && !(en.target as HTMLElement).classList.contains('minimized')) {
      tasks.forEach((t) => t.classList.remove('active'));
      byWin.get(en.target.id)?.classList.add('active');
    }
  }
}, { threshold: 0.5 });
tasks.forEach((t) => { const w = document.getElementById(t.dataset.win!); if (w) spy.observe(w); });

// Boot: start every control window minimized (just the CRT shows). The CRT
// drop-well is the upload path; once both image+svg are loaded and the first
// render happens, redraw() -> bootReveal() cascades the windows in one by one.
// If a permalink/Surprise arrives needing a render before upload, the cascade
// still fires on that first render. (Reduced-motion: instant hide, instant reveal.)
bootMinimizeAll();
