import { NextRequest, NextResponse } from "next/server";
import Replicate from "replicate";

// Inpainting은 시간이 걸릴 수 있으므로 실행 시간을 넉넉히 둡니다.
export const maxDuration = 120;
// 큰 base64 이미지를 다루므로 Node.js 런타임 사용
export const runtime = "nodejs";

/**
 * 사용할 Replicate 모델.
 *
 * 기본값은 Stable Diffusion Inpainting 입니다. 환경변수 REPLICATE_MODEL 로
 * Flux 계열 등 다른 inpainting 모델로 교체할 수 있습니다.
 *
 * 예) Flux: "black-forest-labs/flux-fill-dev"
 */
const DEFAULT_MODEL =
  "stability-ai/stable-diffusion-inpainting:95b7223104132402a9ae91cc677285bc5eb997834bd2349fa486f53910fd68b3";

const MODEL = (process.env.REPLICATE_MODEL || DEFAULT_MODEL) as `${string}/${string}` | `${string}/${string}:${string}`;

// 글자가 사라지고 주변 제품 표면으로 자연스럽게 채워지도록 유도하는 프롬프트
const DEFAULT_PROMPT =
  "clean product surface, seamless texture, no text, no letters, no logo, photorealistic, high detail";
const DEFAULT_NEGATIVE_PROMPT =
  "text, letters, characters, watermark, logo, words, writing, blurry, distorted, artifacts";

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
    // Replicate는 dataURL(base64)을 입력으로 그대로 받습니다.
    // 마스크는 흰색=지울 영역, 검정=유지 영역 규칙을 따릅니다.
    const output = await replicate.run(MODEL, {
      input: {
        image,
        mask,
        prompt: prompt || DEFAULT_PROMPT,
        negative_prompt: DEFAULT_NEGATIVE_PROMPT,
        num_inference_steps: 30,
        guidance_scale: 7.5,
      },
    });

    // 모델에 따라 출력은 문자열 URL, 문자열 배열, 또는 스트림 객체일 수 있습니다.
    const rawUrl = await normalizeOutput(output);
    if (!rawUrl) {
      return NextResponse.json(
        { error: "모델이 이미지를 반환하지 않았습니다." },
        { status: 502 }
      );
    }

    // CDN URL이면 서버에서 fetch해 base64 dataURL로 변환합니다.
    // 클라이언트 canvas가 CORS 문제 없이 toDataURL()을 호출할 수 있도록
    // 2단계 로고 합성에서 항상 data URL을 받아야 합니다.
    const dataUrl = await toDataUrl(rawUrl);
    return NextResponse.json({ output: dataUrl });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Inpainting 처리 중 오류가 발생했습니다.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * Replicate 출력 형태를 단일 이미지 URL 문자열로 정규화합니다.
 * - string: 그대로 반환
 * - string[]: 첫 번째 요소 반환
 * - FileOutput (replicate ≥ 0.30): .url() 호출
 * - ReadableStream: base64 dataURL로 변환
 */
async function normalizeOutput(output: unknown): Promise<string | null> {
  const first = Array.isArray(output) ? output[0] : output;
  if (first == null) return null;

  if (typeof first === "string") return first;

  if (typeof (first as { url?: () => URL }).url === "function") {
    return (first as { url: () => URL }).url().toString();
  }

  if (first instanceof ReadableStream) {
    const res = new Response(first);
    const buffer = Buffer.from(await res.arrayBuffer());
    return `data:image/png;base64,${buffer.toString("base64")}`;
  }

  return null;
}

/**
 * HTTP(S) URL이면 서버에서 fetch해 base64 dataURL로 변환합니다.
 * 이미 dataURL이면 그대로 반환합니다.
 * 클라이언트 캔버스의 toDataURL() 호출 시 CORS taint를 방지하기 위함입니다.
 */
async function toDataUrl(url: string): Promise<string> {
  if (url.startsWith("data:")) return url;
  const res = await fetch(url);
  const ct = res.headers.get("content-type") || "image/png";
  const buffer = Buffer.from(await res.arrayBuffer());
  return `data:${ct};base64,${buffer.toString("base64")}`;
}
