import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 120;
export const runtime = "nodejs";

/**
 * 3단계: 로고가 합성된 이미지를 받아 최고급 스튜디오 컷으로 재렌더링합니다.
 *
 * 현재는 수신한 merged image를 그대로 반환하는 stub입니다.
 * 3단계 구현 시 이 핸들러에 Replicate(또는 다른 생성형 AI) 호출 로직을 추가합니다.
 *
 * 요청 body (JSON):
 *   { image: string }  — 글자 제거 + 로고 합성이 완료된 PNG base64 dataURL
 *
 * 응답:
 *   { output: string } — 재렌더링된 이미지 URL 또는 dataURL
 */
export async function POST(req: NextRequest) {
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
      { error: "병합된 이미지(image)가 필요합니다." },
      { status: 400 }
    );
  }

  // TODO(3단계): 여기서 Replicate img2img/ControlNet API를 호출해
  // 스튜디오 조명·배경·질감을 적용한 최종 렌더링 이미지를 반환합니다.
  return NextResponse.json({ output: image });
}
