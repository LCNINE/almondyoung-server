import { FIXED_CATEGORIES } from "@/lib/constants/categories"
import { getRegion } from "@/lib/api/medusa/regions"
import { CategoryBestSection } from "../../components/sections/category-best-section"
import { retrieveCustomer } from "@/lib/api/medusa/customer"
import { getWishlist } from "@lib/api/users/wishlist"
import { getBestProductsByCategory } from "../../actions"

export async function CategoryBestProductsWrapper({
  countryCode,
}: {
  countryCode: string
}) {
  const region = await getRegion(countryCode)

  const orderedProducts = await getBestProductsByCategory({
    pimCategoryId: FIXED_CATEGORIES[0].pimCategoryId,
    fallbackCategoryId: FIXED_CATEGORIES[0].id,
    regionId: region?.id,
    limit: 10,
  })

  const customer = await retrieveCustomer()

  // 로그인한 경우에만 위시리스트 조회
  const wishlist = customer ? await getWishlist().catch(() => []) : []
  const wishlistIds = new Set(wishlist.map((item) => item.productId))

  return (
    <CategoryBestSection
      initialProducts={orderedProducts}
      regionId={region?.id}
      customer={customer}
      wishlistIds={wishlistIds}
    />
  )
}
