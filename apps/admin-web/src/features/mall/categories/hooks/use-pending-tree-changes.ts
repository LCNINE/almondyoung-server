'use client';

import { useCallback, useMemo, useState } from 'react';
import { useMoveCategory, useReorderCategories } from '@/lib/services/products/mutations';
import {
  type CategoryNode,
  parentKeyOf,
} from '../tree-state';
import { EMPTY_PENDING, type PendingTreeChanges } from '../types';

export type DropPlacement = 'before' | 'after' | 'into';

interface ApplyDropArgs {
  draggedId: string;
  targetId: string;
  placement: DropPlacement;
  /** 펜딩이 적용된 현재 트리 뷰 (root 노드 배열). */
  tree: CategoryNode[];
}

/**
 * pendingReorder 패턴: 드래그 결과를 즉시 서버에 보내지 않고 누적했다가
 * 사용자가 명시적으로 "변경사항 저장" 을 눌렀을 때 일괄 commit 한다.
 * 가드(Q5 의 트리 펜딩 가드)와 상단 띠는 이 훅의 상태를 본다.
 */
export function usePendingTreeChanges(tree: CategoryNode[]) {
  const [pending, setPending] = useState<PendingTreeChanges>(EMPTY_PENDING);
  const moveMutation = useMoveCategory();
  const reorderMutation = useReorderCategories();

  const hasPending = useMemo(
    () =>
      Object.keys(pending.parentMoves).length > 0 ||
      Object.keys(pending.siblingOrders).length > 0,
    [pending],
  );

  const pendingCount = useMemo(() => {
    const moves = Object.keys(pending.parentMoves).length;
    const reorders = Object.keys(pending.siblingOrders).length;
    return moves + reorders;
  }, [pending]);

  const applyDrop = useCallback((args: ApplyDropArgs) => {
    setPending((prev) => applyDropToPending(prev, args));
  }, []);

  const revert = useCallback(() => setPending(EMPTY_PENDING), []);

  const commit = useCallback(async () => {
    // 1) 부모 변경 — 순서가 중요하지 않으므로 병렬 안전.
    const moves = Object.entries(pending.parentMoves);
    for (const [id, newParentId] of moves) {
      await moveMutation.mutateAsync({
        id,
        newParentId: newParentId ?? undefined,
      });
    }

    // 2) 부모별 reorder — 부모 변경 이후 새 부모의 자식 순서를 확정한다.
    const reorders = Object.entries(pending.siblingOrders);
    for (const [parentKey, ids] of reorders) {
      await reorderMutation.mutateAsync({
        parentId: parentKey === 'root' ? null : parentKey,
        categoryIds: ids,
      });
    }

    setPending(EMPTY_PENDING);
  }, [pending, moveMutation, reorderMutation]);

  return {
    pending,
    hasPending,
    pendingCount,
    applyDrop,
    revert,
    commit,
    isCommitting: moveMutation.isPending || reorderMutation.isPending,
  };
}

function applyDropToPending(
  prev: PendingTreeChanges,
  { draggedId, targetId, placement, tree }: ApplyDropArgs,
): PendingTreeChanges {
  const dragged = findInTree(tree, draggedId);
  const target = findInTree(tree, targetId);
  if (!dragged || !target) return prev;

  const oldParentKey = parentKeyOf(dragged.parentId);
  const newParentId = placement === 'into' ? target.id : target.parentId;
  const newParentKey = parentKeyOf(newParentId);

  const parentMoves = { ...prev.parentMoves };
  if (newParentId !== dragged.parentId) {
    parentMoves[draggedId] = newParentId;
  } else {
    delete parentMoves[draggedId];
  }

  const siblingOrders = { ...prev.siblingOrders };

  const oldSiblings = currentChildrenIds(tree, dragged.parentId).filter(
    (id) => id !== draggedId,
  );
  if (oldParentKey !== newParentKey) {
    siblingOrders[oldParentKey] = oldSiblings;
  }

  const newSiblings = currentChildrenIds(tree, newParentId).filter(
    (id) => id !== draggedId,
  );
  let insertAt: number;
  if (placement === 'into') {
    insertAt = newSiblings.length;
  } else {
    const targetIdx = newSiblings.indexOf(targetId);
    insertAt = placement === 'before' ? targetIdx : targetIdx + 1;
  }
  newSiblings.splice(insertAt, 0, draggedId);
  siblingOrders[newParentKey] = newSiblings;

  return { parentMoves, siblingOrders };
}

function findInTree(nodes: CategoryNode[], id: string): CategoryNode | undefined {
  for (const n of nodes) {
    if (n.id === id) return n;
    const found = findInTree(n.children, id);
    if (found) return found;
  }
  return undefined;
}

function currentChildrenIds(tree: CategoryNode[], parentId: string | null): string[] {
  if (parentId === null) return tree.map((n) => n.id);
  const parent = findInTree(tree, parentId);
  return parent ? parent.children.map((n) => n.id) : [];
}
