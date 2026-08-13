'use client';

import { type ChangeEvent, useCallback, useRef, useState } from 'react';
import type { Editor } from '@tiptap/react';
import { toast } from 'sonner';
import { uploadRichTextImage } from '@/lib/api/domains/files/upload.client';

/**
 * 툴바 이미지 버튼 / 붙여넣기 / 드래그앤드롭 → file-service 업로드 → 에디터에 <img> 삽입.
 * contextId 는 사용처 도메인의 file_contexts 시드와 일치해야 한다.
 */
export function useImageUpload(editor: Editor | null, contextId: string) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const insertFiles = useCallback(
    async (files: File[]) => {
      if (!editor || files.length === 0) return;
      setUploading(true);
      try {
        for (const file of files) {
          const { url } = await uploadRichTextImage(file, contextId);
          editor.chain().focus().setImage({ src: url, alt: file.name }).run();
        }
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : '이미지 업로드에 실패했습니다.'
        );
      } finally {
        setUploading(false);
      }
    },
    [editor, contextId]
  );

  const openPicker = useCallback(() => {
    inputRef.current?.click();
  }, []);

  const onFileChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files ?? []);
      e.target.value = ''; // 같은 파일 재선택 허용
      if (files.length > 0) void insertFiles(files);
    },
    [insertFiles]
  );

  /**
   * 클립보드/드롭에 담긴 이미지 파일을 업로드한다.
   * 이미지 파일이 없으면 false 를 돌려 Tiptap 기본 붙여넣기(텍스트/HTML)에 맡긴다.
   */
  const handleFileList = useCallback(
    (list: FileList | null | undefined) => {
      const files = Array.from(list ?? []).filter((f) =>
        f.type.startsWith('image/')
      );
      if (files.length === 0) return false;
      void insertFiles(files);
      return true;
    },
    [insertFiles]
  );

  return { inputRef, uploading, openPicker, onFileChange, handleFileList };
}
