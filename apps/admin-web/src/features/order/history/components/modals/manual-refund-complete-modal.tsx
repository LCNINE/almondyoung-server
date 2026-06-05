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
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useAdminManualRefundComplete } from '@/lib/services/orders';
import type { OrderLineRow } from '@/features/order/history/hooks/use-order-rows';

interface Props {
  order: OrderLineRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone?: (refundStatus: string) => void;
}

export function ManualRefundCompleteModal({ order, open, onOpenChange, onDone }: Props) {
  const [adminNote, setAdminNote] = useState('');
  const mutation = useAdminManualRefundComplete();

  const handleClose = () => {
    setAdminNote('');
    onOpenChange(false);
  };

  const handleSubmit = async () => {
    if (!order) return;
    try {
      const result = await mutation.mutateAsync({
        id: order.orderId,
        adminNote: adminNote.trim() || undefined,
        refundLinkId: order.refundLinkId,
      });
      toast.success('수동 환불 완료로 처리되었습니다.');
      onDone?.(result.refundStatus);
      handleClose();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : undefined;
      toast.error(message ?? '처리 중 오류가 발생했습니다.');
    }
  };

  if (!order) return null;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>수동 환불 완료 확인</DialogTitle>
          <p className="text-xs text-gray-500 mt-1">주문번호: {order.orderNo}</p>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded bg-amber-50 border border-amber-200 px-3 py-3 text-sm text-amber-800">
            <p className="font-medium mb-1">이 액션은 PG/은행 자동 환불이 아닙니다.</p>
            <p className="text-xs leading-relaxed">
              외부(PG·은행·수동 이체)에서 이미 환불한 사실을 운영자가 확인하고 내부 상태를 완료로 기록합니다.
              실제 환불 처리가 완료된 경우에만 확인하세요.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label>처리 메모 (선택)</Label>
            <Textarea
              value={adminNote}
              onChange={(e) => setAdminNote(e.target.value)}
              placeholder="환불 완료 확인 근거, 처리 방법, 담당자 등을 입력하세요"
              rows={3}
              maxLength={500}
            />
            <p className="text-xs text-gray-400">{adminNote.length}/500</p>
          </div>

          {order.totalAmount != null && (
            <div className="rounded border px-3 py-2 text-sm bg-gray-50">
              <span className="text-gray-500">주문 금액: </span>
              <span className="font-medium">{order.totalAmount.toLocaleString()}원</span>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={mutation.isPending}>
            닫기
          </Button>
          <Button onClick={handleSubmit} disabled={mutation.isPending}>
            {mutation.isPending ? '처리 중...' : '수동 완료 확인'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
