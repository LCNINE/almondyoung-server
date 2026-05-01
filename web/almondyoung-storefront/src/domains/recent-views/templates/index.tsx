"use client"

import { SharedPagination } from "@/components/shared/pagination"
import { PageTitle } from "@/components/shared/page-title"
import { useMembership } from "@/contexts/membership-context"
import ProductCard from "domains/products/components/product-card"
import type { RecentViewProductItem } from "@/lib/types/ui/recent-views"
import { useRouter } from "next/navigation"
import { useMemo, useState } from "react"
import { RecentViewsEmpty } from "../components/recent-views-empty"
import { RecentViewsFilter } from "../components/recent-views-filter"

const ITEMS_PER_PAGE = 12

interface RecentViewsTemplateProps {
  countryCode: string
  items: RecentViewProductItem[]
  currentPage: number
}

export function RecentViewsTemplate({
  countryCode,
  items,
  currentPage,
}: RecentViewsTemplateProps) {
  const router = useRouter()
  const { isMembershipPricing } = useMembership()
  const [excludeSoldout, setExcludeSoldout] = useState(false)

  const filteredItems = useMemo(() => {
    if (!excludeSoldout) return items

    return items.filter((item) => {
      const variants = item.variants ?? []
      const hasUnmanagedVariant = variants.some(
        (v) => v.manage_inventory === false
      )
      if (hasUnmanagedVariant) return true
      const totalAvailable = variants.reduce(
        (sum, v) => sum + (v.inventory_quantity || 0),
        0
      )
      return totalAvailable > 0
    })
  }, [items, excludeSoldout])

  const totalPages = Math.ceil(filteredItems.length / ITEMS_PER_PAGE)
  const paginatedItems = useMemo(() => {
    const start = (currentPage - 1) * ITEMS_PER_PAGE
    return filteredItems.slice(start, start + ITEMS_PER_PAGE)
  }, [filteredItems, currentPage])

  const handlePageChange = (page: number) => {
    const params = new URLSearchParams()
    if (page > 1) params.set("page", String(page))
    const queryString = params.toString()
    router.push(queryString ? `?${queryString}` : "?", { scroll: false })
  }

  const handleExcludeSoldoutChange = (checked: boolean) => {
    setExcludeSoldout(checked)
    if (currentPage !== 1) {
      handlePageChange(1)
    }
  }

  if (items.length === 0) {
    return (
      <div className="rounded-xl bg-white px-3 pt-4 pb-9 md:px-6">
        <PageTitle>최근 본 상품</PageTitle>
        <RecentViewsEmpty />
      </div>
    )
  }

  return (
    <div className="rounded-xl bg-white px-3 pt-4 pb-9 md:px-6">
      <PageTitle>최근 본 상품</PageTitle>

      <RecentViewsFilter
        excludeSoldout={excludeSoldout}
        onExcludeSoldoutChange={handleExcludeSoldoutChange}
        totalCount={filteredItems.length}
      />

      {filteredItems.length === 0 ? (
        <div className="py-12 text-center text-sm text-gray-500">
          조건에 맞는 상품이 없습니다
        </div>
      ) : (
        <>
          <div className="grid w-full grid-cols-2 gap-x-6 gap-y-8 sm:grid-cols-3 md:grid-cols-4">
            {paginatedItems.map((item) => (
              <ProductCard
                key={item.id}
                product={item}
                countryCode={countryCode}
                isMembership={isMembershipPricing}
                isMembershipOnly={false}
              />
            ))}
          </div>

          {totalPages > 1 && (
            <div className="mt-6">
              <SharedPagination
                currentPage={currentPage}
                totalPages={totalPages}
                onPageChange={handlePageChange}
              />
            </div>
          )}
        </>
      )}
    </div>
  )
}
