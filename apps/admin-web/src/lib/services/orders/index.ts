// src/lib/services/orders/index.ts
// 주문 서비스 계층 통합 export

// 쿼리 키
export * from './query-keys';

// 주문 액션 헬퍼
export * from './order-actions';

// 쿼리 훅들
export {
  useOrderStats,
  useSalesOrders,
  useSalesOrder,
  useSalesOrderItems,
  // 출고 배치 (D2)
  useOutboundBatches,
  useOutboundBatch,
  useOutboundBatchPickingList,
  useAvailableFulfillmentOrders,
  // 직배송 (D2)
  useDirectShipDashboard,
  useDirectShipCompanies,
  useDirectShipOrders,
  useDirectShipCompanySummary,
  // 합포장 (D2)
  useConsolidationCandidates,
  useConsolidationLive,
  useConsolidationSavings,
  useConsolidationRules,
  // 위치 최적화 (D2)
  useLocationOptimizationZones,
  // 피킹
  usePickings,
  usePicking,
  usePickingList,
  useBatchPickingOperations,
  useBatchPickingProgress,
  usePickingSession,
  // 이행
  useFulfillments,
  useFulfillment,
  useFulfillmentOrders,
  useFulfillmentOrder,
  useLegacyPurchaseOrders,
  useLegacyPurchaseOrder,
  // 검수
  useInspectionSummary,
  useInspectionHistory,
  useQualityMetrics,
  // 송장
  useInvoices,
  useInvoice,
  // 레거시
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
  useCancelSalesOrder,
  useAdminCancelSalesOrder,
  // 출고 배치 (D2)
  useCreateOutboundBatch,
  useAddFOsToBatch,
  useRemoveFOFromBatch,
  useStartBatchPicking,
  useCompleteBatch,
  useCancelBatch,
  // 직배송 (D2)
  useForwardDirectShipOrders,
  useCompleteDirectShipOrders,
  useExportDirectShipFile,
  // 합포장 (D2)
  useAnalyzeConsolidation,
  useAutoConsolidate,
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
