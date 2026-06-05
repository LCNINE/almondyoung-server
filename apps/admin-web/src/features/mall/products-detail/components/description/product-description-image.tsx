'use client';

import { useState } from 'react';
import { ImageOff } from 'lucide-react';
import { FILE_SERVICE_BASE_URL } from '@/const/api-const';

type Props = {
  fileId: string | null;
  alt: string;
  error?: string | null;
};

export function ProductDescriptionImage({ fileId, alt, error }: Props) {
  const [broken, setBroken] = useState(false);

  if (!fileId || error || broken) {
    return (
      <div className="my-3 flex min-h-24 items-center gap-2 rounded-md border border-dashed bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
        <ImageOff className="size-4 shrink-0" />
        <span>
          이미지를 불러올 수 없습니다{fileId ? `: ${fileId}` : ''}
          {alt ? ` (${alt})` : ''}
        </span>
      </div>
    );
  }

  return (
    <img
      src={`${FILE_SERVICE_BASE_URL}/files/public/${fileId}`}
      alt={alt}
      className="my-3 max-w-full rounded-md"
      loading="lazy"
      onError={() => setBroken(true)}
    />
  );
}
