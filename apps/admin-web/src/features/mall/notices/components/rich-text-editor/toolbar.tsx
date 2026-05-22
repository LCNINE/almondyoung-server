'use client';

import type { Editor } from '@tiptap/react';
import {
  Bold,
  Heading2,
  Heading3,
  ImageIcon,
  Italic,
  Link2,
  Link2Off,
  List,
  ListOrdered,
  Loader2,
  Underline,
} from 'lucide-react';
import { Toggle } from '@/components/ui/toggle';
import { Button } from '@/components/ui/button';

type Props = {
  editor: Editor;
  onImageClick: () => void;
  imageUploading: boolean;
};

export function EditorToolbar({ editor, onImageClick, imageUploading }: Props) {
  const handleLink = () => {
    const prev = editor.getAttributes('link').href as string | undefined;
    const url = window.prompt('링크 URL을 입력하세요.', prev ?? 'https://');
    if (url === null) return; // 취소
    if (url.trim() === '') {
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
      return;
    }
    editor
      .chain()
      .focus()
      .extendMarkRange('link')
      .setLink({ href: url.trim() })
      .run();
  };

  return (
    <div className="flex flex-wrap items-center gap-0.5 border-b bg-muted/30 p-1.5">
      <Toggle
        size="sm"
        pressed={editor.isActive('bold')}
        onPressedChange={() => editor.chain().focus().toggleBold().run()}
        aria-label="굵게"
      >
        <Bold />
      </Toggle>
      <Toggle
        size="sm"
        pressed={editor.isActive('italic')}
        onPressedChange={() => editor.chain().focus().toggleItalic().run()}
        aria-label="기울임"
      >
        <Italic />
      </Toggle>
      <Toggle
        size="sm"
        pressed={editor.isActive('underline')}
        onPressedChange={() => editor.chain().focus().toggleUnderline().run()}
        aria-label="밑줄"
      >
        <Underline />
      </Toggle>

      <span className="mx-1 h-5 w-px bg-border" aria-hidden />

      <Toggle
        size="sm"
        pressed={editor.isActive('heading', { level: 2 })}
        onPressedChange={() =>
          editor.chain().focus().toggleHeading({ level: 2 }).run()
        }
        aria-label="제목 2"
      >
        <Heading2 />
      </Toggle>
      <Toggle
        size="sm"
        pressed={editor.isActive('heading', { level: 3 })}
        onPressedChange={() =>
          editor.chain().focus().toggleHeading({ level: 3 }).run()
        }
        aria-label="제목 3"
      >
        <Heading3 />
      </Toggle>

      <span className="mx-1 h-5 w-px bg-border" aria-hidden />

      <Toggle
        size="sm"
        pressed={editor.isActive('bulletList')}
        onPressedChange={() => editor.chain().focus().toggleBulletList().run()}
        aria-label="글머리 기호 목록"
      >
        <List />
      </Toggle>
      <Toggle
        size="sm"
        pressed={editor.isActive('orderedList')}
        onPressedChange={() => editor.chain().focus().toggleOrderedList().run()}
        aria-label="번호 목록"
      >
        <ListOrdered />
      </Toggle>

      <span className="mx-1 h-5 w-px bg-border" aria-hidden />

      <Toggle
        size="sm"
        pressed={editor.isActive('link')}
        onPressedChange={handleLink}
        aria-label="링크"
      >
        <Link2 />
      </Toggle>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-8 min-w-8 px-1.5"
        disabled={!editor.isActive('link')}
        onClick={() => editor.chain().focus().unsetLink().run()}
        aria-label="링크 제거"
      >
        <Link2Off />
      </Button>

      <span className="mx-1 h-5 w-px bg-border" aria-hidden />

      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-8 min-w-8 px-1.5"
        disabled={imageUploading}
        onClick={onImageClick}
        aria-label="이미지 업로드"
      >
        {imageUploading ? <Loader2 className="animate-spin" /> : <ImageIcon />}
      </Button>
    </div>
  );
}
