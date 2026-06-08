'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, Rocket, Trash2 } from 'lucide-react';
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
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { Container } from '@/components/admin-ui-experimental/common/container';
import { Header } from '@/components/admin-ui-experimental/common/header';
import {
  useDeleteDraftProductVersion,
  usePublishProductVersion,
} from '@/lib/services/products/mutations';
import { useProductDetailSuspense } from '@/lib/services/products/use-product-detail';
import {
  formatVersionLifecycleError,
  getVersionLifecycleActions,
  getVersionLifecycleDeleteSuccessHref,
  type VersionLifecycleError,
} from './version-lifecycle-actions-model';

type Props = {
  masterId: string;
  versionId: string;
};

export function VersionLifecycleActions({ masterId, versionId }: Props) {
  const router = useRouter();
  const { data } = useProductDetailSuspense(masterId, versionId);
  const actions = getVersionLifecycleActions(data);
  const publish = usePublishProductVersion();
  const deleteDraft = useDeleteDraftProductVersion();
  const [error, setError] = useState<VersionLifecycleError | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);

  if (!actions.canPublish && !actions.canDeleteDraft) {
    return null;
  }

  const isBusy = publish.isPending || deleteDraft.isPending;

  const handlePublish = () => {
    if (!data.versionId || publish.isPending) return;
    setError(null);
    publish.mutate(
      { masterId, versionId: data.versionId },
      {
        onSuccess: () => {
          toast.success('version이 active로 발행되었습니다.');
          router.push(`/mall/products-list/${masterId}`);
          router.refresh();
        },
        onError: (publishError) => {
          setError(formatVersionLifecycleError(publishError));
        },
      }
    );
  };

  const handleDeleteDraft = () => {
    if (!data.versionId || deleteDraft.isPending) return;
    setError(null);
    deleteDraft.mutate(
      { masterId, versionId: data.versionId },
      {
        onSuccess: () => {
          setDeleteOpen(false);
          toast.success('draft version이 삭제되었습니다.');
          router.push(getVersionLifecycleDeleteSuccessHref());
          router.refresh();
        },
        onError: (deleteError) => {
          setDeleteOpen(false);
          setError(formatVersionLifecycleError(deleteError));
        },
      }
    );
  };

  return (
    <Container className="divide-y-0 bg-background">
      <Header
        title="Version 발행 및 삭제"
        subtitle="서버 검증을 통과하면 이 version이 active version으로 전환됩니다."
        right={<Badge variant="secondary">체크리스트 차단 없음</Badge>}
      />

      <div className="flex flex-col gap-4 px-6 pb-6">
        {error && (
          <Alert variant="destructive">
            <AlertTriangle />
            <AlertTitle>{error.title}</AlertTitle>
            {error.details.length > 0 && (
              <AlertDescription>
                <ul className="flex list-disc flex-col gap-1 pl-4">
                  {error.details.map((detail) => (
                    <li key={detail}>{detail}</li>
                  ))}
                </ul>
              </AlertDescription>
            )}
          </Alert>
        )}

        <div className="flex flex-wrap items-center gap-2">
          {actions.canPublish && (
            <Button onClick={handlePublish} disabled={isBusy}>
              {publish.isPending ? (
                <Spinner size="sm" data-icon="inline-start" />
              ) : (
                <Rocket data-icon="inline-start" />
              )}
              Version 발행
            </Button>
          )}

          {actions.canDeleteDraft && (
            <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
              <Button
                type="button"
                variant="destructive"
                disabled={isBusy}
                onClick={() => setDeleteOpen(true)}
              >
                {deleteDraft.isPending ? (
                  <Spinner size="sm" data-icon="inline-start" />
                ) : (
                  <Trash2 data-icon="inline-start" />
                )}
                Draft 삭제
              </Button>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Draft version 삭제</AlertDialogTitle>
                  <AlertDialogDescription>
                    이 draft version과 draft에만 연결된 데이터가 삭제됩니다.
                    삭제 후에는 상품 목록 화면으로 이동합니다.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel disabled={deleteDraft.isPending}>
                    취소
                  </AlertDialogCancel>
                  <AlertDialogAction
                    className="bg-destructive text-white hover:bg-destructive/90"
                    disabled={deleteDraft.isPending}
                    onClick={(event) => {
                      event.preventDefault();
                      handleDeleteDraft();
                    }}
                  >
                    {deleteDraft.isPending && <Spinner size="sm" />}
                    삭제
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>
      </div>
    </Container>
  );
}
