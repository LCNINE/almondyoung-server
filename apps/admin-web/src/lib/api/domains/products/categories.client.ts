'use client';

// src/lib/api/domains/products/categories.client.ts

import { ALMONDYOUNG_API_BASE_URL } from '@/const';
import type { UUID } from '../../../types/dto/common';
import type {
  CategoryDto,
  CategoryPathResponseDto,
  CategoryTreeResponseDto,
  CreateCategoryDto,
  UpdateCategoryDto,
} from '../../../types/dto/products';
import { client } from '../../client';

export const categoriesClient = {
  create: async (dto: CreateCategoryDto): Promise<CategoryDto> => {
    const response = await client.post(`${ALMONDYOUNG_API_BASE_URL}/categories`, dto);
    return response.data;
  },

  getTree: async (maxDepth?: number): Promise<CategoryTreeResponseDto> => {
    const params = maxDepth ? { maxDepth } : {};
    const response = await client.get(`${ALMONDYOUNG_API_BASE_URL}/categories`, { params });
    return response.data;
  },

  get: async (id: UUID): Promise<CategoryDto> => {
    const response = await client.get(`${ALMONDYOUNG_API_BASE_URL}/categories/${id}`);
    return response.data;
  },

  update: async (id: UUID, dto: UpdateCategoryDto): Promise<CategoryDto> => {
    const response = await client.put(`${ALMONDYOUNG_API_BASE_URL}/categories/${id}`, dto);
    return response.data;
  },

  delete: async (id: UUID, moveProductsTo?: UUID): Promise<void> => {
    const params = moveProductsTo ? { moveProductsTo } : {};
    await client.delete(`${ALMONDYOUNG_API_BASE_URL}/categories/${id}`, { params });
  },

  getChildren: async (id: UUID): Promise<CategoryDto[]> => {
    const response = await client.get(
      `${ALMONDYOUNG_API_BASE_URL}/categories/${id}/children`
    );
    return response.data;
  },

  getPath: async (id: UUID): Promise<CategoryPathResponseDto> => {
    const response = await client.get(`${ALMONDYOUNG_API_BASE_URL}/categories/${id}/path`);
    return response.data;
  },

  move: async (id: UUID, newParentId?: UUID | null): Promise<CategoryDto> => {
    const params: Record<string, string> = {};
    if (newParentId !== undefined) {
      params.newParentId = newParentId ?? 'null';
    }
    const response = await client.put(
      `${ALMONDYOUNG_API_BASE_URL}/categories/${id}/move`,
      {},
      { params }
    );
    return response.data;
  },
};
