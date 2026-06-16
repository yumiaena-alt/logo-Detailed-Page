# Studio Renderer (MVP)

중국 사입 기성품의 텍스트/로고를 지우고, 우리 브랜드 로고를 얹은 뒤,
생성형 AI로 최고급 스튜디오 컷으로 재렌더링하는 도구.

## 1단계 — 이미지 업로드 & 텍스트 제거 (Inpainting) ✅

- **업로드 & 캔버스 표시**: 제품 사진을 업로드하면 HTML5 Canvas에 표시됩니다.
- **브러시 마스킹**: 마우스/터치로 지우고 싶은 글자 영역을 칠합니다(반투명 빨강 표시).
- **AI 인페인팅**: 칠한 영역을 흑백 마스크로 변환해 Replicate Inpainting API를
  호출, 글자가 사라지고 주변 표면으로 자연스럽게 채워진 이미지를 받습니다.

## 실행 방법

```bash
npm install
cp .env.example .env.local   # REPLICATE_API_TOKEN 입력
npm run dev
```

http://localhost:3000 접속.

## 환경 변수

| 변수 | 설명 |
| --- | --- |
| `REPLICATE_API_TOKEN` | (필수) Replicate API 토큰 |
| `REPLICATE_MODEL` | (선택) 사용할 inpainting 모델. 기본값은 Stable Diffusion Inpainting. Flux 계열로 교체하려면 `black-forest-labs/flux-fill-dev` 등으로 설정 |

## 구조

```
app/
  page.tsx              # 메인 페이지
  layout.tsx
  globals.css
  api/inpaint/route.ts  # Replicate Inpainting 호출 API Route
components/
  InpaintEditor.tsx     # 업로드 + 캔버스 + 브러시 마스킹 + 결과 표시
```

### 마스크 규칙

Replicate inpainting 모델은 **흰색 = 지울 영역**, **검정 = 유지 영역** 규칙을
따릅니다. 프런트엔드에서 브러시로 칠한 빨강 영역을 흰색으로, 나머지를 검정으로
변환해 마스크를 생성합니다.

## 다음 단계 (예정)

- 2단계: 브랜드 로고 합성
- 3단계: 스튜디오 컷 재렌더링
