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
import type { BannerGroupDto } from '@/lib/types/dto/products';

type Props = {
  open: boolean;
  target: BannerGroupDto | null;
  isLoading: boolean;
  onConfirm: () => void;
  onOpenChange: (open: boolean) => void;
};

export function BannerGroupDeleteDialog({
  open,
  target,
  isLoading,
  onConfirm,
  onOpenChange,
}: Props) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>배너 그룹 삭제</AlertDialogTitle>
          <AlertDialogDescription>
            <strong>{target?.title}</strong> 그룹을 삭제합니다.
            소속 배너도 함께 삭제되며 복구할 수 없습니다. 계속하시겠습니까?
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isLoading}>취소</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm} disabled={isLoading}>
            삭제
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
