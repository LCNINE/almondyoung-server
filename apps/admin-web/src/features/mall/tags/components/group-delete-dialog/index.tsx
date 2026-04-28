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
import type { TagGroupDto } from '@/lib/types/dto/products';

type Props = {
  open: boolean;
  target: TagGroupDto | null;
  isLoading: boolean;
  onConfirm: () => void;
  onOpenChange: (open: boolean) => void;
};

export function GroupDeleteDialog({
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
          <AlertDialogTitle>태그 그룹 삭제</AlertDialogTitle>
          <AlertDialogDescription>
            <strong>{target?.name}</strong> 그룹을 삭제합니다.
            태그 값이 남아있으면 삭제가 거부됩니다. 먼저 태그 값을 모두 삭제한 후 시도해 주세요.
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
