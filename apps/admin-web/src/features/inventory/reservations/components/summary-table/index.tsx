'use client';

import { DataTable } from '@/components/data-table';
import { useDataTable } from '@/hooks/use-data-table';
import { createColumnHelper } from '@tanstack/react-table';
import { useMemo } from 'react';
import type { ReservationSummaryDto } from '@/lib/types/dto/inventory';

const columnHelper = createColumnHelper<ReservationSummaryDto>();

const PAGE_SIZE = 20;

type Props = {
  data: ReservationSummaryDto[];
  isLoading: boolean;
};

export function ReservationSummaryTable({ data, isLoading }: Props) {
  const columns = useMemo(
    () => [
      columnHelper.accessor('skuId', {
        header: 'SKU ID',
        cell: ({ getValue }) => (
          <span className="font-mono text-xs text-muted-foreground">{getValue().slice(0, 8)}…</span>
        ),
      }),
      columnHelper.accessor('warehouseId', {
        header: '창고 ID',
        cell: ({ getValue }) => (
          <span className="font-mono text-xs text-muted-foreground">{getValue().slice(0, 8)}…</span>
        ),
      }),
      columnHelper.accessor('totalReserved', {
        header: '총 예약 수량',
        cell: ({ getValue }) => (
          <span className="tabular-nums">{getValue().toLocaleString('ko-KR')}</span>
        ),
      }),
      columnHelper.accessor('byTarget', {
        header: '대상별 현황',
        cell: ({ getValue }) => {
          const targets = getValue();
          if (!targets.length) return <span className="text-muted-foreground">-</span>;
          return (
            <div className="space-y-0.5 text-xs text-muted-foreground">
              {targets.map((t, i) => (
                <div key={i}>
                  {t.targetType}: {t.quantity.toLocaleString('ko-KR')}개
                </div>
              ))}
            </div>
          );
        },
      }),
    ],
    []
  );

  const { table } = useDataTable({
    data,
    columns,
    count: data.length,
    pageSize: PAGE_SIZE,
    getRowId: (row) => `${row.skuId}-${row.warehouseId}`,
  });

  return (
    <DataTable
      table={table}
      isLoading={isLoading}
      count={data.length}
      pageSize={PAGE_SIZE}
      noRecords={{ message: '예약 통계가 없습니다.' }}
    />
  );
}
