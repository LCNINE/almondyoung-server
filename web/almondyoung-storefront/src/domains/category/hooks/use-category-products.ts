"use client"

import { SortOptions } from "@/domains/category/components/refinement-list/sort-products"
import {
  isSortedOption,
  mapSortParams,
} from "@/domains/category/utils/sort-mapping"
import { listProducts, listProductsSorted } from "@/lib/api/medusa/products"
import type { HttpTypes } from "@medusajs/types"
import { useInfiniteQuery } from "@tanstack/react-query"
import { useMemo } from "react"

const PRODUCT_LIMIT = 12

type ProductPage = {
  response: { products: HttpTypes.StoreProduct[]; count: number }
  nextPage: number | null
}

type UseCategoryProductsParams = {
  sortBy: SortOptions
  countryCode: string
  categoryIds?: string[]
  collectionId?: string
  productsIds?: string[]
  initialProducts: HttpTypes.StoreProduct[]
  initialNextPage: number | null
  totalCount: number
}

/**
 * 카테고리 상품을 무한 로드함. 첫 페이지는 서버에서 받은 initialData 로 채우고,
 * 2페이지부터 listProducts/listProductsSorted 를 호출함
 */
export function useCategoryProducts({
  sortBy,
  countryCode,
  categoryIds,
  collectionId,
  productsIds,
  initialProducts,
  initialNextPage,
  totalCount,
}: UseCategoryProductsParams) {
  const { data, error, isFetchingNextPage, fetchNextPage, hasNextPage } =
    useInfiniteQuery<ProductPage, Error>({
      queryKey: [
        "category-products",
        sortBy,
        countryCode,
        categoryIds ?? null,
        collectionId ?? null,
        productsIds ?? null,
      ],
      initialPageParam: 1,
      getNextPageParam: (lastPage) => lastPage.nextPage ?? undefined,
      queryFn: async ({ pageParam }) => {
        const page = pageParam as number

        if (isSortedOption(sortBy)) {
          const { sortBy: mappedSortBy, order } = mapSortParams(sortBy)
          const result = await listProductsSorted({
            pageParam: page,
            sortBy: mappedSortBy,
            order,
            countryCode,
            categoryId: categoryIds,
            collectionId,
            limit: PRODUCT_LIMIT,
          })
          return { response: result.response, nextPage: result.nextPage }
        }

        const result = await listProducts({
          pageParam: page,
          countryCode,
          queryParams: {
            limit: PRODUCT_LIMIT,
            category_id: categoryIds,
            collection_id: collectionId ? [collectionId] : undefined,
            id: productsIds,
          },
        })
        return { response: result.response, nextPage: result.nextPage }
      },
      initialData: {
        pages: [
          {
            response: { products: initialProducts, count: totalCount },
            nextPage: initialNextPage,
          },
        ],
        pageParams: [1],
      },
      initialDataUpdatedAt: Date.now(),
    })

  const allProducts = useMemo(
    () => (data ? data.pages.flatMap((p) => p.response.products) : []),
    [data]
  )

  return { allProducts, error, isFetchingNextPage, fetchNextPage, hasNextPage }
}
