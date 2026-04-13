# 자동 지붕 인식 (Auto Roof Detection) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/detect` 페이지에서 "자동 지붕 인식" 버튼을 누르면 현재 지도 중앙 건물의 지붕 윤곽선을 Anthropic Claude Vision API로 추론하여 SVG 폴리곤 마스크로 오버레이 렌더한다.

**Architecture:** 프론트는 `html2canvas`로 `SiteMap` 컨테이너 중앙 640×640 영역을 캡처, 서버 route handler가 `@anthropic-ai/sdk`를 호출해 `claude-sonnet-4-6`에 이미지를 보내 정규화된 폴리곤 좌표(JSON)를 받아오고, 프론트는 반환 좌표를 SVG `<polygon>`으로 렌더한다. 상태는 페이지 내부 컨텍스트로 공유한다.

**Tech Stack:** Next.js 16.2 App Router, React 19.2, TypeScript 5, `@vis.gl/react-google-maps`, `html2canvas`, `@anthropic-ai/sdk`, `zod`, Tailwind v4. 패키지 매니저는 `pnpm`.

**Prerequisites:** 작업 디렉토리는 `/Users/devgrr/interplug/mvp/solar/solar-precision`. 모든 pnpm 명령은 이 경로에서 실행한다.

**Note on TDD:** 이 프로젝트는 단위 테스트 프레임워크가 없으므로 각 Task 말미의 검증은 `pnpm lint`, `pnpm build`, 브라우저 스모크 테스트로 대체한다. 로직성 유닛(zod 스키마)은 `tsx` 일회성 스크립트로 런타임 확인한다.

---

## Task 1: 의존성 설치

**Files:**
- Modify: `package.json` (자동 변경)
- Modify: `pnpm-lock.yaml` (자동 변경)

- [ ] **Step 1: 라이브러리 설치**

```bash
cd /Users/devgrr/interplug/mvp/solar/solar-precision
pnpm add html2canvas @anthropic-ai/sdk zod
```

Expected: `package.json`의 `dependencies`에 세 패키지가 추가됨.

- [ ] **Step 2: 설치 확인**

```bash
cd /Users/devgrr/interplug/mvp/solar/solar-precision
pnpm list html2canvas @anthropic-ai/sdk zod
```

Expected: 세 패키지의 버전이 모두 출력. 미설치 메시지 없음.

- [ ] **Step 3: 빌드 체크**

```bash
cd /Users/devgrr/interplug/mvp/solar/solar-precision
pnpm build
```

Expected: 빌드 성공. 기존 기능에 영향 없음.

- [ ] **Step 4: 커밋**

```bash
cd /Users/devgrr/interplug/mvp/solar/solar-precision
git add package.json pnpm-lock.yaml
git commit -m "chore: html2canvas, anthropic SDK, zod 의존성 추가"
```

---

## Task 2: 응답 스키마 및 타입 정의

**Files:**
- Create: `src/lib/detect/schema.ts`

- [ ] **Step 1: 스키마 파일 작성**

```ts
// src/lib/detect/schema.ts
import { z } from "zod";

const NormalizedPoint = z
  .tuple([z.number().min(0).max(1), z.number().min(0).max(1)]);

export const PolygonSchema = z.object({
  points: z.array(NormalizedPoint).min(3),
  label: z.string().min(1),
  confidence: z.number().min(0).max(1),
});

export const DetectResponseSchema = z.object({
  polygons: z.array(PolygonSchema).min(0),
});

export type DetectPolygon = z.infer<typeof PolygonSchema>;
export type DetectResponse = z.infer<typeof DetectResponseSchema>;

export type LatLngBounds = {
  sw: { lat: number; lng: number };
  ne: { lat: number; lng: number };
};

export type DetectRequestBody = {
  imageDataUrl: string;
  bounds: LatLngBounds;
};
```

- [ ] **Step 2: 스키마 런타임 검증 스크립트 실행**

