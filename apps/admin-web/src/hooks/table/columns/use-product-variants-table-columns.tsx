'use client';

import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { useMemo } from 'react';
import type {
  ProductOptionGroup,
  ProductVariantRow,
} from '@/lib/services/products/products-detail.types';
import { Badge } from '@/components/ui/badge';

const STATUS_LABELS: Record<string, string> = {
  active: '활성',
  inactive: '판매중단',
  draft: '임시저장',
  archived: '보관',
};

const columnHelper = createColumnHelper<ProductVariantRow>();

export function useProductVariantsTableColumns(
  optionGroups: ProductOptionGroup[],
) {
  return useMemo(() => {
    // valueId → displayName. master 의 모든 그룹/값을 평탄화.
    const valueLabelById = new Map<string, string>();
    for (const group of optionGroups) {
      for (const v of group.values) {
        valueLabelById.set(v.id, v.displayName);
      }
    }

    const sortedGroups = [...optionGroups].sort(
      (a, b) => a.sortOrder - b.sortOrder,
    );

    const optionColumns: ColumnDef<ProductVariantRow, unknown>[] =
      sortedGroups.map((group) =>
        columnHelper.display({
          id: `optionGroup:${group.id}`,
          header: group.displayName,
          cell: ({ row }) => {
            const matches = row.original.optionValues.filter(
              (ov) => ov.optionGroupId === group.id,
            );
            if (matches.length === 0) return '-';
            if (matches.length > 1) {
              console.warn(
                `[ProductVariants] variant ${row.original.id} has ${matches.length} values for option group ${group.id}; expected 1`,
              );
            }
            const first = matches[0];
            const label = valueLabelById.get(first.id);
            if (label === undefined) {
              console.warn(
                `[ProductVariants] option value ${first.id} on variant ${row.original.id} not found in master option groups`,
              );
              return '-';
            }
            return label;
          },
        }),
      );

    return [
      columnHelper.accessor('variantName', {
        header: '이름',
        cell: ({ getValue }) => getValue() ?? '-',
      }),
      ...optionColumns,
      columnHelper.accessor('isDefault', {
        header: '기본',
        cell: ({ getValue }) =>
          getValue() ? <Badge variant="default">기본</Badge> : null,
      }),
      columnHelper.accessor('status', {
        header: '상태',
        cell: ({ getValue }) => {
          const v = getValue();
          if (!v) return '-';
          return <Badge variant="secondary">{STATUS_LABELS[v] ?? v}</Badge>;
        },
      }),
      columnHelper.accessor('price', {
        header: '가격',
        cell: ({ getValue }) => {
          const v = getValue();
          if (v == null) return '-';
          return `${v.toLocaleString()}원`;
        },
      }),
    ];
  }, [optionGroups]);
}
