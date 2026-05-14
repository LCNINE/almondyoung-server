'use client';

import { createColumnHelper } from '@tanstack/react-table';
import { useMemo } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DateCell } from '@/components/table/table-cells/common';
import type { NoticeDto } from '@/lib/types/dto/products';

const columnHelper = createColumnHelper<NoticeDto>();

type RowActions = {
  onDetail: (row: NoticeDto) => void;
  onDelete: (row: NoticeDto) => void;
};

const CATEGORY_LABEL: Record<string, string> = {
  general: '일반',
  event: '이벤트',
  delivery: '배송',
  service: '서비스',
};

const BADGE_LABEL: Record<string, { label: string; variant: 'destructive' | 'default' | 'secondary' }> = {
  important: { label: '중요', variant: 'destructive' },
  urgent: { label: '긴급', variant: 'destructive' },
  new: { label: '신규', variant: 'default' },
};

export const useNoticesTableColumns = (actions: RowActions) => {
  return useMemo(
    () => [
      columnHelper.accessor('isPinned', {
        header: '고정',
        cell: ({ getValue }) =>
          getValue() ? (
            <Badge variant="secondary">📌</Badge>
          ) : (
            <span className="text-xs text-muted-foreground/40">—</span>
          ),
      }),
      columnHelper.accessor('badge', {
        header: '뱃지',
        cell: ({ getValue }) => {
          const val = getValue();
          if (!val) return <span className="text-xs text-muted-foreground/40">—</span>;
          const meta = BADGE_LABEL[val];
          return <Badge variant={meta?.variant ?? 'outline'}>{meta?.label ?? val}</Badge>;
        },
      }),
      columnHelper.accessor('title', {
        header: '제목',
        cell: ({ getValue }) => <span className="text-sm font-medium">{getValue()}</span>,
      }),
      columnHelper.accessor('category', {
        header: '분류',
        cell: ({ getValue }) => {
          const val = getValue();
          return <Badge variant="outline">{CATEGORY_LABEL[val] ?? val}</Badge>;
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
        header: '순서',
        cell: ({ getValue }) => <span className="text-sm">{getValue()}</span>,
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
    [actions],
  );
};
