// src/lib/services/channel/query-keys.ts
// 주문 수집 실패(미매핑 주문) 격리 큐 쿼리 키 팩토리

export const channelQueryKeys = {
  failures: ['order-collection-failures'] as const,
  failuresList: (query: Record<string, unknown>) =>
    [...channelQueryKeys.failures, 'list', query] as const,
  failure: (id: string) => [...channelQueryKeys.failures, id] as const,
};
