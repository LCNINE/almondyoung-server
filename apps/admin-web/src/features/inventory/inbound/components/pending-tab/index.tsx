'use client';

import { useState } from 'react';
import { DataTable } from '@/components/data-table';
import { useDataTable } from '@/hooks/use-data-table';
import { useInboundPendingTableColumns } from '@/hooks/table/columns/use-inbound-pending-table-columns';
import { useInboundPendingTableQuery } from '@/hooks/table/query/use-inbound-pending-table-query';
import { useExpectedArrivals } from '@/lib/services/inventory';
import { Button } from '@/components/ui/button';
import { ArrivalDetailDrawer } from './arrival-detail-drawer';
import { ReceiveDialog } from '../receive-dialog';
import { selectArrivalById } from '../detail-selection-model';

export function PendingTab() {
  const { warehouseId } = useInboundPendingTableQuery();
  const { data, isLoading, isFetching } = useExpectedArrivals(warehouseId);

  const rows = data?.arrivals ?? [];
  const total = rows.length;
  const [detailId, setDetailId] = useState<string | null>(null);
  const detailRow = selectArrivalById(rows, detailId);
  const [receiveOpen, setReceiveOpen] = useState(false);

  const columns = useInboundPendingTableColumns({
    onDetail: (row) => setDetailId(row.documentId),
  });

  const { table } = useDataTable({
    data: rows,
    columns,
    count: total,
    pageSize: 50,
    getRowId: (row) => row.documentId,
  });

  const defaultWarehouseId = warehouseId ?? '';

  return (
    <>
      <div className="flex items-center gap-2 px-4 pt-4">
        <Button size="sm" onClick={() => setReceiveOpen(true)} disabled={!defaultWarehouseId}>
          바로 입고
        </Button>
        {data && (
          <span className="text-sm text-muted-foreground">
            입고 대기 {data.totalDocuments}건 / 남은 수량 {data.totalOutstandingQuantity.toLocaleString()}개
          </span>
        )}
      </div>

      <DataTable
        table={table}
        isLoading={isLoading}
        isFetching={isFetching}
        count={total}
        pageSize={50}
        noRecords={{ message: '입고 대기 중인 발주가 없습니다.' }}
      />

      <ArrivalDetailDrawer
        row={detailRow}
        warehouseId={data?.warehouseId ?? ''}
        open={!!detailRow}
        onOpenChange={(open) => {
          if (!open) setDetailId(null);
        }}
      />

      <ReceiveDialog
        open={receiveOpen}
        onOpenChange={setReceiveOpen}
        warehouseId={defaultWarehouseId}
      />
    </>
  );
}
