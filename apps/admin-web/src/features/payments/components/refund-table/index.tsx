'use client';

import { useRefundList } from '@/lib/services/wallet';
import { useDataTable } from '@/hooks/use-data-table';
import { useRefundTableColumns } from '@/hooks/table/columns/use-refund-table-columns';
import { useRefundTableFilters } from '@/hooks/table/filters/use-refund-table-filters';
import { useRefundTableQuery } from '@/hooks/table/query/use-refund-table-query';
import { DataTable } from '@/components/data-table';

const PAGE_SIZE = 20;

export function RefundTable() {
  const { searchParams: query } = useRefundTableQuery({ pageSize: PAGE_SIZE });
  const { data, isLoading, isFetching } = useRefundList(query);
  const columns = useRefundTableColumns();
  const filters = useRefundTableFilters();

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
      filters={filters}
      noRecords={{ message: '환불 내역이 없습니다.' }}
    />
  );
}
