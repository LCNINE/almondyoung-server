'use client';

// src/lib/api/domains/inventory/index.ts
// Inventory 도메인 통합 클라이언트

// 기능별 클라이언트들 import
import { stocksClient } from './stocks.client';
import { skusClient } from './skus.client';
import { warehousesClient } from './warehouses.client';
import { matchingClient } from '../matching/matching.client';
import { suppliersClient } from './suppliers.client';
import { holdersClient } from './holders.client';

// 통합 inventory 클라이언트 객체
export const inventory = {
  // 재고 관련
  stocks: stocksClient,

  // SKU 관련
  skus: skusClient,

  // 창고 관련
  warehouses: warehousesClient,

  // 매칭 관련 (domains/matching 으로 이전됨, 하위 호환성 유지)
  matching: matchingClient,
};

// 개별 클라이언트들도 export (하위 호환성)
export { stocksClient } from './stocks.client';
export { skusClient } from './skus.client';
export { warehousesClient } from './warehouses.client';
export { matchingClient } from '../matching/matching.client';
export { reservationsClient } from './reservations.client';
export { stocktakingClient } from './stocktaking.client';
export { suppliersClient } from './suppliers.client';
export { supplierCategoriesClient } from './supplier-categories.client';
export { holdersClient } from './holders.client';
export { locationsClient } from './locations.client';
export { purchaseOrdersClient } from './purchase-orders.client';
