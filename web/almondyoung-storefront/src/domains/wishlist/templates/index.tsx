"use client"

import { SharedPagination } from "@/components/shared/pagination"
import { PageTitle } from "@/components/shared/page-title"
import { useMembership } from "@/contexts/membership-context"
import ProductCard from "domains/products/components/product-card"
import type { WishlistProductItem } from "@/lib/types/ui/wishlist"
import { useRouter } from "next/navigation"
import { useMemo, useState } from "react"
import { WishlistEmpty } from "../components/wishlist-empty"
import { WishlistQuery } from "../components/wishlist-query"

const ITEMS_PER_PAGE = 12

interface WishlistTemplateProps {
  countryCode: string
  items: WishlistProductItem[]
  initialQuery: string
  currentPage: number
}

export function WishlistTemplate({
  countryCode,
  items,
  initialQuery,
  currentPage,
}: WishlistTemplateProps) {
  const router = useRouter()
  const { isMembershipPricing } = useMembership()
  const [excludeSoldout, setExcludeSoldout] = useState(false)

  const filteredItems = useMemo(() => {
    if (!excludeSoldout) return items // 품절상품 제외 체크가 안되어 있으면 모든 상품 반환

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

  const updateSearchParams = (updates: { q?: string; page?: number }) => {
    const params = new URLSearchParams()
    const newQuery = updates.q ?? initialQuery
    const newPage = updates.page ?? currentPage

    if (newQuery) params.set("q", newQuery)
    if (newPage > 1) params.set("page", String(newPage))

    const queryString = params.toString()
    router.push(queryString ? `?${queryString}` : "?", { scroll: false })
  }

  const handleSearchChange = (query: string) => {
    updateSearchParams({ q: query, page: 1 })
  }

  const handlePageChange = (page: number) => {
    updateSearchParams({ page })
  }

  const handleExcludeSoldoutChange = (checked: boolean) => {
    setExcludeSoldout(checked)
    if (currentPage !== 1) {
      handlePageChange(1)
    }
  }

  // 검색어가 없을 때만 빈 위시리스트 표시
  const isEmptyWishlist = items.length === 0 && !initialQuery.trim()

  if (isEmptyWishlist) {
    return (
      <div className="rounded-xl bg-white px-3 pt-4 pb-9 md:px-6">
        <PageTitle>찜한 상품</PageTitle>
        <WishlistEmpty />
      </div>
    )
  }

  return (
    <div className="rounded-xl bg-white px-3 pt-4 pb-9 md:px-6">
      <PageTitle>찜한 상품</PageTitle>

      <WishlistQuery
        initialQuery={initialQuery}
        onSearchChange={handleSearchChange}
        excludeSoldout={excludeSoldout}
        onExcludeSoldoutChange={handleExcludeSoldoutChange}
        totalCount={filteredItems.length}
      />

      {filteredItems.length === 0 ? (
        <div className="py-12 text-center text-sm text-gray-500">
          검색 결과가 없습니다
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
                isWishlisted={true}
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
