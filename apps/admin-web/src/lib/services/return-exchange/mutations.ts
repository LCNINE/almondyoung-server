'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { returnExchangeApi } from '@/lib/api/domains/return-exchange';
import { returnExchangeQueryKeys } from './query-keys';

export const useApproveReturn = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, adminNote }: { id: string; adminNote?: string }) =>
      returnExchangeApi.approveReturn(id, adminNote),
    onSuccess: () => qc.invalidateQueries({ queryKey: returnExchangeQueryKeys.allReturns }),
  });
};

export const useRejectReturn = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, adminNote }: { id: string; adminNote?: string }) =>
      returnExchangeApi.rejectReturn(id, adminNote),
    onSuccess: () => qc.invalidateQueries({ queryKey: returnExchangeQueryKeys.allReturns }),
  });
};

export const useMarkReturnCollectionPending = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => returnExchangeApi.markReturnCollectionPending(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: returnExchangeQueryKeys.allReturns }),
  });
};

export const useMarkReturnCollected = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => returnExchangeApi.markReturnCollected(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: returnExchangeQueryKeys.allReturns }),
  });
};

export const useMarkReturnInspected = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => returnExchangeApi.markReturnInspected(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: returnExchangeQueryKeys.allReturns }),
  });
};

export const useCompleteReturn = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => returnExchangeApi.completeReturn(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: returnExchangeQueryKeys.allReturns }),
  });
};

export const useRetryReturnRefund = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => returnExchangeApi.retryReturnRefund(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: returnExchangeQueryKeys.allReturns }),
  });
};

export const useManualCompleteReturn = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, adminNote }: { id: string; adminNote?: string }) =>
      returnExchangeApi.manualCompleteReturn(id, adminNote),
    onSuccess: () => qc.invalidateQueries({ queryKey: returnExchangeQueryKeys.allReturns }),
  });
};

export const useApproveExchange = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, adminNote }: { id: string; adminNote?: string }) =>
      returnExchangeApi.approveExchange(id, adminNote),
    onSuccess: () => qc.invalidateQueries({ queryKey: returnExchangeQueryKeys.allExchanges }),
  });
};

export const useRejectExchange = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, adminNote }: { id: string; adminNote?: string }) =>
      returnExchangeApi.rejectExchange(id, adminNote),
    onSuccess: () => qc.invalidateQueries({ queryKey: returnExchangeQueryKeys.allExchanges }),
  });
};

export const useMarkExchangeCollectionPending = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => returnExchangeApi.markExchangeCollectionPending(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: returnExchangeQueryKeys.allExchanges }),
  });
};

export const useMarkExchangeCollected = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => returnExchangeApi.markExchangeCollected(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: returnExchangeQueryKeys.allExchanges }),
  });
};

export const useMarkExchangeInspected = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => returnExchangeApi.markExchangeInspected(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: returnExchangeQueryKeys.allExchanges }),
  });
};

export const useCompleteExchange = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => returnExchangeApi.completeExchange(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: returnExchangeQueryKeys.allExchanges }),
  });
};
