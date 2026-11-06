"use client"

import Image from "next/image"
import { getBestProductsByCategory } from "@/domains/home/actions"
import ProductCard from "@/domains/products/components/product-card"
import RankBadge from "@/domains/products/components/rank-badge"
import { CATEGORY_ICON_URLS } from "@/components/layout/header/header-links"
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
        moreHref={`/category/${activeTab.handle}`}
      />

      <div
        role="tablist"
        aria-label={t("titleFirst")}
        className="-mx-4 mb-5 flex gap-1.5 overflow-x-auto px-4 [scrollbar-width:none] md:mx-0 md:mb-6 md:flex-wrap md:justify-center md:px-0 [&::-webkit-scrollbar]:hidden"
      >
        {categories.map((category) => {
          const isActive = category.id === activeTab.id
          const icon = CATEGORY_ICON_URLS[category.key]

          return (
            <button
              key={category.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => !isActive && handleTabChange(category)}
              className={cn(
                "flex h-[38px] flex-none items-center gap-1.5 rounded-full border px-4 text-[14px] font-semibold transition-colors",
                isActive
                  ? "border-ink bg-ink text-white"
                  : "border-border-muted text-ink/80 hover:text-ink bg-white"
              )}
            >
              {icon && (
                <Image
                  src={icon}
                  alt=""
                  width={20}
                  height={20}
                  className="size-5 object-contain"
                />
              )}
              {category.name}
            </button>
          )
        })}
      </div>

      {renderProducts()}
    </div>
  )
}
