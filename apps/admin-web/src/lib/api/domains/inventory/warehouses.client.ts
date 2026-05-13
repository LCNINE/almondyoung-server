// src/lib/api/domains/inventory/warehouses.client.ts
// 창고 관련 API 클라이언트

import { ALMONDYOUNG_API_BASE_URL } from '@/const';
import { client } from '../../client';
import type {
  CreateWarehouseDto,
  UpdateWarehouseDto,
  WarehouseDto,
  WarehouseStockSummaryDto,
} from '../../../types/dto/inventory';

export const warehousesClient = {
  createWarehouse: async (data: CreateWarehouseDto): Promise<WarehouseDto> => {
    const response = await client.post(
      `${ALMONDYOUNG_API_BASE_URL}/inventory/warehouses`,
      data
    );
    return response.data;
  },

  getWarehouses: async (): Promise<WarehouseDto[]> => {
    const response = await client.get(`${ALMONDYOUNG_API_BASE_URL}/inventory/warehouses`);
    return response.data;
  },

  getWarehouse: async (id: string): Promise<WarehouseDto> => {
    const response = await client.get(
      `${ALMONDYOUNG_API_BASE_URL}/inventory/warehouses/${encodeURIComponent(id)}`
    );
    return response.data;
  },

  updateWarehouse: async (
    id: string,
    data: UpdateWarehouseDto
  ): Promise<WarehouseDto> => {
    const response = await client.patch(
      `${ALMONDYOUNG_API_BASE_URL}/inventory/warehouses/${encodeURIComponent(id)}`,
      data
    );
    return response.data;
  },

  deleteWarehouse: async (id: string): Promise<void> => {
    await client.delete(
      `${ALMONDYOUNG_API_BASE_URL}/inventory/warehouses/${encodeURIComponent(id)}`
    );
  },

  getWarehouseStockSummary: async (id: string): Promise<WarehouseStockSummaryDto> => {
    const response = await client.get(
      `${ALMONDYOUNG_API_BASE_URL}/inventory/warehouses/${encodeURIComponent(id)}/summary`
    );
    return response.data;
  },
};
