'use client';

import { useEffect, useRef, useState, type JSX } from 'react';
import { Loader2 } from 'lucide-react';

type ViewerState = 'loading' | 'ready' | 'error';

// 쇼핑몰과 같은 model-viewer. 휴대전화에서 가로 드래그는 회전, 세로는 페이지 스크롤, 두 손가락은 확대
export function WorkshopModelViewer({
  src,
  title,
}: {
  src: string;
  title: string;
}): JSX.Element {
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const [state, setState] = useState<ViewerState>('loading');
  const disposeRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!container) {
      return;
    }

    let cancelled = false;

    setState('loading');
    import('../sku-3d-models/mount-model-viewer')
      .then(({ mountModelViewer }) => {
        if (cancelled) {
          return;
        }

        disposeRef.current = mountModelViewer(container, {
          src,
          alt: title,
          autoRotate: false,
          touchAction: 'pan-y',
          onLoad: () => setState('ready'),
          onError: () => setState('error'),
        });
      })
      .catch(() => setState('error'));

    return () => {
      cancelled = true;
      disposeRef.current?.();
      disposeRef.current = null;
    };
  }, [container, src, title]);

  return (
    <div className="relative aspect-square w-full overflow-hidden rounded-xl bg-[#c6c6c6]">
      <div ref={setContainer} className="h-full w-full" />
      {state === 'loading' && (
        <Loader2 className="absolute inset-0 m-auto h-6 w-6 animate-spin text-gray-500" />
      )}
      {state === 'error' && (
        <p className="absolute inset-x-0 bottom-3 text-center text-sm text-gray-700">
          모델을 불러오지 못했어요
        </p>
      )}
    </div>
  );
}
