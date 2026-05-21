'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { medusaPromotionsApi } from '@/lib/api/domains/medusa/promotions';
import { couponQueryKeys } from './query-keys';

export const useCouponList = (
  params: { limit?: number; offset?: number; q?: string } = {},
  options?: { enabled?: boolean }
) => {
  return useQuery({
    queryKey: couponQueryKeys.list(params),
    queryFn: () => medusaPromotionsApi.list(params),
    staleTime: 30 * 1000,
    placeholderData: keepPreviousData,
    enabled: options?.enabled ?? true,
  });
};

export const useGetCoupon = (id: string | null) => {
  return useQuery({
    queryKey: couponQueryKeys.detail(id ?? ''),
    queryFn: () => medusaPromotionsApi.get(id!),
    enabled: !!id,
    staleTime: 30 * 1000,
  });
};

export const useCouponCustomers = (promotionId: string | null, params: { limit?: number; offset?: number } = {}) => {
  return useQuery({
    queryKey: couponQueryKeys.customers(promotionId ?? '', params),
    queryFn: () => medusaPromotionsApi.getCustomers(promotionId!, params),
    enabled: !!promotionId,
    staleTime: 30 * 1000,
  });
};
