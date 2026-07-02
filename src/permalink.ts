import { defaults, type Settings } from './settings.ts';
import { PALETTES, GRADIENTS, NEUTRAL_ADJUST, type Scheme } from './color.ts';
import type { Motion, StaggerMode } from './motion.ts';

/**
 * Settings <-> URL hash. JSON + base64, schema-free: new settings serialize
 * automatically, and parse merges over `defaults` so old links missing a newer
 * field still load (the field just takes its default). The image/icons are NOT
 * encoded (too big) — a shared link reopens the controls; the recipient adds
 * their own image.
 */
export function encodeSettings(s: Settings): string {
  // btoa needs latin1; settings are all ASCII (numbers, hex, enum strings).
  return btoa(JSON.stringify(s));
}

export function decodeSettings(hash: string): Settings | null {
  const raw = hash.replace(/^#/, '');
  if (!raw) return null;
  try {
    const parsed = JSON.parse(atob(raw));
    return { ...defaults, ...parsed }; // forward/backward compatible
  } catch {
    return null; // garbage hash -> ignore, use defaults
  }
}

/** Write the current settings into location.hash without adding history entries. */
export function syncUrl(s: Settings): void {
  history.replaceState(null, '', `#${encodeSettings(s)}`);
}

/** Read settings from the current URL hash, or null if absent/invalid. */
export function settingsFromUrl(): Settings | null {
  return decodeSettings(location.hash);
}

// --- "Surprise me" ---------------------------------------------------------

const MOTIONS: Motion[] = ['none', 'wiggle', 'swing', 'spin', 'pulse', 'bob', 'shimmer'];
const STAGGERS: StaggerMode[] = ['none', 'ripple', 'brightness', 'random'];
const LAYER_STYLES = ['cmy', 'cmyk', 'ryb', 'rgb', 'anaglyph'] as const;
const SCHEMES = ['none', 'grayscale', 'invert', 'sepia', 'threshold', 'hue',
  'posterize', 'duotone', 'tritone', 'gradient', 'solarize', 'channelswap', 'palette'] as const;
const PALETTE_NAMES = Object.keys(PALETTES);
const GRADIENT_NAMES = Object.keys(GRADIENTS);
const SWAP_ORDERS = ['rbg', 'grb', 'gbr', 'brg', 'bgr'] as const;
const randHex = (pick: (n: number) => number) =>
  '#' + [0, 0, 0].map(() => pick(256).toString(16).padStart(2, '0')).join('');

/**
 * A random-but-sensible Settings. `rnd` is an injectable [0,1) source so this is
 * testable deterministically (defaults to Math.random in the browser).
 */
export function rollRandom(rnd: () => number = Math.random): Settings {
  const pick = (n: number) => Math.floor(rnd() * n);
  const choose = <T>(arr: readonly T[]): T => arr[pick(arr.length)];

  let scheme: Scheme;
  const kind = choose(SCHEMES);
  if (kind === 'posterize') scheme = { kind, levels: 2 + pick(6) };
  else if (kind === 'threshold') scheme = { kind, cutoff: +(0.2 + rnd() * 0.6).toFixed(2) };
  else if (kind === 'hue') scheme = { kind, deg: pick(72) * 5 }; // 0..355 in 5° steps
  else if (kind === 'duotone') scheme = { kind, dark: rgb(randHex(pick)), light: rgb(randHex(pick)) };
  else if (kind === 'tritone') scheme = { kind, dark: rgb(randHex(pick)), mid: rgb(randHex(pick)), light: rgb(randHex(pick)) };
  else if (kind === 'gradient') scheme = { kind, stops: GRADIENTS[choose(GRADIENT_NAMES)] };
  else if (kind === 'solarize') scheme = { kind, cutoff: +(0.3 + rnd() * 0.5).toFixed(2) };
  else if (kind === 'channelswap') scheme = { kind, order: choose(SWAP_ORDERS) };
  else if (kind === 'palette') scheme = { kind, colors: PALETTES[choose(PALETTE_NAMES)] };
  else scheme = { kind } as Scheme; // none | grayscale | invert | sepia

  // layered + motion together is the heavy combo (we warn about it) — so a roll
  // picks AT MOST ONE of them: a 'flavor' of layered, motion, or plain.
  const flavor = choose(['layered', 'motion', 'plain'] as const);
  const layered = flavor === 'layered';
  const ANIMS = MOTIONS.filter((m) => m !== 'none');
  const motion = flavor === 'motion' ? choose(ANIMS) : 'none';

  // Rotation is cheap (static), so a roll can sprinkle it freely. Half the time
  // upright; otherwise a tilt mode with a sensible angle for that mode.
  const rotate = rnd() < 0.5 ? 'none' : choose(['brightness', 'jitter', 'fixed'] as const);
  const rotateDeg = rotate === 'fixed' ? pick(72) * 5 // 0..355 (any angle)
    : 15 + pick(34) * 5; // 15..180 sweep for field/jitter — readable, not a blur

  return {
    ...defaults,
    cols: 12 + pick(64), // 12..75 — keeps it legible, not absurdly fine
    blockSize: 1 + pick(3), // 1..3
    iconScale: +(0.6 + rnd() * 1.8).toFixed(1), // 0.6..2.4
    sizeByBrightness: rnd() < 0.5,
    rotate,
    rotateDeg,
    fadeByBrightness: rnd() < 0.35,
    layout: rnd() < 0.65 ? 'grid' as const : choose(['brick', 'hex'] as const),
    // occasional sticker mode; cutoff high enough that a subject survives.
    cutout: rnd() < 0.2 ? +(0.5 + rnd() * 0.35).toFixed(2) : 0,
    // adjust: usually leave tone alone; sometimes a mild graded push.
    adjust: rnd() < 0.55 ? { ...NEUTRAL_ADJUST } : {
      brightness: +(0.85 + rnd() * 0.4).toFixed(2),
      contrast: +(0.85 + rnd() * 0.5).toFixed(2),
      saturation: +(0.5 + rnd() * 1.2).toFixed(2),
      temperature: +((rnd() * 2 - 1) * 0.5).toFixed(2),
    },
    dither: rnd() < 0.3,
    ditherStrength: +(0.3 + rnd() * 0.5).toFixed(2),
    overlay: rnd() < 0.3
      ? { dir: choose(['h', 'v', 'diag', 'radial'] as const), preset: choose(GRADIENT_NAMES),
        blend: choose(['mix', 'multiply', 'screen'] as const), strength: +(0.2 + rnd() * 0.5).toFixed(2) }
      : { dir: 'none' as const, preset: 'vaporwave', blend: 'mix' as const, strength: 0.5 },
    background: rnd() < 0.7 ? '#ffffff' : randHex(pick),
    layered,
    layerStyle: choose(LAYER_STYLES),
    layerOffset: rnd() < 0.5 ? 0 : pick(4),
    scheme,
    motion,
    motionSpeed: +(0.5 + rnd() * 3).toFixed(1), // 0.5..3.5
    staggerMode: choose(STAGGERS),
  };
}

const rgb = (h: string) => ({
  r: parseInt(h.slice(1, 3), 16),
  g: parseInt(h.slice(3, 5), 16),
  b: parseInt(h.slice(5, 7), 16),
});
