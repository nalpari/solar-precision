// src/lib/detect/schema.ts
import { z } from "zod";

const NormalizedPoint = z
  .tuple([z.number().min(0).max(1), z.number().min(0).max(1)]);

export const PolygonSchema = z.object({
  points: z.array(NormalizedPoint).min(3).max(64),
  label: z.string().min(1),
  confidence: z.number().min(0).max(1),
  /** Compass bearing of the down-slope direction. 0=N, 90=E, 180=S, 270=W. Use 0 for flat roofs. */
  azimuth: z.number().min(0).max(360),
  /** Pitch in degrees from horizontal. 0 for flat roof. */
  tilt: z.number().min(0).max(90),
});

export const DetectResponseSchema = z.object({
  polygons: z.array(PolygonSchema).min(0),
  /** Why the result came back this way — surfaced in client console for diagnosis. */
  reason: z
    .enum(["ok", "low_confidence", "no_polygons"])
    .optional(),
  /** First-stage bbox confidence (0–1) when known. */
  bboxConfidence: z.number().min(0).max(1).optional(),
});

export const BboxResponseSchema = z.object({
  bbox: z.tuple([
    z.number().min(0).max(1),
    z.number().min(0).max(1),
    z.number().min(0).max(1),
    z.number().min(0).max(1),
  ]),
  confidence: z.number().min(0).max(1),
});

export type DetectPolygon = z.infer<typeof PolygonSchema>;
export type DetectResponse = z.infer<typeof DetectResponseSchema>;
export type BboxResponse = z.infer<typeof BboxResponseSchema>;

export type LatLngBounds = {
  sw: { lat: number; lng: number };
  ne: { lat: number; lng: number };
};

export type DetectRequestBody = {
  imageDataUrl: string;
  bounds: LatLngBounds;
};
