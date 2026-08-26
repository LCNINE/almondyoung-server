'use client';

import { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { getServerDenyMessage } from '@/lib/api/server-error';
import { useMarkPurchaseOrderLineUnavailable } from '@/lib/services/inventory';
import type { PurchaseOrderDto, PurchaseOrderLineDto } from '@/lib/types/dto/inventory';
import { toast } from 'sonner';

type Props = {
  po: PurchaseOrderDto;
  line: PurchaseOrderLineDto | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function MarkLineUnavailableDialog({ po, line, open, onOpenChange }: Props) {
  const [reason, setReason] = useState('');
  const mutation = useMarkPurchaseOrderLineUnavailable();

  useEffect(() => {
    if (open) setReason('');
  }, [open, line]);

  if (!line) return null;

  const handleSubmit = async () => {
    try {
      await mutation.mutateAsync({
        poId: po.id,
        skuId: line.skuId,
        data: reason.trim() ? { reason: reason.trim() } : {},
      });
      toast.success('발주하지 못한 품목으로 종결했습니다.');
      onOpenChange(false);
    } catch (e: unknown) {
      toast.error(getServerDenyMessage(e, '라인 종결에 실패했습니다.'));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>발주 불가 — {line.sku?.name ?? line.skuId}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4 py-2">
          <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            이 품목을 끝내 발주하지 못했다고 종결합니다. <strong>되돌릴 수 없습니다</strong> —
            다시 사려면 새 발주서를 만들어야 합니다.
          </p>

          <div className="flex flex-col gap-1">
            <Label htmlFor="unavailable-reason">사유 (선택, 500자 이내)</Label>
            <Textarea
              id="unavailable-reason"
              maxLength={500}
              placeholder="품절 / 단종 / 공급처 미응답 등"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            닫기
          </Button>
          <Button variant="destructive" onClick={handleSubmit} disabled={mutation.isPending}>
            {mutation.isPending ? '처리 중…' : '불가로 종결'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
