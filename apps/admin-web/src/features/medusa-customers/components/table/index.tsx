'use client';

import { useMedusaCustomers } from '@/lib/services/medusa-customers';
import { useDataTable } from '@/hooks/use-data-table';
import { useMedusaCustomerTableColumns } from '@/hooks/table/columns/use-medusa-customer-table-columns';
import { useMedusaCustomerTableQuery } from '@/hooks/table/query/use-medusa-customer-table-query';
import { DataTable } from '@/components/data-table';

const PAGE_SIZE = 20;

export function MedusaCustomerTable() {
  const { searchParams: query } = useMedusaCustomerTableQuery({
    pageSize: PAGE_SIZE,
  });
  const { data, isLoading, isFetching } = useMedusaCustomers(query);
  const columns = useMedusaCustomerTableColumns();

  const { table } = useDataTable({
    data: data?.customers ?? [],
    columns,
    count: data?.count ?? 0,
    pageSize: PAGE_SIZE,
    getRowId: (row) => row.id,
  });

  return (
    <DataTable
      table={table}
      isLoading={isLoading}
      isFetching={isFetching}
      count={data?.count ?? 0}
      pageSize={PAGE_SIZE}
      orderBy={[
        { key: 'created_at', label: '가입일' },
        { key: 'email', label: '이메일' },
      ]}
      search
      navigateTo={(row) =>
        `/account/sales-channel/medusa-customers/${row.original.id}`
      }
      noRecords={{ message: '메두사 고객 데이터가 없습니다.' }}
    />
  );
}
