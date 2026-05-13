'use client';

import { ALMONDYOUNG_API_BASE_URL } from '@/const';
import { client } from '../../client';
import type {
  SupplierDto,
  SupplierListResponseDto,
  SupplierFilterOptionsResponseDto,
  SupplierFiltersDto,
  CreateSupplierRequest,
  UpdateSupplierRequest,
} from '../../../types/dto/inventory';

const BASE = `${ALMONDYOUNG_API_BASE_URL}/suppliers`;

function buildQueryString(query: Record<string, unknown>): string {
  const params = new URLSearchParams();
  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      params.append(key, String(value));
    }
  });
  return params.toString();
}

export const suppliersClient = {
  list: async (filters?: SupplierFiltersDto): Promise<SupplierListResponseDto> => {
    const response = await client.get(
      `${BASE}?${buildQueryString((filters ?? {}) as Record<string, unknown>)}`
    );
    return response.data;
  },

  filterOptions: async (): Promise<SupplierFilterOptionsResponseDto> => {
    const response = await client.get(`${BASE}?type=filter-options`);
    return response.data;
  },

  get: async (id: string): Promise<SupplierDto> => {
    const response = await client.get(`${BASE}/${encodeURIComponent(id)}`);
    return response.data;
  },

  create: async (data: CreateSupplierRequest): Promise<SupplierDto> => {
    const response = await client.post(BASE, data);
    return response.data;
  },

  update: async (id: string, data: UpdateSupplierRequest): Promise<SupplierDto> => {
    const response = await client.put(`${BASE}/${encodeURIComponent(id)}`, data);
    return response.data;
  },

  delete: async (id: string): Promise<void> => {
    await client.delete(`${BASE}/${encodeURIComponent(id)}`);
  },
};
