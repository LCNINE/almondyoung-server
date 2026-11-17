'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Lock, Rocket, Trash2 } from 'lucide-react';
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
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { Container } from '@/components/admin-ui-experimental/common/container';
import { Header } from '@/components/admin-ui-experimental/common/header';
import { products } from '@/lib/api/domains';
import { usePermissionCheck } from '@/hooks/use-permission';
import {
  useDeleteDraftProductVersion,
  usePublishProductVersion,
} from '@/lib/services/products/mutations';
import { productQueryKeys } from '@/lib/services/products/query-keys';
import { useVersionPricingRules } from '@/lib/services/products/queries';
import { ShellLink } from '@/components/layout/tenant-shell/shell-link';
import { useProductDetailSuspense } from '@/lib/services/products/use-product-detail';
import {
  formatVersionLifecycleError,
  getPublishGaps,
  getVersionLifecycleActions,
  PUBLISH_GAP_LABELS,
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
  const bulkSessionId = data.bulkSessionId;
  const publish = usePublishProductVersion();
  const deleteDraft = useDeleteDraftProductVersion();
  const [error, setError] = useState<VersionLifecycleError | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [gapsOpen, setGapsOpen] = useState(false);
  const { canRun } = usePermissionCheck();
  const showPublish = actions.canPublish && canRun(usePublishProductVersion);
  const showDeleteDraft =
    actions.canDeleteDraft && canRun(useDeleteDraftProductVersion);
  // 발행 전 «빠진 것» — 막지는 않고 한 번 확인받는다. 규칙을 못 읽었으면 «확인 못 함»으로 보인다.
  const pricingRules = useVersionPricingRules(showPublish ? (data.versionId ?? '') : '');
  const publishGaps = getPublishGaps({
    basePriceRuleCount: pricingRules.isSuccess
      ? pricingRules.data.basePriceRules.length
      : null,
    images: data.images,
  });

  // 세션 API 는 소유자 스코프라 남의 세션은 404/403 이다. 링크를 무조건 걸어놓고
  // 눌렀을 때 404 로 보내는 것보다, 조회해 보고 없으면 링크를 안 거는 편이 정직하다.
  const session = useQuery({
    queryKey: productQueryKeys.bulkSession(bulkSessionId ?? ''),
    // `enabled` 가 bulkSessionId 있을 때만 이 queryFn 을 부르지만 TS 는 같은 객체
    // 리터럴의 두 옵션 사이 관계를 좁혀주지 않는다. non-null 단언 대신 가드로 좁힌다 —
    // 이 분기에 실제로 들어오면 enabled 배선이 깨진 것이므로 바로 던진다.
    queryFn: () => {
      if (!bulkSessionId) {
        throw new Error(
          '세션 배너 쿼리는 bulkSessionId 가 있을 때만 호출돼야 한다(enabled 배선 확인)'
        );
      }
      return products.bulkSession.getProgress(bulkSessionId);
    },
    enabled: Boolean(bulkSessionId),
    retry: false,
  });

  if (!showPublish && !showDeleteDraft && !bulkSessionId) {
    return null;
  }

  const isBusy = publish.isPending || deleteDraft.isPending;

  const requestPublish = () => {
    if (publishGaps.length > 0) setGapsOpen(true);
    else handlePublish();
  };

  const handlePublish = () => {
    if (!data.versionId || publish.isPending) return;
    setGapsOpen(false);
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
    <Container className="bg-background">
      <Header title="상품 등록" />

      <div className="flex flex-col gap-4 px-6 pb-6">
        {bulkSessionId &&
          (session.isSuccess ? (
            <Alert>
              <Lock />
              <AlertTitle>
                일괄 세션에 속한 임시 버전입니다. 발행·삭제는 세션에서 합니다.
              </AlertTitle>
              <AlertDescription>
                <Link
                  href={`/mall/bulk-sessions/${bulkSessionId}`}
                  className="underline"
                >
                  세션 열기
                </Link>
              </AlertDescription>
            </Alert>
          ) : (
            <Alert>
              <Lock />
              <AlertTitle>
                다른 작업자의 일괄 세션에 속한 임시 버전입니다. 발행·삭제는 그
                세션에서 합니다.
              </AlertTitle>
            </Alert>
          ))}

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
          {showPublish && (
            <AlertDialog open={gapsOpen} onOpenChange={setGapsOpen}>
              <Button
                onClick={requestPublish}
                disabled={isBusy || pricingRules.isLoading}
              >
                {publish.isPending ? (
                  <Spinner size="sm" data-icon="inline-start" />
                ) : (
                  <Rocket data-icon="inline-start" />
                )}
                Version 발행
              </Button>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>빠진 것이 있습니다. 그래도 발행할까요?</AlertDialogTitle>
                  <AlertDialogDescription asChild>
                    <div className="flex flex-col gap-2">
                      <ul className="flex list-disc flex-col gap-1 pl-4">
                        {publishGaps.map((gap) => (
                          <li key={gap}>{PUBLISH_GAP_LABELS[gap]}</li>
                        ))}
                      </ul>
                      {publishGaps.some((gap) => gap !== 'image') && data.versionId && (
                        <ShellLink
                          href={`/mall/pricing/${masterId}?versionId=${data.versionId}`}
                          className="underline"
                        >
                          가격 관리에서 판매가 정하기
                        </ShellLink>
                      )}
                    </div>
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel disabled={publish.isPending}>취소</AlertDialogCancel>
                  <AlertDialogAction
                    disabled={publish.isPending}
                    onClick={(event) => {
                      event.preventDefault();
                      handlePublish();
                    }}
                  >
                    {publish.isPending && <Spinner size="sm" />}
                    그래도 발행
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}

          {showDeleteDraft && (
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
