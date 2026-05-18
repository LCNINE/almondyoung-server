"use client"

import { getBestProductsByCategory } from "@/domains/home/actions"
import { FIXED_CATEGORIES, FixedCategory } from "@/lib/constants/categories"
import { StoreCustomerWithGroups } from "@/lib/types/ui/medusa"
import { HttpTypes } from "@medusajs/types"
import { useState, useTransition } from "react"
import { useTranslations } from "next-intl"
import { ProductSection } from "../../shared/product-section"

interface CategoryBestSectionProps {
  initialProducts: HttpTypes.StoreProduct[] | undefined
  regionId?: string
  customer: StoreCustomerWithGroups | null
  wishlistIds?: Set<string>
}

export function CategoryBestSection({
  initialProducts,
  regionId,
  customer,
  wishlistIds,
}: CategoryBestSectionProps) {
  const t = useTranslations("home.categoryBest")
  const tCat = useTranslations("categories")

  const categories = FIXED_CATEGORIES.map((c) => ({
    ...c,
    name: tCat(c.key as "lash-perm"),
  }))

  const [activeTab, setActiveTab] = useState<(typeof categories)[number]>(
    categories[0]
  )
  const [products, setProducts] = useState<HttpTypes.StoreProduct[]>(
    initialProducts || []
  )
  const [isPending, startTransition] = useTransition()

  const handleTabChange = (tab: (typeof categories)[number]) => {
    setActiveTab(tab)

    startTransition(async () => {
      const nextProducts = await getBestProductsByCategory({
        categoryId: (tab as unknown as FixedCategory).id,
        regionId,
        limit: 10,
      })
      setProducts(nextProducts)
    })
  }

  return (
    <ProductSection
      title={
        <>
          {t("titleFirst")} <span className="text-yellow-30">{t("titleSecond")}</span>
        </>
      }
      tabs={categories}
      activeTab={activeTab}
      products={products}
      isPending={isPending}
      moreHref={`/category/${activeTab.handle}`}
      onTabChange={handleTabChange}
      customer={customer}
      emptyTitle={t("emptyTitle")}
      emptyDescription={t("emptyDescription")}
      wishlistIds={wishlistIds}
    />
  )
}
