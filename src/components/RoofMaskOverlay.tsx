// src/components/RoofMaskOverlay.tsx
"use client";

import { useDetection } from "./DetectionContext";

export function RoofMaskOverlay() {
  const { status, polygons, captured } = useDetection();

  if (status !== "success" || !captured || polygons.length === 0) return null;

  return (
    <svg
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
      {polygons.map((poly, i) => {
        const pts = poly.points
          .map(([x, y]) => `${x * captured.width},${y * captured.height}`)
          .join(" ");
        return (
          <g key={i}>
            <polygon
              points={pts}
              fill="rgba(99, 102, 241, 0.30)"
              stroke="rgb(99, 102, 241)"
              strokeWidth={2}
              strokeLinejoin="round"
            />
            {poly.points.map(([x, y], j) => (
              <circle
                key={j}
                cx={x * captured.width}
                cy={y * captured.height}
                r={3}
                fill="white"
                stroke="rgb(99, 102, 241)"
                strokeWidth={1.5}
              />
            ))}
          </g>
        );
      })}
    </svg>
  );
}
