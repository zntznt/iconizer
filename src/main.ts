import { defaults, type Settings } from './settings.ts';
import { sample, gridDims, type Cell } from './sample.ts';
import { parseSvg, type ParsedSvg } from './parseSvg.ts';
import { render } from './render.ts';
import { downloadSvg, downloadPng, downloadGif, copyPng, canCopyImage } from './export.ts';
import { PALETTES, GRADIENTS, type Scheme, type RGB } from './color.ts';
import { syncUrl, settingsFromUrl, rollRandom, rollWithLocks } from './permalink.ts';
import { PRESETS } from './presets.ts';
import { testCard, STARTERS, RAMPS } from './demo.ts';

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
let needsResample = false; // set by cols/background input; consumed by redraw()
const icons: { name: string; svg: ParsedSvg }[] = []; // dark->light order
// render() wants a bare ParsedSvg[]; the icon list rarely changes but redraw()
// runs on every slider tick (and every mirror frame), so rebuild that array only
// when the list actually changes. renderIconList() is the single point every
// mutation of `icons` funnels through, so it owns the refresh.
let iconSvgs: ParsedSvg[] = [];
let rendered = false; // a live render exists; the export SVG is built on demand

// FOR EXPORT (svg/png/gif): the <symbol>+<use> form, built at download time.
// It's the one that rasterizes reliably; the inline 'live' form decodes faster
// in micro-benchmarks but breaks <img>/canvas rasterization at full scale
// (spliced transforms). Built on demand: pre-rendering it on every redraw
// doubled the cost of each slider tick for a string almost never used.
function exportSvg(): string {
  if (!cells || icons.length === 0) return '';
  return render(cells, iconSvgs, settings, 'export');
}

// history.replaceState is a browser-level write (and Safari rate-limits it), so
// it does not belong in the same frame as a 10,000-node DOM swap. The permalink
// only has to be current by the time someone can copy it, so it rides an idle
// callback after the paint. Share/export read it synchronously via syncUrlNow().
let urlQueued = false;
const idle: (cb: () => void) => void =
  typeof requestIdleCallback === 'function'
    ? (cb) => { requestIdleCallback(cb, { timeout: 500 }); }
    : (cb) => { setTimeout(cb, 1); };
function syncUrlSoon() {
  if (urlQueued) return;
  urlQueued = true;
  idle(() => { urlQueued = false; syncUrl(settings); });
}

