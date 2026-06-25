import assert from 'node:assert/strict';
import { transformColor, adjustColor, overlayColor, bayer, schemeQuantizes,
  NEUTRAL_ADJUST, PALETTES, GRADIENTS, rgbToHsl, hslToRgb, type RGB } from './color.ts';

const rgb = (r: number, g: number, b: number): RGB => ({ r, g, b });

// grayscale: rgb(255,0,0) -> r==g==b == round(0.2126*255) ≈ 54
const gray = transformColor(rgb(255, 0, 0), { kind: 'grayscale' });
assert.ok(gray.r === gray.g && gray.g === gray.b, 'grayscale channels equal');
assert.equal(gray.r, Math.round(0.2126 * 255), 'grayscale luma');

// invert: black -> white
assert.deepEqual(transformColor(rgb(0, 0, 0), { kind: 'invert' }), rgb(255, 255, 255));

// posterize levels:2 -> each channel 0 or 255
const post = transformColor(rgb(100, 200, 50), { kind: 'posterize', levels: 2 });
for (const v of [post.r, post.g, post.b]) assert.ok(v === 0 || v === 255, `posterize ${v}`);

// palette of [red, blue] on rgb(200,0,40) -> snaps to red (nearer)
const snap = transformColor(rgb(200, 0, 40),
  { kind: 'palette', colors: [rgb(255, 0, 0), rgb(0, 0, 255)] });
assert.deepEqual(snap, rgb(255, 0, 0), 'palette snaps to nearest (red)');

// none is identity
assert.deepEqual(transformColor(rgb(123, 45, 67), { kind: 'none' }), rgb(123, 45, 67));

// sepia: white stays ~white-ish but warm; black stays black; a gray warms up
assert.deepEqual(transformColor(rgb(0, 0, 0), { kind: 'sepia' }), rgb(0, 0, 0), 'sepia black');
const sep = transformColor(rgb(128, 128, 128), { kind: 'sepia' });
assert.ok(sep.r > sep.g && sep.g > sep.b, 'sepia warms: r > g > b');

// threshold: luma below cutoff -> black, at/above -> white
assert.deepEqual(transformColor(rgb(0, 0, 0), { kind: 'threshold', cutoff: 0.5 }), rgb(0, 0, 0));
assert.deepEqual(transformColor(rgb(255, 255, 255), { kind: 'threshold', cutoff: 0.5 }), rgb(255, 255, 255));

// hue: 0deg is identity (within rounding); 360deg too
const h0 = transformColor(rgb(200, 50, 100), { kind: 'hue', deg: 0 });
assert.ok(Math.abs(h0.r - 200) <= 1 && Math.abs(h0.g - 50) <= 1 && Math.abs(h0.b - 100) <= 1,
  'hue 0deg ~ identity');

// tritone: luma 0 -> dark stop, luma 1 -> light stop, mid-ish -> near mid stop
const tri = { kind: 'tritone' as const, dark: rgb(0, 0, 0), mid: rgb(128, 0, 0), light: rgb(255, 255, 255) };
assert.deepEqual(transformColor(rgb(0, 0, 0), tri), rgb(0, 0, 0), 'tritone dark stop');
assert.deepEqual(transformColor(rgb(255, 255, 255), tri), rgb(255, 255, 255), 'tritone light stop');

// palette presets exist and are non-empty; gameboy snaps a green-ish cell onto a DMG green
assert.ok(PALETTES.gameboy.length === 4, 'gameboy palette has 4 shades');
const gb = transformColor(rgb(120, 160, 20), { kind: 'palette', colors: PALETTES.gameboy });
assert.ok(PALETTES.gameboy.some((c) => c.r === gb.r && c.g === gb.g && c.b === gb.b),
  'palette result is one of the preset swatches');
// every preset (incl. the new retro machines) is a non-empty list of swatches.
for (const [name, sw] of Object.entries(PALETTES))
  assert.ok(sw.length >= 2, `palette ${name} has >=2 swatches`);
assert.ok(PALETTES['1bit'].length === 2 && PALETTES.amber.length >= 3, 'new presets present (1bit, amber)');
// gradient `gameboy` (smooth) is distinct in kind from palette `gameboy` (snap):
// a midtone maps to a BLENDED green, not necessarily one of the 4 fixed shades.
const gbGrad = transformColor(rgb(96, 96, 96), { kind: 'gradient', stops: GRADIENTS.gameboy });
assert.ok(!PALETTES.gameboy.some((c) => c.r === gbGrad.r && c.g === gbGrad.g && c.b === gbGrad.b),
  'gradient gameboy blends between shades (not a hard snap)');

// gradient map: black (luma 0) -> first stop, white (luma 1) -> last stop.
const gStops = [rgb(0, 0, 0), rgb(100, 100, 100), rgb(255, 255, 255)];
assert.deepEqual(transformColor(rgb(0, 0, 0), { kind: 'gradient', stops: gStops }), rgb(0, 0, 0),
  'gradient black -> first stop');
