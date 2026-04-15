// src/components/AutoDetectButton.tsx
"use client";

import { toPng } from "html-to-image";
import { useCallback, useEffect, useRef, type RefObject } from "react";
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

/** Chrome around the map: SideNav (left 320px), header (top 56px),
 *  bottom CTA (~120px). Keep in sync with detect/page.tsx layout. */
const CHROME = { left: 320, top: 56, right: 24, bottom: 140 };

/** Fallback cap if Google's getMaxZoom() is unavailable. Satellite imagery
 *  typically tops out around 20–22 depending on location; past that, tiles
 *  don't exist and the map renders as broken grey tiles. */
const SATELLITE_ZOOM_CAP = 21;

/** Compute the integer zoom delta needed to make rect appear at least
 *  3× its current size, capped so it still fits the visible area.
 *  Returns delta in zoom levels (each +1 doubles linear resolution). */
function computeZoomDelta(container: HTMLElement, rect: CapturedRect): number {
  const visibleW = Math.max(1, container.clientWidth - CHROME.left - CHROME.right);
  const visibleH = Math.max(1, container.clientHeight - CHROME.top - CHROME.bottom);
  const maxScale = Math.min(visibleW / rect.width, visibleH / rect.height);
  const maxDelta = Math.floor(Math.log2(Math.max(1, maxScale)));
  /** Fixed minimum scale for map zoom — independent of user's ZoomFactor choice. */
  const MAP_ZOOM_MIN_SCALE = 3;
  const desiredDelta = Math.ceil(Math.log2(MAP_ZOOM_MIN_SCALE));
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
  pixelRatio: number,
): Promise<string> {
  // `includeQueryParams: true` is REQUIRED. html-to-image strips query strings
  // from its cache keys by default, so all Google Maps tile URLs (which share
  // the same base `https://maps.googleapis.com/maps/vt` and differ only in the
  // `?pb=...` query) collapse to one key. The first capture works because
  // parallel fetches race the cache, but on subsequent captures every tile
  // resolves to the *last* cached tile — producing the repeated-tile pattern.
  const safeRatio = Math.max(1, Math.min(pixelRatio, 3));
  const fullDataUrl = await toPng(container, {
    cacheBust: true,
    includeQueryParams: true,
    pixelRatio: safeRatio,
    skipFonts: true,
  });
  const img = await loadImage(fullDataUrl);
  const scaleX = img.width / container.clientWidth;
  const scaleY = img.height / container.clientHeight;
  const outW = Math.round(rect.width * safeRatio);
  const outH = Math.round(rect.height * safeRatio);
  const out = document.createElement("canvas");
  out.width = outW;
  out.height = outH;
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
    outW,
    outH,
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
    zoomFactor,
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

  // Tracks the in-flight /api/detect-roof request so re-select/reset/finalize
  // can abort it — otherwise a late response would overwrite a newer state
  // (e.g. flip `selecting` back to `success`).
  const detectAbortRef = useRef<AbortController | null>(null);
  const abortDetectIfRunning = useCallback(() => {
    detectAbortRef.current?.abort();
    detectAbortRef.current = null;
  }, []);
  useEffect(() => abortDetectIfRunning, [abortDetectIfRunning]);

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

        // Center on the selection and zoom in as much as possible (independent
        // of zoomFactor). The 2x/3x differentiation is handled by the capture
        // pixelRatio and preview display size, not map zoom.
        const currentZoom = map.getZoom() ?? 19;
        const delta = computeZoomDelta(container, rect);
        const targetZoom = Math.min(currentZoom + delta, SATELLITE_ZOOM_CAP);
        map.setCenter(bounds.getCenter());
        map.setZoom(targetZoom);
        await waitForMapIdle(map);

        setStatus("capturing");
        const fittedRect = await latLngBoundsToPixelRect(map, bounds);
        const imageDataUrl = await captureRect(container, fittedRect, zoomFactor);
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
    [map, mapContainerRef, setError, setPreview, setStatus, status, zoomFactor],
  );

  const handleConfirm = useCallback(async () => {
    if (!previewImage || !captured) return;

    // Any previous in-flight request is now obsolete.
    detectAbortRef.current?.abort();
    const controller = new AbortController();
    detectAbortRef.current = controller;
    const { signal } = controller;

    try {
      setStatus("calling");
      const bounds = lastBoundsRef.current;
      if (!bounds) {
        setError("좌표 정보가 없습니다. 영역을 다시 선택하세요.");
        return;
      }
      const sw = bounds.getSouthWest();
      const ne = bounds.getNorthEast();
      const body: DetectRequestBody = {
        imageDataUrl: previewImage,
        bounds: {
          sw: { lat: sw.lat(), lng: sw.lng() },
          ne: { lat: ne.lat(), lng: ne.lng() },
        },
      };
      const resp = await fetch("/api/detect-roof", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal,
      });
      if (signal.aborted) return;
      if (!resp.ok) {
        const errBody = (await resp.json().catch(() => ({}))) as {
          error?: string;
        };
        console.error("[detect] /api/detect-roof 오류 응답", {
          httpStatus: resp.status,
          body: errBody,
        });
        throw new Error(errBody.error || `HTTP ${resp.status}`);
      }
      const data = (await resp.json()) as DetectResponse;
      if (signal.aborted) return;
      if (data.polygons.length === 0) {
        const reasonLabel =
          data.reason === "low_confidence"
            ? `신뢰도 미달(${data.bboxConfidence?.toFixed(3) ?? "?"})`
            : data.reason === "no_polygons"
              ? `지붕 면을 식별하지 못함`
              : "사유 미보고";
        console.warn("[detect] 폴리곤 0개 반환", {
          reason: data.reason,
          bboxConfidence: data.bboxConfidence,
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
      if (signal.aborted) return;
      if (err instanceof DOMException && err.name === "AbortError") return;
      const msg = err instanceof Error ? err.message : "알 수 없는 오류";
      console.error("[detect] 분석 호출 실패", { error: err });
      setError(msg);
    } finally {
      if (detectAbortRef.current === controller) {
        detectAbortRef.current = null;
      }
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

  // Shared "return to region-select mode" path. Used for both the initial
  // CTA click and the modal's "다시 선택" button — aborting any in-flight
  // request is mandatory so the late response doesn't overwrite the new state.
  const returnToSelecting = useCallback(async () => {
    abortDetectIfRunning();
    await restoreOriginalCamera();
    startSelecting();
  }, [abortDetectIfRunning, restoreOriginalCamera, startSelecting]);

  // Shared "done with this session" path. Used by both the success "확정"
  // button and the idle "취소" button. Clears refs + aborts in-flight work
  // and returns the map to its pre-zoom camera.
  const endSession = useCallback(async () => {
    abortDetectIfRunning();
    await restoreOriginalCamera();
    originalCameraRef.current = null;
    lastBoundsRef.current = null;
    reset();
  }, [abortDetectIfRunning, reset, restoreOriginalCamera]);

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
              width: Math.round(captured.width * zoomFactor),
              height: Math.round(captured.height * zoomFactor),
            }}
            zoomFactor={zoomFactor}
            polygons={polygons}
            errorMessage={errorMessage}
            onConfirm={handleConfirm}
            onCancel={returnToSelecting}
            onFinalize={endSession}
            onPointChange={updatePolygonPoint}
          />
        )}
      <div className="flex items-center gap-3">
        {showReset && (
          <button
            type="button"
            onClick={endSession}
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
          onClick={returnToSelecting}
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
