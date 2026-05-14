'use client';

import { createColumnHelper } from '@tanstack/react-table';
import { useMemo } from 'react';
import type { ProductVariantRow } from '@/lib/services/products/products-detail.types';
import { Badge } from '@/components/ui/badge';

const STATUS_LABELS: Record<string, string> = {
  active: '활성',
  inactive: '판매중단',
  draft: '임시저장',
  archived: '보관',
};

const columnHelper = createColumnHelper<ProductVariantRow>();

export function useProductVariantsTableColumns() {
  return useMemo(
    () => [
      columnHelper.accessor('variantName', {
        header: '이름',
        cell: ({ getValue }) => getValue() ?? '-',
      }),
      columnHelper.accessor('displayOrder', {
        header: '표시 순서',
        cell: ({ getValue }) => getValue() ?? '-',
      }),
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
    ],
    [],
  );
}
