'use client';

import { ALMONDYOUNG_API_BASE_URL } from '@/const';
import { client } from '../../client';
import type {
  PricingRulesResponseDto,
  ReplacePricingRulesDto,
  CalculatePriceRequestDto,
  CalculatePriceResponseDto,
  VariantPriceSetDto,
} from '../../../types/dto/products';
import type { QuantityDiscountDto, UpsertQuantityDiscountDto } from '../../../pricing/quantity-discount';

const versionPricingBase = (versionId: string) =>
  `${ALMONDYOUNG_API_BASE_URL}/versions/${versionId}/pricing`;

const quantityDiscountPath = (masterId: string, versionId: string) =>
  `${ALMONDYOUNG_API_BASE_URL}/masters/${masterId}/versions/${versionId}/quantity-discount`;

const masterPricingBase = (masterId: string) =>
  `${ALMONDYOUNG_API_BASE_URL}/masters/${masterId}/pricing`;

export const pricingClient = {
  versions: {
    getRules: async (versionId: string): Promise<PricingRulesResponseDto> =>
      (await client.get(`${versionPricingBase(versionId)}/rules`)).data,

    replaceRules: async (
      versionId: string,
      dto: ReplacePricingRulesDto,
    ): Promise<PricingRulesResponseDto> =>
      (await client.put(`${versionPricingBase(versionId)}/rules`, dto)).data,

    deleteRules: async (versionId: string): Promise<void> => {
      await client.delete(`${versionPricingBase(versionId)}/rules`);
    },

    calculate: async (
      versionId: string,
      dto: CalculatePriceRequestDto,
    ): Promise<CalculatePriceResponseDto> =>
      (await client.post(`${versionPricingBase(versionId)}/calculate`, dto)).data,

    getPriceSet: async (versionId: string, variantId: string): Promise<VariantPriceSetDto> =>
      (await client.get(`${versionPricingBase(versionId)}/price-set`, { params: { variantId } }))
        .data,

    getQuantityDiscount: async (
      masterId: string,
      versionId: string,
    ): Promise<QuantityDiscountDto | null> =>
      (await client.get(quantityDiscountPath(masterId, versionId))).data || null,

    saveQuantityDiscount: async (
      masterId: string,
      versionId: string,
      dto: UpsertQuantityDiscountDto,
    ): Promise<QuantityDiscountDto | null> =>
      (await client.put(quantityDiscountPath(masterId, versionId), dto)).data || null,
  },

  masters: {
    getRules: async (masterId: string): Promise<PricingRulesResponseDto> =>
      (await client.get(`${masterPricingBase(masterId)}/rules`)).data,

    calculate: async (
      masterId: string,
      dto: CalculatePriceRequestDto,
    ): Promise<CalculatePriceResponseDto> =>
      (await client.post(`${masterPricingBase(masterId)}/calculate`, dto)).data,

    getPriceSet: async (masterId: string, variantId: string): Promise<VariantPriceSetDto> =>
      (await client.get(`${masterPricingBase(masterId)}/price-set`, { params: { variantId } }))
        .data,
  },
};
