'use client';

import { useState } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { useReceiveFromPlan, useInboundPlanItems } from '@/lib/services/inventory';
import type { InboundPendingDto } from '@/lib/types/dto/inventory';
import { toast } from 'sonner';

const PLAN_TYPE_LABELS: Record<string, string> = {
  source: '발송창고 (leg-1)',
  destination: '수령창고 (leg-2)',
};

type Props = {
  row: InboundPendingDto | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

type ReceiveState = Record<string, { quantity: number; locationId: string; memo: string }>;

export function PlanDetailDrawer({ row, open, onOpenChange }: Props) {
  const [receiveState, setReceiveState] = useState<ReceiveState>({});
  const [activeItemId, setActiveItemId] = useState<string | null>(null);
  const receiveMutation = useReceiveFromPlan();

  // pending 응답의 items에는 planItemId(DB row id)가 없으므로 별도 조회
  const { data: planItemsData } = useInboundPlanItems(
    row ? { warehouseId: row.warehouseId } : undefined
  );

  // planId + skuId 조합으로 planItemId를 매핑
  const planItemIdMap = new Map<string, string>();
  planItemsData?.items.forEach((pi) => {
    planItemIdMap.set(`${pi.planId}-${pi.skuId}`, pi.planItemId);
  });

  const updateReceive = (itemId: string, field: 'quantity' | 'locationId' | 'memo', value: string | number) => {
    setReceiveState((prev) => {
      const current = prev[itemId] ?? { quantity: 1, locationId: '', memo: '' };
      return { ...prev, [itemId]: { ...current, [field]: value } };
    });
  };

  const handleReceive = async (skuId: string, skuName: string, pendingQty: number) => {
    if (!row) return;
    const mapKey = `${row.planId}-${skuId}`;
    const planItemId = planItemIdMap.get(mapKey);
    if (!planItemId) {
      toast.error('입고예정 아이템 ID를 찾을 수 없습니다. 잠시 후 다시 시도해 주세요.');
      return;
    }
    const state = receiveState[mapKey] ?? { quantity: pendingQty, locationId: '', memo: '' };
    try {
      await receiveMutation.mutateAsync({
        planItemId,
        quantity: state.quantity,
        locationId: state.locationId || undefined,
        memo: state.memo || undefined,
      });
      toast.success(`${skuName} 입고 완료`);
      setActiveItemId(null);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : '입고 처리에 실패했습니다.');
    }
  };

  if (!row) return null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full max-w-xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>입고 계획 상세</SheetTitle>
        </SheetHeader>

        <div className="mt-4 flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-y-2 text-sm">
            <span className="text-muted-foreground">계획 유형</span>
            <Badge variant="outline">{PLAN_TYPE_LABELS[row.planType] ?? row.planType}</Badge>
            <span className="text-muted-foreground">공급처</span>
            <span>{row.purchaseOrder.supplier?.name ?? '—'}</span>
            <span className="text-muted-foreground">발주 유형</span>
            <Badge variant="secondary">{row.purchaseOrder.type === 'domestic' ? '국내' : '해외'}</Badge>
            <span className="text-muted-foreground">입고 예정일</span>
            <span>
              {row.expectedDate
                ? new Date(row.expectedDate).toLocaleDateString('ko-KR')
                : <span className="text-muted-foreground">미정</span>}
            </span>
            <span className="text-muted-foreground">전체 예정 수량</span>
            <span className="font-medium">{row.totalQuantity.toLocaleString()}</span>
            <span className="text-muted-foreground">미입고 수량</span>
            <span className="font-medium text-amber-600">{row.totalPendingQuantity.toLocaleString()}</span>
          </div>

          {row.isLinkedPlan && (
            <div className="rounded-md bg-muted px-3 py-2 text-sm">
              이중 입고 계획 — leg-1 상태: <span className="font-medium">{row.sourcePlanStatus ?? '—'}</span>
            </div>
          )}

          <Separator />

          <div className="flex flex-col gap-3">
            <span className="text-sm font-medium">SKU별 입고 처리</span>
            {row.items.map((item) => {
              const mapKey = `${row.planId}-${item.skuId}`;
              const isExpanded = activeItemId === mapKey;
              const state = receiveState[mapKey] ?? { quantity: item.pendingQty, locationId: '', memo: '' };
              const hasPlanItemId = planItemIdMap.has(mapKey);

              return (
                <div key={mapKey} className="rounded-md border p-3">
                  <div className="flex items-start justify-between">
                    <div className="flex flex-col gap-0.5 text-sm">
                      <span className="font-medium">{item.skuName}</span>
                      <span className="font-mono text-xs text-muted-foreground">{item.skuCode}</span>
                      <span className="text-xs text-muted-foreground">
                        예정 {item.expectedQty} / 입고 {item.receivedQty} / 잔여 {item.pendingQty}
                      </span>
                    </div>
                    {item.pendingQty > 0 && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setActiveItemId(isExpanded ? null : mapKey)}
                        disabled={!hasPlanItemId}
                      >
                        {isExpanded ? '닫기' : '입고'}
                      </Button>
                    )}
                  </div>

                  {isExpanded && (
                    <div className="mt-3 flex flex-col gap-2 border-t pt-3">
                      <div className="grid grid-cols-2 gap-2">
                        <div className="flex flex-col gap-1">
                          <Label className="text-xs">수량</Label>
                          <Input
                            type="number"
                            min={1}
                            max={item.pendingQty}
                            value={state.quantity}
                            onChange={(e) => updateReceive(mapKey, 'quantity', Number(e.target.value))}
                          />
                        </div>
                        <div className="flex flex-col gap-1">
                          <Label className="text-xs">로케이션 ID (선택)</Label>
                          <Input
                            placeholder="기본 입고존"
                            value={state.locationId}
                            onChange={(e) => updateReceive(mapKey, 'locationId', e.target.value)}
                          />
                        </div>
                      </div>
                      <div className="flex flex-col gap-1">
                        <Label className="text-xs">메모 (선택)</Label>
                        <Input
                          placeholder="메모"
                          value={state.memo}
                          onChange={(e) => updateReceive(mapKey, 'memo', e.target.value)}
                        />
                      </div>
                      <Button
                        size="sm"
                        onClick={() => handleReceive(item.skuId, item.skuName, item.pendingQty)}
                        disabled={receiveMutation.isPending}
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
  );
}
