'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { FileText, RotateCcw, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  useArchiveTrash,
  usePurgeArchivePage,
  useRestoreArchivePage,
} from '@/lib/services/archive';
import type { ArchiveTrashItemDto } from '@/lib/types/dto/archive';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function ArchiveTrashDialog({ open, onOpenChange }: Props) {
  const router = useRouter();
  const { data: items, isLoading } = useArchiveTrash(open);
  const restoreMutation = useRestoreArchivePage();
  const purgeMutation = usePurgeArchivePage();
  const [pendingPurge, setPendingPurge] = useState<ArchiveTrashItemDto | null>(
    null
  );

  const restore = (item: ArchiveTrashItemDto) => {
    restoreMutation.mutate(item.id, {
      onSuccess: (page) => {
        toast.success('되돌렸습니다.');
        onOpenChange(false);
        router.push(`/archive/${page.id}`);
      },
      onError: () => toast.error('되돌리지 못했습니다.'),
    });
  };

  const purge = () => {
    if (!pendingPurge) return;
    const target = pendingPurge;
    setPendingPurge(null);
    purgeMutation.mutate(target.id, {
      onSuccess: () => toast.success('영구 삭제했습니다.'),
      onError: () => toast.error('삭제하지 못했습니다.'),
    });
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>휴지통</DialogTitle>
            <DialogDescription>
              되돌리면 원래 자리로 돌아갑니다. 상위 페이지가 이미 지워졌다면 맨
              위로 올라옵니다.
            </DialogDescription>
          </DialogHeader>

          <div className="max-h-96 space-y-1 overflow-y-auto">
            {isLoading ? (
              <>
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
              </>
            ) : (items ?? []).length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">
                휴지통이 비어 있습니다.
              </p>
            ) : (
              (items ?? []).map((item) => (
                <div
                  key={item.id}
                  className="flex items-center gap-2 rounded-md border px-3 py-2"
                >
                  <span className="w-5 text-base leading-none">
                    {item.icon ? (
                      item.icon
                    ) : (
                      <FileText className="size-4 opacity-60" aria-hidden />
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {item.title || '제목 없음'}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {formatDeletedAt(item.deletedAt)}
                      {item.descendantCount > 0
                        ? ` · 하위 ${item.descendantCount}개 포함`
                        : ''}
                    </p>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={restoreMutation.isPending}
                    onClick={() => restore(item)}
                    className="gap-1.5"
                  >
                    <RotateCcw className="size-3.5" aria-hidden />
                    되돌리기
                  </Button>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    aria-label={`${item.title || '제목 없음'} 영구 삭제`}
                    onClick={() => setPendingPurge(item)}
                    className="size-8 text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="size-4" aria-hidden />
                  </Button>
                </div>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={Boolean(pendingPurge)}
        onOpenChange={(next) => !next && setPendingPurge(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>영구 삭제할까요?</AlertDialogTitle>
            <AlertDialogDescription>
              «{pendingPurge?.title || '제목 없음'}»
              {pendingPurge && pendingPurge.descendantCount > 0
                ? ` 와 하위 페이지 ${pendingPurge.descendantCount}개`
                : ''}
              를 저장 이력까지 함께 지웁니다. 이 작업은 되돌릴 수 없습니다.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction onClick={purge}>영구 삭제</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function formatDeletedAt(value: string | null): string {
  if (!value) return '삭제 시각 알 수 없음';
  return `${new Intl.DateTimeFormat('ko-KR', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))} 삭제`;
}
