import { NextRequest, NextResponse } from "next/server";
import Replicate from "replicate";
import sharp from "sharp";

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
    // remove-object(LaMa) 모델은 RGB 이미지(3채널) + 마스크(1채널) = 4채널 입력을 기대한다.
    // 클라이언트가 알파 채널이 포함된 RGBA(PNG, 4채널) 이미지를 보내면 모델 내부에서
    // 4 + 1 = 5채널이 되어 "expected input to have 4 channels, but got 5 channels" 오류가 난다.
    // 클라이언트 상태(캐시된 dataURL 등)와 무관하게 항상 안전하도록 서버에서 강제로
    // 알파 채널을 제거(흰색 배경으로 평탄화)해 RGB로 변환한다. 마스크도 단일 채널로 정규화한다.
    const safeImage = await flattenToRgb(image);
    const safeMask = await maskToGray(mask);

    // 커뮤니티 모델은 모델명만으로 실행할 수 없고 버전 해시가 필요합니다.
    // REPLICATE_MODEL에 버전이 없으면 런타임에 최신 버전을 조회해 채웁니다.
    const ref = await resolveVersionedRef(replicate, MODEL);

    // LaMa(remove-object): image + mask 만 필요. 마스크 흰색=제거 영역.
    const output = await replicate.run(ref, {
      input: { image: safeImage, mask: safeMask },
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

/**
 * "owner/name" 형태(버전 없음)면 최신 버전을 조회해 "owner/name:version"으로 만듭니다.
 * 이미 버전이 포함돼 있으면 그대로 반환합니다.
 * 커뮤니티 모델은 버전 기반 prediction만 지원하므로 이 변환이 필요합니다.
 */
async function resolveVersionedRef(
  replicate: Replicate,
  ref: string
): Promise<`${string}/${string}:${string}`> {
  if (ref.includes(":")) return ref as `${string}/${string}:${string}`;

  const [owner, name] = ref.split("/");
  const model = await replicate.models.get(owner, name);
  const version = model.latest_version?.id;
  if (!version) {
    throw new Error(`모델 ${ref}의 최신 버전을 찾을 수 없습니다.`);
  }
  return `${owner}/${name}:${version}`;
}

/**
 * base64 dataURL을 디코드해 알파 채널을 제거(흰색 배경으로 평탄화)한 RGB JPEG dataURL로 변환한다.
 * remove-object(LaMa) 모델이 기대하는 3채널 RGB 입력을 보장해 채널 수 불일치 오류를 막는다.
 */
async function flattenToRgb(dataUrl: string): Promise<string> {
  const buf = dataUrlToBuffer(dataUrl);
  if (!buf) return dataUrl; // dataURL이 아니면(예: 외부 URL) 그대로 둔다.
  const out = await sharp(buf)
    .flatten({ background: { r: 255, g: 255, b: 255 } }) // 알파 → 흰색 배경으로 합성
    .removeAlpha()
    .jpeg({ quality: 95 })
    .toBuffer();
  return `data:image/jpeg;base64,${out.toString("base64")}`;
}

/**
 * 마스크 dataURL을 단일 채널(그레이스케일) PNG로 정규화한다.
 * 흰색=제거 영역 규칙은 유지된다.
 */
async function maskToGray(dataUrl: string): Promise<string> {
  const buf = dataUrlToBuffer(dataUrl);
  if (!buf) return dataUrl;
  const out = await sharp(buf)
    .flatten({ background: { r: 0, g: 0, b: 0 } }) // 마스크 배경은 검정(유지 영역)
    .removeAlpha()
    .grayscale()
    .png()
    .toBuffer();
  return `data:image/png;base64,${out.toString("base64")}`;
}

function dataUrlToBuffer(dataUrl: string): Buffer | null {
  const match = /^data:[^;]+;base64,(.+)$/s.exec(dataUrl);
  if (!match) return null;
  return Buffer.from(match[1], "base64");
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
