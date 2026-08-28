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
  /** `*prices.price_set.variant` 를 펼쳤을 때만 실린다. 응답에 variant_id 가 없을 때의 출처. */
  price_set?: { variant?: { id: string; product_id?: string } | null } | null;
}

/** 이 가격이 걸린 variant. Medusa 버전에 따라 실리는 자리가 달라 둘 다 본다. */
export const priceVariantId = (price: MedusaPriceListPrice): string | undefined =>
  price.variant_id ?? price.price_set?.variant?.id;

/** 이 가격이 걸린 상품. 편집 화면이 "어떤 상품이 이 세일에 있나" 를 복원할 때 쓴다. */
export const priceProductId = (price: MedusaPriceListPrice): string | undefined =>
  price.price_set?.variant?.product_id;

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

export interface BatchPricesPayload {
  create?: Array<{ amount: number; currency_code: string; variant_id: string }>;
  update?: Array<{ id: string; amount: number }>;
  delete?: string[];
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
      // price 응답에 variant_id 를 실으려면 price_set.variant 까지 펼쳐야 한다.
      `${MEDUSA_BASE_URL}/admin/price-lists/${id}?fields=${LIST_FIELDS},*prices,*prices.price_set,*prices.price_set.variant`
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

  batchPrices: async (id: string, payload: BatchPricesPayload) => {
    await client.post(`${MEDUSA_BASE_URL}/admin/price-lists/${id}/prices/batch`, {
      create: payload.create ?? [],
      update: payload.update ?? [],
      delete: payload.delete ?? [],
    });
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
