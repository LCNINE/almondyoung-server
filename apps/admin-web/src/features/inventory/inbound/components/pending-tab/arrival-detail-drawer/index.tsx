'use client';

import { useEffect, useState } from 'react';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { getServerDenyMessage } from '@/lib/api/server-error';
import {
  useReceivePurchaseOrder,
  useShortClosePurchaseOrderLine,
} from '@/lib/services/inventory';
import type { ExpectedArrivalDto } from '@/lib/types/dto/inventory';
import { toast } from 'sonner';
import {
  getReceiveDraft,
  receiveDraftKey,
  updateReceiveDraft,
  type ReceiveDraftField,
  type ReceiveDraftState,
} from './receive-state-model';

type Props = {
  row: ExpectedArrivalDto | null;
  warehouseId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function ArrivalDetailDrawer({
  row,
  warehouseId,
  open,
  onOpenChange,
}: Props) {
  const [receiveState, setReceiveState] = useState<ReceiveDraftState>({});
  const [activeLineKey, setActiveLineKey] = useState<string | null>(null);
  const [closingLine, setClosingLine] = useState<{
    skuId: string;
    skuName: string;
  } | null>(null);
  const [closeReason, setCloseReason] = useState('');
  const receiveMutation = useReceivePurchaseOrder();
  const closeMutation = useShortClosePurchaseOrderLine();

  useEffect(() => {
    if (closingLine) setCloseReason('');
  }, [closingLine]);

  const updateReceive = (
    skuId: string,
    outstandingQty: number,
    field: ReceiveDraftField,
    value: string | number
  ) => {
    if (!row) return;
    setReceiveState((previous) =>
      updateReceiveDraft(
        previous,
        row.documentId,
        skuId,
        outstandingQty,
        field,
        value
      )
    );
  };

  const handleReceive = async (
    skuId: string,
    skuName: string,
    outstandingQty: number
  ) => {
    if (!row || !warehouseId) return;
    const state = getReceiveDraft(
      receiveState,
      row.documentId,
      skuId,
      outstandingQty
    );
    try {
      await receiveMutation.mutateAsync({
        poId: row.documentId,
        warehouseId,
        locationId: state.locationId || undefined,
        lines: [
          { skuId, quantity: state.quantity, memo: state.memo || undefined },
        ],
      });
      toast.success(`${skuName} 입고 완료`);
      setActiveLineKey(null);
    } catch (e: unknown) {
      toast.error(getServerDenyMessage(e, '입고 처리에 실패했습니다.'));
    }
  };

  const handleShortClose = async () => {
    if (!row || !closingLine) return;
    const reason = closeReason.trim();
    if (!reason) return;
    try {
      await closeMutation.mutateAsync({
        poId: row.documentId,
        skuId: closingLine.skuId,
        data: { reason },
      });
      toast.success(`${closingLine.skuName} 잔량을 포기했습니다.`);
      setClosingLine(null);
    } catch (e: unknown) {
      toast.error(getServerDenyMessage(e, '잔량 포기에 실패했습니다.'));
    }
  };

  if (!row) return null;

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent className="w-full max-w-xl overflow-y-auto">
          <SheetHeader>
            <SheetTitle>입고 예정 상세</SheetTitle>
          </SheetHeader>

          <div className="mt-4 flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-y-2 text-sm">
              <span className="text-muted-foreground">공급처</span>
              <span>{row.supplier?.name ?? '—'}</span>
              <span className="text-muted-foreground">발주 유형</span>
              <Badge variant="secondary">
                {row.type === 'domestic' ? '국내' : '해외'}
              </Badge>
              <span className="text-muted-foreground">입고 예정일</span>
              <span>
                {row.expectedDate ?? (
                  <span className="text-muted-foreground">미정</span>
                )}
              </span>
              <span className="text-muted-foreground">남은 수량</span>
              <span className="font-medium text-amber-600">
                {row.totalOutstandingQuantity.toLocaleString()}
              </span>
            </div>

            <Separator />

            <div className="flex flex-col gap-3">
              <span className="text-sm font-medium">SKU별 입고 처리</span>
              {row.lines.map((line) => {
                const lineKey = receiveDraftKey(row.documentId, line.skuId);
                const isExpanded = activeLineKey === lineKey;
                const state = getReceiveDraft(
                  receiveState,
                  row.documentId,
                  line.skuId,
                  line.outstandingQty
                );

                return (
                  <div key={line.skuId} className="rounded-md border p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex flex-col gap-0.5 text-sm">
                        <span className="font-medium">{line.skuName}</span>
                        <span className="font-mono text-xs text-muted-foreground">
                          {line.skuCode}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          예정 {line.orderedQty} / 입고 {line.receivedQty} /
                          잔여 {line.outstandingQty}
                        </span>
                      </div>
                      <div className="flex items-center gap-1">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            setActiveLineKey(isExpanded ? null : lineKey)
                          }
                        >
                          {isExpanded ? '닫기' : '입고'}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() =>
                            setClosingLine({
                              skuId: line.skuId,
                              skuName: line.skuName,
                            })
                          }
                        >
                          잔량 포기
                        </Button>
                      </div>
                    </div>

                    {isExpanded && (
                      <div className="mt-3 flex flex-col gap-2 border-t pt-3">
                        <div className="grid grid-cols-2 gap-2">
                          <div className="flex flex-col gap-1">
                            <Label className="text-xs">수량</Label>
                            <Input
                              type="number"
                              min={1}
                              max={line.outstandingQty}
                              value={state.quantity}
                              onChange={(event) =>
                                updateReceive(
                                  line.skuId,
                                  line.outstandingQty,
                                  'quantity',
                                  Number(event.target.value)
                                )
                              }
                            />
                          </div>
                          <div className="flex flex-col gap-1">
                            <Label className="text-xs">
                              로케이션 ID (선택)
                            </Label>
                            <Input
                              placeholder="기본 입고존"
                              value={state.locationId}
                              onChange={(event) =>
                                updateReceive(
                                  line.skuId,
                                  line.outstandingQty,
                                  'locationId',
                                  event.target.value
                                )
                              }
                            />
                          </div>
                        </div>
                        <div className="flex flex-col gap-1">
                          <Label className="text-xs">메모 (선택)</Label>
                          <Input
                            placeholder="메모"
                            value={state.memo}
                            onChange={(event) =>
                              updateReceive(
                                line.skuId,
                                line.outstandingQty,
                                'memo',
                                event.target.value
                              )
                            }
                          />
                        </div>
                        <Button
                          size="sm"
                          onClick={() =>
                            handleReceive(
                              line.skuId,
                              line.skuName,
                              line.outstandingQty
                            )
                          }
                          disabled={receiveMutation.isPending || !warehouseId}
                        >
                          {receiveMutation.isPending ? '처리 중…' : '입고 확정'}
                        </Button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </SheetContent>
      </Sheet>

      <Dialog
        open={!!closingLine}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) setClosingLine(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>잔량 포기 — {closingLine?.skuName}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-4 py-2">
            <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              더 기다리지 않고 이 품목을 종결합니다.{' '}
              <strong>되돌릴 수 없습니다.</strong>
            </p>
            <div className="flex flex-col gap-1">
              <Label htmlFor="arrival-short-close-reason">
                사유 (필수, 500자 이내)
              </Label>
              <Textarea
                id="arrival-short-close-reason"
                maxLength={500}
                value={closeReason}
                onChange={(event) => setCloseReason(event.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setClosingLine(null)}>
              닫기
            </Button>
            <Button
              variant="destructive"
              onClick={handleShortClose}
              disabled={closeMutation.isPending || !closeReason.trim()}
            >
              {closeMutation.isPending ? '처리 중…' : '잔량 포기'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
