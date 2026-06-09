// src/lib/services/orders/query-keys.ts
// 주문 관련 쿼리 키 팩토리

export const orderQueryKeys = {
  // 주문 관련
  orders: ['orders'] as const,
  ordersList: (params?: object) => ['orders', 'list', params ?? {}] as const,
  order: (id: string) => ['orders', id] as const,
  orderItems: (orderId: string) => ['orders', orderId, 'items'] as const,

  // 출고 배치 관련
  outboundBatches: ['outbound-batches'] as const,
  outboundBatchList: (warehouseId?: string) =>
    ['outbound-batches', 'list', warehouseId ?? ''] as const,
  outboundBatch: (id: string) => ['outbound-batches', id] as const,
  outboundBatchPickingList: (id: string) => ['outbound-batches', id, 'picking-list'] as const,
  availableFulfillmentOrders: (warehouseId: string) =>
    ['outbound-batches', 'available', warehouseId] as const,

  // 피킹 관련
  pickings: ['pickings'] as const,
  picking: (id: string) => ['pickings', id] as const,
  pickingList: (orderId: string) => ['pickings', 'list', orderId] as const,
  pickingSession: (foId: string) => ['pickings', 'session', foId] as const,
  batchOperations: (batchId: string) => ['pickings', 'batch', batchId, 'operations'] as const,
  batchProgress: (batchId: string) => ['pickings', 'batch', batchId, 'progress'] as const,

  // 이행 관련
  fulfillments: ['fulfillments'] as const,
  fulfillmentsList: (params?: Record<string, unknown>) =>
    ['fulfillments', 'list', params ?? {}] as const,
  fulfillment: (id: string) => ['fulfillments', id] as const,
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
  inspectionSummary: (foId: string) => ['inspection', 'summary', foId] as const,
  inspectionHistory: (foiId: string) => ['inspection', 'history', foiId] as const,
  qualityMetrics: (query: Record<string, any>) => ['inspection', 'metrics', 'quality', query] as const,

  // 송장 관련
  invoices: ['invoices'] as const,
  invoice: (id: string) => ['invoices', id] as const,

  // 직배송 관련
  directShipDashboard: ['direct-ship', 'dashboard'] as const,
  directShipCompanies: ['direct-ship', 'companies'] as const,
  directShipOrders: (params?: Record<string, string>) =>
    ['direct-ship', 'orders', params ?? {}] as const,
  directShipOrdersByCompany: ['direct-ship', 'orders', 'by-company'] as const,
  directShipCompanyOrders: (companyName: string, status?: string) =>
    ['direct-ship', 'companies', companyName, status ?? ''] as const,
  directShipCompanySummary: (companyName: string) =>
    ['direct-ship', 'companies', companyName, 'summary'] as const,

  // 합포장 관련
  consolidationCandidates: (warehouseId: string) =>
    ['consolidation', 'candidates', warehouseId] as const,
  consolidationLive: (warehouseId: string) => ['consolidation', 'live', warehouseId] as const,
  consolidationSavings: (warehouseId: string, days: number) =>
    ['consolidation', 'savings', warehouseId, days] as const,
  consolidationRules: ['consolidation', 'rules'] as const,

  // 위치 최적화 관련
  locationOptimizationZones: ['location-optimization', 'zones'] as const,

  // 레거시 직접 배송 키 (호환성)
  directShips: ['direct-ships'] as const,
  directShip: (id: string) => ['direct-ships', id] as const,

  // 메트릭스 관련
  metrics: ['metrics'] as const,
  orderMetrics: ['metrics', 'orders'] as const,
  fulfillmentMetrics: ['metrics', 'fulfillments'] as const,

  // 통계
  orderStats: ['orders', 'stats'] as const,
} as const;