```bash
cd /Users/devgrr/interplug/mvp/solar/solar-precision
pnpm dlx tsx -e "
import { DetectResponseSchema } from './src/lib/detect/schema';
const ok = DetectResponseSchema.safeParse({ polygons: [{ points: [[0.1,0.1],[0.9,0.1],[0.9,0.9]], label: 'primary_roof', confidence: 0.9 }] });
const bad1 = DetectResponseSchema.safeParse({ polygons: [{ points: [[0.1,0.1],[0.9,0.1]], label: 'x', confidence: 0.5 }] });
const bad2 = DetectResponseSchema.safeParse({ polygons: [{ points: [[0.1,1.5],[0.2,0.2],[0.3,0.3]], label: 'x', confidence: 0.5 }] });
console.log('ok:', ok.success, '| bad1:', bad1.success, '| bad2:', bad2.success);
if (!ok.success || bad1.success || bad2.success) process.exit(1);
"
```

Expected: `ok: true | bad1: false | bad2: false` 출력, exit code 0.

- [ ] **Step 3: 타입체크**

```bash
cd /Users/devgrr/interplug/mvp/solar/solar-precision
pnpm tsc --noEmit
```

Expected: 에러 없음.

- [ ] **Step 4: 커밋**

```bash
cd /Users/devgrr/interplug/mvp/solar/solar-precision
git add src/lib/detect/schema.ts
git commit -m "feat: 지붕 감지 응답 zod 스키마 및 타입 정의"
```

---

## Task 3: 프롬프트 상수 정의

**Files:**
- Create: `src/lib/detect/prompt.ts`

- [ ] **Step 1: 프롬프트 파일 작성**

```ts
// src/lib/detect/prompt.ts
export const ROOF_DETECT_SYSTEM_PROMPT = `You analyze top-down satellite images of buildings and return the roof outline of the single most central building.

OUTPUT REQUIREMENTS:
- Respond with ONLY valid JSON. No prose, no markdown fences, no commentary.
- JSON shape: {"polygons":[{"points":[[x,y],...],"label":"primary_roof","confidence":0.0-1.0}]}
- Coordinates are normalized in image space: x is horizontal (0=left, 1=right), y is vertical (0=top, 1=bottom).
- Return exactly ONE polygon for the building closest to the image center.
- Each polygon must have at least 3 points and at most 24 points.
- Points must trace the roof perimeter in order (clockwise or counter-clockwise).
- All x and y values must be within [0, 1].
- If no clear roof is visible at the center, return {"polygons":[]}.`;

export const ROOF_DETECT_USER_PROMPT =
  "Return the roof polygon for the central building in this satellite image, following the JSON schema exactly.";

export const DETECT_MODEL = "claude-sonnet-4-6";
```

- [ ] **Step 2: 타입체크**

```bash
cd /Users/devgrr/interplug/mvp/solar/solar-precision
pnpm tsc --noEmit
```

Expected: 에러 없음.

- [ ] **Step 3: 커밋**

```bash
cd /Users/devgrr/interplug/mvp/solar/solar-precision
git add src/lib/detect/prompt.ts
git commit -m "feat: Claude Vision용 지붕 감지 프롬프트 상수 추가"
```

---

## Task 4: API Route Handler 작성

**Files:**
- Create: `src/app/api/detect-roof/route.ts`

- [ ] **Step 1: Next 16 Route Handler 문서 확인**

참고 위치: `node_modules/next/dist/docs/` (프로젝트 AGENTS.md 참조). Route Handler는 `export async function POST(req: Request)` 시그니처. Edge 런타임이 아닌 Node 런타임(`@anthropic-ai/sdk`가 Node 전용)이므로 `export const runtime = "nodejs"` 명시.

- [ ] **Step 2: Route Handler 작성**

