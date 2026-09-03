'use client';

import '@blocknote/shadcn/style.css';
import './block-editor.css';

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { BlockNoteView } from '@blocknote/shadcn';
import { useCreateBlockNote } from '@blocknote/react';
import type { Block, PartialBlock } from '@blocknote/core';
import { ko } from '@blocknote/core/locales';
import {
  ARCHIVE_PAGE_IMAGE_CONTEXT_ID,
  uploadRichTextImage,
} from '@/lib/api/domains/files/upload.client';
import type { ArchiveBlock } from '@/lib/types/dto/archive';

/** 타이핑이 멈춘 뒤 저장까지 기다리는 시간. 노션도 이 정도 간격으로 올린다. */
const AUTOSAVE_DEBOUNCE_MS = 800;

type Props = {
  /** 페이지가 바뀌면 편집기를 새로 만들어야 하므로 key 로도 쓴다. */
  pageId: string;
  initialContent: ArchiveBlock[];
  /** 마크다운은 정본이 아니라 파생 — 저장할 때 같이 올려 내보내기·검색에 쓴다. */
  onSave: (payload: { content: ArchiveBlock[]; markdown: string }) => void;
  /** 화면이 사라지는 순간의 저장. 훅 수명에 기대지 않는 경로를 부모가 준다. */
  onLeave: (payload: { content: ArchiveBlock[]; markdown: string }) => void;
  onDirtyChange: (dirty: boolean) => void;
  editable?: boolean;
};

export default function BlockEditor({
  pageId,
  initialContent,
  onSave,
  onLeave,
  onDirtyChange,
  editable = true,
}: Props) {
  // 빈 문서를 그대로 넘기면 편집기가 커서를 놓을 곳이 없다.
  const startContent = useMemo<PartialBlock[] | undefined>(
    () =>
      initialContent.length > 0
        ? (initialContent as PartialBlock[])
        : undefined,
    [initialContent]
  );

  const editor = useCreateBlockNote(
    {
      initialContent: startContent,
      dictionary: ko,
      uploadFile: async (file: File) => {
        const { url } = await uploadRichTextImage(
          file,
          ARCHIVE_PAGE_IMAGE_CONTEXT_ID
        );
        return url;
      },
    },
    [pageId]
  );

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 최신 콜백을 ref 로 들고 있어야 debounce 타이머가 낡은 클로저를 붙잡지 않는다.
  const saveRef = useRef(onSave);
  saveRef.current = onSave;
  const dirtyRef = useRef(onDirtyChange);
  dirtyRef.current = onDirtyChange;
  const leaveRef = useRef(onLeave);
  leaveRef.current = onLeave;

  const flush = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    const blocks = editor.document as Block[];
    saveRef.current({
      content: blocks as unknown as ArchiveBlock[],
      markdown: editor.blocksToMarkdownLossy(blocks),
    });
  }, [editor]);

  const handleChange = useCallback(() => {
    dirtyRef.current(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(flush, AUTOSAVE_DEBOUNCE_MS);
  }, [flush]);

  // 페이지를 떠날 때 대기 중인 저장을 흘려보낸다 — 안 하면 마지막 문장이 사라진다.
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
        const blocks = editor.document as Block[];
        leaveRef.current({
          content: blocks as unknown as ArchiveBlock[],
          markdown: editor.blocksToMarkdownLossy(blocks),
        });
      }
    };
  }, [editor]);

  // 탭을 닫거나 새로고침할 때도 마찬가지. 브라우저는 여기서 비동기 완료를 기다려 주지 않으므로
  // 저장을 시작시키고 경고를 띄우는 것까지가 할 수 있는 전부다.
  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!timerRef.current) return;
      flush();
      event.preventDefault();
    };

    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [flush]);

  return (
    <BlockNoteView
      editor={editor}
      editable={editable}
      onChange={handleChange}
      theme="light"
      className="archive-block-editor"
    />
  );
}
