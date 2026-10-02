'use client';

import { useState } from 'react';
import { toast } from 'sonner';
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
} from '@/components/ui/alert-dialog';
import {
  useDesignateLogoContestWinner,
  useLogoContestStatus,
  useUpdateLogoContestEntryStatus,
} from '@/lib/services/logo-contest';
import { AdminLogoContestEntryDto } from '@/lib/types/dto/logo-contest';

type PendingAction = 'hide' | 'show' | 'winner';

export function EntryActions({ entry }: { entry: AdminLogoContestEntryDto }) {
  const [pending, setPending] = useState<PendingAction | null>(null);
  const updateStatus = useUpdateLogoContestEntryStatus(entry.id);
  const designateWinner = useDesignateLogoContestWinner(entry.id);
  const { data: contestStatus } = useLogoContestStatus();

  const isBusy = updateStatus.isPending || designateWinner.isPending;
  const nextStatus = entry.status === 'active' ? 'hidden' : 'active';

  const runStatusChange = async () => {
    try {
      await updateStatus.mutateAsync({ status: nextStatus });
      toast.success(
        nextStatus === 'hidden'
          ? '출품작을 숨겼습니다. 받은 표는 지워졌습니다.'
          : '출품작을 다시 공개했습니다.'
      );
    } catch {
      toast.error('상태 변경에 실패했습니다.');
    } finally {
      setPending(null);
    }
  };

  const runWinnerDesignation = async () => {
    try {
      await designateWinner.mutateAsync();
      toast.success('대상 수상작을 선정했습니다.');
    } catch {
      toast.error('대상 수상작 선정에 실패했습니다.');
    } finally {
      setPending(null);
    }
  };

  return (
    <div className="flex gap-1" onClick={(event) => event.stopPropagation()}>
      <Button
        variant="outline"
        size="sm"
        disabled={isBusy}
        onClick={() => setPending(entry.status === 'active' ? 'hide' : 'show')}
      >
        {entry.status === 'active' ? '숨김' : '공개'}
      </Button>
      <Button
        variant="ghost"
        size="sm"
        disabled={
          isBusy ||
          entry.isWinner ||
          entry.status === 'hidden' ||
          !contestStatus ||
          Date.now() <= new Date(contestStatus.endsAt).getTime()
        }
        onClick={() => setPending('winner')}
      >
        대상 수상작 선정
      </Button>

      <AlertDialog
        open={pending === 'hide' || pending === 'show'}
        onOpenChange={(open) => {
          if (!open) setPending(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pending === 'hide' ? '출품작 숨기기' : '출품작 다시 공개'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              &quot;{entry.title}&quot; 을(를){' '}
              {pending === 'hide'
                ? '숨기시겠습니까?'
                : '다시 공개하시겠습니까?'}{' '}
              숨기면 이 작품이 받은 표가 모두 지워집니다. 숨김을 풀어도 표는
              돌아오지 않습니다.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction onClick={runStatusChange}>
              {pending === 'hide' ? '숨김' : '공개'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={pending === 'winner'}
        onOpenChange={(open) => {
          if (!open) setPending(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>대상 수상작 선정</AlertDialogTitle>
            <AlertDialogDescription>
              &quot;{entry.title}&quot;을(를) 로고 공모전 대상 수상작으로 선정하시겠습니까?
              기존 대상 수상작이 있다면 선정이 해제됩니다.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction onClick={runWinnerDesignation}>
              대상 수상작 선정
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
