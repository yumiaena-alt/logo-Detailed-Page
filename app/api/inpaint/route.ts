import { NextRequest, NextResponse } from "next/server";
import Replicate from "replicate";

export const maxDuration = 120;
export const runtime = "nodejs";

// Flux Fill Dev: 임의 해상도를 찌그러짐 없이 처리하는 최신 인페인팅 모델.
// SD Inpainting은 512×512 고정 크기로 강제 변환해 세로 이미지가 찌그러지는 문제가 있었음.
const DEFAULT_MODEL = "black-forest-labs/flux-fill-dev";

const MODEL = (
  process.env.REPLICATE_MODEL || DEFAULT_MODEL
) as `${string}/${string}` | `${string}/${string}:${string}`;

// 마스크 영역을 주변 표면으로 자연스럽게 채우도록 유도
const DEFAULT_PROMPT =
  "seamless clean surface matching the surrounding product texture and color, " +
  "no text, no letters, no characters, no watermark, photorealistic, high detail";

export async function POST(req: NextRequest) {
  const token = process.env.REPLICATE_API_TOKEN;
  if (!token) {
    return NextResponse.json(
      {
        error:
          "REPLICATE_API_TOKEN이 설정되지 않았습니다. .env.local에 토큰을 추가하세요.",
      },
      { status: 500 }
    );
  }

  let body: { image?: string; mask?: string; prompt?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "잘못된 요청 형식입니다 (JSON 파싱 실패)." },
      { status: 400 }
    );
  }

  const { image, mask, prompt } = body;
  if (!image || !mask) {
    return NextResponse.json(
      { error: "image와 mask(둘 다 base64 dataURL)가 필요합니다." },
      { status: 400 }
    );
  }

  const replicate = new Replicate({ auth: token });

  try {
    const output = await replicate.run(MODEL, {
      input: {
        image,
        mask,
        prompt: prompt || DEFAULT_PROMPT,
        // Flux Fill은 임의 해상도를 그대로 처리 — 찌그러짐 없음
        num_inference_steps: 28,
        // guidance 값이 높을수록 마스크 영역을 더 강하게 채움 (20~50 권장)
        guidance: 30,
        output_format: "png",
        output_quality: 100,
      },
    });

    const rawUrl = await normalizeOutput(output);
    if (!rawUrl) {
      return NextResponse.json(
        { error: "모델이 이미지를 반환하지 않았습니다." },
        { status: 502 }
      );
    }

    // CDN URL → base64 dataURL 변환 (2단계 canvas taint 방지)
    const dataUrl = await toDataUrl(rawUrl);
    return NextResponse.json({ output: dataUrl });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Inpainting 처리 중 오류가 발생했습니다.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

async function normalizeOutput(output: unknown): Promise<string | null> {
  const first = Array.isArray(output) ? output[0] : output;
  if (first == null) return null;
  if (typeof first === "string") return first;
  if (typeof (first as { url?: () => URL }).url === "function") {
    return (first as { url: () => URL }).url().toString();
  }
  if (first instanceof ReadableStream) {
    const buf = Buffer.from(await new Response(first).arrayBuffer());
    return `data:image/png;base64,${buf.toString("base64")}`;
  }
  return null;
}

async function toDataUrl(url: string): Promise<string> {
  if (url.startsWith("data:")) return url;
  const res = await fetch(url);
  const ct = res.headers.get("content-type") || "image/png";
  const buf = Buffer.from(await res.arrayBuffer());
  return `data:${ct};base64,${buf.toString("base64")}`;
}
