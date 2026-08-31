'use client';

// src/lib/services/channel/queries.ts
// 주문 수집 실패(미매핑 주문) 격리 큐 쿼리 훅

import { useQuery } from '@tanstack/react-query';
import { channelQueryKeys } from './query-keys';
import {
  QUARANTINE_LIST_LIMIT,
  orderCollectionFailuresClient,
} from '@/lib/api/domains/channel/order-collection-failures.client';
import { pimMedusaMappingClient } from '@/lib/api/domains/channel/pim-medusa-mapping.client';

/**
 * 격리 목록. 반환값은 `{ count, data, limit, truncated }` — 표와 배지가 같은 판을 공유한다.
 *
 * `limit` 을 명시해 보낸다: 서버 기본값 50 을 그대로 쓰면 개통 직후 수백 건이 격리되는 구간에서
 * 말없이 앞의 50건만 보인다. 상한에 닿으면 `truncated` 가 서고, 화면이 그 사실을 그린다.
 */
export function useQuarantinedFailures(
  params: { channel?: string; status?: string; limit?: number } = {}
) {
  const query = { status: 'quarantined', limit: QUARANTINE_LIST_LIMIT, ...params };
  return useQuery({
    queryKey: channelQueryKeys.failuresList(query),
    queryFn: () => orderCollectionFailuresClient.list(query),
  });
}

// `useFailureDetail` 은 삭제했다. 호출부가 한 곳도 없었고(상세 다이얼로그는 목록 행을 그대로
// 받는다), 목록과 같은 이중 unwrap 버그를 안고 있어 되살아나면 같은 사고를 다시 낸다.
// 상세 단건 조회가 필요해지면 `orderCollectionFailuresClient.get` 위에 새로 쓰면 된다.

/**
 * PIM masterId → Medusa product id 매핑. GA4 는 상품을 Medusa product id 로 기록하므로
 * 상품 단건 화면이 GA4 축을 그리려면 이 변환이 먼저 끝나야 한다.
 * 매핑은 동기화가 만들면 잘 안 바뀌므로 오래 신선한 것으로 둔다.
 */
export function usePimMedusaMappings(masterIds: string[]) {
  return useQuery({
    queryKey: channelQueryKeys.pimMedusaMappings(masterIds),
    queryFn: () => pimMedusaMappingClient.list(masterIds),
    enabled: masterIds.length > 0,
    staleTime: 10 * 60 * 1000,
  });
}
