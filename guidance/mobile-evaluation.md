# Mobile evaluation — Iconizer

**Status: EVALUATION ONLY. Nothing fixed yet.** This is the punch-list for a
future mobile pass.

Method: real-device emulation in Chrome DevTools (iPhone-12 class, 390×844,
dpr 3, touch) on the built `dist/`, plus two parallel code auditors (CSS and
JS/interaction). Findings below are cross-checked — each was confirmed by direct
DOM measurement and/or screenshot, not just code reading.

## TL;DR

The app is in **better** mobile shape than it feels — the scary stuff (mouse-only
window dragging, iOS input focus-zoom, no file-picker fallback) **doesn't exist
here**. The real mobile pain is concentrated in four places:

1. The **sticky full-height CRT** hides every control on first load (you must
   discover the cramped taskbar to navigate).
2. The **sysbar overflows** and its mobile space-saving rule is **wired to a
   typo'd class**, so it never fires.
3. **Export is phone-hostile** — GIF can freeze/crash the tab; PNG can silently
   produce a blank file; the download flow is unreliable on iOS Safari.
4. The **p5 backdrop runs 60fps full-time**, draining battery and fighting the
   export encode.

Verified non-issues (do NOT spend time here): window-drag (windows are static
cards, only minimize/restore), drop-well tap-to-pick (works), `prefers-reduced-
motion` (handled live), `(pointer:coarse)` 44px targets (partially handled),
iOS focus-zoom (no text inputs exist), pinch-zoom (intentionally allowed).

---

## BLOCKERS

### B1 — Sticky CRT eats the screen and hides all controls
- **Measured:** `.hero` is `position: sticky; top: 30px` and **640px tall in an
  844px viewport (76%)**. The six `.win` windows flow *after* it in one column
  (rails are `display:contents`), so they scroll *behind* the pinned CRT.
- **Effect:** On first load the user sees only the CRT. My Pictures / Grid /
  Scheme / Motion / Export are off-screen and only reachable via the cramped
  taskbar strip. The primary controls are effectively hidden.
- **Where:** `index.html` — `.hero` sticky rule (~line 355), `.rail{display:
  contents}` (~202), idle `min-height` (~111).
- **Direction:** make the hero `position: static` on mobile, or cap its mobile
  height so it doesn't dominate the single scroll column.

### B2 — GIF export freezes / OOMs the phone
- **Where:** `src/export.ts` `downloadGif` (~135–186), from `main.ts:344`.
- **Cause:** 20 frames rasterized on the main thread (each `img.decode()` +
  `getImageData` of a 720px canvas), ~20× full-frame `ImageData` held at once,
  LZW on 2 workers. The 30s timeout will routinely fire on a phone; mobile
  Safari can crash the tab on a large source image.
- **Direction:** gate GIF behind a coarse-pointer warning, drop frame count /
  base resolution on mobile, and/or yield between frames.

### B3 — Maximized CRT is sized to raw `100vh`, clipped by chrome
- **Where:** `index.html` `.crt.maximized` (~122–137): `position:fixed; top:50%;
  translate(-50%,-50%); max-height: calc(100vh - 24px)`.
- **Cause:** centers on the geometric middle and can be nearly full `100vh` tall,
  so the top slides under the 30px sysbar and the bottom under the 48px taskbar;
  on mobile Safari `100vh` includes the dynamic URL-bar area, clipping further.
  The zoom-out target (the whole bezel) ends up partly behind chrome.
- **Direction:** subtract the bars (or use `dvh`) so the maximized CRT lives in
  the free region.

---

## MAJOR

### M1 — Mobile sysbar hide rule targets a class that doesn't exist
- **Measured:** `document.querySelector('.start-meta')` → **null**;
  `.sysbar-meta` → exists, `display: block` (NOT hidden).
