// src/lib/services/inventory/query-keys.ts
// 재고 관련 쿼리 키 팩토리

export const inventoryQueryKeys = {
    // 재고 관련
    stocks: ['stocks'] as const,
    stockSummary: ['stocks', 'summary'] as const,
    skuTotalStock: (sku: string) => ['stocks', 'sku', sku, 'total'] as const,
    skuWarehouseStock: (sku: string, warehouseId: string) => ['stocks', 'sku', sku, 'warehouse', warehouseId] as const,
    stockHistory: (sku: string) => ['stocks', 'history', sku] as const,

    // SKU 관련
    skus: (query?: any) => ['skus', query] as const,
    sku: (id: string) => ['skus', id] as const,
    skuSearch: (query: string, page: number, limit: number) => ['skus', 'search', query, page, limit] as const,
    skuStockSummary: (sku: string) => ['skus', sku, 'stock-summary'] as const,

    // 창고 관련
    warehouses: ['warehouses'] as const,
    warehouse: (id: string) => ['warehouses', id] as const,
    warehouseStockSummary: (warehouseId: string) => ['warehouses', warehouseId, 'stock-summary'] as const,

    // 입고 관련
    inbounds: ['inbounds'] as const,
    inbound: (id: string) => ['inbounds', id] as const,
    inboundItems: (inboundId: string) => ['inbounds', inboundId, 'items'] as const,

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
    suppliers: (query?: any) => ['suppliers', query] as const,
    supplierSearch: (query: string, page: number, limit: number) =>
        ['suppliers', 'search', query, page, limit] as const,
    supplier: (id: string) => ['suppliers', id] as const,

    // 재고소유 관련
    holders: (query?: any) => ['holders', query] as const,
    holderSearch: (query: string, isOurAsset?: boolean, page: number = 1, limit: number = 10) =>
        ['holders', 'search', query, isOurAsset, page, limit] as const,
    holder: (id: string) => ['holders', id] as const,
} as const;