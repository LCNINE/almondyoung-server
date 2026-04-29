'use client';

import { DataTable } from '@/components/data-table';
import { useDataTable } from '@/hooks/use-data-table';
import { useMovementHistoryTableColumns } from '@/hooks/table/columns/use-movement-history-table-columns';
import { useMovementHistory } from '@/lib/services/inventory';
import { useQueryParams } from '@/hooks/use-query-params';

const PAGE_SIZE = 50;

export function MovementHistoryTable() {
  const { warehouseId, skuId, days } = useQueryParams(['warehouseId', 'skuId', 'days']);
  const { data, isLoading, isFetching } = useMovementHistory({
    warehouseId: warehouseId ?? undefined,
    skuId: skuId ?? undefined,
    days: days ? Number(days) : 7,
  });

  const columns = useMovementHistoryTableColumns();

  const rows = data?.logs ?? [];
  const total = data?.total ?? 0;

  const { table } = useDataTable({
    data: rows,
    columns,
    count: total,
    pageSize: PAGE_SIZE,
    getRowId: (row) => row.id,
  });

  return (
    <DataTable
      table={table}
      isLoading={isLoading}
      isFetching={isFetching}
      count={total}
      pageSize={PAGE_SIZE}
      noRecords={{ message: '이동 이력이 없습니다.' }}
    />
  );
}
