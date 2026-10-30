// src/lib/services/orders/query-keys.ts
// 주문 관련 쿼리 키 팩토리

export const orderQueryKeys = {
  // 주문 관련
  orders: ['orders'] as const,
  ordersList: (params?: object) => ['orders', 'list', params ?? {}] as const,
  order: (id: string) => ['orders', id] as const,
  orderItems: (orderId: string) => ['orders', orderId, 'items'] as const,

  // 정정(채널 변경)
  amendments: ['sales-order-amendments'] as const,
  amendmentsList: (params: { status: string; origin: string }) =>
    ['sales-order-amendments', 'list', params] as const,
  orderAmendments: (salesOrderId: string) =>
    ['sales-order-amendments', 'order', salesOrderId] as const,

  // 출고 배치 관련
  outboundBatches: ['outbound-batches'] as const,
  outboundBatchesV2Root: ['outbound-batches', 'v2'] as const,
  outboundBatchesV2: (params?: object) =>
    [...orderQueryKeys.outboundBatchesV2Root, 'list', params ?? {}] as const,
  outboundBatchV2: (id: string) => ['outbound-batches', 'v2', id] as const,
  outboundBatchEligibleShipments: (id: string) =>
    ['outbound-batches', 'v2', id, 'eligible-shipments'] as const,
  outboundBatchWorkItems: (id: string) =>
    ['outbound-batches', 'v2', id, 'work-items'] as const,

  // 이행 관련
  fulfillments: ['fulfillments'] as const,
  fulfillmentsList: (params?: object) =>
    ['fulfillments', 'list', params ?? {}] as const,
  fulfillment: (id: string) => ['fulfillments', id] as const,
  fulfillmentShipments: (id: string) =>
    ['fulfillments', id, 'shipments'] as const,
  shipment: (id: string) => ['shipments', id] as const,
  fulfillmentOperation: (id: string) => ['fulfillment-operations', id] as const,
  shipmentRecallOperation: (id: string) =>
    ['shipment-recall-operations', id] as const,
  fulfillmentOrders: ['fulfillment-orders'] as const,
  fulfillmentOrder: (id: string) => ['fulfillment-orders', id] as const,

  // 매칭 관련 (WMS API 스펙 기반)
  matchings: ['matchings'] as const,
  matchingLists: () => [...orderQueryKeys.matchings, 'list'] as const,
  matchingList: (query: Record<string, any>) =>
    [...orderQueryKeys.matchingLists(), query] as const,
  orderLines: (query: Record<string, any>) =>
    [...orderQueryKeys.matchings, 'order-lines', query] as const,
  matchingDetails: () => [...orderQueryKeys.matchings, 'detail'] as const,
  matchingDetail: (id: string) =>
    [...orderQueryKeys.matchingDetails(), id] as const,
  variantMatchings: () => [...orderQueryKeys.matchings, 'variant'] as const,
  variantMatching: (variantId: string) =>
    [...orderQueryKeys.variantMatchings(), variantId] as const,
  stockPolicies: () => [...orderQueryKeys.matchings, 'stock-policy'] as const,
  stockPolicy: (variantId: string) =>
    [...orderQueryKeys.stockPolicies(), variantId] as const,
  skuLookups: () => [...orderQueryKeys.matchings, 'sku-lookup'] as const,
  skuLookup: (variantId: string, options: Record<string, any>) =>
    [...orderQueryKeys.skuLookups(), variantId, options] as const,

  // 기존 매칭 관련 (호환성)
  productMatchings: ['product-matchings'] as const,
  productMatching: (id: string) => ['product-matchings', id] as const,
  productSkuMappings: ['product-sku-mappings'] as const,
  productSkuMapping: (id: string) => ['product-sku-mappings', id] as const,

  // 구매 주문 관련
  purchaseOrders: ['purchase-orders'] as const,
  purchaseOrder: (id: string) => ['purchase-orders', id] as const,

  // 검수 관련
  inspectionSession: (sessionId: string) =>
    ['inspection', 'session', sessionId] as const,
  inspectionSummary: (foId: string) => ['inspection', 'summary', foId] as const,
  inspectionHistory: (foiId: string) =>
    ['inspection', 'history', foiId] as const,
  qualityMetrics: (query: Record<string, any>) =>
    ['inspection', 'metrics', 'quality', query] as const,

  // 직배 운영 (입점사 상자, K3) — 뮤테이션 성공 시 ['direct-ship'] 를 통째로 무효화한다
  directShipCancelNotices: ['direct-ship', 'cancel-notices'] as const,
  directShipSupplierQueue: ['direct-ship', 'supplier-queue'] as const,
  directShipSupplierShipments: (supplierId: string, stage: 'pending' | 'forwarded') =>
    ['direct-ship', 'supplier-queue', supplierId, stage] as const,
  directShipSupplierHandoffs: (supplierId: string) =>
    ['direct-ship', 'handoffs', supplierId] as const,

  // 합포장 관련
  consolidationCandidates: (warehouseId: string) =>
    ['consolidation', 'candidates', warehouseId] as const,
  shipmentConsolidationCandidates: (params: object) =>
    ['shipments', 'consolidation-candidates', params] as const,
  consolidationLive: (warehouseId: string) =>
    ['consolidation', 'live', warehouseId] as const,
  consolidationSavings: (warehouseId: string, days: number) =>
    ['consolidation', 'savings', warehouseId, days] as const,
  consolidationRules: ['consolidation', 'rules'] as const,
  consolidationOptions: (shipmentId: string) =>
    ['shipments', shipmentId, 'consolidation-options'] as const,
  consolidationProgress: (shipmentId: string) =>
    ['shipments', shipmentId, 'consolidation-progress'] as const,

  // 위치 최적화 관련
  locationOptimizationZones: ['location-optimization', 'zones'] as const,

  // 메트릭스 관련
  metrics: ['metrics'] as const,
  orderMetrics: ['metrics', 'orders'] as const,
  fulfillmentMetrics: ['metrics', 'fulfillments'] as const,

  // 통계
  orderStats: ['orders', 'stats'] as const,
  dailyOrderStatus: (from: string, to: string) =>
    ['orders', 'stats', 'daily', { from, to }] as const,

  // 정체 보드
  progressSummary: ['order-progress', 'summary'] as const,
  progressOrders: (params: {
    stage: string;
    state: string;
    stuck: boolean;
    channel: string;
    sort: string;
  }) => ['order-progress', 'orders', params] as const,
} as const;
