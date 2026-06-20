# Design spec — "iconizer '98" (Geocities/Win98 maximalist)

Produced by a design committee (4 designers → 3 judges → synthesis). Winner:
win98-desktop, with the best ideas grafted from the kawaii/starfield/construction
directions.

## Concept
The app boots as a fake Windows-98 desktop. The live mosaic preview (`#out`) IS the
wallpaper. Each control group is a beveled program "window" with a title bar
(emoji + cursive caption + inert _ □ × buttons). A fixed taskbar holds Start, a
live clock, a real localStorage visitor counter, a functional web-ring (Random →
Surprise, guestbook → Share), and the export tray. Geocities charm (marquee, neon
tiles, sparkles) rides decorative chrome only; all text sits on solid #c0c0c0 grey
with dark ink for WCAG AA.

## The five windows
- **A 🖼️ My Pictures.exe** — `#image`, `#svg` (multiple), `#iconList`
- **B ⚙️ Grid Settings.exe** — `#cols` `#blockSize` `#iconScale` `#background`
  `#sizeByBrightness`; inset `#p-sizeRange` (`#sizeMin` `#sizeMax`)
- **C 🌈 Layered Color.exe** — `#layered`; inset `#p-layered` (`#layerStyle`
  `#layerCount` `#layerOffset`)
- **D 🎨 Color Scheme.exe** — `#scheme`; existing insets `#p-levels` `#p-duotone`
  `#p-palette`
- **E ✨ Motion FX.exe** — `#motion`; inset `#p-motion` (`#motionSpeed` `#staggerMode`)

Taskbar holds `#surprise` `#share` `#dlSvg` `#dlPng` `#scale` (IDs unchanged).

## Hard contract (do not break)
- KEEP every control ID and all existing JS wiring in main.ts.
- Disclosure = native `[hidden]` + global `[hidden]{display:none!important}` (the
  shipped JS sets `el.hidden`). Add 3 NEW wrappers: `#p-sizeRange`, `#p-layered`,
  `#p-motion`. `#p-levels/#p-duotone/#p-palette` already exist (syncSchemeUI).
- Mirror `aria-hidden` with `hidden` on every disclosure flip.
- Add `syncDisclosure()` (sets the 3 new wrappers from current control values);
  call it at the end of `syncControls()` so permalink/Surprise restore insets.
- ONE `prefers-reduced-motion` block freezes ALL chrome animation; the user-chosen
  `#motion` (content, inside the SVG) is untouched.
- Responsive: works 360px→desktop. `overflow-x:hidden` backstop, `min-width:0` +
  `width:100%` on inner controls, `minmax(min(280px,100%),1fr)` grid floor, preview
  source-order-first and sticky-on-top at phone width, taskbar `flex-wrap`, export
  tray never hidden.

## CSS recipes (no external assets)
- Raised bevel: `inset 1px 1px #fff, inset -1px -1px #808080, inset 2px 2px #dfdfdf,
  inset -2px -2px #000` on `#c0c0c0`. Sunken inset = reversed.
- Title bar: `linear-gradient(90deg,#000080,#1084d0)` + cursive caption.
- Neon tiled backdrop: `repeating-linear-gradient(45deg,#1a0033 0 16px,#2a004d 16px 32px)`
  + a small radial-gradient star tile.
- CRT bezel + scanlines (`repeating-linear-gradient` overlay, pointer-events:none)
  around `#out`; blinking green power LED.
- Marquee: `@keyframes scroll{from{translateX(100%)}to{translateX(-100%)}}` inside
  `overflow:hidden`.
- Skin native controls with `accent-color` (keep AT/keyboard); don't replace them.
- LCD counter/clock: monospace, `#33ff66` on `#001a00`, sunken bevel.
- Loud `:focus-visible` cyan ring (charm + a11y).

## Copy
Wordmark "iconizer 98". Marquee "★ UNDER CONSTRUCTION 🚧 ★ best viewed at 800×600 ★
Netscape Now! ★". Empty state "feed me a picture! ♡". Web-ring "‹ Random | iconizer
webring | Sign my guestbook ♡ ›". Counter "You are visitor No. 000,042". Inset
teaching copy: "▸ extra knobs unlocked!", "how small? ~ how big?", "how many steps?".

(Full committee output archived in the task transcript; this is the build spec.)
