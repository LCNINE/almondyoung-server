"use client"

import { SharedPagination } from "@/components/shared/pagination"
import { PageTitle } from "@/components/shared/page-title"
import { useMembership } from "@/contexts/membership-context"
import ProductCard from "domains/products/components/product-card"
import type { FrequentProductsPage } from "@/lib/types/ui/frequent-products"
import { useRouter } from "next/navigation"
import { useMemo, useState } from "react"
import { FrequentEmpty } from "../components/frequent-empty"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"

interface FrequentProductsTemplateProps {
  countryCode: string
  data: FrequentProductsPage
}

export function FrequentProductsTemplate({
  countryCode,
  data,
}: FrequentProductsTemplateProps) {
  const { items, total, page: currentPage, limit } = data
  const router = useRouter()
  const { isMembershipPricing } = useMembership()
  const [excludeSoldout, setExcludeSoldout] = useState(false)

  const displayItems = useMemo(() => {
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

  const totalPages = Math.max(1, Math.ceil(total / limit))

  const handlePageChange = (page: number) => {
    const params = new URLSearchParams()
    if (page > 1) params.set("page", String(page))
    const queryString = params.toString()
    router.push(queryString ? `?${queryString}` : "?", { scroll: false })
  }

  if (total === 0) {
    return (
      <div className="rounded-xl bg-white px-3 pt-4 pb-9 md:px-6">
        <PageTitle>자주 산 상품</PageTitle>
        <FrequentEmpty />
      </div>
    )
  }

  return (
    <div className="rounded-xl bg-white px-3 pt-4 pb-9 md:px-6">
      <PageTitle>자주 산 상품</PageTitle>

      <div className="mb-4 flex items-center justify-between">
        <span className="text-sm text-gray-500">총 {total}개</span>
        <div className="flex items-center gap-2">
          <Checkbox
            id="exclude-soldout"
            checked={excludeSoldout}
            onCheckedChange={(checked) => setExcludeSoldout(checked === true)}
          />
          <Label
            htmlFor="exclude-soldout"
            className="cursor-pointer text-sm text-gray-600"
          >
            품절 상품 제외
          </Label>
        </div>
      </div>

      {displayItems.length === 0 ? (
        <div className="py-12 text-center text-sm text-gray-500">
          표시할 상품이 없습니다
        </div>
      ) : (
        <>
          <div className="grid w-full grid-cols-2 gap-x-6 gap-y-8 sm:grid-cols-3 md:grid-cols-4">
            {displayItems.map((item) => (
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
