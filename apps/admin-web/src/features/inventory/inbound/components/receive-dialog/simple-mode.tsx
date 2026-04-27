'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useSimpleInbound } from '@/lib/services/inventory';
import { toast } from 'sonner';
import { Plus, Trash2 } from 'lucide-react';

type LineItem = { skuId: string; quantity: number; memo: string };

type Props = {
  warehouseId: string;
  onSuccess: () => void;
};

export function SimpleMode({ warehouseId, onSuccess }: Props) {
  const [lines, setLines] = useState<LineItem[]>([{ skuId: '', quantity: 1, memo: '' }]);
  const mutation = useSimpleInbound();

  const addLine = () => setLines((prev) => [...prev, { skuId: '', quantity: 1, memo: '' }]);
  const removeLine = (i: number) => setLines((prev) => prev.filter((_, idx) => idx !== i));

  const updateLine = (i: number, field: keyof LineItem, value: string | number) => {
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, [field]: value } : l)));
  };

  const handleSubmit = async () => {
    const valid = lines.every((l) => l.skuId.trim() && l.quantity > 0);
    if (!valid) {
      toast.error('SKU ID와 수량을 모두 입력해 주세요.');
      return;
    }
    try {
      await mutation.mutateAsync({
        warehouseId,
        items: lines.map((l) => ({
          skuId: l.skuId.trim(),
          quantity: l.quantity,
          memo: l.memo || undefined,
        })),
      });
      toast.success('간편입고가 처리되었습니다.');
      onSuccess();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : '입고 처리에 실패했습니다.');
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        {lines.map((line, i) => (
          <div key={i} className="flex items-start gap-2">
            <div className="flex flex-1 flex-col gap-1">
              <Label className="text-xs text-muted-foreground">SKU ID</Label>
              <Input
                placeholder="SKU ID 입력"
                value={line.skuId}
                onChange={(e) => updateLine(i, 'skuId', e.target.value)}
              />
            </div>
            <div className="flex w-24 flex-col gap-1">
              <Label className="text-xs text-muted-foreground">수량</Label>
              <Input
                type="number"
                min={1}
                value={line.quantity}
                onChange={(e) => updateLine(i, 'quantity', Number(e.target.value))}
              />
            </div>
            <div className="flex flex-1 flex-col gap-1">
              <Label className="text-xs text-muted-foreground">메모 (선택)</Label>
              <Input
                placeholder="메모"
                value={line.memo}
                onChange={(e) => updateLine(i, 'memo', e.target.value)}
              />
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="mt-5 shrink-0"
              onClick={() => removeLine(i)}
              disabled={lines.length === 1}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ))}
      </div>

      <Button variant="outline" size="sm" className="self-start" onClick={addLine}>
        <Plus className="mr-1 h-4 w-4" />
        라인 추가
      </Button>

      <Button onClick={handleSubmit} disabled={mutation.isPending}>
        {mutation.isPending ? '처리 중…' : '입고 처리'}
      </Button>
    </div>
  );
}
