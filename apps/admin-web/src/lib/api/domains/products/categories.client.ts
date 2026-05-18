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

  getTree: async (options?: {
    maxDepth?: number;
    includeInactive?: boolean;
  }): Promise<CategoryTreeResponseDto> => {
    const params: Record<string, string | number> = {};
    if (options?.maxDepth !== undefined) params.maxDepth = options.maxDepth;
    if (options?.includeInactive) params.includeInactive = 'true';
    const response = await client.get(`${ALMONDYOUNG_API_BASE_URL}/categories`, { params });
    return response.data;
  },

  reorder: async (parentId: UUID | null, categoryIds: UUID[]): Promise<void> => {
    await client.post(`${ALMONDYOUNG_API_BASE_URL}/categories/reorder`, {
      parentId,
      categoryIds,
    });
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
