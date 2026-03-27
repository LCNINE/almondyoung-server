'use client';

import { useAdminUsers } from '@/lib/services/users';
import { useDataTable } from '@/hooks/use-data-table';
import { useUserTableColumns } from '@/hooks/table/columns/use-user-table-columns';
import { useUserTableFilters } from '@/hooks/table/filters/use-user-table-filters';
import { useUserTableQuery } from '@/hooks/table/query/use-user-table-query';
import { DataTable } from '@/components/data-table';

const PAGE_SIZE = 20;

export function UserTable() {
  const { searchParams: query } = useUserTableQuery({ pageSize: PAGE_SIZE });
  const adminQuery = { ...query, roleName: 'admin,master' };
  const { data, isLoading, isFetching } = useAdminUsers(adminQuery);
  const columns = useUserTableColumns();
  const filters = useUserTableFilters();

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
        { key: 'loginId', label: '로그인 ID' },
        { key: 'email', label: '이메일' },
        { key: 'createdAt', label: '가입일' },
      ]}
      search
      navigateTo={(row) => `/users/${row.original.id}`}
      noRecords={{ message: '회원 데이터가 없습니다.' }}
    />
  );
}
