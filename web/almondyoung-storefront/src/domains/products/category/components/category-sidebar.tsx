"use client"

import { usePathname } from "next/navigation"
import { useMemo } from "react"
import ProductFilterSidebar from "@/components/products/product-filter-sidebar"
import type { StoreProductCategoryTree } from "@lib/types/medusa-category"

interface CategorySidebarProps {
  categories: StoreProductCategoryTree[]
  countryCode: string
}

export function CategorySidebar({
  categories,
  countryCode,
}: CategorySidebarProps) {
  const pathname = usePathname()

  const currentCategoryId = useMemo(() => {
    const parts = pathname.split("/")
    const categoryIndex = parts.indexOf("category")
    if (categoryIndex === -1) return undefined

    const segments = parts.slice(categoryIndex + 1).filter(Boolean)
    if (segments.length === 0) return undefined

    let level = categories
    let lastMatch: StoreProductCategoryTree | undefined

    for (const segment of segments) {
      const matched = level.find(
        (cat) => cat.handle === segment || cat.id === segment
      )
      if (!matched) break
      lastMatch = matched
      level = matched.category_children || []
    }

    return lastMatch?.id
  }, [pathname, categories])

  return (
    <ProductFilterSidebar
      categories={categories}
      currentCategoryId={currentCategoryId}
      countryCode={countryCode}
    />
  )
}
