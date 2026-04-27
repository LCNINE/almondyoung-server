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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useCreatePurchaseOrderFromCart, useSuppliers, useWarehouses } from '@/lib/services/inventory';
import { toast } from 'sonner';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  cartItemIds: string[];
};

export function FinalizeFromCartDialog({ open, onOpenChange, cartItemIds }: Props) {
  const [supplierId, setSupplierId] = useState('');
  const [expectedArrival, setExpectedArrival] = useState('');
  const [destinationWarehouseId, setDestinationWarehouseId] = useState('');

  const { data: suppliers } = useSuppliers();
  const { data: warehouses } = useWarehouses();
  const mutation = useCreatePurchaseOrderFromCart();

  const handleSubmit = async () => {
    if (!supplierId) { toast.error('공급처를 선택해주세요.'); return; }
    if (!destinationWarehouseId) { toast.error('목적지 창고를 선택해주세요.'); return; }
    if (cartItemIds.length === 0) { toast.error('선택된 카트 항목이 없습니다.'); return; }

    try {
      await mutation.mutateAsync({
        cartItemIds,
        supplierId,
        expectedArrival: expectedArrival || undefined,
        destinationWarehouseId,
      });
      toast.success('발주가 생성되었습니다.');
      onOpenChange(false);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : '발주 생성에 실패했습니다.');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>장바구니로 발주 생성</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            선택된 카트 항목 {cartItemIds.length}개로 발주를 생성합니다.
          </p>

          <div className="space-y-1.5">
            <Label>공급처 *</Label>
            <Select value={supplierId} onValueChange={setSupplierId}>
              <SelectTrigger>
                <SelectValue placeholder="공급처 선택" />
              </SelectTrigger>
              <SelectContent>
                {(suppliers?.data ?? []).map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>목적지 창고 *</Label>
            <Select value={destinationWarehouseId} onValueChange={setDestinationWarehouseId}>
              <SelectTrigger>
                <SelectValue placeholder="창고 선택" />
              </SelectTrigger>
              <SelectContent>
                {(warehouses ?? []).map((w) => (
                  <SelectItem key={w.id} value={w.id}>
                    {w.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>입고 예정일</Label>
            <Input
              type="date"
              value={expectedArrival}
              onChange={(e) => setExpectedArrival(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={mutation.isPending}>
            취소
          </Button>
          <Button onClick={handleSubmit} disabled={mutation.isPending}>
            {mutation.isPending ? '생성 중...' : '발주 생성'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
