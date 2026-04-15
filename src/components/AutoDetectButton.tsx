// src/components/AutoDetectButton.tsx
"use client";

import { toPng } from "html-to-image";
import { useCallback, useRef, type RefObject } from "react";
import { useMap } from "@vis.gl/react-google-maps";
import { useDetection, type CapturedRect } from "./DetectionContext";
import { MAP_ID } from "./SiteMap";
import { RegionSelectOverlay } from "./RegionSelectOverlay";
import { PreviewModal } from "./PreviewModal";
import {
  latLngBoundsToPixelRect,
  pixelRectToLatLngBounds,
  waitForMapIdle,
  waitForMapSettled,
} from "@/lib/detect/mapGeometry";
import type {
  DetectRequestBody,
  DetectResponse,
} from "@/lib/detect/schema";

type Props = {
  mapContainerRef: RefObject<HTMLDivElement | null>;
};

const CAPTURE_PIXEL_RATIO = 2;

/** Chrome around the map: SideNav (left 320px), header (top 56px),
 *  bottom CTA (~120px). Keep in sync with detect/page.tsx layout. */
const CHROME = { left: 320, top: 56, right: 24, bottom: 140 };

/** Minimum on-screen enlargement of the user's selection. e.g. 3 = at least 3×. */
const MIN_ZOOM_FACTOR = 3;

/** Fallback cap if Google's getMaxZoom() is unavailable. Satellite imagery
 *  typically tops out around 20–22 depending on location; past that, tiles
 *  don't exist and the map renders as broken grey tiles. */
const SATELLITE_ZOOM_CAP = 21;

/** Compute the integer zoom delta needed to make rect appear at least
 *  MIN_ZOOM_FACTOR × its current size, capped so it still fits the visible area.
 *  Returns delta in zoom levels (each +1 doubles linear resolution). */
function computeZoomDelta(container: HTMLElement, rect: CapturedRect): number {
  const visibleW = Math.max(1, container.clientWidth - CHROME.left - CHROME.right);
  const visibleH = Math.max(1, container.clientHeight - CHROME.top - CHROME.bottom);
  // Highest zoom delta that still lets the rect fit inside visible area.
  const maxScale = Math.min(visibleW / rect.width, visibleH / rect.height);
  const maxDelta = Math.floor(Math.log2(Math.max(1, maxScale)));
  // Desired delta to reach MIN_ZOOM_FACTOR (rounded up, so we *exceed* the minimum).
  const desiredDelta = Math.ceil(Math.log2(MIN_ZOOM_FACTOR));
  return Math.max(1, Math.min(desiredDelta, maxDelta));
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = (e) =>
      reject(e instanceof Error ? e : new Error("image load failed"));
    img.src = src;
  });
}

async function captureRect(
  container: HTMLElement,
  rect: CapturedRect,
): Promise<string> {
  // `includeQueryParams: true` is REQUIRED. html-to-image strips query strings
  // from its cache keys by default, so all Google Maps tile URLs (which share
  // the same base `https://maps.googleapis.com/maps/vt` and differ only in the
  // `?pb=...` query) collapse to one key. The first capture works because
  // parallel fetches race the cache, but on subsequent captures every tile
  // resolves to the *last* cached tile — producing the repeated-tile pattern.
  const fullDataUrl = await toPng(container, {
    cacheBust: true,
    includeQueryParams: true,
    pixelRatio: CAPTURE_PIXEL_RATIO,
    skipFonts: true,
  });
  const img = await loadImage(fullDataUrl);
  const scaleX = img.width / container.clientWidth;
  const scaleY = img.height / container.clientHeight;
  const out = document.createElement("canvas");
  out.width = rect.width;
  out.height = rect.height;
  const ctx = out.getContext("2d");
  if (!ctx) throw new Error("canvas 2d context 생성 실패");
  ctx.drawImage(
    img,
    Math.round(rect.left * scaleX),
    Math.round(rect.top * scaleY),
    Math.round(rect.width * scaleX),
    Math.round(rect.height * scaleY),
    0,
    0,
    rect.width,
    rect.height,
  );
  return out.toDataURL("image/png");
}