```ts
// src/app/api/detect-roof/route.ts
import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import {
  DetectResponseSchema,
  type DetectRequestBody,
  type DetectResponse,
} from "@/lib/detect/schema";
import {
  ROOF_DETECT_SYSTEM_PROMPT,
  ROOF_DETECT_USER_PROMPT,
  DETECT_MODEL,
} from "@/lib/detect/prompt";

export const runtime = "nodejs";

type ParsedDataUrl = {
  mediaType: "image/png" | "image/jpeg" | "image/webp" | "image/gif";
  base64: string;
};

function parseDataUrl(dataUrl: string): ParsedDataUrl | null {
  const match = /^data:(image\/(png|jpeg|webp|gif));base64,(.+)$/.exec(dataUrl);
  if (!match) return null;
  return {
    mediaType: match[1] as ParsedDataUrl["mediaType"],
    base64: match[3],
  };
}

function extractJsonPayload(text: string): string | null {
  const trimmed = text.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) return trimmed;
  const fenced = /```(?:json)?\s*(\{[\s\S]*?\})\s*```/.exec(trimmed);
  if (fenced) return fenced[1];
  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first !== -1 && last > first) return trimmed.slice(first, last + 1);
  return null;
}

async function callClaude(
  client: Anthropic,
  image: ParsedDataUrl,
): Promise<DetectResponse> {
  const message = await client.messages.create({
    model: DETECT_MODEL,
    max_tokens: 1024,
    system: ROOF_DETECT_SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: image.mediaType,
              data: image.base64,
            },
          },
          { type: "text", text: ROOF_DETECT_USER_PROMPT },
        ],
      },
    ],
  });

  const textBlock = message.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("Claude가 텍스트 응답을 반환하지 않았습니다.");
  }
  const payload = extractJsonPayload(textBlock.text);
  if (!payload) {
    throw new Error("응답에서 JSON 객체를 찾지 못했습니다.");
  }
  const parsed = JSON.parse(payload) as unknown;
  const validated = DetectResponseSchema.safeParse(parsed);
  if (!validated.success) {
    throw new Error(
      `스키마 검증 실패: ${validated.error.issues.map((i) => i.path.join(".") + " " + i.message).join("; ")}`,
    );
  }
  return validated.data;
}

export async function POST(req: Request) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error("[detect-roof] ANTHROPIC_API_KEY 미설정");
    return NextResponse.json(
      { error: "Server is missing ANTHROPIC_API_KEY" },
      { status: 500 },
    );
  }

  let body: DetectRequestBody;
  try {
    body = (await req.json()) as DetectRequestBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body?.imageDataUrl || typeof body.imageDataUrl !== "string") {
    return NextResponse.json(
      { error: "imageDataUrl is required" },
      { status: 400 },
    );
  }
  const image = parseDataUrl(body.imageDataUrl);
  if (!image) {
    return NextResponse.json(
      { error: "imageDataUrl must be a base64 data URL (png/jpeg/webp/gif)" },
      { status: 400 },
    );
  }

  const client = new Anthropic({ apiKey });

  try {
    const result = await callClaude(client, image);
    return NextResponse.json(result satisfies DetectResponse);
  } catch (err1) {
    console.warn("[detect-roof] 1차 호출 실패, 재시도:", err1);
    try {
      const result = await callClaude(client, image);
      return NextResponse.json(result satisfies DetectResponse);
    } catch (err2) {
      console.error("[detect-roof] 재시도 실패:", err2);
      const message = err2 instanceof Error ? err2.message : "Unknown error";
      return NextResponse.json({ error: message }, { status: 502 });
    }
  }
}
```

- [ ] **Step 3: 린트 + 타입체크 + 빌드**

```bash
cd /Users/devgrr/interplug/mvp/solar/solar-precision
pnpm lint && pnpm tsc --noEmit && pnpm build
```

Expected: 모두 통과.

- [ ] **Step 4: 입력 검증 스모크 (API 키 없이도 400 기대)**

```bash
cd /Users/devgrr/interplug/mvp/solar/solar-precision
pnpm dev &
DEV_PID=$!
sleep 4
curl -s -X POST http://localhost:3000/api/detect-roof \
  -H "content-type: application/json" \
  -d '{"imageDataUrl":"not-a-data-url","bounds":{"sw":{"lat":0,"lng":0},"ne":{"lat":0,"lng":0}}}' \
  -o /tmp/resp.json -w "%{http_code}\n"
cat /tmp/resp.json
kill $DEV_PID 2>/dev/null
```

Expected:
- API 키 없는 경우: HTTP 500, `{"error":"Server is missing ANTHROPIC_API_KEY"}` (키 검사가 먼저).
- 더미 키라도 설정된 경우: HTTP 400, `{"error":"imageDataUrl must be a base64 data URL..."}`.
둘 다 코드 경로 정상. 실제 호출은 Task 10에서 검증.

- [ ] **Step 5: 커밋**

```bash
cd /Users/devgrr/interplug/mvp/solar/solar-precision
git add src/app/api/detect-roof/route.ts
git commit -m "feat: Claude Vision 기반 지붕 감지 API 라우트 추가"
```

---

## Task 5: SiteMap에 컨테이너 ref 공개

**Files:**
- Modify: `src/components/SiteMap.tsx`

- [ ] **Step 1: SiteMap 수정 — forwardRef로 외부 ref 전달**

