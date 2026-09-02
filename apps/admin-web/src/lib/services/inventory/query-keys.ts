// src/lib/services/inventory/query-keys.ts
// 재고 관련 쿼리 키 팩토리

import type {
  StockSummaryQuery,
  StockHistoryQuery,
  ReservationTargetType,
  StocktakingSessionQuery,
  SupplierFiltersDto,
  HolderFiltersDto,
  LocationFiltersDto,
  PurchaseOrderListFilters,
  InboundReceiptsQuery,
  InboundWorkLogsQuery,
  InboundStatusQuery,
  ListPlanItemsQueryDto,
  ReturnFiltersDto,
  MovementHistoryQuery,
} from '../../types/dto/inventory';

export const inventoryQueryKeys = {
  // 재고 관련
  stocks: ['stocks'] as const,
  stockSummary: (query?: StockSummaryQuery) => ['stocks', 'summary', query] as const,
  skuTotalStock: (sku: string) => ['stocks', 'sku', sku, 'total'] as const,
  skuWarehouseStock: (sku: string, warehouseId: string) =>
    ['stocks', 'sku', sku, 'warehouse', warehouseId] as const,
  stockHistory: (query: StockHistoryQuery) => ['stocks', 'history', query] as const,
  stockValuationSummary: ['stocks', 'valuation', 'summary'] as const,
  stockValuationProducts: (query?: unknown) => ['stocks', 'valuation', 'products', query] as const,

  // SKU 관련
  skus: (query?: any) => ['skus', query] as const,
  sku: (id: string) => ['skus', id] as const,
  skuSearch: (query: string, page: number, limit: number) =>
    ['skus', 'search', query, page, limit] as const,
  skuStockSummary: (sku: string) => ['skus', sku, 'stock-summary'] as const,

  // 창고 관련
  warehouses: ['warehouses'] as const,
  warehouse: (id: string) => ['warehouses', id] as const,
  warehouseStockSummary: (warehouseId: string) =>
    ['warehouses', warehouseId, 'stock-summary'] as const,

  // 입고 관련
  inbounds: ['inbounds'] as const,
  inbound: (id: string) => ['inbounds', id] as const,
  inboundItems: (inboundId: string) =>
    ['inbounds', inboundId, 'items'] as const,
  inboundPending: (warehouseId?: string) =>
    ['inbounds', 'pending', warehouseId] as const,
  inboundReceipts: (query?: InboundReceiptsQuery) =>
    ['inbounds', 'receipts', query] as const,
  inboundWorkLogs: (query?: InboundWorkLogsQuery) =>
    ['inbounds', 'work-logs', query] as const,
  inboundStatus: (query?: InboundStatusQuery) =>
    ['inbounds', 'status', query] as const,
  inboundPlanItems: (query?: ListPlanItemsQueryDto) =>
    ['inbounds', 'plan-items', query] as const,

  // 검수 관련
  inspections: ['inspections'] as const,
  inspection: (id: string) => ['inspections', id] as const,

  // 이동 관련
  movements: ['movements'] as const,
  movement: (id: string) => ['movements', id] as const,

  // 통합 관련
  consolidations: ['consolidations'] as const,
  consolidation: (id: string) => ['consolidations', id] as const,

  // 자동재고매칭 관련
  inventoryMatchings: () => ['inventory-matchings'] as const,
  inventoryMatching: (id: string) => ['inventory-matchings', id] as const,

  // 공급처 관련
  suppliers: (filters?: SupplierFiltersDto) => ['suppliers', filters] as const,
  supplierFilterOptions: () => ['suppliers', 'filter-options'] as const,
  supplier: (id: string) => ['suppliers', id] as const,

  // 공급처 분류 관련
  supplierCategories: () => ['supplier-categories'] as const,
  supplierCategory: (id: string) => ['supplier-categories', id] as const,

  // 재고소유 관련
  holders: (filters?: HolderFiltersDto) => ['holders', filters] as const,
  holderSearch: (
    query: string,
    isOurAsset?: boolean,
    page: number = 1,
    limit: number = 10
  ) => ['holders', 'search', query, isOurAsset, page, limit] as const,
  holder: (id: string) => ['holders', id] as const,

  // 로케이션 관련
  locations: (warehouseId: string, filters?: LocationFiltersDto) =>
    ['locations', warehouseId, filters] as const,
  location: (id: string) => ['locations', 'detail', id] as const,
  locationColumns: (warehouseId: string, isActive?: boolean) =>
    ['locations', warehouseId, 'columns', isActive] as const,
  locationRacks: (warehouseId: string, columnName?: string, isActive?: boolean) =>
    ['locations', warehouseId, 'racks', columnName, isActive] as const,

  // SKU 그룹 관련
  skuGroups: ['inventory', 'sku-groups'] as const,
  skuGroup: (id: string) => ['inventory', 'sku-groups', id] as const,
  skuGroupMembers: (id: string) => ['inventory', 'sku-groups', id, 'members'] as const,
  ungroupedSkus: (params?: { limit?: number; offset?: number }) =>
    ['inventory', 'sku-groups', 'ungrouped', params] as const,

  // 재고 예약 관련
  reservationsBySku: (skuId: string, warehouseId?: string) =>
    ['inventory', 'reservations', 'by-sku', skuId, warehouseId] as const,
  reservationsByTarget: (targetType: ReservationTargetType, targetId: string) =>
    ['inventory', 'reservations', 'by-target', targetType, targetId] as const,
  reservationSummary: (warehouseId: string) =>
    ['inventory', 'reservations', 'summary', warehouseId] as const,

  // 재고 실사 관련
  stocktakingSessions: (query?: StocktakingSessionQuery) =>
    ['inventory', 'stocktaking', 'sessions', query] as const,
  stocktakingSession: (id: string) => ['inventory', 'stocktaking', 'sessions', id] as const,
  stocktakingVariances: (sessionId: string) =>
    ['inventory', 'stocktaking', 'sessions', sessionId, 'variances'] as const,

  // 발주 관련
  /**
   * 발주 쿼리 서브트리 전체. 무효화에 쓴다.
   *
   * `purchaseOrders()` 를 무효화 필터로 쓰면 안 된다 — 인자 없이 부르면
   * ['purchase-orders', undefined] 가 되고, TanStack Query 의 partialMatchKey 는
   * 접두사 일치가 아니라 위치별 비교라 typeof {} !== typeof undefined 에서 걸려
   * 필터가 실린 목록 쿼리를 하나도 못 잡는다(query-core 5.90.5 실측).
   */
  purchaseOrdersRoot: ['purchase-orders'] as const,
  purchaseOrders: (filters?: PurchaseOrderListFilters) =>
    ['purchase-orders', filters] as const,
  purchaseOrder: (id: string) => ['purchase-orders', id] as const,
  purchaseOrderCart: () => ['purchase-orders', 'cart'] as const,
  reorderSuggestions: (warehouseId?: string) =>
    ['purchase-orders', 'reorder', warehouseId] as const,

  // 회수(Returns) 관련
  returns: (filters?: ReturnFiltersDto) => ['inventory', 'returns', filters] as const,
  return: (id: string) => ['inventory', 'returns', id] as const,

  // 즉시 이동(Movement) 관련
  movementJob: (jobId: string) => ['inventory', 'movement', 'jobs', jobId] as const,
  movementHistory: (query?: MovementHistoryQuery) =>
    ['inventory', 'movement', 'history', query] as const,
} as const;
