'use client';

import { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { getServerDenyMessage } from '@/lib/api/server-error';
import { useOrderPurchaseOrderLine } from '@/lib/services/inventory';
import type { PurchaseOrderDto, PurchaseOrderLineDto } from '@/lib/types/dto/inventory';
import { toast } from 'sonner';
import {
  buildOrderLinePayload,
  orderDialogDefaults,
  type OrderLineFormValues,
} from '../../line-execution-model';

type Props = {
  po: PurchaseOrderDto;
  line: PurchaseOrderLineDto | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

const EMPTY: OrderLineFormValues = { orderedQty: '', unitPrice: '', expectedArrival: '' };

export function OrderLineDialog({ po, line, open, onOpenChange }: Props) {
  const [values, setValues] = useState<OrderLineFormValues>(EMPTY);
  const mutation = useOrderPurchaseOrderLine();

  // 다이얼로그가 열릴 때마다 그 라인의 값으로 되돌린다. 닫았다 다른 라인을 열면
  // 앞 라인의 입력이 남아 있으면 안 된다 — 되돌릴 수 없는 기록이라 특히 그렇다.
  useEffect(() => {
    if (open && line) setValues(orderDialogDefaults(po, line));
  }, [open, line, po]);

  if (!line) return null;

  const handleSubmit = async () => {
    const result = buildOrderLinePayload(values);
    if (!result.ok) {
      toast.error(result.reason);
      return;
    }

    try {
      await mutation.mutateAsync({ poId: po.id, skuId: line.skuId, data: result.payload });
      toast.success('발주 실행이 기록되었습니다.');
      onOpenChange(false);
    } catch (e: unknown) {
      toast.error(getServerDenyMessage(e, '발주 실행 기록에 실패했습니다.'));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>발주 실행 기록 — {line.sku?.name ?? line.skuId}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4 py-2">
          <p className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
            요청 수량 <strong>{line.quantity}</strong> 개. 실제로 발주한 값을 기록합니다 —
            <strong> 되돌릴 수 없습니다.</strong>
          </p>

          <div className="flex flex-col gap-1">
            <Label htmlFor="ordered-qty">실발주 수량</Label>
            <Input
              id="ordered-qty"
              type="number"
              min={1}
              value={values.orderedQty}
              onChange={(e) => setValues((prev) => ({ ...prev, orderedQty: e.target.value }))}
            />
          </div>

          <div className="flex flex-col gap-1">
            <Label htmlFor="unit-price">실제 단가 (선택)</Label>
            <Input
              id="unit-price"
              type="number"
              min={0}
              placeholder="비워두면 기존 단가를 유지합니다"
              value={values.unitPrice}
              onChange={(e) => setValues((prev) => ({ ...prev, unitPrice: e.target.value }))}
            />
          </div>

          <div className="flex flex-col gap-1">
            <Label htmlFor="expected-arrival">도착 예정일 (선택)</Label>
            <Input
              id="expected-arrival"
              type="date"
              value={values.expectedArrival}
              onChange={(e) => setValues((prev) => ({ ...prev, expectedArrival: e.target.value }))}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            닫기
          </Button>
          <Button onClick={handleSubmit} disabled={mutation.isPending}>
            {mutation.isPending ? '기록 중…' : '실행 기록'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
