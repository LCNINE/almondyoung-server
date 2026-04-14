import { createColumnHelper } from '@tanstack/react-table';
import { useMemo } from 'react';
import { ChevronRight } from 'lucide-react';
import { DateCell } from '@/components/table/table-cells/common';
import { Checkbox } from '@/components/ui/checkbox';
import type { Category } from '@/lib/types/ui/products';
import { CategoryEditButton } from '@/features/categories/components/edit-modal';
import { CategoryMoveButton } from '@/features/categories/components/move-modal';
import { CategoryDeleteButton } from '@/features/categories/components/delete-dialog';

const columnHelper = createColumnHelper<Category>();

type UseCategoryTableColumnsProps = {
  expandedCategories: Set<string>;
  onToggleExpand: (id: string) => void;
};

export const useCategoryTableColumns = ({
  expandedCategories,
  onToggleExpand,
}: UseCategoryTableColumnsProps) => {
  return useMemo(
    () => [
      columnHelper.display({
        id: 'select',
        header: ({ table }) => (
          <Checkbox
            checked={
              table.getIsAllPageRowsSelected() ||
              (table.getIsSomePageRowsSelected() && 'indeterminate')
            }
            onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
            aria-label="전체 선택"
            onClick={(e) => e.stopPropagation()}
          />
        ),
        cell: ({ row }) => (
          <Checkbox
            checked={row.getIsSelected()}
            onCheckedChange={(value) => row.toggleSelected(!!value)}
            aria-label="행 선택"
            onClick={(e) => e.stopPropagation()}
          />
        ),
      }),
      columnHelper.accessor('name', {
        header: '카테고리명',
        cell: ({ row, getValue }) => {
          const indent = row.original.level * 24;
          const hasChildren = row.original.children && row.original.children.length > 0;
          const isExpanded = expandedCategories.has(row.original.id);
          return (
            <div className="flex items-center gap-2" style={{ paddingLeft: `${indent}px` }}>
              {hasChildren ? (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleExpand(row.original.id);
                  }}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <ChevronRight
                    size={16}
                    className={isExpanded ? 'rotate-90' : ''}
                  />
                </button>
              ) : (
                <span className="w-4" />
              )}
              <span className="text-sm font-medium">{getValue() || '-'}</span>
            </div>
          );
        },
      }),
      columnHelper.accessor('slug', {
        header: '슬러그',
        cell: ({ getValue }) => (
          <span className="text-xs text-gray-600">{getValue() || '-'}</span>
        ),
      }),
      columnHelper.accessor('level', {
        header: '레벨',
        cell: ({ getValue }) => (
          <span className="text-xs">{getValue() ?? '-'}</span>
        ),
      }),
      columnHelper.accessor('sortOrder', {
        header: '정렬순서',
        cell: ({ getValue }) => (
          <span className="text-xs">{getValue() ?? '-'}</span>
        ),
      }),
      columnHelper.accessor('isActive', {
        header: '활성화',
        cell: ({ getValue }) => {
          const value = getValue();
          return (
            <span
              className={`text-xs px-2 py-1 rounded ${
                value ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'
              }`}
            >
              {value ? '활성' : '비활성'}
            </span>
          );
        },
      }),
      columnHelper.accessor('children', {
        header: '하위 카테고리 수',
        cell: ({ getValue }) => {
          const value = getValue();
          return (
            <span className="text-xs">
              {Array.isArray(value) ? value.length : 0}
            </span>
          );
        },
      }),
      columnHelper.accessor('createdAt', {
        header: '생성일',
        cell: ({ getValue }) => <DateCell value={getValue()} />,
      }),
      columnHelper.display({
        id: 'actions',
        header: '작업',
        cell: ({ row }) => (
          <div className="flex items-center justify-center gap-2">
            <CategoryEditButton category={row.original} />
            <CategoryMoveButton category={row.original} />
            <CategoryDeleteButton category={row.original} />
          </div>
        ),
      }),
    ],
    [expandedCategories, onToggleExpand]
  );
};
