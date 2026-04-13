// src/components/AutoDetectButton.tsx
"use client";

import { toPng } from "html-to-image";
import { useCallback, type RefObject } from "react";
import { useDetection, type CapturedRect } from "./DetectionContext";
import { useMapCenter } from "./MapCenterContext";
import type {
  DetectRequestBody,
  DetectResponse,
} from "@/lib/detect/schema";

type Props = {
  mapContainerRef: RefObject<HTMLDivElement | null>;
};

const CAPTURE_SIZE = 640;

function computeCenteredRect(container: HTMLElement): CapturedRect {
  const r = container.getBoundingClientRect();
  const size = Math.min(CAPTURE_SIZE, r.width, r.height);
  const cx = r.width / 2;
  const cy = r.height / 2;
  return {
    left: Math.round(cx - size / 2),
    top: Math.round(cy - size / 2),
    width: Math.round(size),
    height: Math.round(size),
  };
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = (e) => reject(e instanceof Error ? e : new Error("image load failed"));
    img.src = src;
  });
}

async function captureCenterSquare(
  container: HTMLElement,
  rect: CapturedRect,
): Promise<string> {
  const fullDataUrl = await toPng(container, {
    cacheBust: true,
    pixelRatio: 1,
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
  const { status, setStatus, setResult, setError, reset } = useDetection();
  const { center } = useMapCenter();

  const run = useCallback(async () => {
    const container = mapContainerRef.current;
    if (!container) {
      setError("지도 컨테이너를 찾을 수 없습니다.");
      return;
    }
    try {
      setStatus("capturing");
      const rect = computeCenteredRect(container);
      const imageDataUrl = await captureCenterSquare(container, rect);

      setStatus("calling");
      const body: DetectRequestBody = {
        imageDataUrl,
        bounds: {
          sw: { lat: center.lat, lng: center.lng },
          ne: { lat: center.lat, lng: center.lng },
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
        };
        throw new Error(errBody.error || `HTTP ${resp.status}`);
      }
      const data = (await resp.json()) as DetectResponse;
      if (data.polygons.length === 0) {
        setError("지붕을 찾지 못했습니다. 건물을 화면 중앙에 두고 다시 시도하세요.");
        return;
      }
      setResult(data.polygons, rect);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "알 수 없는 오류";
      setError(msg);
    }
  }, [center.lat, center.lng, mapContainerRef, setError, setResult, setStatus]);

  const busy = status === "capturing" || status === "calling";
  const label =
    status === "capturing"
      ? "지도 캡처 중..."
      : status === "calling"
        ? "AI 분석 중..."
        : status === "success"
          ? "다시 감지"
          : status === "error"
            ? "재시도"
            : "자동 지붕 인식 (Auto Detect)";

  const showReset = status === "success" || status === "error";

  return (
    <div className="flex items-center gap-3">
      {showReset && (
        <button
          type="button"
          onClick={reset}
          className="flex items-center gap-2 bg-surface-container text-on-surface px-5 py-4 rounded-full shadow-xl border border-outline-variant/30 hover:bg-surface-container-high transition-all"
          aria-label="감지 결과 초기화"
        >
          <span className="material-symbols-outlined text-xl">close</span>
          <span className="font-headline font-bold text-sm tracking-tight">
            초기화
          </span>
        </button>
      )}
      <button
        type="button"
        onClick={() => {
          if (status === "success" || status === "error") reset();
          run();
        }}
        disabled={busy}
        className="flex items-center gap-3 bg-primary text-on-primary px-8 py-4 rounded-full shadow-2xl hover:bg-primary-container transition-all transform hover:scale-105 group disabled:opacity-60 disabled:cursor-not-allowed"
      >
        <span className="material-symbols-outlined text-2xl group-hover:rotate-90 transition-transform">
          {busy ? "progress_activity" : "document_scanner"}
        </span>
        <span className="font-headline font-extrabold text-lg tracking-tight">
          {label}
        </span>
      </button>
    </div>
  );
}
