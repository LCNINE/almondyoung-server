'use client';

import { useMemo } from 'react';
import { Plus, Search, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useCategoryDrag } from '../../hooks/use-category-drag';
import { useTreeExpansion } from '../../hooks/use-tree-expansion';
import { usePendingTreeChanges } from '../../hooks/use-pending-tree-changes';
import type { CategoryNode } from '../../tree-state';
import { TreeNode } from './tree-node';
import { cn } from '@/lib/utils/ui';

interface Props {
  tree: CategoryNode[];
  isLoading: boolean;
  selectedId: string | null;
  search: string;
  onSearchChange: (q: string) => void;
  onSelect: (id: string) => void;
  onAddRoot: () => void;
  onAddChild: (parentId: string) => void;
  pending: ReturnType<typeof usePendingTreeChanges>;
}

export function CategoryTreePane({
  tree,
  isLoading,
  selectedId,
  search,
  onSearchChange,
  onSelect,
  onAddRoot,
  onAddChild,
  pending,
}: Props) {
  const { effectiveExpanded, matchedIds, toggleExpand } = useTreeExpansion(tree, search);

  const drag = useCategoryDrag({
    tree,
    onDrop: ({ draggedId, targetId, placement }) =>
      pending.applyDrop({ draggedId, targetId, placement, tree }),
  });

  const dragProps = useMemo(
    () => (node: CategoryNode) => ({
      draggable: true,
      onDragStart: (e: React.DragEvent<HTMLDivElement>) => drag.onDragStart(e, node),
      onDragOver: (e: React.DragEvent<HTMLDivElement>) => drag.onDragOver(e, node),
      onDragLeave: drag.onDragLeave,
      onDrop: (e: React.DragEvent<HTMLDivElement>) => drag.onDropNode(e, node),
      onDragEnd: drag.onDragEnd,
    }),
    [drag],
  );

  const totalCount = useMemo(() => countNodes(tree), [tree]);
  const activeCount = useMemo(() => countActive(tree), [tree]);

  return (
    <div className="flex h-full flex-col border-r">
      <div className="flex items-center justify-between gap-2 border-b p-3">
        <div className="text-sm font-medium">
          카테고리
          <span className="ml-2 text-xs text-muted-foreground">
            전체 {totalCount} · 활성 {activeCount}
          </span>
        </div>
        <Button size="sm" variant="outline" onClick={onAddRoot}>
          <Plus className="mr-1 h-3.5 w-3.5" /> 최상위 추가
        </Button>
      </div>

      <div className="border-b p-2">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="이름·슬러그·설명 검색"
            className="h-8 pl-8 text-sm"
          />
        </div>
      </div>

      {pending.hasPending && (
        <div className="flex items-center justify-between gap-2 border-b bg-yellow-50 px-3 py-2 text-xs dark:bg-yellow-900/20">
          <span>변경사항 {pending.pendingCount}건 (저장하지 않음)</span>
          <div className="flex gap-1">
            <Button
              size="sm"
              variant="ghost"
              onClick={pending.revert}
              disabled={pending.isCommitting}
            >
              취소
            </Button>
            <Button
              size="sm"
              onClick={() => void pending.commit()}
              disabled={pending.isCommitting}
            >
              {pending.isCommitting && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
              저장
            </Button>
          </div>
        </div>
      )}

      <div
        className={cn('flex-1 overflow-auto', isLoading && 'opacity-60')}
        role="tree"
      >
        {isLoading && tree.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> 불러오는 중
          </div>
        ) : tree.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-sm text-muted-foreground">
            <p>아직 카테고리가 없습니다.</p>
            <Button size="sm" variant="outline" onClick={onAddRoot}>
              <Plus className="mr-1 h-3.5 w-3.5" /> 첫 카테고리 만들기
            </Button>
          </div>
        ) : (
          tree.map((node) => (
            <TreeNode
              key={node.id}
              node={node}
              depth={0}
              selectedId={selectedId}
              effectiveExpanded={effectiveExpanded}
              matchedIds={matchedIds}
              search={search}
              dragState={drag.state}
              onToggleExpand={toggleExpand}
              onSelect={onSelect}
              onAddChild={onAddChild}
              dragProps={dragProps}
            />
          ))
        )}
      </div>
    </div>
  );
}

function countNodes(nodes: CategoryNode[]): number {
  let n = 0;
  for (const node of nodes) n += 1 + countNodes(node.children);
  return n;
}

function countActive(nodes: CategoryNode[]): number {
  let n = 0;
  for (const node of nodes) {
    if (node.isActive) n++;
    n += countActive(node.children);
  }
  return n;
}
