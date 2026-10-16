'use client';

// src/lib/services/channel/mutations.ts
// 주문 수집 실패(미매핑 주문) 격리 큐 뮤테이션 훅

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { channelQueryKeys } from './query-keys';
import { orderCollectionFailuresClient } from '@/lib/api/domains/channel/order-collection-failures.client';
import { orderReconcileFindingsClient } from '@/lib/api/domains/channel/order-reconcile-findings.client';

export function useReplayFailure() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => orderCollectionFailuresClient.replay(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: channelQueryKeys.failures,
      });
    },
  });
}

/**
 * [다시 배달]. 성공·실패와 무관하게 무효화한다 — 서버는 실패(500)도 시도로 기록하므로
 * (`recordAttempt(id, 'error: …')`) 성공일 때만 갱신하면 시도 수·마지막 결과가 옛 값으로 남는다.
 */
export function useRedeliverMismatch() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => orderReconcileFindingsClient.redeliver(id),
    onSettled: () => {
      void queryClient.invalidateQueries({
        queryKey: channelQueryKeys.mismatches,
      });
    },
  });
}

export function useCloseMismatch() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, memo }: { id: string; memo: string }) =>
      orderReconcileFindingsClient.close(id, memo),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: channelQueryKeys.mismatches,
      });
    },
  });
}
