// src/components/RegionSelectOverlay.tsx
"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { useDetection, type CapturedRect } from "./DetectionContext";

const MIN_SELECTION_PX = 24;

type DragState = {
  pointerId: number;
  startX: number;
  startY: number;
  curX: number;
  curY: number;
};

type Props = {
  /** Map container ref. The overlay is portal-rendered as its child so it
   *  covers exactly the map area regardless of where this component is mounted. */
  containerRef: RefObject<HTMLDivElement | null>;
  /** Returns the rect in container-relative pixels. */
  onComplete: (rect: CapturedRect) => void;
};

function rectFromDrag(d: DragState): CapturedRect {
  const left = Math.round(Math.min(d.startX, d.curX));
  const top = Math.round(Math.min(d.startY, d.curY));
  const right = Math.round(Math.max(d.startX, d.curX));
  const bottom = Math.round(Math.max(d.startY, d.curY));
  return {
    left,
    top,
    width: Math.max(1, right - left),
    height: Math.max(1, bottom - top),
  };
}

export function RegionSelectOverlay({ containerRef, onComplete }: Props) {
  const { setError, reset } = useDetection();
  const layerRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<DragState | null>(null);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      setDrag(null);
      reset();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [reset]);

  const localCoords = useCallback(
    (clientX: number, clientY: number): [number, number] => {
      const layer = layerRef.current;
      if (!layer) return [0, 0];
      const r = layer.getBoundingClientRect();
      return [clientX - r.left, clientY - r.top];
    },
    [],
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      const [x, y] = localCoords(e.clientX, e.clientY);
      setDrag({
        pointerId: e.pointerId,
        startX: x,
        startY: y,
        curX: x,
        curY: y,
      });
    },
    [localCoords],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!drag || drag.pointerId !== e.pointerId) return;
      const [x, y] = localCoords(e.clientX, e.clientY);
      setDrag((d) => (d ? { ...d, curX: x, curY: y } : d));
    },
    [drag, localCoords],
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!drag || drag.pointerId !== e.pointerId) return;
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        // capture may have been auto-released
      }
      const rect = rectFromDrag(drag);
      setDrag(null);
      if (rect.width < MIN_SELECTION_PX || rect.height < MIN_SELECTION_PX) {
        setError("선택 영역이 너무 작습니다. 다시 시도하세요.");
        return;
      }
      onComplete(rect);
    },
    [drag, onComplete, setError],
  );

  // pointercancel (OS gesture, context menu, tab switch) must NOT confirm the
  // selection — treat it as an abandoned drag and reset the state.
  const handlePointerCancel = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!drag || drag.pointerId !== e.pointerId) return;
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        // already released
      }
      setDrag(null);
    },
    [drag],
  );

  const [target, setTarget] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    setTarget(containerRef.current);
  }, [containerRef]);

  const rect = drag ? rectFromDrag(drag) : null;
  if (!target) return null;

  return createPortal(
    <div
      ref={layerRef}
      className="absolute inset-0 z-40"
      style={{
        cursor: "crosshair",
        touchAction: "none",
        background: drag ? "rgba(0,0,0,0.15)" : "rgba(0,0,0,0.05)",
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
    >
      {!drag && (
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 glass-panel px-4 py-2.5 rounded-full border border-white/30 shadow-lg pointer-events-none">
          <p className="text-xs font-medium text-on-surface flex items-center gap-2">
            <span className="material-symbols-outlined text-primary text-sm">
              crop_free
            </span>
            건물 위로 사각형을 드래그하세요
          </p>
        </div>
      )}
      {rect && (
        <svg
          aria-hidden
          className="absolute pointer-events-none"
          style={{
            left: rect.left,
            top: rect.top,
            width: rect.width,
            height: rect.height,
          }}
        >
          <rect
            x={1}
            y={1}
            width={rect.width - 2}
            height={rect.height - 2}
            fill="rgba(99, 102, 241, 0.20)"
            stroke="rgb(99, 102, 241)"
            strokeWidth={2}
            strokeDasharray="6 4"
          />
        </svg>
      )}
    </div>,
    target,
  );
}
