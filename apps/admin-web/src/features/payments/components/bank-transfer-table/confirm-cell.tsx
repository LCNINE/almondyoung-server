'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { useConfirmBankTransfer } from '@/lib/services/wallet';
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

type Props = {
  id: string;
  payableAmount: number;
  currency: string;
};

/**
 * 무통장입금 단건 입금 확인 버튼.
 * - 행마다 독립된 mutation 인스턴스를 써서 "한 건 처리 중 전체 버튼 비활성화" 문제를 없앤다.
 * - 캡처(확정)는 되돌릴 수 없으므로 확인 다이얼로그를 한 번 거친다.
 * - 행 클릭(상세 이동)과 충돌하지 않도록 클릭 이벤트 전파를 막는다.
 */
export function BankTransferConfirmCell({ id, payableAmount, currency }: Props) {
  const [open, setOpen] = useState(false);
  const confirm = useConfirmBankTransfer();

  const amountLabel = `${payableAmount.toLocaleString('ko-KR')} ${currency}`;

  const handleConfirm = async () => {
    try {
      await confirm.mutateAsync({ id });
      toast.success('입금 확인 완료');
      setOpen(false);
    } catch {
      toast.error('입금 확인 실패');
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button
          size="sm"
          className="h-8"
          disabled={confirm.isPending}
          onClick={(e) => e.stopPropagation()}
        >
          입금 확인
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent onClick={(e) => e.stopPropagation()}>
        <AlertDialogHeader>
          <AlertDialogTitle>입금 확인 처리</AlertDialogTitle>
          <AlertDialogDescription>
            결제 <span className="font-mono">{id.slice(0, 8)}…</span> (
            <span className="font-semibold text-foreground">{amountLabel}</span>
            ) 건을 입금 확인 처리합니다. 통장에 실제 입금된 내역을 반드시 확인한 뒤
            진행하세요. 이 작업은 결제를 캡처(확정)하며 되돌릴 수 없습니다.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={confirm.isPending}>취소</AlertDialogCancel>
          <AlertDialogAction
            disabled={confirm.isPending}
            onClick={(e) => {
              e.preventDefault();
              void handleConfirm();
            }}
          >
            {confirm.isPending ? '처리 중…' : '입금 확인'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
