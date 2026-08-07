// src/features/mall/bulk-sessions/session-detail/drafted-panel/index.tsx
// 세션이 drafted 인 동안 보여줄 패널. 임시 버전까지 만들어졌고, 사람이 발행을
// 트리거하거나 draft 실패 행을 재시도할 차례다.

'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { SimplePagination } from '@/components/simple-pagination';
import {
  useBulkSessionItems,
  useExcludeItem,
  usePublishBulkSession,
  useRetryDraft,
} from '@/lib/services/products/bulk-session';
import { toCountMap } from '@/lib/services/products/bulk-session-model';
import type {
  BulkPublishStatus,
  BulkSessionItem,
  BulkSessionProgress,
} from '@/lib/types/dto/bulk-session';
import { notifySessionMutationError } from '../../lib/session-mutation-error';
import {
  itemVersionState,
  itemVersionStateLabel,
} from '../../lib/item-version-state';
import { ItemActions } from './item-actions';

const PAGE_SIZE = 20;

/** 이 패널이 다루는 status 축 — review 단계의 pending/invalid 와는 다른 값이다. */
type DraftedTab = 'drafted' | 'failed' | 'excluded';

const DRAFTED_TABS: DraftedTab[] = ['drafted', 'failed', 'excluded'];

const TAB_LABEL: Record<DraftedTab, string> = {
  drafted: '작성됨',
  failed: '실패',
  excluded: '제외됨',
};

function isDraftedTab(value: string): value is DraftedTab {
  return value === 'drafted' || value === 'failed' || value === 'excluded';
}

/** status 와 다른 축이다 — drafted 행이라도 publishStatus 는 독립적으로 붙는다. */
const PUBLISH_STATUS_LABEL: Record<BulkPublishStatus, string> = {
  idle: '발행 전',
  pending: '발행 대기',
  published: '발행 완료',
  failed: '발행 실패',
};

function publishStatusBadgeVariant(
  status: BulkPublishStatus
): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (status === 'failed') return 'destructive';
  if (status === 'published') return 'secondary';
  return 'outline';
}

const KIND_LABEL: Record<BulkSessionItem['kind'], string> = {
  create: '신규',
  update: '수정',
};

/**
 * retry-draft 재시도 경고. 신규 상품 행은 재시도할 때마다 백엔드가 `createMaster` 를
 * 다시 태워 Kafka 이벤트 발행과 `product_matchings` insert 가 트랜잭션 밖에서 한 번 더
 * 쌓인다(롤백돼도 안 지워진다) — 근본 수정은 catalog core 범위라 미룬 상태다. 이 문구가
 * 유일한 방지막이라 버튼과 떨어뜨리지 않는다.
 */
const RETRY_WARNING =
  '실패한 행만 다시 처리합니다. 신규 상품 행은 재시도할 때마다 내부 등록 기록이 한 번 더 쌓이므로, 원인을 확인한 뒤 눌러 주세요.';

