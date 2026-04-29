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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { useProcessReturn } from '@/lib/services/inventory';
import type { ReturnItemDto, ReturnProcessAction } from '@/lib/types/dto/inventory';

type Props = {
  returnId: string;
  items: ReturnItemDto[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

type ItemProcess = {
  action: ReturnProcessAction;
  quantity: number;
  targetLocationId: string;
  reason: string;
};

export function ProcessReturnDialog({ returnId, items, open, onOpenChange }: Props) {
  const mutation = useProcessReturn();

  const [itemState, setItemState] = useState<Record<string, ItemProcess>>(() =>
    Object.fromEntries(
      items.map((i) => [
        i.id,
        {
          action: 'restock' as ReturnProcessAction,
          quantity: i.qcPassedQuantity ?? i.receivedQuantity ?? i.requestedQuantity,
          targetLocationId: '',
          reason: '',
        },
      ])
    )
  );

  const update = (id: string, patch: Partial<ItemProcess>) =>
    setItemState((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));

  const handleSubmit = async () => {
    try {
      await mutation.mutateAsync({
        id: returnId,
        data: {
          returnId,
          items: items.map((item) => ({
            returnItemId: item.id,
            action: itemState[item.id]?.action ?? 'restock',
            quantity: itemState[item.id]?.quantity ?? 1,
            targetLocationId: itemState[item.id]?.targetLocationId || undefined,
            reason: itemState[item.id]?.reason || undefined,
          })),
        },
      });
      toast.success('처리가 완료되었습니다.');
      onOpenChange(false);
    } catch {
      toast.error('처리에 실패했습니다.');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>처리 (재입고/폐기)</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          {items.map((item) => (
            <div key={item.id} className="space-y-2 rounded border p-3">
              <p className="text-xs text-muted-foreground font-mono">{item.skuId.substring(0, 8)}…</p>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label className="text-xs">처리 방식</Label>
                  <Select
                    value={itemState[item.id]?.action ?? 'restock'}
                    onValueChange={(v) => update(item.id, { action: v as ReturnProcessAction })}
                  >
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="restock">재입고</SelectItem>
                      <SelectItem value="dispose">폐기</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">수량</Label>
                  <Input
                    type="number"
                    min={1}
                    className="h-8 text-xs"
                    value={itemState[item.id]?.quantity ?? 1}
                    onChange={(e) => update(item.id, { quantity: Number(e.target.value) })}
                  />
                </div>
              </div>
              {itemState[item.id]?.action === 'restock' && (
                <div className="space-y-1">
                  <Label className="text-xs">재입고 위치 ID (미입력 시 return_default 사용)</Label>
                  <Input
                    className="h-8 text-xs"
                    placeholder="Location ID"
                    value={itemState[item.id]?.targetLocationId ?? ''}
                    onChange={(e) => update(item.id, { targetLocationId: e.target.value })}
                  />
                </div>
              )}
              <div className="space-y-1">
                <Label className="text-xs">사유 (선택)</Label>
                <Input
                  className="h-8 text-xs"
                  placeholder="처리 사유"
                  value={itemState[item.id]?.reason ?? ''}
                  onChange={(e) => update(item.id, { reason: e.target.value })}
                />
              </div>
            </div>
          ))}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>취소</Button>
          <Button onClick={handleSubmit} disabled={mutation.isPending}>
            {mutation.isPending ? '처리 중…' : '처리 완료'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
