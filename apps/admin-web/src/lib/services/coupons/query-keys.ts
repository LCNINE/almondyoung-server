export const couponQueryKeys = {
  all: ['coupons'] as const,
  list: (params?: object) => [...couponQueryKeys.all, 'list', params ?? {}] as const,
} as const;
