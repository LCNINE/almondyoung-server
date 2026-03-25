// src/lib/services/orders/mutations.ts
'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { orderQueryKeys } from './query-keys';
import { orders } from '@/lib/api/domains';
import type {
  ResolveMatchingDto,
  ResolveOptionMatchingDto,
  SetMatchingPriorityDto,
  ChangeStrategyDto,
  StockPolicyDto,
  VariantMatchingDto,
} from '@/lib/types/dto/orders';

// 주문 관련 뮤테이션
export const useCreateSalesOrder = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: orders.salesOrders.createSalesOrder,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: orderQueryKeys.orders });
    },
  });
};

export const useUpdateSalesOrder = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) =>
      orders.salesOrders.updateSalesOrder(id, data),
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: orderQueryKeys.orders });
      queryClient.invalidateQueries({ queryKey: orderQueryKeys.order(id) });
    },
  });
};

export const useDeleteSalesOrder = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => orders.salesOrders.cancelSalesOrder(id),
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: orderQueryKeys.orders });
      queryClient.removeQueries({ queryKey: orderQueryKeys.order(id) });
    },
  });
};

// 출고 배치 관련 뮤테이션 (임시 구현)
export const useCreateOutboundBatch = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: any) => Promise.resolve({ id: 'new-batch-id', ...data }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: orderQueryKeys.outboundBatches,
      });
    },
  });
};

export const useUpdateOutboundBatch = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) =>
      Promise.resolve({ id, ...data }),
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({
        queryKey: orderQueryKeys.outboundBatches,
      });
      queryClient.invalidateQueries({
        queryKey: orderQueryKeys.outboundBatch(id),
      });
    },
  });
};

export const useDeleteOutboundBatch = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => Promise.resolve(),
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({
        queryKey: orderQueryKeys.outboundBatches,
      });
      queryClient.removeQueries({ queryKey: orderQueryKeys.outboundBatch(id) });
    },
  });
};

// ===== 매칭 관련 뮤테이션 (WMS API 스펙 기반) =====

/**
 * 매칭 대기 해소 (SKU와 매칭 또는 무시)
 */
export const useResolveMatching = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: ResolveMatchingDto }) =>
      orders.matching.resolveMatching(id, data),
    onSuccess: (data, variables) => {
      // 매칭 목록 쿼리 무효화
      queryClient.invalidateQueries({
        queryKey: orderQueryKeys.matchingLists(),
      });

      // 개별 매칭 쿼리 무효화
      queryClient.invalidateQueries({
        queryKey: orderQueryKeys.matchingDetail(variables.id),
      });

      // Variant별 매칭 쿼리 무효화
      queryClient.invalidateQueries({
        queryKey: orderQueryKeys.variantMatchings(),
      });
    },
  });
};

/**
 * 옵션별 매칭 해소
 */
export const useResolveOptionMatching = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      id,
      data,
    }: {
      id: string;
      data: ResolveOptionMatchingDto;
    }) => orders.matching.resolveOptionMatching(id, data),
    onSuccess: (data, variables) => {
      // 매칭 목록 쿼리 무효화
      queryClient.invalidateQueries({
        queryKey: orderQueryKeys.matchingLists(),
      });

      // 개별 매칭 쿼리 무효화
      queryClient.invalidateQueries({
        queryKey: orderQueryKeys.matchingDetail(variables.id),
      });
    },
  });
};

/**
 * 매칭 대기 우선순위 설정
 */
export const useSetMatchingPriority = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: SetMatchingPriorityDto }) =>
      orders.matching.setMatchingPriority(id, data),
    onSuccess: (data, variables) => {
      // 매칭 목록 쿼리 무효화
      queryClient.invalidateQueries({
        queryKey: orderQueryKeys.matchingLists(),
      });

      // 개별 매칭 쿼리 무효화
      queryClient.invalidateQueries({
        queryKey: orderQueryKeys.matchingDetail(variables.id),
      });
    },
  });
};

/**
 * 매칭 전략 변경
 */
export const useChangeMatchingStrategy = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: ChangeStrategyDto }) =>
      orders.matching.changeMatchingStrategy(id, data),
    onSuccess: (data, variables) => {
      // 매칭 목록 쿼리 무효화
      queryClient.invalidateQueries({
        queryKey: orderQueryKeys.matchingLists(),
      });

      // 개별 매칭 쿼리 무효화
      queryClient.invalidateQueries({
        queryKey: orderQueryKeys.matchingDetail(variables.id),
      });
    },
  });
};

/**
 * 매칭의 재고 정책 업데이트
 */
export const useUpdateMatchingStockPolicy = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: StockPolicyDto }) =>
      orders.matching.updateMatchingStockPolicy(id, data),
    onSuccess: (data, variables) => {
      // 매칭 목록 쿼리 무효화
      queryClient.invalidateQueries({
        queryKey: orderQueryKeys.matchingLists(),
      });

      // 개별 매칭 쿼리 무효화
      queryClient.invalidateQueries({
        queryKey: orderQueryKeys.matchingDetail(variables.id),
      });

      // 재고 정책 쿼리 무효화
      queryClient.invalidateQueries({
        queryKey: orderQueryKeys.stockPolicies(),
      });
    },
  });
};

/**
 * Variant별 매칭 업데이트
 */
export const useUpdateVariantMatching = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      variantId,
      data,
    }: {
      variantId: string;
      data: Partial<VariantMatchingDto>;
    }) => orders.matching.updateVariantMatching(variantId, data),
    onSuccess: (data, variables) => {
      // Variant별 매칭 쿼리 무효화
      queryClient.invalidateQueries({
        queryKey: orderQueryKeys.variantMatching(variables.variantId),
      });

      // 매칭 목록 쿼리 무효화
      queryClient.invalidateQueries({
        queryKey: orderQueryKeys.matchingLists(),
      });
    },
  });
};

/**
 * 매칭 무시 처리 (편의 함수)
 */
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
          ignore: true,
          strategy: 'variant',
          stockPolicy: stockPolicy || {
            inventoryManagement: true,
            preStockSellable: true,
            alwaysSellableZeroStock: false,
          },
          isGift: false,
        },
      }),
  });
};

/**
 * 매칭 완료 처리 (편의 함수)
 */
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
          stockPolicy: stockPolicy || {
            inventoryManagement: true,
            preStockSellable: true,
            alwaysSellableZeroStock: false,
          },
          isGift,
        },
      }),
  });
};
