'use client';

import { useEffect, useRef } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { toast } from 'sonner';
import Placeholder from '@tiptap/extension-placeholder';
import { ResizableImage } from './resizable-image';
import { cn } from '@/lib/utils/ui';
import { EditorToolbar } from './toolbar';
import { useImageUpload } from './use-image-upload';

export { isEmptyHtml } from './is-empty-html';

/**
 * 외부(네이버 카페 등)에서 붙여넣은 HTML 의 <img> 를 걷어낸다.
 * 남겨두면 pstatic 같은 남의 서버를 직접 링크하게 되고, 그쪽이 referer 를 막는 순간
 * 본문이 통째로 엑박이 된다. 사진은 툴바/드래그앤드롭으로 올려 S3 에 저장해야 한다.
 * ProseMirror 가 쓴 클립보드(data-pm-slice)는 에디터 내부 복사이므로 건드리지 않는다.
 */
/**
 * 붙여넣기 한 번에 클립보드 파일과 HTML `<img>` 경로가 각각 걸리고,
 * transformPastedHTML 자체도 여러 번 불린다. 고정 id 하나로 묶어 토스트가 겹치지 않게 한다.
 */
function notifyImagesDropped(allowImages: boolean) {
  toast.info('붙여넣은 사진은 제외했어요.', {
    id: 'rte-image-notice',
    description: allowImages
      ? '남의 서버 링크라 나중에 깨져요. 사진 파일을 여기로 끌어다 놓거나, 툴바의 이미지 버튼을 눌러 올려주세요.'
      : '사진은 오른쪽 「샵 사진」에 올려주세요.',
    duration: 6000,
  });
}

function stripExternalImages(html: string, allowImages: boolean): string {
  if (html.includes('data-pm-slice')) return html;

  if (/<img\b[^>]*>/i.test(html)) notifyImagesDropped(allowImages);
  return html.replace(/<img\b[^>]*>/gi, '');
}

type Props = {
  value: string;
  onChange: (html: string) => void;
  /** 이미지 업로드 시 file-service 로 보낼 contextId. 사용처 도메인의 file_contexts 시드와 일치해야 한다. */
  imageContextId: string;
  placeholder?: string;
  className?: string;
  /**
   * 본문에 사진을 넣을 수 있는지. 끄면 툴바 버튼·붙여넣기·드래그앤드롭이 모두 막힌다.
   * 샵매매처럼 사진 전용 필드가 따로 있는 화면에서 쓴다.
   */
  allowImages?: boolean;
};

/**
 * 리치 텍스트 에디터(Tiptap v3). 본문은 HTML 문자열로 다룬다.
 * StarterKit 가 Link/Underline 을 이미 포함하므로 Link 는 옵션으로만 설정한다.
 */
export function RichTextEditor({
  value,
  onChange,
  imageContextId,
  placeholder,
  className,
  allowImages = true,
}: Props) {
  // editorProps 는 useEditor 안에서 굳으므로, 아래에서 만드는 업로드 핸들러를 ref 로 건네준다.
  const fileHandlerRef = useRef<(list: FileList | null) => boolean>(
    () => false
  );

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
        placeholder: placeholder ?? '내용을 입력하세요.',
      }),
    ],
    content: value,
    editorProps: {
      attributes: {
        class: cn(
          'rich-text-content min-h-[220px] w-full px-3 py-2.5 leading-6 focus:outline-none',
          className
        ),
      },
      transformPastedHTML: (html) => stripExternalImages(html, allowImages),
      handlePaste: (_view, event) =>
        fileHandlerRef.current(event.clipboardData?.files ?? null),
      handleDrop: (_view, event) => {
        const dropped = (event as DragEvent).dataTransfer?.files ?? null;
        return fileHandlerRef.current(dropped);
      },
    },
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
  });

  const { inputRef, uploading, openPicker, onFileChange, handleFileList } =
    useImageUpload(editor, imageContextId);

  // 사진을 막은 화면에서도 글 붙여넣기는 그대로 돼야 한다 —
  // 이미지 파일이 있을 때만 가로채고(true), 아니면 기본 동작에 넘긴다(false).
  fileHandlerRef.current = allowImages
    ? handleFileList
    : (list) => {
        const hasImage = Array.from(list ?? []).some((f) =>
          f.type.startsWith('image/')
        );
        if (hasImage) notifyImagesDropped(false);
        return hasImage;
      };

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
        allowImages={allowImages}
      />
      <EditorContent editor={editor} />
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={onFileChange}
      />
    </div>
  );
}
