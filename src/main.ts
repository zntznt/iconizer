import { defaults, type Settings } from './settings.ts';
import { sample, type Cell } from './sample.ts';
import { parseSvg, type ParsedSvg } from './parseSvg.ts';
import { render } from './render.ts';
import { downloadSvg, downloadPng } from './export.ts';
import type { Scheme, RGB } from './color.ts';
import { syncUrl, settingsFromUrl, rollRandom } from './permalink.ts';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const out = $('out');
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
  ($('dlSvg') as HTMLButtonElement).disabled = false;
  ($('dlPng') as HTMLButtonElement).disabled = false;
}

// Debounce so dragging a slider doesn't thrash render() on every input event.
let timer: number | undefined;
function scheduleRedraw() {
  clearTimeout(timer);
  timer = setTimeout(redraw, 50);
}

$('image').addEventListener('change', async (e) => {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  const bitmap = await createImageBitmap(file);
  cells = sample(bitmap, settings);
  bitmap.close();
  redraw();
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
  redraw();
});

// Remove an icon (event delegation on the list).
$('iconList').addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest('button');
  if (!btn) return;
  icons.splice(+btn.dataset.i!, 1);
  renderIconList();
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

$('layered').addEventListener('change', (e) => {
  settings.layered = (e.target as HTMLInputElement).checked;
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

function syncSchemeUI() {
  const kind = ($('scheme') as HTMLSelectElement).value;
  ($('p-levels') as HTMLElement).hidden = kind !== 'posterize';
  ($('p-duotone') as HTMLElement).hidden = kind !== 'duotone';
  ($('p-palette') as HTMLElement).hidden = kind !== 'palette';
}

for (const id of ['scheme', 'levels', 'duoDark', 'duoLight', 'pal0', 'pal1', 'pal2']) {
  $(id).addEventListener('input', () => {
    settings.scheme = readScheme();
    syncSchemeUI();
    scheduleRedraw();
  });
}

$('motion').addEventListener('change', (e) => {
  settings.motion = (e.target as HTMLSelectElement).value as Settings['motion'];
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
$('dlPng').addEventListener('click', () => {
  if (lastSvg) downloadPng(lastSvg, +($('scale') as HTMLSelectElement).value);
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
}

// Apply settings loaded from a permalink to the controls on startup.
syncControls();

$('surprise').addEventListener('click', () => {
  Object.assign(settings, rollRandom());
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
