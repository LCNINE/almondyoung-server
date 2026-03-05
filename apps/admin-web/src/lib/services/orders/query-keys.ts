// src/lib/services/orders/query-keys.ts
// 주문 관련 쿼리 키 팩토리

export const orderQueryKeys = {
    // 주문 관련
    orders: ['orders'] as const,
    order: (id: string) => ['orders', id] as const,
    orderItems: (orderId: string) => ['orders', orderId, 'items'] as const,

    // 출고 관련
    outboundBatches: ['outbound-batches'] as const,
    outboundBatch: (id: string) => ['outbound-batches', id] as const,

    // 피킹 관련
    pickings: ['pickings'] as const,
    picking: (id: string) => ['pickings', id] as const,
    pickingList: (orderId: string) => ['pickings', 'list', orderId] as const,

    // 이행 관련
    fulfillments: ['fulfillments'] as const,
    fulfillment: (id: string) => ['fulfillments', id] as const,
    fulfillmentOrders: ['fulfillment-orders'] as const,
    fulfillmentOrder: (id: string) => ['fulfillment-orders', id] as const,

    // 매칭 관련 (WMS API 스펙 기반)
    matchings: ['matchings'] as const,
    matchingLists: () => [...orderQueryKeys.matchings, 'list'] as const,
    matchingList: (query: Record<string, any>) => [...orderQueryKeys.matchingLists(), query] as const,
    matchingDetails: () => [...orderQueryKeys.matchings, 'detail'] as const,
    matchingDetail: (id: string) => [...orderQueryKeys.matchingDetails(), id] as const,
    variantMatchings: () => [...orderQueryKeys.matchings, 'variant'] as const,
    variantMatching: (variantId: string) => [...orderQueryKeys.variantMatchings(), variantId] as const,
    stockPolicies: () => [...orderQueryKeys.matchings, 'stock-policy'] as const,
    stockPolicy: (variantId: string) => [...orderQueryKeys.stockPolicies(), variantId] as const,
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

    // 송장 관련
    invoices: ['invoices'] as const,
    invoice: (id: string) => ['invoices', id] as const,

    // 직접 배송 관련
    directShips: ['direct-ships'] as const,
    directShip: (id: string) => ['direct-ships', id] as const,

    // 메트릭스 관련
    metrics: ['metrics'] as const,
    orderMetrics: ['metrics', 'orders'] as const,
    fulfillmentMetrics: ['metrics', 'fulfillments'] as const,
} as const;