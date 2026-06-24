'use client';

import { useCustomersWithPagination } from '@/lib/services/customers';
import { useDataTable } from '@/hooks/use-data-table';
import { useCustomerTableColumns } from '@/hooks/table/columns/use-customer-table-columns';
import { useCustomerTableFilters } from '@/hooks/table/filters/use-customer-table-filters';
import { useCustomerTableQuery } from '@/hooks/table/query/use-customer-table-query';
import { DataTable } from '@/components/data-table';

const PAGE_SIZE = 20;

export function CustomerTable() {
  const { searchParams: query } = useCustomerTableQuery({
    pageSize: PAGE_SIZE,
  });
  const { data, isLoading, isFetching } = useCustomersWithPagination(query);
  const columns = useCustomerTableColumns();
  const filters = useCustomerTableFilters();

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
        { key: 'username', label: '이름' },
        { key: 'email', label: '이메일' },
        { key: 'phoneNumber', label: '휴대전화' },
        { key: 'createdAt', label: '가입일' },
        { key: 'lastActivityAt', label: '최근 활동일' },
      ]}
      search
      navigateTo={(row) => `/customer-window/${row.original.id}`}
      openInNewWindow
      noRecords={{ message: '고객 데이터가 없습니다.' }}
    />
  );
}
