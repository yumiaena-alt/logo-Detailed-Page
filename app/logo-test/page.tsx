import LogoTestHarness from "@/components/LogoTestHarness";

export default function LogoTestPage() {
  return (
    <main className="min-h-screen w-full bg-neutral-950 text-neutral-100">
      <div className="mx-auto max-w-6xl px-4 py-8">
        <header className="mb-8 text-center">
          <p className="mb-2 text-xs font-medium uppercase tracking-[0.25em] text-neutral-500">
            Studio Renderer · 로고 합성 테스트
          </p>
          <h1 className="text-2xl font-bold sm:text-3xl">로고 합성 테스트 페이지</h1>
          <p className="mx-auto mt-3 max-w-2xl text-sm leading-relaxed text-neutral-400">
            인페인팅(1단계)을 건너뛰고, 원하는 배경 이미지에 브랜드 로고를 원하는
            위치·크기·회전·투명도로 합성하는 기능을 단독으로 테스트합니다.
          </p>
        </header>

        <LogoTestHarness />
      </div>
    </main>
  );
}