export function AutoDetectButton({ mapContainerRef }: Props) {
  const {
    status,
    polygons,
    previewImage,
    sourceSelectionSize,
    captured,
    errorMessage,
    setStatus,
    startSelecting,
    setPreview,
    setResult,
    setError,
    reset,
    updatePolygonPoint,
  } = useDetection();
  const map = useMap(MAP_ID);

  // Bounds captured during the zoom step; reused if the user re-selects.
  const lastBoundsRef = useRef<google.maps.LatLngBounds | null>(null);

  // Map camera before the first zoom-in of a session. We restore to this on
  // re-select so repeated selections don't compound zoom past the max
  // satellite zoom (which would render as broken grey tiles).
  const originalCameraRef = useRef<{
    zoom: number;
    center: google.maps.LatLng | google.maps.LatLngLiteral;
  } | null>(null);

  const handleRegionPicked = useCallback(
    async (rect: CapturedRect) => {
      const container = mapContainerRef.current;
      if (!container) {
        setError("지도 컨테이너를 찾을 수 없습니다.");
        return;
      }
      if (!map) {
        setError("지도 인스턴스 준비 중입니다. 잠시 후 다시 시도하세요.");
        return;
      }
      try {
        setStatus("zooming");

        // Remember the pre-zoom camera on the first selection of a session so
        // re-selects can return here instead of zooming *on top of* the
        // already-zoomed-in view.
        if (!originalCameraRef.current) {
          const z = map.getZoom();
          const c = map.getCenter();
          if (typeof z === "number" && c) {
            originalCameraRef.current = { zoom: z, center: c };
          }
        }

        const bounds = await pixelRectToLatLngBounds(map, rect);
        lastBoundsRef.current = bounds;

        // Center on the selection, then bump zoom enough to enlarge ≥ MIN_ZOOM_FACTOR×,
        // clamped to the max available zoom so we never exceed the tile supply.
        const currentZoom = map.getZoom() ?? 19;
        const delta = computeZoomDelta(container, rect);
        const targetZoom = Math.min(currentZoom + delta, SATELLITE_ZOOM_CAP);
        map.setCenter(bounds.getCenter());
        map.setZoom(targetZoom);
        await waitForMapIdle(map);

        setStatus("capturing");
        const fittedRect = await latLngBoundsToPixelRect(map, bounds);
        const imageDataUrl = await captureRect(container, fittedRect);
        setPreview(imageDataUrl, fittedRect, {
          width: rect.width,
          height: rect.height,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "알 수 없는 오류";
        console.error("[detect] 영역 캡처 단계 실패", {
          stage: status,
          rect,
          error: err,
        });
        setError(msg);
      }
    },
    [map, mapContainerRef, setError, setPreview, setStatus, status],
  );

  const handleConfirm = useCallback(async () => {
    if (!previewImage || !captured) return;
    try {
      setStatus("calling");
      const bounds = lastBoundsRef.current;
      const sw = bounds?.getSouthWest();
      const ne = bounds?.getNorthEast();
      const body: DetectRequestBody = {
        imageDataUrl: previewImage,
        bounds: {
          sw: { lat: sw?.lat() ?? 0, lng: sw?.lng() ?? 0 },
          ne: { lat: ne?.lat() ?? 0, lng: ne?.lng() ?? 0 },
        },
      };
      const resp = await fetch("/api/detect-roof", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!resp.ok) {
        const errBody = (await resp.json().catch(() => ({}))) as {
          error?: string;
          upstreamStatus?: number;
        };
        console.error("[detect] /api/detect-roof 오류 응답", {
          httpStatus: resp.status,
          upstreamStatus: errBody.upstreamStatus,
          body: errBody,
        });
        throw new Error(errBody.error || `HTTP ${resp.status}`);
      }
      const data = (await resp.json()) as DetectResponse;
      if (data.polygons.length === 0) {
        const reasonLabel =
          data.reason === "low_confidence"
            ? `bbox 신뢰도 미달(${data.bboxConfidence?.toFixed(3) ?? "?"} < 0.2)`
            : data.reason === "no_polygons"
              ? `bbox는 잡혔으나(conf=${data.bboxConfidence?.toFixed(3) ?? "?"}) 폴리곤 0개`
              : "사유 미보고";
        console.warn("[detect] 폴리곤 0개 반환", {
          reason: data.reason,
          bboxConfidence: data.bboxConfidence,
          raw: data,
        });
        setError(`지붕을 찾지 못했습니다. (${reasonLabel}) 영역을 다시 선택하세요.`);
        return;
      }
      console.info("[detect] 분석 성공", {
        polygons: data.polygons.length,
        reason: data.reason,
        bboxConfidence: data.bboxConfidence,
      });
      setResult(data.polygons, captured);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "알 수 없는 오류";
      console.error("[detect] 분석 호출 실패", { error: err });
      setError(msg);
    }
  }, [captured, previewImage, setError, setResult, setStatus]);

  const restoreOriginalCamera = useCallback(async () => {
    if (!map) return;
    const original = originalCameraRef.current;
    if (!original) return;
    map.setCenter(original.center);
    map.setZoom(original.zoom);
    // Lightweight wait: the restore target is usually already tiled, so
    // `tilesloaded` may never fire. Using the capture-grade wait here would
    // force the 3 s safety timeout every time and make re-select/cancel feel
    // sluggish.
    await waitForMapSettled(map);
  }, [map]);

  const handleStartOrRestart = useCallback(async () => {
    await restoreOriginalCamera();
    startSelecting();
  }, [restoreOriginalCamera, startSelecting]);

  const handleReselect = useCallback(async () => {
    await restoreOriginalCamera();
    startSelecting();
  }, [restoreOriginalCamera, startSelecting]);

  const handleFinalize = useCallback(async () => {
    // Close the popup and return the map to its pre-zoom camera so the user
    // can keep working with the surrounding context. Polygons are kept in
    // context state for downstream consumers; the popup-only overlay disappears
    // because PreviewModal stops rendering once status leaves success.
    await restoreOriginalCamera();
    originalCameraRef.current = null;
    lastBoundsRef.current = null;
    reset();
  }, [reset, restoreOriginalCamera]);

  const handleReset = useCallback(async () => {
    await restoreOriginalCamera();
    originalCameraRef.current = null;
    lastBoundsRef.current = null;
    reset();
  }, [reset, restoreOriginalCamera]);

  const busy =
    status === "zooming" ||
    status === "capturing" ||
    status === "calling";

  const label = (() => {
    switch (status) {
      case "selecting":
        return "영역을 드래그하세요";
      case "zooming":
        return "확대 중...";
      case "capturing":
        return "지도 캡처 중...";
      case "previewing":
        return "확인 대기 중";
      case "calling":
        return "AI 분석 중...";
      case "success":
        return "다시 감지";
      case "error":
        return "재시도";
      default:
        return "영역 선택 시작";
    }
  })();

  const showReset =
    status === "success" ||
    status === "error" ||
    status === "selecting" ||
    status === "previewing";

  const buttonDisabled = busy || status === "selecting";

  return (
    <>
      {status === "selecting" && (
        <RegionSelectOverlay
          containerRef={mapContainerRef}
          onComplete={handleRegionPicked}
        />
      )}
      {(status === "previewing" ||
        status === "calling" ||
        status === "success" ||
        status === "error") &&
        previewImage &&
        sourceSelectionSize &&
        captured && (
          <PreviewModal
            status={status}
            imageDataUrl={previewImage}
            sourceSize={sourceSelectionSize}
            capturedSize={{
              width: captured.width,
              height: captured.height,
            }}
            polygons={polygons}
            errorMessage={errorMessage}
            onConfirm={handleConfirm}
            onCancel={handleReselect}
            onFinalize={handleFinalize}
            onPointChange={updatePolygonPoint}
          />
        )}
      <div className="flex items-center gap-3">
        {showReset && (
          <button
            type="button"
            onClick={handleReset}
            className="flex items-center gap-2 bg-surface-container text-on-surface px-5 py-4 rounded-full shadow-xl border border-outline-variant/30 hover:bg-surface-container-high transition-all"
            aria-label="감지 결과 초기화"
          >
            <span className="material-symbols-outlined text-xl">close</span>
            <span className="font-headline font-bold text-sm tracking-tight">
              취소
            </span>
          </button>
        )}
        <button
          type="button"
          onClick={handleStartOrRestart}
          disabled={buttonDisabled}
          className="flex items-center gap-3 bg-primary text-on-primary px-8 py-4 rounded-full shadow-2xl hover:bg-primary-container transition-all transform hover:scale-105 group disabled:opacity-60 disabled:cursor-not-allowed"
        >
          <span className="material-symbols-outlined text-2xl group-hover:rotate-90 transition-transform">
            {busy ? "progress_activity" : "crop_free"}
          </span>
          <span className="font-headline font-extrabold text-lg tracking-tight">
            {label}
          </span>
        </button>
      </div>
    </>
  );
}
