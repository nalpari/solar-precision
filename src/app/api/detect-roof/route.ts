// src/app/api/detect-roof/route.ts
import { NextResponse } from "next/server";
import { ApiError, GoogleGenAI, Type, type Schema } from "@google/genai";
import sharp from "sharp";
import {
  BboxResponseSchema,
  DetectResponseSchema,
  type BboxResponse,
  type DetectPolygon,
  type DetectRequestBody,
  type DetectResponse,
} from "@/lib/detect/schema";
import {
  BBOX_CROP_PADDING,
  BBOX_SYSTEM_PROMPT,
  BBOX_USER_PROMPT,
  DETECT_MODEL,
  ROOF_DETECT_SYSTEM_PROMPT,
  ROOF_DETECT_USER_PROMPT,
} from "@/lib/detect/prompt";

export const runtime = "nodejs";

const MAX_REQUEST_BYTES = 5 * 1024 * 1024;
const MAX_IMAGE_PIXELS = 25_000_000;

type MediaType = "image/png" | "image/jpeg" | "image/webp";

type ParsedDataUrl = {
  mediaType: MediaType;
  base64: string;
};

function parseDataUrl(dataUrl: string): ParsedDataUrl | null {
  const m = /^data:(image\/(png|jpeg|webp));base64,(.+)$/.exec(dataUrl);
  if (!m) return null;
  return { mediaType: m[1] as MediaType, base64: m[3] };
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

async function callGeminiJson<T>(
  client: GoogleGenAI,
  image: ParsedDataUrl,
  systemPrompt: string,
  userPrompt: string,
  responseSchema: Schema,
  validate: (parsed: unknown) =>
    | { success: true; data: T }
    | { success: false; error: string },
  maxOutputTokens: number = 2048,
): Promise<T> {
  const response = await client.models.generateContent({
    model: DETECT_MODEL,
    contents: [
      {
        role: "user",
        parts: [
          {
            inlineData: {
              mimeType: image.mediaType,
              data: image.base64,
            },
          },
          { text: userPrompt },
        ],
      },
    ],
    config: {
      systemInstruction: systemPrompt,
      responseMimeType: "application/json",
      responseSchema,
      maxOutputTokens,
      thinkingConfig: { thinkingBudget: 0 },
    },
  });

  const text = response.text;
  if (!text) {
    throw new Error("Gemini가 텍스트 응답을 반환하지 않았습니다.");
  }
  const payload = extractJsonPayload(text);
  if (!payload) {
    throw new Error("응답에서 JSON 객체를 찾지 못했습니다.");
  }
  const parsed = JSON.parse(payload) as unknown;
  const result = validate(parsed);
  if (!result.success) {
    throw new Error(`스키마 검증 실패: ${result.error}`);
  }
  return result.data;
}

const BBOX_RESPONSE_SCHEMA: Schema = {
  type: Type.OBJECT,
  required: ["bbox", "confidence"],
  properties: {
    bbox: {
      type: Type.ARRAY,
      minItems: "4",
      maxItems: "4",
      items: { type: Type.NUMBER, minimum: 0, maximum: 1 },
    },
    confidence: { type: Type.NUMBER, minimum: 0, maximum: 1 },
  },
};

const POLYGON_SCHEMA: Schema = {
  type: Type.OBJECT,
  required: ["points", "label", "confidence", "azimuth", "tilt"],
  properties: {
    points: {
      type: Type.ARRAY,
      minItems: "3",
      maxItems: "64",
      items: {
        type: Type.ARRAY,
        minItems: "2",
        maxItems: "2",
        items: { type: Type.NUMBER, minimum: 0, maximum: 1 },
      },
    },
    label: { type: Type.STRING },
    confidence: { type: Type.NUMBER, minimum: 0, maximum: 1 },
    azimuth: { type: Type.NUMBER, minimum: 0, maximum: 360 },
    tilt: { type: Type.NUMBER, minimum: 0, maximum: 90 },
  },
};

const DETECT_RESPONSE_SCHEMA: Schema = {
  type: Type.OBJECT,
  required: ["polygons"],
  properties: {
    polygons: { type: Type.ARRAY, items: POLYGON_SCHEMA },
  },
};

async function locateBbox(
  client: GoogleGenAI,
  image: ParsedDataUrl,
): Promise<BboxResponse> {
  return callGeminiJson(
    client,
    image,
    BBOX_SYSTEM_PROMPT,
    BBOX_USER_PROMPT,
    BBOX_RESPONSE_SCHEMA,
    (parsed) => {
      const v = BboxResponseSchema.safeParse(parsed);
      if (!v.success) {
        return {
          success: false,
          error: v.error.issues
            .map((i) => `${i.path.join(".")} ${i.message}`)
            .join("; "),
        };
      }
      const [x1, y1, x2, y2] = v.data.bbox;
      if (v.data.confidence > 0 && (x2 <= x1 || y2 <= y1)) {
        return { success: false, error: "bbox 좌표가 비정상" };
      }
      return { success: true, data: v.data };
    },
  );
}

async function tracePolygon(
  client: GoogleGenAI,
  croppedImage: ParsedDataUrl,
): Promise<DetectResponse> {
  return callGeminiJson(
    client,
    croppedImage,
    ROOF_DETECT_SYSTEM_PROMPT,
    ROOF_DETECT_USER_PROMPT,
    DETECT_RESPONSE_SCHEMA,
    (parsed) => {
      const v = DetectResponseSchema.safeParse(parsed);
      if (!v.success) {
        return {
          success: false,
          error: v.error.issues
            .map((i) => `${i.path.join(".")} ${i.message}`)
            .join("; "),
        };
      }
      return { success: true, data: v.data };
    },
    // Multi-face JSON is larger than a single-polygon response; give Gemini headroom.
    8192,
  );
}

type CropInfo = {
  /** padded bbox in original normalized space */
  paddedBbox: [number, number, number, number];
  cropped: ParsedDataUrl;
};

async function cropToBbox(
  source: ParsedDataUrl,
  bbox: [number, number, number, number],
): Promise<CropInfo> {
  const buffer = Buffer.from(source.base64, "base64");
  const pipeline = sharp(buffer, {
    limitInputPixels: MAX_IMAGE_PIXELS,
    failOn: "error",
  });
  const meta = await pipeline.metadata();
  const W = meta.width;
  const H = meta.height;
  if (!W || !H) throw new Error("이미지 크기 메타데이터를 얻지 못했습니다.");

  const [x1, y1, x2, y2] = bbox;
  const w = x2 - x1;
  const h = y2 - y1;
  const padX = w * BBOX_CROP_PADDING;
  const padY = h * BBOX_CROP_PADDING;
  const px1 = Math.max(0, x1 - padX);
  const py1 = Math.max(0, y1 - padY);
  const px2 = Math.min(1, x2 + padX);
  const py2 = Math.min(1, y2 + padY);

  const left = Math.max(0, Math.min(W - 1, Math.round(px1 * W)));
  const top = Math.max(0, Math.min(H - 1, Math.round(py1 * H)));
  const width = Math.max(1, Math.min(W - left, Math.round((px2 - px1) * W)));
  const height = Math.max(1, Math.min(H - top, Math.round((py2 - py1) * H)));

  const out = await sharp(buffer, {
    limitInputPixels: MAX_IMAGE_PIXELS,
    failOn: "error",
  })
    .extract({ left, top, width, height })
    .png()
    .toBuffer();

  return {
    paddedBbox: [px1, py1, px2, py2],
    cropped: { mediaType: "image/png", base64: out.toString("base64") },
  };
}

function transformPolygonToOriginalSpace(
  polygon: DetectPolygon,
  paddedBbox: [number, number, number, number],
): DetectPolygon {
  const [bx1, by1, bx2, by2] = paddedBbox;
  const bw = bx2 - bx1;
  const bh = by2 - by1;
  return {
    ...polygon,
    points: polygon.points.map(([x, y]) => {
      const ox = bx1 + x * bw;
      const oy = by1 + y * bh;
      return [
        Math.max(0, Math.min(1, ox)),
        Math.max(0, Math.min(1, oy)),
      ] as [number, number];
    }),
  };
}

async function runTwoStageDetection(
  client: GoogleGenAI,
  image: ParsedDataUrl,
): Promise<DetectResponse> {
  const bboxResult = await locateBbox(client, image);
  if (bboxResult.confidence < 0.2) {
    console.warn(
      `[detect-roof] bbox 신뢰도 낮음 (${bboxResult.confidence.toFixed(3)} < 0.2) — 빈 결과 반환`,
    );
    return {
      polygons: [],
      reason: "low_confidence",
      bboxConfidence: bboxResult.confidence,
    };
  }
  const { paddedBbox, cropped } = await cropToBbox(image, bboxResult.bbox);
  const polygonResult = await tracePolygon(client, cropped);
  if (polygonResult.polygons.length === 0) {
    console.warn(
      `[detect-roof] bbox는 잡혔으나(conf=${bboxResult.confidence.toFixed(3)}) tracePolygon이 폴리곤 0개 반환`,
    );
    return {
      polygons: [],
      reason: "no_polygons",
      bboxConfidence: bboxResult.confidence,
    };
  }
  return {
    polygons: polygonResult.polygons.map((p) =>
      transformPolygonToOriginalSpace(p, paddedBbox),
    ),
    reason: "ok",
    bboxConfidence: bboxResult.confidence,
  };
}

export async function POST(req: Request) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error("[detect-roof] GEMINI_API_KEY 미설정");
    return NextResponse.json(
      { error: "Server is missing GEMINI_API_KEY" },
      { status: 500 },
    );
  }

  const declaredLen = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLen) && declaredLen > MAX_REQUEST_BYTES) {
    return NextResponse.json(
      { error: "Request body too large" },
      { status: 413 },
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
  // Defense-in-depth: enforce size even when Content-Length was absent/under-reported.
  if (body.imageDataUrl.length > MAX_REQUEST_BYTES) {
    return NextResponse.json(
      { error: "Image too large" },
      { status: 413 },
    );
  }
  const image = parseDataUrl(body.imageDataUrl);
  if (!image) {
    return NextResponse.json(
      { error: "imageDataUrl must be a base64 data URL (png/jpeg/webp)" },
      { status: 400 },
    );
  }

  const client = new GoogleGenAI({ apiKey });

  try {
    const result = await runTwoStageDetection(client, image);
    return NextResponse.json(result satisfies DetectResponse);
  } catch (err) {
    if (err instanceof ApiError) return respondWithUpstreamError(err, "호출");
    console.error("[detect-roof] 분석 실패:", err);
    return NextResponse.json(
      { error: "분석에 일시적으로 실패했습니다. 잠시 후 다시 시도하세요." },
      { status: 502 },
    );
  }
}

// Keep provider-specific hints (model name, tier, key source) in server logs only.
// The client response contains a generic message + status code so the UI can
// differentiate rate-limit vs. service-down, without leaking the upstream provider
// or deployment configuration.
function respondWithUpstreamError(err: ApiError, stage: string) {
  console.error(`[detect-roof] upstream ${err.status} (${stage}):`, err.message);
  const clientMessage =
    err.status === 429
      ? "요청이 일시적으로 많습니다. 잠시 후 다시 시도하세요."
      : err.status === 403 || err.status === 401
        ? "서비스 설정 오류로 분석할 수 없습니다. 관리자에게 문의하세요."
        : "분석 서비스가 일시적으로 응답하지 않습니다. 잠시 후 다시 시도하세요.";
  // Clamp upstream status to safe client-visible codes.
  const clientStatus = err.status === 429 ? 429 : 502;
  return NextResponse.json({ error: clientMessage }, { status: clientStatus });
}
