// src/lib/services/orders/queries.ts
'use client';

import { useQuery, useMutation } from '@tanstack/react-query';
import { orderQueryKeys } from './query-keys';
import { orders } from '@/lib/api/domains';
import type {
  MatchingsQuery,
  MatchingsResponseDto,
  MatchingDto,
  VariantMatchingDto,
  StockPolicyDto,
  VariantSkuLookupDto,
  VariantSkuLookupResponseDto,
} from '@/lib/types/dto/orders';

// 주문 관련 쿼리
export const useSalesOrders = (params?: any) => {
  return useQuery({
    queryKey: orderQueryKeys.orders,
    queryFn: () => orders.salesOrders.getSalesOrders(params),
  });
};

export const useSalesOrder = (id: string) => {
  return useQuery({
    queryKey: orderQueryKeys.order(id),
    queryFn: () => orders.salesOrders.getSalesOrder(id),
    enabled: !!id,
  });
};

export const useSalesOrderItems = (orderId: string) => {
  return useQuery({
    queryKey: orderQueryKeys.orderItems(orderId),
    queryFn: () => Promise.resolve([]), // TODO: API 클라이언트에 메서드 추가 필요
    enabled: !!orderId,
  });
};

// 출고 배치 관련 쿼리 (임시 구현)
export const useOutboundBatches = () => {
  return useQuery({
    queryKey: orderQueryKeys.outboundBatches,
    queryFn: () => Promise.resolve([]),
  });
};

export const useOutboundBatch = (id: string) => {
  return useQuery({
    queryKey: orderQueryKeys.outboundBatch(id),
    queryFn: () => Promise.resolve({ id }),
    enabled: !!id,
  });
};

// 피킹 관련 쿼리 (임시 구현)
export const usePickings = () => {
  return useQuery({
    queryKey: orderQueryKeys.pickings,
    queryFn: () => Promise.resolve([]),
  });
};

export const usePicking = (id: string) => {
  return useQuery({
    queryKey: orderQueryKeys.picking(id),
    queryFn: () => Promise.resolve({ id }),
    enabled: !!id,
  });
};

export const usePickingList = (orderId: string) => {
  return useQuery({
    queryKey: orderQueryKeys.pickingList(orderId),
    queryFn: () => Promise.resolve([]),
    enabled: !!orderId,
  });
};

// 이행 관련 쿼리 (임시 구현)
export const useFulfillments = () => {
  return useQuery({
    queryKey: orderQueryKeys.fulfillments,
    queryFn: () => Promise.resolve([]),
  });
};

export const useFulfillment = (id: string) => {
  return useQuery({
    queryKey: orderQueryKeys.fulfillment(id),
    queryFn: () => Promise.resolve({ id }),
    enabled: !!id,
  });
};

export const useFulfillmentOrders = () => {
  return useQuery({
    queryKey: orderQueryKeys.fulfillmentOrders,
    queryFn: () => Promise.resolve([]),
  });
};

export const useFulfillmentOrder = (id: string) => {
  return useQuery({
    queryKey: orderQueryKeys.fulfillmentOrder(id),
    queryFn: () => Promise.resolve({ id }),
    enabled: !!id,
  });
};

// 기존 매칭 관련 쿼리 (호환성)
export const useProductMatchings = () => {
  return useQuery({
    queryKey: orderQueryKeys.productMatchings,
    queryFn: () => Promise.resolve([]),
  });
};

export const useProductMatching = (id: string) => {
  return useQuery({
    queryKey: orderQueryKeys.productMatching(id),
    queryFn: () => Promise.resolve({ id }),
    enabled: !!id,
  });
};

export const useProductSkuMappings = () => {
  return useQuery({
    queryKey: orderQueryKeys.productSkuMappings,
    queryFn: () => Promise.resolve([]),
  });
};

export const useProductSkuMapping = (id: string) => {
  return useQuery({
    queryKey: orderQueryKeys.productSkuMapping(id),
    queryFn: () => Promise.resolve({ id }),
    enabled: !!id,
  });
};

// 구매 주문 관련 쿼리 (임시 구현)
export const usePurchaseOrders = () => {
  return useQuery({
    queryKey: orderQueryKeys.purchaseOrders,
    queryFn: () => Promise.resolve([]),
  });
};

export const usePurchaseOrder = (id: string) => {
  return useQuery({
    queryKey: orderQueryKeys.purchaseOrder(id),
    queryFn: () => Promise.resolve({ id }),
    enabled: !!id,
  });
};

// 송장 관련 쿼리 (임시 구현)
export const useInvoices = () => {
  return useQuery({
    queryKey: orderQueryKeys.invoices,
    queryFn: () => Promise.resolve([]),
  });
};

