import { client } from "../client"
import type {
  MasterBatchStat,
  UpsertMatchingDto,
  VariantMatchingDto,
  VariantStockPolicy,
} from "@/lib/types/matching"

export const variantMappingApi = {
  getByVariant: async (
    variantId: string,
  ): Promise<VariantMatchingDto | null> => {
    const res = await client.get(`/matchings/${variantId}`)
    return res.data
  },

  upsert: async (
    variantId: string,
    dto: UpsertMatchingDto,
  ): Promise<VariantMatchingDto> => {
    const res = await client.put(`/matchings/${variantId}`, dto)
    return res.data
  },

  getStockPolicy: async (variantId: string): Promise<VariantStockPolicy> => {
    const res = await client.get(
      `/matchings/variants/${variantId}/stock-policy`,
    )
    return res.data
  },

  lookupSkus: async (
    variantId: string,
    selectedOptions?: Array<{ optionName: string; optionValue: string }>,
  ) => {
    const res = await client.post(
      `/matchings/variants/${variantId}/sku-lookup`,
      { selectedOptions },
    )
    return res.data
  },

  getMastersBatchStats: async (
    masterIds: string[],
  ): Promise<MasterBatchStat[]> => {
    if (masterIds.length === 0) return []
    const res = await client.get(`/matchings/masters/batch-stats`, {
      params: { masterIds: masterIds.join(",") },
    })
    return res.data
  },
}
