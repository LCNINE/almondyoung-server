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

/**
 * 고객축 발급. `submitId` 는 필수다 — 호출부가 「제출 시작」에 한 번 만들어 재시도 내내
 * 같은 값을 보낸다(`coupon-assign-dialog.tsx` 의 `submitIdRef` 참고). 여기서 만들지 않는다:
 * 훅 본문에서 만들면 재시도마다 새 값이 되어 멱등성이 사라진다.
 */
export const useAssignCoupon = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ medusaCustomerId, promotionIds, submitId, force, quantity }: {
      medusaCustomerId: string; promotionIds: string[]; submitId: string; force?: boolean; quantity?: number;
    }) => medusaPromotionsApi.assignToCustomer(medusaCustomerId, promotionIds, submitId, force, quantity),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: couponQueryKeys.all });
    },
  });
};

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
