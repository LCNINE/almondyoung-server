'use client';

import { walletApi } from '@/lib/api/domains/wallet';
import type {
  PaymentIntentListQuery,
  RefundListQuery,
} from '@/lib/types/dto/wallet';
import {
  keepPreviousData,
  useQuery,
  useSuspenseQuery,
} from '@tanstack/react-query';
import { walletQueryKeys } from './query-keys';

// ── Payment Intents ────────────────────────────────────────────────────────

export const usePaymentIntentList = (
  query: PaymentIntentListQuery,
  options?: { enabled?: boolean },
) => {
  return useQuery({
    queryKey: walletQueryKeys.intentList(query),
    queryFn: () => walletApi.listPaymentIntents(query),
    staleTime: 30 * 1000,
    placeholderData: keepPreviousData,
    enabled: options?.enabled ?? true,
  });
};

export const usePaymentIntentDetail = (id: string) => {
  return useSuspenseQuery({
    queryKey: walletQueryKeys.intentDetail(id),
    queryFn: () => walletApi.getPaymentIntentDetail(id),
    staleTime: 30 * 1000,
  });
};

export const useStateTransitions = (id: string) => {
  return useSuspenseQuery({
    queryKey: walletQueryKeys.stateTransitions(id),
    queryFn: () => walletApi.getStateTransitions(id),
    staleTime: 30 * 1000,
  });
};

// ── Refunds ────────────────────────────────────────────────────────────────

export const useRefundList = (query: RefundListQuery) => {
  return useQuery({
    queryKey: walletQueryKeys.refundList(query),
    queryFn: () => walletApi.listRefunds(query),
    staleTime: 30 * 1000,
    placeholderData: keepPreviousData,
  });
};

// ── Bank Transfers ─────────────────────────────────────────────────────────

export const usePendingBankTransfers = (page?: number, limit?: number) => {
  return useQuery({
    queryKey: walletQueryKeys.bankTransferList(page, limit),
    queryFn: () => walletApi.listPendingBankTransfers(page, limit),
    staleTime: 30 * 1000,
    placeholderData: keepPreviousData,
  });
};

// ── Points ─────────────────────────────────────────────────────────────────

export const usePointsBalance = (userId: string) => {
  return useQuery({
    queryKey: walletQueryKeys.pointsBalance(userId),
    queryFn: () => walletApi.getPointsBalance(userId),
    staleTime: 30 * 1000,
    enabled: !!userId,
  });
};

export const usePointsEvents = (
  userId: string,
  page?: number,
  limit?: number
) => {
  return useQuery({
    queryKey: walletQueryKeys.pointsEvents(userId, page, limit),
    queryFn: () => walletApi.getPointsEvents(userId, page, limit),
    staleTime: 30 * 1000,
    enabled: !!userId,
    placeholderData: keepPreviousData,
  });
};

export const usePointsStats = (params?: {
  dateFrom?: string;
  dateTo?: string;
}) => {
  return useQuery({
    queryKey: walletQueryKeys.pointsStats(params),
    queryFn: () => walletApi.getPointsStats(params),
    staleTime: 60 * 1000,
  });
};

export const useAllPointsEvents = (params: {
  page?: number;
  limit?: number;
  userId?: string;
  eventType?: string;
  dateFrom?: string;
  dateTo?: string;
}) => {
  return useQuery({
    queryKey: walletQueryKeys.allPointsEvents(params),
    queryFn: () => walletApi.getAllPointsEvents(params),
    staleTime: 30 * 1000,
    placeholderData: keepPreviousData,
  });
};

export const useTopPointUsers = (limit?: number) => {
  return useQuery({
    queryKey: walletQueryKeys.topUsers(limit),
    queryFn: () => walletApi.getTopPointUsers(limit),
    staleTime: 60 * 1000,
  });
};

// ── Payment method catalog & regions ─────────────────────────────────────────

export const usePaymentMethodCatalog = () => {
  return useQuery({
    queryKey: walletQueryKeys.catalog(),
    queryFn: () => walletApi.listPaymentMethodCatalog(),
    staleTime: 30 * 1000,
  });
};

export const useRegions = () => {
  return useQuery({
    queryKey: walletQueryKeys.regions(),
    queryFn: () => walletApi.listRegions(),
    staleTime: 30 * 1000,
  });
};

export const useRegionPaymentMethods = (code: string | null) => {
  return useQuery({
    queryKey: walletQueryKeys.regionMethods(code ?? ''),
    queryFn: () => walletApi.getRegionPaymentMethods(code as string),
    staleTime: 30 * 1000,
    enabled: !!code,
  });
};
