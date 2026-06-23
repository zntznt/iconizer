export type ParsedSvg = {
  innerSvg: string; // the root <svg>'s inner content, copied as-is
  viewBox: string; // e.g. "0 0 24 24"
  // True when innerSvg is exactly ONE element (e.g. a lone <path>). The live
  // renderer then splices its per-cell transform/fill INTO that element instead
  // of wrapping it in a <g transform> — a ~16x faster on-screen layout, since a
  // group per cell establishes a new coordinate system the engine processes
  // separately. Multi-shape icons fall back to the group wrapper.
  singleShape: boolean;
};

/**
 * Make an icon TINTABLE: rewrite hardcoded fills to `currentColor` so a `color`
 * set on the <use> (solid fill mode, or each CMY layer) actually drives the paint.
 * Without this, an icon shipping `fill="#000"` (Font Awesome, Material, etc.)
 * ignores our colour and paints black — in layered CMY, three blacks multiply to
 * black (the "everything goes black" bug). currentColor icons are unchanged.
 *
 * Rules: any paint-bearing fill (a colour, OR absent -> defaults to black) becomes
 * currentColor. `fill="none"` is LEFT ALONE — stroked/outline icons rely on it;
 * filling those would turn outlines into blobs. Inline `style` fill (which beats
 * the attribute) is stripped so the attribute wins.
 * ponytail: only `fill` is handled, not `stroke`. Stroked-only icons stay their
 * own colour in tint/CMY modes — add a stroke->currentColor pass if that matters.
 */
function makeTintable(root: SVGSVGElement): void {
  // every shape/group element, including the root's children
  for (const el of root.querySelectorAll('*')) {
    const fill = el.getAttribute('fill');
    if (fill !== 'none') el.setAttribute('fill', 'currentColor');
    // inline style fill overrides the attribute — drop just the fill declaration.
    const style = el.getAttribute('style');
    if (style && /(^|;)\s*fill\s*:/i.test(style)) {
      const cleaned = style.replace(/(^|;)\s*fill\s*:[^;]*/gi, '$1').replace(/^;|;;+/g, ';');
      el.setAttribute('style', cleaned);
    }
  }
  // Elements with NO fill attribute at all default to black -> also need tinting.
  // querySelectorAll above only touched existing attrs; set currentColor on the
  // root so unstyled children inherit it (fill inherits in SVG).
  if (root.getAttribute('fill') !== 'none') root.setAttribute('fill', 'currentColor');
}

/**
 * Parse an uploaded SVG's text into the pieces render() needs.
 * Plumbing — kept out of render() so the core stays pure/testable.
 *
 * ponytail: NOT sanitized. An uploaded SVG can carry <script>/on* handlers
 * (XSS). Fine while inputs are the user's own. Add DOMPurify
 * (USE_PROFILES: {svg: true}) before any multi-user / shared-link feature.
 */
export function parseSvg(text: string): ParsedSvg {
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  const root = doc.querySelector('svg');
  if (!root || doc.querySelector('parsererror')) {
    throw new Error('not a valid SVG');
  }

  let viewBox = root.getAttribute('viewBox') ?? '';
  if (!viewBox) {
    const w = root.getAttribute('width');
    const h = root.getAttribute('height');
    // ponytail: no viewBox and no width/height -> default 24x24. Rare; a real
    // fix would measure the rendered bbox.
    viewBox = w && h ? `0 0 ${parseFloat(w)} ${parseFloat(h)}` : '0 0 24 24';
  }

  makeTintable(root);
  // single drawable child (ignoring whitespace text nodes) -> the live renderer
  // can splice attrs into it directly, skipping the per-cell <g> wrapper.
  const singleShape = root.children.length === 1;
  return { innerSvg: root.innerHTML, viewBox, singleShape };
}
