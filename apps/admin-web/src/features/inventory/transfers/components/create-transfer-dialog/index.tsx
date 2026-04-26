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
import { useCreateTransferJob } from '@/lib/services/inventory';
import { toast } from 'sonner';

type TransferLineInput = {
  skuId: string;
  fromLocationId: string;
  toLocationId: string;
  quantity: number | '';
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

const emptyLine = (): TransferLineInput => ({
  skuId: '',
  fromLocationId: '',
  toLocationId: '',
  quantity: '',
});

export function CreateTransferDialog({ open, onOpenChange }: Props) {
  const [fromWarehouseId, setFromWarehouseId] = useState('');
  const [toWarehouseId, setToWarehouseId] = useState('');
  const [memo, setMemo] = useState('');
  const [lines, setLines] = useState<TransferLineInput[]>([emptyLine()]);

  const createMutation = useCreateTransferJob();

  const updateLine = (index: number, field: keyof TransferLineInput, value: string | number) => {
    setLines((prev) =>
      prev.map((line, i) => (i === index ? { ...line, [field]: value } : line))
    );
  };

  const addLine = () => setLines((prev) => [...prev, emptyLine()]);

  const removeLine = (index: number) =>
    setLines((prev) => prev.filter((_, i) => i !== index));

  const handleClose = () => {
    setFromWarehouseId('');
    setToWarehouseId('');
    setMemo('');
    setLines([emptyLine()]);
    onOpenChange(false);
  };

  const handleSubmit = async () => {
    if (!fromWarehouseId || !toWarehouseId) {
      toast.error('출발 창고와 도착 창고를 입력해 주세요.');
      return;
    }
    const validLines = lines.filter(
      (l) => l.skuId && l.fromLocationId && l.toLocationId && l.quantity !== ''
    );
    if (validLines.length === 0) {
      toast.error('유효한 이동 라인이 없습니다.');
      return;
    }

    try {
      await createMutation.mutateAsync({
        fromWarehouseId,
        toWarehouseId,
        memo: memo || undefined,
        items: validLines.map((l) => ({
          skuId: l.skuId,
          fromLocationId: l.fromLocationId,
          toLocationId: l.toLocationId,
          quantity: l.quantity as number,
        })),
      });
      toast.success('이동 작업이 생성되었습니다.');
      handleClose();
    } catch {
      toast.error('이동 작업 생성에 실패했습니다.');
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>이동 작업 생성</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="fromWarehouseId">출발 창고 ID</Label>
              <Input
                id="fromWarehouseId"
                value={fromWarehouseId}
                onChange={(e) => setFromWarehouseId(e.target.value)}
                placeholder="창고 ID 입력"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="toWarehouseId">도착 창고 ID</Label>
              <Input
                id="toWarehouseId"
                value={toWarehouseId}
                onChange={(e) => setToWarehouseId(e.target.value)}
                placeholder="창고 ID 입력"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="memo">메모 (선택)</Label>
            <Input
              id="memo"
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              placeholder="메모 입력"
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>이동 라인</Label>
              <Button type="button" variant="outline" size="sm" onClick={addLine}>
                + 라인 추가
              </Button>
            </div>

            <div className="max-h-60 space-y-2 overflow-y-auto">
              {lines.map((line, idx) => (
                <div key={idx} className="grid grid-cols-[1fr_1fr_1fr_80px_32px] gap-2 items-end">
                  <div className="space-y-1">
                    {idx === 0 && <Label className="text-xs">SKU ID</Label>}
                    <Input
                      value={line.skuId}
                      onChange={(e) => updateLine(idx, 'skuId', e.target.value)}
                      placeholder="SKU ID"
                      className="text-xs"
                    />
                  </div>
                  <div className="space-y-1">
                    {idx === 0 && <Label className="text-xs">출발 위치 ID</Label>}
                    <Input
                      value={line.fromLocationId}
                      onChange={(e) => updateLine(idx, 'fromLocationId', e.target.value)}
                      placeholder="위치 ID"
                      className="text-xs"
                    />
                  </div>
                  <div className="space-y-1">
                    {idx === 0 && <Label className="text-xs">도착 위치 ID</Label>}
                    <Input
                      value={line.toLocationId}
                      onChange={(e) => updateLine(idx, 'toLocationId', e.target.value)}
                      placeholder="위치 ID"
                      className="text-xs"
                    />
                  </div>
                  <div className="space-y-1">
                    {idx === 0 && <Label className="text-xs">수량</Label>}
                    <Input
                      type="number"
                      min={1}
                      value={line.quantity}
                      onChange={(e) =>
                        updateLine(idx, 'quantity', e.target.value !== '' ? Number(e.target.value) : '')
                      }
                      placeholder="수량"
                      className="text-xs"
                    />
                  </div>
                  <div className={idx === 0 ? 'pt-5' : ''}>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-9 w-8 p-0 text-destructive hover:text-destructive"
                      onClick={() => removeLine(idx)}
                      disabled={lines.length === 1}
                    >
                      ×
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>
            취소
          </Button>
          <Button onClick={handleSubmit} disabled={createMutation.isPending}>
            {createMutation.isPending ? '생성 중...' : '생성'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