assert.deepEqual(transformColor(rgb(255, 255, 255), { kind: 'gradient', stops: gStops }), rgb(255, 255, 255),
  'gradient white -> last stop');
// a 2-stop gradient is exactly duotone — same output for the same luma.
const lo = rgb(10, 20, 30), hi = rgb(200, 180, 160);
const midRgb = rgb(128, 128, 128);
assert.deepEqual(
  transformColor(midRgb, { kind: 'gradient', stops: [lo, hi] }),
  transformColor(midRgb, { kind: 'duotone', dark: lo, light: hi }),
  '2-stop gradient == duotone');
// single stop is a constant; presets exist and are multi-stop.
assert.deepEqual(transformColor(rgb(50, 90, 130), { kind: 'gradient', stops: [rgb(7, 7, 7)] }), rgb(7, 7, 7),
  'single-stop gradient is constant');
assert.ok(GRADIENTS.vaporwave.length >= 2 && GRADIENTS.fire.length >= 2, 'gradient presets are multi-stop');

// solarize: channel <= cutoff unchanged, channel > cutoff inverted.
const sol = transformColor(rgb(40, 200, 120), { kind: 'solarize', cutoff: 0.5 }); // 0.5*255=127.5
assert.deepEqual(sol, rgb(40, 55, 120), 'solarize inverts only channels above cutoff');

// channelswap 'gbr': out.r=g, out.g=b, out.b=r.
assert.deepEqual(transformColor(rgb(10, 20, 30), { kind: 'channelswap', order: 'gbr' }), rgb(20, 30, 10),
  'channelswap permutes channels');

// adjust: neutral is identity; saturation 0 collapses to grey (channels equal).
assert.deepEqual(adjustColor(rgb(10, 150, 240), NEUTRAL_ADJUST), rgb(10, 150, 240), 'neutral adjust = identity');
const desat = adjustColor(rgb(10, 150, 240), { ...NEUTRAL_ADJUST, saturation: 0 });
assert.ok(desat.r === desat.g && desat.g === desat.b, 'saturation 0 -> grey');
// brightness 0.5 halves; temperature warms red, cools blue.
assert.deepEqual(adjustColor(rgb(100, 100, 100), { ...NEUTRAL_ADJUST, brightness: 0.5 }), rgb(50, 50, 50), 'brightness halves');
const warm = adjustColor(rgb(120, 120, 120), { ...NEUTRAL_ADJUST, temperature: 1 });
assert.ok(warm.r > 120 && warm.b < 120, 'warm temperature: +red, -blue');

// bayer threshold stays in (0,1); schemeQuantizes only for the snapping schemes.
for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
  const v = bayer(x, y); assert.ok(v > 0 && v < 1, `bayer in (0,1), got ${v}`);
}
assert.ok(schemeQuantizes({ kind: 'palette', colors: [] }) && schemeQuantizes({ kind: 'threshold', cutoff: 0.5 }));
assert.ok(!schemeQuantizes({ kind: 'duotone', dark: rgb(0, 0, 0), light: rgb(255, 255, 255) }), 'duotone does not quantize');

// overlay: strength 0 -> base untouched; strength 1 'mix' -> the gradient colour.
const ovBase = rgb(10, 20, 30);
assert.deepEqual(overlayColor(ovBase, 0.5, { dir: 'h', preset: 'vaporwave', blend: 'mix', strength: 0 }), ovBase,
  'overlay strength 0 = base');
const ovFull = overlayColor(ovBase, 0, { dir: 'h', preset: 'fire', blend: 'mix', strength: 1 });
assert.deepEqual(ovFull, GRADIENTS.fire[0], 'overlay mix strength 1 at u=0 = first gradient stop');

// HSL round-trip: rgbToHsl then hslToRgb returns the original (within rounding)
// for saturated colours, and hue is read correctly (red ~0, green ~1/3, blue ~2/3).
{
  for (const c of [rgb(200, 40, 40), rgb(40, 200, 60), rgb(40, 80, 220), rgb(123, 200, 75)]) {
    const back = hslToRgb(rgbToHsl(c));
    assert.ok(Math.abs(back.r - c.r) <= 1 && Math.abs(back.g - c.g) <= 1 && Math.abs(back.b - c.b) <= 1,
      `HSL round-trip ${JSON.stringify(c)} -> ${JSON.stringify(back)}`);
  }
  assert.ok(Math.abs(rgbToHsl(rgb(255, 0, 0)).h - 0) < 0.01, 'red hue ~ 0');
  assert.ok(Math.abs(rgbToHsl(rgb(0, 255, 0)).h - 1 / 3) < 0.01, 'green hue ~ 1/3');
  assert.ok(Math.abs(rgbToHsl(rgb(0, 0, 255)).h - 2 / 3) < 0.01, 'blue hue ~ 2/3');
  assert.equal(rgbToHsl(rgb(128, 128, 128)).s, 0, 'grey has zero saturation');
}

console.log('color.test.ts: ok (schemes + adjust + solarize/channelswap + dither + overlay + hsl)');
