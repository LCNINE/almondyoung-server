'use client';

import { type ChangeEvent, useRef, useState } from 'react';
import { ImagePlus } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { SITE_POPUP_IMAGE_CONTEXT_ID, uploadFileToFileService } from '@/lib/api/domains/files/upload.client';

// 메일은 어드민 프록시(/api/proxy/file)를 못 연다. 받는 사람이 열 수 있는 공개 주소로 넣는다.
const PUBLIC_FILE_BASE = (process.env.NEXT_PUBLIC_FILE_PUBLIC_URL ?? 'https://file.almondyoung.com').replace(
  /\/+$/,
  '',
);

export function MailImageUploadButton({
  disabled,
  onInsert,
}: {
  disabled?: boolean;
  onInsert: (markdown: string, url: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const onFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    setUploading(true);
    try {
      const upload = await uploadFileToFileService(file, {
        contextId: SITE_POPUP_IMAGE_CONTEXT_ID,
        isPublic: true,
        compress: { measure: 'width', maxEdge: 1200 },
      });
      const url = `${PUBLIC_FILE_BASE}/files/public/${upload.id}`;
      onInsert(`![${file.name}](${url})`, url);
      toast.success('이미지를 넣었습니다.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '이미지 업로드에 실패했습니다.');
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
