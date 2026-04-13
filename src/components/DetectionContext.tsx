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
  | "capturing"
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

type DetectionState = {
  status: DetectionStatus;
  polygons: DetectPolygon[];
  captured: CapturedRect | null;
  errorMessage: string | null;
};

type DetectionContextValue = DetectionState & {
  setStatus: (s: DetectionStatus) => void;
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
    errorMessage: null,
  });

  const setStatus = useCallback((status: DetectionStatus) => {
    setState((s) => ({ ...s, status }));
  }, []);

  const setResult = useCallback(
    (polygons: DetectPolygon[], captured: CapturedRect) => {
      setState({ status: "success", polygons, captured, errorMessage: null });
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
      setResult,
      setError,
      reset,
      updatePolygonPoint,
    }),
    [state, setStatus, setResult, setError, reset, updatePolygonPoint],
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
