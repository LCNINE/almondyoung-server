// src/features/mall/bulk-sessions/session-detail/published-panel/index.tsx
// 세션이 published 로 마감된 뒤 보여줄 패널. 세션은 발행 안 된 행이 남아도 published 로
// 끝난다(§10.4) — 실패 수가 0 이 아니면 완료 문구보다 실패 블록을 먼저 보여준다.

'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Spinner } from '@/components/ui/spinner';
import { SimplePagination } from '@/components/simple-pagination';
import {
  useBulkSessionItems,
  useExcludeItem,
  usePublishBulkSession,
} from '@/lib/services/products/bulk-session';
import {
  computePublishProgress,
  toCountMap,
} from '@/lib/services/products/bulk-session-model';
import type { BulkSessionProgress } from '@/lib/types/dto/bulk-session';
import { notifySessionMutationError } from '../../lib/session-mutation-error';

/**
 * `publishStatus=failed` 서버 필터로 페이지네이션한다 — items 라우트의 실제 상한은 100
 * (parseLimit) 이라, 상품 행 상한(1,000)을 믿고 limit 하나로 전량을 당겨오면 100건 이후
 * 행이 조용히 잘린다(fix-round). drafted 패널과 같은 페이지 크기를 쓴다.
 */
const PAGE_SIZE = 20;

/** 제외는 되돌릴 수 없다 — drafted 패널과 같은 문구로 한 번 더 확인한다. */
const EXCLUDE_CONFIRM =
  '제외한 행은 다시 넣을 수 없습니다. 풀린 임시 버전은 작성중인 상품 목록에 나타납니다.';

export function PublishedPanel({
  sessionId,
  progress,
}: {
  sessionId: string;
  progress: BulkSessionProgress;
}) {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);

  const publishCounts = toCountMap(progress.publishCounts);
  const failedCount = publishCounts.failed ?? 0;
  const hasFailures = failedCount > 0;

  // 실패가 0 건이어도 그냥 부른다 — publishStatus='failed' 필터라 빈 목록만 돌아오는
  // 가벼운 조회다(훅에 enabled 스위치를 새로 만들 만큼은 아니다).
  const itemsQuery = useBulkSessionItems(sessionId, {
    publishStatus: 'failed',
    page,
    limit: PAGE_SIZE,
  });

  const excludeItem = useExcludeItem(sessionId);
  const republish = usePublishBulkSession(sessionId);

  const { done, total } = computePublishProgress(progress);
  const percent = total > 0 ? Math.round((done / total) * 100) : 0;

  const failedItems = itemsQuery.data?.data ?? [];
  const itemsTotal = itemsQuery.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(itemsTotal / PAGE_SIZE));

  function handleExclude(itemId: string) {
    if (!window.confirm(EXCLUDE_CONFIRM)) return;
    excludeItem.mutate(itemId, {
      onSuccess: () => toast.success('제외했습니다.'),
      onError: (error) => notifySessionMutationError(error, qc, sessionId),
    });
  }

  function handleRepublish() {
    // 실패 행 재발행은 최초 발행과 같은 라우트다 — publishStatus='idle'|'failed' 행만
    // 서버가 다시 골라 처리한다.
    republish.mutate(undefined, {
      onSuccess: () => toast.success('실패한 행을 다시 발행합니다.'),
      onError: (error) => notifySessionMutationError(error, qc, sessionId),
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {hasFailures && (
        <div className="rounded-lg border border-destructive/50 p-4">
          <div className="flex items-center justify-between gap-4">
            <p className="text-sm font-medium text-destructive">
              발행 실패 {failedCount}건
            </p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={republish.isPending}
              onClick={handleRepublish}
            >
              {republish.isPending && (
                <Spinner size="sm" data-icon="inline-start" />
              )}
              실패 행 재발행
            </Button>
          </div>

          {itemsQuery.isPending && (
            <p className="mt-2 text-sm text-muted-foreground">
              불러오는 중입니다…
            </p>
          )}
          {itemsQuery.isError && (
            <p role="alert" className="mt-2 text-sm text-destructive">
              목록을 불러오지 못했습니다.
            </p>
          )}
          {/* 집계는 실패가 있다는데 이 페이지엔 행이 없는 경우 — 목록이 방금 바뀌었을 수
              있다(제외·재발행 직후 등). 빈 자리를 그냥 두면 실패가 사라진 것처럼 보인다. */}
          {itemsQuery.data && failedItems.length === 0 && (
            <p className="mt-2 text-sm text-muted-foreground">
              집계상 실패 {failedCount}건이 있지만 이 페이지에는 표시할 행이
              없습니다. 목록이 바뀌었을 수 있습니다 — 첫 페이지를 확인해 주세요.
            </p>
          )}
          {failedItems.length > 0 && (
            <ul className="mt-3 flex flex-col divide-y text-sm">
              {failedItems.map((item) => (
                <li
                  key={item.id}
                  className="flex items-center justify-between gap-4 py-2"
                >
                  <div className="flex flex-col gap-1">
                    <span>
                      {item.rowNumber} · {item.rowKey}
                    </span>
                    {item.publishError && (
                      <span role="alert" className="text-destructive">
                        {item.publishError}
                      </span>
                    )}
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={excludeItem.isPending}
                    onClick={() => handleExclude(item.id)}
                  >
                    제외
                  </Button>
                </li>
              ))}
            </ul>
          )}

          {totalPages > 1 && (
            <div className="mt-3">
              <SimplePagination
                currentPage={page}
                totalPages={totalPages}
                onPageChange={setPage}
              />
            </div>
          )}
        </div>
      )}

      <div className="rounded-lg border p-6 text-center">
        <p className="text-sm font-medium">세션 발행이 완료됐습니다.</p>
        {total > 0 && (
          <>
            <p className="mt-1 text-sm text-muted-foreground">
              {done} / {total}건
            </p>
            <Progress value={percent} className="mt-3" />
          </>
        )}
      </div>
    </div>
  );
}
