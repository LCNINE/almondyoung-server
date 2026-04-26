'use client';

import { useState } from 'react';
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
import { useMoveWithinWarehouse } from '@/lib/services/inventory';
import { toast } from 'sonner';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function MoveWithinWarehouseDialog({ open, onOpenChange }: Props) {
  const [skuId, setSkuId] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [fromLocationId, setFromLocationId] = useState('');
  const [toLocationId, setToLocationId] = useState('');
  const [quantity, setQuantity] = useState<number | ''>('');
  const [memo, setMemo] = useState('');

  const moveMutation = useMoveWithinWarehouse();

  const handleClose = () => {
    setSkuId('');
    setWarehouseId('');
    setFromLocationId('');
    setToLocationId('');
    setQuantity('');
    setMemo('');
    onOpenChange(false);
  };

  const handleSubmit = async () => {
    if (!skuId || !warehouseId || !fromLocationId || !toLocationId || quantity === '') {
      toast.error('모든 필드를 입력해 주세요.');
      return;
    }
    try {
      await moveMutation.mutateAsync({
        skuId,
        warehouseId,
        fromLocationId,
        toLocationId,
        quantity: quantity as number,
        memo: memo || undefined,
      });
      toast.success('창고 내 이동이 완료되었습니다.');
      handleClose();
    } catch {
      toast.error('이동에 실패했습니다.');
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>창고 내 간편 이동</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="mw-skuId">SKU ID</Label>
            <Input
              id="mw-skuId"
              value={skuId}
              onChange={(e) => setSkuId(e.target.value)}
              placeholder="SKU ID 입력"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="mw-warehouseId">창고 ID</Label>
            <Input
              id="mw-warehouseId"
              value={warehouseId}
              onChange={(e) => setWarehouseId(e.target.value)}
              placeholder="창고 ID 입력"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="mw-from">출발 위치 ID</Label>
              <Input
                id="mw-from"
                value={fromLocationId}
                onChange={(e) => setFromLocationId(e.target.value)}
                placeholder="위치 ID"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="mw-to">도착 위치 ID</Label>
              <Input
                id="mw-to"
                value={toLocationId}
                onChange={(e) => setToLocationId(e.target.value)}
                placeholder="위치 ID"
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="mw-quantity">수량</Label>
            <Input
              id="mw-quantity"
              type="number"
              min={1}
              value={quantity}
              onChange={(e) =>
                setQuantity(e.target.value !== '' ? Number(e.target.value) : '')
              }
              placeholder="이동 수량"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="mw-memo">메모 (선택)</Label>
            <Input
              id="mw-memo"
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              placeholder="메모 입력"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>
            취소
          </Button>
          <Button onClick={handleSubmit} disabled={moveMutation.isPending}>
            {moveMutation.isPending ? '이동 중...' : '이동'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
