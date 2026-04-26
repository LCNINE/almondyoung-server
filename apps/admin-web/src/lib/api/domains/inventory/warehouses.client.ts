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

// 창고 생성
export const createWarehouse = async (
  data: CreateWarehouseDto
): Promise<WarehouseDto> => {
  const response = await client.post(
    `${ALMONDYOUNG_API_BASE_URL}/inventory/warehouses`,
    data
  );
  return response.data;
};

// 모든 창고 목록 조회
export const getWarehouses = async (): Promise<WarehouseDto[]> => {
  const response = await client.get(`${ALMONDYOUNG_API_BASE_URL}/inventory/warehouses`);
  return response.data;
};

// 특정 창고 조회
export const getWarehouse = async (id: string): Promise<WarehouseDto> => {
  const response = await client.get(
    `${ALMONDYOUNG_API_BASE_URL}/inventory/warehouses/${encodeURIComponent(id)}`
  );
  return response.data;
};

// 창고 정보 수정 (부분 수정)
export const updateWarehouse = async (
  id: string,
  data: UpdateWarehouseDto
): Promise<WarehouseDto> => {
  const response = await client.patch(
    `${ALMONDYOUNG_API_BASE_URL}/inventory/warehouses/${encodeURIComponent(id)}`,
    data
  );
  return response.data;
};

// 창고 삭제
export const deleteWarehouse = async (id: string): Promise<void> => {
  await client.delete(
    `${ALMONDYOUNG_API_BASE_URL}/inventory/warehouses/${encodeURIComponent(id)}`
  );
};

// 창고별 재고 요약 조회
export const getWarehouseStockSummary = async (
  id: string
): Promise<WarehouseStockSummaryDto> => {
  const response = await client.get(
    `${ALMONDYOUNG_API_BASE_URL}/inventory/warehouses/${encodeURIComponent(id)}/summary`
  );
  return response.data;
};

// 창고 관련 클라이언트 객체
export const warehousesClient = {
  createWarehouse,
  getWarehouses,
  getWarehouse,
  updateWarehouse,
  deleteWarehouse,
  getWarehouseStockSummary,
};
