'use client';

import { useCallback, useMemo, useState } from 'react';
import { DataTable } from '@/components/data-table';
import { useDataTable } from '@/hooks/use-data-table';
import { useProductsMatchingTableColumns } from '@/hooks/table/columns/use-products-matching-table-columns';
import { useProductsMatchingTableFilters } from '@/hooks/table/filters/use-products-matching-table-filters';
import { useProductsMatchingTableQuery } from '@/hooks/table/query/use-products-matching-table-query';
import { useMasters } from '@/lib/services/products';
import { useMastersBatchStats } from '@/lib/services/matching';
import type { MasterMatchingRowVM } from '@/lib/types/ui/matching';
import type { MasterDto } from '@/lib/types/dto/products';
import { VariantEditorDialog } from '../variant-editor-dialog';

const PAGE_SIZE = 20;

export function ProductsMatchingTable() {
  const { searchParams: query } = useProductsMatchingTableQuery({ pageSize: PAGE_SIZE });
  const { data, isLoading, isFetching } = useMasters(query);
  const filters = useProductsMatchingTableFilters();

  const masters = useMemo(() => data?.data ?? [], [data]);
  const total = data?.total ?? 0;

  const masterIds = useMemo(() => masters.map((m) => m.id), [masters]);
  const { data: statsArray } = useMastersBatchStats(masterIds);

  const statsMap = useMemo(() => {
    if (!statsArray) return {} as Record<string, NonNullable<typeof statsArray>[number]>;
    return Object.fromEntries(statsArray.map((s) => [s.masterId, s]));
  }, [statsArray]);

  const rows: MasterMatchingRowVM[] = useMemo(
    () =>
      masters.map((m) => ({
        ...m,
        matchingStats: statsMap[m.id] ?? null,
      })),
    [masters, statsMap]
  );

  const [editMaster, setEditMaster] = useState<MasterDto | null>(null);

  const handleEdit = useCallback((row: MasterMatchingRowVM) => setEditMaster(row), []);

  const columns = useProductsMatchingTableColumns({ onEdit: handleEdit });

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
        noRecords={{ message: '매칭 정보가 없습니다.' }}
      />

      <VariantEditorDialog
        master={editMaster}
        open={!!editMaster}
        onOpenChange={(open) => {
          if (!open) setEditMaster(null);
        }}
      />
    </>
  );
}
