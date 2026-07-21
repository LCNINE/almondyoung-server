"use client"

import type { StoreCustomerWithGroups } from "@/lib/types/ui/medusa"
import type { HttpTypes } from "@medusajs/types"
import { useTranslations } from "next-intl"
import { ProductSection } from "../../shared/product-section"

interface ShowcaseSectionProps {
  title: string
  handle: string
  products: HttpTypes.StoreProduct[]
  customer: StoreCustomerWithGroups | null
  wishlistIds?: Set<string>
}

/**
 * 특정 루트 카테고리 하나를 통째로 보여주는 홈 섹션 (캔바 디자인 / 클래스).
 * 탭 없이 한 줄만 노출하므로 ProductSection 을 hideTabs 로 재사용한다.
 */
export function ShowcaseSection({
  title,
  handle,
  products,
  customer,
  wishlistIds,
}: ShowcaseSectionProps) {
  const t = useTranslations("home.categoryBest")
  const tab = { id: handle, name: title, handle }

  return (
    <ProductSection
      title={<span className="text-yellow-30">{title}</span>}
      tabs={[tab]}
      activeTab={tab}
      products={products}
      onTabChange={() => {}}
      moreHref={`/category/${handle}`}
      customer={customer}
      wishlistIds={wishlistIds}
      hideTabs
      emptyTitle={t("emptyTitle")}
      emptyDescription={t("emptyDescription")}
    />
  )
}
