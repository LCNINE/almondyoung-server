import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { productsApi } from "@/lib/api/catalog/products"
import type { ProductsQuery } from "@/lib/types/catalog"
import { catalogKeys } from "./query-keys"

export function useProducts(query: ProductsQuery) {
  return useQuery({
    queryKey: catalogKeys.products.list(query),
    queryFn: () => productsApi.list(query),
    placeholderData: (prev) => prev,
  })
}

export function useProductDrafts(query: ProductsQuery) {
  return useQuery({
    queryKey: catalogKeys.products.drafts(query),
    queryFn: () => productsApi.listDrafts(query),
    placeholderData: (prev) => prev,
  })
}

export function useProduct(id: string) {
  return useQuery({
    queryKey: catalogKeys.products.detail(id),
    queryFn: () => productsApi.get(id),
    enabled: !!id,
  })
}

export function useCreateProduct() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => productsApi.create(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: catalogKeys.products.all })
    },
  })
}

export function useDeleteProduct() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => productsApi.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: catalogKeys.products.all })
    },
  })
}

export function useBulkDeleteProducts() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (masterIds: string[]) => productsApi.bulkDelete({ masterIds }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: catalogKeys.products.all })
    },
  })
}
