'use client';

import { useEffect } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import { ResizableImage } from './resizable-image';
import { cn } from '@/lib/utils/ui';
import { EditorToolbar } from './toolbar';
import { useImageUpload } from './use-image-upload';

export { isEmptyHtml } from './is-empty-html';

type Props = {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  className?: string;
};

/**
 * 공지 본문 리치 텍스트 에디터(Tiptap v3). 본문은 HTML 문자열로 다룬다.
 * StarterKit 가 Link/Underline 을 이미 포함하므로 Link 는 옵션으로만 설정한다.
 */
export function RichTextEditor({
  value,
  onChange,
  placeholder,
  className,
}: Props) {
  const editor = useEditor({
    immediatelyRender: false, // App Router(SSR) hydration mismatch 방지
    extensions: [
      StarterKit.configure({
        link: {
          openOnClick: false,
          HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' },
        },
      }),
      ResizableImage.configure({ inline: false }),
      Placeholder.configure({
        placeholder: placeholder ?? '공지 본문을 입력하세요.',
      }),
    ],
    content: value,
    editorProps: {
      attributes: {
        class: cn(
          'notice-content min-h-[220px] w-full px-3 py-2.5 leading-6 focus:outline-none',
          className
        ),
      },
    },
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
  });

  const { inputRef, uploading, openPicker, onFileChange } =
    useImageUpload(editor);

  // 외부 value 변경(수정폼 로딩 등) 동기화 — 현재 HTML 과 다를 때만 setContent (커서 리셋 방지)
  useEffect(() => {
    if (!editor) return;
    if (value !== editor.getHTML()) {
      editor.commands.setContent(value, { emitUpdate: false });
    }
  }, [value, editor]);

  if (!editor) return null;

  return (
    <div className="overflow-hidden rounded-md border bg-background">
      <EditorToolbar
        editor={editor}
        onImageClick={openPicker}
        imageUploading={uploading}
      />
      <EditorContent editor={editor} />
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        hidden
        onChange={onFileChange}
      />
    </div>
  );
}
