'use client';

import { createColumnHelper } from '@tanstack/react-table';
import { useMemo } from 'react';
import { DateCell } from '@/components/table/table-cells/common';
import type { TransferJobWithLineCountDto } from '@/lib/types/dto/inventory';

const columnHelper = createColumnHelper<TransferJobWithLineCountDto>();

const STATUS_LABELS: Record<string, string> = {
  pending: '대기',
  in_progress: '진행 중',
  completed: '완료',
};

type RowActions = {
  onDetail: (row: TransferJobWithLineCountDto) => void;
  onExecute: (row: TransferJobWithLineCountDto) => void;
};

export const useTransferJobsTableColumns = (actions: RowActions) => {
  return useMemo(
    () => [
      columnHelper.accessor('id', {
        header: '작업 ID',
        cell: ({ getValue }) => (
          <span className="font-mono text-xs text-muted-foreground">
            {getValue().slice(0, 8)}…
          </span>
        ),
      }),
      columnHelper.accessor('warehouseId', {
        header: '창고 ID',
        cell: ({ getValue }) => (
          <span className="font-mono text-xs text-muted-foreground">
            {getValue().slice(0, 8)}…
          </span>
        ),
      }),
      columnHelper.accessor('totalQuantity', {
        header: '총 수량',
        cell: ({ getValue }) => (
          <span className="tabular-nums">{getValue().toLocaleString('ko-KR')}</span>
        ),
      }),
      columnHelper.accessor('lineCount', {
        header: '라인 수',
        cell: ({ getValue }) => (
          <span className="tabular-nums">{getValue().toLocaleString('ko-KR')}</span>
        ),
      }),
      columnHelper.accessor('memo', {
        header: '메모',
        cell: ({ getValue }) => (
          <span className="max-w-[160px] truncate text-sm text-muted-foreground">
            {getValue() ?? '-'}
          </span>
        ),
      }),
      columnHelper.accessor('createdAt', {
        header: '생성일시',
        cell: ({ getValue }) => <DateCell value={getValue()} />,
      }),
      columnHelper.display({
        id: 'actions',
        header: '액션',
        cell: ({ row }) => (
          <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
            <button
              className="rounded px-2 py-1 text-xs hover:bg-muted"
              onClick={() => actions.onDetail(row.original)}
            >
              상세
            </button>
            <button
              className="rounded px-2 py-1 text-xs hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
              onClick={() => actions.onExecute(row.original)}
            >
              실행
            </button>
          </div>
        ),
      }),
    ],
    [actions]
  );
};
