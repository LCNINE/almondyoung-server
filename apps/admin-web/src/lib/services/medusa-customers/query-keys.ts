// src/lib/services/medusa-customers/query-keys.ts
/**
 * Medusa 고객 관련 쿼리 키
 * - Medusa 서버의 고객 목록 조회, 상세 정보 조회에 사용
 */
export const medusaCustomerQueryKeys = {
  all: ['medusa-customers'] as const,

  list: (query: object) =>
    [...medusaCustomerQueryKeys.all, 'list', query] as const,

  detail: (id: string) =>
    [...medusaCustomerQueryKeys.all, 'detail', id] as const,

  byEmail: (email: string) =>
    [...medusaCustomerQueryKeys.all, 'byEmail', email] as const,

  byAlmondUserId: (almondUserId: string) =>
    [...medusaCustomerQueryKeys.all, 'byAlmondUserId', almondUserId] as const,
} as const;
