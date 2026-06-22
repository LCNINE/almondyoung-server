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

  orders: (customerId: string, query: object = {}) =>
    [...medusaCustomerQueryKeys.all, 'orders', customerId, query] as const,

  order: (orderId: string) =>
    [...medusaCustomerQueryKeys.all, 'order', orderId] as const,

  cart: (customerId: string) =>
    [...medusaCustomerQueryKeys.all, 'cart', customerId] as const,
} as const;
