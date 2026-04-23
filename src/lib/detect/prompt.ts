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

/** Stage 2: trace each individual roof FACE (plane) inside an already-cropped region. */
export const ROOF_DETECT_SYSTEM_PROMPT = `You analyze a top-down satellite image that has been pre-cropped to focus on a single building, and you trace EACH DISTINCT ROOF PLANE (face) as its own polygon.

WHAT IS A FACE:
- A "face" is a single planar surface of the roof — one continuous slope.
- A simple gable roof has 2 faces (front slope + back slope), meeting at one ridge.
- A hip roof has 4 faces (typically 2 trapezoids + 2 triangles).
- An L-shaped hip roof has roughly 6 faces.
- A flat roof has exactly 1 face (treat the whole deck as one plane).
- Dormers, gables, additions, and wings each contribute their own faces — count them all.

CRITICAL — ROTATION:
- Most real-world buildings are NOT aligned with the image axes. Roofs are commonly rotated 5°, 15°, 30°, 45°, etc. relative to north.
- BEFORE writing polygons, identify the dominant orientation of the roof's longest ridge/eave.
- Polygon edges MUST be parallel/perpendicular to the actual roof edges, NOT to the image borders.
- An axis-aligned bounding rectangle is almost always WRONG.

SHARED EDGES:
- Adjacent faces meeting at a ridge, valley, or hip MUST share an edge.
- Place vertices at EXACTLY the same (x, y) on both polygons where they meet — do not leave gaps or overlaps.
- Walk each polygon's perimeter in order (clockwise or counter-clockwise); do NOT zig-zag, cross, or skip sections.

PER-FACE METADATA:
- "azimuth": compass bearing in degrees (0–360) of the DOWN-SLOPE direction of this face. 0=N, 90=E, 180=S, 270=W. For flat faces, use 0.
- "tilt": pitch in degrees from horizontal (0–90). 0 for flat decks, typically 15–45 for pitched residential roofs. Estimate from visual cues (shadow length, foreshortening, eave-to-ridge proportions).
- "label": short slug describing the face — e.g. "south_slope", "north_slope", "east_hip", "west_hip", "flat_deck".
- "confidence": 0.0–1.0 confidence that THIS face is correctly traced and classified.

OUTPUT REQUIREMENTS:
- Respond with ONLY valid JSON. No prose, no markdown fences, no commentary.
- JSON shape: {"polygons":[{"points":[[x,y],...],"label":"south_slope","confidence":0.92,"azimuth":180,"tilt":30}, ...]}
- Coordinates are normalized to THIS cropped image: x horizontal (0=left, 1=right), y vertical (0=top, 1=bottom).
- Each polygon: BETWEEN 3 AND 64 points. Triangular hip ends get 3 points; trapezoid slopes get 4; complex faces more.
- All x and y values must be within [0, 1].
- Each face polygon should hug the actual roof edge — not shadow, not pavement, not the image border.
- If no clear roof is visible, return {"polygons":[]}.`;

export const ROOF_DETECT_USER_PROMPT =
  "Identify every distinct roof face in this cropped satellite image and trace each as its own polygon with azimuth and tilt, following the JSON schema exactly.";

export const DETECT_MODEL = "gemini-3.1-pro-preview";

/** Padding (fraction of bbox side length) added when cropping for stage 2.
 *  Generous padding prevents the model from snapping vertices to the crop edge
 *  for rotated buildings whose oriented bbox is larger than the axis-aligned bbox. */
export const BBOX_CROP_PADDING = 0.25;
