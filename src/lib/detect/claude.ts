// src/lib/detect/claude.ts
import Anthropic from "@anthropic-ai/sdk";
import {
  BboxResponseSchema,
  DetectResponseSchema,
  type BboxResponse,
  type DetectResponse,
} from "@/lib/detect/schema";
import {
  BBOX_SYSTEM_PROMPT,
  BBOX_USER_PROMPT,
  ROOF_DETECT_SYSTEM_PROMPT,
  ROOF_DETECT_USER_PROMPT,
} from "@/lib/detect/prompt";

export const CLAUDE_DETECT_MODEL = "claude-opus-4-7";

export type ClaudeMediaType = "image/png" | "image/jpeg" | "image/webp";

export type ClaudeImageInput = {
  mediaType: ClaudeMediaType;
  base64: string;
};

const BBOX_TOOL_SCHEMA = {
  type: "object" as const,
  required: ["bbox", "confidence"],
  additionalProperties: false,
  properties: {
    bbox: {
      type: "array" as const,
      minItems: 4,
      maxItems: 4,
      items: { type: "number" as const, minimum: 0, maximum: 1 },
      description:
        "Normalized [x1, y1, x2, y2] bounds, 0..1. x horizontal, y vertical (top=0).",
    },
    confidence: {
      type: "number" as const,
      minimum: 0,
      maximum: 1,
      description: "0..1 confidence that the bbox tightly encloses the central building.",
    },
  },
};

const POLYGON_ITEM_SCHEMA = {
  type: "object" as const,
  required: ["points", "label", "confidence", "azimuth", "tilt"],
  additionalProperties: false,
  properties: {
    points: {
      type: "array" as const,
      minItems: 3,
      maxItems: 64,
      items: {
        type: "array" as const,
        minItems: 2,
        maxItems: 2,
        items: { type: "number" as const, minimum: 0, maximum: 1 },
      },
    },
    label: { type: "string" as const },
    confidence: { type: "number" as const, minimum: 0, maximum: 1 },
    azimuth: { type: "number" as const, minimum: 0, maximum: 360 },
    tilt: { type: "number" as const, minimum: 0, maximum: 90 },
  },
};

const POLYGONS_TOOL_SCHEMA = {
  type: "object" as const,
  required: ["polygons"],
  additionalProperties: false,
  properties: {
    polygons: {
      type: "array" as const,
      items: POLYGON_ITEM_SCHEMA,
    },
  },
};

type ToolResultValidator<T> = (
  parsed: unknown,
) => { success: true; data: T } | { success: false; error: string };

async function callClaudeTool<T>(
  client: Anthropic,
  image: ClaudeImageInput,
  systemPrompt: string,
  userPrompt: string,
  toolName: string,
  toolDescription: string,
  inputSchema: Record<string, unknown>,
  validate: ToolResultValidator<T>,
  maxTokens: number,
): Promise<T> {
  const response = await client.messages.create({
    model: CLAUDE_DETECT_MODEL,
    max_tokens: maxTokens,
    system: systemPrompt,
    tools: [
      {
        name: toolName,
        description: toolDescription,
        input_schema: inputSchema as Anthropic.Tool["input_schema"],
      },
    ],
    tool_choice: { type: "tool", name: toolName },
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

  const toolUse = response.content.find(
    (block): block is Anthropic.ToolUseBlock => block.type === "tool_use",
  );
  if (!toolUse) {
    throw new Error("Claude가 tool_use 블록을 반환하지 않았습니다.");
  }
  const result = validate(toolUse.input);
  if (!result.success) {
    throw new Error(`스키마 검증 실패: ${result.error}`);
  }
  return result.data;
}

export async function locateBboxClaude(
  client: Anthropic,
  image: ClaudeImageInput,
): Promise<BboxResponse> {
  return callClaudeTool(
    client,
    image,
    BBOX_SYSTEM_PROMPT,
    BBOX_USER_PROMPT,
    "report_bbox",
    "Report the tight normalized bounding box of the central building.",
    BBOX_TOOL_SCHEMA,
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
    1024,
  );
}

export async function tracePolygonClaude(
  client: Anthropic,
  croppedImage: ClaudeImageInput,
): Promise<DetectResponse> {
  return callClaudeTool(
    client,
    croppedImage,
    ROOF_DETECT_SYSTEM_PROMPT,
    ROOF_DETECT_USER_PROMPT,
    "report_polygons",
    "Report every distinct roof face as its own polygon with azimuth and tilt.",
    POLYGONS_TOOL_SCHEMA,
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
    8192,
  );
}
