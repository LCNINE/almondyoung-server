import { ALMONDYOUNG_API_BASE_URL } from '@/const';
import { client } from '../../client';
import type {
  SupplierCategoryDto,
  CreateSupplierCategoryRequest,
  UpdateSupplierCategoryRequest,
} from '../../../types/dto/inventory';

const BASE = `${ALMONDYOUNG_API_BASE_URL}/supplier-categories`;

export const listSupplierCategories = async (): Promise<SupplierCategoryDto[]> => {
  const response = await client.get(BASE);
  return response.data;
};

export const getSupplierCategory = async (id: string): Promise<SupplierCategoryDto> => {
  const response = await client.get(`${BASE}/${encodeURIComponent(id)}`);
  return response.data;
};

export const createSupplierCategory = async (
  data: CreateSupplierCategoryRequest
): Promise<SupplierCategoryDto> => {
  const response = await client.post(BASE, data);
  return response.data;
};

export const updateSupplierCategory = async (
  id: string,
  data: UpdateSupplierCategoryRequest
): Promise<SupplierCategoryDto> => {
  const response = await client.put(`${BASE}/${encodeURIComponent(id)}`, data);
  return response.data;
};

export const deleteSupplierCategory = async (id: string): Promise<void> => {
  await client.delete(`${BASE}/${encodeURIComponent(id)}`);
};

export const supplierCategoriesClient = {
  list: listSupplierCategories,
  get: getSupplierCategory,
  create: createSupplierCategory,
  update: updateSupplierCategory,
  delete: deleteSupplierCategory,
};