`src/components/SiteMap.tsx` 전체를 다음으로 교체:

```tsx
"use client";

import { Map, useMap } from "@vis.gl/react-google-maps";
import { forwardRef, useEffect, useRef } from "react";
import { useMapCenter } from "./MapCenterContext";

const MAP_ID = "solar-precision-map";
const GOOGLE_MAPS_API_KEY =
  process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || "";

function CenterUpdater() {
  const map = useMap(MAP_ID);
  const { center } = useMapCenter();
  const isFirst = useRef(true);

  useEffect(() => {
    if (!map) return;
    if (isFirst.current) {
      isFirst.current = false;
      return;
    }
    map.panTo(center);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- stable lat/lng deps
  }, [map, center.lat, center.lng]);

  return null;
}

type SiteMapProps = {
  zoom?: number;
  tint?: "none" | "primary" | "fade";
};

export const SiteMap = forwardRef<HTMLDivElement, SiteMapProps>(function SiteMap(
  { zoom = 19, tint = "none" },
  ref,
) {
  const { center } = useMapCenter();

  if (!GOOGLE_MAPS_API_KEY) {
    return (
      <div className="absolute inset-0 z-0 flex items-center justify-center bg-surface-container">
        <div className="glass-panel px-6 py-4 rounded-xl text-center max-w-sm">
          <p className="text-sm font-semibold text-on-surface mb-2">
            Google Maps API key missing
          </p>
          <p className="text-xs text-outline font-mono">
            Set NEXT_PUBLIC_GOOGLE_MAPS_API_KEY in .env
          </p>
        </div>
      </div>
    );
  }

  return (
    <div ref={ref} className="absolute inset-0 z-0">
      <Map
        id={MAP_ID}
        defaultCenter={center}
        defaultZoom={zoom}
        mapTypeId="satellite"
        tilt={0}
        disableDefaultUI
        gestureHandling="greedy"
        style={{ width: "100%", height: "100%" }}
      >
        <CenterUpdater />
      </Map>
      {tint === "primary" && (
        <div className="absolute inset-0 bg-primary/5 pointer-events-none" />
      )}
      {tint === "fade" && (
        <div className="absolute inset-0 map-gradient-overlay pointer-events-none" />
      )}
    </div>
  );
});
```

- [ ] **Step 2: 린트 + 타입체크 + 빌드**

```bash
cd /Users/devgrr/interplug/mvp/solar/solar-precision
pnpm lint && pnpm tsc --noEmit && pnpm build
```

Expected: 모두 통과. 기존 `page.tsx`에서 `<SiteMap />`를 ref 없이 사용하는 코드는 그대로 동작 (ref는 옵션).

- [ ] **Step 3: 커밋**

```bash
cd /Users/devgrr/interplug/mvp/solar/solar-precision
git add src/components/SiteMap.tsx
git commit -m "refactor: SiteMap을 forwardRef로 변환해 캡처 대상 ref 공개"
```

---

## Task 6: DetectionContext 작성

**Files:**
- Create: `src/components/DetectionContext.tsx`

- [ ] **Step 1: DetectionContext 파일 작성**

```tsx
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

  const value = useMemo<DetectionContextValue>(
    () => ({ ...state, setStatus, setResult, setError, reset }),
    [state, setStatus, setResult, setError, reset],
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
```

- [ ] **Step 2: 타입체크**

```bash
cd /Users/devgrr/interplug/mvp/solar/solar-precision
pnpm tsc --noEmit
```

Expected: 에러 없음.

- [ ] **Step 3: 커밋**

```bash
cd /Users/devgrr/interplug/mvp/solar/solar-precision
git add src/components/DetectionContext.tsx
git commit -m "feat: 감지 상태·결과 공유용 DetectionContext 추가"
```

---

## Task 7: RoofMaskOverlay 작성

**Files:**
- Create: `src/components/RoofMaskOverlay.tsx`

- [ ] **Step 1: SVG 오버레이 컴포넌트 작성**

```tsx
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
```

- [ ] **Step 2: 타입체크 + 린트**

```bash
cd /Users/devgrr/interplug/mvp/solar/solar-precision
pnpm tsc --noEmit && pnpm lint
```

Expected: 에러 없음.

- [ ] **Step 3: 커밋**

