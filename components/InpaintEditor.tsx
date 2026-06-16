"use client";

import { useCallback, useEffect, useRef, useState } from "react";

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
        ctx.clearRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);

        // 마스크 캔버스 초기화
        const drawCtx = drawCanvas.getContext("2d");
        drawCtx?.clearRect(0, 0, width, height);

        // 원본을 PNG dataURL로 저장(축소된 해상도 기준)
        sourceDataUrlRef.current = imageCanvas.toDataURL("image/png");
        setHasImage(true);
      };
      img.src = e.target?.result as string;
    };
    reader.readAsDataURL(file);
  }, []);

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

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (!hasImage) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      isDrawingRef.current = true;
      const p = getCanvasPoint(e);
      lastPointRef.current = p;
      drawStroke(p, p);
    },
    [hasImage, getCanvasPoint, drawStroke]
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (!isDrawingRef.current) return;
      const p = getCanvasPoint(e);
      const last = lastPointRef.current ?? p;
      drawStroke(last, p);
      lastPointRef.current = p;
    },
    [getCanvasPoint, drawStroke]
  );

  const endStroke = useCallback(() => {
    isDrawingRef.current = false;
    lastPointRef.current = null;
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
          <div className="flex min-h-[320px] items-center justify-center rounded-xl border border-neutral-800 bg-neutral-900/40 p-4">
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
                className="absolute left-0 top-0 h-full w-full cursor-crosshair rounded-lg"
              />
            </div>
            {!hasImage && (
              <p className="text-center text-sm text-neutral-500">
                제품 사진을 업로드하면 여기에 표시됩니다.
              </p>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold text-neutral-300">결과</h2>
          <div className="flex min-h-[320px] items-center justify-center rounded-xl border border-neutral-800 bg-neutral-900/40 p-4">
            {loading ? (
              <p className="text-sm text-neutral-400">
                AI가 글자를 지우고 표면을 채우는 중…
              </p>
            ) : resultUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={resultUrl}
                alt="Inpainting 결과"
                className="max-h-[600px] w-auto rounded-lg"
              />
            ) : (
              <p className="text-center text-sm text-neutral-500">
                텍스트를 지우면 결과 이미지가 여기에 표시됩니다.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
