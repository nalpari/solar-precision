// src/app/api/detect-roof/route.ts
import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
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

type MediaType = "image/png" | "image/jpeg" | "image/webp" | "image/gif";

type ParsedDataUrl = {
  mediaType: MediaType;
  base64: string;
};

function parseDataUrl(dataUrl: string): ParsedDataUrl | null {
  const match = /^data:(image\/(png|jpeg|webp|gif));base64,(.+)$/.exec(dataUrl);
  if (!match) return null;
  return { mediaType: match[1] as MediaType, base64: match[3] };
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

async function callClaudeJson<T>(
  client: Anthropic,
  image: ParsedDataUrl,
  systemPrompt: string,
  userPrompt: string,
  validate: (parsed: unknown) =>
    | { success: true; data: T }
    | { success: false; error: string },
): Promise<T> {
  const message = await client.messages.create({
    model: DETECT_MODEL,
    max_tokens: 2048,
    system: systemPrompt,
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
          { type: "text", text: userPrompt },
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
  const result = validate(parsed);
  if (!result.success) {
    throw new Error(`스키마 검증 실패: ${result.error}`);
  }
  return result.data;
}

async function locateBbox(
  client: Anthropic,
  image: ParsedDataUrl,
): Promise<BboxResponse> {
  return callClaudeJson(
    client,
    image,
    BBOX_SYSTEM_PROMPT,
    BBOX_USER_PROMPT,
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
  client: Anthropic,
  croppedImage: ParsedDataUrl,
): Promise<DetectResponse> {
  return callClaudeJson(
    client,
    croppedImage,
    ROOF_DETECT_SYSTEM_PROMPT,
    ROOF_DETECT_USER_PROMPT,
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
  const meta = await sharp(buffer).metadata();
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

  const out = await sharp(buffer)
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
  client: Anthropic,
  image: ParsedDataUrl,
): Promise<DetectResponse> {
  const bboxResult = await locateBbox(client, image);
  if (bboxResult.confidence < 0.2) {
    return { polygons: [] };
  }
  const { paddedBbox, cropped } = await cropToBbox(image, bboxResult.bbox);
  const polygonResult = await tracePolygon(client, cropped);
  if (polygonResult.polygons.length === 0) return { polygons: [] };
  return {
    polygons: polygonResult.polygons.map((p) =>
      transformPolygonToOriginalSpace(p, paddedBbox),
    ),
  };
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
    const result = await runTwoStageDetection(client, image);
    return NextResponse.json(result satisfies DetectResponse);
  } catch (err1) {
    console.warn("[detect-roof] 1차 호출 실패, 재시도:", err1);
    try {
      const result = await runTwoStageDetection(client, image);
      return NextResponse.json(result satisfies DetectResponse);
    } catch (err2) {
      console.error("[detect-roof] 재시도 실패:", err2);
      const message = err2 instanceof Error ? err2.message : "Unknown error";
      return NextResponse.json({ error: message }, { status: 502 });
    }
  }
}
