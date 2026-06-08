'use client';

import { MEDUSA_BASE_URL } from '@/const';
import { client } from '../../client';
import {
  CURRENCY_TAX_INCLUSIVE_ATTRIBUTE,
  findCurrencyTaxInclusivePreference,
} from './region-tax-inclusive';

/**
 * Medusa 의 세금 포함 가격(tax-inclusive) SoT.
 * attribute 가 'currency_code' 또는 'region_id' 이며 value 가 해당 코드/ID.
 */
export interface PricePreference {
  id: string;
  attribute: string;
  value: string;
  is_tax_inclusive: boolean;
}

export interface PricePreferenceListResponse {
  price_preferences: PricePreference[];
  count: number;
  offset: number;
  limit: number;
}

export const medusaPricePreferencesApi = {
  list: async () => {
    const res = await client.get<PricePreferenceListResponse>(
      `${MEDUSA_BASE_URL}/admin/price-preferences?limit=1000`,
    );
    return res.data;
  },

  // Medusa Admin API 는 update 도 POST 를 사용한다.
  update: async (id: string, isTaxInclusive: boolean) => {
    const res = await client.post<{ price_preference: PricePreference }>(
      `${MEDUSA_BASE_URL}/admin/price-preferences/${id}`,
      { is_tax_inclusive: isTaxInclusive },
    );
    return res.data.price_preference;
  },

  create: async (payload: { attribute: string; value: string; is_tax_inclusive: boolean }) => {
    const res = await client.post<{ price_preference: PricePreference }>(
      `${MEDUSA_BASE_URL}/admin/price-preferences`,
      payload,
    );
    return res.data.price_preference;
  },

  upsertCurrencyTaxInclusive: async (currencyCode: string, isTaxInclusive: boolean) => {
    const normalizedCurrencyCode = currencyCode.trim().toLowerCase();
    const { price_preferences: pricePreferences } = await medusaPricePreferencesApi.list();
    const existing = findCurrencyTaxInclusivePreference(pricePreferences, normalizedCurrencyCode);

    if (existing) {
      return medusaPricePreferencesApi.update(existing.id, isTaxInclusive);
    }

    return medusaPricePreferencesApi.create({
      attribute: CURRENCY_TAX_INCLUSIVE_ATTRIBUTE,
      value: normalizedCurrencyCode,
      is_tax_inclusive: isTaxInclusive,
    });
  },
};
