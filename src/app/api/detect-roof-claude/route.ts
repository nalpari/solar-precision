// src/app/api/detect-roof-claude/route.ts
import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import sharp from "sharp";
import {
  type DetectPolygon,
  type DetectRequestBody,
  type DetectResponse,
} from "@/lib/detect/schema";
import { BBOX_CROP_PADDING } from "@/lib/detect/prompt";
import { buildNorthMarker } from "@/lib/detect/overlay";
import {
  locateBboxClaude,
  tracePolygonClaude,
  type ClaudeImageInput,
  type ClaudeMediaType,
} from "@/lib/detect/claude";

export const runtime = "nodejs";

const MAX_REQUEST_BYTES = 5 * 1024 * 1024;
const MAX_IMAGE_PIXELS = 25_000_000;

function parseDataUrl(dataUrl: string): ClaudeImageInput | null {
  const m = /^data:(image\/(png|jpeg|webp));base64,(.+)$/.exec(dataUrl);
  if (!m) return null;
  return { mediaType: m[1] as ClaudeMediaType, base64: m[3] };
}

type CropInfo = {
  paddedBbox: [number, number, number, number];
  cropped: ClaudeImageInput;
};

async function cropToBbox(
  source: ClaudeImageInput,
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
    .composite([buildNorthMarker(width, height)])
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
  client: Anthropic,
  image: ClaudeImageInput,
): Promise<DetectResponse> {
  const bboxResult = await locateBboxClaude(client, image);
  if (bboxResult.confidence < 0.2) {
    console.warn(
      `[detect-roof-claude] bbox 신뢰도 낮음 (${bboxResult.confidence.toFixed(3)} < 0.2) — 빈 결과 반환`,
    );
    return {
      polygons: [],
      reason: "low_confidence",
      bboxConfidence: bboxResult.confidence,
    };
  }
  const { paddedBbox, cropped } = await cropToBbox(image, bboxResult.bbox);
  const polygonResult = await tracePolygonClaude(client, cropped);
  if (polygonResult.polygons.length === 0) {
    console.warn(
      `[detect-roof-claude] bbox는 잡혔으나(conf=${bboxResult.confidence.toFixed(3)}) tracePolygon이 폴리곤 0개 반환`,
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
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error("[detect-roof-claude] ANTHROPIC_API_KEY 미설정");
    return NextResponse.json(
      { error: "Server is missing ANTHROPIC_API_KEY" },
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

  const client = new Anthropic({ apiKey });

  try {
    const result = await runTwoStageDetection(client, image);
    return NextResponse.json(result satisfies DetectResponse);
  } catch (err) {
    if (err instanceof Anthropic.APIError) {
      return respondWithUpstreamError(err, "호출");
    }
    console.error("[detect-roof-claude] 분석 실패:", err);
    return NextResponse.json(
      { error: "분석에 일시적으로 실패했습니다. 잠시 후 다시 시도하세요." },
      { status: 502 },
    );
  }
}

function respondWithUpstreamError(err: InstanceType<typeof Anthropic.APIError>, stage: string) {
  console.error(
    `[detect-roof-claude] upstream ${err.status ?? "?"} (${stage}):`,
    err.message,
  );
  const clientMessage =
    err.status === 429
      ? "요청이 일시적으로 많습니다. 잠시 후 다시 시도하세요."
      : err.status === 403 || err.status === 401
        ? "서비스 설정 오류로 분석할 수 없습니다. 관리자에게 문의하세요."
        : "분석 서비스가 일시적으로 응답하지 않습니다. 잠시 후 다시 시도하세요.";
  const clientStatus = err.status === 429 ? 429 : 502;
  return NextResponse.json({ error: clientMessage }, { status: clientStatus });
}
