import { purchaseSatisfactionApi } from '@/lib/api/domains/purchase-satisfaction';
import type { PurchaseSatisfactionListQuery } from '@/lib/types/dto/purchase-satisfaction';
import { useQuery } from '@tanstack/react-query';
import { purchaseSatisfactionQueryKeys } from './query-keys';

export const usePurchaseSatisfactions = (query: PurchaseSatisfactionListQuery) =>
  useQuery({
    queryKey: purchaseSatisfactionQueryKeys.list(query),
    queryFn: () => purchaseSatisfactionApi.list(query),
    staleTime: 30 * 1000,
    placeholderData: (previous) => previous,
  });

export const usePurchaseSatisfactionByOrder = (orderId: string, options: { enabled?: boolean } = {}) =>
  useQuery({
    enabled: options.enabled ?? true,
    queryKey: purchaseSatisfactionQueryKeys.byOrder(orderId),
    queryFn: () => purchaseSatisfactionApi.getByOrder(orderId),
    staleTime: 30 * 1000,
  });
