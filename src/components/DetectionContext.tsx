// src/components/DetectionContext.tsx
"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { DetectPolygon } from "@/lib/detect/schema";

export type DetectionStatus =
  | "idle"
  | "selecting"
  | "zooming"
  | "capturing"
  | "previewing"
  | "calling"
  | "success"
  | "error";

export type CapturedRect = {
  /** 뷰포트 기준 캡처 박스 (px). SVG 오버레이 위치 재현용 */
  left: number;
  top: number;
  width: number;
  height: number;
};

export type SelectionSize = { width: number; height: number };

type DetectionState = {
  status: DetectionStatus;
  polygons: DetectPolygon[];
  captured: CapturedRect | null;
  /** Captured PNG data URL shown in the preview modal before AI is invoked. */
  previewImage: string | null;
  /** Original drag rectangle size (viewport px) — used to render preview at a
   *  fixed multiple of what the user drew. */
  sourceSelectionSize: SelectionSize | null;
  errorMessage: string | null;
};

type DetectionContextValue = DetectionState & {
  setStatus: (s: DetectionStatus) => void;
  startSelecting: () => void;
  setPreview: (
    imageDataUrl: string,
    captured: CapturedRect,
    sourceSize: SelectionSize,
  ) => void;
  setResult: (polygons: DetectPolygon[], captured: CapturedRect) => void;
  setError: (message: string) => void;
  reset: () => void;
  updatePolygonPoint: (
    polygonIdx: number,
    pointIdx: number,
    point: [number, number],
  ) => void;
};

const DetectionContext = createContext<DetectionContextValue | null>(null);

export function DetectionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<DetectionState>({
    status: "idle",
    polygons: [],
    captured: null,
    previewImage: null,
    sourceSelectionSize: null,
    errorMessage: null,
  });

  const setStatus = useCallback((status: DetectionStatus) => {
    setState((s) => ({ ...s, status }));
  }, []);

  const startSelecting = useCallback(() => {
    setState({
      status: "selecting",
      polygons: [],
      captured: null,
      previewImage: null,
      sourceSelectionSize: null,
      errorMessage: null,
    });
  }, []);

  const setPreview = useCallback(
    (
      imageDataUrl: string,
      captured: CapturedRect,
      sourceSize: SelectionSize,
    ) => {
      setState((s) => ({
        ...s,
        status: "previewing",
        previewImage: imageDataUrl,
        captured,
        sourceSelectionSize: sourceSize,
        errorMessage: null,
      }));
    },
    [],
  );

  const setResult = useCallback(
    (polygons: DetectPolygon[], captured: CapturedRect) => {
      setState((s) => ({
        ...s,
        status: "success",
        polygons,
        captured,
        errorMessage: null,
      }));
    },
    [],
  );

  const setError = useCallback((message: string) => {
    setState((s) => ({ ...s, status: "error", errorMessage: message }));
  }, []);

  const reset = useCallback(() => {
    setState({
      status: "idle",
      polygons: [],
      captured: null,
      previewImage: null,
      sourceSelectionSize: null,
      errorMessage: null,
    });
  }, []);

  const updatePolygonPoint = useCallback(
    (polygonIdx: number, pointIdx: number, point: [number, number]) => {
      const clamped: [number, number] = [
        Math.max(0, Math.min(1, point[0])),
        Math.max(0, Math.min(1, point[1])),
      ];
      setState((s) => {
        const target = s.polygons[polygonIdx];
        if (!target) return s;
        const nextPoints = target.points.map((p, i) =>
          i === pointIdx ? clamped : p,
        );
        const nextPolygons = s.polygons.map((p, i) =>
          i === polygonIdx ? { ...p, points: nextPoints } : p,
        );
        return { ...s, polygons: nextPolygons };
      });
    },
    [],
  );

  const value = useMemo<DetectionContextValue>(
    () => ({
      ...state,
      setStatus,
      startSelecting,
      setPreview,
      setResult,
      setError,
      reset,
      updatePolygonPoint,
    }),
    [
      state,
      setStatus,
      startSelecting,
      setPreview,
      setResult,
      setError,
      reset,
      updatePolygonPoint,
    ],
  );

  return (
    <DetectionContext.Provider value={value}>
      {children}
    </DetectionContext.Provider>
  );
}

export function useDetection(): DetectionContextValue {
  const ctx = useContext(DetectionContext);
  if (!ctx) throw new Error("useDetection must be used within DetectionProvider");
  return ctx;
}
