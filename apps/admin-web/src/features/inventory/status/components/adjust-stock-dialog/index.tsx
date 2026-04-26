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
import { useAdjustStock } from '@/lib/services/inventory';
import type { StockSummaryDto } from '@/lib/types/dto/inventory';
import { toast } from 'sonner';

type Props = {
  row: StockSummaryDto | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

const ADJUST_REASONS = [
  { label: '분실', value: 'LOST' },
  { label: '파손', value: 'DAMAGED' },
  { label: '반환', value: 'RETURN' },
  { label: '실사 조정', value: 'STOCKTAKING' },
  { label: '기타', value: 'OTHER' },
];

export function AdjustStockDialog({ row, open, onOpenChange }: Props) {
  const [delta, setDelta] = useState<number | ''>('');
  const [reason, setReason] = useState('');

  const adjustMutation = useAdjustStock();

  const handleSubmit = async () => {
    if (!row || delta === '') return;
    if (delta === 0) {
      toast.error('조정 수량이 0입니다.');
      return;
    }
    if (!reason) {
      toast.error('사유를 선택해 주세요.');
      return;
    }
    try {
      await adjustMutation.mutateAsync({
        skuId: row.skuId,
        warehouseId: row.warehouseId,
        delta: delta as number,
        reason,
      });
      toast.success('재고가 조정되었습니다.');
      setDelta('');
      setReason('');
      onOpenChange(false);
    } catch {
      toast.error('재고 조정에 실패했습니다.');
    }
  };

  const handleClose = () => {
    setDelta('');
    setReason('');
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>재고 조정 — {row?.skuName}</DialogTitle>
        </DialogHeader>

        {row && (
          <p className="text-sm text-muted-foreground">
            창고: {row.warehouseName} / 현재 수량:{' '}
            <span className="font-medium text-foreground">
              {row.currentQuantity.toLocaleString('ko-KR')}
            </span>
          </p>
        )}

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="delta">조정 수량</Label>
            <Input
              id="delta"
              type="number"
              value={delta}
              onChange={(e) =>
                setDelta(e.target.value !== '' ? Number(e.target.value) : '')
              }
              placeholder="양수=증가, 음수=감소"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="reason">사유</Label>
            <select
              id="reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <option value="">사유 선택</option>
              {ADJUST_REASONS.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>
            취소
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={adjustMutation.isPending || delta === '' || !reason}
          >
            {adjustMutation.isPending ? '조정 중...' : '조정'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
