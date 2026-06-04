'use client';

import { useCallback, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { RotateCw } from 'lucide-react';

interface CmsSignaturePadProps {
  onComplete: (blob: Blob) => void;
  disabled?: boolean;
}

export function CmsSignaturePad({ onComplete, disabled }: CmsSignaturePadProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [isEmpty, setIsEmpty] = useState(true);
  const lastPos = useRef<{ x: number; y: number } | null>(null);

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
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawing || !lastPos.current || disabled) return;
    e.preventDefault();
    const ctx = canvasRef.current!.getContext('2d')!;
    const pos = getPos(e);
    ctx.beginPath();
    ctx.moveTo(lastPos.current.x, lastPos.current.y);
    ctx.lineTo(pos.x, pos.y);
    ctx.strokeStyle = '#1a1a1a';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();
    lastPos.current = pos;
  };

  const handlePointerUp = () => {
    setIsDrawing(false);
    lastPos.current = null;
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
    <div className="space-y-3">
      <div className="relative rounded-lg border border-input bg-white overflow-hidden">
        <canvas
          ref={canvasRef}
          width={480}
          height={180}
          className="w-full touch-none cursor-crosshair"
          style={{ touchAction: 'none' }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerUp}
        />
        {isEmpty && (
          <p className="pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-xs text-muted-foreground">
            여기에 서명하세요
          </p>
        )}
        <button
          type="button"
          onClick={clear}
          className="absolute right-3 bottom-3 text-muted-foreground hover:text-foreground"
          aria-label="서명 지우기"
        >
          <RotateCw className="h-4 w-4" />
        </button>
      </div>
      <Button
        type="button"
        onClick={save}
        disabled={isEmpty || disabled}
        className="w-full h-11 font-semibold"
      >
        {disabled ? (
          <span className="flex items-center gap-2">
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
            등록 중...
          </span>
        ) : (
          '서명 완료 및 등록하기'
        )}
      </Button>
    </div>
  );
}
