'use client';

import { useBlacklists } from '@/lib/services/blacklists';
import { useDataTable } from '@/hooks/use-data-table';
import { useBlacklistTableColumns } from '@/hooks/table/columns/use-blacklist-table-columns';
import { useBlacklistTableFilters } from '@/hooks/table/filters/use-blacklist-table-filters';
import { useBlacklistTableQuery } from '@/hooks/table/query/use-blacklist-table-query';
import { DataTable } from '@/components/data-table';

const PAGE_SIZE = 20;

export function BlacklistTable() {
  const { searchParams: query } = useBlacklistTableQuery({
    pageSize: PAGE_SIZE,
  });
  const { data, isLoading, isFetching } = useBlacklists(query);
  const columns = useBlacklistTableColumns();
  const filters = useBlacklistTableFilters();

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
      orderBy={[{ key: 'createdAt', label: '등록일' }]}
      search
      navigateTo={(row) => `/account/customer/${row.original.userId}`}
      noRecords={{ message: '블랙리스트 데이터가 없습니다.' }}
    />
  );
}
