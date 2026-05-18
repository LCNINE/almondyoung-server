'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useCategoryTree } from '@/lib/services/products/queries';
import { useCategorySelection } from '../hooks/use-category-selection';
import { usePendingTreeChanges } from '../hooks/use-pending-tree-changes';
import { buildPendingTree } from '../tree-state';
import { CategoryTreePane } from '../components/tree';
import { CategoryDetailPanel } from '../components/detail-panel';
import { CategoryDeleteDialog } from '../components/delete-dialog';

const DIRTY_PROMPT = '저장하지 않은 변경이 있습니다. 그래도 진행할까요?';

export default function MallCategoriesTemplate() {
  const { data, isLoading } = useCategoryTree({ includeInactive: true });
  const { mode, select, startCreate, clear } = useCategorySelection();

  const [formDirty, setFormDirty] = useState(false);
  const [search, setSearch] = useState('');
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const tree = useMemo(() => {
    if (!data?.categories) return [];
    // pending 은 아래 훅에서 계산되지만 buildPendingTree 는 pending 입력이 필요하므로
    // 두 단계로 나눠 호출한다 — pending 은 tree 를 인자로 받고, tree 는 pending 으로
    // 빌드되어 서로 참조한다. 첫 렌더는 EMPTY_PENDING 으로 빌드된 형태.
    return data.categories;
  }, [data]);

  // pending hook 은 빌드된 트리(노드 단위)를 보고 드롭 좌표를 해석한다.
  // 입력으로는 "현재 화면에 보이는 트리" 가 필요하므로 한 번 더 buildPendingTree 한다.
  const pendingHookHost = useMemo(
    () => buildPendingTree(tree, { parentMoves: {}, siblingOrders: {} }),
    [tree],
  );
  const pending = usePendingTreeChanges(pendingHookHost);
  const viewTree = useMemo(
    () => buildPendingTree(tree, pending.pending),
    [tree, pending.pending],
  );

  // 페이지 이탈 가드 (브라우저 새로고침/닫기/주소 변경)
  useEffect(() => {
    if (!formDirty && !pending.hasPending) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [formDirty, pending.hasPending]);

  // 폼 dirty 일 때 선택 변경 가드. 트리 펜딩은 페이지 내에서 보존되므로 가드 대상 아님.
  const guardedTransition = useCallback(
    (action: () => void) => {
      if (!formDirty || window.confirm(DIRTY_PROMPT)) {
        setFormDirty(false);
        action();
      }
    },
    [formDirty],
  );

  const onSelect = useCallback(
    (id: string) => guardedTransition(() => select(id)),
    [guardedTransition, select],
  );
  const onAddRoot = useCallback(
    () => guardedTransition(() => startCreate(null)),
    [guardedTransition, startCreate],
  );
  const onAddChild = useCallback(
    (parentId: string) => guardedTransition(() => startCreate(parentId)),
    [guardedTransition, startCreate],
  );

  const selectedId =
    mode.kind === 'selected' ? mode.id : null;

  return (
    <div className="flex h-[calc(100vh-120px)] min-h-[600px] overflow-hidden rounded-md border bg-background">
      <div className="w-[360px] shrink-0">
        <CategoryTreePane
          tree={viewTree}
          isLoading={isLoading}
          selectedId={selectedId}
          search={search}
          onSearchChange={setSearch}
          onSelect={onSelect}
          onAddRoot={onAddRoot}
          onAddChild={onAddChild}
          pending={pending}
        />
      </div>
      <div className="flex-1 overflow-hidden">
        <CategoryDetailPanel
          mode={mode}
          onAfterCreate={(id) => {
            setFormDirty(false);
            select(id);
          }}
          onAfterDelete={() => {
            setFormDirty(false);
            clear();
          }}
          onDirtyChange={setFormDirty}
          onRequestDelete={setDeleteId}
        />
      </div>

      <CategoryDeleteDialog
        categoryId={deleteId}
        tree={viewTree}
        onOpenChange={(open) => !open && setDeleteId(null)}
        onDeleted={() => {
          setFormDirty(false);
          clear();
        }}
      />
    </div>
  );
}
