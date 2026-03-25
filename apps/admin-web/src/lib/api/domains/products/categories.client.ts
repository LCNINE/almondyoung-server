// src/lib/api/domains/products/categories.client.ts

import { PIM_BASE_URL } from '@/const';
import type { UUID } from '../../../types/dto/common';
import type {
  CategoryDto,
  CategoryPathResponseDto,
  CategoryTreeResponseDto,
  CreateCategoryDto,
  MoveCategoryDto,
  UpdateCategoryDto,
} from '../../../types/dto/products';
import { client } from '../../client';

export const categoriesClient = {
  create: async (dto: CreateCategoryDto): Promise<CategoryDto> => {
    const response = await client.post(`${PIM_BASE_URL}/categories`, dto);
    return response.data;
  },

  list: async (maxDepth?: number): Promise<CategoryTreeResponseDto> => {
    const url = maxDepth ? `/categories?maxDepth=${maxDepth}` : '/categories';
    const response = await client.get(`${PIM_BASE_URL}${url}`);
    return response.data;
  },

  get: async (id: UUID): Promise<CategoryDto> => {
    const response = await client.get(`${PIM_BASE_URL}/categories/${id}`);
    return response.data;
  },

  update: async (id: UUID, dto: UpdateCategoryDto): Promise<CategoryDto> => {
    const response = await client.put(`${PIM_BASE_URL}/categories/${id}`, dto);
    return response.data;
  },

  remove: async (id: UUID, moveProductsTo?: UUID): Promise<void> => {
    const url = moveProductsTo
      ? `/categories/${id}?moveProductsTo=${moveProductsTo}`
      : `/categories/${id}`;
    await client.delete(`${PIM_BASE_URL}${url}`);
  },

  children: async (id: UUID): Promise<CategoryDto[]> => {
    const response = await client.get(
      `${PIM_BASE_URL}/categories/${id}/children`
    );
    return response.data;
  },

  path: async (id: UUID): Promise<CategoryPathResponseDto> => {
    const response = await client.get(`${PIM_BASE_URL}/categories/${id}/path`);
    return response.data;
  },

  move: async (id: UUID, newParentId?: UUID): Promise<CategoryDto> => {
    const url = newParentId
      ? `/categories/${id}/move?newParentId=${newParentId}`
      : `/categories/${id}/move`;
    const response = await client.put(`${PIM_BASE_URL}${url}`);
    return response.data;
  },
};

/**
 * 카테고리 트리 조회
 * GET /categories
 */
export const getCategoryTree = async (
  maxDepth?: number
): Promise<CategoryTreeResponseDto> => {
  const params = maxDepth ? { maxDepth } : {};
  const response = await client.get(`${PIM_BASE_URL}/categories`, { params });
  return response.data;
};

/**
 * 카테고리 수정
 * PUT /categories/{id}
 */
export const updateCategory = async (
  id: string,
  data: UpdateCategoryDto
): Promise<CategoryDto> => {
  const response = await client.put(`${PIM_BASE_URL}/categories/${id}`, data);
  return response.data;
};

/**
 * 카테고리 삭제
 * DELETE /categories/{id}
 */
export const deleteCategory = async (
  id: string,
  moveProductsTo?: string
): Promise<void> => {
  const params = moveProductsTo ? { moveProductsTo } : {};
  await client.delete(`${PIM_BASE_URL}/categories/${id}`, { params });
};

/**
 * 카테고리 상세 조회
 * GET /categories/{id}
 */
export const getCategory = async (id: string): Promise<CategoryDto> => {
  const response = await client.get(`${PIM_BASE_URL}/categories/${id}`);
  return response.data;
};

/**
 * 하위 카테고리 조회
 * GET /categories/{id}/children
 */
export const getCategoryChildren = async (
  id: string
): Promise<CategoryDto[]> => {
  const response = await client.get(
    `${PIM_BASE_URL}/categories/${id}/children`
  );
  return response.data;
};

/**
 * 카테고리 경로 조회
 * GET /categories/{id}/path
 */
export const getCategoryPath = async (
  id: string
): Promise<CategoryPathResponseDto> => {
  const response = await client.get(`${PIM_BASE_URL}/categories/${id}/path`);
  return response.data;
};

/**
 * 카테고리 이동
 * PUT /categories/{id}/move
 */
export const moveCategory = async (
  id: string,
  data: MoveCategoryDto
): Promise<CategoryDto> => {
  const params = data.newParentId ? { newParentId: data.newParentId } : {};
  const response = await client.put(
    `${PIM_BASE_URL}/categories/${id}/move`,
    {},
    { params }
  );
  return response.data;
};

// 카테고리 클라이언트 객체
export const categories = {
  create: categoriesClient.create,
  getTree: categoriesClient.list,
  update: categoriesClient.update,
  delete: categoriesClient.remove,
  get: categoriesClient.get,
  getChildren: categoriesClient.children,
  getPath: categoriesClient.path,
  move: categoriesClient.move,
};
