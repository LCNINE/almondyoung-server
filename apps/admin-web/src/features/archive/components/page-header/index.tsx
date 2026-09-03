'use client';

import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { ImagePlus, Loader2, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  ARCHIVE_PAGE_IMAGE_CONTEXT_ID,
  uploadRichTextImage,
} from '@/lib/api/domains/files/upload.client';
import { IconPicker } from './icon-picker';

type Props = {
  title: string;
  icon: string | null;
  coverUrl: string | null;
  onTitleChange: (title: string) => void;
  onTitleBlur: () => void;
  onIconChange: (icon: string | null) => void;
  onCoverChange: (coverUrl: string | null) => void;
};

export function PageHeader({
  title,
  icon,
  coverUrl,
  onTitleChange,
  onTitleBlur,
  onIconChange,
  onCoverChange,
}: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const [uploading, setUploading] = useState(false);

  // 제목은 여러 줄이 될 수 있으니 내용에 맞춰 높이를 잡는다(스크롤바가 생기면 안 된다).
  useEffect(() => {
    const element = titleRef.current;
    if (!element) return;
    element.style.height = 'auto';
    element.style.height = `${element.scrollHeight}px`;
  }, [title]);

  const handleCoverFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    setUploading(true);
    try {
      const { url } = await uploadRichTextImage(
        file,
        ARCHIVE_PAGE_IMAGE_CONTEXT_ID
      );
      onCoverChange(url);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : '커버 이미지를 올리지 못했습니다.'
      );
    } finally {
      setUploading(false);
    }
  };

  return (
    <header>
      {coverUrl ? (
        <div className="group relative h-48 w-full overflow-hidden bg-muted">
          {/* 커버는 장식이라 alt 를 비워 보조기술이 건너뛰게 한다. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={coverUrl} alt="" className="size-full object-cover" />
          <div className="absolute right-4 top-4 flex gap-1 opacity-0 transition-opacity duration-150 group-hover:opacity-100 focus-within:opacity-100">
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => fileRef.current?.click()}
            >
              커버 바꾸기
            </Button>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              aria-label="커버 없애기"
              onClick={() => onCoverChange(null)}
            >
              <X className="size-4" aria-hidden />
            </Button>
          </div>
        </div>
      ) : null}

      <div className="mx-auto max-w-3xl px-6 pt-8">
        <div className="group/actions flex min-h-9 items-center gap-1">
          <IconPicker icon={icon} onChange={onIconChange} />
          {coverUrl ? null : (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={uploading}
              onClick={() => fileRef.current?.click()}
              className="gap-1.5 text-muted-foreground opacity-0 transition-opacity duration-150 group-hover/actions:opacity-100 focus-visible:opacity-100"
            >
              {uploading ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <ImagePlus className="size-4" aria-hidden />
              )}
              커버 추가
            </Button>
          )}
        </div>

        <textarea
          ref={titleRef}
          value={title}
          rows={1}
          spellCheck={false}
          placeholder="제목 없음"
          aria-label="문서 제목"
          onChange={(event) =>
            onTitleChange(event.target.value.replace(/\n/g, ''))
          }
          onBlur={onTitleBlur}
          onKeyDown={(event) => {
            // 제목에서 엔터를 치면 본문으로 넘어가는 게 자연스럽다.
            if (event.key === 'Enter') {
              event.preventDefault();
              const editor = document.querySelector<HTMLElement>(
                '.archive-block-editor [contenteditable="true"]'
              );
              editor?.focus();
            }
          }}
          className="mt-2 w-full resize-none overflow-hidden rounded-sm border-0 bg-transparent p-0 text-4xl font-bold leading-tight tracking-tight text-balance outline-none placeholder:text-muted-foreground/40 focus-visible:ring-1 focus-visible:ring-ring/30"
        />
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(event) => void handleCoverFile(event)}
      />
    </header>
  );
}
