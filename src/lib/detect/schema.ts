// src/lib/detect/schema.ts
import { z } from "zod";

const NormalizedPoint = z
  .tuple([z.number().min(0).max(1), z.number().min(0).max(1)]);

export const PolygonSchema = z.object({
  points: z.array(NormalizedPoint).min(3),
  label: z.string().min(1),
  confidence: z.number().min(0).max(1),
});

export const DetectResponseSchema = z.object({
  polygons: z.array(PolygonSchema).min(0),
});

export type DetectPolygon = z.infer<typeof PolygonSchema>;
export type DetectResponse = z.infer<typeof DetectResponseSchema>;

export type LatLngBounds = {
  sw: { lat: number; lng: number };
  ne: { lat: number; lng: number };
};

export type DetectRequestBody = {
  imageDataUrl: string;
  bounds: LatLngBounds;
};
