'use client';

import { useCallback, useEffect, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  useStockSummaryByGroup,
  useAdjustStock,
  useWarehouses,
  useSuppliers,
} from '@/lib/services/inventory';
import { usePermissionCheck } from '@/hooks/use-permission';
import type {
  StockQueue,
  StockSummaryGroupDto,
  StockSummaryGroupSkuDto,
} from '@/lib/types/dto/inventory';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { SimplePagination } from '@/components/simple-pagination';
import { cn } from '@/lib/utils';
import { StockHistoryDrawer } from '../stock-history-drawer';
import { UnshippedOrdersDrawer } from '../unshipped-orders-drawer';
import { AdjustGroupDialog } from '../adjust-group-dialog';

const PAGE_SIZE = 20;
const WAREHOUSE_KEY = 'inventory-status:warehouseId';

// 상품 대표 이미지는 공개 파일이라 프록시 없이 file-service 공개 주소로 바로 받는다(타임세일 이미지와 같은 방식).
const PUBLIC_FILE_BASE = (
  process.env.NEXT_PUBLIC_FILE_PUBLIC_URL ?? 'https://file.almondyoung.com'
).replace(/\/$/, '');

const QUEUES: StockQueue[] = [
  'unshipped',
  'shortage',
  'below_safety_stock',
  'out_of_stock',
];

const fmt = (n: number) => n.toLocaleString('ko-KR');

function toQueues(value: string | null): StockQueue[] {
  const picked = value?.split(',') ?? [];

  return QUEUES.filter((queue) => picked.includes(queue));
}

function readSavedWarehouse(): string | null {
  try {
    return window.localStorage.getItem(WAREHOUSE_KEY);
  } catch {
    return null;
  }
}

function saveWarehouse(id: string) {
  try {
    if (id) window.localStorage.setItem(WAREHOUSE_KEY, id);
    else window.localStorage.removeItem(WAREHOUSE_KEY);
  } catch {
    // 저장이 막혀 있어도 화면은 그대로 쓴다
  }
}

function Qty({ value, muted }: { value: number; muted?: boolean }) {
  return (
    <span className="tabular-nums">
      <span className={cn('font-bold', muted && 'font-normal')}>
        {fmt(value)}
      </span>
      <span className="ml-0.5 text-xs text-muted-foreground">개</span>
    </span>
  );
}

function Dash() {
  return <span className="text-muted-foreground/40">–</span>;
}

