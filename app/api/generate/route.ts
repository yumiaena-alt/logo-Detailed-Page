import { NextRequest, NextResponse } from "next/server";
import Replicate from "replicate";

export const maxDuration = 180; // 렌더링에 여유 시간 확보
export const runtime = "nodejs";

// ── 스튜디오 렌더링 프롬프트 ─────────────────────────────────────────────────
const STUDIO_PROMPT = [
  "A professional luxury studio product photograph.",
  "Background: Pure white (#FFFFFF) background.",
  "Lighting/Highlights: Soft box lighting effect, light spreading evenly across the front and top of the product.",
  "Shadows: Natural and soft shadow under the product, creating a slight floating effect without being overly dramatic.",
  "Color Correction: Keep original colors, slightly increase saturation for a vivid and lively look.",
  "Contrast/Brightness: High contrast to bring out details, medium overall brightness.",
  "Reflection: Subtle, blurry reflection on the floor right in front of the product for a luxurious feel.",
  "Noise Reduction & Sharpening: Minimal ISO noise, sharp edges on the product and logo.",
  "Shape Preservation: Maintain the exact shape, proportions, textures, and text of the logo without any distortion.",
].join(" ");

const NEGATIVE_PROMPT =
  "blurry, distorted, deformed, low quality, watermark, text artifacts, " +
  "logo distortion, warped text, stretched, compression artifacts, noise, " +
  "grain, overexposed, underexposed, bad composition, duplicate, ugly, " +
  "tiling, poorly drawn hands, poorly drawn feet, poorly drawn face, mutation";

// ── 모델 정의 ────────────────────────────────────────────────────────────────
// 기본값: SDXL img2img — prompt_strength 0.25로 원본 형태(로고·텍스처)를 75% 보존.
// 환경변수 REPLICATE_RENDER_MODEL=flux 로 Flux Dev img2img로 전환할 수 있습니다.
//
// SDXL 버전을 고정 핀하려면 Replicate 모델 페이지에서 최신 버전 SHA를 복사해
// 아래 SDXL_MODEL 값을 "stability-ai/sdxl:<sha>" 형식으로 교체하세요.
const SDXL_MODEL = "stability-ai/sdxl";
const FLUX_MODEL = "black-forest-labs/flux-dev";

type ModelRef =
  | `${string}/${string}`
  | `${string}/${string}:${string}`;

function buildModelAndInput(modelKey: string, image: string) {
  if (modelKey === "flux") {
    return {
      model: FLUX_MODEL as ModelRef,
      input: {
        image,
        prompt: STUDIO_PROMPT,
        // 0.25 = 원본 이미지 75% 보존, AI 보정 25%만 적용 — 형태 왜곡 최소화
        prompt_strength: 0.25,
        num_inference_steps: 28,
        guidance: 3.5,
        output_format: "png",
        output_quality: 100,
      },
    };
  }

  // SDXL img2img (기본)
  return {
    model: SDXL_MODEL as ModelRef,
    input: {
      image,
      prompt: STUDIO_PROMPT,
      negative_prompt: NEGATIVE_PROMPT,
      // 형태 보존 핵심 파라미터: 0.25 → 원본 75% 유지
      prompt_strength: 0.25,
      num_inference_steps: 40,
      // 높은 guidance_scale + 낮은 prompt_strength = 스타일 일관성 + 형태 보존
      guidance_scale: 8.0,
      // SDXL Refiner: 디테일 샤프닝, high_noise_frac 낮게 = 원본 구조 유지
      refine: "expert_ensemble_refiner",
      high_noise_frac: 0.8,
      apply_watermark: false,
    },
  };
}

// ── POST 핸들러 ──────────────────────────────────────────────────────────────
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

  let body: { image?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "잘못된 요청 형식입니다 (JSON 파싱 실패)." },
      { status: 400 }
    );
  }

  const { image } = body;
  if (!image) {
    return NextResponse.json(
      { error: "병합된 이미지(image base64 dataURL)가 필요합니다." },
      { status: 400 }
    );
  }

  const modelKey = (process.env.REPLICATE_RENDER_MODEL || "sdxl").toLowerCase();
  const { model, input } = buildModelAndInput(modelKey, image);

  const replicate = new Replicate({ auth: token });

  try {
    // 커뮤니티 모델(stability-ai/sdxl 등)은 버전 해시 없이 모델명만으로
    // 실행하면 official-models 엔드포인트로 요청돼 404가 납니다.
    // 버전이 없으면 런타임에 최신 버전을 조회해 "owner/name:version"으로 고정합니다.
    const ref = await resolveVersionedRef(replicate, model);

    const output = await replicate.run(ref, { input });

    const rawUrl = await resolveOutput(output);
    if (!rawUrl) {
      return NextResponse.json(
        { error: "모델이 이미지를 반환하지 않았습니다." },
        { status: 502 }
      );
    }

    // CDN URL → base64 dataURL 변환: 프론트엔드 다운로드 시 CORS 없이 처리
    const dataUrl = await fetchAsDataUrl(rawUrl);
    return NextResponse.json({ output: dataUrl });
  } catch (err) {
    const message =
      err instanceof Error
        ? err.message
        : "AI 렌더링 처리 중 오류가 발생했습니다.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// ── 헬퍼 ─────────────────────────────────────────────────────────────────────

/**
 * "owner/name" 형태(버전 없음)면 최신 버전을 조회해 "owner/name:version"으로 만듭니다.
 * 이미 버전이 포함돼 있으면 그대로 반환합니다.
 * 커뮤니티 모델은 버전 기반 prediction만 지원하므로 이 변환이 필요합니다.
 */
async function resolveVersionedRef(
  replicate: Replicate,
  ref: ModelRef
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
 * Replicate 출력 형태를 단일 이미지 URL 문자열로 정규화합니다.
 * - string: 그대로 반환
 * - string[]: 첫 번째 요소
 * - FileOutput (replicate ≥ 0.30): .url() 메서드 호출
 * - ReadableStream: buffer → base64 dataURL
 */
async function resolveOutput(output: unknown): Promise<string | null> {
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

/**
 * HTTP(S) URL이면 서버에서 fetch해 base64 dataURL로 변환합니다.
 * 이미 dataURL이면 그대로 반환합니다.
 */
async function fetchAsDataUrl(url: string): Promise<string> {
  if (url.startsWith("data:")) return url;
  const res = await fetch(url);
  const ct = res.headers.get("content-type") || "image/png";
  const buf = Buffer.from(await res.arrayBuffer());
  return `data:${ct};base64,${buf.toString("base64")}`;
}
