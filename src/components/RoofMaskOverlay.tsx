// src/components/RoofMaskOverlay.tsx
"use client";

import { useCallback, useRef, useState } from "react";
import { useDetection } from "./DetectionContext";

type DragState = {
  polygonIdx: number;
  pointIdx: number;
  pointerId: number;
};

export function RoofMaskOverlay() {
  const { status, polygons, captured, updatePolygonPoint } = useDetection();
  const svgRef = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<DragState | null>(null);

  const toNormalized = useCallback(
    (clientX: number, clientY: number): [number, number] | null => {
      const svg = svgRef.current;
      if (!svg || !captured) return null;
      const rect = svg.getBoundingClientRect();
      const x = (clientX - rect.left) / rect.width;
      const y = (clientY - rect.top) / rect.height;
      return [x, y];
    },
    [captured],
  );

  const handlePointerDown = useCallback(
    (polygonIdx: number, pointIdx: number) =>
      (e: React.PointerEvent<SVGCircleElement>) => {
        e.stopPropagation();
        e.preventDefault();
        try {
          e.currentTarget.setPointerCapture(e.pointerId);
        } catch {
          // ignore — capture is best-effort
        }
        setDrag({ polygonIdx, pointIdx, pointerId: e.pointerId });
      },
    [],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<SVGCircleElement>) => {
      if (!drag || drag.pointerId !== e.pointerId) return;
      const next = toNormalized(e.clientX, e.clientY);
      if (!next) return;
      updatePolygonPoint(drag.polygonIdx, drag.pointIdx, next);
    },
    [drag, toNormalized, updatePolygonPoint],
  );

  const endDrag = useCallback(
    (e: React.PointerEvent<SVGCircleElement>) => {
      if (!drag || drag.pointerId !== e.pointerId) return;
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        // ignore — capture may have been auto-released already
      }
      setDrag(null);
    },
    [drag],
  );

  if (status !== "success" || !captured || polygons.length === 0) return null;

  return (
    <svg
      ref={svgRef}
      aria-hidden
      className="pointer-events-none absolute z-30"
      style={{
        left: captured.left,
        top: captured.top,
        width: captured.width,
        height: captured.height,
      }}
      viewBox={`0 0 ${captured.width} ${captured.height}`}
    >
      {polygons.map((poly, polyIdx) => {
        const pts = poly.points
          .map(([x, y]) => `${x * captured.width},${y * captured.height}`)
          .join(" ");
        return (
          <g key={polyIdx}>
            <polygon
              points={pts}
              fill="rgba(99, 102, 241, 0.30)"
              stroke="rgb(99, 102, 241)"
              strokeWidth={2}
              strokeLinejoin="round"
            />
            {poly.points.map(([x, y], ptIdx) => {
              const isActive =
                drag?.polygonIdx === polyIdx && drag.pointIdx === ptIdx;
              return (
                <circle
                  key={ptIdx}
                  cx={x * captured.width}
                  cy={y * captured.height}
                  r={isActive ? 8 : 6}
                  fill="white"
                  stroke="rgb(99, 102, 241)"
                  strokeWidth={2}
                  className="pointer-events-auto cursor-grab active:cursor-grabbing"
                  style={{ touchAction: "none" }}
                  onPointerDown={handlePointerDown(polyIdx, ptIdx)}
                  onPointerMove={handlePointerMove}
                  onPointerUp={endDrag}
                  onPointerCancel={endDrag}
                />
              );
            })}
          </g>
        );
      })}
    </svg>
  );
}
