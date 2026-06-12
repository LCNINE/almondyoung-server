'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { GitBranchPlus } from 'lucide-react';
import { toast } from 'sonner';
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
import { Spinner } from '@/components/ui/spinner';
import { useCreateMasterDraftVersion } from '@/lib/services/products/mutations';
import { formatVersionLifecycleError } from '../version-lifecycle-actions/version-lifecycle-actions-model';

type Props = {
  masterId: string;
  versionId: string | null;
};

export function CreateDraftAction({ masterId, versionId }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const createDraft = useCreateMasterDraftVersion();

  const handleConfirm = () => {
    if (createDraft.isPending) return;
    createDraft.mutate(
      {
        masterId,
        dto: { parentVersionId: versionId ?? undefined, copyMappings: true },
      },
      {
        onSuccess: (newVersion) => {
          setOpen(false);
          toast.success('새 draft 버전이 생성되었습니다.');
          router.push(`/mall/products-list/${masterId}?versionId=${newVersion.id}`);
          router.refresh();
        },
        onError: (error) => {
          setOpen(false);
          toast.error(formatVersionLifecycleError(error).title);
        },
      }
    );
  };

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={createDraft.isPending}
        className="flex items-center gap-1 rounded-md border bg-white px-3 py-1.5 text-sm text-gray-700 shadow-sm hover:bg-gray-50 disabled:opacity-50"
      >
        {createDraft.isPending ? (
          <Spinner size="sm" />
        ) : (
          <GitBranchPlus className="w-4 h-4" />
        )}
        새 draft 생성
      </button>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>새 draft 버전 생성</AlertDialogTitle>
          <AlertDialogDescription>
            {versionId
              ? '현재 보고 있는 버전을 기반으로 새 draft 버전을 생성합니다.'
              : '현재 활성(active) 버전을 기반으로 새 draft 버전을 생성합니다.'}{' '}
            가격 정책을 포함한 매핑 정보가 복사되며, 생성 후 draft 버전 편집
            화면으로 이동합니다.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={createDraft.isPending}>
            취소
          </AlertDialogCancel>
          <AlertDialogAction
            disabled={createDraft.isPending}
            onClick={(event) => {
              event.preventDefault();
              handleConfirm();
            }}
          >
            {createDraft.isPending ? '생성 중...' : '생성'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
