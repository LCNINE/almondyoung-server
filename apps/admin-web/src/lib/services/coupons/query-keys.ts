export const couponQueryKeys = {
  all: ['coupons'] as const,
  list: (params?: object) => [...couponQueryKeys.all, 'list', params ?? {}] as const,
  detail: (id: string) => [...couponQueryKeys.all, 'detail', id] as const,
  customers: (promotionId: string, params?: object) =>
    [...couponQueryKeys.all, 'customers', promotionId, params ?? {}] as const,
} as const;
