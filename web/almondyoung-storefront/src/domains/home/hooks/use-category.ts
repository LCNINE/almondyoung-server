"use client"

import { getProductList } from "@lib/api/medusa/products"
import { CategoryTreeNodeDto } from "@lib/types/dto/pim"
import type { StoreProduct } from "@medusajs/types"
import { useEffect, useState, useTransition } from "react"

export function useCategory(initialCategories: CategoryTreeNodeDto[]) {
  const [categories, _] = useState(initialCategories)
  const [selectedCategoryId, setSelectedCategoryId] = useState(
    categories[0]?.id || ""
  )
  const [categoryProducts, setCategoryProducts] = useState<StoreProduct[]>([])
  const [isPending, startTransition] = useTransition()

  useEffect(() => {
    if (!selectedCategoryId) return

    startTransition(async () => {
      const data = await getProductList({
        page: 1,
        limit: 10,
        categoryId: selectedCategoryId,
      })
      setCategoryProducts(data.products)
    })
  }, [selectedCategoryId])

  return {
    categories,
    selectedCategoryId,
    setSelectedCategoryId,
    categoryProducts,
    isPending,
  }
}
