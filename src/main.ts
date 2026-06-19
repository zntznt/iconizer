import { defaults, type Settings } from './settings.ts';
import { sample, type Cell } from './sample.ts';
import { parseSvg, type ParsedSvg } from './parseSvg.ts';
import { render } from './render.ts';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const out = $('out');
const settings: Settings = { ...defaults };

// Inputs that don't change every render: cache the parsed results.
let cells: Cell[] | null = null;
let icon: ParsedSvg | null = null;

function redraw() {
  if (!cells || !icon) return;
  out.innerHTML = render(cells, icon, settings);
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

$('svg').addEventListener('change', async (e) => {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  icon = parseSvg(await file.text());
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

$('background').addEventListener('input', async (e) => {
  settings.background = (e.target as HTMLInputElement).value;
  await resample();
  scheduleRedraw();
});

$('tintMode').addEventListener('change', (e) => {
  settings.tintMode = (e.target as HTMLSelectElement).value as Settings['tintMode'];
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
