// src/lib/services/orders/queries.ts
'use client';

import {
  useQuery,
  useMutation,
  useQueryClient,
  keepPreviousData,
} from '@tanstack/react-query';
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
  OrderLinesQuery,
} from '@/lib/types/dto/orders';
import type {
  QualityMetricsQuery,
  ListFulfillmentsQuery,
  FulfillmentOrdersQuery,
} from '@/lib/types/dto/fulfillment';

// 주문 관련 쿼리
export const useSalesOrders = (params?: any) => {
  return useQuery({
    queryKey: orderQueryKeys.ordersList(params),
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

// ===== 출고 배치 관련 쿼리 (D2) =====

export const useOutboundBatches = (warehouseId?: string) => {
  return useQuery({
    queryKey: orderQueryKeys.outboundBatchList(warehouseId),
    queryFn: () => orders.outboundBatches.list(warehouseId),
  });
};

export const useOutboundBatch = (id: string) => {
  return useQuery({
    queryKey: orderQueryKeys.outboundBatch(id),
    queryFn: () => orders.outboundBatches.get(id),
    enabled: !!id,
  });
};

export const useOutboundBatchPickingList = (id: string) => {
  return useQuery({
    queryKey: orderQueryKeys.outboundBatchPickingList(id),
    queryFn: () => orders.outboundBatches.getPickingList(id),
    enabled: !!id,
  });
};

export const useAvailableFulfillmentOrders = (warehouseId: string) => {
  return useQuery({
    queryKey: orderQueryKeys.availableFulfillmentOrders(warehouseId),
    queryFn: () =>
      orders.outboundBatches.getAvailableFulfillmentOrders(warehouseId),
    enabled: !!warehouseId,
  });
};

// ===== 직배송 관련 쿼리 (D2) =====

export const useDirectShipDashboard = () => {
  return useQuery({
    queryKey: orderQueryKeys.directShipDashboard,
    queryFn: () => orders.directShip.getDashboard(),
  });
};

export const useDirectShipCompanies = () => {
  return useQuery({
    queryKey: orderQueryKeys.directShipCompanies,
    queryFn: () => orders.directShip.getCompanies(),
  });
};

export const useDirectShipOrders = (params?: {
  companyName?: string;
  status?: string;
  warehouseId?: string;
}) => {
  return useQuery({
    queryKey: orderQueryKeys.directShipOrders(params as Record<string, string>),
    queryFn: () => orders.directShip.getOrders(params),
  });
};

export const useDirectShipCompanySummary = (companyName: string) => {
  return useQuery({
    queryKey: orderQueryKeys.directShipCompanySummary(companyName),
    queryFn: () => orders.directShip.getCompanySummary(companyName),
    enabled: !!companyName,
  });
};

// ===== 합포장 관련 쿼리 (D2) =====

export const useConsolidationCandidates = (warehouseId: string) => {
  return useQuery({
    queryKey: orderQueryKeys.consolidationCandidates(warehouseId),
    queryFn: () => orders.consolidation.getCandidates(warehouseId),
    enabled: !!warehouseId,
  });
};

export const useConsolidationLive = (warehouseId: string) => {
  return useQuery({
    queryKey: orderQueryKeys.consolidationLive(warehouseId),
    queryFn: () => orders.consolidation.getLiveOpportunities(warehouseId),
    enabled: !!warehouseId,
  });
};

export const useConsolidationSavings = (
  warehouseId: string,
  days: number = 30
) => {
  return useQuery({
    queryKey: orderQueryKeys.consolidationSavings(warehouseId, days),
    queryFn: () => orders.consolidation.getSavingsProjection(warehouseId, days),
    enabled: !!warehouseId,
  });
};

export const useConsolidationRules = () => {
  return useQuery({
    queryKey: orderQueryKeys.consolidationRules,
    queryFn: () => orders.consolidation.getRules(),
  });
};

// ===== 위치 최적화 관련 쿼리 (D2) =====

export const useLocationOptimizationZones = () => {
  return useQuery({
    queryKey: orderQueryKeys.locationOptimizationZones,
    queryFn: () => orders.locationOptimization.getZones(),
  });
};

// 피킹 관련 쿼리
export const usePickings = () => {
  return useQuery({
    queryKey: orderQueryKeys.pickings,
    queryFn: () => Promise.resolve([]), // picking은 세션/배치 단위라 목록 API 없음
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

export const useBatchPickingOperations = (batchId: string) => {
  return useQuery({
    queryKey: orderQueryKeys.batchOperations(batchId),
    queryFn: () => orders.picking.getBatchOperations(batchId),
    enabled: !!batchId,
  });
};

export const useBatchPickingProgress = (batchId: string) => {
  return useQuery({
    queryKey: orderQueryKeys.batchProgress(batchId),
    queryFn: () => orders.picking.getBatchProgress(batchId),
    enabled: !!batchId,
  });
};

export const usePickingSession = (foId: string) => {
  return useQuery({
    queryKey: orderQueryKeys.pickingSession(foId),
    queryFn: () => orders.picking.getPickingSession(foId),
    enabled: !!foId,
  });
};

// 이행(출고주문) 관련 쿼리 — GET /fulfillments, GET /fulfillments/:id
export const useFulfillmentOrders = (query: FulfillmentOrdersQuery | ListFulfillmentsQuery = {}) => {
  return useQuery({
    queryKey: orderQueryKeys.fulfillmentsList(query),
    queryFn: () => orders.fulfillmentOrder.list(query as FulfillmentOrdersQuery),
    placeholderData: keepPreviousData,
  });
};

/** @deprecated useFulfillment 사용 권장 */
export const useFulfillmentOrder = (id: string) => {
  return useQuery({
    queryKey: orderQueryKeys.fulfillment(id),
    queryFn: () => orders.fulfillmentOrder.getOne(id),
    enabled: !!id,
  });
};

// 별칭 (호환성) — useFulfillmentOrders/useFulfillmentOrder 로 통합
export const useFulfillments = useFulfillmentOrders;
export const useFulfillment = useFulfillmentOrder;

export const useFulfillmentOutboxEvents = (id: string) => {
  return useQuery({
    queryKey: [...orderQueryKeys.fulfillment(id), 'outbox-events'],
    queryFn: () => orders.fulfillments.getOutboxEvents(id),
    enabled: !!id,
  });
};

// 검수 관련 쿼리
export const useInspectionSession = (sessionId: string) => {
  return useQuery({
    queryKey: orderQueryKeys.inspectionSession(sessionId),
    queryFn: () => orders.inspection.getSession(sessionId),
    enabled: !!sessionId,
  });
};

export const useInspectionSummary = (foId: string) => {
  return useQuery({
    queryKey: orderQueryKeys.inspectionSummary(foId),
    queryFn: () => orders.inspection.getSummary(foId),
    enabled: !!foId,
  });
};

export const useInspectionHistory = (foiId: string) => {
  return useQuery({
    queryKey: orderQueryKeys.inspectionHistory(foiId),
    queryFn: () => orders.inspection.getHistory(foiId),
    enabled: !!foiId,
  });
};

export const useQualityMetrics = (query: QualityMetricsQuery = {}) => {
  return useQuery({
    queryKey: orderQueryKeys.qualityMetrics(query),
    queryFn: () => orders.inspection.getQualityMetrics(query),
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

// 구매 주문 관련 쿼리 (임시 구현 — 통합 서버 이전 전 stub. 신규는 inventory의 usePurchaseOrders 사용)
export const useLegacyPurchaseOrders = () => {
  return useQuery({
    queryKey: orderQueryKeys.purchaseOrders,
    queryFn: () => Promise.resolve([]),
  });
};

export const useLegacyPurchaseOrder = (id: string) => {
  return useQuery({
    queryKey: orderQueryKeys.purchaseOrder(id),
    queryFn: () => Promise.resolve({ id }),
    enabled: !!id,
  });
};

// 송장 관련 쿼리
export const useInvoices = () => {
  return useQuery({
    queryKey: orderQueryKeys.invoices,
    queryFn: () => Promise.resolve([]), // 목록 API 없음 — FO 단위 발행 후 ID로 조회
  });
};

export const useInvoice = (id: string) => {
  return useQuery({
    queryKey: orderQueryKeys.invoice(id),
    queryFn: () => orders.invoices.getDetail(id),
    enabled: !!id,
  });
};

// 레거시 직접 배송 쿼리 (호환성)
export const useDirectShips = () => {
  return useQuery({
    queryKey: orderQueryKeys.directShips,
    queryFn: () => orders.directShip.getOrders(),
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

export const useOrderStats = () => {
  return useQuery({
    queryKey: orderQueryKeys.orderStats,
    queryFn: () => orders.salesOrders.getStats(),
    staleTime: 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
  });
};

// 누락된 함수들 추가 (임시 구현)
export const useConfirmSalesOrder = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => orders.salesOrders.confirmSalesOrder(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sales-orders'] });
      queryClient.invalidateQueries({ queryKey: orderQueryKeys.orderStats });
    },
  });
};

// ===== 매칭 관련 쿼리 (WMS API 스펙 기반) =====

/**
 * 전략 미결정 목록 조회
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
 * 전략 미결정 상태인 항목들만 조회 (기본 필터)
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

/**
 * 주문 라인별 매칭 현황 조회
 * sales_order_lines 기반
 */
export const useOrderLines = (query: OrderLinesQuery = {}) => {
  return useQuery({
    queryKey: orderQueryKeys.orderLines(query),
    queryFn: () => orders.matching.getOrderLines(query),
    staleTime: 30 * 1000,
    gcTime: 5 * 60 * 1000,
  });
};

// 기존 호환성을 위한 별칭
export const useVariantSkuMapping = useVariantSkuLookup;
