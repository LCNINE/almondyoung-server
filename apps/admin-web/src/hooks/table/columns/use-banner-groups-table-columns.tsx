'use client';

import { createColumnHelper } from '@tanstack/react-table';
import { useMemo } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DateCell } from '@/components/table/table-cells/common';
import type { BannerGroupDto } from '@/lib/types/dto/products';

const columnHelper = createColumnHelper<BannerGroupDto>();

type RowActions = {
  onDetail: (row: BannerGroupDto) => void;
  onDelete: (row: BannerGroupDto) => void;
};

export const useBannerGroupsTableColumns = (actions: RowActions) => {
  return useMemo(
    () => [
      columnHelper.accessor('code', {
        header: '코드',
        cell: ({ getValue }) => (
          <span className="font-mono text-xs">{getValue()}</span>
        ),
      }),
      columnHelper.accessor('title', {
        header: '제목',
        cell: ({ getValue }) => <span className="text-sm font-medium">{getValue()}</span>,
      }),
      columnHelper.accessor('category', {
        header: '카테고리',
        cell: ({ getValue }) => {
          const val = getValue();
          return val ? (
            <Badge variant="outline">{val}</Badge>
          ) : (
            <span className="text-xs text-muted-foreground/40">—</span>
          );
        },
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
      columnHelper.accessor('createdAt', {
        header: '등록일',
        cell: ({ getValue }) => <DateCell value={getValue()} />,
      }),
      columnHelper.display({
        id: 'actions',
        header: '관리',
        cell: ({ row }) => (
          <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
            <Button variant="outline" size="sm" onClick={() => actions.onDetail(row.original)}>
              상세
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
