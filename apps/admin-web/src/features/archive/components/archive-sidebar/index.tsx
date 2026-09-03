'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Search, Star, Trash2, Users, Lock, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils/ui';
import type { ArchivePageNodeDto, ArchiveSpace } from '@/lib/types/dto/archive';
import {
  useArchiveFavorites,
  useArchiveTree,
  useCreateArchivePage,
  useDeleteArchivePage,
  useMoveArchivePage,
} from '@/lib/services/archive';
import {
  buildArchiveTree,
  collectSubtreeIds,
  siblingsOf,
  type ArchiveTreeNode,
} from '../../lib/build-tree';
import { TreeItem, type DropZone, type TreeItemActions } from './tree-item';

type Props = {
  space: ArchiveSpace;
  onSpaceChange: (space: ArchiveSpace) => void;
  activeId: string | undefined;
  expandedIds: Set<string>;
  onToggleExpanded: (id: string) => void;
  onExpand: (ids: string[]) => void;
  onOpenSearch: () => void;
  onOpenTrash: () => void;
};

const SPACES: Array<{
  id: ArchiveSpace;
  label: string;
  icon: typeof Users;
  hint: string;
}> = [
  {
    id: 'team',
    label: '팀 스페이스',
    icon: Users,
    hint: '관리자 모두가 함께 보는 문서',
  },
  { id: 'private', label: '개인 스페이스', icon: Lock, hint: '나만 보는 문서' },
];

