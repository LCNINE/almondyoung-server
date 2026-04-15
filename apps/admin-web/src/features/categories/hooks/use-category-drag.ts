'use client';

import { useState, useCallback, useRef } from 'react';
import type { Category } from '@/lib/types/ui/products';

export type DropPosition = 'before' | 'after' | null;

export interface DragState {
  isDragging: boolean;
  draggedId: string | null;
  dragOverId: string | null;
  dropPosition: DropPosition;
}

export interface PendingReorder {
  parentId: string | null;
  categoryIds: string[];
}

interface UseCategoryDragOptions {
  categories: Category[];
}

export function useCategoryDrag({ categories }: UseCategoryDragOptions) {
  const [dragState, setDragState] = useState<DragState>({
    isDragging: false,
    draggedId: null,
    dragOverId: null,
    dropPosition: null,
  });

  const [pendingReorder, setPendingReorder] = useState<PendingReorder | null>(null);

  const draggedCategoryRef = useRef<Category | null>(null);

  const findCategoryById = useCallback(
    (id: string): Category | undefined => {
      return categories.find((c) => c.id === id);
    },
    [categories]
  );

  const canDrop = useCallback(
    (draggedId: string, targetId: string): boolean => {
      if (draggedId === targetId) return false;

      const dragged = findCategoryById(draggedId);
      const target = findCategoryById(targetId);

      if (!dragged || !target) return false;

      const draggedParentId = dragged.parentId ?? null;
      const targetParentId = target.parentId ?? null;

      return draggedParentId === targetParentId;
    },
    [findCategoryById]
  );

  const handleDragStart = useCallback(
    (e: React.DragEvent<HTMLTableRowElement>, category: Category) => {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', category.id);
      draggedCategoryRef.current = category;

      setDragState({
        isDragging: true,
        draggedId: category.id,
        dragOverId: null,
        dropPosition: null,
      });
    },
    []
  );

  const handleDragOver = useCallback(
    (e: React.DragEvent<HTMLTableRowElement>, targetId: string) => {
      e.preventDefault();

      const draggedId = dragState.draggedId;
      if (!draggedId || !canDrop(draggedId, targetId)) {
        e.dataTransfer.dropEffect = 'none';
        return;
      }

      e.dataTransfer.dropEffect = 'move';

      const rect = e.currentTarget.getBoundingClientRect();
      const midY = rect.top + rect.height / 2;
      const position: DropPosition = e.clientY < midY ? 'before' : 'after';

      setDragState((prev) => ({
        ...prev,
        dragOverId: targetId,
        dropPosition: position,
      }));
    },
    [dragState.draggedId, canDrop]
  );

  const handleDragLeave = useCallback(
    (e: React.DragEvent<HTMLTableRowElement>) => {
      const relatedTarget = e.relatedTarget as HTMLElement | null;
      if (relatedTarget && e.currentTarget.contains(relatedTarget)) {
        return;
      }

      setDragState((prev) => ({
        ...prev,
        dragOverId: null,
        dropPosition: null,
      }));
    },
    []
  );

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLTableRowElement>, targetCategory: Category) => {
      e.preventDefault();

      const draggedCategory = draggedCategoryRef.current;
      if (!draggedCategory) return;

      if (!canDrop(draggedCategory.id, targetCategory.id)) {
        setDragState({
          isDragging: false,
          draggedId: null,
          dragOverId: null,
          dropPosition: null,
        });
        return;
      }

      const parentId = draggedCategory.parentId ?? null;
      const siblings = categories
        .filter((c) => (c.parentId ?? null) === parentId)
        .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));

      const orderedIds = siblings.map((c) => c.id).filter((id) => id !== draggedCategory.id);

      const targetIndex = orderedIds.indexOf(targetCategory.id);
      const insertIndex =
        dragState.dropPosition === 'before' ? targetIndex : targetIndex + 1;

      orderedIds.splice(insertIndex, 0, draggedCategory.id);

      setPendingReorder({ parentId, categoryIds: orderedIds });

      setDragState({
        isDragging: false,
        draggedId: null,
        dragOverId: null,
        dropPosition: null,
      });
      draggedCategoryRef.current = null;
    },
    [categories, dragState.dropPosition, canDrop]
  );

  const handleDragEnd = useCallback(() => {
    setDragState({
      isDragging: false,
      draggedId: null,
      dragOverId: null,
      dropPosition: null,
    });
    draggedCategoryRef.current = null;
  }, []);

  const clearPendingReorder = useCallback(() => {
    setPendingReorder(null);
  }, []);

  const getDragProps = useCallback(
    (category: Category) => ({
      draggable: true,
      onDragStart: (e: React.DragEvent<HTMLTableRowElement>) =>
        handleDragStart(e, category),
      onDragOver: (e: React.DragEvent<HTMLTableRowElement>) =>
        handleDragOver(e, category.id),
      onDragLeave: handleDragLeave,
      onDrop: (e: React.DragEvent<HTMLTableRowElement>) =>
        handleDrop(e, category),
      onDragEnd: handleDragEnd,
    }),
    [handleDragStart, handleDragOver, handleDragLeave, handleDrop, handleDragEnd]
  );

  const getRowClassName = useCallback(
    (categoryId: string, categoryParentId: string | undefined) => {
      const classes: string[] = [];

      if (dragState.draggedId === categoryId) {
        classes.push('opacity-50', 'bg-muted');
      }

      if (dragState.dragOverId === categoryId) {
        const dragged = dragState.draggedId
          ? findCategoryById(dragState.draggedId)
          : null;
        const draggedParentId = dragged?.parentId ?? null;
        const targetParentId = categoryParentId ?? null;

        if (draggedParentId === targetParentId) {
          if (dragState.dropPosition === 'before') {
            classes.push('border-t-2', 'border-t-primary');
          } else if (dragState.dropPosition === 'after') {
            classes.push('border-b-2', 'border-b-primary');
          }
        } else {
          classes.push('bg-destructive/10');
        }
      }

      // 펜딩 상태에서 순서가 변경된 항목 하이라이트
      if (pendingReorder && pendingReorder.categoryIds.includes(categoryId)) {
        const currentParentId = categoryParentId ?? null;
        if (currentParentId === pendingReorder.parentId) {
          classes.push('bg-yellow-50', 'dark:bg-yellow-900/20');
        }
      }

      return classes.join(' ');
    },
    [dragState, findCategoryById, pendingReorder]
  );

  return {
    dragState,
    pendingReorder,
    getDragProps,
    getRowClassName,
    clearPendingReorder,
    canDrop,
  };
}
