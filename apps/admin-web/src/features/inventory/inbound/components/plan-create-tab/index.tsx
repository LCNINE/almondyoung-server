'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { useCreateInboundPlan, useAddInboundPlanItems, usePurchaseOrders, useWarehouses } from '@/lib/services/inventory';
import type { PurchaseOrderDto, InboundPlanItemInputDto } from '@/lib/types/dto/inventory';
import { toast } from 'sonner';
import { Plus, Trash2 } from 'lucide-react';

// ⚠️ PO 자격: UI 측에서 status='confirmed' AND auditStatus='approved'인 발주만 노출.
// 서버 측 updatePurchaseOrderStatus에 auditStatus 검증이 없어 API 직접 호출은 막지 못함.
// 백엔드 가드 추가는 별도 PR 예정.

type PlanItem = { skuId: string; expectedQty: number };

export function PlanCreateTab() {
  const [selectedPoId, setSelectedPoId] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [expectedDate, setExpectedDate] = useState('');
  const [isSplitInbound, setIsSplitInbound] = useState(false);
  const [destinationWarehouseId, setDestinationWarehouseId] = useState('');
  const [planItems, setPlanItems] = useState<PlanItem[]>([{ skuId: '', expectedQty: 1 }]);

  const createPlanMutation = useCreateInboundPlan();
  const addItemsMutation = useAddInboundPlanItems();

  const { data: poListData } = usePurchaseOrders({ status: 'confirmed', limit: 100, offset: 0 });
  const { data: warehouses } = useWarehouses();

  // status='confirmed' AND auditStatus='approved' 인 PO만 선택 가능
  const eligiblePos = (poListData?.data ?? []).filter(
    (po: PurchaseOrderDto) => po.auditStatus === 'approved'
  );

  const addItem = () => setPlanItems((prev) => [...prev, { skuId: '', expectedQty: 1 }]);
  const removeItem = (i: number) => setPlanItems((prev) => prev.filter((_, idx) => idx !== i));
  const updateItem = (i: number, field: keyof PlanItem, value: string | number) => {
    setPlanItems((prev) => prev.map((item, idx) => (idx === i ? { ...item, [field]: value } : item)));
  };

  const handleSubmit = async () => {
    if (!selectedPoId || !warehouseId || !expectedDate) {
      toast.error('발주, 창고, 입고 예정일을 모두 선택해 주세요.');
      return;
    }
    const validItems = planItems.filter((i) => i.skuId.trim() && i.expectedQty > 0);
    if (validItems.length === 0) {
      toast.error('SKU 항목을 하나 이상 입력해 주세요.');
      return;
    }

    try {
      const plan = await createPlanMutation.mutateAsync({
        linkedPurchaseOrderId: selectedPoId,
        warehouseId,
        expectedDate,
        requiresTransfer: isSplitInbound,
        destinationWarehouseId: isSplitInbound ? destinationWarehouseId : undefined,
        planType: isSplitInbound ? 'source' : 'destination',
      });

      await addItemsMutation.mutateAsync({
        planId: plan.id,
        items: validItems.map<InboundPlanItemInputDto>((i) => ({
          skuId: i.skuId.trim(),
          expectedQty: i.expectedQty,
        })),
      });

      toast.success('입고 계획이 등록되었습니다.');
      setSelectedPoId('');
      setWarehouseId('');
      setExpectedDate('');
      setIsSplitInbound(false);
      setDestinationWarehouseId('');
      setPlanItems([{ skuId: '', expectedQty: 1 }]);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : '계획 등록에 실패했습니다.');
    }
  };

  const isPending = createPlanMutation.isPending || addItemsMutation.isPending;

  return (
    <div className="flex flex-col gap-6 p-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-1">
          <Label>발주 선택 (승인된 확정 발주)</Label>
          <Select value={selectedPoId} onValueChange={setSelectedPoId}>
            <SelectTrigger>
              <SelectValue placeholder="발주를 선택해 주세요" />
            </SelectTrigger>
            <SelectContent>
              {eligiblePos.length === 0 ? (
                <SelectItem value="__none__" disabled>
                  승인된 확정 발주가 없습니다
                </SelectItem>
              ) : (
                eligiblePos.map((po: PurchaseOrderDto) => (
                  <SelectItem key={po.id} value={po.id}>
                    <span className="flex items-center gap-2">
                      <span className="font-mono text-xs">{po.id.substring(0, 8)}…</span>
                      {po.supplier && <span>{po.supplier.name}</span>}
                      <Badge variant="outline" className="text-xs">
                        {po.type === 'domestic' ? '국내' : '해외'}
                      </Badge>
                    </span>
                  </SelectItem>
                ))
              )}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1">
          <Label>입고 창고</Label>
          <Select value={warehouseId} onValueChange={setWarehouseId}>
            <SelectTrigger>
              <SelectValue placeholder="창고 선택" />
            </SelectTrigger>
            <SelectContent>
              {(warehouses ?? []).map((wh: { id: string; name: string }) => (
                <SelectItem key={wh.id} value={wh.id}>{wh.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1">
          <Label>입고 예정일</Label>
          <Input
            type="date"
            value={expectedDate}
            onChange={(e) => setExpectedDate(e.target.value)}
          />
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Checkbox
          id="split-inbound"
          checked={isSplitInbound}
          onCheckedChange={(v) => setIsSplitInbound(!!v)}
        />
        <Label htmlFor="split-inbound">이중 입고 (해외 PO — 발송창고 → 수령창고)</Label>
      </div>

      {isSplitInbound && (
        <div className="flex flex-col gap-1">
          <Label>최종 수령 창고</Label>
          <Select value={destinationWarehouseId} onValueChange={setDestinationWarehouseId}>
            <SelectTrigger>
              <SelectValue placeholder="수령 창고 선택" />
            </SelectTrigger>
            <SelectContent>
              {(warehouses ?? []).map((wh: { id: string; name: string }) => (
                <SelectItem key={wh.id} value={wh.id}>{wh.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">SKU 항목</span>
          <Button variant="outline" size="sm" onClick={addItem}>
            <Plus className="mr-1 h-4 w-4" />
            항목 추가
          </Button>
        </div>

        {planItems.map((item, i) => (
          <div key={i} className="flex items-start gap-2">
            <div className="flex flex-1 flex-col gap-1">
              <Label className="text-xs text-muted-foreground">SKU ID</Label>
              <Input
                placeholder="SKU ID 입력"
                value={item.skuId}
                onChange={(e) => updateItem(i, 'skuId', e.target.value)}
              />
            </div>
            <div className="flex w-28 flex-col gap-1">
              <Label className="text-xs text-muted-foreground">예정 수량</Label>
              <Input
                type="number"
                min={1}
                value={item.expectedQty}
                onChange={(e) => updateItem(i, 'expectedQty', Number(e.target.value))}
              />
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="mt-5 shrink-0"
              onClick={() => removeItem(i)}
              disabled={planItems.length === 1}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ))}
      </div>

      <Button onClick={handleSubmit} disabled={isPending} className="self-start">
        {isPending ? '등록 중…' : '입고 계획 등록'}
      </Button>
    </div>
  );
}
