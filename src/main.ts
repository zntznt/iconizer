import { defaults, type Settings } from './settings.ts';
import { sample, type Cell } from './sample.ts';
import { parseSvg, type ParsedSvg } from './parseSvg.ts';
import { render } from './render.ts';
import { downloadSvg, downloadPng, downloadGif } from './export.ts';
import type { Scheme, RGB } from './color.ts';
import { syncUrl, settingsFromUrl, rollRandom } from './permalink.ts';

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
const icons: { name: string; svg: ParsedSvg }[] = []; // dark->light order
let lastSvg = ''; // latest render() output, reused by export (no re-render)

function redraw() {
  syncUrl(settings); // keep the permalink current even before an image is loaded
  if (!cells || icons.length === 0) return;
  lastSvg = render(cells, icons.map((i) => i.svg), settings);
  out.innerHTML = lastSvg;
  refreshExportState();
  refreshPips();
  setStatus('ready');
}

// Single source of truth for export button states. SVG/PNG enabled once a render
// exists; GIF additionally needs motion (shown visible-but-disabled with a reason,
// not hidden, so users learn why). Mirrors into the footer quick-save proxies.
function refreshExportState() {
  const rendered = !!lastSvg;
  const animated = settings.motion !== 'none';
  ($('dlSvg') as HTMLButtonElement).disabled = !rendered;
  ($('dlPng') as HTMLButtonElement).disabled = !rendered;
  ($('dlGif') as HTMLButtonElement).disabled = !rendered || !animated;
  const note = document.getElementById('gifNote');
  if (note) note.textContent = animated ? 'animated · ready' : 'animated · needs Motion FX';
  syncQuickSave();
}

// Debounce so dragging a slider doesn't thrash render() on every input event.
let timer: number | undefined;
function scheduleRedraw() {
  clearTimeout(timer);
  timer = setTimeout(redraw, 50);
}

async function loadImage(file: File) {
  if (!file.type.startsWith('image/')) return;
  const bitmap = await createImageBitmap(file);
  cells = sample(bitmap, settings);
  bitmap.close();
  $('srcName').textContent = file.name;
  refreshPips(); // light the picture pip even before an icon is added
  redraw();
}

$('image').addEventListener('change', (e) => {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (file) loadImage(file);
});

