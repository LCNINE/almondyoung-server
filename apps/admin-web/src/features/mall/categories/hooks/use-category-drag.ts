'use client';

import { useCallback, useRef, useState } from 'react';
import {
  type CategoryNode,
  descendantIdsOf,
  findNode,
} from '../tree-state';
import type { DropPlacement } from './use-pending-tree-changes';

export interface DragState {
  draggedId: string | null;
  overId: string | null;
  placement: DropPlacement | null;
}

const EMPTY: DragState = { draggedId: null, overId: null, placement: null };

interface UseCategoryDragArgs {
  tree: CategoryNode[];
  onDrop: (args: {
    draggedId: string;
    targetId: string;
    placement: DropPlacement;
  }) => void;
}

/**
 * 트리 노드 드래그. 정확히 세 갈래 placement 를 지원한다:
 *
 *   - `before` (노드 윗쪽 25%) : 같은 부모의 형제로 앞에 끼움
 *   - `after`  (노드 아랫쪽 25%): 같은 부모의 형제로 뒤에 끼움
 *   - `into`   (가운데 50%)    : 그 노드의 마지막 자식으로 들어감 (= 부모 변경)
 *
 * 가드:
 *   - 자기 자신/자기 후손에게는 drop 불가 (순환 참조 방지 — 백엔드 검증도 있음).
 *   - 같은 자리 drop 은 noop.
 */
export function useCategoryDrag({ tree, onDrop }: UseCategoryDragArgs) {
  const [state, setState] = useState<DragState>(EMPTY);
  const draggedRef = useRef<string | null>(null);

  const canDropOnto = useCallback(
    (draggedId: string, targetId: string): boolean => {
      if (draggedId === targetId) return false;
      const dragged = findNode(tree, draggedId);
      if (!dragged) return false;
      return !descendantIdsOf(dragged).has(targetId);
    },
    [tree],
  );

  const computePlacement = (e: React.DragEvent<HTMLElement>): DropPlacement => {
    const rect = e.currentTarget.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const h = rect.height;
    if (y < h * 0.25) return 'before';
    if (y > h * 0.75) return 'after';
    return 'into';
  };

  const onDragStart = useCallback(
    (e: React.DragEvent<HTMLElement>, node: CategoryNode) => {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', node.id);
      draggedRef.current = node.id;
      setState({ draggedId: node.id, overId: null, placement: null });
    },
    [],
  );

  const onDragOver = useCallback(
    (e: React.DragEvent<HTMLElement>, node: CategoryNode) => {
      const draggedId = draggedRef.current;
      if (!draggedId || !canDropOnto(draggedId, node.id)) {
        e.dataTransfer.dropEffect = 'none';
        return;
      }
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      const placement = computePlacement(e);
      setState((prev) =>
        prev.overId === node.id && prev.placement === placement
          ? prev
          : { draggedId, overId: node.id, placement },
      );
    },
    [canDropOnto],
  );

  const onDragLeave = useCallback((e: React.DragEvent<HTMLElement>) => {
    const related = e.relatedTarget as HTMLElement | null;
    if (related && e.currentTarget.contains(related)) return;
    setState((prev) => ({ ...prev, overId: null, placement: null }));
  }, []);

  const onDropNode = useCallback(
    (e: React.DragEvent<HTMLElement>, node: CategoryNode) => {
      e.preventDefault();
      const draggedId = draggedRef.current;
      const placement = state.placement;
      setState(EMPTY);
      draggedRef.current = null;
      if (!draggedId || !placement) return;
      if (!canDropOnto(draggedId, node.id)) return;
      onDrop({ draggedId, targetId: node.id, placement });
    },
    [canDropOnto, onDrop, state.placement],
  );

  const onDragEnd = useCallback(() => {
    setState(EMPTY);
    draggedRef.current = null;
  }, []);

  return { state, onDragStart, onDragOver, onDragLeave, onDropNode, onDragEnd };
}
