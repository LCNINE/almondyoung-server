'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { useConfirmRefund } from '@/lib/services/wallet';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import type { RefundDto } from '@/lib/types/dto/wallet';

/**
 * «환불 내역»의 [완료 처리] — 계좌 송금 대기(무통장·수동 실행) 행만(서버가 manualConfirmable 로 정한다, #1016 36번 PR 6).
 * 행마다 독립된 mutation. 되돌릴 수 없으므로 확인을 한 번 거친다.
 */
export function RefundConfirmCell({ refund }: { refund: RefundDto }) {
  const [open, setOpen] = useState(false);
  const confirm = useConfirmRefund();
  const amount = `${refund.amount.toLocaleString('ko-KR')} ${refund.currency}`;

  const handleConfirm = () =>
    confirm.mutate(
      { refundId: refund.id, intentId: refund.intentId },
      {
        onSuccess: () => {
          toast.success('환불 완료 처리되었습니다.');
          setOpen(false);
        },
        onError: (e) => toast.error(e instanceof Error && e.message ? e.message : '완료 처리 중 오류가 발생했습니다.'),
      },
    );

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button size="sm" variant="outline" className="h-7 text-xs" disabled={confirm.isPending} onClick={(e) => e.stopPropagation()}>
          완료 처리
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent onClick={(e) => e.stopPropagation()}>
        <AlertDialogHeader>
          <AlertDialogTitle>수동 환불 완료 처리</AlertDialogTitle>
          <AlertDialogDescription>
            환불 금액 <span className="font-semibold text-foreground">{amount}</span> 을 실제로 고객 계좌에 송금했습니까? 실제 송금이 끝난
            경우에만 처리하세요. 되돌릴 수 없습니다.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={confirm.isPending}>취소</AlertDialogCancel>
          <AlertDialogAction
            disabled={confirm.isPending}
            onClick={(e) => {
              e.preventDefault();
              handleConfirm();
            }}
          >
            {confirm.isPending ? '처리 중...' : '송금 완료 확인'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