```bash
cd /Users/devgrr/interplug/mvp/solar/solar-precision
git add src/components/RoofMaskOverlay.tsx
git commit -m "feat: SVG 기반 지붕 폴리곤 오버레이 컴포넌트 추가"
```

---

## Task 8: AutoDetectButton 작성

**Files:**
- Create: `src/components/AutoDetectButton.tsx`

- [ ] **Step 1: 캡처 + fetch 버튼 컴포넌트 작성**

```tsx
// src/components/AutoDetectButton.tsx
"use client";

import html2canvas from "html2canvas";
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

async function captureCenterSquare(
  container: HTMLElement,
  rect: CapturedRect,
): Promise<string> {
  const full = await html2canvas(container, {
    useCORS: true,
    allowTaint: true,
    scale: 1,
    backgroundColor: null,
  });
  const scaleX = full.width / container.clientWidth;
  const scaleY = full.height / container.clientHeight;
  const out = document.createElement("canvas");
  out.width = rect.width;
  out.height = rect.height;
  const ctx = out.getContext("2d");
  if (!ctx) throw new Error("canvas 2d context 생성 실패");
  ctx.drawImage(
    full,
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

  return (
    <div className="flex flex-col items-center gap-2">
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
```

- [ ] **Step 2: 타입체크 + 린트**

```bash
cd /Users/devgrr/interplug/mvp/solar/solar-precision
pnpm tsc --noEmit && pnpm lint
```

Expected: 에러 없음.

- [ ] **Step 3: 커밋**

```bash
cd /Users/devgrr/interplug/mvp/solar/solar-precision
git add src/components/AutoDetectButton.tsx
git commit -m "feat: html2canvas 기반 자동 지붕 감지 트리거 버튼 추가"
```

---

## Task 9: detect/page.tsx 배선 및 상태 표시 교체

**Files:**
- Modify: `src/app/detect/page.tsx`

- [ ] **Step 1: 페이지 전체 교체**

`src/app/detect/page.tsx` 전체를 다음으로 교체:

