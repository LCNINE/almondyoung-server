'use client';

// src/lib/services/channel/queries.ts
// 주문 수집 실패(미매핑 주문) 격리 큐 쿼리 훅

import { useQuery } from '@tanstack/react-query';
import { channelQueryKeys } from './query-keys';
import { orderCollectionFailuresClient } from '@/lib/api/domains/channel/order-collection-failures.client';

export function useQuarantinedFailures(
  params: { channel?: string; status?: string } = {}
) {
  const query = { status: 'quarantined', ...params };
  return useQuery({
    queryKey: channelQueryKeys.failuresList(query),
    queryFn: () => orderCollectionFailuresClient.list(query),
  });
}

export function useFailureDetail(id: string | null) {
  return useQuery({
    queryKey: channelQueryKeys.failure(id ?? ''),
    // non-null assertion: `enabled` 이 id 를 가드하므로 queryFn 은 id 가 있을 때만 호출된다.
    // 이 codebase 의 동일 패턴(useGetCampaign/useGetCoupon/useCouponEvent)이 전부 이 방식이다.
    queryFn: () => orderCollectionFailuresClient.get(id!),
    enabled: Boolean(id),
  });
}
