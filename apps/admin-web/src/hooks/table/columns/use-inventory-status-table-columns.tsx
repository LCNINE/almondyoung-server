'use client';

import { createColumnHelper } from '@tanstack/react-table';
import { useMemo } from 'react';
import { DateCell } from '@/components/table/table-cells/common';
import type { StockSummaryDto } from '@/lib/types/dto/inventory';

const columnHelper = createColumnHelper<StockSummaryDto>();

type RowActions = {
  onHistory: (row: StockSummaryDto) => void;
  onAdjust: (row: StockSummaryDto) => void;
  onRebuild: (row: StockSummaryDto) => void;
};

export const useInventoryStatusTableColumns = (actions: RowActions) => {
  return useMemo(
    () => [
      columnHelper.accessor('skuName', { header: 'SKU명' }),
      columnHelper.accessor('skuId', {
        header: 'SKU ID',
        cell: ({ getValue }) => (
          <span className="font-mono text-xs text-muted-foreground">{getValue()}</span>
        ),
      }),
      columnHelper.accessor('warehouseName', { header: '창고' }),
      columnHelper.accessor('currentQuantity', {
        header: '현재 수량',
        cell: ({ getValue }) => (
          <span className="tabular-nums">{getValue().toLocaleString('ko-KR')}</span>
        ),
      }),
      columnHelper.accessor('availableQuantity', {
        header: '가용 수량',
        cell: ({ getValue }) => (
          <span className="tabular-nums">{getValue().toLocaleString('ko-KR')}</span>
        ),
      }),
      columnHelper.accessor('reservedQuantity', {
        header: '예약 수량',
        cell: ({ getValue }) => (
          <span className="tabular-nums text-muted-foreground">
            {getValue().toLocaleString('ko-KR')}
          </span>
        ),
      }),
      columnHelper.accessor('inboundPendingQuantity', {
        header: '입고 예정',
        cell: ({ getValue }) => (
          <span className="tabular-nums text-muted-foreground">
            {getValue().toLocaleString('ko-KR')}
          </span>
        ),
      }),
      columnHelper.accessor('outboundPendingQuantity', {
        header: '출고 예정',
        cell: ({ getValue }) => (
          <span className="tabular-nums text-muted-foreground">
            {getValue().toLocaleString('ko-KR')}
          </span>
        ),
      }),
      columnHelper.accessor('lastUpdated', {
        header: '최종 갱신',
        cell: ({ getValue }) => <DateCell value={getValue()} />,
      }),
      columnHelper.display({
        id: 'actions',
        header: '액션',
        cell: ({ row }) => (
          <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
            <button
              className="rounded px-2 py-1 text-xs hover:bg-muted"
              onClick={() => actions.onHistory(row.original)}
            >
              이력
            </button>
            <button
              className="rounded px-2 py-1 text-xs hover:bg-muted"
              onClick={() => actions.onAdjust(row.original)}
            >
              조정
            </button>
            <button
              className="rounded px-2 py-1 text-xs hover:bg-muted"
              onClick={() => actions.onRebuild(row.original)}
            >
              재구축
            </button>
          </div>
        ),
      }),
    ],
    [actions]
  );
};
