'use client';

import { MEDUSA_BASE_URL } from '@/const';
import { client } from '../../client';
import { medusaPricePreferencesApi } from './price-preferences';
import { applyCurrencyTaxInclusivePreferences } from './region-tax-inclusive';

export interface MedusaRegionCountry {
  iso_2: string;
  display_name: string;
}

export interface MedusaRegion {
  id: string;
  name: string;
  currency_code: string;
  automatic_taxes: boolean;
  // Medusa 2.13 의 region 응답에는 is_tax_inclusive 가 노출되지 않는다(입력 payload 로만 받음). optional.
  is_tax_inclusive?: boolean;
  // list 엔드포인트는 countries 를 주지 않아 detail 로 보강한다. optional.
  countries?: MedusaRegionCountry[];
  created_at: string;
  updated_at: string;
}

export interface MedusaRegionListResponse {
  regions: MedusaRegion[];
  count: number;
  offset: number;
  limit: number;
}

export interface CreateMedusaRegionPayload {
  name: string;
  currency_code: string;
  // 소문자 ISO 3166-1 alpha-2 (예: ['kr','us'])
  countries: string[];
  automatic_taxes?: boolean;
  is_tax_inclusive?: boolean;
}

export interface UpdateMedusaRegionPayload {
  name?: string;
  currency_code?: string;
  countries?: string[];
  automatic_taxes?: boolean;
  is_tax_inclusive?: boolean;
}

const getMedusaRegion = async (id: string) => {
  const res = await client.get<{ region: MedusaRegion }>(
    `${MEDUSA_BASE_URL}/admin/regions/${id}`
  );
  return res.data.region;
};

export const medusaRegionsApi = {
  // list 엔드포인트는 countries 같은 relation 을 주지 않으므로, 각 region 을 detail 로 보강한다.
  list: async (params: { limit?: number; offset?: number } = {}) => {
    const p = new URLSearchParams();
    if (params.limit !== undefined) p.append('limit', String(params.limit));
    if (params.offset !== undefined) p.append('offset', String(params.offset));
    const res = await client.get<MedusaRegionListResponse>(
      `${MEDUSA_BASE_URL}/admin/regions?${p.toString()}`
    );
    const [detailed, pricePreferences] = await Promise.all([
      Promise.all(res.data.regions.map((r) => getMedusaRegion(r.id))),
      medusaPricePreferencesApi.list(),
    ]);

    return {
      ...res.data,
      regions: applyCurrencyTaxInclusivePreferences(
        detailed,
        pricePreferences.price_preferences
      ),
    };
  },

  // detail 엔드포인트는 countries 를 기본 포함한다.
  get: async (id: string) => {
    const [region, pricePreferences] = await Promise.all([
      getMedusaRegion(id),
      medusaPricePreferencesApi.list(),
    ]);
    return applyCurrencyTaxInclusivePreferences(
      [region],
      pricePreferences.price_preferences
    )[0];
  },

  create: async ({ is_tax_inclusive, ...payload }: CreateMedusaRegionPayload) => {
    const res = await client.post<{ region: MedusaRegion }>(
      `${MEDUSA_BASE_URL}/admin/regions`,
      payload
    );
    if (is_tax_inclusive === undefined) return res.data.region;

    const preference = await medusaPricePreferencesApi.upsertCurrencyTaxInclusive(
      res.data.region.currency_code,
      is_tax_inclusive
    );
    return { ...res.data.region, is_tax_inclusive: preference.is_tax_inclusive };
  },

  // Medusa Admin API 는 update 도 POST 를 사용한다.
  update: async (id: string, { is_tax_inclusive, ...payload }: UpdateMedusaRegionPayload) => {
    const res = await client.post<{ region: MedusaRegion }>(
      `${MEDUSA_BASE_URL}/admin/regions/${id}`,
      payload
    );
    if (is_tax_inclusive === undefined) return res.data.region;

    const preference = await medusaPricePreferencesApi.upsertCurrencyTaxInclusive(
      res.data.region.currency_code,
      is_tax_inclusive
    );
    return { ...res.data.region, is_tax_inclusive: preference.is_tax_inclusive };
  },

  delete: async (id: string) => {
    await client.delete(`${MEDUSA_BASE_URL}/admin/regions/${id}`);
  },
};
