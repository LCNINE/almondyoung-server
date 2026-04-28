'use client';

import { useState } from 'react';
import { DataTable } from '@/components/data-table';
import { useDataTable } from '@/hooks/use-data-table';
import { usePurchaseOrdersTableColumns } from '@/hooks/table/columns/use-purchase-orders-table-columns';
import { usePurchaseOrdersTableFilters } from '@/hooks/table/filters/use-purchase-orders-table-filters';
import { usePurchaseOrdersTableQuery } from '@/hooks/table/query/use-purchase-orders-table-query';
import { usePurchaseOrders } from '@/lib/services/inventory';
import type { PurchaseOrderDto } from '@/lib/types/dto/inventory';
import { Button } from '@/components/ui/button';
import { PurchaseOrderDetailDrawer } from '../purchase-order-detail-drawer';
import { PurchaseOrderFormDialog } from '../purchase-order-form-dialog';

const PAGE_SIZE = 20;

export function PurchaseOrdersTable() {
  const { searchParams: query } = usePurchaseOrdersTableQuery({ pageSize: PAGE_SIZE });
  const { data, isLoading, isFetching } = usePurchaseOrders(query);
  const filters = usePurchaseOrdersTableFilters();

  const [detailRow, setDetailRow] = useState<PurchaseOrderDto | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const columns = usePurchaseOrdersTableColumns({ onDetail: setDetailRow });

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
          발주 생성
        </Button>
      </div>

      <DataTable
        table={table}
        isLoading={isLoading}
        isFetching={isFetching}
        count={total}
        pageSize={PAGE_SIZE}
        filters={filters}
        noRecords={{ message: '등록된 발주가 없습니다.' }}
      />

      <PurchaseOrderDetailDrawer
        row={detailRow}
        open={!!detailRow}
        onOpenChange={(open) => {
          if (!open) setDetailRow(null);
        }}
      />

      <PurchaseOrderFormDialog open={createOpen} onOpenChange={setCreateOpen} />
    </>
  );
}
