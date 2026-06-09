'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
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
import { useReserveFulfillment } from '@/lib/services/orders';
import type { FulfillmentOrderItemSummary } from '@/lib/types/dto/fulfillment';

interface Props {
  foId: string;
  items: FulfillmentOrderItemSummary[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
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

export function ReserveDialog({ foId, items, open, onOpenChange }: Props) {
  const [foiId, setFoiId] = useState('');
  const [qty, setQty] = useState('1');
  const reserve = useReserveFulfillment(foId);

  const reservable = items.filter((i) => i.qty - i.reservedQty > 0);
  const selected = reservable.find((i) => i.id === foiId);
  const maxQty = selected ? selected.qty - selected.reservedQty : 0;

  const handleSubmit = async () => {
    if (!foiId) {
      toast.error('아이템을 선택하세요.');
      return;
    }
    const quantity = parseInt(qty, 10);
    if (!quantity || quantity <= 0) {
      toast.error('수량은 1 이상이어야 합니다.');
      return;
    }
    try {
      await reserve.mutateAsync({ fulfillmentOrderItemId: foiId, quantity });
      toast.success(`재고 예약 완료 (${quantity}개)`);
      onOpenChange(false);
      setFoiId('');
      setQty('1');
    } catch (err) {
      toast.error(`재고 예약 실패: ${extractErrorMessage(err)}`);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>재고 예약</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground">
          재고 예약(Reserve)은 배치 할당과 별개입니다. 재고를 이 FO에 잠금 처리하는 작업입니다.
        </p>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label>아이템 (FOI)</Label>
            <Select value={foiId} onValueChange={setFoiId}>
              <SelectTrigger>
                <SelectValue placeholder="아이템 선택" />
              </SelectTrigger>
              <SelectContent>
                {reservable.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    SKU {item.skuId.substring(0, 8)}… — 미예약 {item.qty - item.reservedQty}개
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>수량 {maxQty > 0 && <span className="text-muted-foreground">(최대 {maxQty})</span>}</Label>
            <Input
              type="number"
              min={1}
              max={maxQty || undefined}
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              className="w-32"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            취소
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={reserve.isPending || !foiId}
          >
            {reserve.isPending ? '처리 중...' : '예약'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
