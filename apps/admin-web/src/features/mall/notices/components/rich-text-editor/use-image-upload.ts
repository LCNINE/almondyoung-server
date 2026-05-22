'use client';

import { type ChangeEvent, useCallback, useRef, useState } from 'react';
import type { Editor } from '@tiptap/react';
import { toast } from 'sonner';
import { uploadNoticeImage } from '@/lib/api/domains/files/upload.client';

/**
 * 툴바 이미지 버튼 → 파일 선택 → file-service 업로드 → 에디터에 <img> 삽입.
 */
export function useImageUpload(editor: Editor | null) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const openPicker = useCallback(() => {
    inputRef.current?.click();
  }, []);

  const onFileChange = useCallback(
    async (e: ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = ''; // 같은 파일 재선택 허용
      if (!file || !editor) return;

      setUploading(true);
      try {
        const { url } = await uploadNoticeImage(file);
        editor.chain().focus().setImage({ src: url, alt: file.name }).run();
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : '이미지 업로드에 실패했습니다.'
        );
      } finally {
        setUploading(false);
      }
    },
    [editor]
  );

  return { inputRef, uploading, openPicker, onFileChange };
}
