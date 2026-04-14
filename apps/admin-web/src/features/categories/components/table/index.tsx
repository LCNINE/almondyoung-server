'use client';

import { useState, useMemo, useCallback } from 'react';
import { useCategoryTree } from '@/lib/services/products/queries';
import { useDataTable } from '@/hooks/use-data-table';
import { useCategoryTableColumns } from '@/hooks/table/columns/use-category-table-columns';
import { useCategoryTableFilters } from '@/hooks/table/filters/use-category-table-filters';
import { useCategoryTableQuery } from '@/hooks/table/query/use-category-table-query';
import { DataTable } from '@/components/data-table';
import { Button } from '@/components/ui/button';
import { CategoryCreateButton } from '../create-modal';
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
  level: number = 0
): Category[] {
  const result: Category[] = [];

  // sortOrder로 정렬
  const sortedCategories = [...categories].sort(
    (a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)
  );

  for (const category of sortedCategories) {
    const categoryWithLevel = {
      ...category,
      level,
    };

    result.push(categoryWithLevel);

    if (category.children && category.children.length > 0) {
      if (expanded.has(category.id)) {
        result.push(
          ...flattenCategoryTree(category.children, expanded, level + 1)
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

  const { searchParams: query } = useCategoryTableQuery({ pageSize: PAGE_SIZE });
  const { data: categoryTreeData, isLoading, isFetching } = useCategoryTree();
  const filters = useCategoryTableFilters();

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

  const flattenedCategories = useMemo(() => {
    if (!categoryTreeData?.categories) return [];

    const categories = categoryTreeData.categories.map(convertCategoryDtoToUI);

    let filtered = categories;

    // 검색 필터링
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

    // isActive 필터링
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

    return flattenCategoryTree(filtered, expandedCategories);
  }, [categoryTreeData, expandedCategories, query.q, query.isActive]);

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

  return (
    <div>
      <div className="flex items-center justify-between p-3 border-b">
        <div className="flex items-center gap-2">
          <CategoryCreateButton />
        </div>
      </div>
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
      <DataTable
        table={table}
        isLoading={isLoading}
        isFetching={isFetching}
        count={flattenedCategories.length}
        pageSize={PAGE_SIZE}
        filters={filters}
        search
        noRecords={{ message: '카테고리가 없습니다.' }}
      />
    </div>
  );
}
