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

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (copyMappings: boolean) => void;
  isPending: boolean;
}

export function CreateDraftDialog({ open, onOpenChange, onConfirm, isPending }: Props) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>새 draft 버전 생성</AlertDialogTitle>
          <AlertDialogDescription>
            현재 활성(active) 버전을 기반으로 새 draft 버전을 생성합니다. 가격 정책을 포함한
            매핑 정보가 복사됩니다. 생성 후 draft 버전에서 가격 룰을 편집할 수 있습니다.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPending}>취소</AlertDialogCancel>
          <AlertDialogAction disabled={isPending} onClick={() => onConfirm(true)}>
            {isPending ? '생성 중...' : '생성'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
