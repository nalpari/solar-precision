// src/components/PreviewModal.tsx
"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";
import type { DetectionStatus, SelectionSize, ZoomFactor } from "./DetectionContext";
import type { DetectPolygon } from "@/lib/detect/schema";
import { PreviewPolygonEditor } from "./PreviewPolygonEditor";

type Props = {
  status: DetectionStatus;
  imageDataUrl: string;
  /** Original drag rectangle size (viewport px). Preview renders at zoomFactor×. */
  sourceSize: SelectionSize;
  /** Image-space pixel size of the captured PNG (used as SVG viewBox). */
  capturedSize: { width: number; height: number };
  zoomFactor: ZoomFactor;
  polygons: DetectPolygon[];
  errorMessage: string | null;
  onConfirm: () => void;
  onCancel: () => void;
  onFinalize: () => void;
  onPointChange: (
    polygonIdx: number,
    pointIdx: number,
    point: [number, number],
  ) => void;
};

export function PreviewModal({
  status,
  imageDataUrl,
  sourceSize,
  capturedSize,
  zoomFactor,
  polygons,
  errorMessage,
  onConfirm,
  onCancel,
  onFinalize,
  onPointChange,
}: Props) {
  const displayW = sourceSize.width * zoomFactor;
  const displayH = sourceSize.height * zoomFactor;

  const isCalling = status === "calling";
  const isSuccess = status === "success";
  const isError = status === "error";

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      // Success → "확정"(close to idle); otherwise treat Esc as cancel so the
      // user is never trapped during a long AI call.
      if (isSuccess) onFinalize();
      else onCancel();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isSuccess, onCancel, onFinalize]);

  const headerLabel = (() => {
    if (isCalling) return "AI 분석 중";
    if (isSuccess) return "지붕 면 인식 결과";
    if (isError) return "분석 실패";
    return "캡처 영역 확인";
  })();

  const helpText = (() => {
    if (isCalling) return "AI가 지붕 면을 추론하고 있습니다…";
    if (isSuccess)
      return "각 지붕 면을 확인하고 꼭짓점을 드래그해 다듬으세요. 색상별로 면이 구분됩니다.";
    if (isError) return "다시 선택하거나 잠시 후 재시도 하세요.";
    return "이 이미지를 AI가 분석합니다. 영역이 지붕을 잘 포함하는지 확인하세요.";
  })();

  // Portal to body so an ancestor's CSS transform doesn't break `position: fixed`.
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 pl-80 pt-14"
      role="dialog"
      aria-modal="true"
      aria-label="캡처 미리보기"
      onClick={(e) => {
        // Close only when the click lands on the backdrop itself, not inside
        // the modal panel. Success → finalize so polygons are kept; otherwise
        // cancel (which also aborts any in-flight analysis).
        if (e.target !== e.currentTarget) return;
        if (isSuccess) onFinalize();
        else onCancel();
      }}
    >
      <div className="glass-panel w-fit max-w-[calc(100vw-360px)] mx-4 p-5 rounded-2xl shadow-2xl border border-white/30 bg-surface-container max-h-[90vh] flex flex-col">
        <div className="flex items-center gap-2 mb-3">
          <span className="material-symbols-outlined text-primary text-xl">
            {isSuccess ? "polyline" : isError ? "error" : "preview"}
          </span>
          <h2 className="font-headline font-extrabold text-base text-on-surface">
            {headerLabel}
          </h2>
        </div>
        <p className="text-xs text-outline mb-4">{helpText}</p>
        {isError && errorMessage && (
          <p className="text-[11px] text-error mb-3 break-words font-mono">
            {errorMessage}
          </p>
        )}
        <div className="rounded-lg overflow-auto border border-outline-variant/30 bg-black mb-5 max-h-[calc(90vh-220px)]">
          <div
            className="relative"
            style={{ width: displayW, height: displayH }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- data URL preview */}
            <img
              src={imageDataUrl}
              alt="캡처 미리보기"
              className="block"
              style={{ width: displayW, height: displayH, maxWidth: "none" }}
            />
            <PreviewPolygonEditor
              width={capturedSize.width}
              height={capturedSize.height}
              polygons={polygons}
              onPointChange={onPointChange}
              readOnly={!isSuccess}
            />
            {isCalling && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/40 backdrop-blur-[1px]">
                <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-surface-container/90 shadow-lg">
                  <span className="material-symbols-outlined text-primary text-base animate-spin">
                    progress_activity
                  </span>
                  <span className="text-xs font-headline font-bold text-on-surface">
                    분석 중…
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>
        <p className="text-[10px] text-outline mb-3 font-mono">
          선택 {sourceSize.width}×{sourceSize.height}px · 표시 {displayW}×
          {displayH}px (×{zoomFactor})
          {isSuccess && ` · 면 ${polygons.length}개 감지`}
        </p>
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            // Always enabled — including during `calling` — so the user can
            // abort a long AI request. The parent aborts the in-flight fetch.
            className="px-4 py-2.5 rounded-full text-sm font-headline font-bold text-on-surface bg-surface-container-high hover:bg-surface-container-highest transition-colors"
          >
            {isCalling ? "분석 취소" : "다시 선택"}
          </button>
          {isSuccess ? (
            <button
              type="button"
              onClick={onFinalize}
              className="flex items-center gap-2 px-5 py-2.5 rounded-full text-sm font-headline font-extrabold text-on-primary bg-primary hover:bg-primary-container transition-colors shadow-lg"
            >
              <span className="material-symbols-outlined text-base">
                check
              </span>
              확정
            </button>
          ) : isError ? null : (
            <button
              type="button"
              onClick={onConfirm}
              disabled={isCalling}
              className="flex items-center gap-2 px-5 py-2.5 rounded-full text-sm font-headline font-extrabold text-on-primary bg-primary hover:bg-primary-container transition-colors shadow-lg disabled:opacity-60 disabled:cursor-not-allowed"
            >
              <span className="material-symbols-outlined text-base">
                {isCalling ? "progress_activity" : "auto_awesome"}
              </span>
              {isCalling ? "분석 중…" : "분석 시작"}
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
