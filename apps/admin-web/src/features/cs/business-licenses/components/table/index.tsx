'use client';

import { DataTable } from '@/components/data-table';
import { useDataTable } from '@/hooks/use-data-table';
import { useBusinessLicenseTableColumns } from '@/hooks/table/columns/use-business-license-table-columns';
import { useBusinessLicenseTableFilters } from '@/hooks/table/filters/use-business-license-table-filters';
import { useBusinessLicenseTableQuery } from '@/hooks/table/query/use-business-license-table-query';
import { useBusinessLicenses } from '@/lib/services/business-licenses';

const PAGE_SIZE = 20;

export function BusinessLicenseTable() {
  const { searchParams: query } = useBusinessLicenseTableQuery({ pageSize: PAGE_SIZE });
  const { data, isLoading, isFetching } = useBusinessLicenses(query);
  const columns = useBusinessLicenseTableColumns();
  const filters = useBusinessLicenseTableFilters();

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
      orderBy={[{ key: 'createdAt', label: '신청일' }]}
      navigateTo={(row) => `/cs/business-licenses/${row.original.id}`}
      noRecords={{ message: '사업자 인증 신청 데이터가 없습니다.' }}
    />
  );
}
