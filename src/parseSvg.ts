export type ParsedSvg = {
  innerSvg: string; // the root <svg>'s inner content, copied as-is
  viewBox: string; // e.g. "0 0 24 24"
};

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

  return { innerSvg: root.innerHTML, viewBox };
}
