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
import { useReceiveReturn } from '@/lib/services/inventory';
import type { ReturnItemDto } from '@/lib/types/dto/inventory';

type Props = {
  returnId: string;
  items: ReturnItemDto[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function ReceiveReturnDialog({ returnId, items, open, onOpenChange }: Props) {
  const mutation = useReceiveReturn();

  const [quantities, setQuantities] = useState<Record<string, number>>(() =>
    Object.fromEntries(items.map((i) => [i.id, i.requestedQuantity]))
  );
  const [locationIds, setLocationIds] = useState<Record<string, string>>(() =>
    Object.fromEntries(items.map((i) => [i.id, '']))
  );

  const handleSubmit = async () => {
    try {
      await mutation.mutateAsync({
        id: returnId,
        data: {
          returnId,
          items: items.map((item) => ({
            returnItemId: item.id,
            receivedQuantity: quantities[item.id] ?? item.requestedQuantity,
            locationId: locationIds[item.id] || undefined,
          })),
        },
      });
      toast.success('입고가 처리되었습니다.');
      onOpenChange(false);
    } catch {
      toast.error('입고 처리에 실패했습니다.');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>입고 처리</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {items.map((item) => (
            <div key={item.id} className="space-y-2 rounded border p-3">
              <p className="text-xs text-muted-foreground font-mono">{item.skuId.substring(0, 8)}… (요청: {item.requestedQuantity})</p>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label className="text-xs">입고 수량</Label>
                  <Input
                    type="number"
                    min={1}
                    value={quantities[item.id] ?? item.requestedQuantity}
                    onChange={(e) =>
                      setQuantities((prev) => ({ ...prev, [item.id]: Number(e.target.value) }))
                    }
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">위치 ID (선택)</Label>
                  <Input
                    placeholder="미입력 시 return_default"
                    value={locationIds[item.id] ?? ''}
                    onChange={(e) =>
                      setLocationIds((prev) => ({ ...prev, [item.id]: e.target.value }))
                    }
                  />
                </div>
              </div>
            </div>
          ))}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>취소</Button>
          <Button onClick={handleSubmit} disabled={mutation.isPending}>
            {mutation.isPending ? '처리 중…' : '입고 완료'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
