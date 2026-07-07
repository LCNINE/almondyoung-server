'use client';

import { createColumnHelper } from '@tanstack/react-table';
import { useMemo } from 'react';
import { useRouter } from 'next/navigation';
import type { MyDraftListItem } from '@/lib/types/dto/products';
import { DateCell } from '@/components/table/table-cells/common';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ProductThumbnailCell } from '@/components/table/table-cells/product-thumbnail-cell';
import { buildDraftEditPath } from '@/features/mall/my-drafts/lib/draft-edit-path';

const columnHelper = createColumnHelper<MyDraftListItem>();

const PRODUCT_TYPE_LABELS: Record<string, string> = {
  regular_sale: '일반',
  limited_edition: '한정',
};

export function useMyDraftsTableColumns() {
  const router = useRouter();

  return useMemo(
    () => [
      columnHelper.accessor('thumbnail', {
        header: '이미지',
        cell: ({ getValue }) => <ProductThumbnailCell thumbnail={getValue()} />,
      }),
      columnHelper.accessor('name', {
        header: '상품명/브랜드',
        cell: ({ row }) => (
          <div className="space-y-0.5">
            <p className="break-words text-sm font-medium leading-tight text-blue-800">
              {row.original.name}
            </p>
            <p className="text-xs text-muted-foreground">{row.original.brand ?? '-'}</p>
          </div>
        ),
      }),
      columnHelper.accessor('productType', {
        header: '유형',
        cell: ({ getValue }) => (
          <span className="text-sm">{PRODUCT_TYPE_LABELS[getValue()] ?? getValue()}</span>
        ),
      }),
      columnHelper.accessor('status', {
        header: '상태',
        cell: () => <Badge variant="secondary">임시저장</Badge>,
      }),
      columnHelper.accessor('updatedAt', {
        header: '최종수정일',
        cell: ({ getValue }) => <DateCell value={getValue()} />,
      }),
      columnHelper.display({
        id: 'actions',
        header: '작업',
        cell: ({ row }) => (
          <Button
            size="sm"
            variant="outline"
            className="text-xs"
            onClick={(e) => {
              e.stopPropagation();
              router.push(buildDraftEditPath(row.original.masterId, row.original.versionId));
            }}
          >
            이어서 편집
          </Button>
        ),
      }),
    ],
    [router]
  );
}
