'use client';

import { MEDUSA_BASE_URL } from '@/const';
import { client } from '../../client';

export interface MedusaProductItem {
  id: string;
  title: string;
  thumbnail?: string | null;
  status?: string;
  /** 타임세일 선택 화면이 "이 상품이 이미 세일 중인가" 를 variant id 로 판별한다. */
  variants?: Array<{ id: string; sku?: string | null }>;
}

export interface MedusaCategoryItem {
  id: string;
  name: string;
  parent_category_id?: string | null;
}

export interface MedusaCollectionItem {
  id: string;
  title: string;
}

const readRequest = { timeout: 15_000, retry: 0 };

export const medusaCatalogApi = {
  searchProducts: async (
    q?: string,
    options: { limit?: number; offset?: number; categoryId?: string } = {}
  ) => {
    const p = new URLSearchParams({
      limit: String(options.limit ?? 20),
      offset: String(options.offset ?? 0),
      fields: 'id,title,status,thumbnail,variants.id,variants.sku',
    });
    if (q) p.append('q', q);
    if (options.categoryId) p.append('category_id[]', options.categoryId);
    const res = await client.get<{
      products: MedusaProductItem[];
      count: number;
    }>(`${MEDUSA_BASE_URL}/admin/products?${p}`, readRequest);
    return res.data;
  },

  listCategories: async (
    q?: string,
    options: { limit?: number; offset?: number } = {}
  ) => {
    const p = new URLSearchParams({
      limit: String(options.limit ?? 50),
      offset: String(options.offset ?? 0),
      fields: 'id,name,parent_category_id',
    });
    if (q) p.append('q', q);
    const res = await client.get<{
      product_categories: MedusaCategoryItem[];
      count: number;
    }>(`${MEDUSA_BASE_URL}/admin/product-categories?${p}`, readRequest);
    return res.data;
  },

  listCollections: async (q?: string) => {
    const p = new URLSearchParams({ limit: '50' });
    if (q) p.append('title', q);
    const res = await client.get<{
      collections: MedusaCollectionItem[];
      count: number;
    }>(`${MEDUSA_BASE_URL}/admin/collections?${p}`);
    return res.data;
  },
};
