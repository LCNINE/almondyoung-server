'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { matchingQueryKeys } from './query-keys';
import { matchingClient } from '@/lib/api/domains/matching';
import type {
  ResolveMatchingDto,
  ResolveOptionMatchingDto,
  SetMatchingPriorityDto,
  ChangeStrategyDto,
  StockPolicyDto,
  VariantMatchingDto,
  UpsertMatchingDto,
} from '@/lib/types/dto/matching';

export const useResolveMatching = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: ResolveMatchingDto }) =>
      matchingClient.resolveMatching(id, data),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: matchingQueryKeys.lists() });
      queryClient.invalidateQueries({
        queryKey: matchingQueryKeys.detail(variables.id),
      });
      queryClient.invalidateQueries({
        queryKey: matchingQueryKeys.variantMatchings(),
      });
      queryClient.invalidateQueries({
        queryKey: matchingQueryKeys.orderLineLists(),
      });
      queryClient.invalidateQueries({ queryKey: matchingQueryKeys.all });
    },
  });
};

export const useResolveOptionMatching = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      data,
    }: {
      id: string;
      data: ResolveOptionMatchingDto;
    }) => matchingClient.resolveOptionMatching(id, data),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: matchingQueryKeys.lists() });
      queryClient.invalidateQueries({
        queryKey: matchingQueryKeys.detail(variables.id),
      });
      queryClient.invalidateQueries({ queryKey: matchingQueryKeys.all });
    },
  });
};

export const useSetMatchingPriority = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: SetMatchingPriorityDto }) =>
      matchingClient.setMatchingPriority(id, data),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: matchingQueryKeys.lists() });
      queryClient.invalidateQueries({
        queryKey: matchingQueryKeys.detail(variables.id),
      });
    },
  });
};

export const useChangeMatchingStrategy = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: ChangeStrategyDto }) =>
      matchingClient.changeMatchingStrategy(id, data),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: matchingQueryKeys.lists() });
      queryClient.invalidateQueries({
        queryKey: matchingQueryKeys.detail(variables.id),
      });
      queryClient.invalidateQueries({
        queryKey: matchingQueryKeys.orderLineLists(),
      });
    },
  });
};

export const useUpdateMatchingStockPolicy = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: StockPolicyDto }) =>
      matchingClient.updateMatchingStockPolicy(id, data),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: matchingQueryKeys.lists() });
      queryClient.invalidateQueries({
        queryKey: matchingQueryKeys.detail(variables.id),
      });
      queryClient.invalidateQueries({
        queryKey: matchingQueryKeys.stockPolicies(),
      });
    },
  });
};

export const useUpdateVariantMatching = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      variantId,
      data,
    }: {
      variantId: string;
      data: Partial<VariantMatchingDto>;
    }) => matchingClient.updateVariantMatching(variantId, data),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: matchingQueryKeys.variantMatching(variables.variantId),
      });
      queryClient.invalidateQueries({ queryKey: matchingQueryKeys.lists() });
      queryClient.invalidateQueries({
        queryKey: matchingQueryKeys.orderLineLists(),
      });
      queryClient.invalidateQueries({ queryKey: matchingQueryKeys.all });
    },
  });
};

export const useUpsertVariantMatching = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      variantId,
      data,
    }: {
      variantId: string;
      data: UpsertMatchingDto;
    }) => matchingClient.upsertVariantMatching(variantId, data),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: matchingQueryKeys.variantMatching(variables.variantId),
      });
      queryClient.invalidateQueries({ queryKey: matchingQueryKeys.lists() });
      queryClient.invalidateQueries({
        queryKey: matchingQueryKeys.orderLineLists(),
      });
      queryClient.invalidateQueries({ queryKey: matchingQueryKeys.all });
    },
  });
};

export const useIgnoreMatching = () => {
  const resolveMatching = useResolveMatching();
  return useMutation({
    mutationFn: ({
      id,
      stockPolicy,
    }: {
      id: string;
      stockPolicy?: StockPolicyDto;
    }) =>
      resolveMatching.mutateAsync({
        id,
        data: {
          ignore: false,
          resolveAsVoid: true,
          strategy: 'void',
          stockPolicy: stockPolicy ?? {
            preStockSellable: true,
            alwaysSellableZeroStock: false,
          },
          isGift: false,
        },
      }),
  });
};

export const useCompleteMatching = () => {
  const resolveMatching = useResolveMatching();
  return useMutation({
    mutationFn: ({
      id,
      skuIds,
      skuMappings,
      stockPolicy,
      isGift = false,
    }: {
      id: string;
      skuIds?: string[];
      skuMappings?: Array<{ skuId: string; quantity: number }>;
      stockPolicy?: StockPolicyDto;
      isGift?: boolean;
    }) =>
      resolveMatching.mutateAsync({
        id,
        data: {
          skuIds,
          skuMappings,
          ignore: false,
          strategy: 'variant',
          stockPolicy: stockPolicy ?? {
            preStockSellable: true,
            alwaysSellableZeroStock: false,
          },
          isGift,
        },
      }),
  });
};
