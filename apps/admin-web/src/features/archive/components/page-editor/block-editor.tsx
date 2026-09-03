'use client';

import '@blocknote/shadcn/style.css';
import './block-editor.css';

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { FileText } from 'lucide-react';
import { toast } from 'sonner';
import { BlockNoteView } from '@blocknote/shadcn';
import {
  SuggestionMenuController,
  getDefaultReactSlashMenuItems,
  useCreateBlockNote,
  type DefaultReactSuggestionItem,
} from '@blocknote/react';
import {
  BlockNoteSchema,
  defaultBlockSpecs,
  filterSuggestionItems,
  insertOrUpdateBlockForSlashMenu,
} from '@blocknote/core';
import { ko } from '@blocknote/core/locales';
import {
  ARCHIVE_PAGE_IMAGE_CONTEXT_ID,
  uploadRichTextImage,
} from '@/lib/api/domains/files/upload.client';
import { useCreateArchivePage } from '@/lib/services/archive';
import type { ArchiveBlock, ArchiveSpace } from '@/lib/types/dto/archive';
import {
  ArchiveEditorScopeProvider,
  SUB_PAGE_BLOCK_TYPE,
  createSubPageBlockSpec,
} from './sub-page-block';

/**
 * 본문 안에 하위 페이지를 박을 수 있어야 노션 자료를 그대로 받을 수 있다 — 노션은
 * 하위 페이지가 부모 «본문의 블록»이라, 이 블록이 없으면 목차 문서가 통째로 끊긴다.
 * 스키마는 컴포넌트 밖에서 한 번만 만든다. 렌더마다 새로 만들면 편집기가 매번 갈린다.
 */
const archiveSchema = BlockNoteSchema.create({
  blockSpecs: {
    ...defaultBlockSpecs,
    [SUB_PAGE_BLOCK_TYPE]: createSubPageBlockSpec(),
  },
});

type ArchiveBlockType = typeof archiveSchema.Block;
type ArchivePartialBlock = typeof archiveSchema.PartialBlock;

/** 슬래시 메뉴에서 문단·목록이 들어가는 묶음. 한국어 사전(`ko`)이 쓰는 이름과 같아야 한다. */
const BASIC_BLOCK_GROUP = ko.slash_menu.paragraph.group;

/** 타이핑이 멈춘 뒤 저장까지 기다리는 시간. 노션도 이 정도 간격으로 올린다. */
const AUTOSAVE_DEBOUNCE_MS = 800;

type Props = {
  /** 페이지가 바뀌면 편집기를 새로 만들어야 하므로 key 로도 쓴다. */
  pageId: string;
  /** 하위 페이지 블록이 만들 자식은 이 스페이스에 들어간다(서버가 부모를 따라 정한다). */
  space: ArchiveSpace;
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
  space,
  initialContent,
  onSave,
  onLeave,
  onDirtyChange,
  editable = true,
}: Props) {
  // 빈 문서를 그대로 넘기면 편집기가 커서를 놓을 곳이 없다.
  const startContent = useMemo<ArchivePartialBlock[] | undefined>(
    () =>
      initialContent.length > 0
        ? (initialContent as ArchivePartialBlock[])
        : undefined,
    [initialContent]
  );

  const editor = useCreateBlockNote(
    {
      schema: archiveSchema,
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

  const createPage = useCreateArchivePage();
  const scope = useMemo(() => ({ pageId, space }), [pageId, space]);

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

    const blocks: ArchiveBlockType[] = editor.document;
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
        const blocks: ArchiveBlockType[] = editor.document;
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

  // 「하위 페이지」를 고르면 그 자리에서 자식 문서를 만든다. 만들기는 비동기라 블록을 먼저
  // 비워 둔 채 꽂고, id 가 오면 채운다 — 실패하면 꽂았던 블록을 도로 걷어낸다.
  const insertSubPage = useCallback(() => {
    const block = insertOrUpdateBlockForSlashMenu(editor, {
      type: SUB_PAGE_BLOCK_TYPE,
      props: { pageId: '' },
    });

    createPage
      .mutateAsync({ parentId: pageId, space })
      .then((created) => {
        editor.updateBlock(block, {
          type: SUB_PAGE_BLOCK_TYPE,
          props: { pageId: created.id },
        });
        // 블록만 바뀌면 onChange 가 도니 자동저장이 따라온다. 즉시 저장해 새로고침에도 남게 한다.
        flush();
      })
      .catch(() => {
        editor.removeBlocks([block]);
        toast.error('하위 페이지를 만들지 못했습니다.');
      });
  }, [createPage, editor, flush, pageId, space]);

  const slashItems = useCallback(
    (query: string): Promise<DefaultReactSuggestionItem[]> => {
      const items = getDefaultReactSlashMenuItems(editor);
      const subPageItem: DefaultReactSuggestionItem = {
        title: '하위 페이지',
        subtext: '이 문서 안에 새 문서를 만들고 링크로 둔다',
        aliases: ['subpage', 'page', '페이지', '하위문서', '하위페이지'],
        group: BASIC_BLOCK_GROUP,
        icon: <FileText className="size-4" />,
        onItemClick: insertSubPage,
      };

      // 메뉴는 «연속된 같은 group» 을 한 덩어리로 묶는다. 뒤에 그냥 붙이면 같은 이름의
      // 머리글이 두 번 나오므로, 기존 「기본 블록」 덩어리의 끝에 끼워 넣는다.
      const lastBasic = items
        .map((item) => item.group)
        .lastIndexOf(BASIC_BLOCK_GROUP);
      const merged =
        lastBasic === -1
          ? [...items, subPageItem]
          : [
              ...items.slice(0, lastBasic + 1),
              subPageItem,
              ...items.slice(lastBasic + 1),
            ];

      return Promise.resolve(filterSuggestionItems(merged, query));
    },
    [editor, insertSubPage]
  );

  return (
    <ArchiveEditorScopeProvider value={scope}>
      <BlockNoteView
        editor={editor}
        editable={editable}
        onChange={handleChange}
        theme="light"
        className="archive-block-editor"
        slashMenu={false}
      >
        <SuggestionMenuController triggerCharacter="/" getItems={slashItems} />
      </BlockNoteView>
    </ArchiveEditorScopeProvider>
  );
}
