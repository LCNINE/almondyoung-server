// src/lib/services/orders/index.ts
// 주문 서비스 계층 통합 export

// 쿼리 키
export * from './query-keys';
export * from './idempotency';
export * from './operation-policy';
export * from './waybill-policy';
export { getServerDenyMessage, parseServerError } from '../../api/server-error';

// 주문 액션 헬퍼
export * from './order-actions';

// 쿼리 훅들
export {
  useOrderStats,
  useSalesOrders,
  useSalesOrder,
  useSalesOrderItems,
  // 출고 배치 (D2)
  useOutboundBatchesV2,
  useOutboundBatchV2,
  useOutboundBatchEligibleShipments,
  useOutboundBatchWorkItems,
  // 직배송 (D2)
  useDirectShipDashboard,
  useDirectShipCompanies,
  useDirectShipOrders,
  useDirectShipCompanySummary,
  // 합포장 (D2)
  useConsolidationCandidates,
  useShipmentConsolidationCandidates,
  useConsolidationCandidatesV2,
  useConsolidationLive,
  useConsolidationSavings,
  useConsolidationRules,
  // 위치 최적화 (D2)
  useLocationOptimizationZones,
  // 이행
  useFulfillments,
  useFulfillment,
  useFulfillmentOrders,
  useFulfillmentOrder,
  useFulfillmentOutboxEvents,
  useFulfillmentShipments,
  useShipmentDetail,
  useFulfillmentOperation,
  useShipmentRecallOperation,
  useLegacyPurchaseOrders,
  useLegacyPurchaseOrder,
  // 검수
  useInspectionSummary,
  useInspectionHistory,
  useQualityMetrics,
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
  useAdminRetryRefund,
  useAdminManualRefundComplete,
  // 출고주문(FO) 액션
  useCreateFulfillmentOrder,
  useCancelFulfillment,
  useSplitShipment,
  useReviseShipmentRecipient,
  usePlanShipment,
  useCancelShipmentOutstanding,
  useRecallShipment,
  useReportShipmentShortPick,
  useCreateShipmentConsolidation,
  useCreateConsolidation,
  useShipmentInspectionScan,
  useForceShipmentDispatch,
  // 출고 배치 (D2)
  useCreateOutboundBatchV2,
  useAddShipmentToBatch,
  useExcludeShipmentFromBatch,
  useClaimBatchPicker,
  useClaimBatchPacker,
  useHandoffBatchWorkItem,
  useCreatePickingPlan,
  useStartPickingV2,
  useDiscretePickingScan,
  usePickingHandoff,
  useCompletePickingV2,
  useAggregateBulkCartScan,
  useAggregateSortScan,
  useAggregateCartHandoff,
  useRegisterTote,
  useAssignTote,
  useToteScan,
  useToteHandoff,
  useReleaseTote,
  // 직배송 (D2)
  useForwardDirectShipOrders,
  useCompleteDirectShipOrders,
  useExportDirectShipFile,
  // 합포장 (D2)
  useAnalyzeConsolidation,
  useAutoConsolidate,
  // FO 액션 (Core /fulfillments canonical)
  useDeliverFulfillment,
  // 운송장(waybill) 발급
  useIssueWaybill,
  useRegisterManualWaybill,
  useReissueWaybill,
  useVoidWaybill,
  useBatchIssueWaybills,
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
