'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { medusaPromotionsApi, type CreatePromotionPayload } from '@/lib/api/domains/medusa/promotions';
import { couponQueryKeys } from './query-keys';
import type { PermissionRequirement } from '@/lib/auth/mutation-permission';

export const useCreateCoupon = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreatePromotionPayload) => medusaPromotionsApi.create(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: couponQueryKeys.all });
    },
  });
};
useCreateCoupon.permission = ['marketing.promotion.write'] as const satisfies PermissionRequirement;

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
useUpdateCouponStatus.permission = ['marketing.promotion.write'] as const satisfies PermissionRequirement;

export const useDeleteCoupon = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => medusaPromotionsApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: couponQueryKeys.all });
    },
  });
};
useDeleteCoupon.permission = ['marketing.promotion.write'] as const satisfies PermissionRequirement;

export const useBulkIssueCoupon = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ promotionId, customerIds, quantity, submitId, force }: {
      promotionId: string; customerIds: string[]; quantity: number; submitId: string; force?: boolean;
    }) => medusaPromotionsApi.bulkIssue(promotionId, customerIds, quantity, submitId, force),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: couponQueryKeys.all });
    },
  });
};
useBulkIssueCoupon.permission = ['marketing.promotion.write'] as const satisfies PermissionRequirement;

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
useRevokeCouponFromCustomer.permission = ['marketing.promotion.write'] as const satisfies PermissionRequirement;
