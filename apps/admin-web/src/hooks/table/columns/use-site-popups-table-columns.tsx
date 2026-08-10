'use client';

import { createColumnHelper } from '@tanstack/react-table';
import { useMemo } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DateCell } from '@/components/table/table-cells/common';
import type { SitePopupDto } from '@/lib/types/dto/products';
import {
  AUDIENCE_LABEL,
  CONTENT_TYPE_LABEL,
  PLACEMENT_LABEL,
} from '@/features/mall/popups/form';

const columnHelper = createColumnHelper<SitePopupDto>();

type RowActions = {
  onDetail: (row: SitePopupDto) => void;
  onDelete: (row: SitePopupDto) => void;
};

/**
 * 게시기간까지 반영한 실제 노출 상태. isActive 만 보면 "활성인데 기간이 지나
 * 안 보이는" 팝업을 활성으로 오인하게 된다.
 */
function displayState(popup: SitePopupDto): { label: string; variant: 'default' | 'secondary' | 'outline' } {
  if (!popup.isActive) return { label: '미사용', variant: 'secondary' };

  const now = Date.now();
  const start = popup.displayStartAt ? new Date(popup.displayStartAt).getTime() : null;
  const end = popup.displayEndAt ? new Date(popup.displayEndAt).getTime() : null;

  if (start !== null && now < start) return { label: '예약됨', variant: 'outline' };
  if (end !== null && now >= end) return { label: '종료됨', variant: 'secondary' };
  return { label: '노출 중', variant: 'default' };
}

export const useSitePopupsTableColumns = (actions: RowActions) => {
  return useMemo(
    () => [
      columnHelper.accessor('title', {
        header: '제목',
        cell: ({ getValue }) => <span className="text-sm font-medium">{getValue()}</span>,
      }),
      columnHelper.display({
        id: 'state',
        header: '상태',
        cell: ({ row }) => {
          const state = displayState(row.original);
          return <Badge variant={state.variant}>{state.label}</Badge>;
        },
      }),
      columnHelper.accessor('contentType', {
        header: '형식',
        cell: ({ getValue }) => (
          <Badge variant="outline">{CONTENT_TYPE_LABEL[getValue()] ?? getValue()}</Badge>
        ),
      }),
      columnHelper.accessor('placement', {
        header: '위치',
        cell: ({ getValue }) => (
          <span className="text-sm">{PLACEMENT_LABEL[getValue()] ?? getValue()}</span>
        ),
      }),
      columnHelper.accessor('audience', {
        header: '대상',
        cell: ({ getValue }) => (
          <span className="text-sm">{AUDIENCE_LABEL[getValue()] ?? getValue()}</span>
        ),
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
              {formatDate(displayStartAt)} ~ {formatDate(displayEndAt)}
            </span>
          );
        },
      }),
      columnHelper.accessor('sortOrder', {
        header: '순서',
        cell: ({ getValue }) => <span className="text-sm">{getValue()}</span>,
      }),
      columnHelper.accessor('updatedAt', {
        header: '수정일',
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

function formatDate(iso: string | null): string {
  if (!iso) return '제한 없음';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleDateString('ko-KR', { year: '2-digit', month: '2-digit', day: '2-digit' });
}
