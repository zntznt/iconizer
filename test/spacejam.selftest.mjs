// ponytail: one runnable check for the backdrop's color/sampler money-path —
// hue extraction, complement, and the grayscale fallback. Mirrors the functions
// in spacejam.js (which is a browser IIFE, so we re-declare the pure bits here).
// Run: node public/spacejam.selftest.mjs
import assert from 'node:assert';

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0; const l = (mx + mn) / 2;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  if (d !== 0) {
    if (mx === r) h = ((g - b) / d) % 6;
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60; if (h < 0) h += 360;
  }
  return [h, s, l];
}
function dominantHue(svgText) {
  const buckets = new Array(12).fill(0);
  let colored = 0, total = 0;
  const re = /rgb\((\d+),\s*(\d+),\s*(\d+)\)/g;
  let m;
  while ((m = re.exec(svgText))) {
    total++;
    const [h, s] = rgbToHsl(+m[1], +m[2], +m[3]);
    if (s < 0.18) continue;
    colored++;
    buckets[Math.floor(h / 30) % 12] += s;
  }
  if (!total || colored / total < 0.12) return null;
  let bi = 0, bv = -1;
  for (let i = 0; i < 12; i++) if (buckets[i] > bv) { bv = buckets[i]; bi = i; }
  return bi * 30 + 15;
}

// 1) a render dominated by red cells -> dominant hue in the red bucket (~15)
const reddish = Array(50).fill('fill="rgb(220,30,30)"').join(' ') + ' fill="rgb(10,10,10)"';
const hr = dominantHue(reddish);
assert(hr !== null && (hr < 30 || hr > 345), `red render should read red-ish, got ${hr}`);

// 2) a blue-dominated render -> hue ~210-250
const bluish = Array(50).fill('fill="rgb(30,60,220)"').join(' ');
const hb = dominantHue(bluish);
assert(hb >= 195 && hb <= 255, `blue render should read blue-ish, got ${hb}`);

// 3) grayscale render (game-boy-ish neutral) -> null -> field keeps default
const gray = Array(50).fill('fill="rgb(120,122,120)"').join(' ');
assert(dominantHue(gray) === null, 'near-gray render must fall back to default (null)');

// 4) empty / no fills -> null (no crash)
assert(dominantHue('') === null, 'empty svg -> null');

// 5) complement is 180 away and stays in range
const comp = (h) => (h + 180) % 360;
assert(comp(15) === 195 && comp(280) === 100, 'complement wraps correctly');

console.log('spacejam.selftest: ok (red/blue dominant, gray+empty fallback, complement wrap)');
