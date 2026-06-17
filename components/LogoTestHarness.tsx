"use client";

import { useCallback, useState } from "react";
import LogoCompositor from "@/components/LogoCompositor";

// 업로드 이미지를 캔버스에 띄울 때 사용할 최대 한 변 길이(px).
// InpaintEditor와 동일하게 큰 원본은 비율을 유지하며 축소합니다.
const MAX_DIMENSION = 1024;

/**
 * 로고 합성(2단계) 기능을 인페인팅(1단계) 없이 단독으로 테스트하는 하니스.
 * 제품 사진(또는 아무 배경 이미지)을 직접 업로드하면 그 이미지를 배경으로
 * LogoCompositor에 그대로 전달해 로고 위치·크기·회전·투명도를 시험할 수 있습니다.
 */
export default function LogoTestHarness() {
  const [bgDataUrl, setBgDataUrl] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 업로드 이미지를 비율 유지 축소 후 PNG dataURL로 변환
  const handleUpload = useCallback((file: File) => {
    if (!file.type.startsWith("image/")) {
      setError("이미지 파일만 업로드할 수 있습니다.");
      return;
    }
    setError(null);

    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        const scale = Math.min(1, MAX_DIMENSION / Math.max(width, height));
        width = Math.round(width * scale);
        height = Math.round(height * scale);

        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        ctx.drawImage(img, 0, 0, width, height);
        setBgDataUrl(canvas.toDataURL("image/png"));
      };
      img.src = e.target?.result as string;
    };
    reader.readAsDataURL(file);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.types.includes("Files")) {
      e.dataTransfer.dropEffect = "copy";
      setIsDragOver(true);
    }
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
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

  return (
    <div className="flex flex-col gap-6">
      {/* 안내 배너 */}
      <div className="rounded-xl border border-sky-900/50 bg-sky-950/30 px-4 py-3 text-sm text-sky-200">
        <span className="font-semibold">로고 합성 테스트 모드</span> — 인페인팅(1단계)을
        건너뛰고, 업로드한 이미지를 곧바로 배경으로 사용해 로고 합성 기능을 시험합니다.
      </div>

      {/* 배경 업로드 */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-neutral-800 bg-neutral-900/60 p-4">
        <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-sky-500">
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
          {bgDataUrl ? "배경 이미지 변경" : "배경 이미지 업로드"}
        </label>
        {bgDataUrl && (
          <button
            onClick={() => setBgDataUrl(null)}
            className="rounded-lg border border-neutral-700 px-3 py-2 text-sm text-neutral-200 transition hover:bg-neutral-800"
          >
            초기화
          </button>
        )}
      </div>

      {error && (
        <div className="rounded-lg border border-red-900 bg-red-950/60 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      {bgDataUrl ? (
        // key로 배경 교체 시 LogoCompositor를 새로 마운트해 상태를 초기화
        <LogoCompositor key={bgDataUrl} inpaintedUrl={bgDataUrl} />
      ) : (
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={`flex min-h-[320px] items-center justify-center rounded-xl border p-4 transition-colors ${
            isDragOver
              ? "border-sky-500 border-dashed bg-sky-950/30"
              : "border-neutral-800 border-dashed bg-neutral-900/40"
          }`}
        >
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
              className={isDragOver ? "text-sky-400" : "text-neutral-600"}
            >
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
            <p className={`text-sm ${isDragOver ? "text-sky-300" : "text-neutral-500"}`}>
              {isDragOver
                ? "여기에 이미지를 놓으세요"
                : "배경으로 쓸 이미지를 끌어다 놓거나 위의 업로드 버튼을 누르세요."}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
