'use client';

import { useQuery } from '@tanstack/react-query';
import { matchingQueryKeys } from './query-keys';
import { matchingClient } from '@/lib/api/domains/matching';
import { createDefaultStockPolicy } from './transformers';
import type {
  MatchingsQuery,
  OrderLinesQuery,
  VariantSkuLookupDto,
} from '@/lib/types/dto/matching';

export const useMatchings = (query: MatchingsQuery = {}) => {
  return useQuery({
    queryKey: matchingQueryKeys.list(query),
    queryFn: () => matchingClient.getMatchings(query),
    staleTime: 30 * 1000,
    gcTime: 5 * 60 * 1000,
  });
};

export const useLegacyIgnoredMatchings = (
  query: Omit<MatchingsQuery, 'status'> = {}
) => {
  return useQuery({
    queryKey: matchingQueryKeys.legacyIgnoredList(query),
    queryFn: () => matchingClient.getLegacyIgnoredMatchings(query),
    staleTime: 30 * 1000,
    gcTime: 5 * 60 * 1000,
  });
};

export const useMatching = (id: string) => {
  return useQuery({
    queryKey: matchingQueryKeys.detail(id),
    queryFn: async () => {
      const response = await matchingClient.getMatchings({});
      return response.data.find((m) => m.id === id);
    },
    enabled: !!id,
    staleTime: 30 * 1000,
    gcTime: 5 * 60 * 1000,
  });
};

export const useVariantMatching = (variantId: string) => {
  return useQuery({
    queryKey: matchingQueryKeys.variantMatching(variantId),
    queryFn: () => matchingClient.getVariantMatching(variantId),
    enabled: !!variantId,
    staleTime: 30 * 1000,
    gcTime: 5 * 60 * 1000,
  });
};

const isNotFoundError = (error: unknown) =>
  typeof error === 'object' &&
  error !== null &&
  'statusCode' in error &&
  (error as { statusCode?: number }).statusCode === 404;

export const useVariantStockPolicy = (variantId: string, enabled = true) => {
  return useQuery({
    queryKey: matchingQueryKeys.stockPolicy(variantId),
    queryFn: async () => {
      try {
        return await matchingClient.getVariantStockPolicy(variantId);
      } catch (error) {
        if (isNotFoundError(error)) {
          return createDefaultStockPolicy();
        }
        throw error;
      }
    },
    enabled: !!variantId && enabled,
    staleTime: 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });
};

export const useVariantSkuLookup = (
  variantId: string,
  options: VariantSkuLookupDto,
  enabled = true
) => {
  return useQuery({
    queryKey: matchingQueryKeys.skuLookup(variantId, options),
    queryFn: () => matchingClient.getVariantSkuLookup(variantId, options),
    enabled: !!variantId && enabled,
    staleTime: 30 * 1000,
    gcTime: 5 * 60 * 1000,
  });
};

export const useOrderLines = (query: OrderLinesQuery = {}) => {
  return useQuery({
    queryKey: matchingQueryKeys.orderLines(query),
    queryFn: () => matchingClient.getOrderLines(query),
    staleTime: 30 * 1000,
    gcTime: 5 * 60 * 1000,
  });
};

export const useMastersBatchStats = (masterIds: string[]) => {
  return useQuery({
    queryKey: matchingQueryKeys.mastersBatchStats(masterIds),
    queryFn: () => matchingClient.getMastersBatchStats(masterIds),
    enabled: masterIds.length > 0,
    staleTime: 30 * 1000,
    gcTime: 5 * 60 * 1000,
  });
};

export const usePendingMatchings = (
  query: Omit<MatchingsQuery, 'status'> = {}
) => useMatchings({ ...query, status: 'pending' });

export const useMatchedMatchings = (
  query: Omit<MatchingsQuery, 'status'> = {}
) => useMatchings({ ...query, status: 'matched' });

export const useIgnoredMatchings = (
  query: Omit<MatchingsQuery, 'status'> = {}
) => useMatchings({ ...query, status: 'ignored' });

export const useMatchingsWithOrders = (query: MatchingsQuery = {}) =>
  useMatchings(query);

export const useVariantSkuMapping = useVariantSkuLookup;
