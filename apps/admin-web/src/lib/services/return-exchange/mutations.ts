'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  returnExchangeApi,
  type CreateAdminReturnRequest,
} from '@/lib/api/domains/return-exchange';
import { returnExchangeQueryKeys } from './query-keys';
import type { PermissionRequirement } from '@/lib/auth/mutation-permission';

export const useCreateReturnRequest = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (command: CreateAdminReturnRequest) =>
      returnExchangeApi.createReturnRequest(command),
    onSuccess: (_result, command) => {
      void qc.invalidateQueries({
        queryKey: returnExchangeQueryKeys.allReturns,
      });
      void qc.invalidateQueries({
        queryKey: returnExchangeQueryKeys.returnEligibility(command.orderId),
      });
    },
  });
};
useCreateReturnRequest.permission = ['fulfillment.warehouse.operate'] as const satisfies PermissionRequirement;

export const useApproveReturn = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, adminNote }: { id: string; adminNote?: string }) =>
      returnExchangeApi.approveReturn(id, adminNote),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: returnExchangeQueryKeys.allReturns }),
  });
};
useApproveReturn.permission = ['order.claim.write'] as const satisfies PermissionRequirement;

export const useRejectReturn = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, adminNote }: { id: string; adminNote?: string }) =>
      returnExchangeApi.rejectReturn(id, adminNote),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: returnExchangeQueryKeys.allReturns }),
  });
};
useRejectReturn.permission = ['order.claim.write'] as const satisfies PermissionRequirement;

export const useMarkReturnCollectionPending = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      returnExchangeApi.markReturnCollectionPending(id),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: returnExchangeQueryKeys.allReturns }),
  });
};
useMarkReturnCollectionPending.permission = ['order.claim.write'] as const satisfies PermissionRequirement;

export const useMarkReturnCollected = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => returnExchangeApi.markReturnCollected(id),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: returnExchangeQueryKeys.allReturns }),
  });
};
useMarkReturnCollected.permission = ['order.claim.write'] as const satisfies PermissionRequirement;

export const useMarkReturnInspected = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => returnExchangeApi.markReturnInspected(id),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: returnExchangeQueryKeys.allReturns }),
  });
};
useMarkReturnInspected.permission = ['order.claim.write'] as const satisfies PermissionRequirement;

export const useCompleteReturn = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => returnExchangeApi.completeReturn(id),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: returnExchangeQueryKeys.allReturns }),
  });
};
useCompleteReturn.permission = ['order.claim.write'] as const satisfies PermissionRequirement;

export const useRetryReturnRefund = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => returnExchangeApi.retryReturnRefund(id),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: returnExchangeQueryKeys.allReturns }),
  });
};
useRetryReturnRefund.permission = ['payment.refund.execute'] as const satisfies PermissionRequirement;

export const useManualCompleteReturn = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, adminNote }: { id: string; adminNote?: string }) =>
      returnExchangeApi.manualCompleteReturn(id, adminNote),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: returnExchangeQueryKeys.allReturns }),
  });
};
useManualCompleteReturn.permission = ['order.claim.write'] as const satisfies PermissionRequirement;

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