export function ArchiveSidebar({
  space,
  onSpaceChange,
  activeId,
  expandedIds,
  onToggleExpanded,
  onExpand,
  onOpenSearch,
  onOpenTrash,
}: Props) {
  const router = useRouter();
  const { data: nodes, isLoading } = useArchiveTree(space);
  const { data: favorites } = useArchiveFavorites();
  const createMutation = useCreateArchivePage();
  const moveMutation = useMoveArchivePage(space);
  const deleteMutation = useDeleteArchivePage(space);

  const flat = useMemo(() => nodes ?? [], [nodes]);
  const tree = useMemo(() => buildArchiveTree(flat), [flat]);

  // 드래그 중인 노드는 렌더 사이에 바뀌지 않아야 하므로 상태가 아니라 ref 로 든다.
  const draggingRef = useRef<{
    node: ArchiveTreeNode;
    subtree: Set<string>;
  } | null>(null);

  const openPage = useCallback(
    (id: string) => router.push(`/archive/${id}`),
    [router]
  );

  const createPage = useCallback(
    async (parentId?: string) => {
      try {
        const page = await createMutation.mutateAsync({ parentId, space });
        if (parentId) onExpand([parentId]);
        openPage(page.id);
      } catch {
        toast.error('페이지를 만들지 못했습니다.');
      }
    },
    [createMutation, onExpand, openPage, space]
  );

  const requestMove = useCallback(
    async (id: string, parentId: string | null, position?: number) => {
      try {
        await moveMutation.mutateAsync({ id, dto: { parentId, position } });
      } catch {
        toast.error('페이지를 옮기지 못했습니다.');
      }
    },
    [moveMutation]
  );

  /** 형제 목록에서 «옮길 페이지를 뺀» 뒤의 위치를 센다 — 서버도 같은 기준으로 끼워 넣는다. */
  const positionAmongSiblings = useCallback(
    (
      movingId: string,
      parentId: string | null,
      anchorId: string,
      after: boolean
    ): number => {
      const siblings = siblingsOf(flat, parentId).filter(
        (sibling) => sibling.id !== movingId
      );
      const index = siblings.findIndex((sibling) => sibling.id === anchorId);
      if (index === -1) return siblings.length;
      return after ? index + 1 : index;
    },
    [flat]
  );

  const actions: TreeItemActions = useMemo(
    () => ({
      onSelect: openPage,
      onToggle: onToggleExpanded,
      onCreateChild: (parentId) => void createPage(parentId),
      onDelete: (node) => {
        deleteMutation.mutate(node.id, {
          onSuccess: () => {
            toast.success('휴지통으로 옮겼습니다.', {
              description: '휴지통에서 되돌릴 수 있어요.',
            });
            if (activeId && collectSubtreeIds(node).has(activeId))
              router.push('/archive');
          },
          onError: () => toast.error('삭제하지 못했습니다.'),
        });
      },
      onMoveStep: (node, direction) => {
        const parentId = node.parentId ?? null;
        const siblings = siblingsOf(flat, parentId);
        const index = siblings.findIndex((sibling) => sibling.id === node.id);
        const next = index + direction;
        if (next < 0 || next >= siblings.length) return;
        void requestMove(node.id, parentId, next);
      },
      onIndent: (node) => {
        const siblings = siblingsOf(flat, node.parentId ?? null);
        const index = siblings.findIndex((sibling) => sibling.id === node.id);
        const previous = siblings[index - 1];
        if (!previous) {
          toast.info('바로 위에 페이지가 있어야 하위로 넣을 수 있어요.');
          return;
        }
        onExpand([previous.id]);
        void requestMove(node.id, previous.id);
      },
      onOutdent: (node) => {
        if (!node.parentId) return;
        const parent = flat.find((item) => item.id === node.parentId);
        if (!parent) return;
        const grandParentId = parent.parentId ?? null;
        void requestMove(
          node.id,
          grandParentId,
          positionAmongSiblings(node.id, grandParentId, parent.id, true)
        );
      },
      onDragStart: (node) => {
        draggingRef.current = { node, subtree: collectSubtreeIds(node) };
      },
      onDragEnd: () => {
        draggingRef.current = null;
      },
      canDropOn: (target) => {
        const dragging = draggingRef.current;
        // 자기 자신이나 자기 하위로는 옮길 수 없다 — 트리가 끊긴다.
        return Boolean(dragging) && !dragging!.subtree.has(target.id);
      },
      onDrop: (target, zone: DropZone) => {
        const dragging = draggingRef.current;
        draggingRef.current = null;
        if (!dragging || dragging.subtree.has(target.id)) return;

        if (zone === 'inside') {
          onExpand([target.id]);
          void requestMove(dragging.node.id, target.id);
          return;
        }

        const parentId = target.parentId ?? null;
        void requestMove(
          dragging.node.id,
          parentId,
          positionAmongSiblings(
            dragging.node.id,
            parentId,
            target.id,
            zone === 'after'
          )
        );
      },
    }),
    [
      activeId,
      createPage,
      deleteMutation,
      flat,
      onExpand,
      onToggleExpanded,
      openPage,
      positionAmongSiblings,
      requestMove,
      router,
    ]
  );

  return (
    <aside className="flex h-full w-72 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground">
      <div className="space-y-2 p-3">
        <div className="grid grid-cols-2 gap-1 rounded-md bg-sidebar-accent/40 p-1">
          {SPACES.map((option) => {
            const Icon = option.icon;
            const selected = option.id === space;
            return (
              <button
                key={option.id}
                type="button"
                title={option.hint}
                aria-pressed={selected}
                onClick={() => onSpaceChange(option.id)}
                className={cn(
                  'flex h-8 items-center justify-center gap-1.5 rounded text-xs font-medium transition-colors duration-150',
                  selected
                    ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                    : 'text-sidebar-foreground/70 hover:text-sidebar-foreground'
                )}
              >
                <Icon className="size-3.5" aria-hidden />
                {option.label}
              </button>
            );
          })}
        </div>

        <button
          type="button"
          onClick={onOpenSearch}
          className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-sm text-sidebar-foreground/70 transition-colors duration-150 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground"
        >
          <Search className="size-3.5" aria-hidden />
          <span className="flex-1 text-left">검색</span>
          <kbd className="rounded border border-sidebar-border px-1 text-[10px] leading-4">
            Ctrl K
          </kbd>
        </button>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="px-3 pb-4">
          <FavoriteSection
            favorites={favorites ?? []}
            activeId={activeId}
            onSelect={openPage}
          />

          <SectionLabel>페이지</SectionLabel>
          {isLoading ? (
            <div className="space-y-2 px-2 py-1">
              <Skeleton className="h-5 w-4/5 bg-sidebar-accent" />
              <Skeleton className="h-5 w-3/5 bg-sidebar-accent" />
              <Skeleton className="h-5 w-2/3 bg-sidebar-accent" />
            </div>
          ) : tree.length === 0 ? (
            <p className="px-2 py-6 text-center text-xs leading-5 text-sidebar-foreground/60">
              아직 페이지가 없어요.
              <br />
              아래 «새 페이지»로 시작해 보세요.
            </p>
          ) : (
            <ul
              role="tree"
              aria-label={`${space === 'team' ? '팀' : '개인'} 스페이스 페이지 목록`}
            >
              {tree.map((node) => (
                <TreeItem
                  key={node.id}
                  node={node}
                  depth={0}
                  activeId={activeId}
                  expandedIds={expandedIds}
                  actions={actions}
                />
              ))}
            </ul>
          )}
        </div>
      </ScrollArea>

      <div className="space-y-1 border-t border-sidebar-border p-3">
        <Button
          type="button"
          variant="ghost"
          disabled={createMutation.isPending}
          onClick={() => void createPage()}
          className="h-8 w-full justify-start gap-2 px-2 text-sm text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
        >
          {createMutation.isPending ? (
            <Loader2 className="size-3.5 animate-spin" aria-hidden />
          ) : (
            <Plus className="size-3.5" aria-hidden />
          )}
          새 페이지
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={onOpenTrash}
          className="h-8 w-full justify-start gap-2 px-2 text-sm text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
        >
          <Trash2 className="size-3.5" aria-hidden />
          휴지통
        </Button>
      </div>
    </aside>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="px-2 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wide text-sidebar-foreground/50">
      {children}
    </h2>
  );
}

function FavoriteSection({
  favorites,
  activeId,
  onSelect,
}: {
  favorites: ArchivePageNodeDto[];
  activeId: string | undefined;
  onSelect: (id: string) => void;
}) {
  if (favorites.length === 0) return null;

  return (
    <>
      <SectionLabel>즐겨찾기</SectionLabel>
      <ul>
        {favorites.map((page) => (
          <li key={page.id}>
            <button
              type="button"
              onClick={() => onSelect(page.id)}
              className={cn(
                'flex h-8 w-full items-center gap-2 rounded-md px-2 text-sm transition-colors duration-150',
                page.id === activeId
                  ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                  : 'hover:bg-sidebar-accent/60'
              )}
            >
              <span className="flex size-5 shrink-0 items-center justify-center text-base leading-none">
                {page.icon ? (
                  page.icon
                ) : (
                  <Star className="size-3.5 opacity-60" aria-hidden />
                )}
              </span>
              <span className="min-w-0 flex-1 truncate text-left">
                {page.title || '제목 없음'}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}
