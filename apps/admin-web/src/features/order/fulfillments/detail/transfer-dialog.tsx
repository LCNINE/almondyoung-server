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
import { useTransferFulfillmentReservation } from '@/lib/services/orders';
import type { FulfillmentOrderItemSummary } from '@/lib/types/dto/fulfillment';

interface Props {
  foId: string;
  items: FulfillmentOrderItemSummary[];
  canTransfer: boolean;
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

export function TransferDialog({ foId, items, canTransfer, open, onOpenChange }: Props) {
  const [fromFoiId, setFromFoiId] = useState('');
  const [toFoiId, setToFoiId] = useState('');
  const [qty, setQty] = useState('1');
  const transfer = useTransferFulfillmentReservation(foId);

  const fromCandidates = items.filter((i) => i.reservedQty > 0);
  const fromItem = fromCandidates.find((i) => i.id === fromFoiId);

  // to 후보: 같은 SKU, from과 다른 FOI, 미예약 수량 > 0
  const toCandidates = fromItem
    ? items.filter(
        (i) =>
          i.id !== fromFoiId &&
          i.skuId === fromItem.skuId &&
          i.qty - i.reservedQty > 0
      )
    : [];

  const maxQty = fromItem?.reservedQty ?? 0;

  const handleSubmit = async () => {
    if (!fromFoiId || !toFoiId) {
      toast.error('이동할 아이템을 선택하세요.');
      return;
    }
    const quantity = parseInt(qty, 10);
    if (!quantity || quantity <= 0) {
      toast.error('수량은 1 이상이어야 합니다.');
      return;
    }
    try {
      await transfer.mutateAsync({
        fromFulfillmentOrderItemId: fromFoiId,
        toFulfillmentOrderItemId: toFoiId,
        quantity,
      });
      toast.success(`예약 이전 완료 (${quantity}개)`);
      onOpenChange(false);
      setFromFoiId('');
      setToFoiId('');
      setQty('1');
    } catch (err) {
      toast.error(`예약 이전 실패: ${extractErrorMessage(err)}`);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>예약 이전</DialogTitle>
        </DialogHeader>

        {!canTransfer && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>현재 FO 상태에서는 예약 이전이 허용되지 않습니다.</span>
          </div>
        )}

        <p className="text-xs text-muted-foreground">
          같은 SKU의 FOI 간에만 이전 가능합니다. SKU가 다른 FOI를 대상으로 선택하면 서버가 400으로 거부합니다.
        </p>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label>이동 출처 (From FOI)</Label>
            <Select value={fromFoiId} onValueChange={(v) => { setFromFoiId(v); setToFoiId(''); }}>
              <SelectTrigger>
                <SelectValue placeholder="출처 아이템 선택" />
              </SelectTrigger>
              <SelectContent>
                {fromCandidates.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.skuCode} {item.skuName && `(${item.skuName})`} — 예약 {item.reservedQty}개
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>이동 대상 (To FOI)</Label>
            <Select value={toFoiId} onValueChange={setToFoiId} disabled={!fromFoiId}>
              <SelectTrigger>
                <SelectValue placeholder={fromFoiId ? (toCandidates.length === 0 ? '같은 SKU 대상 없음' : '대상 아이템 선택') : '출처를 먼저 선택'} />
              </SelectTrigger>
              <SelectContent>
                {toCandidates.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.skuCode} {item.skuName && `(${item.skuName})`} — 미예약 {item.qty - item.reservedQty}개
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {fromFoiId && toCandidates.length === 0 && (
              <p className="text-xs text-muted-foreground">
                이 FO 내에 같은 SKU의 미예약 대상이 없습니다.
              </p>
            )}
          </div>

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
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            취소
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={transfer.isPending || !fromFoiId || !toFoiId || toCandidates.length === 0 || !canTransfer}
          >
            {transfer.isPending ? '처리 중...' : '이전'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
