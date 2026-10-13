'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { matchingQueryKeys } from './query-keys';
import { productQueryKeys } from '@/lib/services/products/query-keys';
import { matchingClient } from '@/lib/api/domains/matching';
import type {
  ResolveMatchingDto,
  ResolveLegacyIgnoredMatchingDto,
  SetMatchingPriorityDto,
  ChangeStrategyDto,
  StockPolicyDto,
  VariantMatchingDto,
  UpsertMatchingDto,
  UpdateVariantStockPolicyDto,
} from '@/lib/types/dto/matching';
import type { PermissionRequirement } from '@/lib/auth/mutation-permission';

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
useResolveMatching.permission = ['order.matching.write'] as const satisfies PermissionRequirement;

export const useResolveLegacyIgnoredMatching = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      data,
    }: {
      id: string;
      data: ResolveLegacyIgnoredMatchingDto;
    }) => matchingClient.resolveLegacyIgnoredMatching(id, data),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: matchingQueryKeys.lists() });
      queryClient.invalidateQueries({
        queryKey: matchingQueryKeys.legacyIgnoredLists(),
      });
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
useResolveLegacyIgnoredMatching.permission = ['order.matching.write'] as const satisfies PermissionRequirement;

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
useSetMatchingPriority.permission = ['order.matching.write'] as const satisfies PermissionRequirement;

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
useChangeMatchingStrategy.permission = ['order.matching.write'] as const satisfies PermissionRequirement;

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
useUpdateMatchingStockPolicy.permission = ['order.matching.write'] as const satisfies PermissionRequirement;

export const useUpdateVariantStockPolicy = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      variantId,
      data,
    }: {
      variantId: string;
      data: UpdateVariantStockPolicyDto;
    }) => matchingClient.updateVariantStockPolicy(variantId, data),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: matchingQueryKeys.variantMatchingBatches(),
      });
      queryClient.invalidateQueries({
        queryKey: matchingQueryKeys.variantMatching(variables.variantId),
      });
      queryClient.invalidateQueries({
        queryKey: matchingQueryKeys.stockPolicy(variables.variantId),
      });
      queryClient.invalidateQueries({
        queryKey: matchingQueryKeys.orderLineLists(),
      });
      queryClient.invalidateQueries({ queryKey: productQueryKeys.mastersSummaryLists() });
    },
  });
};
useUpdateVariantStockPolicy.permission = ['order.matching.write'] as const satisfies PermissionRequirement;

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
useUpdateVariantMatching.permission = ['order.matching.write'] as const satisfies PermissionRequirement;

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
      queryClient.invalidateQueries({
        queryKey: matchingQueryKeys.stockPolicy(variables.variantId),
      });
      queryClient.invalidateQueries({
        queryKey: matchingQueryKeys.variantMatchingBatches(),
      });
      queryClient.invalidateQueries({ queryKey: matchingQueryKeys.lists() });
      queryClient.invalidateQueries({
        queryKey: matchingQueryKeys.orderLineLists(),
      });
      queryClient.invalidateQueries({ queryKey: matchingQueryKeys.all });
      queryClient.invalidateQueries({ queryKey: productQueryKeys.mastersSummaryLists() });
    },
  });
};
useUpsertVariantMatching.permission = ['order.matching.write'] as const satisfies PermissionRequirement;

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
useIgnoreMatching.permission = ['order.matching.write'] as const satisfies PermissionRequirement;

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
useCompleteMatching.permission = ['order.matching.write'] as const satisfies PermissionRequirement;