export function InventoryStatusTable() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const queues = toQueues(searchParams.get('queue'));
  const warehouseId = searchParams.get('warehouseId') ?? '';
  const supplierId = searchParams.get('supplierId') ?? '';
  const q = searchParams.get('q') ?? '';
  const page = Number(searchParams.get('page')) || 1;

  const { data, isLoading, isFetching } = useStockSummaryByGroup({
    queue: queues.length ? queues : undefined,
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
  const [unshippedRow, setUnshippedRow] =
    useState<StockSummaryGroupSkuDto | null>(null);
  const [adjustGroup, setAdjustGroup] = useState<StockSummaryGroupDto | null>(
    null
  );

  const { canRun } = usePermissionCheck();
  const canAdjust = canRun(useAdjustStock);

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

  // 창고 "전체"는 모든 창고를 계산해 느리다 — 마지막으로 고른 창고로 연다.
  useEffect(() => {
    if (searchParams.has('warehouseId')) return;

    const saved = readSavedWarehouse();

    if (saved) setParams({ warehouseId: saved });
  }, [searchParams, setParams]);

  const groups = data?.data ?? [];
  const summary = data?.summary;
  const totalPages = Math.max(1, Math.ceil((data?.total ?? 0) / PAGE_SIZE));
  const showWarehouse = !warehouseId;

  const cards: {
    queue: StockQueue;
    label: string;
    value?: number;
    unit: string;
  }[] = [
    {
      queue: 'unshipped',
      label: '미발송 있는 상품',
      value: summary?.unshippedProducts,
      unit: '개',
    },
    {
      queue: 'shortage',
      label: '부족 수량 합계',
      value: summary?.shortageQuantity,
      unit: summary ? `개 · 옵션 ${fmt(summary.shortageOptions)}개` : '개',
    },
    {
      queue: 'below_safety_stock',
      label: '안정재고 미만 옵션',
      value: summary?.belowSafetyOptions,
      unit: '개',
    },
    {
      queue: 'out_of_stock',
      label: '가용재고 없는 옵션',
      value: summary?.emptyOptions,
      unit: '개',
    },
  ];

  return (
    <>
      <div className="grid grid-cols-2 gap-3 px-2 pt-2 lg:grid-cols-4">
        {cards.map((card) => (
          <button
            key={card.queue}
            type="button"
            aria-pressed={queues.includes(card.queue)}
            onClick={() => {
              const next = queues.includes(card.queue)
                ? queues.filter((item) => item !== card.queue)
                : [...queues, card.queue];

              setParams({ queue: next.join(',') || undefined });
            }}
            className={cn(
              'flex flex-col gap-1 rounded-lg border bg-background px-4 py-3 text-left transition-colors hover:bg-muted/40',
              queues.includes(card.queue) &&
                'border-2 border-foreground px-[15px] py-[11px]'
            )}
          >
            <span className="text-[13px] font-medium text-muted-foreground">
              {card.label}
            </span>
            <span className="text-[28px] font-extrabold leading-tight tabular-nums">
              {card.value === undefined ? (
                <Skeleton className="my-1.5 h-7 w-16" />
              ) : (
                <>
                  {fmt(card.value)}
                  <span className="ml-1 text-sm font-normal text-muted-foreground">
                    {card.unit}
                  </span>
                </>
              )}
            </span>
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2 px-2 py-3">
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          창고
          <select
            className="h-8 w-44 rounded-md border bg-background px-2 text-sm text-foreground"
            value={warehouseId}
            onChange={(e) => {
              saveWarehouse(e.target.value);
              setParams({ warehouseId: e.target.value });
            }}
          >
            <option value="">전체 (느림)</option>
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
            className="h-8 w-44 rounded-md border bg-background px-2 text-sm text-foreground"
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
          className="ml-auto"
          onSubmit={(e) => {
            e.preventDefault();
            setParams({ q: searchInput.trim() || undefined });
          }}
        >
          <Input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="SKU명/코드/상품명 검색"
            className="h-8 w-60 text-sm"
          />
        </form>
      </div>

      <div
        className={cn(
          'overflow-x-auto px-2',
          isFetching && !isLoading && 'opacity-70'
        )}
      >
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="whitespace-nowrap bg-muted/40 text-left text-[13px] text-foreground/80 [&>th]:border [&>th]:px-3 [&>th]:py-2.5 [&>th]:font-semibold">
              <th className="w-[30%]">상품정보</th>
              <th>옵션</th>
              <th>위치</th>
              <th className="text-right">재고</th>
              <th className="text-right">미발송</th>
              <th>부족</th>
              <th className="text-right">안정재고</th>
              <th className="text-center">기능</th>
            </tr>
          </thead>
          <tbody>
            {isLoading &&
              Array.from({ length: 5 }, (_, i) => (
                <tr key={i} className="[&>td]:border [&>td]:px-3 [&>td]:py-4">
                  {Array.from({ length: 8 }, (_, j) => (
                    <td key={j}>
                      <Skeleton className="h-4 w-full" />
                    </td>
                  ))}
                </tr>
              ))}
            {!isLoading && groups.length === 0 && (
              <tr>
                <td
                  colSpan={8}
                  className="border px-3 py-10 text-center text-muted-foreground"
                >
                  조건에 맞는 상품이 없습니다.
                </td>
              </tr>
            )}
            {groups.map((group) =>
              group.skus.map((row, index) => {
                const lacking =
                  row.safetyStock !== null && row.belowSafetyStock
                    ? row.safetyStock - row.availableQuantity
                    : 0;

                return (
                  <tr
                    key={`${row.skuId}-${row.warehouseId}`}
                    className="[&>td]:border [&>td]:px-3"
                  >
                    {index === 0 && (
                      <td
                        rowSpan={group.skus.length}
                        className="py-3 align-top"
                      >
                        <a
                          href={
                            group.masterId
                              ? `/mall/products-list/${group.masterId}`
                              : undefined
                          }
                          target="_blank"
                          rel="noopener noreferrer"
                          className={cn(
                            'flex gap-3',
                            group.masterId &&
                              'hover:[&_.product-name]:underline'
                          )}
                        >
                          {group.imageFileId ? (
                            <img
                              src={`${PUBLIC_FILE_BASE}/files/public/${group.imageFileId}`}
                              alt=""
                              className="size-[72px] flex-none rounded-md border object-cover"
                            />
                          ) : (
                            <div className="size-[72px] flex-none rounded-md bg-muted" />
                          )}
                          <div className="flex flex-col gap-0.5 text-xs text-muted-foreground">
                            <span className="product-name text-sm font-bold text-foreground">
                              {group.groupName}
                            </span>
                            {group.groupCode && <span>{group.groupCode}</span>}
                          </div>
                        </a>
                      </td>
                    )}
                    <td className="py-2">
                      <div>{row.skuName}</div>
                      <div className="text-xs text-muted-foreground">
                        {row.skuCode}
                        {showWarehouse && ` · ${row.warehouseName}`}
                      </div>
                    </td>
                    <td className="whitespace-nowrap text-[13px] text-muted-foreground">
                      {row.shelfPosition ?? '–'}
                    </td>
                    <td className="whitespace-nowrap text-right">
                      <Qty value={row.onHandQuantity} />
                    </td>
                    <td className="whitespace-nowrap text-right">
                      {row.unshippedQuantity > 0 ? (
                        <button
                          type="button"
                          className="underline underline-offset-[3px] hover:text-foreground/70"
                          onClick={() => setUnshippedRow(row)}
                          aria-label={`${row.skuName} 미발송 내역 보기`}
                        >
                          <Qty value={row.unshippedQuantity} />
                        </button>
                      ) : (
                        <Dash />
                      )}
                    </td>
                    {row.shortageQuantity > 0 ? (
                      <td className="whitespace-nowrap bg-muted text-[15px] font-extrabold shadow-[inset_3px_0_0_hsl(var(--foreground))]">
                        {fmt(row.shortageQuantity)}개 부족
                      </td>
                    ) : (
                      <td>
                        <Dash />
                      </td>
                    )}
                    <td className="whitespace-nowrap text-right">
                      {row.safetyStock === null ? (
                        <Dash />
                      ) : (
                        <div className="flex flex-col items-end">
                          <Qty value={row.safetyStock} muted />
                          {lacking > 0 && (
                            <span className="text-xs text-muted-foreground">
                              {fmt(lacking)}개 모자람
                            </span>
                          )}
                        </div>
                      )}
                    </td>
                    {index === 0 && (
                      <td rowSpan={group.skus.length} className="text-center">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="h-8"
                            >
                              조정 ▾
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-48">
                            {canAdjust && (
                              <DropdownMenuItem
                                onSelect={() => setAdjustGroup(group)}
                              >
                                재고 조정
                              </DropdownMenuItem>
                            )}
                            {group.skus.length === 1 ? (
                              <DropdownMenuItem
                                onSelect={() => setHistoryRow(group.skus[0])}
                              >
                                재고 이력
                              </DropdownMenuItem>
                            ) : (
                              <DropdownMenuSub>
                                <DropdownMenuSubTrigger>
                                  재고 이력
                                </DropdownMenuSubTrigger>
                                <DropdownMenuSubContent>
                                  {group.skus.map((sku) => (
                                    <DropdownMenuItem
                                      key={`${sku.skuId}-${sku.warehouseId}`}
                                      onSelect={() => setHistoryRow(sku)}
                                    >
                                      {sku.skuName}
                                      {showWarehouse &&
                                        ` · ${sku.warehouseName}`}
                                    </DropdownMenuItem>
                                  ))}
                                </DropdownMenuSubContent>
                              </DropdownMenuSub>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </td>
                    )}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between px-2 py-3">
        <p className="text-xs text-muted-foreground">
          상품 단위로 정렬합니다(부족한 상품이 위). 가용 = 재고 − 미발송.
          마켓(네이버·쿠팡) 미발송은 셀메이트에서 봅니다.
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

      <AdjustGroupDialog
        group={adjustGroup}
        onClose={() => setAdjustGroup(null)}
      />
    </>
  );
}
