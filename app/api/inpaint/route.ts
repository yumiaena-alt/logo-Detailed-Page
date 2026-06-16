import { NextRequest, NextResponse } from "next/server";
import Replicate from "replicate";

export const maxDuration = 120;
export const runtime = "nodejs";

/**
 * 텍스트/오브젝트 제거에는 LaMa 기반 모델을 사용합니다.
 *
 * SDXL·Flux 같은 "생성형" 인페인팅은 이미지 전체를 다시 그리고 출력 해상도를
 * 표준 크기(예: 512×512, 1MP 버킷)로 강제 변환해 원본 비율이 찌그러지는 문제가
 * 있었습니다.
 *
 * LaMa(Resolution-robust Large Mask Inpainting)는:
 *  - 마스크로 칠한 영역만 주변 픽셀로 자연스럽게 채우고
 *  - 나머지 영역과 원본 해상도·비율을 그대로 보존합니다.
 * → "이미지는 유지하고 브러시 부분만 깨끗이 제거" 요구에 정확히 부합합니다.
 *
 * 모델명만 지정하면 Replicate SDK가 최신 버전을 자동으로 실행합니다.
 * 특정 버전으로 고정하려면 REPLICATE_MODEL="zylim0702/remove-object:<해시>" 형태로 설정하세요.
 */
const DEFAULT_MODEL = "zylim0702/remove-object";

const MODEL = (
  process.env.REPLICATE_MODEL || DEFAULT_MODEL
) as `${string}/${string}` | `${string}/${string}:${string}`;

export async function POST(req: NextRequest) {
  const token = process.env.REPLICATE_API_TOKEN;
  if (!token) {
    return NextResponse.json(
      {
        error:
          "REPLICATE_API_TOKEN이 설정되지 않았습니다. .env.local(또는 Vercel 환경변수)에 토큰을 추가하세요.",
      },
      { status: 500 }
    );
  }

  let body: { image?: string; mask?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "잘못된 요청 형식입니다 (JSON 파싱 실패)." },
      { status: 400 }
    );
  }

  const { image, mask } = body;
  if (!image || !mask) {
    return NextResponse.json(
      { error: "image와 mask(둘 다 base64 dataURL)가 필요합니다." },
      { status: 400 }
    );
  }

  const replicate = new Replicate({ auth: token });

  try {
    // LaMa(remove-object): image + mask 만 필요. 마스크 흰색=제거 영역.
    const output = await replicate.run(MODEL, {
      input: { image, mask },
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
