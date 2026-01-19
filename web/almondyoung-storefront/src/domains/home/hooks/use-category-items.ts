"use client"

import { getProductList } from "@lib/api/medusa/products"
import type { StoreProduct } from "@medusajs/types"
import { useEffect, useState, useTransition } from "react"

export function useCategoryItems({categoryId,masterIds}: {categoryId: string,masterIds?: string[]}) {
  const [categoryProducts, setCategoryProducts] = useState<StoreProduct[]>([])
  const [isPending, startTransition] = useTransition()

  useEffect(() => {
    if (!categoryId) return

    startTransition(async () => {
      const data = await getProductList({
        page: 1,
        limit: 10,
        categoryId,
        handle:masterIds,
      })
      setCategoryProducts(data.products)
    })
  }, [categoryId])

  return {
    categoryProducts,
    isPending,
  }
}