```tsx
"use client";

import { useRef } from "react";
import { SideNav } from "@/components/SideNav";
import { SiteMap } from "@/components/SiteMap";
import { CoordinatesBentoCard } from "@/components/TargetCoordinates";
import { AutoDetectButton } from "@/components/AutoDetectButton";
import { RoofMaskOverlay } from "@/components/RoofMaskOverlay";
import {
  DetectionProvider,
  useDetection,
} from "@/components/DetectionContext";

function DetectionStatusModule() {
  const { status, polygons, errorMessage } = useDetection();

  const statusLabel = (() => {
    switch (status) {
      case "capturing":
        return "Capturing map tile...";
      case "calling":
        return "Analyzing with Claude Vision...";
      case "success":
        return `Detected (${polygons.length} polygon)`;
      case "error":
        return "Detection failed";
      default:
        return "Waiting for input...";
    }
  })();

  const progressWidth = (() => {
    switch (status) {
      case "capturing":
        return "33%";
      case "calling":
        return "66%";
      case "success":
        return "100%";
      case "error":
        return "100%";
      default:
        return "33%";
    }
  })();

  const ring =
    status === "error"
      ? "bg-error"
      : status === "success"
        ? "bg-secondary"
        : "bg-primary";

  return (
    <div className="bg-surface-container rounded-xl p-4 border border-outline-variant/15">
      <div className="flex items-center gap-3 mb-3">
        <span className="relative flex h-3 w-3">
          <span
            className={`animate-ping absolute inline-flex h-full w-full rounded-full ${ring} opacity-75`}
          />
          <span
            className={`relative inline-flex h-3 w-3 rounded-full ${ring}`}
          />
        </span>
        <span className="font-label text-[10px] font-bold uppercase tracking-widest text-primary">
          {status === "idle" ? "System Ready" : status.toUpperCase()}
        </span>
      </div>
      <p className="font-body text-xs text-on-surface leading-relaxed mb-4">
        {statusLabel}
      </p>
      {errorMessage && (
        <p className="font-body text-[11px] text-error mb-3 break-words">
          {errorMessage}
        </p>
      )}
      <div className="space-y-2">
        <div className="flex justify-between items-center text-[10px] font-mono text-tertiary">
          <span>PROGRESS</span>
          <span>
            {status === "success" && polygons[0]
              ? `conf ${Math.round(polygons[0].confidence * 100)}%`
              : status}
          </span>
        </div>
        <div className="w-full bg-outline-variant/20 h-1 rounded-full overflow-hidden">
          <div
            className={`${ring} h-full transition-all duration-300`}
            style={{ width: progressWidth }}
          />
        </div>
      </div>
    </div>
  );
}

function DetectPageBody() {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const { status } = useDetection();

  return (
    <>
      <SideNav footer={<DetectionStatusModule />} />
      <main className="pl-80 pt-14 h-screen w-full relative overflow-hidden">
        <SiteMap ref={mapContainerRef} tint="primary" />
        <RoofMaskOverlay />

        {/* Central reticle + tooltip — 감지 결과가 있을 때는 숨김 */}
        {status !== "success" && (
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-col items-center z-20 pointer-events-none">
            <div className="mb-4 glass-panel px-4 py-2.5 rounded-full border border-white/20 shadow-lg animate-bounce">
              <p className="text-xs font-medium text-on-surface flex items-center gap-2">
                <span className="material-symbols-outlined text-primary text-sm">
                  info
                </span>
                인식할 건물 위로 지도를 이동하세요
              </p>
            </div>
            <div className="relative">
              <div className="absolute inset-0 scale-150 border-2 border-primary/40 rounded-full animate-ping" />
              <div className="relative w-8 h-8 flex items-center justify-center">
                <span className="material-symbols-outlined filled text-primary text-4xl">
                  location_on
                </span>
                <div className="absolute -bottom-1 w-2 h-0.5 bg-black/20 blur-sm rounded-full" />
              </div>
            </div>
          </div>
        )}

        {/* Auto Detect CTA */}
        <div className="absolute bottom-10 left-1/2 -translate-x-1/2 z-30 pl-40">
          <AutoDetectButton mapContainerRef={mapContainerRef} />
        </div>

        {/* Right bento panels */}
        <div className="absolute right-6 top-20 flex flex-col gap-4 z-20 w-72">
          <CoordinatesBentoCard />

          <div className="glass-panel p-2 rounded-xl flex flex-col gap-1 shadow-sm border border-outline-variant/10">
            <button className="p-2 hover:bg-white rounded-lg transition-colors flex items-center gap-3 text-slate-600">
              <span className="material-symbols-outlined text-lg">layers</span>
              <span className="text-[11px] font-medium">Map Layers</span>
            </button>
            <button className="p-2 hover:bg-white rounded-lg transition-colors flex items-center gap-3 text-slate-600">
              <span className="material-symbols-outlined text-lg">
                3d_rotation
              </span>
              <span className="text-[11px] font-medium">3D View</span>
            </button>
            <button className="p-2 hover:bg-white rounded-lg transition-colors flex items-center gap-3 text-slate-600">
              <span className="material-symbols-outlined text-lg">
                straighten
              </span>
              <span className="text-[11px] font-medium">Measure</span>
            </button>
          </div>

          <div className="glass-panel p-4 rounded-xl shadow-sm border border-outline-variant/10">
            <div className="flex items-center gap-3">
              <span className="material-symbols-outlined text-3xl text-primary">
                wb_sunny
              </span>
              <div>
                <p className="text-[10px] font-bold text-tertiary uppercase">
                  Insolation
                </p>
                <p className="text-sm font-bold">5.2 kWh/m²</p>
              </div>
            </div>
          </div>
        </div>

        {/* Zoom / locate */}
        <div className="absolute right-6 bottom-10 flex flex-col gap-2 z-20">
          <div className="flex flex-col bg-white rounded-lg shadow-lg overflow-hidden border border-outline-variant/15">
            <button className="p-2.5 hover:bg-surface-container transition-colors border-b border-outline-variant/10">
              <span className="material-symbols-outlined text-xl">add</span>
            </button>
            <button className="p-2.5 hover:bg-surface-container transition-colors">
              <span className="material-symbols-outlined text-xl">remove</span>
            </button>
          </div>
          <button className="bg-white p-2.5 rounded-lg shadow-lg border border-outline-variant/15 hover:bg-surface-container transition-colors">
            <span className="material-symbols-outlined text-xl">
              my_location
            </span>
          </button>
        </div>

        {/* Scale bar */}
        <div className="absolute bottom-6 left-6 z-20 flex items-center gap-4 pl-80">
          <div className="glass-panel px-3 py-1 rounded border border-white/20 shadow-sm flex items-center gap-3">
            <div className="w-12 h-0.5 bg-on-surface-variant relative">
              <div className="absolute -left-0.5 -top-1 w-1 h-2 bg-on-surface-variant" />
              <div className="absolute -right-0.5 -top-1 w-1 h-2 bg-on-surface-variant" />
            </div>
            <span className="font-mono text-[10px] font-bold text-on-surface-variant">
              20m
            </span>
          </div>
          <div className="glass-panel px-3 py-1 rounded border border-white/20 shadow-sm">
            <span className="font-mono text-[10px] font-bold text-on-surface-variant uppercase">
              Google Satellite Hybrid
            </span>
          </div>
        </div>
      </main>
    </>
  );
}

export default function DetectPage() {
  return (
    <DetectionProvider>
      <DetectPageBody />
    </DetectionProvider>
  );
}
```

