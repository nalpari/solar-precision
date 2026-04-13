// src/lib/detect/prompt.ts
export const ROOF_DETECT_SYSTEM_PROMPT = `You analyze top-down satellite images of buildings and return the roof outline of the single most central building.

OUTPUT REQUIREMENTS:
- Respond with ONLY valid JSON. No prose, no markdown fences, no commentary.
- JSON shape: {"polygons":[{"points":[[x,y],...],"label":"primary_roof","confidence":0.0-1.0}]}
- Coordinates are normalized in image space: x is horizontal (0=left, 1=right), y is vertical (0=top, 1=bottom).
- Return exactly ONE polygon for the building closest to the image center.
- Each polygon must have at least 3 points and at most 24 points.
- Points must trace the roof perimeter in order (clockwise or counter-clockwise).
- All x and y values must be within [0, 1].
- If no clear roof is visible at the center, return {"polygons":[]}.`;

export const ROOF_DETECT_USER_PROMPT =
  "Return the roof polygon for the central building in this satellite image, following the JSON schema exactly.";

export const DETECT_MODEL = "claude-sonnet-4-6";
