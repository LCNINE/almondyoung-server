'use client';

import { type ChangeEvent, useRef, useState } from 'react';
import { ImagePlus } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  PRODUCT_DESCRIPTION_IMAGE_CONTEXT_ID,
  uploadFileToFileService,
} from '@/lib/api/domains/files/upload.client';
import { createProductImageDirective } from '@packages/product-description';

type Props = {
  disabled?: boolean;
  onInsert: (markdown: string) => void;
};

export function MarkdownImageUploadButton({ disabled, onInsert }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const onFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    setUploading(true);
    try {
      const upload = await uploadFileToFileService(file, {
        contextId: PRODUCT_DESCRIPTION_IMAGE_CONTEXT_ID,
        isPublic: true,
      });
      onInsert(createProductImageDirective({ fileId: upload.id, alt: file.name }));
      toast.success('상세설명 이미지가 업로드되었습니다.', { description: upload.id });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '이미지 업로드에 실패했습니다.');
    } finally {
      setUploading(false);
    }
  };

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled || uploading}
        onClick={() => inputRef.current?.click()}
      >
        <ImagePlus data-icon="inline-start" />
        {uploading ? '업로드 중...' : '이미지'}
      </Button>
      <input ref={inputRef} type="file" accept="image/*" hidden onChange={onFileChange} />
    </>
  );
}