- **Effect:** the `@media (max-width:640px) { .start-meta { display:none } }`
  rule (~line 360) was meant to hide the TIME/HITS LCD chips + "Netscape Now!"
  marquee on mobile. The real class is `sysbar-meta`. So on mobile the sysbar
  stays overstuffed: in the screenshot TIME is cut, HITS is sliced in half, the
  marquee text is crushed to "best v…". The clip is hidden by body
  `overflow-x:hidden`, which masks the bug (no sideways scrollbar).
- **Where:** `index.html` ~line 360 (selector typo), sysbar ~49–55, chips ~426.
- **Direction:** fix the selector to `.sysbar-meta` (one-character class of bug).

### M2 — Export canvas can exceed mobile canvas limits, silently
- **Where:** `src/export.ts` `downloadPng` (~59–83), `PNG_BASE=1500` × scale
  (2–4×). iOS Safari blanks/`null`s `toBlob` past ~16.7M px / 4096px side.
- **Effect:** empty/blank PNG download, or an unhandled rejection (no try/catch
  around the PNG handler at `main.ts:338`) with no user-visible error.
- **Direction:** clamp longest side (~2048) + total area on coarse pointers;
  surface failures.

### M3 — Blob download via synthetic `<a download>` unreliable on iOS Safari
- **Where:** `src/export.ts` `downloadBlob` (~7–14).
- **Cause:** anchor isn't appended to the DOM (some WebViews ignore detached
  anchors); `URL.revokeObjectURL` fires synchronously right after `a.click()`,
  which can revoke the blob before Safari finishes the handoff; iOS partially
  ignores the `download` attribute (opens in-page instead of saving).
- **Direction:** append the anchor, defer the revoke a tick, consider the Web
  Share API for files on mobile.

### M4 — p5 backdrop runs 60fps full-time; battery + export contention
- **Where:** `public/spacejam.js` `p.frameRate(60)` (~78), `p.draw` (~178).
- **Cause:** only pauses on `document.hidden`; never throttles when visible-idle
  and keeps painting *during* the GIF encode (worsening B2). dpr is capped at 2
  (good) and reduced-motion is honored (good) — the gap is unconditional 60fps
  for motion users.
- **Direction:** ~30fps and/or pause the sketch while an export runs (and
  arguably default-off on coarse pointers).

### M5 — Touch targets under 44px outside the coarse-pointer whitelist
- **Measured:** `.sm-link` = **235×30**, `.ring-site` = **263×28** (both under
  44px tall). `.task` = 102×44 ✓ (whitelist works for those).
- **Not covered by** the `@media (pointer:coarse)` block (~362–365), which only
  bumps `.btn98`, `.icon-row button`, `.win-bar .btns i`, ranges: Start-menu
  links (`.sm-link`, `.sm-about`), webring links (`.ring-site`), quick-save items
  (`.qs-item`), color swatches (`input[type=color]` fixed 42×26), arcade buttons
  (`.arcade-btn` ~36px), and the title-bar mini/close glyphs (44px tall but only
  **18px wide** — a sliver, and the only way to minimize on touch).
- **Direction:** add these selectors to the coarse-pointer block; widen the
  title-bar glyph hit area.

### M6 — Cramped 48px taskbar is the only navigation, yet can't show everything
- **Effect:** Start + a horizontally-scrolling strip of six task buttons + the
  Save split-button must share a 48px-tall, ~360px-wide bar. Because of B1 the
  taskbar *is* the primary nav, but the scroll strip is easy to miss (hidden
  scrollbar) and the buttons are partly off-screen (screenshot: 4 partial tasks).
- **Where:** `index.html` `.taskbar` (~285), `.tasks{overflow-x:auto}` (~300).
- **Direction:** scroll-snap or shrink task labels on mobile; pairs with B1.

### M7 — Minimize "genie" flings content 60vh across a stacked column
- **Where:** `index.html` `.win.minimizing { transform: translateY(60vh)
  scale(.04) }` (~223).
