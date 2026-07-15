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
  VariantSkuLookupDto,
  OrderLinesQuery,
} from '@/lib/types/dto/orders';
import type {
  QualityMetricsQuery,
  ListFulfillmentsQuery,
  FulfillmentOrdersQuery,
  ShipmentConsolidationCandidateQuery,
  OutboundBatchV2ListQuery,
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

export const useOutboundBatchesV2 = (query: OutboundBatchV2ListQuery = {}) => {
  return useQuery({
    queryKey: orderQueryKeys.outboundBatchesV2(query),
    queryFn: () => orders.outboundBatches.listV2(query),
    placeholderData: keepPreviousData,
  });
};

export const useOutboundBatchV2 = (id: string) => {
  return useQuery({
    queryKey: orderQueryKeys.outboundBatchV2(id),
    queryFn: () => orders.outboundBatches.getV2(id),
    enabled: !!id,
  });
};

export const useOutboundBatchEligibleShipments = (id: string) => {
  return useQuery({
    queryKey: orderQueryKeys.outboundBatchEligibleShipments(id),
    queryFn: () => orders.outboundBatches.getEligibleShipments(id),
    enabled: !!id,
  });
};

export const useOutboundBatchWorkItems = (id: string) => {
  return useQuery({
    queryKey: orderQueryKeys.outboundBatchWorkItems(id),
    queryFn: () => orders.outboundBatches.getWorkItems(id),
    enabled: !!id,
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

export const useShipmentConsolidationCandidates = (
  query: ShipmentConsolidationCandidateQuery
) =>
  useQuery({
    queryKey: orderQueryKeys.shipmentConsolidationCandidates(query),
    queryFn: () => orders.consolidation.getShipmentCandidates(query),
    enabled: !!query.warehouseId,
  });

export const useConsolidationCandidatesV2 = useShipmentConsolidationCandidates;

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

// 이행(출고주문) 관련 쿼리 — GET /fulfillments, GET /fulfillments/:id
export const useFulfillmentOrders = (
  query: FulfillmentOrdersQuery | ListFulfillmentsQuery = {}
) => {
  return useQuery({
    queryKey: orderQueryKeys.fulfillmentsList(query),
    queryFn: () =>
      orders.fulfillmentOrder.list(query as FulfillmentOrdersQuery),
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

export const useFulfillmentShipments = (id: string) => {
  return useQuery({
    queryKey: orderQueryKeys.fulfillmentShipments(id),
    queryFn: () => orders.fulfillmentOrder.getShipments(id),
    enabled: !!id,
  });
};

export const useShipmentDetail = (shipmentId: string) => {
  return useQuery({
    queryKey: orderQueryKeys.shipment(shipmentId),
    queryFn: () => orders.fulfillmentOrder.getShipment(shipmentId),
    enabled: !!shipmentId,
  });
};

export const useFulfillmentOperation = (operationId: string) => {
  return useQuery({
    queryKey: orderQueryKeys.fulfillmentOperation(operationId),
    queryFn: () => orders.fulfillmentOrder.getOperation(operationId),
    enabled: !!operationId,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === 'pending' ||
        status === 'in_progress' ||
        status === 'recovery_required'
        ? 2_000
        : false;
    },
  });
};

export const useShipmentRecallOperation = (operationId: string) => {
  return useQuery({
    queryKey: orderQueryKeys.shipmentRecallOperation(operationId),
    queryFn: () => orders.fulfillmentOrder.getRecallOperation(operationId),
    enabled: !!operationId,
    refetchInterval: (query) =>
      query.state.data?.operationStatus === 'pending' ||
      query.state.data?.operationStatus === 'recovery_required'
        ? 2_000
        : false,
  });
};

/** 예약 이전 대상 후보 조회 — 같은 창고·같은 SKU, 작업 전 상태, 부족분 있는 FOI (cross-FO 포함) */
export const useFulfillmentTransferCandidates = (
  foId: string,
  fromFoiId?: string
) => {
  return useQuery({
    queryKey: orderQueryKeys.fulfillmentTransferCandidates(
      foId,
      fromFoiId ?? ''
    ),
    queryFn: () =>
      orders.fulfillments.getTransferCandidates(foId, fromFoiId ?? ''),
    enabled: !!foId && !!fromFoiId,
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
export const useInvoiceOperation = (operationId: string) => {
  return useQuery({
    queryKey: orderQueryKeys.invoiceOperation(operationId),
    queryFn: () => orders.invoices.getOperation(operationId),
    enabled: !!operationId,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === 'pending' ||
        status === 'in_progress' ||
        status === 'recovery_required'
        ? 2_000
        : false;
    },
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
