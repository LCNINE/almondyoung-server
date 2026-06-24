'use client';

import { useState } from 'react';
import { ImageOff } from 'lucide-react';
import { resolvePublicFileUrl } from '@/lib/utils/file-url';
import { getProductDescriptionImagePlaceholderText } from './product-description-rendering';
import {
  isProductDescriptionImageBroken,
  shouldShowProductDescriptionImagePlaceholder,
} from './product-description-image-state';

type Props = {
  fileId: string | null;
  alt: string;
  error?: string | null;
};

export function ProductDescriptionImage({ fileId, alt, error }: Props) {
  const [failedFileId, setFailedFileId] = useState<string | null>(null);
  const broken = isProductDescriptionImageBroken({ fileId, failedFileId });

  if (shouldShowProductDescriptionImagePlaceholder({ fileId, error, failedFileId })) {
    return (
      <div className="my-3 flex min-h-24 items-center gap-2 rounded-md border border-dashed bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
        <ImageOff className="size-4 shrink-0" />
        <span>
          {getProductDescriptionImagePlaceholderText({
            fileId,
            alt,
            error,
            broken,
          })}
        </span>
      </div>
    );
  }

  return (
    <img
      src={resolvePublicFileUrl(fileId) ?? ''}
      alt={alt}
      className="my-3 max-w-full rounded-md"
      loading="lazy"
      onError={() => setFailedFileId(fileId)}
    />
  );
}
