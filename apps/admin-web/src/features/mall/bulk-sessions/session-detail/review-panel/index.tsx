'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
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
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { SimplePagination } from '@/components/simple-pagination';
import {
  fetchAllInvalidItems,
  useApproveBulkSession,
  useBulkSessionItems,
  useBulkSessionUndecidedCount,
  useSetConflictDecision,
} from '@/lib/services/products/bulk-session';
import {
  canApprove,
  toCountMap,
} from '@/lib/services/products/bulk-session-model';
import { productQueryKeys } from '@/lib/services/products/query-keys';
import type {
  BulkItemStatus,
  BulkSessionItemList,
  BulkSessionProgress,
  ConflictDecision,
  ConflictFilter,
} from '@/lib/types/dto/bulk-session';
import { formatErrorReport } from '../../lib/error-report';
import { notifySessionMutationError } from '../../lib/session-mutation-error';
import { ItemRow } from './item-row';

const PAGE_SIZE = 20;

type ReviewTab = 'all' | 'pending' | 'invalid' | 'conflict';

const TAB_LABEL: Record<ReviewTab, string> = {
  all: '전체',
  pending: '정상',
  invalid: '오류',
  conflict: '충돌',
};

const TAB_QUERY: Record<
  ReviewTab,
  { status?: BulkItemStatus; conflict?: ConflictFilter }
> = {
  all: {},
  pending: { status: 'pending' },
  invalid: { status: 'invalid' },
  conflict: { conflict: 'any' },
};

const REVIEW_TABS: ReviewTab[] = ['all', 'pending', 'invalid', 'conflict'];

function isReviewTab(value: string): value is ReviewTab {
  return (
    value === 'all' ||
    value === 'pending' ||
    value === 'invalid' ||
    value === 'conflict'
  );
}

export function ReviewPanel({
  sessionId,
  progress,
}: {
  sessionId: string;
  progress: BulkSessionProgress;
}) {
  const qc = useQueryClient();
  const [tab, setTab] = useState<ReviewTab>('all');
  const [page, setPage] = useState(1);
  const [approveOpen, setApproveOpen] = useState(false);
  const [copying, setCopying] = useState(false);

  const itemsQueryVars = { ...TAB_QUERY[tab], page, limit: PAGE_SIZE };
  const itemsQuery = useBulkSessionItems(sessionId, itemsQueryVars);
  const undecidedQuery = useBulkSessionUndecidedCount(sessionId, true);
  const setDecision = useSetConflictDecision(sessionId);
  const approve = useApproveBulkSession(sessionId);

  function handleTabChange(value: string) {
    if (!isReviewTab(value)) return;
    setTab(value);
    setPage(1);
  }

  function handleDecide(
    itemId: string,
    field: string,
    decision: ConflictDecision
  ) {
    setDecision.mutate(
      { itemId, decisions: { [field]: decision } },
      {
        onSuccess: (updated) => {
          // 부분 갱신 응답(바뀐 항목 하나)을 그대로 목록 캐시에 반영한다 —
          // 재조회를 기다리지 않는다. (훅 자체의 onSuccess 무효화는 별개로 뒤이어 돈다.)
          qc.setQueryData<BulkSessionItemList>(
            productQueryKeys.bulkSessionItems(sessionId, itemsQueryVars),
            (old) =>
              old
                ? {
                    ...old,
                    data: old.data.map((item) =>
                      item.id === updated.id ? updated : item
                    ),
                  }
                : old
          );
        },
        onError: (error) => {
          // 이 뮤테이션의 409 는 review phase 를 벗어났다는 뜻뿐이다
          // (bulk-session.manager.ts setConflictDecision — phase !== 'review').
          // review 는 폴링 phase 가 아니고(bulkSessionRefetchInterval) 전역
          // refetchOnWindowFocus 도 꺼져 있어, 진행률 쿼리를 무효화하지 않으면 화면이
          // 죽은 채로 남는다 — 다른 세션 뮤테이션과 같은 공통 핸들러로 복구한다.
          notifySessionMutationError(error, qc, sessionId);
        },
      }
    );
  }

  function handleApprove() {
    approve.mutate(undefined, {
      onSuccess: () => {
        setApproveOpen(false);
        toast.success('승인했습니다.');
      },
      onError: (error) => {
        setApproveOpen(false);
        notifySessionMutationError(error, qc, sessionId);
      },
    });
  }

  async function handleCopyErrors() {
    setCopying(true);
    try {
      const invalid = await fetchAllInvalidItems(sessionId);
      await navigator.clipboard.writeText(formatErrorReport(invalid));
      toast.success(`오류 ${invalid.length}건을 복사했습니다.`);
    } catch {
      toast.error('오류 목록을 복사하지 못했습니다.');
    } finally {
      setCopying(false);
    }
  }

  const undecided = undecidedQuery.data;
  const approvable =
    undecided !== undefined && canApprove(progress.phase, undecided);

  const itemCounts = toCountMap(progress.itemCounts);
  const invalidCount = itemCounts.invalid ?? 0;
  const pendingCount = itemCounts.pending ?? 0;

  const decisionsLocked = progress.phase !== 'review' || setDecision.isPending;

  const total = itemsQuery.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          {undecided !== undefined && undecided > 0 && (
            // undecided 는 행(item) 개수다 — 승인 시도 409 가 보여주는 "결정하지 않은
            // 충돌이 N건"(bulk-session.manager.ts approve())은 필드 개수라 축이 다르다.
            // 한 행에 미결정 필드가 여럿이면 두 숫자가 서로 다르게 보인다 — 라벨로
            // 그 차이를 명시해 같은 화면의 두 숫자가 다투지 않게 한다.
            <Badge variant="destructive">
              미결정 충돌이 있는 행 {undecided}건
            </Badge>
          )}
        </div>

        <div className="flex items-center gap-2">
          {invalidCount > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => void handleCopyErrors()}
              disabled={copying}
            >
              {copying ? '복사 중…' : `오류 목록 복사 (${invalidCount})`}
            </Button>
          )}

          <AlertDialog open={approveOpen} onOpenChange={setApproveOpen}>
            <Button
              type="button"
              disabled={!approvable || approve.isPending}
              onClick={() => setApproveOpen(true)}
            >
              {approve.isPending && (
                <Spinner size="sm" data-icon="inline-start" />
              )}
              승인
            </Button>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>세션 승인</AlertDialogTitle>
                <AlertDialogDescription>
                  오류 {invalidCount}건은 제외하고 {pendingCount}건을 진행합니다.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={approve.isPending}>
                  닫기
                </AlertDialogCancel>
                <AlertDialogAction
                  disabled={approve.isPending}
                  onClick={(event) => {
                    event.preventDefault();
                    handleApprove();
                  }}
                >
                  {approve.isPending && <Spinner size="sm" />}
                  승인
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>

      <Tabs value={tab} onValueChange={handleTabChange}>
        <TabsList>
          {REVIEW_TABS.map((value) => (
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
      {itemsQuery.data && itemsQuery.data.data.length === 0 && (
        <p className="text-sm text-muted-foreground">표시할 행이 없습니다.</p>
      )}
      {itemsQuery.data && itemsQuery.data.data.length > 0 && (
        <div className="flex flex-col divide-y rounded-lg border">
          {itemsQuery.data.data.map((item) => (
            <ItemRow
              key={item.id}
              item={item}
              disabled={decisionsLocked}
              onDecide={handleDecide}
            />
          ))}
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
