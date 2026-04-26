'use client';

import { createColumnHelper } from '@tanstack/react-table';
import { useMemo } from 'react';
import type { MasterDto } from '@/lib/types/dto/products';
import { Checkbox } from '@/components/ui/checkbox';
import { DateCell } from '@/components/table/table-cells/common';
import { Badge } from '@/components/ui/badge';

const columnHelper = createColumnHelper<MasterDto>();

const STATUS_LABELS: Record<string, string> = {
  active: '활성',
  inactive: '판매중단',
  draft: '임시저장',
  archived: '보관',
};

export function useProductsListTableColumns() {
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
      columnHelper.accessor('id', {
        header: '품번코드',
        cell: ({ getValue }) => (
          <span className="break-all text-xs text-muted-foreground">{getValue()}</span>
        ),
      }),
      columnHelper.accessor('images', {
        header: '이미지',
        cell: ({ getValue }) => {
          const images = getValue();
          const src = images?.[0] ?? '/placeholder.svg';
          return (
            <div className="mx-auto h-14 w-14 overflow-hidden rounded">
              <img src={src} alt="상품 이미지" className="h-full w-full object-cover" />
            </div>
          );
        },
      }),
      columnHelper.accessor('name', {
        header: '상품명/분류/브랜드',
        cell: ({ row }) => (
          <div className="space-y-0.5">
            <p className="break-words text-sm font-medium leading-tight text-blue-800">
              {row.original.name}
            </p>
            <p className="text-xs text-muted-foreground">
              {row.original.categories?.[0]?.name ?? '-'}
            </p>
            <p className="text-xs text-muted-foreground">{row.original.brand ?? '-'}</p>
          </div>
        ),
      }),
      columnHelper.accessor('variants', {
        header: '옵션수',
        cell: ({ getValue }) => {
          const variants = getValue();
          return (
            <span className="text-sm text-blue-900">
              {variants?.length ? `${variants.length}개` : '단일상품'}
            </span>
          );
        },
      }),
      columnHelper.accessor('basePrice', {
        header: '판매가/멤버십가',
        cell: ({ row }) => (
          <div className="space-y-0.5 text-right text-sm">
            <p className="font-medium">
              {row.original.basePrice ? row.original.basePrice.toLocaleString() + '원' : '-'}
            </p>
          </div>
        ),
      }),
      columnHelper.accessor('status', {
        header: '상태',
        cell: ({ getValue }) => {
          const status = getValue();
          const label = STATUS_LABELS[status] ?? status;
          const variant =
            status === 'active'
              ? 'default'
              : status === 'draft'
                ? 'secondary'
                : 'outline';
          return <Badge variant={variant}>{label}</Badge>;
        },
      }),
      columnHelper.accessor('createdAt', {
        header: '등록일',
        cell: ({ getValue }) => <DateCell value={getValue()} />,
      }),
      columnHelper.accessor('updatedAt', {
        header: '수정일',
        cell: ({ getValue }) => <DateCell value={getValue()} />,
      }),
    ],
    []
  );
}
