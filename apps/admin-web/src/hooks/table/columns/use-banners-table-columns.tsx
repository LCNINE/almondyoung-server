'use client';

import { createColumnHelper } from '@tanstack/react-table';
import { useMemo } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DateCell } from '@/components/table/table-cells/common';
import type { BannerDto } from '@/lib/types/dto/products';

const columnHelper = createColumnHelper<BannerDto>();

type RowActions = {
  onEdit: (row: BannerDto) => void;
  onDelete: (row: BannerDto) => void;
};

export const useBannersTableColumns = (actions: RowActions) => {
  return useMemo(
    () => [
      columnHelper.accessor('title', {
        header: '제목',
        cell: ({ getValue }) => <span className="text-sm font-medium">{getValue()}</span>,
      }),
      columnHelper.accessor('isActive', {
        header: '활성',
        cell: ({ getValue }) => (
          <Badge variant={getValue() ? 'default' : 'secondary'}>
            {getValue() ? '활성' : '비활성'}
          </Badge>
        ),
      }),
      columnHelper.accessor('sortOrder', {
        header: '정렬순서',
        cell: ({ getValue }) => {
          const v = getValue();
          return v !== undefined && v !== null ? (
            <span className="text-sm">{v}</span>
          ) : (
            <span className="text-xs text-muted-foreground/40">—</span>
          );
        },
      }),
      columnHelper.accessor('displayStartAt', {
        header: '노출 시작일',
        cell: ({ getValue }) => {
          const v = getValue();
          return v ? <DateCell value={v} /> : <span className="text-xs text-muted-foreground/40">—</span>;
        },
      }),
      columnHelper.accessor('displayEndAt', {
        header: '노출 종료일',
        cell: ({ getValue }) => {
          const v = getValue();
          return v ? <DateCell value={v} /> : <span className="text-xs text-muted-foreground/40">—</span>;
        },
      }),
      columnHelper.accessor('linkUrl', {
        header: '링크',
        cell: ({ getValue }) => {
          const v = getValue();
          return v ? (
            <span className="max-w-[200px] truncate text-xs text-muted-foreground">{v}</span>
          ) : (
            <span className="text-xs text-muted-foreground/40">—</span>
          );
        },
      }),
      columnHelper.accessor('createdAt', {
        header: '등록일',
        cell: ({ getValue }) => <DateCell value={getValue()} />,
      }),
      columnHelper.display({
        id: 'actions',
        header: '관리',
        cell: ({ row }) => (
          <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
            <Button variant="outline" size="sm" onClick={() => actions.onEdit(row.original)}>
              편집
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive hover:text-destructive"
              onClick={() => actions.onDelete(row.original)}
            >
              삭제
            </Button>
          </div>
        ),
      }),
    ],
    [actions]
  );
};
