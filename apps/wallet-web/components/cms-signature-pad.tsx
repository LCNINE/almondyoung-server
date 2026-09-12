'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { RotateCw } from 'lucide-react';

interface CmsSignaturePadProps {
  onComplete: (blob: Blob) => void;
  disabled?: boolean;
}

export function CmsSignaturePad({ onComplete, disabled }: CmsSignaturePadProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [isEmpty, setIsEmpty] = useState(true);
  const lastPos = useRef<{ x: number; y: number } | null>(null);
  const lastMid = useRef<{ x: number; y: number } | null>(null);

  // 캔버스 해상도를 실제로 그려지는 크기에 맞춘다. 고정 480×180 을 CSS 로 늘리면
  // 획이 가로로 눌려 서명 모양이 달라진다 — 심사에 제출되는 이미지다.
  useEffect(() => {
    const canvas = canvasRef.current;
    const box = boxRef.current;
    if (!canvas || !box) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = box.getBoundingClientRect();
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
  }, []);

  const getPos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY };
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (disabled) return;
    e.preventDefault();
    (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
    setIsDrawing(true);
    setIsEmpty(false);
    lastPos.current = getPos(e);
    lastMid.current = lastPos.current;
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawing || !lastPos.current || disabled) return;
    e.preventDefault();
    const ctx = canvasRef.current!.getContext('2d')!;
    const pos = getPos(e);
    const prev = lastPos.current;
    // 두 점을 직선으로 이으면 방향이 꺾일 때마다 각이 진다. 직전 중점 → 현재 중점을
    // 지나는 2차 곡선으로 이어 붓처럼 매끄럽게 만든다.
    const mid = { x: (prev.x + pos.x) / 2, y: (prev.y + pos.y) / 2 };
    const from = lastMid.current ?? prev;
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.quadraticCurveTo(prev.x, prev.y, mid.x, mid.y);
    ctx.strokeStyle = '#1a1a1a';
    ctx.lineWidth = 2.6 * (window.devicePixelRatio || 1);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();
    lastPos.current = pos;
    lastMid.current = mid;
  };

  const handlePointerUp = () => {
    // 획을 그리는 동안에는 «중점까지»만 이어진다. 그대로 끝내면 마지막 중점에서
    // 손을 뗀 지점까지가 저장 이미지에서 빠진다 — 남은 구간을 마저 잇고 끝낸다.
    const canvas = canvasRef.current;
    if (isDrawing && canvas && lastMid.current && lastPos.current) {
      const ctx = canvas.getContext('2d')!;
      ctx.beginPath();
      ctx.moveTo(lastMid.current.x, lastMid.current.y);
      ctx.lineTo(lastPos.current.x, lastPos.current.y);
      ctx.strokeStyle = '#1a1a1a';
      ctx.lineWidth = 2.6 * (window.devicePixelRatio || 1);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.stroke();
    }
    setIsDrawing(false);
    lastPos.current = null;
    lastMid.current = null;
  };

  const clear = () => {
    const canvas = canvasRef.current!;
    canvas.getContext('2d')!.clearRect(0, 0, canvas.width, canvas.height);
    setIsEmpty(true);
  };

  const save = useCallback(() => {
    canvasRef.current!.toBlob((blob) => {
      if (blob) onComplete(blob);
    }, 'image/png');
  }, [onComplete]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        ref={boxRef}
        className="relative h-[240px] shrink-0 overflow-hidden rounded-2xl border border-border bg-white"
      >
        <canvas
          ref={canvasRef}
          className="h-full w-full cursor-crosshair touch-none"
          style={{ touchAction: 'none' }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerUp}
        />
        <div className="pointer-events-none absolute inset-x-7 bottom-[28%]">
          {isEmpty && (
            <p className="mb-3.5 text-center text-[15px] font-medium text-muted-foreground/60">여기에 서명해주세요</p>
          )}
          <div className="h-px w-full bg-border" />
        </div>
      </div>

      <div className="mt-3 flex justify-end">
        <button
          type="button"
          onClick={clear}
          disabled={isEmpty || disabled}
          className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40 disabled:hover:bg-transparent"
        >
          <RotateCw className="size-3.5" />
          다시 쓰기
        </button>
      </div>

      <div className="mt-auto pt-8">
        <Button
          type="button"
          onClick={save}
          disabled={isEmpty || disabled}
          className="h-14 w-full rounded-2xl text-[16px] font-semibold transition-transform duration-150 active:scale-[0.985] disabled:active:scale-100"
        >
          {disabled ? (
            <span className="flex items-center gap-2">
              <span className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
              등록 중...
            </span>
          ) : (
            '서명 완료 및 등록하기'
          )}
        </Button>
      </div>
    </div>
  );
}
