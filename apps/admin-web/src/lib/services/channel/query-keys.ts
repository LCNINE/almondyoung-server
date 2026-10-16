// src/lib/services/channel/query-keys.ts
// 주문 수집 실패(미매핑 주문) 격리 큐와 «채널과 어긋남»(#1016 45번) 쿼리 키 팩토리

import type { MismatchListScope } from '@/lib/api/domains/channel/order-reconcile-findings.shape';

export const channelQueryKeys = {
  failures: ['order-collection-failures'] as const,
  summary: ['order-collection-failures', 'summary'] as const,
  failuresList: (query: Record<string, unknown>) =>
    [...channelQueryKeys.failures, 'list', query] as const,
  failure: (id: string) => [...channelQueryKeys.failures, id] as const,

  // 뮤테이션은 `mismatches` 접두사로 목록·요약을 함께 무효화한다 — 하위 키에 undefined 를 섞지 않는다.
  mismatches: ['order-reconcile-findings'] as const,
  mismatchSummary: ['order-reconcile-findings', 'summary'] as const,
  mismatchList: (scope: MismatchListScope) =>
    ['order-reconcile-findings', 'list', scope] as const,
};