export const useInvoice = (id: string) => {
  return useQuery({
    queryKey: orderQueryKeys.invoice(id),
    queryFn: () => Promise.resolve({ id }),
    enabled: !!id,
  });
};

// 직접 배송 관련 쿼리 (임시 구현)
export const useDirectShips = () => {
  return useQuery({
    queryKey: orderQueryKeys.directShips,
    queryFn: () => Promise.resolve([]),
  });
};

export const useDirectShip = (id: string) => {
  return useQuery({
    queryKey: orderQueryKeys.directShip(id),
    queryFn: () => Promise.resolve({ id }),
    enabled: !!id,
  });
};

// 메트릭스 관련 쿼리 (임시 구현)
export const useOrderMetrics = () => {
  return useQuery({
    queryKey: orderQueryKeys.orderMetrics,
    queryFn: () => Promise.resolve({ total: 0, pending: 0, completed: 0 }),
  });
};

export const useFulfillmentMetrics = () => {
  return useQuery({
    queryKey: orderQueryKeys.fulfillmentMetrics,
    queryFn: () => Promise.resolve({ total: 0, pending: 0, completed: 0 }),
  });
};

// 누락된 함수들 추가 (임시 구현)
export const useConfirmSalesOrder = () => {
  return useMutation({
    mutationFn: (id: string) => Promise.resolve({ id, confirmed: true }),
  });
};

// ===== 매칭 관련 쿼리 (WMS API 스펙 기반) =====

/**
 * 매칭 대기 목록 조회
 */
export const useMatchings = (query: MatchingsQuery = {}) => {
  return useQuery({
    queryKey: orderQueryKeys.matchingList(query),
    queryFn: () => orders.matching.getMatchings(query),
    staleTime: 30 * 1000, // 30초
    gcTime: 5 * 60 * 1000, // 5분
  });
};

/**
 * 개별 매칭 조회 (현재는 목록에서 가져오므로 별도 구현 불필요)
 */
export const useMatching = (id: string) => {
  return useQuery({
    queryKey: orderQueryKeys.matchingDetail(id),
    queryFn: async () => {
      // 개별 매칭 조회는 현재 API에 없으므로 목록에서 필터링
      const response = await orders.matching.getMatchings({});
      return response.data.find((m) => m.id === id);
    },
    enabled: !!id,
    staleTime: 30 * 1000,
    gcTime: 5 * 60 * 1000,
  });
};

/**
 * Variant별 매칭 조회
 */
export const useVariantMatching = (variantId: string) => {
  return useQuery({
    queryKey: orderQueryKeys.variantMatching(variantId),
    queryFn: () => orders.matching.getVariantMatching(variantId),
    enabled: !!variantId,
    staleTime: 30 * 1000,
    gcTime: 5 * 60 * 1000,
  });
};

/**
 * Variant의 재고 정책 조회
 */
export const useVariantStockPolicy = (variantId: string) => {
  return useQuery({
    queryKey: orderQueryKeys.stockPolicy(variantId),
    queryFn: () => orders.matching.getVariantStockPolicy(variantId),
    enabled: !!variantId,
    staleTime: 60 * 1000, // 1분
    gcTime: 10 * 60 * 1000, // 10분
  });
};

/**
 * Variant의 SKU 조합 조회
 */
export const useVariantSkuLookup = (
  variantId: string,
  options: VariantSkuLookupDto,
  enabled: boolean = true
) => {
  return useQuery({
    queryKey: orderQueryKeys.skuLookup(variantId, options),
    queryFn: () => orders.matching.getVariantSkuLookup(variantId, options),
    enabled: !!variantId && enabled,
    staleTime: 30 * 1000,
    gcTime: 5 * 60 * 1000,
  });
};

/**
 * 매칭 대기 상태인 항목들만 조회 (기본 필터)
 */
export const usePendingMatchings = (
  query: Omit<MatchingsQuery, 'status'> = {}
) => {
  return useMatchings({
    ...query,
    status: 'pending',
  });
};

/**
 * 매칭된 항목들만 조회
 */
export const useMatchedMatchings = (
  query: Omit<MatchingsQuery, 'status'> = {}
) => {
  return useMatchings({
    ...query,
    status: 'matched',
  });
};

/**
 * 무시된 항목들만 조회
 */
export const useIgnoredMatchings = (
  query: Omit<MatchingsQuery, 'status'> = {}
) => {
  return useMatchings({
    ...query,
    status: 'ignored',
  });
};

/**
 * 주문 정보가 포함된 매칭 목록 조회
 */
export const useMatchingsWithOrders = (query: MatchingsQuery = {}) => {
  return useMatchings({
    ...query,
  });
};

// 기존 호환성을 위한 별칭
export const useVariantSkuMapping = useVariantSkuLookup;
