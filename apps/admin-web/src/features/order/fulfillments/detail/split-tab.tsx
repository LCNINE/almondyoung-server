'use client';

import { useState, useCallback } from 'react';
import { toast } from 'sonner';
import Link from 'next/link';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertTriangle, ExternalLink, CheckCircle2 } from 'lucide-react';
import { useSplitFulfillmentOrder } from '@/lib/services/orders';
import type {
  FulfillmentOrderDetail,
  FulfillmentOrderItemSummary,
  FulfillmentOrder,
} from '@/lib/types/dto/fulfillment';

function getSplittableQty(item: FulfillmentOrderItemSummary): number {
  return item.shippedQty === 0 ? item.qty - 1 : item.qty - item.shippedQty;
}

function extractErrorMessage(err: unknown): string {
  if (err && typeof err === 'object') {
    const axiosErr = err as { response?: { data?: { message?: string | string[] } } };
    const msg = axiosErr.response?.data?.message;
    if (Array.isArray(msg)) return msg.join(', ');
    if (typeof msg === 'string') return msg;
  }
  return '알 수 없는 오류가 발생했습니다.';
}

interface SplitRow {
  item: FulfillmentOrderItemSummary;
  splitQty: string;
}

interface SplitResult {
  newFo: FulfillmentOrder;
  /** FOI별 분할 전 상태 스냅샷 (검증용) */
  preSnapshot: {
    foiId: string;
    skuId: string;
    originalQty: number;
    originalReservedQty: number;
    splitQty: number;
  }[];
}

