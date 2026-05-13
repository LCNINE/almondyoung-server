import { ALMONDYOUNG_API_BASE_URL } from '@/const';
import { client } from '../../client';
import type {
  SupplierCategoryDto,
  CreateSupplierCategoryRequest,
  UpdateSupplierCategoryRequest,
} from '../../../types/dto/inventory';

const BASE = `${ALMONDYOUNG_API_BASE_URL}/supplier-categories`;

export const supplierCategoriesClient = {
  list: async (): Promise<SupplierCategoryDto[]> => {
    const response = await client.get(BASE);
    return response.data;
  },

  get: async (id: string): Promise<SupplierCategoryDto> => {
    const response = await client.get(`${BASE}/${encodeURIComponent(id)}`);
    return response.data;
  },

  create: async (data: CreateSupplierCategoryRequest): Promise<SupplierCategoryDto> => {
    const response = await client.post(BASE, data);
    return response.data;
  },

  update: async (
    id: string,
    data: UpdateSupplierCategoryRequest
  ): Promise<SupplierCategoryDto> => {
    const response = await client.put(`${BASE}/${encodeURIComponent(id)}`, data);
    return response.data;
  },

  delete: async (id: string): Promise<void> => {
    await client.delete(`${BASE}/${encodeURIComponent(id)}`);
  },
};
