'use client';

import { MEDUSA_BASE_URL } from '@/const';
import { client } from '../../client';

export interface MedusaPriceList {
  id: string;
  title: string;
  description: string | null;
  type: 'sale' | 'override';
  status: 'active' | 'draft';
  starts_at: string | null;
  ends_at: string | null;
  rules?: Record<string, string[]>;
  prices?: MedusaPriceListPrice[];
}

export interface MedusaPriceListPrice {
  id: string;
  amount: number;
  currency_code: string;
  variant_id?: string;
}

export interface CreatePriceListPayload {
  title: string;
  description: string;
  type: 'sale';
  status: 'active';
  starts_at: string;
  ends_at: string;
  rules: Record<string, string[]>;
  prices: Array<{ amount: number; currency_code: string; variant_id: string }>;
}

export interface UpdatePriceListPayload {
  title?: string;
  status?: 'active' | 'draft';
  starts_at?: string;
  ends_at?: string;
}

const LIST_FIELDS = 'id,title,description,type,status,starts_at,ends_at';

export const medusaPriceListsApi = {
  /** 상시 리스트(Membership/Tiered)까지 전부 돌아온다. 타임세일 골라내기는 isTimeSalePriceList 가 한다. */
  list: async () => {
    const params = new URLSearchParams({ limit: '200', fields: LIST_FIELDS });
    const res = await client.get<{ price_lists: MedusaPriceList[]; count: number }>(
      `${MEDUSA_BASE_URL}/admin/price-lists?${params}`
    );
    return res.data;
  },

  get: async (id: string) => {
    const res = await client.get<{ price_list: MedusaPriceList }>(
      `${MEDUSA_BASE_URL}/admin/price-lists/${id}?fields=${LIST_FIELDS},*prices`
    );
    return res.data.price_list;
  },

  create: async (payload: CreatePriceListPayload) => {
    const res = await client.post<{ price_list: MedusaPriceList }>(
      `${MEDUSA_BASE_URL}/admin/price-lists`,
      payload
    );
    return res.data.price_list;
  },

  update: async (id: string, payload: UpdatePriceListPayload) => {
    const res = await client.post<{ price_list: MedusaPriceList }>(
      `${MEDUSA_BASE_URL}/admin/price-lists/${id}`,
      payload
    );
    return res.data.price_list;
  },

  remove: async (id: string) => {
    await client.delete(`${MEDUSA_BASE_URL}/admin/price-lists/${id}`);
  },
};

export interface MedusaVariantForPricing {
  id: string;
  title: string;
  metadata?: Record<string, unknown> | null;
  prices?: Array<{ amount: number; currency_code: string; price_list_id?: string | null }>;
}

export interface MedusaProductForPricing {
  id: string;
  title: string;
  thumbnail?: string | null;
  variants: MedusaVariantForPricing[];
}

export const medusaProductPricingApi = {
  /** 세일에 올릴 상품의 variant 별 현재가. 정가는 price_list 없는 가격 행, 멤버십가는 별도 리스트다. */
  getProducts: async (productIds: string[]) => {
    if (productIds.length === 0) return [] as MedusaProductForPricing[];

    const params = new URLSearchParams({
      limit: String(productIds.length),
      fields: 'id,title,thumbnail,*variants,*variants.prices',
    });
    for (const id of productIds) params.append('id', id);

    const res = await client.get<{ products: MedusaProductForPricing[] }>(
      `${MEDUSA_BASE_URL}/admin/products?${params}`
    );
    return res.data.products;
  },
};