export function SplitTab({ fo }: { fo: FulfillmentOrderDetail }) {
  const split = useSplitFulfillmentOrder(fo.id);
  const [result, setResult] = useState<SplitResult | null>(null);

  // Core가 계산한 adminAvailableActions 기준 — terminal이거나 shipped evidence가 있으면 split 불가
  const blocked = !fo.adminAvailableActions.includes('split');

  // 분할 가능 아이템만 초기화
  const splittableItems = fo.items.filter((i) => i.qty - i.shippedQty > 0);

  const [rows, setRows] = useState<SplitRow[]>(() =>
    splittableItems.map((item) => ({ item, splitQty: '' }))
  );

  const updateQty = useCallback((id: string, value: string) => {
    setRows((prev) =>
      prev.map((r) => (r.item.id === id ? { ...r, splitQty: value } : r))
    );
  }, []);

  const handleSplit = async () => {
    const moves = rows
      .map((r) => ({ foiId: r.item.id, qty: parseInt(r.splitQty, 10) }))
      .filter((m) => m.qty > 0);

    if (moves.length === 0) {
      toast.error('분할할 수량을 1 이상 입력하세요.');
      return;
    }

    // 클라이언트 사전 검증
    for (const m of moves) {
      const row = rows.find((r) => r.item.id === m.foiId)!;
      const splittable = getSplittableQty(row.item);
      if (m.qty > splittable) {
        toast.error(
          `FOI ${m.foiId.substring(0, 8)}…: 분할 수량(${m.qty})이 분할 가능 수량(${splittable})을 초과합니다.`
        );
        return;
      }
    }

    const preSnapshot = moves.map((m) => {
      const row = rows.find((r) => r.item.id === m.foiId)!;
      return {
        foiId: m.foiId,
        skuId: row.item.skuId,
        originalQty: row.item.qty,
        originalReservedQty: row.item.reservedQty,
        splitQty: m.qty,
      };
    });

    try {
      const newFo = (await split.mutateAsync({
        items: moves.map((m) => ({
          fulfillmentOrderItemId: m.foiId,
          quantity: m.qty,
        })),
      })) as FulfillmentOrder;

      setResult({ newFo, preSnapshot });
      toast.success('FO 분할 완료. 원본/신규 FO를 확인하세요.');
    } catch (err) {
      toast.error(`분할 실패: ${extractErrorMessage(err)}`);
    }
  };

  // 입력된 수량 요약
  const totalSplitQty = rows.reduce((sum, r) => {
    const n = parseInt(r.splitQty, 10);
    return sum + (isNaN(n) ? 0 : n);
  }, 0);

  return (
    <div className="flex flex-col gap-6 py-4">
      {/* 분할 불가 guard */}
      {blocked && (
        <Alert variant="destructive">
          <AlertTriangle />
          <AlertDescription>
            현재 FO 상태({fo.status})에서는 분할이 불가합니다.
            분할은 shipped/completed/canceled 이전 상태이고 출고된 수량(shippedQty)이 없을 때만 허용됩니다.
          </AlertDescription>
        </Alert>
      )}

      {/* 분할 성공 결과 */}
      {result && <SplitResultPanel fo={fo} result={result} />}

      {/* 분할 폼 */}
      {!blocked && !result && (
        <>
          <section>
            <h3 className="mb-2 text-sm font-semibold">FOI별 분할 수량 입력</h3>
            <p className="mb-3 text-xs text-muted-foreground">
              분할 가능 수량 = shippedQty가 없으면 qty−1, 있으면 qty−shippedQty. 원본 FO에는 최소 1개가 남아야 합니다.
            </p>

            {splittableItems.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                모든 아이템이 출고 완료되어 분할할 수 없습니다.
              </p>
            ) : (
              <div className="overflow-auto rounded border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>FOI ID</TableHead>
                      <TableHead>SKU ID</TableHead>
                      <TableHead className="text-right">원본 qty</TableHead>
                      <TableHead className="text-right">출고됨</TableHead>
                      <TableHead className="text-right">예약됨</TableHead>
                      <TableHead className="text-right">
                        <span title="shippedQty=0이면 qty-1, 아니면 qty-shippedQty (원본에 최소 1개 잔류)">분할 가능</span>
                      </TableHead>
                      <TableHead>분할 수량</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {fo.items.map((item) => {
                      const splittable = getSplittableQty(item);
                      const disabled = splittable <= 0;
                      const row = rows.find((r) => r.item.id === item.id);
                      const splitQtyNum = parseInt(row?.splitQty ?? '', 10);
                      const isOverQty = !isNaN(splitQtyNum) && splitQtyNum > splittable;

                      return (
                        <TableRow
                          key={item.id}
                          className={disabled ? 'opacity-40' : undefined}
                        >
                          <TableCell className="font-mono text-xs text-muted-foreground">
                            {item.id.substring(0, 8)}…
                          </TableCell>
                          <TableCell className="font-mono text-xs">
                            {item.skuId.substring(0, 8)}…
                          </TableCell>
                          <TableCell className="text-right tabular-nums">{item.qty}</TableCell>
                          <TableCell className="text-right tabular-nums">
                            {item.shippedQty > 0 ? (
                              <Badge variant="secondary">{item.shippedQty}</Badge>
                            ) : (
                              0
                            )}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">{item.reservedQty}</TableCell>
                          <TableCell className="text-right tabular-nums font-medium">
                            {disabled ? (
                              <span className="text-muted-foreground">0</span>
                            ) : (
                              <Badge variant="secondary" className="tabular-nums">
                                {splittable}
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell>
                            {disabled ? (
                              <span className="text-xs text-muted-foreground">분할 불가</span>
                            ) : (
                              <div className="flex flex-col gap-0.5">
                                <Input
                                  type="number"
                                  min={0}
                                  max={splittable}
                                  placeholder="0"
                                  value={row?.splitQty ?? ''}
                                  onChange={(e) => updateQty(item.id, e.target.value)}
                                  className={`w-24 ${isOverQty ? 'border-destructive' : ''}`}
                                />
                                {isOverQty && (
                                  <span className="text-xs text-destructive">
                                    최대 {splittable}{item.shippedQty === 0 && ' (원본에 최소 1개 잔류)'}
                                  </span>
                                )}
                              </div>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </section>

          {splittableItems.length > 0 && (
            <div className="flex items-center gap-4">
              <div className="text-sm text-muted-foreground">
                분할 예정:{' '}
                <span className="font-medium tabular-nums text-foreground">
                  {totalSplitQty}개
                </span>
              </div>
              <Button
                onClick={handleSplit}
                disabled={split.isPending || totalSplitQty === 0}
              >
                {split.isPending ? '분할 중...' : 'FO 분할 실행'}
              </Button>
            </div>
          )}
        </>
      )}

      {/* 분할 완료 후 재분할 */}
      {result && (
        <Button
          variant="outline"
          size="sm"
          className="self-start"
          onClick={() => {
            setResult(null);
            setRows(splittableItems.map((item) => ({ item, splitQty: '' })));
          }}
        >
          다시 분할
        </Button>
      )}
    </div>
  );
}

function SplitResultPanel({
  fo,
  result,
}: {
  fo: FulfillmentOrderDetail;
  result: SplitResult;
}) {
  return (
    <section className="rounded-md border p-4">
      <div className="mb-3 flex items-center gap-2">
        <Badge variant="secondary" className="h-6 w-6 rounded-full p-0">
          <CheckCircle2 className="h-3.5 w-3.5" />
        </Badge>
        <h3 className="text-sm font-semibold">분할 완료</h3>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {/* 원본 FO */}
        <div className="rounded-md border p-3">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs font-semibold uppercase text-muted-foreground">원본 FO</p>
            <Link
              href={`/order/fulfillments/${fo.id}`}
              className="flex items-center gap-0.5 text-xs text-primary hover:underline"
            >
              상세 <ExternalLink className="h-3 w-3" />
            </Link>
          </div>
          <p className="font-mono text-xs text-muted-foreground">{fo.id}</p>
          <p className="mt-2 text-xs text-muted-foreground">
            분할 전 qty 합: {result.preSnapshot.reduce((s, p) => s + p.originalQty, 0)}
            {' → '}분할 후는 FO 상세에서 확인
          </p>
        </div>

        {/* 신규 FO */}
        <div className="rounded-md border p-3">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs font-semibold uppercase text-muted-foreground">신규 FO</p>
            <Link
              href={`/order/fulfillments/${result.newFo.id}`}
              className="flex items-center gap-0.5 text-xs text-primary hover:underline"
            >
              상세 <ExternalLink className="h-3 w-3" />
            </Link>
          </div>
          <p className="font-mono text-xs text-muted-foreground">{result.newFo.id}</p>
          <p className="mt-1 text-xs">
            totalQty: <span className="tabular-nums font-medium">{result.newFo.totalQty}</span>
            {' / '}totalItems: {result.newFo.totalItems}
          </p>
        </div>
      </div>

      {/* 예약 합계 검증 안내 */}
      <div className="mt-3 rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
        <p className="font-medium text-foreground mb-0.5">예약(reservation) 합계 검증</p>
        {result.preSnapshot.map((snap) => (
          <p key={snap.foiId}>
            FOI {snap.foiId.substring(0, 8)}…: 분할 전 예약 {snap.originalReservedQty} →
            분할 수량 {snap.splitQty} 이전. 각 FO 재고 탭에서 reservedQty 합계를 확인하세요.
          </p>
        ))}
      </div>
    </section>
  );
}
