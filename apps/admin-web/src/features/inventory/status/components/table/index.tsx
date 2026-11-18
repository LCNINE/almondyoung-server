'use client';

import { useCallback, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import {
  useStockSummaryByGroup,
  useRebuildStockSummary,
  useAdjustStock,
  useWarehouses,
  useSuppliers,
} from '@/lib/services/inventory';
import { usePermissionCheck } from '@/hooks/use-permission';
import type {
  StockQueue,
  StockSummaryGroupSkuDto,
} from '@/lib/types/dto/inventory';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SimplePagination } from '@/components/simple-pagination';
import { cn } from '@/lib/utils';
import { StockHistoryDrawer } from '../stock-history-drawer';
import { AdjustStockDialog } from '../adjust-stock-dialog';
import { UnshippedOrdersDrawer } from '../unshipped-orders-drawer';

const PAGE_SIZE = 20;

const QUEUES: { value: StockQueue; label: string }[] = [
  { value: 'out_of_stock', label: '가용재고 없음' },
  { value: 'unshipped', label: '미발송 있음' },
  { value: 'below_safety_stock', label: '안정재고 미만' },
  { value: 'inbound_pending', label: '입고 예정' },
];

function toQueue(value: string | null): StockQueue | undefined {
  return QUEUES.find((queue) => queue.value === value)?.value;
}

