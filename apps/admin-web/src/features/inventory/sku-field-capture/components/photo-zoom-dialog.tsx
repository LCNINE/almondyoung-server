'use client';

import { useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';

type Props = {
  srcs: string[];
  /** 크게 보는 사진 순번, 닫혀 있으면 null */
  index: number | null;
  onIndex: (index: number | null) => void;
};

export function PhotoZoomDialog({ srcs, index, onIndex }: Props) {
  const touchX = useRef(0);
  // 끝에서 넘기면 처음으로, 처음에서 거꾸로 넘기면 끝으로
  const step = (d: -1 | 1) => index !== null && onIndex((index + d + srcs.length) % srcs.length);
  const src = index === null ? null : (srcs[index] ?? null);

  return (
    <Dialog open={src !== null} onOpenChange={(v) => !v && onIndex(null)}>
      <DialogContent
        className="max-w-[calc(100%-1rem)] p-2"
        onKeyDown={(e) => {
          if (e.key === 'ArrowLeft') step(-1);
          if (e.key === 'ArrowRight') step(1);
        }}
      >
        <DialogTitle className="sr-only">사진 크게 보기</DialogTitle>
        {src && (
          <div
            className="relative"
            onTouchStart={(e) => (touchX.current = e.touches[0]!.clientX)}
            onTouchEnd={(e) => {
              const dx = e.changedTouches[0]!.clientX - touchX.current;
              if (Math.abs(dx) > 40) step(dx < 0 ? 1 : -1);
            }}
          >
            <PhotoImg key={src} src={src} className="max-h-[85vh] w-full rounded-md object-contain" />
            {srcs.length > 1 && (
              <>
                <button
                  type="button"
                  aria-label="이전 사진"
                  onClick={() => step(-1)}
                  className="absolute left-1 top-1/2 -translate-y-1/2 rounded-full bg-black/50 p-2 text-white"
                >
                  <ChevronLeft className="h-6 w-6" />
                </button>
                <button
                  type="button"
                  aria-label="다음 사진"
                  onClick={() => step(1)}
                  className="absolute right-1 top-1/2 -translate-y-1/2 rounded-full bg-black/50 p-2 text-white"
                >
                  <ChevronRight className="h-6 w-6" />
                </button>
              </>
            )}
          </div>
        )}
        <p className="text-center text-xs text-gray-500 tabular-nums">
          {(index ?? 0) + 1} / {srcs.length}
        </p>
      </DialogContent>
    </Dialog>
  );
}

// 서버 사진은 한 번 실패해도 바로 엑박으로 두지 않고 주소를 바꿔 한 번 더 받는다 — 일시 실패가 화면에 남던 것
export function PhotoImg({ src, className = 'h-full w-full object-cover' }: { src: string; className?: string }) {
  const [retried, setRetried] = useState(false);
  const shown = retried && !src.startsWith('blob:') ? `${src}?retry=1` : src;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- file-service 공개 URL·로컬 미리보기, next/image 도메인 설정 밖
    <img src={shown} alt="" onError={() => setRetried(true)} className={className} />
  );
}
