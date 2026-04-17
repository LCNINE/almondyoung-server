import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { variantMappingApi } from "@/lib/api/matching/variant-mapping"
import type { UpsertMatchingDto } from "@/lib/types/matching"
import { matchingKeys } from "./query-keys"

export function useVariantMatching(variantId: string, enabled = true) {
  return useQuery({
    queryKey: matchingKeys.variant.byVariant(variantId),
    queryFn: () => variantMappingApi.getByVariant(variantId),
    enabled: enabled && !!variantId,
  })
}

export function useVariantStockPolicy(variantId: string, enabled = true) {
  return useQuery({
    queryKey: matchingKeys.variant.stockPolicy(variantId),
    queryFn: () => variantMappingApi.getStockPolicy(variantId),
    enabled: enabled && !!variantId,
  })
}

export function useUpsertVariantMatching(variantId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (dto: UpsertMatchingDto) =>
      variantMappingApi.upsert(variantId, dto),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: matchingKeys.variant.all })
      qc.invalidateQueries({ queryKey: matchingKeys.masters.all })
      qc.invalidateQueries({ queryKey: matchingKeys.orderLines.all })
    },
  })
}

export function useMastersBatchStats(masterIds: string[]) {
  return useQuery({
    queryKey: matchingKeys.masters.batchStats(masterIds),
    queryFn: () => variantMappingApi.getMastersBatchStats(masterIds),
    enabled: masterIds.length > 0,
    placeholderData: (prev) => prev,
  })
}

export function useVariantSkuLookup(variantId: string) {
  return useMutation({
    mutationFn: (
      selectedOptions?: Array<{ optionName: string; optionValue: string }>
    ) => variantMappingApi.lookupSkus(variantId, selectedOptions),
  })
}
