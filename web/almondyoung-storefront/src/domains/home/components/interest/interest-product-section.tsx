"use client"

import type { StoreCustomerWithGroups } from "@/lib/types/ui/medusa"
import type { HttpTypes } from "@medusajs/types"
import { ProductSection } from "../shared/product-section"
import { InterestEditSheet } from "./interest-edit-sheet"

interface InterestProductSectionProps {
  category: { key: string; name: string; handle: string }
  products: HttpTypes.StoreProduct[]
  customer: StoreCustomerWithGroups | null
  wishlistIds?: Set<string>
  selectedKeys: string[]
  /** 첫 섹션에만 편집 버튼 노출 (각 섹션마다 중복 노출 방지) */
  showEditButton?: boolean
}

/*───────────────────────────
 * 관심 카테고리 1개에 대응하는 베스트 상품 섹션 (탭 없음)
 *──────────────────────────*/
export function InterestProductSection({
  category,
  products,
  customer,
  wishlistIds,
  selectedKeys,
  showEditButton = false,
}: InterestProductSectionProps) {
  const tab = { id: category.key, name: category.name, handle: category.handle }

  return (
    <ProductSection
      title={
        <>
          <span className="text-yellow-30">{category.name}</span> 베스트
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
      emptyTitle="상품이 없습니다"
      emptyDescription="이 카테고리에 등록된 상품이 없습니다."
      headerExtra={
        showEditButton ? (
          <InterestEditSheet initialKeys={selectedKeys} />
        ) : undefined
      }
    />
  )
}
