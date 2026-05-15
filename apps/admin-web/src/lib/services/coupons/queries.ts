'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { medusaPromotionsApi } from '@/lib/api/domains/medusa/promotions';
import { couponQueryKeys } from './query-keys';

export const useCouponList = (params: { limit?: number; offset?: number; q?: string } = {}) => {
  return useQuery({
    queryKey: couponQueryKeys.list(params),
    queryFn: () => medusaPromotionsApi.list(params),
    staleTime: 30 * 1000,
    placeholderData: keepPreviousData,
  });
};
