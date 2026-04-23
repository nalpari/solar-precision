// src/lib/detect/overlay.ts
// Composite a visible "N↑" compass marker onto the top-left of the cropped
// roof image so the vision model has an unambiguous orientation anchor for
// azimuth computation. Placed outside the typical padded bbox region so it
// does not occlude the roof itself.
import type sharp from "sharp";

const MARKER_FRACTION_OF_MIN_SIDE = 0.12;
const MARKER_MIN_PX = 80;
const MARKER_MAX_PX = 180;

export function buildNorthMarker(cropWidth: number, cropHeight: number): sharp.OverlayOptions {
  const markerSize = Math.max(
    MARKER_MIN_PX,
    Math.min(MARKER_MAX_PX, Math.round(Math.min(cropWidth, cropHeight) * MARKER_FRACTION_OF_MIN_SIDE)),
  );
  const inset = Math.max(6, Math.round(markerSize * 0.15));
  const half = markerSize / 2;
  const cx = half;
  const cy = half;

  // White circle backdrop, red up-arrow, bold "N" label. No external fonts.
  const svg = `<svg width="${markerSize}" height="${markerSize}" xmlns="http://www.w3.org/2000/svg">
  <circle cx="${cx}" cy="${cy}" r="${half - 3}" fill="white" stroke="black" stroke-width="3" fill-opacity="0.95"/>
  <polygon points="${cx},${cy - half * 0.6} ${cx - half * 0.35},${cy + half * 0.1} ${cx + half * 0.35},${cy + half * 0.1}" fill="#DC2626"/>
  <text x="${cx}" y="${cy + half * 0.55}" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="${Math.round(markerSize * 0.32)}" font-weight="900" fill="black">N</text>
</svg>`;

  return {
    input: Buffer.from(svg),
    top: inset,
    left: inset,
  };
}