- **Cause:** the 60vh distance is tuned for the desktop side-rails (toward the
  taskbar). On the mobile single-column stack a minimizing window slides most of
  the screen, over/under other stacked windows and the sticky CRT — reads as
  content flying through the page, not tucking away.
- **Direction:** shrink/remove the translate on mobile, or just fade+collapse.

---

## MINOR

### m1 — Dead rule: `.desktop { grid-template-columns: 1fr }` on a flex box
- `index.html` ~line 356. `.desktop` is `display:flex` and never grid; the
  `grid-template-columns` part is inert (only the `padding` works). Leftover from
  the pre-flex layout. Harmless but misleading. Direction: delete the
  declaration, keep the padding.

### m2 — `restoreWin` `scrollIntoView` yanks mobile scroll
- `src/main.ts` `restoreWin` (~608): `scrollIntoView({behavior:'smooth',
  block:'center'})` on every manual restore. On the mobile single column this
  jerks a mid-scroll user. (Boot cascade passes `scroll=false`, so first load is
  fine.) Direction: skip on coarse pointers or when already in view.

### m3 — FLIP reflow + 6-window boot cascade jank on low-end phones
- `src/main.ts` `flipSiblings` (~555). Each minimize/restore measures + transforms
  every *other* card; `bootReveal` runs 6 staggered genie+FLIP passes during
  first paint. Only gated by reduced-motion. Direction: plain show/hide on coarse
  pointers.

### m4 — `resample()` re-decodes the image on every cols/background change
- `src/main.ts` `resample` (~190). Dragging the columns slider re-runs
  `createImageBitmap` (full decode) per settled input — heavy for a big photo on
  a phone. The bitmap isn't cached. Direction: cache the decoded bitmap at load.

### m5 — `100vh`/`70vh` math instead of `dvh`
- `#out svg max-height:70vh` (~161), idle `min-height` calc (~111), start-menu
  `max-height` calc (~317) all use `vh`, which on mobile includes the URL-bar
  area → content taller than the real free space, extra scroll, items under the
  dynamic toolbar. Direction: `dvh` on small screens.

### m6 — Sub-12px low-contrast decorative text invites pinch-zoom
- Many: `.dw-disk` 11px, `.dw-nudge` 12px (`#7a9a3a` on dark), `.ring-foot` 11px,
  `.sm-banner`/`.sm-uname` 11–12px, `.prog-text` 11px, `.save-row small` 11px
  (`#5a6a3a`). Body is 14px (fine); the chrome is the problem. Direction: bump
  sub-12px decorative text on small screens.

### m7 — Decorative infinite CSS animations keep compositing on mobile
- `body::after` full-screen neon grid (`gridrun`), `.crt-screen::before` roll
  bar, `.ring-track` marquee, LED/pip blinks all run `infinite`. Disabled only by
  the OS reduced-motion flag; default mobile pays full GPU. Direction: throttle
  or disable the full-screen grid animation at `<=640px` independent of
  reduced-motion.

---

## Suggested fix order (when we do the pass)

1. **B1** unstick the CRT + **M6** taskbar — the navigation blocker (biggest felt
   win). **M1** sysbar typo rides along (one line).
2. **B2 / M2 / M3 / M4** the export + p5 cluster (GIF freeze, canvas cap,
   download reliability, throttle the loop) — often touched together.
3. **B3** maximized `dvh` math, **M5** touch targets, **M7** genie distance.
4. The MINOR polish (`m1`–`m7`) — cheap, do in a sweep.

## Confirmed-clean (skip)

Window dragging (not implemented — static cards), drop-well tap-to-pick (works,
`main.ts:133`), hover-only reveals (all decorative, nothing functional gated),
reduced-motion + dpr cap in spacejam.js, iOS input focus-zoom (no text inputs),
pinch/double-tap zoom (intentionally allowed via the viewport tag), 300ms tap
delay (gone with `width=device-width`).
