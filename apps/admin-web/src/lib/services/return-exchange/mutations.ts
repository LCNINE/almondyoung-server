'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { returnExchangeApi } from '@/lib/api/domains/return-exchange';
import { returnExchangeQueryKeys } from './query-keys';
import type { PermissionRequirement } from '@/lib/auth/mutation-permission';

export const useApproveExchange = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, adminNote }: { id: string; adminNote?: string }) =>
      returnExchangeApi.approveExchange(id, adminNote),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: returnExchangeQueryKeys.allExchanges }),
  });
};
useApproveExchange.permission = ['order.claim.write'] as const satisfies PermissionRequirement;

export const useRejectExchange = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, adminNote }: { id: string; adminNote?: string }) =>
      returnExchangeApi.rejectExchange(id, adminNote),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: returnExchangeQueryKeys.allExchanges }),
  });
};
useRejectExchange.permission = ['order.claim.write'] as const satisfies PermissionRequirement;

export const useMarkExchangeCollectionPending = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      returnExchangeApi.markExchangeCollectionPending(id),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: returnExchangeQueryKeys.allExchanges }),
  });
};
useMarkExchangeCollectionPending.permission = ['order.claim.write'] as const satisfies PermissionRequirement;

export const useMarkExchangeCollected = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => returnExchangeApi.markExchangeCollected(id),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: returnExchangeQueryKeys.allExchanges }),
  });
};
useMarkExchangeCollected.permission = ['order.claim.write'] as const satisfies PermissionRequirement;

export const useMarkExchangeInspected = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => returnExchangeApi.markExchangeInspected(id),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: returnExchangeQueryKeys.allExchanges }),
  });
};
useMarkExchangeInspected.permission = ['order.claim.write'] as const satisfies PermissionRequirement;

export const useCompleteExchange = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => returnExchangeApi.completeExchange(id),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: returnExchangeQueryKeys.allExchanges }),
  });
};
useCompleteExchange.permission = ['order.claim.write'] as const satisfies PermissionRequirement;
