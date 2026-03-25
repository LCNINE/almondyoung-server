'use client';

import { useQuestions } from '@/lib/services/qna';
import { useDataTable } from '@/hooks/use-data-table';
import { useQnaTableColumns } from '@/hooks/table/columns/use-qna-table-columns';
import { useQnaTableFilters } from '@/hooks/table/filters/use-qna-table-filters';
import { useQnaTableQuery } from '@/hooks/table/query/use-qna-table-query';
import { DataTable } from '@/components/data-table';

const PAGE_SIZE = 20;

export function QnaTable() {
  const { searchParams: query } = useQnaTableQuery({ pageSize: PAGE_SIZE });
  const { data, isLoading, isFetching } = useQuestions(query);
  const columns = useQnaTableColumns();
  const filters = useQnaTableFilters();

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
        { key: 'createdAt', label: '작성일' },
        { key: 'status', label: '상태' },
      ]}
      search
      navigateTo={(row) => `/cs/qna/${row.original.id}`}
      noRecords={{ message: 'Q&A 데이터가 없습니다.' }}
    />
  );
}
