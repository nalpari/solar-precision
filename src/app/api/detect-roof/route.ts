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
