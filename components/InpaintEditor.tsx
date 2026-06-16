"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import LogoCompositor from "@/components/LogoCompositor";

// 업로드 이미지를 캔버스에 띄울 때 사용할 최대 한 변 길이(px).
// 너무 큰 원본은 비율을 유지하며 축소해 처리/전송 비용을 줄입니다.
const MAX_DIMENSION = 1024;

type Point = { x: number; y: number };

export default function InpaintEditor() {
  // 원본 이미지를 그리는 하단 캔버스
  const imageCanvasRef = useRef<HTMLCanvasElement>(null);
  // 사용자가 브러시로 마스크를 칠하는 상단(투명) 캔버스
  const drawCanvasRef = useRef<HTMLCanvasElement>(null);

  const isDrawingRef = useRef(false);
  const lastPointRef = useRef<Point | null>(null);

  const [hasImage, setHasImage] = useState(false);
  const [brushSize, setBrushSize] = useState(40);
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });
  // 드래그 앤 드롭 진행 중 시각 피드백
  const [isDragOver, setIsDragOver] = useState(false);
  // 브러시 미리보기: CSS 픽셀 기준 위치·반지름 (null = 캔버스 밖)
  const [brushPreview, setBrushPreview] = useState<{ x: number; y: number; r: number } | null>(null);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultUrl, setResultUrl] = useState<string | null>(null);

  // 원본 이미지의 dataURL(PNG)을 보관 — API 전송 시 사용
  const sourceDataUrlRef = useRef<string | null>(null);

  // ---------- 1) 이미지 업로드 → 캔버스에 표시 ----------
  const handleUpload = useCallback((file: File) => {
    if (!file.type.startsWith("image/")) {
      setError("이미지 파일만 업로드할 수 있습니다.");
      return;
    }
    setError(null);
    setResultUrl(null);

    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        // 비율을 유지하며 최대 한 변을 MAX_DIMENSION으로 제한
        let { width, height } = img;
        const scale = Math.min(1, MAX_DIMENSION / Math.max(width, height));
        width = Math.round(width * scale);
        height = Math.round(height * scale);

        const imageCanvas = imageCanvasRef.current;
        const drawCanvas = drawCanvasRef.current;
        if (!imageCanvas || !drawCanvas) return;

        imageCanvas.width = width;
        imageCanvas.height = height;
        drawCanvas.width = width;
        drawCanvas.height = height;
        setCanvasSize({ width, height });

        const ctx = imageCanvas.getContext("2d");
        if (!ctx) return;
        // 투명 영역이 있는 PNG도 검정이 아닌 흰색으로 평탄화되도록 배경을 먼저 채운다.
        ctx.clearRect(0, 0, width, height);
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);

        // 마스크 캔버스 초기화
        const drawCtx = drawCanvas.getContext("2d");
        drawCtx?.clearRect(0, 0, width, height);

        // 원본을 RGB(JPEG) dataURL로 저장한다.
        // PNG(toDataURL("image/png"))는 항상 알파 채널을 포함한 RGBA(4채널)로 인코딩되어,
        // remove-object(LaMa) 모델이 기대하는 RGB(3채널) + 마스크(1채널) = 4채널 입력과 어긋나
        // "expected input to have 4 channels, but got 5 channels" 오류를 유발한다.
        // JPEG는 알파 채널이 없어 항상 3채널 RGB로 인코딩되므로 이 문제를 방지한다.
        sourceDataUrlRef.current = imageCanvas.toDataURL("image/jpeg", 0.95);
        setHasImage(true);
      };
      img.src = e.target?.result as string;
    };
    reader.readAsDataURL(file);
  }, []);

  // ---------- 1-b) 드래그 앤 드롭 업로드 ----------
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    // 파일을 끌고 들어왔을 때만 복사 커서 표시
    if (e.dataTransfer.types.includes("Files")) {
      e.dataTransfer.dropEffect = "copy";
      setIsDragOver(true);
    }
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    // 자식 요소로 이동하며 발생하는 leave는 무시하고, 영역을 완전히 벗어날 때만 해제
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragOver(false);
      const file = e.dataTransfer.files?.[0];
      if (file) handleUpload(file);
    },
    [handleUpload]
  );

  // ---------- 2) 브러시(마스킹) 기능 ----------
  const getCanvasPoint = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>): Point => {
      const canvas = drawCanvasRef.current!;
      const rect = canvas.getBoundingClientRect();
      // CSS 표시 크기 → 실제 캔버스 픽셀 좌표로 변환
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      return {
        x: (e.clientX - rect.left) * scaleX,
        y: (e.clientY - rect.top) * scaleY,
      };
    },
    []
  );

  const drawStroke = useCallback(
    (from: Point, to: Point) => {
      const canvas = drawCanvasRef.current;
      const ctx = canvas?.getContext("2d");
      if (!ctx) return;

      // 화면에는 반투명 빨강으로 칠해 마스크 영역을 시각적으로 표시
      ctx.strokeStyle = "rgba(255, 45, 85, 0.55)";
      ctx.fillStyle = "rgba(255, 45, 85, 0.55)";
      ctx.lineWidth = brushSize;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";

      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
      ctx.stroke();

      // 클릭(점) 한 번도 칠해지도록 원을 추가
      ctx.beginPath();
      ctx.arc(to.x, to.y, brushSize / 2, 0, Math.PI * 2);
      ctx.fill();
    },
    [brushSize]
  );

  // 포인터 위치로부터 CSS 기준 브러시 미리보기 좌표·반지름 계산
  const updateBrushPreview = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const canvas = drawCanvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const cssX = e.clientX - rect.left;
      const cssY = e.clientY - rect.top;
      // 캔버스 픽셀 반지름 → CSS 픽셀 반지름으로 변환
      const cssRadius = (brushSize / 2) * (rect.width / canvas.width);
      setBrushPreview({ x: cssX, y: cssY, r: cssRadius });
    },
    [brushSize]
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (!hasImage) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      isDrawingRef.current = true;
      const p = getCanvasPoint(e);
      lastPointRef.current = p;
      drawStroke(p, p);
      updateBrushPreview(e);
    },
    [hasImage, getCanvasPoint, drawStroke, updateBrushPreview]
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      updateBrushPreview(e);
      if (!isDrawingRef.current) return;
      const p = getCanvasPoint(e);
      const last = lastPointRef.current ?? p;
      drawStroke(last, p);
      lastPointRef.current = p;
    },
    [getCanvasPoint, drawStroke, updateBrushPreview]
  );

  const endStroke = useCallback(() => {
    isDrawingRef.current = false;
    lastPointRef.current = null;
    setBrushPreview(null);
  }, []);

  const clearMask = useCallback(() => {
    const canvas = drawCanvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
  }, []);

  // 칠해진 영역(빨강) → 흑백 마스크(흰색=지울 영역, 검정=유지)로 변환
  const buildMaskDataUrl = useCallback((): string | null => {
    const drawCanvas = drawCanvasRef.current;
    if (!drawCanvas) return null;

    const { width, height } = drawCanvas;
    const src = drawCanvas.getContext("2d")?.getImageData(0, 0, width, height);
    if (!src) return null;

    const maskCanvas = document.createElement("canvas");
    maskCanvas.width = width;
    maskCanvas.height = height;
    const maskCtx = maskCanvas.getContext("2d");
    if (!maskCtx) return null;

    const out = maskCtx.createImageData(width, height);
    let painted = false;
    for (let i = 0; i < src.data.length; i += 4) {
      const alpha = src.data[i + 3];
      const v = alpha > 10 ? 255 : 0; // 칠한 곳은 흰색, 나머지는 검정
      if (v === 255) painted = true;
      out.data[i] = v;
      out.data[i + 1] = v;
      out.data[i + 2] = v;
      out.data[i + 3] = 255;
    }
    if (!painted) return null;
    maskCtx.putImageData(out, 0, 0);
    return maskCanvas.toDataURL("image/png");
  }, []);

  // ---------- 3) Replicate Inpainting API 호출 ----------
  const handleInpaint = useCallback(async () => {
    setError(null);
    setResultUrl(null);

    const image = sourceDataUrlRef.current;
    const mask = buildMaskDataUrl();
    if (!image) {
      setError("먼저 이미지를 업로드하세요.");
      return;
    }
    if (!mask) {
      setError("지울 영역을 브러시로 칠해 주세요.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/inpaint", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image, mask }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || "Inpainting 요청에 실패했습니다.");
      }
      setResultUrl(data.output as string);
    } catch (err) {
      setError(err instanceof Error ? err.message : "알 수 없는 오류");
    } finally {
      setLoading(false);
    }
  }, [buildMaskDataUrl]);

  // 컴포넌트 언마운트 시 정리 (특별한 리소스는 없지만 일관성 유지)
  useEffect(() => endStroke, [endStroke]);

  return (
    <div className="flex flex-col gap-6">
      {/* 업로드 + 툴바 */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-neutral-800 bg-neutral-900/60 p-4">
        <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-rose-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-rose-500">
          <input
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleUpload(file);
              e.target.value = "";
            }}
          />
          제품 사진 업로드
        </label>

        <div className="flex flex-1 items-center gap-3">
          <span className="whitespace-nowrap text-xs text-neutral-400">
            브러시 크기
          </span>
          <input
            type="range"
            min={8}
            max={120}
            value={brushSize}
            onChange={(e) => setBrushSize(Number(e.target.value))}
            disabled={!hasImage}
            className="w-40 accent-rose-500 disabled:opacity-40"
          />
          <span className="w-8 text-xs text-neutral-400">{brushSize}px</span>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={clearMask}
            disabled={!hasImage}
            className="rounded-lg border border-neutral-700 px-3 py-2 text-sm text-neutral-200 transition hover:bg-neutral-800 disabled:opacity-40"
          >
            마스크 지우기
          </button>
          <button
            onClick={handleInpaint}
            disabled={!hasImage || loading}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {loading ? "지우는 중…" : "텍스트 지우기"}
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-900 bg-red-950/60 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      {/* 캔버스 영역 */}
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold text-neutral-300">
            원본 / 마스킹
          </h2>
          <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className={`flex min-h-[320px] items-center justify-center rounded-xl border p-4 transition-colors ${
              isDragOver
                ? "border-rose-500 border-dashed bg-rose-950/30"
                : "border-neutral-800 bg-neutral-900/40"
            }`}
          >
            {/* 캔버스는 항상 마운트해 두고(ref 안정성), 이미지가 없을 때만 숨깁니다. */}
            <div
              className="relative touch-none"
              style={{
                width: canvasSize.width || undefined,
                height: canvasSize.height || undefined,
                maxWidth: "100%",
                display: hasImage ? "block" : "none",
              }}
            >
              <canvas
                ref={imageCanvasRef}
                className="block h-auto w-full rounded-lg"
              />
              <canvas
                ref={drawCanvasRef}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={endStroke}
                onPointerLeave={endStroke}
                className="absolute left-0 top-0 h-full w-full rounded-lg"
                style={{ cursor: "none" }}
              />
              {/* 브러시 크기 원형 미리보기 — 실제 브러시 크기를 CSS 픽셀로 환산해 표시 */}
              {brushPreview && (
                <div
                  className="pointer-events-none absolute rounded-full border-2 border-white mix-blend-difference"
                  style={{
                    left: brushPreview.x - brushPreview.r,
                    top: brushPreview.y - brushPreview.r,
                    width: brushPreview.r * 2,
                    height: brushPreview.r * 2,
                  }}
                />
              )}
            </div>
            {!hasImage && (
              <div className="pointer-events-none flex flex-col items-center gap-2 text-center">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="32"
                  height="32"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className={isDragOver ? "text-rose-400" : "text-neutral-600"}
                >
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="17 8 12 3 7 8" />
                  <line x1="12" y1="3" x2="12" y2="15" />
                </svg>
                <p
                  className={`text-sm ${
                    isDragOver ? "text-rose-300" : "text-neutral-500"
                  }`}
                >
                  {isDragOver
                    ? "여기에 사진을 놓으세요"
                    : "사진을 여기로 끌어다 놓거나 상단의 업로드 버튼을 누르세요."}
                </p>
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold text-neutral-300">텍스트 제거 결과</h2>
          <div className="flex min-h-[320px] items-center justify-center rounded-xl border border-neutral-800 bg-neutral-900/40 p-4">
            {loading ? (
              <p className="text-sm text-neutral-400">
                AI가 글자를 지우고 표면을 채우는 중…
              </p>
            ) : resultUrl ? (
              <div className="flex flex-col items-center gap-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={resultUrl}
                  alt="Inpainting 결과"
                  className="max-h-[540px] w-auto rounded-lg"
                />
                <a
                  href={resultUrl}
                  download="inpainted.png"
                  className="text-xs text-neutral-500 underline hover:text-neutral-300"
                >
                  이미지 다운로드
                </a>
              </div>
            ) : (
              <p className="text-center text-sm text-neutral-500">
                텍스트를 지우면 결과 이미지가 여기에 표시됩니다.
              </p>
            )}
          </div>
        </div>
      </div>

      {/* 2단계: 인페인팅 결과가 있을 때만 로고 합성 섹션 표시 */}
      {resultUrl && <LogoCompositor inpaintedUrl={resultUrl} />}
    </div>
  );
}
