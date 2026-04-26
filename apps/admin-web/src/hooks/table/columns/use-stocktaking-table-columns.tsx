'use client';

import { createColumnHelper } from '@tanstack/react-table';
import { useMemo } from 'react';
import { DateCell } from '@/components/table/table-cells/common';
import type { StocktakingSessionDto } from '@/lib/types/dto/inventory';
import { Button } from '@/components/ui/button';

const columnHelper = createColumnHelper<StocktakingSessionDto>();

const STATUS_LABELS: Record<string, string> = {
  draft: '초안',
  in_progress: '진행 중',
  completed: '완료',
};

const STATUS_COLORS: Record<string, string> = {
  draft: 'text-muted-foreground',
  in_progress: 'text-blue-600',
  completed: 'text-green-600',
};

type RowActions = {
  onDetail: (row: StocktakingSessionDto) => void;
};

export const useStocktakingTableColumns = (actions: RowActions) => {
  return useMemo(
    () => [
      columnHelper.accessor('id', {
        header: '세션 ID',
        cell: ({ getValue }) => (
          <span className="font-mono text-xs text-muted-foreground">
            {getValue().slice(0, 8)}…
          </span>
        ),
      }),
      columnHelper.accessor('sessionName', {
        header: '세션명',
        cell: ({ getValue }) => <span className="font-medium">{getValue()}</span>,
      }),
      columnHelper.accessor('warehouseId', {
        header: '창고 ID',
        cell: ({ getValue }) => (
          <span className="font-mono text-xs text-muted-foreground">
            {getValue().slice(0, 8)}…
          </span>
        ),
      }),
      columnHelper.accessor('status', {
        header: '상태',
        cell: ({ getValue }) => {
          const v = getValue();
          return (
            <span className={`text-sm font-medium ${STATUS_COLORS[v] ?? ''}`}>
              {STATUS_LABELS[v] ?? v}
            </span>
          );
        },
      }),
      columnHelper.accessor('startedAt', {
        header: '시작일시',
        cell: ({ getValue }) => {
          const v = getValue();
          return v ? <DateCell value={v} /> : <span className="text-muted-foreground">-</span>;
        },
      }),
      columnHelper.accessor('completedAt', {
        header: '완료일시',
        cell: ({ getValue }) => {
          const v = getValue();
          return v ? <DateCell value={v} /> : <span className="text-muted-foreground">-</span>;
        },
      }),
      columnHelper.accessor('createdAt', {
        header: '생성일시',
        cell: ({ getValue }) => <DateCell value={getValue()} />,
      }),
      columnHelper.display({
        id: 'actions',
        header: '관리',
        cell: ({ row }) => (
          <div onClick={(e) => e.stopPropagation()}>
            <Button
              variant="outline"
              size="sm"
              onClick={() => actions.onDetail(row.original)}
            >
              상세
            </Button>
          </div>
        ),
      }),
    ],
    [actions]
  );
};
