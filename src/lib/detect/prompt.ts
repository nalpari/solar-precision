// src/lib/detect/prompt.ts

/** Stage 1: locate the central building's bounding box. */
export const BBOX_SYSTEM_PROMPT = `You analyze top-down satellite images and locate the bounding box of the single most central building (or main structure).

OUTPUT REQUIREMENTS:
- Respond with ONLY valid JSON. No prose, no markdown fences, no commentary.
- JSON shape: {"bbox":[x1,y1,x2,y2],"confidence":0.0-1.0}
- Coordinates are normalized in image space: x horizontal (0=left, 1=right), y vertical (0=top, 1=bottom).
- The bbox must TIGHTLY enclose the entire roof of the central building, including all wings and protrusions.
- Pick the largest connected building/structure whose centroid is closest to the image center (0.5, 0.5).
- All values must be within [0, 1] and x1 < x2, y1 < y2.
- If no clear building is visible, return {"bbox":[0,0,0,0],"confidence":0}.`;

export const BBOX_USER_PROMPT =
  "Return the bounding box of the central building in this satellite image, following the JSON schema exactly.";

/** Stage 2: trace the roof perimeter inside an already-cropped region. */
export const ROOF_DETECT_SYSTEM_PROMPT = `You analyze a top-down satellite image that has been pre-cropped to focus on a single building, and you trace the outline of that building's roof.

CRITICAL — ROTATION:
- Most real-world buildings are NOT aligned with the image axes. Roofs are commonly rotated 5°, 15°, 30°, 45°, etc. relative to north.
- BEFORE writing the polygon, identify the dominant orientation of the roof's longest edge.
- The polygon edges MUST be parallel/perpendicular to the actual roof edges, NOT to the image borders.
- An axis-aligned bounding rectangle is almost always WRONG. If your output looks like a screen-aligned rectangle, you are returning a bounding box — that is a failure. Re-do it.
- For a simple rectangular roof rotated by angle θ, the four corners must reflect that rotation; do NOT snap them to vertical/horizontal.

OUTPUT REQUIREMENTS:
- Respond with ONLY valid JSON. No prose, no markdown fences, no commentary.
- JSON shape: {"polygons":[{"points":[[x,y],...],"label":"primary_roof","confidence":0.0-1.0}]}
- Coordinates are normalized to THIS cropped image: x horizontal (0=left, 1=right), y vertical (0=top, 1=bottom).
- Return exactly ONE polygon — the perimeter of the dominant roof in the image.
- Use BETWEEN 4 AND 64 points. A simple rotated rectangular roof needs exactly 4 points; complex L/T/U shapes need more.
- Place a vertex at every concave/convex corner. For curved sections, approximate with several short straight segments.
- Walk the perimeter in order (clockwise or counter-clockwise). Do NOT zig-zag, cross, or skip sections.
- The polygon should hug the actual roof edge — not the building shadow, not surrounding pavement, not the image border.
- All x and y values must be within [0, 1].
- If no clear roof is visible, return {"polygons":[]}.`;

export const ROOF_DETECT_USER_PROMPT =
  "Trace the perimeter of the central roof in this cropped satellite image, following the JSON schema exactly.";

export const DETECT_MODEL = "claude-opus-4-6";

/** Padding (fraction of bbox side length) added when cropping for stage 2.
 *  Generous padding prevents the model from snapping vertices to the crop edge
 *  for rotated buildings whose oriented bbox is larger than the axis-aligned bbox. */
export const BBOX_CROP_PADDING = 0.25;
