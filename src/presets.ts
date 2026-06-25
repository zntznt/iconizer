import { defaults, type Settings } from './settings.ts';

/** A named look: a full Settings object plus a one-line flavor caption. Hand
 *  authored, not user-saved (no storage) — a curated shelf, like a mixtape. Each
 *  is `defaults` plus the overrides that make it distinctive, so a new setting
 *  added later inherits its default here for free. The caption is the only hint a
 *  recipient gets that a look needs your own image to fully sing. */
export type Preset = { name: string; caption: string; settings: Settings };

const make = (over: Partial<Settings>): Settings => ({ ...defaults, ...over });

export const PRESETS: Preset[] = [
  {
    name: 'XEROX GHOST',
    caption: 'high-contrast 1-bit toner, like a 5th-gen photocopy',
    settings: make({
      cols: 70, iconScale: 1.1,
      scheme: { kind: 'threshold', cutoff: 0.55 },
      dither: true, ditherStrength: 0.7,
      background: '#ffffff',
    }),
  },
  {
    name: 'GAMEBOY DISCO',
    caption: 'four shades of DMG green, gently bobbing',
    settings: make({
      cols: 48,
      scheme: { kind: 'palette', colors: [
        { r: 15, g: 56, b: 15 }, { r: 48, g: 98, b: 48 },
        { r: 139, g: 172, b: 15 }, { r: 155, g: 188, b: 15 }] },
      dither: true, ditherStrength: 0.5,
      motion: 'bob', motionSpeed: 1.8, staggerMode: 'radial',
      background: '#0f380f',
    }),
  },
  {
    name: 'RISO 3-COLOR',
    caption: 'misregistered riso-print CMY, slightly off the grid',
    settings: make({
      cols: 40,
      layered: true, layerStyle: 'cmy', layerCount: 3, layerOffset: 3,
      background: '#ffffff',
    }),
  },
  {
    name: 'CRT MELTDOWN',
    caption: 'RGB subpixels swimming apart on a black tube',
    settings: make({
      cols: 44,
      layered: true, layerStyle: 'rgb', layerOffset: 2,
      adjust: { brightness: 1.1, contrast: 1.2, saturation: 1.4, temperature: 0 },
      background: '#000000',
    }),
  },
  {
    name: 'STICKER BOMB',
    caption: 'a flat photo scattered into a hand-placed rainbow',
    settings: make({
      cols: 38, iconScale: 1.2,
      colorJitter: 0.55,
      rotate: 'jitter', rotateDeg: 35,
      background: '#1a1a2e',
    }),
  },
  {
    name: 'VAPOR SWING',
    caption: 'duotone neon wash, the whole grid swaying',
    settings: make({
      cols: 42,
      scheme: { kind: 'gradient', stops: [
        { r: 26, g: 0, b: 51 }, { r: 255, g: 42, b: 109 },
        { r: 211, g: 0, b: 197 }, { r: 5, g: 217, b: 232 },
        { r: 209, g: 247, b: 255 }] },
      motion: 'swing', motionSpeed: 2.2, staggerMode: 'sweep',
      background: '#0d0221',
    }),
  },
];
