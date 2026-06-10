'use client';

import { useState } from 'react';
import { toast } from 'sonner';
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
import { AlertTriangle } from 'lucide-react';
import { useUnreserveFulfillment } from '@/lib/services/orders';
import type { FulfillmentOrderItemSummary } from '@/lib/types/dto/fulfillment';

interface Props {
  foId: string;
  items: FulfillmentOrderItemSummary[];
  canUnreserve: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function extractErrorMessage(err: unknown): string {
  if (err && typeof err === 'object') {
    const axiosErr = err as { response?: { data?: { message?: string | string[] } } };
    const msg = axiosErr.response?.data?.message;
    if (Array.isArray(msg)) return msg.join(', ');
    if (typeof msg === 'string') return msg;
  }
  return '알 수 없는 오류가 발생했습니다.';
}

export function UnreserveDialog({ foId, items, canUnreserve, open, onOpenChange }: Props) {
  const [foiId, setFoiId] = useState('');
  const [qty, setQty] = useState('1');
  const unreserve = useUnreserveFulfillment(foId);

  const unreservable = items.filter((i) => i.reservedQty > 0);
  const selected = unreservable.find((i) => i.id === foiId);
  const hasShippedEvidence = (selected?.shippedQty ?? 0) > 0;
  const maxQty = selected ? selected.reservedQty : 0;

  const handleSubmit = async () => {
    if (!foiId) {
      toast.error('아이템을 선택하세요.');
      return;
    }
    if (hasShippedEvidence) return;
    const quantity = parseInt(qty, 10);
    if (!quantity || quantity <= 0) {
      toast.error('수량은 1 이상이어야 합니다.');
      return;
    }
    try {
      await unreserve.mutateAsync({ fulfillmentOrderItemId: foiId, quantity });
      toast.success(`예약 해제 완료 (${quantity}개)`);
      onOpenChange(false);
      setFoiId('');
      setQty('1');
    } catch (err) {
      toast.error(`예약 해제 실패: ${extractErrorMessage(err)}`);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>예약 해제</DialogTitle>
        </DialogHeader>

        {!canUnreserve && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>현재 FO 상태에서는 예약 해제가 허용되지 않습니다.</span>
          </div>
        )}

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label>아이템 (FOI)</Label>
            <Select value={foiId} onValueChange={setFoiId}>
              <SelectTrigger>
                <SelectValue placeholder="아이템 선택" />
              </SelectTrigger>
              <SelectContent>
                {unreservable.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.skuCode} {item.skuName && `(${item.skuName})`} — 예약 {item.reservedQty}개
                    {item.shippedQty > 0 && ' ⚠ 출고됨'}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {hasShippedEvidence && (
            <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                선택한 아이템에 출고 수량(shippedQty={selected?.shippedQty})이 있어 예약 해제가 차단됩니다.
                서버도 409 에러로 거부합니다.
              </span>
            </div>
          )}

          {!hasShippedEvidence && (
            <div className="flex flex-col gap-1.5">
              <Label>수량 {maxQty > 0 && <span className="text-muted-foreground">(최대 {maxQty})</span>}</Label>
              <Input
                type="number"
                min={1}
                max={maxQty || undefined}
                value={qty}
                onChange={(e) => setQty(e.target.value)}
                className="w-32"
              />
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            취소
          </Button>
          <Button
            variant="destructive"
            onClick={handleSubmit}
            disabled={unreserve.isPending || !foiId || hasShippedEvidence || !canUnreserve}
          >
            {unreserve.isPending ? '처리 중...' : '해제'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
