'use client';

import { useFulfillmentOrders } from '@/lib/services/orders/queries';
import { useDataTable } from '@/hooks/use-data-table';
import { useFulfillmentsTableColumns } from '@/hooks/table/columns/use-fulfillments-table-columns';
import { useFulfillmentsTableFilters } from '@/hooks/table/filters/use-fulfillments-table-filters';
import { useFulfillmentsTableQuery } from '@/hooks/table/query/use-fulfillments-table-query';
import { DataTable } from '@/components/data-table';

const PAGE_SIZE = 20;

export function FulfillmentsTable() {
  const { searchParams } = useFulfillmentsTableQuery({ pageSize: PAGE_SIZE });
  const { data, isLoading, isFetching } = useFulfillmentOrders(searchParams);
  const columns = useFulfillmentsTableColumns();
  const filters = useFulfillmentsTableFilters();

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
      orderBy={[{ key: 'createdAt', label: '생성일' }]}
      navigateTo={(row) => `/order/fulfillments/${row.original.id}`}
      noRecords={{ message: '출고주문이 없습니다.' }}
    />
  );
}
