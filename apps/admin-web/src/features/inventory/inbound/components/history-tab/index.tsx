'use client';

import { useState } from 'react';
import { DataTable } from '@/components/data-table';
import { useDataTable } from '@/hooks/use-data-table';
import { useInboundHistoryTableColumns } from '@/hooks/table/columns/use-inbound-history-table-columns';
import { useInboundHistoryTableFilters } from '@/hooks/table/filters/use-inbound-history-table-filters';
import { useInboundHistoryTableQuery } from '@/hooks/table/query/use-inbound-history-table-query';
import { useInboundReceipts } from '@/lib/services/inventory';
import type { InboundReceiptDto } from '@/lib/types/dto/inventory';
import { ReceiptDetailDrawer } from './receipt-detail-drawer';

const PAGE_SIZE = 20;

export function HistoryTab() {
  const { searchParams } = useInboundHistoryTableQuery();
  const { data, isLoading, isFetching } = useInboundReceipts(searchParams);

  const [detailRow, setDetailRow] = useState<InboundReceiptDto | null>(null);

  const columns = useInboundHistoryTableColumns({ onDetail: setDetailRow });
  const filters = useInboundHistoryTableFilters();

  const rows = data?.items ?? [];
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
      <DataTable
        table={table}
        isLoading={isLoading}
        isFetching={isFetching}
        count={total}
        pageSize={PAGE_SIZE}
        filters={filters}
        noRecords={{ message: '입고 이력이 없습니다.' }}
      />

      <ReceiptDetailDrawer
        row={detailRow}
        open={!!detailRow}
        onOpenChange={(open) => {
          if (!open) setDetailRow(null);
        }}
      />
    </>
  );
}