- [ ] **Step 2: 빌드/린트/타입체크**

```bash
cd /Users/devgrr/interplug/mvp/solar/solar-precision
pnpm lint && pnpm tsc --noEmit && pnpm build
```

Expected: 모두 통과.

- [ ] **Step 3: 커밋**

```bash
cd /Users/devgrr/interplug/mvp/solar/solar-precision
git add src/app/detect/page.tsx
git commit -m "feat: detect 페이지에 자동 지붕 감지 파이프라인 연결"
```

---

## Task 10: 브라우저 스모크 테스트 (API 키 필요)

**이 Task 수행 전에 사용자에게 `.env`에 `ANTHROPIC_API_KEY=sk-ant-...` 추가를 요청한다.**

**Files:** (수정 없음, 런타임 검증만)

- [ ] **Step 1: API 키 존재 확인**

```bash
cd /Users/devgrr/interplug/mvp/solar/solar-precision
grep -c "^ANTHROPIC_API_KEY=" .env
```

Expected: `1` 출력. `0`이면 사용자에게 키 추가 요청 후 중단.

- [ ] **Step 2: 개발 서버 기동**

```bash
cd /Users/devgrr/interplug/mvp/solar/solar-precision
pnpm dev
```

Expected: `Local: http://localhost:3000` 표시.

- [ ] **Step 3: 브라우저 검증 (chrome-devtools MCP 사용)**

1. `http://localhost:3000/detect`로 이동
2. 지도가 도표 타워 중심으로 로드되는지 확인
3. 지도를 주거 건물이 중앙에 오도록 조정
4. "자동 지붕 인식" 버튼 클릭
5. SideNav 하단 상태 모듈에서 `CAPTURING → CALLING → SUCCESS` 순서로 라벨 변화 확인
6. 지도 중앙 640×640 영역 위에 보라색 폴리곤이 그려지는지 확인
7. 콘솔에 에러 없음 확인

Expected: SUCCESS 상태 도달 + 폴리곤 시각화 + 신뢰도 표시.

- [ ] **Step 4: 에러 경로 검증**

1. 바다·하늘 등 건물이 없는 좌표로 이동 (예: 위도 36, 경도 128 해상)
2. 버튼 클릭
3. 상태가 `ERROR` 또는 빈 결과 안내로 전환되는지 확인
4. 메시지가 사용자에게 명확히 표시되는지 확인

Expected: 에러 메시지 노출, 재시도 버튼 활성화.

- [ ] **Step 5: 최종 린트/빌드 통과 재확인**

```bash
cd /Users/devgrr/interplug/mvp/solar/solar-precision
pnpm lint && pnpm tsc --noEmit && pnpm build
```

Expected: 모두 통과.

- [ ] **Step 6: 커밋 (변경사항이 있다면)**

스모크 중 발견한 버그를 수정했다면 별도 커밋. 없다면 스킵.

```bash
cd /Users/devgrr/interplug/mvp/solar/solar-precision
git status
# 변경 있으면:
# git add -A && git commit -m "fix: 스모크 테스트에서 발견된 이슈 수정"
```

---

## 마무리 체크리스트

- [ ] 모든 Task의 Step 완료
- [ ] 린트/타입/빌드 통과
- [ ] `/detect`에서 실제 지붕 감지 성공 확인
- [ ] `.env` 커밋 금지 확인 (`.gitignore`에 포함되어야 함)
- [ ] README에 "자동 지붕 인식" 섹션 업데이트 (선택)
