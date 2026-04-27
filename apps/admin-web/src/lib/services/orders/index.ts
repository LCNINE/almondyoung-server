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
  useLegacyPurchaseOrders,
  useLegacyPurchaseOrder,
  useInvoices,
  useInvoice,
  useDirectShips,
  useDirectShip,
  useOrderMetrics,
  useFulfillmentMetrics,
  useConfirmSalesOrder,

  useProductMatchings,
  useProductMatching,
  useProductSkuMappings,
  useProductSkuMapping,
} from './queries';

// 뮤테이션 훅들
export {
  useCreateSalesOrder,
  useUpdateSalesOrder,
  useDeleteSalesOrder,
  useCreateOutboundBatch,
  useUpdateOutboundBatch,
  useDeleteOutboundBatch,

} from './mutations';

// 데이터 변환 함수들 (주문 전용)
export * from './transformers';

// 매칭 관련 — lib/services/matching 으로 이전됨. 하위 호환을 위해 re-export 유지.
export {
  matchingQueryKeys,
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
  useMastersBatchStats,
  useVariantSkuMapping,
  useResolveMatching,
  useResolveOptionMatching,
  useSetMatchingPriority,
  useChangeMatchingStrategy,
  useUpdateMatchingStockPolicy,
  useUpdateVariantMatching,
  useUpsertVariantMatching,
  useIgnoreMatching,
  useCompleteMatching,
  getMatchingStatusLabel,
  getMatchingStrategyLabel,
  getPriorityLabel,
  getSalesChannelLabel,
  transformMatchingForTable,
  transformMatchingsForTable,
  createDefaultStockPolicy,
  createDefaultResolveMatching,
  getMatchingStatusColor,
  getPriorityColor,
  getSalesChannelColor,
} from '@/lib/services/matching';
