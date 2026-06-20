# Design spec — bars + empty-CRT redesign ("Desktop-Icons")

Committee winner (2/3 judges). Commits fully to the Win98-desktop fiction across
header, footer, and empty-CRT — and turns dead decorative chrome into functional
chrome (status reporting, real file input, de-cramped taskbar).

## Header → live system status bar
Replace `.banner` marquee with `<header class="sysbar" data-status="idle">` (sticky,
navy→sky gradient, role=status aria-live):
- `.sysbar-cap`: "Iconizer — [<span id=srcName>no image</span>]" (filename on load)
- `.pips`: 3 LED diodes reusing `.led` — #pipImg, #pipSvg (grey-pulse when 0 SVGs),
  #pipReady. `.on` class = lit lime; aria-labels flip with state.
- `.prog`: segmented install-bar, `width:var(--prog)`. idle=flavor text, rendering=
  barber-pole, exporting=JS fills 0→100% during real encode, ready="READY."
- relocated #clock ("TIME ▸") + #visitorCount ("HITS ▸ #000123") as 7-seg LED.
- under ~420px clock+counter hide; pips+progress stay.

## Footer → strict single-row taskbar (no wrap)
`flex-wrap:nowrap`, fixed `--taskbar-h` ~40px (44 coarse). 3 regions:
- LEFT pinned: Start `<button>` toggles #startMenu.
- MIDDLE (only flexible, overflow-x:auto): `.task` scroll-spy buttons per .win
  (IntersectionObserver → `.active` bevel-down).
- RIGHT pinned (always visible): quick-export "💾 Save ▾" split-button; dropdown
  lists SVG/PNG/GIF as PROXIES that `.click()` the canonical ids (no dup ids).

## New windows
- **Export.exe** `<section class="win" id="winExport">` in `.desktop` grid: live
  `#exportSize` readout ("OUTPUT ▸ 1024×768 @ 2×"), `#scale` select, 3 stacked Save
  rows = canonical #dlSvg/#dlPng/#dlGif. #dlGif visible-but-disabled "needs Motion
  FX" when motion=none (keep `hidden` wired as fallback).
- **Start menu** `<nav id="startMenu" role="menu" hidden>`: Programs (#surprise,
  #share as domed arcade buttons), Network Neighborhood (webring links), About.
  Esc/outside-click/select closes; copy heavyModal focus pattern.

## Empty CRT → honest drop-well (the flagged fix)
Delete the fake `.bubble` button. Empty state = `<label for="image" class="dropwell">`
(sunken bevel + 2px dashed lime = droppable-not-button); click anywhere opens the
real #image picker, drag/drop wired to the same handler. Gated by existing
`#out:empty + .dropwell{display:block}`. Inside (green phosphor): 👾 mascot, DOS
headline `C:\> feed me a picture_` w/ blinking cursor, "click anywhere or drop",
and a 2-step checklist: [1] drop a picture, [2] add an icon .svg (step 2 = sibling
`<label for="svg">`, NOT nested, to keep label markup valid).

## ID mapping (all preserved)
#surprise→Start menu (arcade btn) · #share→Start menu (arcade btn) · #dlSvg/#dlPng/
#dlGif/#scale→Export.exe · #visitorCount/#clock→header LED readouts.

## Constraints honored
single-row no-wrap bars at all widths · export reachable 2 ways (Export.exe +
footer chip) · one prefers-reduced-motion freeze (extend selector list) · pure CSS
no assets · all ids preserved · no guestbook · name "Iconizer".

## Keep intact
--bevel-up/down, palette vars, `#out:empty` selector family, `.crt[role=button]`/
`.maximized` logic, `[hidden]` disclosure, heavyModal focus pattern. render() pure.

(Full committee output in the task transcript.)
