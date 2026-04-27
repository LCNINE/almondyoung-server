'use client';

import { useState } from 'react';
import { DataTable } from '@/components/data-table';
import { useDataTable } from '@/hooks/use-data-table';
import { useInboundPendingTableColumns } from '@/hooks/table/columns/use-inbound-pending-table-columns';
import { useInboundPendingTableQuery } from '@/hooks/table/query/use-inbound-pending-table-query';
import { useInboundPending } from '@/lib/services/inventory';
import type { InboundPendingDto } from '@/lib/types/dto/inventory';
import { Button } from '@/components/ui/button';
import { PlanDetailDrawer } from './plan-detail-drawer';
import { ReceiveDialog } from '../receive-dialog';

export function PendingTab() {
  const { warehouseId } = useInboundPendingTableQuery();
  const { data, isLoading, isFetching } = useInboundPending(warehouseId);

  const [detailRow, setDetailRow] = useState<InboundPendingDto | null>(null);
  const [receiveOpen, setReceiveOpen] = useState(false);

  const columns = useInboundPendingTableColumns({ onDetail: setDetailRow });

  const rows = data?.pendingPlans ?? [];
  const total = rows.length;

  const { table } = useDataTable({
    data: rows,
    columns,
    count: total,
    pageSize: 50,
    getRowId: (row) => row.planId,
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
            대기 계획 {data.totalPendingPlans}건 / 미입고 {data.totalPendingQuantity.toLocaleString()}개
          </span>
        )}
      </div>

      <DataTable
        table={table}
        isLoading={isLoading}
        isFetching={isFetching}
        count={total}
        pageSize={50}
        noRecords={{ message: '대기 중인 입고 계획이 없습니다.' }}
      />

      <PlanDetailDrawer
        row={detailRow}
        open={!!detailRow}
        onOpenChange={(open) => {
          if (!open) setDetailRow(null);
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
