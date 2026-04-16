'use client';

import { useState, useMemo, useCallback } from 'react';
import { flexRender } from '@tanstack/react-table';
import { useCategoryTree } from '@/lib/services/products/queries';
import { useReorderCategories } from '@/lib/services/products/mutations';
import { useDataTable } from '@/hooks/use-data-table';
import { useCategoryTableColumns } from '@/hooks/table/columns/use-category-table-columns';
import { useCategoryTableFilters } from '@/hooks/table/filters/use-category-table-filters';
import { useCategoryTableQuery } from '@/hooks/table/query/use-category-table-query';
import { DataTableQuery } from '@/components/data-table';
import { Table } from '@/components/admin-ui-experimental/common/table/table';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { CategoryCreateButton } from '../create-modal';
import { DraggableCategoryRow } from './draggable-category-row';
import { useCategoryDrag } from '../../hooks/use-category-drag';
import type { Category } from '@/lib/types/ui/products';
import type { CategoryDto } from '@/lib/types/dto/products';

const PAGE_SIZE = 50;

function convertCategoryDtoToUI(dto: CategoryDto): Category {
  return {
    id: dto.id,
    name: dto.name,
    slug: dto.slug ?? '',
    description: dto.description ?? undefined,
    parentId: dto.parentId ?? undefined,
    level: dto.level ?? 0,
    sortOrder: dto.sortOrder ?? 0,
    isActive: dto.isActive,
    createdAt: new Date(dto.createdAt),
    updatedAt: new Date(dto.updatedAt),
    children: dto.children ? dto.children.map(convertCategoryDtoToUI) : [],
  };
}

function flattenCategoryTree(
  categories: Category[],
  expanded: Set<string> = new Set(),
  level: number = 0,
  pendingOrder?: { parentId: string | null; categoryIds: string[] } | null
): Category[] {
  const result: Category[] = [];

  let sortedCategories = [...categories].sort(
    (a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)
  );

  // 펜딩 순서가 있으면 해당 레벨의 카테고리를 펜딩 순서대로 정렬
  const currentParentId = categories[0]?.parentId ?? null;
  const isPendingLevel = pendingOrder &&
    (currentParentId === pendingOrder.parentId ||
     (currentParentId === undefined && pendingOrder.parentId === null));

  if (isPendingLevel && pendingOrder) {
    sortedCategories = [...categories].sort((a, b) => {
      const aIndex = pendingOrder.categoryIds.indexOf(a.id);
      const bIndex = pendingOrder.categoryIds.indexOf(b.id);
      if (aIndex === -1 && bIndex === -1) return (a.sortOrder ?? 0) - (b.sortOrder ?? 0);
      if (aIndex === -1) return 1;
      if (bIndex === -1) return -1;
      return aIndex - bIndex;
    });
  }

  for (let i = 0; i < sortedCategories.length; i++) {
    const category = sortedCategories[i];
    const categoryWithLevel = {
      ...category,
      level,
      // 펜딩 상태면 새 정렬순서 표시
      sortOrder: isPendingLevel ? i : category.sortOrder,
    };

    result.push(categoryWithLevel);

    if (category.children && category.children.length > 0) {
      if (expanded.has(category.id)) {
        result.push(
          ...flattenCategoryTree(category.children, expanded, level + 1, pendingOrder)
        );
      }
    }
  }

  return result;
}

