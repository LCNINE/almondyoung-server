"use server"

import { retrieveCustomer } from "@/lib/api/medusa/customer"
import { listProductsSorted } from "@/lib/api/medusa/products"
import { getThumbnailUrl } from "@/lib/utils/get-thumbnail-url"
import { type BrandHallProduct, pickTopBrandProducts } from "./brand-hall-data"

// 회원 전용 노출·품절을 걷어내고도 3개를 채우려고 조금 더 받는다.
const FETCH_PER_BRAND = 8
const FEATURED_PER_BRAND = 3

/** 고른 브랜드의 판매량 상위 상품 3개. 홈 첫 화면은 첫 브랜드만 받고 나머지는 로고를 누를 때 이걸 부른다 */
export async function loadBrandFeaturedProducts(
  categoryIds: string[]
): Promise<BrandHallProduct[]> {
  const [products, customer] = await Promise.all([
    listProductsSorted({
      categoryId: categoryIds,
      sortBy: "sales_count",
      order: "desc",
      limit: FETCH_PER_BRAND,
    })
      .then(({ response }) => response.products)
      .catch(() => []),
    retrieveCustomer().catch(() => null),
  ])

  const isMembership =
    customer?.groups?.some(
      (group) => group.id === process.env.NEXT_PUBLIC_MEDUSA_MEMBERSHIP_GROUP_ID
    ) ?? false

  return pickTopBrandProducts(products, isMembership, FEATURED_PER_BRAND).map(
    (product) => ({
      ...product,
      thumbnail: product.thumbnail ? getThumbnailUrl(product.thumbnail) : null,
    })
  )
}
