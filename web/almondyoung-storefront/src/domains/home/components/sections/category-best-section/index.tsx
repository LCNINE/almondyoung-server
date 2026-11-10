"use client"

import { getBestProductsByCategory } from "@/domains/home/actions"
import ProductCard from "@/domains/products/components/product-card"
import RankBadge from "@/domains/products/components/rank-badge"
import { FIXED_CATEGORIES } from "@/lib/constants/categories"
import { CustomerGroup } from "@/lib/types/dto/medusa"
import { StoreCustomerWithGroups } from "@/lib/types/ui/medusa"
import { cn } from "@/lib/utils"
import { getIsMembershipOnly } from "@/lib/utils/product-card"
import { HttpTypes } from "@medusajs/types"
import { useState, useTransition } from "react"
import { useTranslations } from "next-intl"
import { SectionHead } from "../../header"
import { HomeRail } from "../../shared/home-rail"
import { ProductSectionEmpty } from "../../shared/product-section/empty-state"
import { ProductSectionSkeleton } from "../../shared/product-section/skeleton"

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

  const isMembership =
    customer?.groups?.some(
      (group: CustomerGroup) =>
        group.id === process.env.NEXT_PUBLIC_MEDUSA_MEMBERSHIP_GROUP_ID
    ) ?? false

  const handleTabChange = (tab: (typeof categories)[number]) => {
    setActiveTab(tab)

    startTransition(async () => {
      const nextProducts = await getBestProductsByCategory({
        handle: tab.handle,
        regionId,
        limit: 10,
      })
      setProducts(nextProducts)
    })
  }

  const renderProducts = () => {
    if (isPending) return <ProductSectionSkeleton />

    if (products.length === 0) {
      return (
        <ProductSectionEmpty
          title={t("emptyTitle")}
          description={t("emptyDescription")}
        />
      )
    }

    return (
      // 탭을 바꾸면 줄을 새로 그려 스크롤이 처음으로 돌아간다
      <HomeRail key={activeTab.id}>
        {products.map((product, index) => (
          <ProductCard
            key={product.id}
            product={product}
            isMembership={isMembership}
            isMembershipOnly={getIsMembershipOnly(product)}
            overlay={<RankBadge rank={index + 1} />}
            isWishlisted={wishlistIds?.has(product.id ?? "") ?? false}
            enablePhotoSwipe={false}
          />
        ))}
      </HomeRail>
    )
  }

  return (
    <div className="w-full">
      <SectionHead
        title={`${t("titleFirst")} ${t("titleSecond")}`}
        accent={t("titleSecond")}
        centered
        moreHref={`/category/${activeTab.handle}`}
      />

      <div
        role="tablist"
        aria-label={t("titleFirst")}
        className="-mx-4 mt-1 mb-6 flex gap-2 overflow-x-auto px-4 [scrollbar-width:none] md:mx-0 md:mt-2 md:mb-10 md:flex-wrap md:justify-center md:gap-2 md:px-0 [&::-webkit-scrollbar]:hidden"
      >
        {categories.map((category) => {
          const isActive = category.id === activeTab.id

          return (
            <button
              key={category.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => !isActive && handleTabChange(category)}
              className={cn(
                // 라이브 탭 규격: 14px/500, 위아래 4px·좌우 8px, 고른 탭만 검정 글자와 주황 밑줄
                "flex-none border-b-2 px-2 py-1 text-sm font-medium transition-colors",
                isActive
                  ? "border-primary text-black"
                  : "text-muted-foreground border-transparent hover:text-black"
              )}
            >
              {category.name}
            </button>
          )
        })}
      </div>

      {renderProducts()}
    </div>
  )
}
