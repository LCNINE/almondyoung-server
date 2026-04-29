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
import { useMoveImmediately } from '@/lib/services/inventory';
import type { MoveBatchLineDto } from '@/lib/types/dto/inventory';
import { Plus, Trash2 } from 'lucide-react';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function MoveDialog({ open, onOpenChange }: Props) {
  const mutation = useMoveImmediately();

  const [warehouseId, setWarehouseId] = useState('');
  const [actorId, setActorId] = useState('');
  const [memo, setMemo] = useState('');
  const [lines, setLines] = useState<MoveBatchLineDto[]>([
    { skuId: '', fromLocationId: '', toLocationId: '', quantity: 1 },
  ]);

  const addLine = () =>
    setLines((prev) => [...prev, { skuId: '', fromLocationId: '', toLocationId: '', quantity: 1 }]);
  const removeLine = (idx: number) => setLines((prev) => prev.filter((_, i) => i !== idx));
  const updateLine = (idx: number, patch: Partial<MoveBatchLineDto>) =>
    setLines((prev) => prev.map((line, i) => (i === idx ? { ...line, ...patch } : line)));

  const handleSubmit = async () => {
    if (!warehouseId.trim()) {
      toast.error('창고 ID를 입력해주세요.');
      return;
    }
    if (lines.some((l) => !l.skuId.trim() || !l.fromLocationId.trim() || !l.toLocationId.trim())) {
      toast.error('모든 라인의 SKU ID, 출발/도착 위치를 입력해주세요.');
      return;
    }
    try {
      await mutation.mutateAsync({
        warehouseId,
        actorId: actorId.trim() || undefined,
        memo: memo.trim() || undefined,
        lines,
      });
      toast.success('이동이 완료되었습니다.');
      onOpenChange(false);
      setWarehouseId('');
      setActorId('');
      setMemo('');
      setLines([{ skuId: '', fromLocationId: '', toLocationId: '', quantity: 1 }]);
    } catch {
      toast.error('이동에 실패했습니다.');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>즉시 이동</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>창고 ID</Label>
              <Input
                placeholder="창고 ID (동일 창고 내 이동)"
                value={warehouseId}
                onChange={(e) => setWarehouseId(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label>작업자 ID (선택)</Label>
              <Input
                placeholder="작업자 UUID"
                value={actorId}
                onChange={(e) => setActorId(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-1">
            <Label>메모 (선택)</Label>
            <Input
              placeholder="작업 메모"
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>이동 라인</Label>
              <Button type="button" size="sm" variant="outline" onClick={addLine}>
                <Plus className="mr-1 h-3 w-3" /> 라인 추가
              </Button>
            </div>
            <div className="grid grid-cols-[1fr_1fr_1fr_4rem_2rem] gap-1 text-xs font-medium text-muted-foreground px-1">
              <span>SKU ID</span>
              <span>출발 위치</span>
              <span>도착 위치</span>
              <span>수량</span>
              <span />
            </div>
            {lines.map((line, idx) => (
              <div key={idx} className="grid grid-cols-[1fr_1fr_1fr_4rem_2rem] gap-1">
                <Input
                  placeholder="SKU ID"
                  className="text-xs h-8"
                  value={line.skuId}
                  onChange={(e) => updateLine(idx, { skuId: e.target.value })}
                />
                <Input
                  placeholder="출발 위치 ID"
                  className="text-xs h-8"
                  value={line.fromLocationId}
                  onChange={(e) => updateLine(idx, { fromLocationId: e.target.value })}
                />
                <Input
                  placeholder="도착 위치 ID"
                  className="text-xs h-8"
                  value={line.toLocationId}
                  onChange={(e) => updateLine(idx, { toLocationId: e.target.value })}
                />
                <Input
                  type="number"
                  min={1}
                  className="text-xs h-8"
                  value={line.quantity}
                  onChange={(e) => updateLine(idx, { quantity: Number(e.target.value) })}
                />
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-8 w-8 p-0"
                  onClick={() => removeLine(idx)}
                  disabled={lines.length === 1}
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
            {mutation.isPending ? '처리 중…' : '이동 실행'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
