/** Build the Blob for an SVG string. Factored out so it's testable headlessly. */
export function svgBlob(svg: string): Blob {
  return new Blob([svg], { type: 'image/svg+xml' });
}

/** Trigger a browser download of a Blob via a temporary <a download>. */
function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Download the rendered mosaic as a standalone .svg file. */
export function downloadSvg(svg: string, filename = 'iconizer.svg'): void {
  downloadBlob(svgBlob(svg), filename);
}

/** Pull "0 0 W H" or width/height off the root <svg> tag. Plain regex — the
 *  string is our own render() output, not arbitrary SVG. */
function svgSize(svg: string): { w: number; h: number } {
  const w = svg.match(/<svg[^>]*\bwidth="([\d.]+)"/)?.[1];
  const h = svg.match(/<svg[^>]*\bheight="([\d.]+)"/)?.[1];
  return { w: Number(w) || 0, h: Number(h) || 0 };
}

/**
 * Rasterize the SVG to PNG via canvas and download it.
 * Invariant: output PNG size = svg size * scale.
 *
 * ponytail: PNG export verified manually (depends on real browser canvas).
 * Not unit-tested — jsdom has no canvas and a polyfill isn't worth a dep.
 */
export async function downloadPng(svg: string, scale = 1, filename = 'iconizer.png'): Promise<void> {
  const { w, h } = svgSize(svg);
  const url = URL.createObjectURL(svgBlob(svg));
  try {
    const img = new Image();
    img.src = url;
    await img.decode();

    const canvas = document.createElement('canvas');
    canvas.width = Math.round(w * scale);
    canvas.height = Math.round(h * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2d canvas context unavailable');
    // ponytail: never taints — our render() SVG is fully self-contained (inline
    // symbol/use, no external image/font/CSS refs). If a later phase lets SVGs
    // pull external fonts/images, toBlob() can throw SecurityError; inline them then.
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    const blob: Blob = await new Promise((res, rej) =>
      canvas.toBlob((b) => (b ? res(b) : rej(new Error('toBlob failed'))), 'image/png'),
    );
    downloadBlob(blob, filename);
  } finally {
    URL.revokeObjectURL(url);
  }
}
