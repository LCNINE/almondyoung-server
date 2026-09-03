'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils/ui';
import {
  useArchiveVersion,
  useArchiveVersions,
  useRestoreArchiveVersion,
} from '@/lib/services/archive';

type Props = {
  pageId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function VersionHistory({ pageId, open, onOpenChange }: Props) {
  const { data: versions, isLoading } = useArchiveVersions(pageId, open);
  const [selectedId, setSelectedId] = useState<string | undefined>();
  const { data: selected } = useArchiveVersion(pageId, selectedId);
  const restoreMutation = useRestoreArchiveVersion();

  const restore = () => {
    if (!selectedId) return;
    restoreMutation.mutate(
      { id: pageId, versionId: selectedId },
      {
        onSuccess: () => {
          toast.success('그 시점으로 되돌렸습니다.', {
            description: '되돌리기 직전 상태도 이력에 남아 있어요.',
          });
          onOpenChange(false);
        },
        onError: () => toast.error('되돌리지 못했습니다.'),
      }
    );
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-[28rem] flex-col gap-0 p-0 sm:max-w-none"
      >
        <SheetHeader className="border-b">
          <SheetTitle>저장 이력</SheetTitle>
          <SheetDescription>
            같은 사람이 이어서 쓰는 동안은 하나로 묶이고, 사람이 바뀌거나 시간이
            지나면 새로 남습니다.
          </SheetDescription>
        </SheetHeader>

        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : (versions ?? []).length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              아직 남은 이력이 없습니다.
            </p>
          ) : (
            <ul className="space-y-1">
              {(versions ?? []).map((version) => (
                <li key={version.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(version.id)}
                    aria-pressed={version.id === selectedId}
                    className={cn(
                      'w-full rounded-md px-3 py-2 text-left transition-colors duration-150',
                      version.id === selectedId ? 'bg-accent' : 'hover:bg-muted'
                    )}
                  >
                    <span className="block text-sm font-medium">
                      {formatAt(version.createdAt)}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {version.title || '제목 없음'}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {selected ? (
          <div className="border-t">
            <div className="max-h-64 overflow-y-auto bg-muted/40 p-3">
              <p className="pb-1 text-xs font-medium text-muted-foreground">
                그때의 본문
              </p>
              <pre className="whitespace-pre-wrap break-words font-sans text-xs leading-5">
                {selected.contentMarkdown || '(본문 없음)'}
              </pre>
            </div>
            <div className="p-3">
              <Button
                type="button"
                className="w-full"
                disabled={restoreMutation.isPending}
                onClick={restore}
              >
                이 시점으로 되돌리기
              </Button>
            </div>
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function formatAt(value: string): string {
  return new Intl.DateTimeFormat('ko-KR', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}
