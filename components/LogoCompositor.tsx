"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface LogoState {
  x: number;          // 캔버스 픽셀 기준 중심 좌표
  y: number;
  scale: number;      // 로고 자연 크기 대비 비율 (1.0 = 원본 크기)
  rotation: number;   // 도(degree)
  opacity: number;    // 0–1
}

interface Props {
  inpaintedUrl: string; // base64 dataURL — 배경으로 쓸 인페인팅 결과
}

export default function LogoCompositor({ inpaintedUrl }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const bgImgRef = useRef<HTMLImageElement | null>(null);
  const logoImgRef = useRef<HTMLImageElement | null>(null);

  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });
  const [hasLogo, setHasLogo] = useState(false);
  const [logoState, setLogoState] = useState<LogoState>({
    x: 0, y: 0, scale: 1, rotation: 0, opacity: 1,
  });

  // 슬라이더 UI용 정규화 값 (scale → 퍼센트)
  const [scalePercent, setScalePercent] = useState(30);

  const isDraggingRef = useRef(false);
  const dragOffsetRef = useRef({ dx: 0, dy: 0 });
  const [cursor, setCursor] = useState<"default" | "move" | "grabbing">("default");

  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiResultUrl, setAiResultUrl] = useState<string | null>(null);

  // ── 배경 이미지 로드 ──────────────────────────────────────────────
  useEffect(() => {
    setHasLogo(false);
    logoImgRef.current = null;
    setAiResultUrl(null);
    setAiError(null);

    const img = new Image();
    // base64 dataURL은 동일 출처이므로 crossOrigin 불필요
    img.onload = () => {
      bgImgRef.current = img;
      const w = img.naturalWidth;
      const h = img.naturalHeight;
      setCanvasSize({ width: w, height: h });
      setLogoState((s) => ({ ...s, x: w / 2, y: h / 2 }));

      const canvas = canvasRef.current;
      if (canvas) {
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        ctx?.drawImage(img, 0, 0, w, h);
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

  useEffect(() => {
    redraw();
  }, [redraw]);

  // ── 로고 업로드 ───────────────────────────────────────────────────
  const handleLogoUpload = useCallback(
    (file: File) => {
      if (!file.type.startsWith("image/")) return;
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          logoImgRef.current = img;
          // 로고 초기 크기: 캔버스 너비의 30% 수준
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
      dragOffsetRef.current = {
        dx: logoState.x - p.x,
        dy: logoState.y - p.y,
      };
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

  // ── 슬라이더 핸들러 ──────────────────────────────────────────────
  const handleScalePercent = useCallback(
    (pct: number) => {
      setScalePercent(pct);
      const logo = logoImgRef.current;
      if (!logo || canvasSize.width === 0) return;
      // pct = 로고가 캔버스 너비에서 차지할 비율(%)
      const scale = (canvasSize.width * pct) / 100 / logo.naturalWidth;
      setLogoState((s) => ({ ...s, scale }));
    },
    [canvasSize.width]
  );

  // ── 병합 이미지 빌드 (canvas.toDataURL) ───────────────────────────
  const buildMergedDataUrl = useCallback((): string | null => {
    const canvas = canvasRef.current;
    if (!canvas || canvasSize.width === 0) return null;
    return canvas.toDataURL("image/png");
  }, [canvasSize]);

  // ── AI 보정 요청 ──────────────────────────────────────────────────
  const handleAiRequest = useCallback(async () => {
    const merged = buildMergedDataUrl();
    if (!merged) return;
    setAiError(null);
    setAiResultUrl(null);
    setAiLoading(true);
    try {
      const res = await fetch("/api/render", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: merged }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "AI 보정 요청에 실패했습니다.");
      setAiResultUrl(data.output as string);
    } catch (err) {
      setAiError(err instanceof Error ? err.message : "알 수 없는 오류");
    } finally {
      setAiLoading(false);
    }
  }, [buildMergedDataUrl]);

  const disabled = !hasLogo;

  return (
    <div className="mt-10 flex flex-col gap-6">
      {/* 섹션 헤더 */}
      <div className="flex items-center gap-3">
        <div className="h-px flex-1 bg-neutral-800" />
        <span className="rounded-full border border-violet-700 bg-violet-950/50 px-3 py-1 text-xs font-semibold tracking-wider text-violet-300">
          2단계 · 로고 합성
        </span>
        <div className="h-px flex-1 bg-neutral-800" />
      </div>

      {/* 툴바 */}
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
            {/* 크기 */}
            <div className="flex min-w-[180px] flex-1 flex-col gap-1">
              <div className="flex justify-between text-xs text-neutral-400">
                <span>크기</span>
                <span className="text-neutral-200">{scalePercent}%</span>
              </div>
              <input
                type="range"
                min={5}
                max={120}
                value={scalePercent}
                onChange={(e) => handleScalePercent(Number(e.target.value))}
                disabled={disabled}
                className="w-full accent-violet-500 disabled:opacity-40"
              />
            </div>

            {/* 회전 */}
            <div className="flex min-w-[180px] flex-1 flex-col gap-1">
              <div className="flex justify-between text-xs text-neutral-400">
                <span>회전</span>
                <span className="text-neutral-200">{logoState.rotation}°</span>
              </div>
              <input
                type="range"
                min={-180}
                max={180}
                value={logoState.rotation}
                onChange={(e) =>
                  setLogoState((s) => ({
                    ...s,
                    rotation: Number(e.target.value),
                  }))
                }
                disabled={disabled}
                className="w-full accent-violet-500 disabled:opacity-40"
              />
            </div>

            {/* 투명도 */}
            <div className="flex min-w-[180px] flex-1 flex-col gap-1">
              <div className="flex justify-between text-xs text-neutral-400">
                <span>투명도</span>
                <span className="text-neutral-200">
                  {Math.round(logoState.opacity * 100)}%
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={100}
                value={Math.round(logoState.opacity * 100)}
                onChange={(e) =>
                  setLogoState((s) => ({
                    ...s,
                    opacity: Number(e.target.value) / 100,
                  }))
                }
                disabled={disabled}
                className="w-full accent-violet-500 disabled:opacity-40"
              />
            </div>
          </div>

          {/* AI 보정 요청 버튼 */}
          <div className="flex flex-col justify-end gap-1">
            <span className="text-xs text-transparent">.</span>
            <button
              onClick={handleAiRequest}
              disabled={disabled || aiLoading}
              className="rounded-lg bg-amber-500 px-5 py-2 text-sm font-semibold text-neutral-950 transition hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {aiLoading ? "보정 중…" : "✦ AI 보정 요청"}
            </button>
          </div>
        </div>
      </div>

      {aiError && (
        <div className="rounded-lg border border-red-900 bg-red-950/60 px-4 py-3 text-sm text-red-300">
          {aiError}
        </div>
      )}

      {/* 캔버스 + 결과 */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* 합성 캔버스 */}
        <div className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold text-neutral-300">
            로고 합성 편집
            {hasLogo && (
              <span className="ml-2 text-xs font-normal text-neutral-500">
                로고를 드래그해 위치를 조정하세요
              </span>
            )}
          </h2>
          <div className="flex min-h-[320px] items-center justify-center rounded-xl border border-neutral-800 bg-neutral-900/40 p-4">
            <canvas
              ref={canvasRef}
              style={{
                cursor,
                maxWidth: "100%",
                height: "auto",
                display: "block",
                borderRadius: "0.5rem",
              }}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={endDrag}
              onPointerLeave={endDrag}
            />
          </div>
        </div>

        {/* AI 보정 결과 */}
        <div className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold text-neutral-300">
            AI 보정 결과 <span className="text-xs font-normal text-neutral-500">(3단계 연결 예정)</span>
          </h2>
          <div className="flex min-h-[320px] items-center justify-center rounded-xl border border-neutral-800 bg-neutral-900/40 p-4">
            {aiLoading ? (
              <div className="flex flex-col items-center gap-3 text-sm text-neutral-400">
                <span className="animate-pulse text-2xl">✦</span>
                AI가 스튜디오 컷으로 재렌더링하는 중…
              </div>
            ) : aiResultUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={aiResultUrl}
                alt="AI 보정 결과"
                className="max-h-[600px] w-auto rounded-lg"
              />
            ) : (
              <div className="text-center">
                <p className="text-sm text-neutral-500">
                  로고를 배치한 뒤 <span className="text-amber-400">✦ AI 보정 요청</span>을 누르면
                </p>
                <p className="mt-1 text-sm text-neutral-500">
                  스튜디오 컷 재렌더링 결과가 여기에 표시됩니다.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
