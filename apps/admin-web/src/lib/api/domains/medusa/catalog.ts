'use client';

import { MEDUSA_BASE_URL } from '@/const';
import { client } from '../../client';

export interface MedusaProductItem {
  id: string;
  title: string;
  thumbnail?: string | null;
}

export interface MedusaCategoryItem {
  id: string;
  name: string;
}

export interface MedusaCollectionItem {
  id: string;
  title: string;
}

export const medusaCatalogApi = {
  searchProducts: async (q?: string) => {
    const p = new URLSearchParams({ limit: '20' });
    if (q) p.append('q', q);
    const res = await client.get<{ products: MedusaProductItem[]; count: number }>(
      `${MEDUSA_BASE_URL}/admin/products?${p}`
    );
    return res.data;
  },

  listCategories: async (q?: string) => {
    const p = new URLSearchParams({ limit: '50' });
    if (q) p.append('q', q);
    const res = await client.get<{ product_categories: MedusaCategoryItem[]; count: number }>(
      `${MEDUSA_BASE_URL}/admin/product-categories?${p}`
    );
    return res.data;
  },

  listCollections: async (q?: string) => {
    const p = new URLSearchParams({ limit: '50' });
    if (q) p.append('title', q);
    const res = await client.get<{ collections: MedusaCollectionItem[]; count: number }>(
      `${MEDUSA_BASE_URL}/admin/collections?${p}`
    );
    return res.data;
  },
};
