'use client';

import { useEffect, useRef, useState, type JSX } from 'react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';

type ViewerState = 'loading' | 'ready' | 'error';

export function ModelPreviewDialog({
  src,
  title,
  onClose,
}: {
  src: string | null;
  title: string;
  onClose: () => void;
}): JSX.Element {
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const [state, setState] = useState<ViewerState>('loading');
  const disposeRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!src || !container) {
      return;
    }

    let cancelled = false;

    setState('loading');
    import('./mount-model-viewer')
      .then(({ mountModelViewer }) => {
        if (cancelled) {
          return;
        }

        disposeRef.current = mountModelViewer(container, {
          src,
          alt: title,
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
  }, [src, container, title]);

  return (
    <Dialog open={src !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogTitle className="text-base">{title}</DialogTitle>
        <div className="relative h-[480px] w-full overflow-hidden rounded-lg bg-muted">
          <div ref={setContainer} className="h-full w-full" />
          {state !== 'ready' && (
            <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
              {state === 'loading'
                ? '3D 모델을 불러오는 중…'
                : '3D 모델을 열지 못했어요'}
            </div>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          드래그해서 돌리고, 휠이나 두 손가락으로 확대해요
        </p>
      </DialogContent>
    </Dialog>
  );
}
