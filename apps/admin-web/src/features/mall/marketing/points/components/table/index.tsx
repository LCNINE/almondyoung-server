'use client';

import { createColumnHelper } from '@tanstack/react-table';
import { useMemo } from 'react';
import { Badge } from '@/components/ui/badge';
import { useAllPointsEvents } from '@/lib/services/wallet';
import { usePointsEventsTableQuery } from '@/hooks/table/query/use-points-events-table-query';
import { useDataTable } from '@/hooks/use-data-table';
import { DataTable } from '@/components/data-table';
import { eventTypeConfig } from '@/hooks/table/columns/use-points-event-table-columns';
import type { PointsEventDto } from '@/lib/types/dto/wallet';

const PAGE_SIZE = 20;

const columnHelper = createColumnHelper<PointsEventDto>();

function useColumns() {
  return useMemo(
    () => [
      columnHelper.accessor('userId', {
        header: '사용자 ID',
        cell: ({ getValue }) => (
          <span className="font-mono text-xs text-muted-foreground">{getValue()}</span>
        ),
      }),
      columnHelper.accessor('eventType', {
        header: '유형',
        cell: ({ getValue }) => {
          const cfg = eventTypeConfig[getValue()] ?? { label: getValue(), variant: 'outline' as const };
          return <Badge variant={cfg.variant}>{cfg.label}</Badge>;
        },
      }),
      columnHelper.accessor('amount', {
        header: '금액',
        cell: ({ getValue }) => {
          const amount = getValue();
          const formatted = Math.abs(amount).toLocaleString('ko-KR');
          return (
            <span className={`font-mono font-medium ${amount > 0 ? 'text-green-600' : 'text-red-500'}`}>
              {amount >= 0 ? `+${formatted}` : `-${formatted}`}
            </span>
          );
        },
      }),
      columnHelper.accessor('reasonCode', {
        header: '사유',
        cell: ({ getValue }) => <span className="text-sm">{getValue() ?? '-'}</span>,
      }),
      columnHelper.accessor('id', {
        header: 'ID',
        cell: ({ getValue }) => (
          <span className="font-mono text-xs text-muted-foreground">{getValue().slice(0, 8)}…</span>
        ),
      }),
      columnHelper.accessor('createdAt', {
        header: '일시',
        cell: ({ getValue }) => (
          <span className="text-sm">{new Date(getValue()).toLocaleString('ko-KR')}</span>
        ),
      }),
    ],
    [],
  );
}

export function PointsEventsTable() {
  const query = usePointsEventsTableQuery(PAGE_SIZE);
  const { data, isLoading, isFetching } = useAllPointsEvents(query);
  const columns = useColumns();

  const { table } = useDataTable({
    data: data?.data ?? [],
    columns,
    count: data?.total,
    pageSize: PAGE_SIZE,
    getRowId: (row) => row.id,
  });

  return (
    <DataTable
      table={table}
      isLoading={isLoading}
      isFetching={isFetching}
      count={data?.total ?? 0}
      pageSize={PAGE_SIZE}
      noRecords={{ message: '적립금 내역이 없습니다.' }}
    />
  );
}
