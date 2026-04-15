// src/components/PreviewPolygonEditor.tsx
"use client";

import { useCallback, useRef, useState } from "react";
import type { DetectPolygon } from "@/lib/detect/schema";

type DragState = {
  polygonIdx: number;
  pointIdx: number;
  pointerId: number;
};

type Props = {
  /** Image-space coordinate system size (used for SVG viewBox). */
  width: number;
  height: number;
  polygons: DetectPolygon[];
  onPointChange: (
    polygonIdx: number,
    pointIdx: number,
    point: [number, number],
  ) => void;
  /** When true, vertex handles can't be dragged (e.g. during AI call). */
  readOnly?: boolean;
};

const FACE_COLORS = [
  "#6366f1",
  "#22c55e",
  "#f59e0b",
  "#ef4444",
  "#a855f7",
  "#06b6d4",
  "#ec4899",
  "#84cc16",
];

const colorFor = (i: number) => FACE_COLORS[i % FACE_COLORS.length];

function centroid(pts: ReadonlyArray<readonly [number, number]>): [number, number] {
  const sum = pts.reduce<[number, number]>(
    (a, [x, y]) => [a[0] + x, a[1] + y],
    [0, 0],
  );
  return [sum[0] / pts.length, sum[1] / pts.length];
}

export function PreviewPolygonEditor({
  width,
  height,
  polygons,
  onPointChange,
  readOnly = false,
}: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<DragState | null>(null);

  const toNormalized = useCallback(
    (clientX: number, clientY: number): [number, number] | null => {
      const svg = svgRef.current;
      if (!svg) return null;
      const rect = svg.getBoundingClientRect();
      const x = (clientX - rect.left) / rect.width;
      const y = (clientY - rect.top) / rect.height;
      return [x, y];
    },
    [],
  );

  const handlePointerDown = useCallback(
    (polygonIdx: number, pointIdx: number) =>
      (e: React.PointerEvent<SVGCircleElement>) => {
        if (readOnly) return;
        e.stopPropagation();
        e.preventDefault();
        try {
          e.currentTarget.setPointerCapture(e.pointerId);
        } catch {
          // ignore — capture is best-effort
        }
        setDrag({ polygonIdx, pointIdx, pointerId: e.pointerId });
      },
    [readOnly],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<SVGCircleElement>) => {
      if (!drag || drag.pointerId !== e.pointerId) return;
      const next = toNormalized(e.clientX, e.clientY);
      if (!next) return;
      onPointChange(drag.polygonIdx, drag.pointIdx, next);
    },
    [drag, onPointChange, toNormalized],
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

  if (polygons.length === 0) return null;

  const arrowLen = Math.min(width, height) * 0.08;
  const headSize = Math.min(width, height) * 0.018;

  return (
    <svg
      ref={svgRef}
      aria-hidden
      className="pointer-events-none absolute inset-0 h-full w-full"
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
    >
      {polygons.map((poly, polyIdx) => {
        const color = colorFor(polyIdx);
        const pts = poly.points
          .map(([x, y]) => `${x * width},${y * height}`)
          .join(" ");
        const [cnx, cny] = centroid(poly.points);
        const cx = cnx * width;
        const cy = cny * height;
        const showArrow = poly.tilt >= 1;
        const azRad = (poly.azimuth * Math.PI) / 180;
        const dx = Math.sin(azRad);
        // SVG y grows downward; compass N = -y in image space.
        const dy = -Math.cos(azRad);
        const ex = cx + dx * arrowLen;
        const ey = cy + dy * arrowLen;
        // Arrowhead triangle: equilateral-ish, base perpendicular to arrow.
        const px = -dy;
        const py = dx;
        const headBackX = ex - dx * headSize;
        const headBackY = ey - dy * headSize;
        const headPts = [
          `${ex},${ey}`,
          `${headBackX + px * headSize * 0.6},${headBackY + py * headSize * 0.6}`,
          `${headBackX - px * headSize * 0.6},${headBackY - py * headSize * 0.6}`,
        ].join(" ");

        return (
          <g key={polyIdx}>
            <polygon
              points={pts}
              fill={color}
              fillOpacity={0.25}
              stroke={color}
              strokeWidth={2}
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
            {showArrow && (
              <>
                <line
                  x1={cx}
                  y1={cy}
                  x2={ex}
                  y2={ey}
                  stroke={color}
                  strokeWidth={3}
                  strokeLinecap="round"
                  vectorEffect="non-scaling-stroke"
                  style={{ pointerEvents: "none" }}
                />
                <polygon
                  points={headPts}
                  fill={color}
                  stroke={color}
                  strokeWidth={1}
                  vectorEffect="non-scaling-stroke"
                  style={{ pointerEvents: "none" }}
                />
              </>
            )}
            {poly.points.map(([x, y], ptIdx) => {
              const isActive =
                drag?.polygonIdx === polyIdx && drag.pointIdx === ptIdx;
              return (
                <circle
                  key={ptIdx}
                  cx={x * width}
                  cy={y * height}
                  r={isActive ? 8 : 6}
                  fill="white"
                  stroke={color}
                  strokeWidth={2}
                  vectorEffect="non-scaling-stroke"
                  className={
                    readOnly
                      ? "pointer-events-none"
                      : "pointer-events-auto cursor-grab active:cursor-grabbing"
                  }
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
