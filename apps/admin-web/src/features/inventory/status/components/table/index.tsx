'use client';

import { useCallback, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { DataTable } from '@/components/data-table';
import { useDataTable } from '@/hooks/use-data-table';
import { useInventoryStatusTableColumns } from '@/hooks/table/columns/use-inventory-status-table-columns';
import { useInventoryStatusTableFilters } from '@/hooks/table/filters/use-inventory-status-table-filters';
import { useInventoryStatusTableQuery } from '@/hooks/table/query/use-inventory-status-table-query';
import {
  useStockSummary,
  useRebuildStockSummary,
} from '@/lib/services/inventory';
import type { StockSummaryDto } from '@/lib/types/dto/inventory';
import { StockHistoryDrawer } from '../stock-history-drawer';
import { AdjustStockDialog } from '../adjust-stock-dialog';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';

const PAGE_SIZE = 20;

const INVENTORY_QUEUE_PRESETS = [
  { key: 'out_of_stock', label: '가용재고 없음', value: 'out_of_stock' },
  { key: 'reserved', label: '예약 있음', value: 'reserved' },
  { key: 'inbound_pending', label: '입고 예정', value: 'inbound_pending' },
  { key: 'outbound_pending', label: '출고 예정', value: 'outbound_pending' },
] as const;

function InventoryStatusWorkQueues() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const applyPreset = (quantityState: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete('page');
    if (searchParams.get('quantityState') === quantityState) {
      params.delete('quantityState');
    } else {
      params.set('quantityState', quantityState);
    }
    router.replace(`${pathname}?${params.toString()}`);
  };

  return (
    <div className="flex flex-wrap items-center gap-2 px-2 py-3">
      <span className="text-xs font-medium text-muted-foreground">업무 큐</span>
      {INVENTORY_QUEUE_PRESETS.map((preset) => (
        <Button
          key={preset.key}
          type="button"
          size="sm"
          variant={
            searchParams.get('quantityState') === preset.value
              ? 'default'
              : 'outline'
          }
          className="h-7 text-xs"
          onClick={() => applyPreset(preset.value)}
        >
          {preset.label}
        </Button>
      ))}
    </div>
  );
}

export function InventoryStatusTable() {
  const { searchParams: query } = useInventoryStatusTableQuery({
    pageSize: PAGE_SIZE,
  });
  const { data, isLoading, isFetching } = useStockSummary(query);
  const filters = useInventoryStatusTableFilters();
  const rebuildMutation = useRebuildStockSummary();

  const [historyRow, setHistoryRow] = useState<StockSummaryDto | null>(null);
  const [adjustRow, setAdjustRow] = useState<StockSummaryDto | null>(null);

  const handleRebuild = useCallback(
    async (row: StockSummaryDto) => {
      try {
        await rebuildMutation.mutateAsync({
          skuId: row.skuId,
          warehouseId: row.warehouseId,
        });
        toast.success('재고 요약이 재구축되었습니다.');
      } catch {
        toast.error('재구축에 실패했습니다.');
      }
    },
    [rebuildMutation]
  );

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
      <InventoryStatusWorkQueues />

      <DataTable
        table={table}
        isLoading={isLoading}
        isFetching={isFetching}
        count={total}
        pageSize={PAGE_SIZE}
        filters={filters}
        search
        searchPlaceholder="SKU명/코드/상품명 검색"
        noRecords={{ message: '재고 데이터가 없습니다.' }}
      />

      <StockHistoryDrawer
        row={historyRow}
        open={!!historyRow}
        onOpenChange={(open) => {
          if (!open) setHistoryRow(null);
        }}
      />

      <AdjustStockDialog
        row={adjustRow}
        open={!!adjustRow}
        onOpenChange={(open) => {
          if (!open) setAdjustRow(null);
        }}
      />
    </>
  );
}
