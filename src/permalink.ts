import { defaults, type Settings } from './settings.ts';
import type { Scheme } from './color.ts';
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
const SCHEMES = ['none', 'grayscale', 'invert', 'posterize', 'duotone'] as const;
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
  else if (kind === 'duotone') scheme = { kind, dark: rgb(randHex(pick)), light: rgb(randHex(pick)) };
  else scheme = { kind } as Scheme;

  // layered + motion together is the heavy combo (we warn about it) — so a roll
  // picks AT MOST ONE of them: a 'flavor' of layered, motion, or plain.
  const flavor = choose(['layered', 'motion', 'plain'] as const);
  const layered = flavor === 'layered';
  const ANIMS = MOTIONS.filter((m) => m !== 'none');
  const motion = flavor === 'motion' ? choose(ANIMS) : 'none';

  return {
    ...defaults,
    cols: 12 + pick(64), // 12..75 — keeps it legible, not absurdly fine
    blockSize: 1 + pick(3), // 1..3
    iconScale: +(0.6 + rnd() * 1.8).toFixed(1), // 0.6..2.4
    sizeByBrightness: rnd() < 0.5,
    background: rnd() < 0.7 ? '#ffffff' : randHex(pick),
    layered,
    layerStyle: rnd() < 0.5 ? 'cmy' : 'rgb',
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
