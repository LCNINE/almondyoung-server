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
import { useInspectReturn } from '@/lib/services/inventory';
import type { ReturnItemDto } from '@/lib/types/dto/inventory';

type Props = {
  returnId: string;
  items: ReturnItemDto[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

type ItemInspect = {
  qcStatus: 'passed' | 'failed';
  qcPassedQuantity: number;
  qcFailedQuantity: number;
  qcReason: string;
};

export function InspectReturnDialog({ returnId, items, open, onOpenChange }: Props) {
  const mutation = useInspectReturn();
  const [inspectedBy, setInspectedBy] = useState('');
  const [qcNotes, setQcNotes] = useState('');

  const [itemState, setItemState] = useState<Record<string, ItemInspect>>(() =>
    Object.fromEntries(
      items.map((i) => [
        i.id,
        {
          qcStatus: 'passed',
          qcPassedQuantity: i.receivedQuantity ?? i.requestedQuantity,
          qcFailedQuantity: 0,
          qcReason: '',
        },
      ])
    )
  );

  const update = (id: string, patch: Partial<ItemInspect>) =>
    setItemState((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));

  const handleSubmit = async () => {
    if (!inspectedBy.trim()) {
      toast.error('검사자 이름을 입력해주세요.');
      return;
    }
    try {
      await mutation.mutateAsync({
        id: returnId,
        data: {
          returnId,
          inspectedBy,
          qcNotes: qcNotes || undefined,
          items: items.map((item) => ({
            returnItemId: item.id,
            qcStatus: itemState[item.id]?.qcStatus ?? 'passed',
            qcPassedQuantity: itemState[item.id]?.qcPassedQuantity,
            qcFailedQuantity: itemState[item.id]?.qcFailedQuantity,
            qcReason: itemState[item.id]?.qcReason || undefined,
          })),
        },
      });
      toast.success('QC 검수가 완료되었습니다.');
      onOpenChange(false);
    } catch {
      toast.error('QC 검수에 실패했습니다.');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>QC 검수</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1">
            <Label>검사자</Label>
            <Input
              placeholder="검사자 이름"
              value={inspectedBy}
              onChange={(e) => setInspectedBy(e.target.value)}
            />
          </div>

          {items.map((item) => (
            <div key={item.id} className="space-y-2 rounded border p-3">
              <p className="text-xs text-muted-foreground font-mono">{item.skuId.substring(0, 8)}…</p>
              <div className="grid grid-cols-3 gap-2">
                <div className="space-y-1">
                  <Label className="text-xs">QC 결과</Label>
                  <Select
                    value={itemState[item.id]?.qcStatus ?? 'passed'}
                    onValueChange={(v) => update(item.id, { qcStatus: v as 'passed' | 'failed' })}
                  >
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="passed">통과</SelectItem>
                      <SelectItem value="failed">실패</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">통과 수량</Label>
                  <Input
                    type="number"
                    min={0}
                    className="h-8 text-xs"
                    value={itemState[item.id]?.qcPassedQuantity ?? 0}
                    onChange={(e) => update(item.id, { qcPassedQuantity: Number(e.target.value) })}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">실패 수량</Label>
                  <Input
                    type="number"
                    min={0}
                    className="h-8 text-xs"
                    value={itemState[item.id]?.qcFailedQuantity ?? 0}
                    onChange={(e) => update(item.id, { qcFailedQuantity: Number(e.target.value) })}
                  />
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">사유 (선택)</Label>
                <Input
                  className="h-8 text-xs"
                  placeholder="QC 사유"
                  value={itemState[item.id]?.qcReason ?? ''}
                  onChange={(e) => update(item.id, { qcReason: e.target.value })}
                />
              </div>
            </div>
          ))}

          <div className="space-y-1">
            <Label>QC 메모 (선택)</Label>
            <Input
              placeholder="전체 검수 노트"
              value={qcNotes}
              onChange={(e) => setQcNotes(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>취소</Button>
          <Button onClick={handleSubmit} disabled={mutation.isPending}>
            {mutation.isPending ? '처리 중…' : 'QC 완료'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
