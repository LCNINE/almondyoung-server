'use client';

import { createContext, useContext, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { FileText, Trash2, CornerUpRight, HelpCircle } from 'lucide-react';
import { createReactBlockSpec } from '@blocknote/react';
import { useArchiveTree, useArchiveTrash } from '@/lib/services/archive';
import type { ArchiveSpace } from '@/lib/types/dto/archive';

export const SUB_PAGE_BLOCK_TYPE = 'subPage';

/**
 * 블록이 «어느 문서의 본문에 있는지»를 알아야 «다른 위치로 옮겨졌다»를 판정할 수 있다.
 * 편집기는 그걸 모르므로 화면이 컨텍스트로 내려 준다. 없으면 판정만 생략하고 나머지는 그대로 그린다.
 */
type ArchiveEditorScope = { pageId: string; space: ArchiveSpace };

const ArchiveEditorContext = createContext<ArchiveEditorScope | null>(null);

export const ArchiveEditorScopeProvider = ArchiveEditorContext.Provider;

export function useArchiveEditorScope(): ArchiveEditorScope | null {
  return useContext(ArchiveEditorContext);
}

/**
 * 마크다운 내보내기 전용 제목 캐시. 하위 페이지 블록과 인라인 페이지 링크가 같이 쓴다.
 *
 * 문서 참조는 `pageId` 만 저장한다 — 제목을 저장하면 원본이 바뀔 때 어긋나기 때문이다.
 * 그런데 `toExternalHTML` 은 동기 함수라 그 자리에서 제목을 조회할 수 없다. 그래서
 * 화면이 제목을 해석할 때마다 여기에 적어 두고, 내보내기는 그 값을 «있으면» 쓴다.
 * 문서(DB)에는 들어가지 않으므로 낡은 제목이 굳는 일은 없고, 캐시가 비어 있으면
 * 링크 라벨이 id 로 떨어질 뿐 링크 자체는 온전하다.
 */
export const archivePageTitleCache = new Map<string, string>();

export type ResolvedArchiveTarget =
  | { state: 'loading' }
  | { state: 'ok'; title: string; icon: string | null; moved: boolean }
  | { state: 'trashed'; title: string; icon: string | null }
  | { state: 'missing' };

/**
 * 하위 페이지 블록이 가리키는 문서의 현재 상태.
 *
 * 트리 캐시가 1차 출처다 — 사이드바가 이미 받아 둔 것이라 추가 요청이 없다.
 * 트리에 없으면 휴지통을 확인하고(그때만 요청한다), 거기에도 없으면 «찾을 수 없음»이다.
 */
export function useSubPageTarget(
  pageId: string,
  hostPageId?: string,
  space?: ArchiveSpace
): ResolvedArchiveTarget {
  const { data: nodes, isLoading: treeLoading } = useArchiveTree(
    space ?? 'team'
  );

  const node = useMemo(
    () =>
      pageId ? nodes?.find((candidate) => candidate.id === pageId) : undefined,
    [nodes, pageId]
  );

  // 트리에서 못 찾았을 때만 휴지통을 본다. 정상 문서만 있는 화면에서는 요청이 아예 안 나간다.
  const needsTrash = Boolean(pageId) && !treeLoading && !node;
  const { data: trash, isLoading: trashLoading } = useArchiveTrash(needsTrash);

  if (!pageId) return { state: 'loading' };
  if (node) {
    return {
      state: 'ok',
      title: node.title,
      icon: node.icon,
      moved: Boolean(hostPageId) && node.parentId !== hostPageId,
    };
  }
  if (treeLoading || (needsTrash && trashLoading)) return { state: 'loading' };

  const trashed = trash?.find((item) => item.id === pageId);
  if (trashed)
    return { state: 'trashed', title: trashed.title, icon: trashed.icon };

  return { state: 'missing' };
}

function SubPageBlockView({ pageId }: { pageId: string }) {
  const router = useRouter();
  const scope = useArchiveEditorScope();
  const target = useSubPageTarget(pageId, scope?.pageId, scope?.space);

  if (target.state === 'ok')
    archivePageTitleCache.set(pageId, target.title || '제목 없음');

  if (target.state === 'loading') {
    return (
      <span
        className="archive-sub-page archive-sub-page--muted"
        aria-busy="true"
      >
        <FileText className="size-4 shrink-0" aria-hidden />
        <span className="truncate">문서를 불러오는 중…</span>
      </span>
    );
  }

  if (target.state === 'trashed') {
    return (
      <span className="archive-sub-page archive-sub-page--muted">
        <Trash2 className="size-4 shrink-0" aria-hidden />
        <span className="truncate line-through">
          {target.title || '제목 없음'}
        </span>
        <span className="archive-sub-page__badge">지워진 문서</span>
      </span>
    );
  }

  if (target.state === 'missing') {
    return (
      <span className="archive-sub-page archive-sub-page--muted">
        <HelpCircle className="size-4 shrink-0" aria-hidden />
        <span className="truncate">찾을 수 없는 문서</span>
      </span>
    );
  }

  const label = target.title || '제목 없음';

  return (
    <button
      type="button"
      className="archive-sub-page archive-sub-page--link"
      onClick={() => router.push(`/archive/${pageId}`)}
    >
      {target.icon ? (
        <span className="size-4 shrink-0 text-center leading-4" aria-hidden>
          {target.icon}
        </span>
      ) : (
        <FileText className="size-4 shrink-0" aria-hidden />
      )}
      <span className="truncate">{label}</span>
      {target.moved && (
        <span className="archive-sub-page__badge">
          <CornerUpRight className="size-3" aria-hidden />
          다른 위치
        </span>
      )}
    </button>
  );
}

export const createSubPageBlockSpec = createReactBlockSpec(
  {
    type: SUB_PAGE_BLOCK_TYPE,
    propSchema: { pageId: { default: '' } },
    content: 'none',
  },
  {
    render: ({ block }) => <SubPageBlockView pageId={block.props.pageId} />,
    // 마크다운 파생은 이 HTML 을 거쳐 만들어진다(blocksToMarkdownLossy → 외부 HTML → 마크다운).
    // 라벨이 없으면 링크가 통째로 사라지는 게 아니라 id 로 떨어진다.
    toExternalHTML: ({ block }) => {
      const { pageId } = block.props;
      return (
        <a href={`/archive/${pageId}`}>
          {archivePageTitleCache.get(pageId) ?? pageId}
        </a>
      );
    },
  }
);
