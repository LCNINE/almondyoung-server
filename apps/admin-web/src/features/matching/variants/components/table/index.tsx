'use client';

import { useCallback, useMemo, useState } from 'react';
import { DataTable } from '@/components/data-table';
import { useDataTable } from '@/hooks/use-data-table';
import { useVariantsMatchingTableColumns } from '@/hooks/table/columns/use-variants-matching-table-columns';
import { useVariantsMatchingTableFilters } from '@/hooks/table/filters/use-variants-matching-table-filters';
import { useVariantsMatchingTableQuery } from '@/hooks/table/query/use-variants-matching-table-query';
import { useMatchings } from '@/lib/services/matching';
import type { MatchingDto } from '@/lib/types/dto/matching';
import { VariantMatchingEditorDialog } from '../editor-dialog';

const PAGE_SIZE = 20;

export function VariantsMatchingTable() {
  const { searchParams: query } = useVariantsMatchingTableQuery({
    pageSize: PAGE_SIZE,
  });
  const { data, isLoading, isFetching } = useMatchings(query);
  const filters = useVariantsMatchingTableFilters();

  const rows = useMemo(() => data?.data ?? [], [data]);
  const total = data?.total ?? 0;

  const [editMatching, setEditMatching] = useState<MatchingDto | null>(null);

  const handleEdit = useCallback(
    (row: MatchingDto) => setEditMatching(row),
    []
  );

  const columns = useVariantsMatchingTableColumns({ onEdit: handleEdit });

  const { table } = useDataTable({
    data: rows,
    columns,
    count: total,
    pageSize: PAGE_SIZE,
    getRowId: (row) => row.id,
    enableRowSelection: false,
  });

  return (
    <>
      <DataTable
        table={table}
        filters={filters}
        isLoading={isLoading || isFetching}
        noRecords={{ message: '매칭 레코드가 없습니다.' }}
      />

      <VariantMatchingEditorDialog
        matching={editMatching}
        open={!!editMatching}
        onOpenChange={(open) => {
          if (!open) setEditMatching(null);
        }}
      />
    </>
  );
}
