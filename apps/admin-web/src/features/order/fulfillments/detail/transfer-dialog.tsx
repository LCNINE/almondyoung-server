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
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { AlertTriangle } from 'lucide-react';
import {
  useTransferFulfillmentReservation,
  useFulfillmentTransferCandidates,
} from '@/lib/services/orders';
import type { FulfillmentOrderItemSummary, TransferCandidate } from '@/lib/types/dto/fulfillment';

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

function candidateLabel(c: TransferCandidate): string {
  const foShort = c.fulfillmentOrderId.slice(0, 8);
  const so = c.salesOrderId ? ` · 주문 ${c.salesOrderId.slice(0, 8)}` : '';
  return `FO ${foShort} · ${c.fulfillmentOrderStatus}${so} — 미예약 ${c.shortage}개`;
}

export function TransferDialog({ foId, items, canTransfer, open, onOpenChange }: Props) {
  const [fromFoiId, setFromFoiId] = useState('');
  const [toFoiId, setToFoiId] = useState('');
  const [qty, setQty] = useState('1');
  const transfer = useTransferFulfillmentReservation(foId);

  const fromCandidates = items.filter((i) => i.reservedQty > 0);
  const fromItem = fromCandidates.find((i) => i.id === fromFoiId);

  // to 후보: 서버가 같은 창고·같은 SKU·작업 전 상태·미예약 부족분 > 0 조건으로 필터 (cross-FO 포함)
  const { data: candidates = [], isLoading: candidatesLoading } = useFulfillmentTransferCandidates(
    foId,
    open && fromFoiId ? fromFoiId : undefined,
  );
  const sameFoCandidates = candidates.filter((c) => c.sameFulfillmentOrder);
  const crossFoCandidates = candidates.filter((c) => !c.sameFulfillmentOrder);
  const selectedTarget = candidates.find((c) => c.id === toFoiId);

  // 이전 가능 최대치 = min(출처 예약 수량, 대상 미예약 부족분)
  const maxQty = selectedTarget
    ? Math.min(fromItem?.reservedQty ?? 0, selectedTarget.shortage)
    : (fromItem?.reservedQty ?? 0);

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
    if (quantity > maxQty) {
      toast.error(`이전 가능 수량을 초과했습니다. (최대 ${maxQty}개)`);
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
          같은 창고 · 같은 SKU의 FOI 간에만 이전 가능합니다. 출처를 선택하면 이 FO와 다른 FO의 이전
          가능 대상이 자동으로 조회됩니다. (작업 전 상태의 FO만 대상)
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
            <Select value={toFoiId} onValueChange={setToFoiId} disabled={!fromFoiId || candidatesLoading}>
              <SelectTrigger>
                <SelectValue
                  placeholder={
                    !fromFoiId
                      ? '출처를 먼저 선택'
                      : candidatesLoading
                        ? '대상 후보 조회 중...'
                        : candidates.length === 0
                          ? '이전 가능한 대상 없음'
                          : '대상 아이템 선택'
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {sameFoCandidates.length > 0 && (
                  <SelectGroup>
                    <SelectLabel>이 FO 내</SelectLabel>
                    {sameFoCandidates.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {fromItem?.skuCode} — 미예약 {c.shortage}개
                      </SelectItem>
                    ))}
                  </SelectGroup>
                )}
                {crossFoCandidates.length > 0 && (
                  <SelectGroup>
                    <SelectLabel>다른 FO</SelectLabel>
                    {crossFoCandidates.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {candidateLabel(c)}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                )}
              </SelectContent>
            </Select>
            {fromFoiId && !candidatesLoading && candidates.length === 0 && (
              <p className="text-xs text-muted-foreground">
                같은 창고 · 같은 SKU에서 예약을 받을 수 있는 작업 전 상태의 FOI가
                없습니다.
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
            disabled={
              transfer.isPending || !fromFoiId || !toFoiId || !canTransfer
            }
          >
            {transfer.isPending ? '처리 중...' : '이전'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
