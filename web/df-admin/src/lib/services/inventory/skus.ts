import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { skusApi } from "@/lib/api/inventory/skus"
import type {
  AddBarcodeDto,
  CreateSkuDto,
  DeletedSkuQuery,
  SkuAdvancedQuery,
  UpdateSkuDto,
} from "@/lib/types/inventory"
import { inventoryKeys } from "./query-keys"

export function useSkus(query: SkuAdvancedQuery) {
  return useQuery({
    queryKey: inventoryKeys.skus.list(query),
    queryFn: () => skusApi.list(query),
    placeholderData: (prev) => prev,
  })
}

export function useDeletedSkus(query: DeletedSkuQuery) {
  return useQuery({
    queryKey: inventoryKeys.skus.deleted(query),
    queryFn: () => skusApi.listDeleted(query),
    placeholderData: (prev) => prev,
  })
}

export function useSku(id: string) {
  return useQuery({
    queryKey: inventoryKeys.skus.detail(id),
    queryFn: () => skusApi.get(id),
    enabled: !!id,
  })
}

export function useSkuStockSummary(id: string) {
  return useQuery({
    queryKey: inventoryKeys.skus.stockSummary(id),
    queryFn: () => skusApi.stockSummary(id),
    enabled: !!id,
  })
}

export function useCreateSku() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (dto: CreateSkuDto) => skusApi.create(dto),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: inventoryKeys.skus.all })
    },
  })
}

export function useUpdateSku(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (dto: UpdateSkuDto) => skusApi.update(id, dto),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: inventoryKeys.skus.all })
      qc.invalidateQueries({ queryKey: inventoryKeys.skus.detail(id) })
    },
  })
}

export function useDeleteSku() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => skusApi.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: inventoryKeys.skus.all })
    },
  })
}

export function useRestoreSku() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => skusApi.restore(id),
    onSuccess: (_, id) => {
      qc.invalidateQueries({ queryKey: inventoryKeys.skus.all })
      qc.invalidateQueries({ queryKey: inventoryKeys.skus.detail(id) })
    },
  })
}

export function useAddBarcode(skuId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (dto: AddBarcodeDto) => skusApi.addBarcode(skuId, dto),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: inventoryKeys.skus.detail(skuId) })
      qc.invalidateQueries({ queryKey: inventoryKeys.skus.all })
    },
  })
}

export function useRemoveBarcode(skuId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (barcodeId: string) => skusApi.removeBarcode(skuId, barcodeId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: inventoryKeys.skus.detail(skuId) })
      qc.invalidateQueries({ queryKey: inventoryKeys.skus.all })
    },
  })
}
