// src/lib/services/orders/index.ts
// 주문 서비스 계층 통합 export

// 쿼리 키
export * from './query-keys';

// 주문 액션 헬퍼
export * from './order-actions';

// 쿼리 훅들 (기존 WMS hooks에서 주문 관련만 추출)
export {
  useOrderStats,
  useSalesOrders,
  useSalesOrder,
  useSalesOrderItems,
  useOutboundBatches,
  useOutboundBatch,
  usePickings,
  usePicking,
  usePickingList,
  useFulfillments,
  useFulfillment,
  useFulfillmentOrders,
  useFulfillmentOrder,
  usePurchaseOrders,
  usePurchaseOrder,
  useInvoices,
  useInvoice,
  useDirectShips,
  useDirectShip,
  useOrderMetrics,
  useFulfillmentMetrics,
  useConfirmSalesOrder,

  // 매칭 관련 쿼리 (WMS API 스펙 기반)
  useMatchings,
  useMatching,
  useVariantMatching,
  useVariantStockPolicy,
  useVariantSkuLookup,
  usePendingMatchings,
  useMatchedMatchings,
  useIgnoredMatchings,
  useMatchingsWithOrders,
  useOrderLines,

  // 기존 매칭 관련 (호환성)
  useProductMatchings,
  useProductMatching,
  useProductSkuMappings,
  useProductSkuMapping,
  useVariantSkuMapping,
} from './queries';

// 뮤테이션 훅들
export {
  useCreateSalesOrder,
  useUpdateSalesOrder,
  useDeleteSalesOrder,
  useCreateOutboundBatch,
  useUpdateOutboundBatch,
  useDeleteOutboundBatch,

  // 매칭 관련 뮤테이션 (WMS API 스펙 기반)
  useResolveMatching,
  useResolveOptionMatching,
  useSetMatchingPriority,
  useChangeMatchingStrategy,
  useUpdateMatchingStockPolicy,
  useUpdateVariantMatching,
  useIgnoreMatching,
  useCompleteMatching,
} from './mutations';

// 데이터 변환 함수들
export * from './transformers';