export function CategoryTable() {
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(
    new Set()
  );

  const { searchParams: query } = useCategoryTableQuery({
    pageSize: PAGE_SIZE,
  });
  const { data: categoryTreeData, isLoading, isFetching } = useCategoryTree();
  const filters = useCategoryTableFilters();
  const reorderMutation = useReorderCategories();

  const handleToggleExpand = useCallback((categoryId: string) => {
    setExpandedCategories((prev) => {
      const newExpanded = new Set(prev);
      if (newExpanded.has(categoryId)) {
        newExpanded.delete(categoryId);
      } else {
        newExpanded.add(categoryId);
      }
      return newExpanded;
    });
  }, []);

  const columns = useCategoryTableColumns({
    expandedCategories,
    onToggleExpand: handleToggleExpand,
  });

  const categories = useMemo(() => {
    if (!categoryTreeData?.categories) return [];
    return categoryTreeData.categories.map(convertCategoryDtoToUI);
  }, [categoryTreeData]);

  const { dragState, pendingReorder, getDragProps, getRowClassName, clearPendingReorder } = useCategoryDrag({
    categories: useMemo(() => {
      if (!categoryTreeData?.categories) return [];
      const cats = categoryTreeData.categories.map(convertCategoryDtoToUI);
      return flattenCategoryTree(cats, expandedCategories, 0, null);
    }, [categoryTreeData, expandedCategories]),
  });

  const flattenedCategories = useMemo(() => {
    if (!categoryTreeData?.categories) return [];

    let filtered = categories;

    if (query.q?.trim()) {
      const searchLower = query.q.toLowerCase();
      const filterCategory = (cat: Category): Category | null => {
        const matches =
          cat.name.toLowerCase().includes(searchLower) ||
          cat.slug?.toLowerCase().includes(searchLower) ||
          cat.description?.toLowerCase().includes(searchLower);

        const filteredChildren =
          cat.children
            ?.map(filterCategory)
            .filter((c): c is Category => c !== null) || [];

        if (matches || filteredChildren.length > 0) {
          return {
            ...cat,
            children: filteredChildren,
          };
        }

        return null;
      };

      filtered = categories
        .map(filterCategory)
        .filter((c): c is Category => c !== null);
    }

    if (query.isActive !== undefined) {
      const filterByActive = (cat: Category): Category | null => {
        const filteredChildren =
          cat.children
            ?.map(filterByActive)
            .filter((c): c is Category => c !== null) || [];

        if (cat.isActive === query.isActive || filteredChildren.length > 0) {
          return {
            ...cat,
            children: filteredChildren,
          };
        }

        return null;
      };

      filtered = filtered
        .map(filterByActive)
        .filter((c): c is Category => c !== null);
    }

    return flattenCategoryTree(filtered, expandedCategories, 0, pendingReorder);
  }, [categoryTreeData, categories, expandedCategories, query.q, query.isActive, pendingReorder]);

  const handleSaveReorder = useCallback(() => {
    if (!pendingReorder) return;

    reorderMutation.mutate(
      {
        parentId: pendingReorder.parentId,
        categoryIds: pendingReorder.categoryIds,
      },
      {
        onSuccess: () => {
          clearPendingReorder();
        },
      }
    );
  }, [pendingReorder, reorderMutation, clearPendingReorder]);

  const handleCancelReorder = useCallback(() => {
    clearPendingReorder();
  }, [clearPendingReorder]);

  const { table } = useDataTable({
    data: flattenedCategories,
    columns,
    count: flattenedCategories.length,
    pageSize: PAGE_SIZE,
    getRowId: (row) => row.id,
    enableRowSelection: true,
  });

  const selectedRows = table.getSelectedRowModel().rows;
  const selectedCategoryIds = selectedRows.map((row) => row.original.id);

  const rows = table.getRowModel().rows;
  const { pageIndex } = table.getState().pagination;
  const pageCount = table.getPageCount();

  return (
    <div>
      <div className="flex items-center justify-between p-3 border-b">
        <div className="flex items-center gap-2">
          <CategoryCreateButton />
        </div>
      </div>
      {pendingReorder && (
        <div className="flex items-center justify-between gap-2 p-3 bg-yellow-50 dark:bg-yellow-900/20 border-b">
          <span className="text-sm text-yellow-800 dark:text-yellow-200">
            카테고리 순서가 변경되었습니다. 저장하시겠습니까?
          </span>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={handleCancelReorder}
              disabled={reorderMutation.isPending}
            >
              취소
            </Button>
            <Button
              size="sm"
              onClick={handleSaveReorder}
              disabled={reorderMutation.isPending}
            >
              {reorderMutation.isPending ? '저장 중...' : '저장'}
            </Button>
          </div>
        </div>
      )}
      {selectedCategoryIds.length > 0 && (
        <div className="flex items-center gap-2 p-3 bg-muted/50 border-b">
          <span className="text-sm text-muted-foreground">
            {selectedCategoryIds.length}개 선택됨
          </span>
          <Button
            size="sm"
            variant="outline"
            onClick={() => table.resetRowSelection()}
          >
            선택 해제
          </Button>
        </div>
      )}
      <DataTableQuery filters={filters} search />
      <Table>
        <Table.Header>
          {table.getHeaderGroups().map((headerGroup) => (
            <Table.Row key={headerGroup.id}>
              <Table.Head className="w-8 px-1" />
              {headerGroup.headers.map((header) => (
                <Table.Head key={header.id}>
                  {flexRender(
                    header.column.columnDef.header,
                    header.getContext()
                  )}
                </Table.Head>
              ))}
            </Table.Row>
          ))}
        </Table.Header>
        <Table.Body>
          {isLoading || isFetching ? (
            Array.from({ length: PAGE_SIZE }).map((_, i) => (
              <Table.Row key={`skeleton-${i}`}>
                <Table.Cell className="w-8 px-1" />
                {table.getAllColumns().map((col) => (
                  <Table.Cell key={col.id}>
                    <Skeleton className="h-4 w-full" />
                  </Table.Cell>
                ))}
              </Table.Row>
            ))
          ) : rows.length === 0 ? (
            <Table.Row>
              <Table.Cell
                colSpan={table.getAllColumns().length + 1}
                className="py-8 text-center text-muted-foreground"
              >
                카테고리가 없습니다.
              </Table.Cell>
            </Table.Row>
          ) : (
            rows.map((row) => (
              <DraggableCategoryRow
                key={row.id}
                row={row}
                dragProps={getDragProps(row.original)}
                className={getRowClassName(
                  row.original.id,
                  row.original.parentId
                )}
              />
            ))
          )}
        </Table.Body>
      </Table>
    </div>
  );
}
