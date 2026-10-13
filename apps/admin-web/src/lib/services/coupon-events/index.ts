'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  couponEventsApi,
  type CouponEventPayload,
} from '@/lib/api/domains/medusa/coupon-events';
import type { PermissionRequirement } from '@/lib/auth/mutation-permission';

export const couponEventKeys = {
  all: ['coupon-events'] as const,
  list: () => [...couponEventKeys.all, 'list'] as const,
  detail: (id: string) => [...couponEventKeys.all, 'detail', id] as const,
};

export const useCouponEventList = () =>
  useQuery({
    queryKey: couponEventKeys.list(),
    queryFn: () => couponEventsApi.list(),
    staleTime: 30 * 1000,
  });

export const useCouponEvent = (id: string | null) =>
  useQuery({
    queryKey: couponEventKeys.detail(id ?? ''),
    queryFn: () => couponEventsApi.get(id!),
    enabled: !!id,
    staleTime: 30 * 1000,
  });

export const useCreateCouponEvent = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: CouponEventPayload) => couponEventsApi.create(payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: couponEventKeys.all }),
  });
};
useCreateCouponEvent.permission = ['marketing.promotion.write'] as const satisfies PermissionRequirement;

export const useUpdateCouponEvent = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: CouponEventPayload }) =>
      couponEventsApi.update(id, payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: couponEventKeys.all }),
  });
};
useUpdateCouponEvent.permission = ['marketing.promotion.write'] as const satisfies PermissionRequirement;

export const useDeleteCouponEvent = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => couponEventsApi.delete(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: couponEventKeys.all }),
  });
};
useDeleteCouponEvent.permission = ['marketing.promotion.write'] as const satisfies PermissionRequirement;
