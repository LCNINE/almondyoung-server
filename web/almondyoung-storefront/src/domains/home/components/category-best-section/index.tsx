"use client"

import { FIXED_CATEGORIES, FixedCategory } from "@/lib/constants/categories"
import { HttpTypes } from "@medusajs/types"
import { useState, useTransition } from "react"
import { StoreCustomerWithGroups } from "@/lib/types/ui/medusa"
import { listProducts } from "@/lib/api/medusa/products"
import { ProductSection } from "../shared/product-section"

interface CategoryBestSectionProps {
  initialProducts: HttpTypes.StoreProduct[] | undefined
  regionId?: string
  customer: StoreCustomerWithGroups | null
}

export function CategoryBestSection({
  initialProducts,
  regionId,
  customer,
}: CategoryBestSectionProps) {
  const categories = FIXED_CATEGORIES

  const [activeTab, setActiveTab] = useState<FixedCategory>(categories[0])
  const [products, setProducts] = useState<HttpTypes.StoreProduct[]>(
    initialProducts || []
  )
  const [isPending, startTransition] = useTransition()

  const handleTabChange = (tab: FixedCategory) => {
    setActiveTab(tab)

    startTransition(async () => {
      const nextProducts = await listProducts({
        queryParams: { category_id: tab.id, limit: 10 },
        regionId,
      })
      setProducts(nextProducts.response.products)
    })
  }

  return (
    <ProductSection
      title={
        <>
          카테고리 <span className="text-yellow-30">베스트</span>
        </>
      }
      tabs={categories}
      activeTab={activeTab}
      products={products}
      isPending={isPending}
      moreHref={`/category/${activeTab.handle}`}
      onTabChange={handleTabChange}
      customer={customer}
      emptyTitle="상품이 없습니다"
      emptyDescription="이 카테고리에 등록된 상품이 없습니다."
    />
  )
}
