'use client';

import { useMemo } from 'react';
import { usePaymentIntentList } from '@/lib/services/wallet';
import { useDataTable } from '@/hooks/use-data-table';
import { usePaymentIntentTableColumns } from '@/hooks/table/columns/use-payment-intent-table-columns';
import { usePaymentIntentTableFilters } from '@/hooks/table/filters/use-payment-intent-table-filters';
import { usePaymentIntentTableQuery } from '@/hooks/table/query/use-payment-intent-table-query';
import { useUserNames } from '@/hooks/use-user-names';
import { DataTable } from '@/components/data-table';

const PAGE_SIZE = 20;

export function PaymentIntentTable() {
  const { searchParams: query } = usePaymentIntentTableQuery({
    pageSize: PAGE_SIZE,
  });
  const { data, isLoading, isFetching } = usePaymentIntentList(query);
  const userIds = useMemo(
    () =>
      data?.data
        .map((p) => p.userId)
        .filter((id): id is string => Boolean(id)) ?? [],
    [data?.data]
  );
  const userMap = useUserNames(userIds);
  const columns = usePaymentIntentTableColumns({ userMap });
  const filters = usePaymentIntentTableFilters();

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
      orderBy={[
        { key: 'createdAt', label: '생성일' },
        { key: 'payableAmount', label: '결제 금액' },
      ]}
      search
      navigateTo={(row) => `/payments/${row.original.id}`}
      noRecords={{ message: '결제 내역이 없습니다.' }}
    />
  );
}
