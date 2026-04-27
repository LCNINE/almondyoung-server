import { ALMONDYOUNG_API_BASE_URL } from '@/const';
import { client } from '../../client';
import type {
  PricingRulesResponseDto,
  ReplacePricingRulesDto,
  CalculatePriceRequestDto,
  CalculatePriceResponseDto,
  VariantPriceSetDto,
} from '../../../types/dto/products';

const versionPricingBase = (versionId: string) =>
  `${ALMONDYOUNG_API_BASE_URL}/versions/${versionId}/pricing`;

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
