'use client';

import { createColumnHelper } from '@tanstack/react-table';
import { useMemo } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import type { TopNoticeDto } from '@/lib/types/dto/products';
import { topNoticeDisplayState } from '@/features/mall/top-notices/form';

const columnHelper = createColumnHelper<TopNoticeDto>();

type RowActions = {
  onEdit: (row: TopNoticeDto) => void;
  /** 넘기지 않으면 노출 토글을 잠근다(권한 없음) */
  onToggleActive?: (row: TopNoticeDto, isActive: boolean) => void;
  /** 넘기지 않으면 삭제 버튼을 그리지 않는다(권한 없음) */
  onDelete?: (row: TopNoticeDto) => void;
};

export const useTopNoticesTableColumns = (actions: RowActions) => {
  return useMemo(
    () => [
      columnHelper.accessor('text', {
        header: '문구',
        cell: ({ getValue }) => <span className="text-sm font-medium">{getValue()}</span>,
      }),
      columnHelper.accessor('linkUrl', {
        header: '링크',
        cell: ({ getValue }) => {
          const link = getValue();

          if (!link) return <span className="text-muted-foreground text-xs">없음</span>;

          return <span className="block max-w-[240px] truncate text-xs">{link}</span>;
        },
      }),
      columnHelper.display({
        id: 'state',
        header: '상태',
        cell: ({ row }) => {
          const state = topNoticeDisplayState(row.original);

          return <Badge variant={state.variant}>{state.label}</Badge>;
        },
      }),
      columnHelper.display({
        id: 'period',
        header: '게시 기간',
        cell: ({ row }) => {
          const { displayStartAt, displayEndAt } = row.original;

          if (!displayStartAt && !displayEndAt) {
            return <span className="text-muted-foreground text-xs">제한 없음</span>;
          }

          return (
            <span className="text-xs">
              {formatDateTime(displayStartAt)} ~ {formatDateTime(displayEndAt)}
            </span>
          );
        },
      }),
      columnHelper.accessor('isActive', {
        header: '노출 사용',
        cell: ({ row }) => (
          <div onClick={(e) => e.stopPropagation()}>
            <Switch
              aria-label="노출 사용"
              checked={row.original.isActive}
              disabled={!actions.onToggleActive}
              onCheckedChange={(checked) => actions.onToggleActive?.(row.original, checked)}
            />
          </div>
        ),
      }),
      columnHelper.accessor('sortOrder', {
        header: '순서',
        cell: ({ getValue }) => <span className="text-sm">{getValue()}</span>,
      }),
      columnHelper.display({
        id: 'actions',
        header: '관리',
        cell: ({ row }) => (
          <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
            <Button variant="outline" size="sm" onClick={() => actions.onEdit(row.original)}>
              수정
            </Button>
            {actions.onDelete && (
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive hover:text-destructive"
                onClick={() => actions.onDelete?.(row.original)}
              >
                삭제
              </Button>
            )}
          </div>
        ),
      }),
    ],
    [actions],
  );
};

function formatDateTime(iso: string | null): string {
  if (!iso) return '제한 없음';

  const date = new Date(iso);

  if (Number.isNaN(date.getTime())) return '-';

  return date.toLocaleString('ko-KR', {
    year: '2-digit',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}