// Empty-state drop-well: drag an image onto the CRT to load it (the click-to-pick
// is native via the <label for="image">). drop-hot class lights the dashed frame.
const dropwell = $('dropwell');
['dragenter', 'dragover'].forEach((ev) =>
  dropwell.addEventListener(ev, (e) => { e.preventDefault(); dropwell.classList.add('drop-hot'); }),
);
['dragleave', 'drop'].forEach((ev) =>
  dropwell.addEventListener(ev, () => dropwell.classList.remove('drop-hot')),
);
dropwell.addEventListener('drop', (e) => {
  e.preventDefault();
  const file = (e as DragEvent).dataTransfer?.files?.[0];
  if (file) loadImage(file);
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
}

// Add one or more SVGs to the list (the file input allows multiple).
$('svg').addEventListener('change', async (e) => {
  const files = (e.target as HTMLInputElement).files;
  if (!files?.length) return;
  for (const file of files) {
    try {
      icons.push({ name: file.name, svg: parseSvg(await file.text()) });
    } catch {
      alert(`Couldn't parse ${file.name} — skipped.`);
    }
  }
  (e.target as HTMLInputElement).value = ''; // allow re-adding the same file
  renderIconList();
  refreshPips();
  redraw();
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

// cols and background change the sampled grid, so they must re-sample. We only
// have the bitmap at upload time; cheapest is to re-read the File from the input.
async function resample() {
  const file = ($('image') as HTMLInputElement).files?.[0];
  if (!file) return;
  const bitmap = await createImageBitmap(file);
  cells = sample(bitmap, settings);
  bitmap.close();
}

$('cols').addEventListener('input', async (e) => {
  settings.cols = +(e.target as HTMLInputElement).value;
  $('colsVal').textContent = String(settings.cols);
  await resample();
  scheduleRedraw();
});

// blockSize pools the already-sampled grid (no resample) — just redraw.
$('blockSize').addEventListener('input', (e) => {
  settings.blockSize = +(e.target as HTMLInputElement).value;
  $('blockVal').textContent = `${settings.blockSize}×${settings.blockSize}`;
  scheduleRedraw();
});

// iconScale only affects rendering (not sampling), so no resample — just redraw.
$('iconScale').addEventListener('input', (e) => {
  settings.iconScale = +(e.target as HTMLInputElement).value;
  $('iconScaleVal').textContent = String(settings.iconScale);
  scheduleRedraw();
});

$('background').addEventListener('input', async (e) => {
  settings.background = (e.target as HTMLInputElement).value;
  await resample();
  scheduleRedraw();
});

$('sizeByBrightness').addEventListener('change', (e) => {
  settings.sizeByBrightness = (e.target as HTMLInputElement).checked;
  disclose('p-sizeRange', (e.target as HTMLInputElement).checked);
  scheduleRedraw();
});
$('sizeMin').addEventListener('input', (e) => {
  settings.sizeRange[0] = +(e.target as HTMLInputElement).value;
  scheduleRedraw();
});
$('sizeMax').addEventListener('input', (e) => {
  settings.sizeRange[1] = +(e.target as HTMLInputElement).value;
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
$('layerStyle').addEventListener('change', (e) => {
  settings.layerStyle = (e.target as HTMLSelectElement).value as Settings['layerStyle'];
  scheduleRedraw();
});
$('layerCount').addEventListener('change', (e) => {
  settings.layerCount = +(e.target as HTMLSelectElement).value as 2 | 3;
  scheduleRedraw();
});
$('layerOffset').addEventListener('input', (e) => {
  settings.layerOffset = +(e.target as HTMLInputElement).value;
  scheduleRedraw();
});

// hex "#rrggbb" -> RGB
const hex2rgb = (h: string): RGB => ({
  r: parseInt(h.slice(1, 3), 16),
  g: parseInt(h.slice(3, 5), 16),
  b: parseInt(h.slice(5, 7), 16),
});

function readScheme(): Scheme {
  const kind = ($('scheme') as HTMLSelectElement).value;
  switch (kind) {
    case 'posterize':
      return { kind, levels: +($('levels') as HTMLInputElement).value };
    case 'duotone':
      return { kind, dark: hex2rgb(($('duoDark') as HTMLInputElement).value),
        light: hex2rgb(($('duoLight') as HTMLInputElement).value) };
    case 'palette':
      return { kind, colors: ['pal0', 'pal1', 'pal2'].map((id) => hex2rgb(($(id) as HTMLInputElement).value)) };
    default:
      return { kind } as Scheme; // none | grayscale | invert
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
  disclose('p-duotone', kind === 'duotone');
  disclose('p-palette', kind === 'palette');
}

// The three NEW disclosure insets (scheme insets are handled by syncSchemeUI).
function syncDisclosure() {
  disclose('p-sizeRange', ($('sizeByBrightness') as HTMLInputElement).checked);
  disclose('p-layered', ($('layered') as HTMLInputElement).checked);
  disclose('p-motion', ($('motion') as HTMLSelectElement).value !== 'none');
  refreshExportState();
}

for (const id of ['scheme', 'levels', 'duoDark', 'duoLight', 'pal0', 'pal1', 'pal2']) {
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
  scheduleRedraw();
});
$('staggerMode').addEventListener('change', (e) => {
  settings.staggerMode = (e.target as HTMLSelectElement).value as Settings['staggerMode'];
  scheduleRedraw();
});
$('dlSvg').addEventListener('click', () => {
  if (lastSvg) downloadSvg(lastSvg);
});
$('dlPng').addEventListener('click', async () => {
  if (!lastSvg) return;
  setStatus('exporting'); setProg(30);
  await downloadPng(lastSvg, +($('scale') as HTMLSelectElement).value);
  setProg(100); setTimeout(() => { setStatus('ready'); setProg(0); }, 400);
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
  try {
    await downloadGif(lastSvg, settings.motion, settings.motionSpeed, +($('scale') as HTMLSelectElement).value);
    setProg(100);
  } finally {
    clearInterval(creep);
    btn.disabled = false;
    btn.textContent = old;
    setTimeout(() => { setStatus('ready'); setProg(0); }, 400);
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
  set('blockSize', settings.blockSize); $('blockVal').textContent = `${settings.blockSize}×${settings.blockSize}`;
  set('iconScale', settings.iconScale); $('iconScaleVal').textContent = String(settings.iconScale);
  set('background', settings.background);
  set('sizeByBrightness', settings.sizeByBrightness);
  set('sizeMin', settings.sizeRange[0]);
  set('sizeMax', settings.sizeRange[1]);
  set('layered', settings.layered);
  set('layerStyle', settings.layerStyle);
  set('layerCount', settings.layerCount);
  set('layerOffset', settings.layerOffset);
  set('motion', settings.motion);
  set('motionSpeed', settings.motionSpeed);
  set('staggerMode', settings.staggerMode);
  // scheme + its conditional sub-controls
  set('scheme', settings.scheme.kind);
  if (settings.scheme.kind === 'posterize') set('levels', settings.scheme.levels);
  if (settings.scheme.kind === 'duotone') {
    set('duoDark', rgb2hex(settings.scheme.dark));
    set('duoLight', rgb2hex(settings.scheme.light));
  }
  if (settings.scheme.kind === 'palette') {
    settings.scheme.colors.slice(0, 3).forEach((c, i) => set(`pal${i}`, rgb2hex(c)));
  }
  syncSchemeUI();
  syncDisclosure(); // restore the 3 new insets from current control values
}

// Apply settings loaded from a permalink to the controls on startup.
syncControls();
refreshPips(); // initial LED states (no image/svg/render yet)
// A permalink or roll can arrive with the heavy combo already on; don't nag about
// a state the user didn't just create by hand.
if (settings.layered && settings.motion !== 'none') heavyAccepted = true;

$('surprise').addEventListener('click', () => {
  Object.assign(settings, rollRandom()); // rollRandom never produces the heavy combo
  syncControls();
  redraw(); // immediate (also writes the new URL), so the link reflects the roll
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
  $('pipSvg').setAttribute('aria-label', icons.length ? 'icon .svg: ready ✦' : 'icon .svg: none yet — add one!');
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
  if ((e.target as HTMLElement).closest('[role=menuitem]')) setStart(false);
});

// quick-save split button: proxies click the canonical export buttons in Export.exe.
const quickSave = $('quickSave') as HTMLButtonElement;
const qsMenu = $('quickSaveMenu');
quickSave.addEventListener('click', () => {
  qsMenu.hidden = !qsMenu.hidden;
  quickSave.setAttribute('aria-expanded', String(!qsMenu.hidden));
});
document.addEventListener('click', (e) => {
  if (!qsMenu.hidden && !qsMenu.contains(e.target as Node) && e.target !== quickSave) qsMenu.hidden = true;
});
qsMenu.querySelectorAll<HTMLButtonElement>('.qs-item').forEach((item) => {
  item.addEventListener('click', () => {
    ($(item.dataset.proxy!) as HTMLButtonElement).click(); // fire the real export
    qsMenu.hidden = true;
  });
});
// keep proxy items' disabled state mirrored from the canonical buttons. Queries
// the DOM lazily (not a closed-over const) so it's safe to call during startup,
// before the quick-save const below is initialized (avoids a TDZ ReferenceError).
function syncQuickSave() {
  document.querySelectorAll<HTMLButtonElement>('.qs-item').forEach((item) => {
    const real = $(item.dataset.proxy!) as HTMLButtonElement;
    item.disabled = real.disabled || real.hidden;
  });
}

// --- minimize / restore windows (genie animation) ---------------------------

const tasks = Array.from(document.querySelectorAll<HTMLButtonElement>('.task'));
const byWin = new Map(tasks.map((t) => [t.dataset.win!, t]));
const taskFor = (win: HTMLElement) => byWin.get(win.id);

// Two-phase genie: .minimizing runs the transform/fade transition while the window
// still holds its grid slot; on transitionend, .minimized (display:none) drops it
// out so the grid reflows. Restore reverses.
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
    win.classList.add('minimized');
    win.classList.remove('minimizing');
  };
  win.addEventListener('transitionend', (e) => { if (e.propertyName === 'transform') finish(); }, { once: true });
  setTimeout(finish, 400);
}
function restoreWin(win: HTMLElement) {
  taskFor(win)?.classList.remove('stowed');
  if (!win.classList.contains('minimized')) return;
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) { win.classList.remove('minimized'); return; }
  // pop back into the grid at the shrunk state, then release on next frame to genie up.
  win.classList.add('minimizing');
  win.classList.remove('minimized');
  requestAnimationFrame(() => requestAnimationFrame(() => win.classList.remove('minimizing')));
  win.scrollIntoView({ behavior: 'smooth', block: 'center' });
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
