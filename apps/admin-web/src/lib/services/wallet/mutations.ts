'use client';

import { walletApi } from '@/lib/api/domains/wallet';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { walletQueryKeys } from './query-keys';

export const useCaptureIntent = (intentId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => walletApi.captureIntent(intentId),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: walletQueryKeys.intentDetail(intentId),
      });
      queryClient.invalidateQueries({
        queryKey: walletQueryKeys.stateTransitions(intentId),
      });
      queryClient.invalidateQueries({ queryKey: walletQueryKeys.intents() });
    },
  });
};

export const useCancelIntent = (intentId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => walletApi.cancelIntent(intentId),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: walletQueryKeys.intentDetail(intentId),
      });
      queryClient.invalidateQueries({
        queryKey: walletQueryKeys.stateTransitions(intentId),
      });
      queryClient.invalidateQueries({ queryKey: walletQueryKeys.intents() });
    },
  });
};

export const useRefundIntent = (intentId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (dto: {
      chargeId: string;
      amount: number;
      reasonCode?: string;
      reasonMessage?: string;
    }) => walletApi.refundIntent(intentId, dto),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: walletQueryKeys.intentDetail(intentId),
      });
      queryClient.invalidateQueries({
        queryKey: walletQueryKeys.stateTransitions(intentId),
      });
      queryClient.invalidateQueries({ queryKey: walletQueryKeys.intents() });
      queryClient.invalidateQueries({ queryKey: walletQueryKeys.refunds() });
    },
  });
};

export const useConfirmBankTransfer = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      depositorNote,
    }: {
      id: string;
      depositorNote?: string;
    }) => walletApi.confirmBankTransfer(id, depositorNote),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: walletQueryKeys.bankTransfers(),
      });
      queryClient.invalidateQueries({ queryKey: walletQueryKeys.intents() });
    },
  });
};

export const useEarnPoints = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      userId,
      amount,
      reasonCode,
      expiresAt,
    }: {
      userId: string;
      amount: number;
      reasonCode?: string;
      expiresAt?: string;
    }) => walletApi.earnPoints(userId, amount, reasonCode, expiresAt),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: walletQueryKeys.pointsBalance(variables.userId),
      });
      queryClient.invalidateQueries({ queryKey: walletQueryKeys.points() });
    },
  });
};

export const useBatchEarnPoints = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      userIds,
      amount,
      reasonCode,
      expiresAt,
    }: {
      userIds: string[];
      amount: number;
      reasonCode?: string;
      expiresAt?: string;
    }) => walletApi.batchEarnPoints(userIds, amount, reasonCode, expiresAt),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: walletQueryKeys.points() });
    },
  });
};

export const useDeductPoints = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      userId,
      amount,
      reasonCode,
    }: {
      userId: string;
      amount: number;
      reasonCode?: string;
    }) => walletApi.deductPoints(userId, amount, reasonCode),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: walletQueryKeys.pointsBalance(variables.userId),
      });
      queryClient.invalidateQueries({ queryKey: walletQueryKeys.points() });
    },
  });
};

export const useProcessExpiredPoints = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => walletApi.processExpiredPoints(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: walletQueryKeys.points() });
    },
  });
};

export const useCancelEarnPoints = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      userId,
      earnEventId,
      amount,
      reasonCode,
    }: {
      userId: string;
      earnEventId: string;
      amount?: number;
      reasonCode?: string;
    }) => walletApi.cancelEarnPoints(userId, earnEventId, amount, reasonCode),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: walletQueryKeys.pointsBalance(variables.userId),
      });
      queryClient.invalidateQueries({ queryKey: walletQueryKeys.points() });
    },
  });
};
