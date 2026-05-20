'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { medusaPromotionsApi, type CreatePromotionPayload } from '@/lib/api/domains/medusa/promotions';
import { couponQueryKeys } from './query-keys';

export const useCreateCoupon = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreatePromotionPayload) => medusaPromotionsApi.create(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: couponQueryKeys.all });
    },
  });
};

export const useUpdateCouponStatus = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: 'active' | 'inactive' }) =>
      medusaPromotionsApi.updateStatus(id, status),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: couponQueryKeys.all });
    },
  });
};

export const useDeleteCoupon = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => medusaPromotionsApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: couponQueryKeys.all });
    },
  });
};

export const useAssignCoupon = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ medusaCustomerId, promotionIds }: { medusaCustomerId: string; promotionIds: string[] }) =>
      medusaPromotionsApi.assignToCustomer(medusaCustomerId, promotionIds),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: couponQueryKeys.all });
    },
  });
};

export const useRevokeCouponFromCustomer = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ promotionId, customerIds }: { promotionId: string; customerIds: string[] }) =>
      medusaPromotionsApi.revokeFromCustomer(promotionId, customerIds),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: couponQueryKeys.customers(variables.promotionId) });
      queryClient.invalidateQueries({ queryKey: couponQueryKeys.all });
    },
  });
};
