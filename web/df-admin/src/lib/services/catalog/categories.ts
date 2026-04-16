import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { categoriesApi } from "@/lib/api/catalog/categories"
import type { CreateCategoryDto, UpdateCategoryDto } from "@/lib/types/catalog"
import { catalogKeys } from "./query-keys"

export function useCategoryTree(maxDepth?: number) {
  return useQuery({
    queryKey: catalogKeys.categories.tree(maxDepth),
    queryFn: () => categoriesApi.tree(maxDepth),
  })
}

export function useCategory(id: string) {
  return useQuery({
    queryKey: catalogKeys.categories.detail(id),
    queryFn: () => categoriesApi.get(id),
    enabled: !!id,
  })
}

export function useCreateCategory() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (dto: CreateCategoryDto) => categoriesApi.create(dto),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: catalogKeys.categories.all })
    },
  })
}

export function useUpdateCategory() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, dto }: { id: string; dto: UpdateCategoryDto }) =>
      categoriesApi.update(id, dto),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: catalogKeys.categories.all })
    },
  })
}

export function useDeleteCategory() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      id,
      moveProductsTo,
    }: {
      id: string
      moveProductsTo?: string
    }) => categoriesApi.delete(id, moveProductsTo),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: catalogKeys.categories.all })
    },
  })
}
