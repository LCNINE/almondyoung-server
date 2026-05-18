"use client"

import type { StoreCustomerWithGroups } from "@/lib/types/ui/medusa"
import type { HttpTypes } from "@medusajs/types"
import { useTranslations } from "next-intl"
import { ProductSection } from "../shared/product-section"
import { InterestEditSheet } from "./interest-edit-sheet"

interface InterestProductSectionProps {
  category: { key: string; name: string; handle: string }
  products: HttpTypes.StoreProduct[]
  customer: StoreCustomerWithGroups | null
  wishlistIds?: Set<string>
  selectedKeys: string[]
  showEditButton?: boolean
}

export function InterestProductSection({
  category,
  products,
  customer,
  wishlistIds,
  selectedKeys,
  showEditButton = false,
}: InterestProductSectionProps) {
  const t = useTranslations("home.categoryBest")
  const tCat = useTranslations("categories")
  const localizedName = tCat(category.key as "lash-perm") ?? category.name
  const tab = { id: category.key, name: localizedName, handle: category.handle }

  return (
    <ProductSection
      title={
        <>
          <span className="text-yellow-30">{localizedName}</span> {t("interestTitleSuffix")}
        </>
      }
      tabs={[tab]}
      activeTab={tab}
      products={products}
      onTabChange={() => {}}
      moreHref={`/category/${category.handle}`}
      customer={customer}
      wishlistIds={wishlistIds}
      hideTabs
      emptyTitle={t("emptyTitle")}
      emptyDescription={t("emptyDescription")}
      headerExtra={
        showEditButton ? (
          <InterestEditSheet initialKeys={selectedKeys} />
        ) : undefined
      }
    />
  )
}
