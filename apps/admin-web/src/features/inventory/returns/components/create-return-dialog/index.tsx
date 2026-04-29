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
import { toast } from 'sonner';
import { useCreateReturn } from '@/lib/services/inventory';
import type { CreateReturnItemDto } from '@/lib/types/dto/inventory';
import { Plus, Trash2 } from 'lucide-react';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function CreateReturnDialog({ open, onOpenChange }: Props) {
  const mutation = useCreateReturn();

  const [orderId, setOrderId] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [returnReason, setReturnReason] = useState('');
  const [items, setItems] = useState<CreateReturnItemDto[]>([{ skuId: '', requestedQuantity: 1 }]);

  const addItem = () => setItems((prev) => [...prev, { skuId: '', requestedQuantity: 1 }]);
  const removeItem = (idx: number) => setItems((prev) => prev.filter((_, i) => i !== idx));
  const updateItem = (idx: number, patch: Partial<CreateReturnItemDto>) =>
    setItems((prev) => prev.map((item, i) => (i === idx ? { ...item, ...patch } : item)));

  const handleSubmit = async () => {
    if (!warehouseId.trim()) {
      toast.error('창고 ID를 입력해주세요.');
      return;
    }
    if (!returnReason.trim()) {
      toast.error('반품 사유를 입력해주세요.');
      return;
    }
    if (items.some((i) => !i.skuId.trim())) {
      toast.error('모든 아이템의 SKU ID를 입력해주세요.');
      return;
    }
    try {
      await mutation.mutateAsync({
        orderId: orderId || undefined,
        warehouseId,
        returnReason,
        items,
      });
      toast.success('회수가 등록되었습니다.');
      onOpenChange(false);
      setOrderId('');
      setWarehouseId('');
      setReturnReason('');
      setItems([{ skuId: '', requestedQuantity: 1 }]);
    } catch {
      toast.error('회수 등록에 실패했습니다.');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>회수 등록</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1">
            <Label>창고 ID</Label>
            <Input value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} placeholder="창고 ID" />
          </div>
          <div className="space-y-1">
            <Label>주문 ID (선택)</Label>
            <Input value={orderId} onChange={(e) => setOrderId(e.target.value)} placeholder="주문 ID" />
          </div>
          <div className="space-y-1">
            <Label>반품 사유</Label>
            <Input value={returnReason} onChange={(e) => setReturnReason(e.target.value)} placeholder="반품 사유" />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>아이템 목록</Label>
              <Button type="button" size="sm" variant="outline" onClick={addItem}>
                <Plus className="mr-1 h-3 w-3" /> 추가
              </Button>
            </div>
            {items.map((item, idx) => (
              <div key={idx} className="flex gap-2">
                <Input
                  placeholder="SKU ID"
                  className="flex-1 text-xs"
                  value={item.skuId}
                  onChange={(e) => updateItem(idx, { skuId: e.target.value })}
                />
                <Input
                  type="number"
                  min={1}
                  className="w-20 text-xs"
                  value={item.requestedQuantity}
                  onChange={(e) => updateItem(idx, { requestedQuantity: Number(e.target.value) })}
                />
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => removeItem(idx)}
                  disabled={items.length === 1}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            ))}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>취소</Button>
          <Button onClick={handleSubmit} disabled={mutation.isPending}>
            {mutation.isPending ? '등록 중…' : '등록'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