export function DraftedPanel({
  sessionId,
  progress,
}: {
  sessionId: string;
  progress: BulkSessionProgress;
}) {
  const qc = useQueryClient();
  const [tab, setTab] = useState<DraftedTab>('drafted');
  const [page, setPage] = useState(1);

  const itemsQuery = useBulkSessionItems(sessionId, {
    status: tab,
    page,
    limit: PAGE_SIZE,
  });
  const publish = usePublishBulkSession(sessionId);
  const retryDraft = useRetryDraft(sessionId);
  const excludeItem = useExcludeItem(sessionId);

  function handleTabChange(value: string) {
    if (!isDraftedTab(value)) return;
    setTab(value);
    setPage(1);
  }

  function handlePublish() {
    publish.mutate(undefined, {
      onSuccess: () => toast.success('발행을 시작했습니다.'),
      onError: (error) => notifySessionMutationError(error, qc, sessionId),
    });
  }

  function handleRetryDraft() {
    retryDraft.mutate(undefined, {
      onSuccess: () => toast.success('실패한 행을 다시 처리합니다.'),
      onError: (error) => notifySessionMutationError(error, qc, sessionId),
    });
  }

  function handleExclude(itemId: string) {
    excludeItem.mutate(itemId, {
      onSuccess: () => toast.success('제외했습니다.'),
      onError: (error) => notifySessionMutationError(error, qc, sessionId),
    });
  }

  const itemCounts = toCountMap(progress.itemCounts);
  const failedCount = itemCounts.failed ?? 0;
  const hasFailedDrafts = failedCount > 0;

  const items = itemsQuery.data?.data ?? [];
  const total = itemsQuery.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          {hasFailedDrafts && (
            <Badge variant="destructive">draft 실패 {failedCount}건</Badge>
          )}
        </div>
        <Button
          type="button"
          disabled={publish.isPending}
          onClick={handlePublish}
        >
          {publish.isPending && <Spinner size="sm" data-icon="inline-start" />}
          일괄 발행
        </Button>
      </div>

      {hasFailedDrafts && (
        <div className="rounded-lg border p-4">
          <div className="flex items-center justify-between gap-4">
            <p className="text-sm font-medium">draft 실패 행이 있습니다</p>
            <Button
              type="button"
              variant="outline"
              disabled={retryDraft.isPending}
              onClick={handleRetryDraft}
            >
              {retryDraft.isPending && (
                <Spinner size="sm" data-icon="inline-start" />
              )}
              draft 실패 행 재시도
            </Button>
          </div>
          <Alert variant="destructive" className="mt-3">
            <AlertDescription>{RETRY_WARNING}</AlertDescription>
          </Alert>
        </div>
      )}

      <Tabs value={tab} onValueChange={handleTabChange}>
        <TabsList>
          {DRAFTED_TABS.map((value) => (
            <TabsTrigger key={value} value={value}>
              {TAB_LABEL[value]}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {itemsQuery.isPending && (
        <p className="text-sm text-muted-foreground">불러오는 중입니다…</p>
      )}
      {itemsQuery.isError && (
        <p role="alert" className="text-sm text-destructive">
          목록을 불러오지 못했습니다.
        </p>
      )}
      {itemsQuery.data && items.length === 0 && (
        <p className="text-sm text-muted-foreground">표시할 행이 없습니다.</p>
      )}
      {items.length > 0 && (
        <div className="flex flex-col divide-y rounded-lg border">
          {items.map((item) => {
            const displayName = item.productName || '—';
            // 버전 상태 배지는 **작성됨 탭에서만** 단다. draft 생성이 실패한 행은
            // `draftVersionId` 가 null 이라 판정이 '변경 없음'/'판매정책만 적용'으로 나오는데,
            // 그 행은 아무것도 적용되지 않았으므로 오류 메시지 바로 위에 정반대로 읽히는
            // 문구가 붙는다. 제외 탭도 같다.
            const versionLabel =
              tab === 'drafted' ? itemVersionStateLabel(itemVersionState(item)) : null;
            return (
              <div
                key={item.id}
                className="flex items-center justify-between gap-4 px-3 py-2"
              >
                <div className="flex flex-col gap-1 text-sm">
                  <span>
                    {item.rowNumber} · {item.rowKey} · {KIND_LABEL[item.kind]} ·{' '}
                    {displayName}
                  </span>
                  {versionLabel && (
                    <span className="text-xs text-muted-foreground">
                      {versionLabel}
                    </span>
                  )}
                  {item.errorMessage && (
                    <span role="alert" className="text-destructive">
                      {item.errorMessage}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <Badge
                    variant={publishStatusBadgeVariant(item.publishStatus)}
                  >
                    {PUBLISH_STATUS_LABEL[item.publishStatus]}
                  </Badge>
                  <ItemActions
                    item={item}
                    excluding={excludeItem.isPending}
                    onExclude={handleExclude}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {totalPages > 1 && (
        <SimplePagination
          currentPage={page}
          totalPages={totalPages}
          onPageChange={setPage}
        />
      )}
    </div>
  );
}