export function InventoryStatusTable() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const queue = toQueue(searchParams.get('queue'));
  const warehouseId = searchParams.get('warehouseId') ?? '';
  const supplierId = searchParams.get('supplierId') ?? '';
  const q = searchParams.get('q') ?? '';
  const page = Number(searchParams.get('page')) || 1;

  const { data, isLoading, isFetching } = useStockSummaryByGroup({
    queue,
    warehouseId: warehouseId || undefined,
    supplierId: supplierId || undefined,
    search: q || undefined,
    page,
    limit: PAGE_SIZE,
  });
  const { data: warehouses } = useWarehouses();
  // ponytail: 공급처는 한 번에 100개까지만 받는다. 넘으면 검색형 선택으로 바꾼다.
  const { data: suppliers } = useSuppliers({ limit: 100 });

  const [searchInput, setSearchInput] = useState(q);
  const [historyRow, setHistoryRow] = useState<StockSummaryGroupSkuDto | null>(
    null
  );
  const [adjustRow, setAdjustRow] = useState<StockSummaryGroupSkuDto | null>(
    null
  );
  const [unshippedRow, setUnshippedRow] =
    useState<StockSummaryGroupSkuDto | null>(null);

  const rebuildMutation = useRebuildStockSummary();
  const { canRun } = usePermissionCheck();
  const canAdjust = canRun(useAdjustStock);
  const canRebuild = canRun(useRebuildStockSummary);

  const setParams = useCallback(
    (changes: Record<string, string | undefined>) => {
      const params = new URLSearchParams(searchParams.toString());

      for (const [key, value] of Object.entries(changes)) {
        if (value) params.set(key, value);
        else params.delete(key);
      }

      if (!('page' in changes)) params.delete('page');

      router.replace(`${pathname}?${params.toString()}`);
    },
    [pathname, router, searchParams]
  );

  const handleRebuild = async (row: StockSummaryGroupSkuDto) => {
    try {
      await rebuildMutation.mutateAsync({
        skuId: row.skuId,
        warehouseId: row.warehouseId,
      });
      toast.success('재고 요약이 재구축되었습니다.');
    } catch {
      toast.error('재구축에 실패했습니다.');
    }
  };

  const groups = data?.data ?? [];
  const totalPages = Math.max(1, Math.ceil((data?.total ?? 0) / PAGE_SIZE));
  const showWarehouse = !warehouseId;

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 px-2 py-3">
        <span className="text-xs font-medium text-muted-foreground">
          업무 큐
        </span>
        {QUEUES.map((item) => (
          <Button
            key={item.value}
            type="button"
            size="sm"
            variant={queue === item.value ? 'default' : 'outline'}
            className="h-7 text-xs"
            onClick={() =>
              setParams({
                queue: queue === item.value ? undefined : item.value,
              })
            }
          >
            {item.label}
          </Button>
        ))}

        <span className="flex-1" />

        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          창고
          <select
            className="h-7 rounded-md border bg-background px-2 text-xs text-foreground"
            value={warehouseId}
            onChange={(e) => setParams({ warehouseId: e.target.value })}
          >
            <option value="">전체</option>
            {(warehouses ?? []).map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </label>

        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          공급처
          <select
            className="h-7 rounded-md border bg-background px-2 text-xs text-foreground"
            value={supplierId}
            onChange={(e) => setParams({ supplierId: e.target.value })}
          >
            <option value="">전체</option>
            {(suppliers?.data ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            setParams({ q: searchInput.trim() || undefined });
          }}
        >
          <Input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="SKU명/코드/상품명 검색"
            className="h-7 w-56 text-xs"
          />
        </form>
      </div>

      <div className={cn('overflow-x-auto', isFetching && 'opacity-70')}>
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
              <th className="w-[30%] px-3 py-2 font-medium">상품정보</th>
              <th className="px-3 py-2 font-medium">옵션</th>
              <th className="px-3 py-2 font-medium">위치</th>
              <th className="px-3 py-2 text-right font-medium">재고</th>
              <th className="px-3 py-2 text-right font-medium">
                미발송(자사몰)
              </th>
              <th className="px-3 py-2 text-right font-medium">부족</th>
              <th className="px-3 py-2 text-right font-medium">안정재고</th>
              <th className="px-3 py-2 font-medium" />
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td
                  colSpan={8}
                  className="px-3 py-10 text-center text-muted-foreground"
                >
                  불러오는 중…
                </td>
              </tr>
            )}
            {!isLoading && groups.length === 0 && (
              <tr>
                <td
                  colSpan={8}
                  className="px-3 py-10 text-center text-muted-foreground"
                >
                  재고 데이터가 없습니다.
                </td>
              </tr>
            )}
            {groups.map((group) =>
              group.skus.map((row, index) => (
                <tr
                  key={`${row.skuId}-${row.warehouseId}`}
                  className={cn(
                    'border-b',
                    row.belowSafetyStock && 'bg-orange-50 dark:bg-orange-950/30'
                  )}
                >
                  {index === 0 && (
                    <td
                      rowSpan={group.skus.length}
                      className="border-r bg-background px-3 py-2 align-top"
                    >
                      <div className="flex gap-3">
                        {group.imageUrl ? (
                          <img
                            src={group.imageUrl}
                            alt=""
                            className="size-14 flex-none rounded-md object-cover"
                          />
                        ) : (
                          <div className="size-14 flex-none rounded-md bg-muted" />
                        )}
                        <div className="flex flex-col gap-0.5">
                          <span className="font-semibold">
                            {group.groupName}
                          </span>
                          {group.groupCode && (
                            <span className="text-xs text-muted-foreground">
                              {group.groupCode}
                            </span>
                          )}
                        </div>
                      </div>
                    </td>
                  )}
                  <td className="px-3 py-2">
                    <div>{row.skuName}</div>
                    <div className="text-xs text-muted-foreground">
                      {row.skuCode}
                      {showWarehouse && ` · ${row.warehouseName}`}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {row.shelfPosition ?? '-'}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {row.currentQuantity}
                  </td>
                  <td
                    className={cn(
                      'px-3 py-2 text-right tabular-nums',
                      row.unshippedQuantity > 0
                        ? 'font-bold'
                        : 'text-muted-foreground'
                    )}
                  >
                    {row.unshippedQuantity}
                  </td>
                  <td
                    className={cn(
                      'px-3 py-2 text-right tabular-nums',
                      row.shortageQuantity > 0
                        ? 'font-bold'
                        : 'text-muted-foreground'
                    )}
                  >
                    {row.shortageQuantity}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {row.safetyStock ?? '-'}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">
                    <div className="flex justify-end gap-1">
                      {row.unshippedQuantity > 0 && (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs font-semibold"
                          onClick={() => setUnshippedRow(row)}
                        >
                          내역 보기
                        </Button>
                      )}
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-7 text-xs"
                        onClick={() => setHistoryRow(row)}
                      >
                        이력
                      </Button>
                      {canAdjust && (
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="h-7 text-xs"
                          onClick={() => setAdjustRow(row)}
                        >
                          조정
                        </Button>
                      )}
                      {canRebuild && (
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="h-7 text-xs"
                          onClick={() => void handleRebuild(row)}
                        >
                          재구축
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between px-2 py-3">
        <p className="text-xs text-muted-foreground">
          상품 단위로 정렬합니다. 마켓(네이버·쿠팡) 미발송은 셀메이트에서
          봅니다.
        </p>
        <SimplePagination
          currentPage={page}
          totalPages={totalPages}
          onPageChange={(next) => setParams({ page: String(next) })}
        />
      </div>

      <StockHistoryDrawer
        row={historyRow}
        open={!!historyRow}
        onOpenChange={(open) => {
          if (!open) setHistoryRow(null);
        }}
      />

      <UnshippedOrdersDrawer
        row={unshippedRow}
        open={!!unshippedRow}
        onOpenChange={(open) => {
          if (!open) setUnshippedRow(null);
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
