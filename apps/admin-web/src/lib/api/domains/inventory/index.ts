// src/lib/api/domains/inventory/index.ts
// Inventory 도메인 통합 클라이언트

// 기능별 클라이언트들 import
import { stocksClient } from './stocks.client';
import { skusClient } from './skus.client';
import { warehousesClient } from './warehouses.client';
import { matchingClient } from '../matching/matching.client';
import { suppliersClient } from './suppliers.client';
import { holdersClient } from './holders.client';

// 자동재고매칭용 클라이언트들 직접 생성
import { ALMONDYOUNG_API_BASE_URL } from '@/const';
import { client } from '../../client';
import type {
  WarehouseDto,
  HolderSearchQuery,
  HolderSearchResponseDto,
  InventoryOptionDto,
  CreateInventoryMatchingDto,
  InventoryMatchingResponseDto,
} from '../../../types/dto/inventory';

// 자동재고매칭용 API들
const warehouseApi = {
  list: async (): Promise<WarehouseDto[]> => {
    const response = await client.get(`${ALMONDYOUNG_API_BASE_URL}/inventory/warehouses`);
    return response.data;
  },
  get: async (id: string): Promise<WarehouseDto> => {
    const response = await client.get(`${ALMONDYOUNG_API_BASE_URL}/inventory/warehouses/${id}`);
    return response.data;
  },
};

// holderApi: holdersClient로 위임. search는 서버에 없는 경로였으므로 list({ search })로 매핑.
const holderApi = {
  list: (query?: HolderSearchQuery): Promise<HolderSearchResponseDto> =>
    holdersClient.list(query),
  search: (
    query: string,
    isOurAsset?: boolean,
    page = 1,
    limit = 10
  ): Promise<HolderSearchResponseDto> =>
    holdersClient.list({ search: query, isOurAsset, page, limit }),
  get: holdersClient.get,
  create: (data: { name: string; isOurAsset: boolean }) => holdersClient.create(data),
};

const inventoryMatchingApi = {
  create: async (
    data: CreateInventoryMatchingDto
  ): Promise<InventoryMatchingResponseDto> => {
    const response = await client.post(
      `${ALMONDYOUNG_API_BASE_URL}/inventory-matching`,
      data
    );
    return response.data;
  },
  list: async (): Promise<InventoryMatchingResponseDto[]> => {
    const response = await client.get(`${ALMONDYOUNG_API_BASE_URL}/inventory-matching`);
    return response.data;
  },
  get: async (id: string): Promise<InventoryMatchingResponseDto> => {
    const response = await client.get(
      `${ALMONDYOUNG_API_BASE_URL}/inventory-matching/${id}`
    );
    return response.data;
  },
};

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

  // 자동재고매칭 관련
  inventoryMatching: {
    warehouses: warehouseApi,
    holders: holderApi,
    matchings: inventoryMatchingApi,
  },
};

// 개별 클라이언트들도 export (하위 호환성)
export { stocksClient } from './stocks.client';
export { skusClient } from './skus.client';
export { warehousesClient } from './warehouses.client';
export { matchingClient } from '../matching/matching.client';
export { transfersClient } from './transfers.client';
export { reservationsClient } from './reservations.client';
export { stocktakingClient } from './stocktaking.client';
export { suppliersClient } from './suppliers.client';
export { supplierCategoriesClient } from './supplier-categories.client';
export { holdersClient } from './holders.client';
export { locationsClient } from './locations.client';
export { purchaseOrdersClient } from './purchase-orders.client';

// 자동재고매칭 클라이언트 export
export const inventoryMatchingClient = {
  warehouses: warehouseApi,
  suppliers: suppliersClient,
  holders: holderApi,
  matchings: inventoryMatchingApi,
  skus: skusClient,
};