function redraw() {
  syncUrlSoon(); // keep the permalink current even before an image is loaded
  if (!cells || icons.length === 0) return;
  if (needsResample && srcBitmap) {
    cells = sample(srcBitmap, settings);
    gridRows = 0;
    needsResample = false;
  }
  // ON-SCREEN: inline-shapes form — the browser lays out a flat tree instead of
  // cloning a <symbol> shadow subtree per cell (~85x faster paint on big grids).
  const live = render(cells, iconSvgs, settings, 'live');
  out.innerHTML = live;
  rendered = true;
  // Hand the backdrop the fresh markup for its palette sampler. It used to
  // MutationObserver #out and read innerHTML back, which re-serializes 10k+
  // nodes in the same frame as their layout; we already hold the string.
  document.dispatchEvent(new CustomEvent('iconizer:render', { detail: { svg: live } }));
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
// Row count of the current grid, cached: gridDims scans every cell, and the grid
// only changes when we re-sample. 0 means "not computed yet".
let gridRows = 0;
const nudgeEl = document.getElementById('motionPerfNudge');
function refreshMotionPerfNudge() {
  if (!nudgeEl) return;
  const animated = settings.motion !== 'none' && !settings.layered;
  let heavy = false;
  if (animated && cells) {
    if (!gridRows) gridRows = gridDims(cells).rows;
    const block = Math.max(1, settings.blockSize);
    const effectiveCells = (settings.cols * gridRows) / (block * block);
    heavy = effectiveCells > SMOOTH_CELL_BUDGET;
  }
  nudgeEl.hidden = !(animated && heavy);
}

// Single source of truth for export button states (the taskbar Save menu rows).
// SVG/PNG enabled once a render exists; GIF additionally needs motion.
function refreshExportState() {
  const animated = settings.motion !== 'none';
  $<HTMLButtonElement>('dlSvg').disabled = !rendered;
  $<HTMLButtonElement>('dlPng').disabled = !rendered;
  $<HTMLButtonElement>('dlGif').disabled = !rendered || !animated;
}

// Debounce so dragging a slider doesn't thrash render() on every input event,
// then align the surviving redraw to a frame boundary (rAF) so the DOM swap +
// layout land in one paint pass instead of risking a mid-frame double layout.
let timer: number | undefined;
let raf = 0;
function scheduleRedraw() {
  clearTimeout(timer);
  timer = window.setTimeout(() => {
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
  histTimer = window.setTimeout(() => {
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
  await stopMirror(false); // a real upload replaces the live feed outright
  try {
    srcBitmap?.close();              // free the previous image
    srcBitmap = await createImageBitmap(file);
    cells = sample(srcBitmap, settings);
    gridRows = 0;
    needsResample = false; // fresh sample; drop any deferred request
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
  badTimer = window.setTimeout(() => dropwell.classList.remove('bad'), 1600);
}

// click anywhere on the well opens the right file picker for the current stage.
dropwell.addEventListener('click', (e) => {
  // let the webring link and the demo/starter buttons handle their own clicks.
  if ((e.target as HTMLElement).closest('a,button')) return;
  $(dwStage() === 'need-svg' ? 'svg' : 'image').click();
});

// --- one-click demo: built-in test card + a starter icon -> first render -----

/** Add a built-in starter icon by name (same pipeline as an uploaded .svg). */
function addStarter(name: string) {
  icons.push({ name: `${name}.svg (built-in)`, svg: parseSvg(STARTERS[name]) });
  renderIconList();
  refreshPips();
  redraw();
}
$('tryDemo').addEventListener('click', async () => {
  await stopMirror(false); // the demo replaces a live feed outright, like an upload
  srcBitmap?.close();
  srcBitmap = await testCard();
  cells = sample(srcBitmap, settings);
  gridRows = 0;
  needsResample = false;
  $('srcName').textContent = 'testcard (built-in)';
  refreshPips();
  setDwStage('need-svg');
  // an icon may already be loaded (user did stage 2 first); don't double-add.
  if (icons.length === 0) addStarter('heart'); // completes the demo -> renders
  else redraw();
});
document.querySelectorAll<HTMLButtonElement>('.dw-starter').forEach((btn) =>
  btn.addEventListener('click', () => addStarter(btn.dataset.icon!)));

// Ramp packs REPLACE the icon list (order is the whole point: dark -> light).
document.querySelectorAll<HTMLButtonElement>('.ramp-btn').forEach((btn) =>
  btn.addEventListener('click', () => {
    icons.splice(0, icons.length,
      ...RAMPS[btn.dataset.ramp!].map(([name, svg]) => ({ name, svg: parseSvg(svg) })));
    renderIconList();
    refreshPips();
    redraw();
  }));

// --- mirror mode: the webcam becomes the mosaic, live ------------------------
// 100% client-side like everything else: frames go camera -> canvas -> sample(),
// never off the machine. Ticks are LEAN on purpose: they skip redraw()'s
// syncUrl (Safari rate-limits history.replaceState; ~7fps would trip it) and
// the pip/export-state work that doesn't change per frame.
const MIRROR_MS = 150; // ~7fps: flipboard-feel, and the innerHTML swap stays cheap
const mirrorVideo = document.createElement('video');
mirrorVideo.muted = true;
mirrorVideo.playsInline = true;
const mirrorCanvas = document.createElement('canvas');
let mirrorStream: MediaStream | null = null;
let mirrorTimer = 0;
let mirrorSkip = 0; // self-pacing: heavy ticks skip their following slots
let mirrorStarting = false; // getUserMedia is in flight; a second click must not
// open a second stream (the first would leak and hold the camera light on)

function mirrorTick() {
  if (mirrorSkip > 0) { mirrorSkip--; return; }
  if (document.hidden || exportBusy || mirrorVideo.readyState < 2) return;
  const t0 = performance.now();
  const vw = mirrorVideo.videoWidth, vh = mirrorVideo.videoHeight;
  if (!vw) return;
  const k = Math.min(1, 480 / Math.max(vw, vh)); // small: it's resampled anyway
  mirrorCanvas.width = Math.round(vw * k);
  mirrorCanvas.height = Math.round(vh * k);
  const ctx = mirrorCanvas.getContext('2d')!;
  ctx.setTransform(-1, 0, 0, 1, mirrorCanvas.width, 0); // mirror: selfies expect a flip
  ctx.drawImage(mirrorVideo, 0, 0, mirrorCanvas.width, mirrorCanvas.height);
  cells = sample(mirrorCanvas, settings);
  gridRows = 0;
  if (icons.length === 0) return;
  const live = render(cells, iconSvgs, settings, 'live');
  out.innerHTML = live;
  rendered = true;
  document.dispatchEvent(new CustomEvent('iconizer:render', { detail: { svg: live } }));
  // ponytail: self-pacing, not a cap. A huge grid (100+ cols = 10k-node swaps)
  // makes a tick overrun its 150ms slot; skip that many following slots so the
  // frame rate degrades gracefully instead of queueing jank.
  mirrorSkip = Math.floor((performance.now() - t0) / MIRROR_MS);
}

async function startMirror() {
  if (mirrorStarting) return;
  mirrorStarting = true;
  try {
    mirrorStream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 } }, audio: false });
  } catch {
    $('progText').textContent = '✖ NO SIGNAL ✖ camera denied or unavailable';
    return;
  } finally {
    mirrorStarting = false;
  }
  mirrorVideo.srcObject = mirrorStream;
  await mirrorVideo.play();
  srcBitmap?.close(); // the live feed replaces any uploaded image
  srcBitmap = null;
  needsResample = false;
  $('mirrorBtn').textContent = '📹 STOP (freeze frame)';
  $('srcName').textContent = 'webcam mirror (live)';
  if (icons.length === 0) addStarter('heart'); // complete the loop: render NOW
  mirrorTick();
  redraw(); // one full pass (pips, export state, boot cascade), then lean ticks
  mirrorTimer = window.setInterval(mirrorTick, MIRROR_MS);
  // camera revoked/unplugged mid-run -> freeze what we have.
  mirrorStream.getVideoTracks()[0]?.addEventListener('ended', () => stopMirror());
}

/** Stop the feed. `freeze` keeps the last frame as the working image, so the
 *  sliders and exports operate on your frozen self (the fun part). */
async function stopMirror(freeze = true) {
  if (!mirrorTimer) return;
  clearInterval(mirrorTimer);
  mirrorTimer = 0;
  mirrorStream?.getTracks().forEach((t) => t.stop());
  mirrorStream = null;
  $('mirrorBtn').textContent = '📹 MIRROR MODE';
  if (freeze && mirrorCanvas.width) {
    srcBitmap = await createImageBitmap(mirrorCanvas);
    $('srcName').textContent = 'mirror freeze-frame';
    redraw(); // full pass so the permalink + export state catch up
  }
}
$('mirrorBtn').addEventListener('click', () => {
  // fire-and-forget: both paths surface their own failures (NO SIGNAL text).
  if (mirrorTimer) void stopMirror();
  else void startMirror();
});

// One-click anaglyph poster: the red/cyan-glasses look with a real offset. Goes
// through the same heavy-combo gate as the layered checkbox.
$('poster3d').addEventListener('click', async () => {
  if (needsHeavyWarning({ layered: true })) {
    if (!(await confirmHeavy())) return;
    heavyAccepted = true;
  }
  settings.layered = true;
  settings.layerStyle = 'anaglyph';
  settings.layerOffset = Math.max(2, settings.layerOffset); // fan the ghosts apart
  syncControls();
  redraw();
  commitHistory(); // one undoable step, like a roll
});
['dragenter', 'dragover'].forEach((ev) =>
  dropwell.addEventListener(ev, (e) => { e.preventDefault(); dropwell.classList.add('drop-hot'); }),
);
['dragleave', 'drop'].forEach((ev) =>
  dropwell.addEventListener(ev, () => dropwell.classList.remove('drop-hot')),
);
dropwell.addEventListener('drop', async (e) => {
  e.preventDefault();
  const file = e.dataTransfer?.files?.[0]; // 'drop' listener, e is already DragEvent
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
  iconSvgs = icons.map((i) => i.svg); // keep render()'s input in step with the list
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

// cols and background change the sampled grid, so they must re-sample. Deferred
// to the debounced redraw: the raw input event fires dozens of times per slider
// drag and sample() walks the whole image. (The decoded bitmap is cached from
// load, so even then it's just a re-sample, no re-decode.)
function resample() {
  needsResample = true;
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

// layout and cutout only change placement / which cells emit — no resample.
$('layout').addEventListener('change', (e) => {
  settings.layout = (e.target as HTMLSelectElement).value as Settings['layout'];
  scheduleRedraw();
});
const cutoutLabel = (v: number) => (v > 0 ? `> ${v.toFixed(2)} gone` : 'off');
$('cutout').addEventListener('input', (e) => {
  settings.cutout = +(e.target as HTMLInputElement).value;
  $('cutoutVal').textContent = cutoutLabel(settings.cutout);
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
  const mode = $<HTMLSelectElement>('rotate').value;
  disclose('p-rotate', mode !== 'none');
  if (mode !== 'none') $('rotateHint').innerHTML = ROTATE_HINTS[mode];
  $('rotateDegVal').textContent = `${$<HTMLInputElement>('rotateDeg').value}°`;
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
  const kind = $<HTMLSelectElement>('scheme').value;
  switch (kind) {
    case 'threshold':
      return { kind, cutoff: +$<HTMLInputElement>('thresh').value };
    case 'hue':
      return { kind, deg: +$<HTMLInputElement>('hueDeg').value };
    case 'posterize':
      return { kind, levels: +$<HTMLInputElement>('levels').value };
    case 'duotone':
      return { kind, dark: hex2rgb($<HTMLInputElement>('duoDark').value),
        light: hex2rgb($<HTMLInputElement>('duoLight').value) };
    case 'tritone':
      return { kind, dark: hex2rgb($<HTMLInputElement>('triDark').value),
        mid: hex2rgb($<HTMLInputElement>('triMid').value),
        light: hex2rgb($<HTMLInputElement>('triLight').value) };
    case 'solarize':
      return { kind, cutoff: +$<HTMLInputElement>('solCutoff').value };
    case 'channelswap':
      return { kind, order: $<HTMLSelectElement>('swapOrder').value };
    case 'palette': {
      const preset = $<HTMLSelectElement>('palettePreset').value;
      const colors = preset === 'custom'
        ? ['pal0', 'pal1', 'pal2'].map((id) => hex2rgb($<HTMLInputElement>(id).value))
        : PALETTES[preset];
      return { kind, colors };
    }
    case 'gradient': {
      const preset = $<HTMLSelectElement>('gradientPreset').value;
      const stops = preset === 'custom'
        ? ['grad0', 'grad1', 'grad2', 'grad3'].map((id) => hex2rgb($<HTMLInputElement>(id).value))
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
  const kind = $<HTMLSelectElement>('scheme').value;
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
    && $<HTMLSelectElement>('palettePreset').value === 'custom');
  disclose('p-gradient-custom', kind === 'gradient'
    && $<HTMLSelectElement>('gradientPreset').value === 'custom');
  $('levelsVal').textContent = `${$<HTMLInputElement>('levels').value} steps`;
  $('threshVal').textContent = (+$<HTMLInputElement>('thresh').value).toFixed(2);
  $('hueDegVal').textContent = `${$<HTMLInputElement>('hueDeg').value}°`;
  $('solCutoffVal').textContent = (+$<HTMLInputElement>('solCutoff').value).toFixed(2);
  $('schemeHint').hidden = kind !== 'none'; // hint only while nothing's picked
}

// The disclosure insets (scheme insets are handled by syncSchemeUI).
function syncDisclosure() {
  disclose('p-sizeRange', $<HTMLInputElement>('sizeByBrightness').checked);
  disclose('p-fadeRange', $<HTMLInputElement>('fadeByBrightness').checked);
  disclose('p-dither', $<HTMLInputElement>('dither').checked);
  disclose('p-overlay', $<HTMLSelectElement>('overlayDir').value !== 'none');
  disclose('p-layered', $<HTMLInputElement>('layered').checked);
  disclose('p-motion', $<HTMLSelectElement>('motion').value !== 'none');
  syncRotateUI();
  syncIconMetricUI();
  refreshExportState();
}

// --- adjust panel (sat/bright/contrast/temp) — pre-scheme, always live -------
function readAdjust(): Settings['adjust'] {
  return {
    brightness: +$<HTMLInputElement>('adjBright').value,
    contrast: +$<HTMLInputElement>('adjContrast').value,
    saturation: +$<HTMLInputElement>('adjSat').value,
    temperature: +$<HTMLInputElement>('adjTemp').value,
  };
}
for (const [id, label] of [['adjBright', 'adjBrightVal'], ['adjContrast', 'adjContrastVal'],
  ['adjSat', 'adjSatVal'], ['adjTemp', 'adjTempVal']] as const) {
  $(id).addEventListener('input', () => {
    settings.adjust = readAdjust();
    $(label).textContent = (+$<HTMLInputElement>(id).value).toFixed(2);
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
    dir: $<HTMLSelectElement>('overlayDir').value as Settings['overlay']['dir'],
    preset: $<HTMLSelectElement>('overlayPreset').value,
    blend: $<HTMLSelectElement>('overlayBlend').value as Settings['overlay']['blend'],
    strength: +$<HTMLInputElement>('overlayStrength').value,
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
$('motionReactive').addEventListener('change', (e) => {
  settings.motionReactive = (e.target as HTMLInputElement).checked;
  scheduleRedraw();
});
// Tell the p5 backdrop (and the mirror tick) to pause while a raster export
// runs (they fight the encode for the main thread / GPU).
let exportBusy = false;
const setExportBusy = (busy: boolean) => {
  exportBusy = busy;
  document.dispatchEvent(new CustomEvent('iconizer:export', { detail: { busy } }));
};

$('dlSvg').addEventListener('click', () => {
  const svg = exportSvg();
  if (svg) downloadSvg(svg);
});
$('dlPng').addEventListener('click', async () => {
  if (!rendered) return;
  setStatus('exporting'); setProg(30);
  setExportBusy(true);
  try {
    await downloadPng(exportSvg(), +$<HTMLSelectElement>('scale').value);
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
  if (!rendered || settings.motion === 'none') return;
  const btn = $<HTMLButtonElement>('dlGif');
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
    await downloadGif(exportSvg(), settings.motion, settings.motionSpeed, +$<HTMLSelectElement>('scale').value, frames);
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
    const el = $<HTMLInputElement>(id);
    if (typeof v === 'boolean') el.checked = v;
    else el.value = String(v);
  };
  set('cols', settings.cols); $('colsVal').textContent = String(settings.cols);
  set('blockSize', settings.blockSize);
  $('blockVal').textContent = settings.blockSize > 1 ? `${settings.blockSize}×${settings.blockSize} chonk` : '1×1';
  set('iconScale', settings.iconScale); $('iconScaleVal').textContent = String(settings.iconScale);
  set('layout', settings.layout);
  set('cutout', settings.cutout); $('cutoutVal').textContent = cutoutLabel(settings.cutout);
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
  set('motionReactive', settings.motionReactive);
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

// --- Win98 tabbed property sheets: one generic switcher per .tabs strip ------
document.querySelectorAll<HTMLElement>('.tabs').forEach((strip) => {
  const tabs = Array.from(strip.querySelectorAll<HTMLButtonElement>('.tab'));
  const select = (tab: HTMLButtonElement) => {
    for (const t of tabs) {
      t.setAttribute('aria-selected', String(t === tab));
      $(t.getAttribute('aria-controls')!).hidden = t !== tab;
    }
  };
  strip.addEventListener('click', (e) => {
    const tab = (e.target as HTMLElement).closest<HTMLButtonElement>('.tab');
    if (tab) select(tab);
  });
  strip.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const i = tabs.indexOf(document.activeElement as HTMLButtonElement);
    if (i < 0) return;
    const next = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
    next.focus();
    select(next);
  });
});

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
    if ($<HTMLInputElement>(id).checked) set.add(group);
  return set;
}

// One roll, honouring the holds. Reachable from the Start menu (reroll from
// anywhere) AND from the button inside the Lab window.
function doRoll() {
  Object.assign(settings, rollWithLocks(settings, rollRandom(), heldGroups()));
  syncControls();
  resample(); // the roll changes cols/background; without this the density stays
  // stale and render() sizes output from the NEW cols over the OLD grid
  // (letterboxed exports).
  redraw();
  syncUrl(settings); // a roll is a discrete action: the link reflects it immediately
  commitHistory(); // a roll is one undoable step
}
$('surprise').addEventListener('click', doRoll);

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
  resample(); // presets carry their own cols/background (see doRoll)
  redraw();
  syncUrl(settings); // discrete action, like a roll: don't wait for an idle slot
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
  // fire-and-forget: applySettings only awaits the heavy-combo dialog.
  void applySettings(PRESETS[+item.dataset.i!].settings);
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
const closeSoon = () => { cancelClose(); favCloseTimer = window.setTimeout(closeFav, 220); };
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
  setPip('pipReady', rendered);
  $('pipImg').setAttribute('aria-label', cells ? 'picture: loaded ♡' : 'picture: not loaded');
  $('pipSvg').setAttribute('aria-label', icons.length ? 'icon .svg: ready ✦' : 'icon .svg: none yet, add one!');
  $('pipReady').setAttribute('aria-label', rendered ? 'render: ready to save ✦' : 'render: not ready');
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

// --- Properties sheet: the current mosaic's own stats (a fake document props) ----

// Bytes -> a friendly "12.3 KB" / "1.1 MB" string (the Win98 size line).
function fmtBytes(n: number): string {
  if (n < 1024) return `${n} bytes`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

// Plain-words summary of the active scheme / motion / layer style (the "Contains" line).
const SCHEME_WORDS: Record<string, string> = {
  none: 'true colour', grayscale: 'grayscale', invert: 'inverted', sepia: 'sepia',
  threshold: '1-bit threshold', hue: 'hue-rotated', posterize: 'posterized',
  duotone: 'duotone', tritone: 'tritone', gradient: 'gradient map', solarize: 'solarized',
  channelswap: 'channel-swapped', palette: 'palette-snapped',
};
const LAYER_WORDS: Record<string, string> = {
  cmy: 'CMY split', cmyk: 'CMYK split', ryb: 'RYB split', rgb: 'RGB split',
  anaglyph: 'red/cyan 3D', halftone: 'halftone rosette',
};

/** Per-ink share for layered styles, derived from the page's own ink list math.
 *  A vibe-accurate breakdown ("C 33% / M 33% / Y 34%"), not a colour-managed reading. */
function inkBreakdown(): string | null {
  if (!settings.layered) return null;
  const map: Record<string, string[]> = {
    cmy: ['C', 'M', 'Y'], cmyk: ['C', 'M', 'Y', 'K'], halftone: ['C', 'M', 'Y', 'K'],
    ryb: ['R', 'Y', 'B'], rgb: ['R', 'G', 'B'], anaglyph: ['red', 'cyan'],
  };
  let inks = map[settings.layerStyle] ?? [];
  if ((settings.layerStyle === 'cmy' || settings.layerStyle === 'ryb') && settings.layerCount === 2)
    inks = inks.slice(0, 2);
  if (!inks.length) return null;
  // even split, with the remainder dropped on the last ink so it sums to 100.
  const each = Math.floor(100 / inks.length);
  return inks.map((n, i) => `${n} ${i === inks.length - 1 ? 100 - each * (inks.length - 1) : each}%`).join(' / ');
}

const propsModal = $('propsModal');
function openProperties() {
  const svg = exportSvg(); // built on demand; a modal open can afford one render
  // dimensions: the export SVG's width/height attrs are the real pixel footprint.
  const wh = /width="([\d.]+)" height="([\d.]+)"/.exec(svg); // hex height is fractional
  const dims = wh ? `${wh[1]} x ${wh[2]} px` : 'not rendered yet';
  // cells = cols x rows after pooling; derive rows from the viewBox (H / CELL=16).
  const vb = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(svg);
  const cols = settings.cols, rows = vb ? Math.round(+vb[2] / 16) : 0;
  const cellCount = svg ? cols * rows : 0;

  const rows2: [string, string][] = [
    ['Type:', 'Iconizer 98 Document (.ico)'],
    ['Size:', svg ? fmtBytes(svg.length) : 'nothing rendered'],
    ['Dimensions:', dims],
    ['Cells:', svg ? `${cellCount.toLocaleString()} (${cols} x ${rows})` : '0'],
    ['Tiles:', `${icons.length} icon${icons.length === 1 ? '' : 's'}`],
    ['Colour:', SCHEME_WORDS[settings.scheme.kind] ?? settings.scheme.kind],
    ['Motion:', settings.motion === 'none' ? 'static' : settings.motion + (settings.motionReactive ? ' (reactive)' : '')],
  ];
  if (settings.layered) rows2.push(['Layered:', LAYER_WORDS[settings.layerStyle] ?? settings.layerStyle]);
  const ink = inkBreakdown();
  if (ink) rows2.push(['Ink:', ink]);
  // flavor lines (verbatim, on-theme)
  rows2.push(['Colours:', '16-bit (65,536)'], ['Read-only:', 'No'], ['Created with:', 'Iconizer 98']);

  $('propsGrid').innerHTML = rows2
    .map(([k, v]) => `<span class="k">${k}</span><span class="v">${v}</span>`).join('');
  propsModal.hidden = false;
  $<HTMLButtonElement>('propsOk').focus();
}
function closeProperties() { propsModal.hidden = true; }
$('propsOk').addEventListener('click', closeProperties);
$('propsClose').addEventListener('click', closeProperties);
$('propsModal').addEventListener('click', (e) => { if (e.target === propsModal) closeProperties(); }); // backdrop
$('propsMenuItem').addEventListener('click', () => { openProperties(); setStart(false); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !propsModal.hidden) closeProperties(); });

// --- CRT right-click context menu (Randomize · export · Properties) -------------

const crtMenu = $('crtMenu');
// Copy-image only exists where the clipboard API supports it; reveal it once at init.
if (canCopyImage()) (crtMenu.querySelector('[data-act="copy"]') as HTMLElement).hidden = false;
function openCrtMenu(x: number, y: number) {
  // gate the export rows on a render existing (same `rendered` flag the Save menu uses).
  crtMenu.querySelectorAll<HTMLButtonElement>('.ctx-item').forEach((b) => {
    const a = b.dataset.act!;
    b.disabled = (a === 'svg' || a === 'png' || a === 'copy' || a === 'properties') ? !rendered
      : a === 'gif' ? (!rendered || settings.motion === 'none') : false; // randomize always on
  });
  crtMenu.hidden = false;
  // place at the cursor, then nudge back inside the viewport if it would overflow.
  const r = crtMenu.getBoundingClientRect();
  crtMenu.style.left = `${Math.min(x, window.innerWidth - r.width - 4)}px`;
  crtMenu.style.top = `${Math.min(y, window.innerHeight - r.height - 4)}px`;
}
const closeCrtMenu = () => { crtMenu.hidden = true; };
crt.addEventListener('contextmenu', (e) => {
  e.preventDefault(); // suppress the browser menu, show ours
  openCrtMenu(e.clientX, e.clientY);
});
crtMenu.addEventListener('click', (e) => {
  const item = (e.target as HTMLElement).closest<HTMLButtonElement>('.ctx-item');
  if (!item || item.disabled) return;
  closeCrtMenu();
  switch (item.dataset.act) {
    case 'randomize': doRoll(); break;        // same as Surprise Me
    case 'copy': void copyImage(); break;     // catches internally (progText)
    case 'svg': $<HTMLButtonElement>('dlSvg').click(); break;
    case 'png': $<HTMLButtonElement>('dlPng').click(); break;
    case 'gif': $<HTMLButtonElement>('dlGif').click(); break;
    case 'properties': openProperties(); break;
    default: break; // unknown/missing data-act: ignore
  }
});

// Copy the clean rendered mosaic (the image, no CRT chrome) to the clipboard.
async function copyImage() {
  const svg = exportSvg();
  if (!svg) return;
  setStatus('exporting'); setProg(40);
  try {
    await copyPng(svg); // scale 1 — a quick snapshot, not a print-res export
    setProg(100);
    $('progText').textContent = '📋 COPIED TO CLIPBOARD';
  } catch {
    $('progText').textContent = '✖ COPY FAILED';
  } finally {
    setTimeout(() => { setStatus('ready'); setProg(0); }, 900);
  }
}
// dismiss on any outside click / Escape / scroll
document.addEventListener('click', (e) => { if (!crtMenu.hidden && !crtMenu.contains(e.target as Node)) closeCrtMenu(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !crtMenu.hidden) closeCrtMenu(); });
window.addEventListener('scroll', () => { if (!crtMenu.hidden) closeCrtMenu(); }, true);

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
const quickSave = $<HTMLButtonElement>('quickSave');
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
const allWins = ['winPics', 'winGrid', 'winLayer', 'winScheme', 'winMotion'];
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
