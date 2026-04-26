// src/lib/api/domains/inventory/index.ts
// Inventory 도메인 통합 클라이언트

// 기능별 클라이언트들 import
import { stocksClient } from './stocks.client';
import { skusClient } from './skus.client';
import { warehousesClient } from './warehouses.client';
import { matchingClient } from '../matching/matching.client';

// 자동재고매칭용 클라이언트들 직접 생성
import { ALMONDYOUNG_API_BASE_URL } from '@/const';
import { client } from '../../client';
import type {
  WarehouseDto,
  SupplierDto,
  SupplierSearchQuery,
  SupplierSearchResponseDto,
  HolderDto,
  HolderSearchQuery,
  HolderSearchResponseDto,
  InventoryOptionDto,
  CreateInventoryMatchingDto,
  InventoryMatchingResponseDto,
} from '../../../types/dto/inventory';

function buildQueryString(query: Record<string, any>): string {
  const params = new URLSearchParams();
  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      params.append(key, String(value));
    }
  });
  return params.toString();
}

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

const supplierApi = {
  list: async (
    query?: SupplierSearchQuery
  ): Promise<SupplierSearchResponseDto> => {
    const response = await client.get(
      `${ALMONDYOUNG_API_BASE_URL}/suppliers?${buildQueryString(query || {})}`
    );
    return response.data;
  },
  search: async (
    query: string,
    page = 1,
    limit = 10
  ): Promise<SupplierSearchResponseDto> => {
    const response = await client.get(
      `${ALMONDYOUNG_API_BASE_URL}/suppliers/search?q=${encodeURIComponent(query)}&page=${page}&limit=${limit}`
    );
    return response.data;
  },
  get: async (id: string): Promise<SupplierDto> => {
    const response = await client.get(`${ALMONDYOUNG_API_BASE_URL}/suppliers/${id}`);
    return response.data;
  },
  create: async (
    data: Omit<SupplierDto, 'id' | 'createdAt' | 'updatedAt'>
  ): Promise<SupplierDto> => {
    const response = await client.post(`${ALMONDYOUNG_API_BASE_URL}/suppliers`, data);
    return response.data;
  },
};

const holderApi = {
  list: async (query?: HolderSearchQuery): Promise<HolderSearchResponseDto> => {
    const response = await client.get(
      `${ALMONDYOUNG_API_BASE_URL}/holders?${buildQueryString(query || {})}`
    );
    return response.data;
  },
  search: async (
    query: string,
    isOurAsset?: boolean,
    page = 1,
    limit = 10
  ): Promise<HolderSearchResponseDto> => {
    const params = new URLSearchParams({
      q: query,
      page: String(page),
      limit: String(limit),
    });
    if (isOurAsset !== undefined) {
      params.append('isOurAsset', String(isOurAsset));
    }

    const response = await client.get(
      `${ALMONDYOUNG_API_BASE_URL}/holders/search?${params.toString()}`
    );
    return response.data;
  },
  get: async (id: string): Promise<HolderDto> => {
    const response = await client.get(`${ALMONDYOUNG_API_BASE_URL}/holders/${id}`);
    return response.data;
  },
  create: async (
    data: Omit<HolderDto, 'id' | 'createdAt' | 'updatedAt'>
  ): Promise<HolderDto> => {
    const response = await client.post(`${ALMONDYOUNG_API_BASE_URL}/holders`, data);
    return response.data;
  },
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
    return response.data.data;
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
    suppliers: supplierApi,
    holders: holderApi,
    matchings: inventoryMatchingApi,
  },
};

// 개별 클라이언트들도 export (하위 호환성)
export { stocksClient } from './stocks.client';
export { skusClient } from './skus.client';
export { warehousesClient } from './warehouses.client';
export { matchingClient } from '../matching/matching.client';

// 자동재고매칭 클라이언트 export
export const inventoryMatchingClient = {
  warehouses: warehouseApi,
  suppliers: supplierApi,
  holders: holderApi,
  matchings: inventoryMatchingApi,
  skus: skusClient,
};
