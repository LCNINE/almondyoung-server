'use client';

import { useCallback, useState } from 'react';
import { DataTable } from '@/components/data-table';
import { useDataTable } from '@/hooks/use-data-table';
import { useInventoryStatusTableColumns } from '@/hooks/table/columns/use-inventory-status-table-columns';
import { useInventoryStatusTableFilters } from '@/hooks/table/filters/use-inventory-status-table-filters';
import { useInventoryStatusTableQuery } from '@/hooks/table/query/use-inventory-status-table-query';
import { useStockSummary, useRebuildStockSummary } from '@/lib/services/inventory';
import type { StockSummaryDto } from '@/lib/types/dto/inventory';
import { StockHistoryDrawer } from '../stock-history-drawer';
import { AdjustStockDialog } from '../adjust-stock-dialog';
import { toast } from 'sonner';

const PAGE_SIZE = 20;

export function InventoryStatusTable() {
  const { searchParams: query } = useInventoryStatusTableQuery({ pageSize: PAGE_SIZE });
  const { data, isLoading, isFetching } = useStockSummary(query);
  const filters = useInventoryStatusTableFilters();
  const rebuildMutation = useRebuildStockSummary();

  const [historyRow, setHistoryRow] = useState<StockSummaryDto | null>(null);
  const [adjustRow, setAdjustRow] = useState<StockSummaryDto | null>(null);

  const handleRebuild = useCallback(async (row: StockSummaryDto) => {
    try {
      await rebuildMutation.mutateAsync({ skuId: row.skuId, warehouseId: row.warehouseId });
      toast.success('재고 요약이 재구축되었습니다.');
    } catch {
      toast.error('재구축에 실패했습니다.');
    }
  }, [rebuildMutation]);

  const columns = useInventoryStatusTableColumns({
    onHistory: setHistoryRow,
    onAdjust: setAdjustRow,
    onRebuild: handleRebuild,
  });

  const rows = data?.data ?? [];
  const total = data?.total ?? 0;

  const { table } = useDataTable({
    data: rows,
    columns,
    count: total,
    pageSize: PAGE_SIZE,
    getRowId: (row) => `${row.skuId}-${row.warehouseId}`,
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
        search
        noRecords={{ message: '재고 데이터가 없습니다.' }}
      />

      <StockHistoryDrawer
        row={historyRow}
        open={!!historyRow}
        onOpenChange={(open) => { if (!open) setHistoryRow(null); }}
      />

      <AdjustStockDialog
        row={adjustRow}
        open={!!adjustRow}
        onOpenChange={(open) => { if (!open) setAdjustRow(null); }}
      />
    </>
  );
}
