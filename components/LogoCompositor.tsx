"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface LogoState {
  x: number;        // 캔버스 픽셀 기준 중심 좌표
  y: number;
  scale: number;    // 로고 자연 크기 대비 비율
  rotation: number; // 도(degree)
  opacity: number;  // 0–1
}

interface Props {
  inpaintedUrl: string; // base64 dataURL — 배경으로 쓸 인페인팅 결과
}

// 스켈레톤 로딩에 순차적으로 표시할 단계 메시지
const LOADING_STEPS = [
  "배경 분석 및 화이트 스튜디오 배경 생성 중...",
  "소프트박스 조명 효과 적용 중...",
  "제품 형태 및 로고 텍스처 보존 중...",
  "색상 보정·대비 강화 중...",
  "고해상도 최종 렌더링 중...",
];

export default function LogoCompositor({ inpaintedUrl }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const bgImgRef = useRef<HTMLImageElement | null>(null);
  const logoImgRef = useRef<HTMLImageElement | null>(null);

  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });
  const [hasLogo, setHasLogo] = useState(false);
  const [logoState, setLogoState] = useState<LogoState>({
    x: 0, y: 0, scale: 1, rotation: 0, opacity: 1,
  });
  const [scalePercent, setScalePercent] = useState(30);

  const isDraggingRef = useRef(false);
  const dragOffsetRef = useRef({ dx: 0, dy: 0 });
  const [cursor, setCursor] = useState<"default" | "move" | "grabbing">("default");

  const [aiLoading, setAiLoading] = useState(false);
  const [loadingStep, setLoadingStep] = useState(0);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiResultUrl, setAiResultUrl] = useState<string | null>(null);

  // ── 배경 이미지 로드 ──────────────────────────────────────────────
  useEffect(() => {
    setHasLogo(false);
    logoImgRef.current = null;
    setAiResultUrl(null);
    setAiError(null);

    const img = new Image();
    img.onload = () => {
      bgImgRef.current = img;
      const { naturalWidth: w, naturalHeight: h } = img;
      setCanvasSize({ width: w, height: h });
      setLogoState((s) => ({ ...s, x: w / 2, y: h / 2 }));

      const canvas = canvasRef.current;
      if (canvas) {
        canvas.width = w;
        canvas.height = h;
        canvas.getContext("2d")?.drawImage(img, 0, 0, w, h);
      }
    };
    img.src = inpaintedUrl;
  }, [inpaintedUrl]);

  // ── 캔버스 리드로우 ───────────────────────────────────────────────
  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    const bg = bgImgRef.current;
    if (!canvas || !ctx || !bg || canvasSize.width === 0) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bg, 0, 0, canvas.width, canvas.height);

    const logo = logoImgRef.current;
    if (logo && hasLogo) {
      const w = logo.naturalWidth * logoState.scale;
      const h = logo.naturalHeight * logoState.scale;
      ctx.save();
      ctx.globalAlpha = logoState.opacity;
      ctx.translate(logoState.x, logoState.y);
      ctx.rotate((logoState.rotation * Math.PI) / 180);
      ctx.drawImage(logo, -w / 2, -h / 2, w, h);
      ctx.restore();
    }
  }, [canvasSize, hasLogo, logoState]);

  useEffect(() => { redraw(); }, [redraw]);

  // ── 로고 업로드 ───────────────────────────────────────────────────
  const handleLogoUpload = useCallback(
    (file: File) => {
      if (!file.type.startsWith("image/")) return;
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          logoImgRef.current = img;
          const initScale =
            canvasSize.width > 0
              ? (canvasSize.width * 0.3) / img.naturalWidth
              : 0.3;
          setLogoState((s) => ({ ...s, scale: initScale }));
          setScalePercent(30);
          setHasLogo(true);
        };
        img.src = e.target?.result as string;
      };
      reader.readAsDataURL(file);
    },
    [canvasSize.width]
  );

  // ── 포인터 좌표 변환 (CSS px → 캔버스 px) ────────────────────────
  const toCanvasPoint = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current!;
      const rect = canvas.getBoundingClientRect();
      return {
        x: (e.clientX - rect.left) * (canvas.width / rect.width),
        y: (e.clientY - rect.top) * (canvas.height / rect.height),
      };
    },
    []
  );

  // ── 로고 히트 테스트 (회전 고려) ──────────────────────────────────
  const hitTestLogo = useCallback(
    (px: number, py: number) => {
      const logo = logoImgRef.current;
      if (!logo || !hasLogo) return false;
      const dx = px - logoState.x;
      const dy = py - logoState.y;
      const rad = -(logoState.rotation * Math.PI) / 180;
      const rx = dx * Math.cos(rad) - dy * Math.sin(rad);
      const ry = dx * Math.sin(rad) + dy * Math.cos(rad);
      const hw = (logo.naturalWidth * logoState.scale) / 2;
      const hh = (logo.naturalHeight * logoState.scale) / 2;
      return Math.abs(rx) <= hw && Math.abs(ry) <= hh;
    },
    [hasLogo, logoState]
  );

  // ── 드래그 이벤트 ────────────────────────────────────────────────
  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const p = toCanvasPoint(e);
      if (!hitTestLogo(p.x, p.y)) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      isDraggingRef.current = true;
      setCursor("grabbing");
      dragOffsetRef.current = { dx: logoState.x - p.x, dy: logoState.y - p.y };
    },
    [toCanvasPoint, hitTestLogo, logoState]
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const p = toCanvasPoint(e);
      if (isDraggingRef.current) {
        setLogoState((s) => ({
          ...s,
          x: p.x + dragOffsetRef.current.dx,
          y: p.y + dragOffsetRef.current.dy,
        }));
      } else {
        setCursor(hitTestLogo(p.x, p.y) ? "move" : "default");
      }
    },
    [toCanvasPoint, hitTestLogo]
  );

  const endDrag = useCallback(() => {
    isDraggingRef.current = false;
    setCursor("default");
  }, []);

  // ── 슬라이더: 크기 ────────────────────────────────────────────────
  const handleScalePercent = useCallback(
    (pct: number) => {
      setScalePercent(pct);
      const logo = logoImgRef.current;
      if (!logo || canvasSize.width === 0) return;
      setLogoState((s) => ({
        ...s,
        scale: (canvasSize.width * pct) / 100 / logo.naturalWidth,
      }));
    },
    [canvasSize.width]
  );

  // ── 로딩 단계 순환 (타이머) ───────────────────────────────────────
  useEffect(() => {
    if (!aiLoading) { setLoadingStep(0); return; }
    const id = setInterval(() => {
      setLoadingStep((s) => (s + 1) % LOADING_STEPS.length);
    }, 2200);
    return () => clearInterval(id);
  }, [aiLoading]);

  // ── AI 스튜디오 렌더링 요청 ───────────────────────────────────────
  const handleGenerate = useCallback(async () => {
    const canvas = canvasRef.current;
    if (!canvas || canvasSize.width === 0) return;
    const merged = canvas.toDataURL("image/png");

    setAiError(null);
    setAiResultUrl(null);
    setAiLoading(true);
    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: merged }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "AI 렌더링 요청에 실패했습니다.");
      setAiResultUrl(data.output as string);
    } catch (err) {
      setAiError(err instanceof Error ? err.message : "알 수 없는 오류");
    } finally {
      setAiLoading(false);
    }
  }, [canvasSize]);

  // ── 다운로드 ─────────────────────────────────────────────────────
  const handleDownload = useCallback(() => {
    if (!aiResultUrl) return;
    const a = document.createElement("a");
    a.href = aiResultUrl;
    a.download = "qaja_premium_studio.png";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }, [aiResultUrl]);

  const canGenerate = canvasSize.width > 0;

  return (
    <div className="mt-10 flex flex-col gap-6">
      {/* ── 2단계 헤더 ─────────────────────────────────────── */}
      <div className="flex items-center gap-3">
        <div className="h-px flex-1 bg-neutral-800" />
        <span className="rounded-full border border-violet-700 bg-violet-950/50 px-3 py-1 text-xs font-semibold tracking-wider text-violet-300">
          2단계 · 로고 합성
        </span>
        <div className="h-px flex-1 bg-neutral-800" />
      </div>

      {/* ── 툴바 ──────────────────────────────────────────── */}
      <div className="rounded-xl border border-neutral-800 bg-neutral-900/60 p-4">
        <div className="flex flex-wrap items-start gap-6">
          {/* 로고 업로드 */}
          <div className="flex flex-col gap-1">
            <span className="text-xs text-neutral-400">브랜드 로고 (PNG)</span>
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-violet-500">
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleLogoUpload(file);
                  e.target.value = "";
                }}
              />
              로고 업로드
            </label>
          </div>

          {/* 슬라이더 3종 */}
          <div className="flex flex-1 flex-wrap gap-x-8 gap-y-4">
            <div className="flex min-w-[180px] flex-1 flex-col gap-1">
              <div className="flex justify-between text-xs text-neutral-400">
                <span>크기</span>
                <span className="text-neutral-200">{scalePercent}%</span>
              </div>
              <input
                type="range" min={5} max={120} value={scalePercent}
                onChange={(e) => handleScalePercent(Number(e.target.value))}
                disabled={!hasLogo}
                className="w-full accent-violet-500 disabled:opacity-40"
              />
            </div>

            <div className="flex min-w-[180px] flex-1 flex-col gap-1">
              <div className="flex justify-between text-xs text-neutral-400">
                <span>회전</span>
                <span className="text-neutral-200">{logoState.rotation}°</span>
              </div>
              <input
                type="range" min={-180} max={180} value={logoState.rotation}
                onChange={(e) =>
                  setLogoState((s) => ({ ...s, rotation: Number(e.target.value) }))
                }
                disabled={!hasLogo}
                className="w-full accent-violet-500 disabled:opacity-40"
              />
            </div>

            <div className="flex min-w-[180px] flex-1 flex-col gap-1">
              <div className="flex justify-between text-xs text-neutral-400">
                <span>투명도</span>
                <span className="text-neutral-200">
                  {Math.round(logoState.opacity * 100)}%
                </span>
              </div>
              <input
                type="range" min={0} max={100}
                value={Math.round(logoState.opacity * 100)}
                onChange={(e) =>
                  setLogoState((s) => ({ ...s, opacity: Number(e.target.value) / 100 }))
                }
                disabled={!hasLogo}
                className="w-full accent-violet-500 disabled:opacity-40"
              />
            </div>
          </div>
        </div>
      </div>

      {/* ── 2단계 캔버스 + 미리보기 ───────────────────────── */}
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold text-neutral-300">
            로고 합성 편집
            {hasLogo && (
              <span className="ml-2 text-xs font-normal text-neutral-500">
                로고를 드래그해 위치 조정
              </span>
            )}
          </h2>
          <div className="flex min-h-[320px] items-center justify-center rounded-xl border border-neutral-800 bg-neutral-900/40 p-4">
            <canvas
              ref={canvasRef}
              style={{ cursor, maxWidth: "100%", height: "auto", display: "block", borderRadius: "0.5rem" }}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={endDrag}
              onPointerLeave={endDrag}
            />
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold text-neutral-300">합성 미리보기</h2>
          <div className="flex min-h-[320px] items-center justify-center rounded-xl border border-neutral-800 bg-neutral-900/40 p-4 text-center text-sm text-neutral-500">
            {hasLogo
              ? "로고 위치·크기·회전·투명도를 조정하고 아래 보정 버튼을 누르세요."
              : "로고를 업로드하면 편집 캔버스에 표시됩니다."}
          </div>
        </div>
      </div>

      {/* ── 3단계 헤더 ─────────────────────────────────────── */}
      <div className="flex items-center gap-3 pt-2">
        <div className="h-px flex-1 bg-neutral-800" />
        <span className="rounded-full border border-amber-700 bg-amber-950/50 px-3 py-1 text-xs font-semibold tracking-wider text-amber-300">
          3단계 · AI 스튜디오 렌더링
        </span>
        <div className="h-px flex-1 bg-neutral-800" />
      </div>

      {/* ── 3단계 설명 + 버튼 ─────────────────────────────── */}
      <div className="rounded-xl border border-amber-900/40 bg-amber-950/20 p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            <p className="text-sm font-semibold text-amber-200">
              AI 스튜디오 보정 엔진 (SDXL img2img)
            </p>
            <p className="max-w-lg text-xs leading-relaxed text-neutral-400">
              현재 캔버스 상태(글자 제거 + 로고 합성)를 하나의 이미지로 병합한 뒤
              Replicate SDXL로 전달합니다.{" "}
              <span className="text-amber-300/80">prompt_strength 0.25</span>로 고정해
              원본 형태·로고 글씨체를 75% 이상 보존하면서 스튜디오 조명·배경·반사를
              적용합니다.
            </p>
          </div>
          <button
            onClick={handleGenerate}
            disabled={!canGenerate || aiLoading}
            className="shrink-0 rounded-lg bg-amber-500 px-6 py-3 text-sm font-bold text-neutral-950 shadow-lg shadow-amber-900/30 transition hover:bg-amber-400 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {aiLoading ? "보정 중…" : "✦ AI 스튜디오 보정 시작"}
          </button>
        </div>
      </div>

      {aiError && (
        <div className="rounded-lg border border-red-900 bg-red-950/60 px-4 py-3 text-sm text-red-300">
          {aiError}
        </div>
      )}

      {/* ── 결과 패널 ─────────────────────────────────────── */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* 로딩 스켈레톤 / 결과 이미지 */}
        <div className="flex flex-col gap-2 lg:col-span-2">
          <h2 className="text-sm font-semibold text-neutral-300">
            AI 스튜디오 렌더링 결과
          </h2>

          {aiLoading ? (
            <SkeletonLoader currentStep={loadingStep} />
          ) : aiResultUrl ? (
            <ResultPanel resultUrl={aiResultUrl} onDownload={handleDownload} />
          ) : (
            <div className="flex min-h-[240px] items-center justify-center rounded-xl border border-neutral-800 bg-neutral-900/40 p-8 text-center">
              <div>
                <p className="text-2xl text-neutral-700">✦</p>
                <p className="mt-2 text-sm text-neutral-500">
                  보정 버튼을 누르면 AI가 생성한 고해상도 스튜디오 컷이 여기에 표시됩니다.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── 스켈레톤 로딩 컴포넌트 ────────────────────────────────────────────────────
function SkeletonLoader({ currentStep }: { currentStep: number }) {
  return (
    <div className="rounded-xl border border-amber-900/30 bg-neutral-900/60 p-6">
      {/* 상단 상태 표시 */}
      <div className="mb-5 flex items-center gap-3">
        <span className="relative flex h-3 w-3">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-75" />
          <span className="relative inline-flex h-3 w-3 rounded-full bg-amber-500" />
        </span>
        <p className="text-sm font-semibold text-amber-300">
          AI 전문가가 보정 중입니다...
        </p>
      </div>

      {/* 메인 이미지 스켈레톤 */}
      <div className="relative mb-5 overflow-hidden rounded-xl bg-neutral-800" style={{ aspectRatio: "4/3" }}>
        {/* 빛나는 스캔 라인 애니메이션 */}
        <div className="absolute inset-0 -translate-x-full animate-[shimmer_2s_infinite] bg-gradient-to-r from-transparent via-neutral-600/30 to-transparent" />
        {/* 스튜디오 조명 느낌의 중앙 밝은 영역 */}
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="h-32 w-32 animate-pulse rounded-full bg-amber-500/5 blur-3xl" />
        </div>
        {/* 단계 오버레이 */}
        <div className="absolute bottom-4 left-4 right-4">
          <div className="rounded-lg bg-black/60 px-4 py-3 backdrop-blur-sm">
            <p className="text-center text-xs text-amber-200/80 transition-all duration-500">
              {LOADING_STEPS[currentStep]}
            </p>
          </div>
        </div>
      </div>

      {/* 진행 단계 목록 */}
      <div className="space-y-2">
        {LOADING_STEPS.map((step, i) => (
          <div key={step} className="flex items-center gap-3">
            <div
              className={`h-1.5 w-1.5 shrink-0 rounded-full transition-colors duration-300 ${
                i < currentStep
                  ? "bg-amber-400"
                  : i === currentStep
                    ? "animate-pulse bg-amber-400"
                    : "bg-neutral-700"
              }`}
            />
            <span
              className={`text-xs transition-colors duration-300 ${
                i <= currentStep ? "text-neutral-300" : "text-neutral-600"
              }`}
            >
              {step}
            </span>
            {i < currentStep && (
              <span className="ml-auto text-xs text-amber-500">✓</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── 결과 패널 컴포넌트 ────────────────────────────────────────────────────────
function ResultPanel({
  resultUrl,
  onDownload,
}: {
  resultUrl: string;
  onDownload: () => void;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-amber-800/30 bg-neutral-900/40">
      {/* 성공 배지 */}
      <div className="flex items-center gap-2 border-b border-neutral-800 px-5 py-3">
        <span className="text-amber-400">✦</span>
        <span className="text-sm font-semibold text-neutral-200">
          AI 스튜디오 컷 생성 완료
        </span>
        <span className="ml-auto rounded-full bg-emerald-900/50 px-2 py-0.5 text-xs text-emerald-400">
          고해상도
        </span>
      </div>

      {/* 결과 이미지 */}
      <div className="flex items-center justify-center bg-neutral-950/50 p-6">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={resultUrl}
          alt="AI 스튜디오 렌더링 결과"
          className="max-h-[640px] w-auto rounded-lg shadow-2xl shadow-black/60"
        />
      </div>

      {/* 다운로드 버튼 */}
      <div className="flex items-center justify-center border-t border-neutral-800 px-5 py-4">
        <button
          onClick={onDownload}
          className="inline-flex items-center gap-2 rounded-lg bg-neutral-100 px-6 py-3 text-sm font-bold text-neutral-950 shadow-md transition hover:bg-white active:scale-95"
        >
          <DownloadIcon />
          고해상도 스튜디오 컷 다운로드
          <span className="rounded bg-neutral-300 px-1.5 py-0.5 text-xs font-normal text-neutral-700">
            qaja_premium_studio.png
          </span>
        </button>
      </div>
    </div>
  );
}

function DownloadIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}
