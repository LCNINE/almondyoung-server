'use client';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

export function CouponDeleteDialog({
  open,
  onOpenChange,
  couponCode,
  onConfirm,
  isPending,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  couponCode: string;
  onConfirm: () => void;
  isPending: boolean;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>쿠폰 삭제</AlertDialogTitle>
          <AlertDialogDescription>
            쿠폰{' '}
            <span className="font-mono font-semibold text-foreground">{couponCode}</span>
            을(를) 삭제하시겠습니까?
            <br />
            삭제된 쿠폰은 복구할 수 없으며, 이미 발급된 고객도 해당 쿠폰을 사용할 수 없게 됩니다.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPending}>취소</AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            disabled={isPending}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {isPending ? '삭제 중...' : '삭제'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
