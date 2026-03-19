import { FIXED_CATEGORIES } from "@/lib/constants/categories"
import { getRegion } from "@/lib/api/medusa/regions"
import { CategoryBestSection } from "../../components/category-best-section"
import { listProducts } from "@/lib/api/medusa/products"
import { retrieveCustomer } from "@/lib/api/medusa/customer"
import { getWishlist } from "@lib/api/users/wishlist"
import { getBestProductRankings } from "@lib/api/analytics"

export async function CategoryBestProductsWrapper({
  countryCode,
}: {
  countryCode: string
}) {
  const region = await getRegion(countryCode)

  //  엘라스틱에서 베스트 상품 랭킹 조회 (masterId = Medusa handle)
  const bestRankings = await getBestProductRankings({
    categoryId: FIXED_CATEGORIES[0].id,
    limit: 10,
  })

  // 베스트 상품이 없으면 빈 섹션 반환
  if (!bestRankings.length) {
    return null
  }

  // masterId(handle)들로 Medusa 상품 조회
  const handles = bestRankings.map((item) => item.masterId)

  const {
    response: { products },
  } = await listProducts({
    queryParams: {
      handle: handles,
      limit: handles.length,
    },
    regionId: region?.id,
  })

  //  엘라스틱 랭킹 순서대로 정렬
  const handleOrder = new Map(handles.map((handle, index) => [handle, index]))
  const sortedProducts = [...products].sort((a, b) => {
    const orderA = handleOrder.get(a.handle ?? "") ?? Infinity
    const orderB = handleOrder.get(b.handle ?? "") ?? Infinity
    return orderA - orderB
  })

  const customer = await retrieveCustomer()

  // 로그인한 경우에만 위시리스트 조회
  const wishlist = customer ? await getWishlist().catch(() => []) : []
  const wishlistIds = new Set(wishlist.map((item) => item.productId))

  return (
    <CategoryBestSection
      initialProducts={sortedProducts}
      regionId={region?.id}
      customer={customer}
      wishlistIds={wishlistIds}
    />
  )
}
