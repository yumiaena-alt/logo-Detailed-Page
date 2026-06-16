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
            브랜드 스튜디오 렌더러
          </h1>
          <p className="mx-auto mt-3 max-w-2xl text-sm leading-relaxed text-neutral-400">
            제품 사진의 중국어·불필요한 글자를 AI로 지우고(1단계), 브랜드 로고를
            자유롭게 얹어(2단계) 최고급 스튜디오 컷으로 재렌더링하는 MVP 툴입니다.
          </p>
        </header>

        <InpaintEditor />
      </div>
    </main>
  );
}
