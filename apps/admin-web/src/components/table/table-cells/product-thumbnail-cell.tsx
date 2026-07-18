'use client';

import { useState } from 'react';
import { ImageOff } from 'lucide-react';
import { resolvePublicFileUrl } from '@/lib/utils/file-url';

export function ProductThumbnailCell({
  thumbnail,
}: {
  thumbnail: string | null | undefined;
}) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const src = resolvePublicFileUrl(thumbnail);
  const loadFailed = src !== null && failedSrc === src;

  if (!src || loadFailed) {
    return (
      <div className="mx-auto flex h-14 w-14 flex-col items-center justify-center rounded bg-muted text-muted-foreground">
        <ImageOff className="h-4 w-4" aria-hidden="true" />
        <span className="mt-0.5 text-[9px]">이미지 없음</span>
      </div>
    );
  }

  return (
    <div className="mx-auto h-14 w-14 overflow-hidden rounded bg-muted">
      <img
        src={src}
        alt="상품 이미지"
        className="h-full w-full object-cover"
        onError={() => setFailedSrc(src)}
      />
    </div>
  );
}
