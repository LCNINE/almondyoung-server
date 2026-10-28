import type { PurchaseSatisfactionListQuery } from '@/lib/types/dto/purchase-satisfaction';

export const purchaseSatisfactionQueryKeys = {
  all: ['purchase-satisfaction'] as const,
  list: (query: PurchaseSatisfactionListQuery) => [...purchaseSatisfactionQueryKeys.all, 'list', query] as const,
  byOrder: (orderId: string) => [...purchaseSatisfactionQueryKeys.all, 'order', orderId] as const,
} as const;
