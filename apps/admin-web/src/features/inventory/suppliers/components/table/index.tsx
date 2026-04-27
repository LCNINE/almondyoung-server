'use client';

import { useState } from 'react';
import { DataTable } from '@/components/data-table';
import { useDataTable } from '@/hooks/use-data-table';
import { useSuppliersTableColumns } from '@/hooks/table/columns/use-suppliers-table-columns';
import { useSuppliersTableFilters } from '@/hooks/table/filters/use-suppliers-table-filters';
import { useSuppliersTableQuery } from '@/hooks/table/query/use-suppliers-table-query';
import { useSuppliers } from '@/lib/services/inventory';
import type { SupplierDto } from '@/lib/types/dto/inventory';
import { Button } from '@/components/ui/button';
import { SupplierDetailDrawer } from '../supplier-detail-drawer';
import { SupplierFormDialog } from '../supplier-form-dialog';

const PAGE_SIZE = 20;

export function SuppliersTable() {
  const { searchParams: query } = useSuppliersTableQuery({ pageSize: PAGE_SIZE });
  const { data, isLoading, isFetching } = useSuppliers(query);
  const filters = useSuppliersTableFilters();

  const [detailRow, setDetailRow] = useState<SupplierDto | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const columns = useSuppliersTableColumns({ onDetail: setDetailRow });

  const rows = data?.data ?? [];
  const total = data?.total ?? 0;

  const { table } = useDataTable({
    data: rows,
    columns,
    count: total,
    pageSize: PAGE_SIZE,
    getRowId: (row) => row.id,
  });

  return (
    <>
      <div className="flex items-center gap-2 px-4 pt-4">
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          공급처 등록
        </Button>
      </div>

      <DataTable
        table={table}
        isLoading={isLoading}
        isFetching={isFetching}
        count={total}
        pageSize={PAGE_SIZE}
        filters={filters}
        noRecords={{ message: '등록된 공급처가 없습니다.' }}
      />

      <SupplierDetailDrawer
        row={detailRow}
        open={!!detailRow}
        onOpenChange={(open) => {
          if (!open) setDetailRow(null);
        }}
      />

      <SupplierFormDialog open={createOpen} onOpenChange={setCreateOpen} />
    </>
  );
}
