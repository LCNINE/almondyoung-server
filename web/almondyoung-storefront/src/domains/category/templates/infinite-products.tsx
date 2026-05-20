"use client"

import { Spinner } from "@/components/shared/spinner"
import { SortOptions } from "@/domains/category/components/refinement-list/sort-products"
import {
  PRODUCT_LIMIT,
  useCategoryProducts,
} from "@/domains/category/hooks/use-category-products"
import { useProductGridVirtualizer } from "@/domains/category/hooks/use-product-grid-virtualizer"
import { useWishlistIds } from "@/domains/category/hooks/use-wishlist-ids"
import ProductCard from "@/domains/products/components/product-card"
import type { HttpTypes } from "@medusajs/types"
import { useTranslations } from "next-intl"

type InfiniteProductsProps = {
  initialProducts: HttpTypes.StoreProduct[]
  initialNextPage: number | null
  totalCount: number
  sortBy: SortOptions
  categoryIds?: string[]
  collectionId?: string
  productsIds?: string[]
  countryCode: string
  isMembership: boolean
  isLoggedIn: boolean
  initialWishlistIds: string[]
}

const getIsMembershipOnly = (product: HttpTypes.StoreProduct): boolean =>
  product.metadata?.isMembershipOnly === true ||
  product.metadata?.isMembershipOnly === "true"

export default function InfiniteProducts({
  initialProducts,
  initialNextPage,
  totalCount,
  sortBy,
  categoryIds,
  collectionId,
  productsIds,
  countryCode,
  isMembership,
  isLoggedIn,
  initialWishlistIds,
}: InfiniteProductsProps) {
  const t = useTranslations("category.products")

  const { allProducts, error, isFetchingNextPage, fetchNextPage, hasNextPage } =
    useCategoryProducts({
      sortBy,
      countryCode,
      categoryIds,
      collectionId,
      productsIds,
      initialProducts,
      initialNextPage,
      totalCount,
    })
  const wishlistSet = useWishlistIds({ isLoggedIn, initialWishlistIds })

  const { listRef, virtualizer, virtualItems, columns, rowCount, rowHeight } =
    useProductGridVirtualizer({
      itemCount: allProducts.length,
      hasNextPage,
      isFetchingNextPage,
      onLoadMore: fetchNextPage,
    })

  return (
    <>
      <div
        ref={listRef}
        style={{
          height: `${virtualizer.getTotalSize()}px`,
          width: "100%",
          position: "relative",
        }}
        data-testid="products-list"
      >
        {virtualItems.map((virtualRow) => {
          const isLoaderRow = virtualRow.index >= rowCount
          const start = virtualRow.index * columns
          const rowProducts = allProducts.slice(start, start + columns)

          return (
            <div
              key={virtualRow.key}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                height: `${rowHeight}px`,
                transform: `translateY(${
                  virtualRow.start - virtualizer.options.scrollMargin
                }px)`,
              }}
            >
              {isLoaderRow ? (
                <div className="flex justify-center py-8">
                  {error ? (
                    <button
                      type="button"
                      onClick={() => fetchNextPage()}
                      className="text-sm text-gray-500 underline underline-offset-4 hover:text-gray-700"
                    >
                      {t("loadMoreFailed")} · {t("retry")}
                    </button>
                  ) : (
                    <div className="flex items-center gap-2 text-sm text-gray-500">
                      <Spinner size="sm" />
                      {t("loadingMore")}
                    </div>
                  )}
                </div>
              ) : (
                <ul className="grid grid-cols-2 gap-x-6 lg:grid-cols-3 xl:grid-cols-4">
                  {rowProducts.map((p) => (
                    <li key={p.id}>
                      <ProductCard
                        product={p}
                        isMembership={isMembership}
                        isMembershipOnly={getIsMembershipOnly(p)}
                        isWishlisted={wishlistSet.has(p.id ?? "")}
                        countryCode={countryCode}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )
        })}
      </div>

      {!hasNextPage && allProducts.length > PRODUCT_LIMIT && (
        <p className="py-8 text-sm text-center text-gray-500">{t("noMore")}</p>
      )}
    </>
  )
}
