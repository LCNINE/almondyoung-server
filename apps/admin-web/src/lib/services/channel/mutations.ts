'use client';

// src/lib/services/channel/mutations.ts
// 주문 수집 실패(미매핑 주문) 격리 큐 뮤테이션 훅

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { channelQueryKeys } from './query-keys';
import { orderCollectionFailuresClient } from '@/lib/api/domains/channel/order-collection-failures.client';

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
