import InpaintEditor from "@/components/InpaintEditor";

export default function Home() {
  return (
    <main className="min-h-screen w-full bg-neutral-950 text-neutral-100">
      <div className="mx-auto max-w-6xl px-4 py-8">
        <header className="mb-8 text-center">
          <p className="mb-2 text-xs font-medium uppercase tracking-[0.25em] text-neutral-500">
            Studio Renderer · MVP
          </p>
          <h1 className="text-2xl font-bold sm:text-3xl">
            1단계 · 이미지 업로드 &amp; 텍스트 제거 (Inpainting)
          </h1>
          <p className="mx-auto mt-3 max-w-2xl text-sm leading-relaxed text-neutral-400">
            원본 제품 사진을 업로드한 뒤, 지우고 싶은 중국어·불필요한 글자 위를
            브러시로 문지르세요. AI가 글자를 흔적 없이 지우고 주변 제품 표면으로
            자연스럽게 채워 줍니다.
          </p>
        </header>

        <InpaintEditor />
      </div>
    </main>
  );
}
