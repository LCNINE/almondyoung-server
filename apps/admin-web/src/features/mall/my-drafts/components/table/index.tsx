'use client';

import { useMyDrafts } from '@/lib/services/products/queries';
import { useDataTable } from '@/hooks/use-data-table';
import { useMyDraftsTableColumns } from '@/hooks/table/columns/use-my-drafts-table-columns';
import { useMyDraftsTableQuery } from '@/hooks/table/query/use-my-drafts-table-query';
import { DataTable } from '@/components/data-table';
import { buildDraftEditPath } from '../../lib/draft-edit-path';

const PAGE_SIZE = 20;

export function MyDraftsTable() {
  const { searchParams: query } = useMyDraftsTableQuery({
    pageSize: PAGE_SIZE,
  });
  const { data, isLoading, isFetching } = useMyDrafts(query);
  const columns = useMyDraftsTableColumns();

  const { table } = useDataTable({
    data: data?.data ?? [],
    columns,
    count: data?.total,
    pageSize: PAGE_SIZE,
    getRowId: (row) => row.versionId,
  });

  return (
    <DataTable
      table={table}
      isLoading={isLoading}
      isFetching={isFetching}
      count={data?.total ?? 0}
      pageSize={PAGE_SIZE}
      search
      orderBy={[
        { key: 'updatedAt', label: '최종수정일' },
        { key: 'createdAt', label: '등록일' },
      ]}
      navigateTo={(row) =>
        buildDraftEditPath(row.original.masterId, row.original.versionId)
      }
      noRecords={{ message: '작성 중인 임시저장 상품이 없습니다.' }}
    />
  );
}
