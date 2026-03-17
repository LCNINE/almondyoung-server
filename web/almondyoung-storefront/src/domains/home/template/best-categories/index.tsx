import { FIXED_CATEGORIES } from "@/lib/constants/categories"
import { getRegion } from "@/lib/api/medusa/regions"
import { CategoryBestSection } from "../../components/category-best-section"
import { listProducts } from "@/lib/api/medusa/products"
import { retrieveCustomer } from "@/lib/api/medusa/customer"
import { getWishlist } from "@lib/api/users/wishlist"

export async function CategoryBestSWrapper({
  countryCode,
}: {
  countryCode: string
}) {
  const region = await getRegion(countryCode)

  const {
    response: { products },
  } = await listProducts({
    queryParams: {
      category_id: FIXED_CATEGORIES[0].id,
      limit: 10,
    },
    regionId: region?.id,
  })

  const customer = await retrieveCustomer()

  // 로그인한 경우에만 위시리스트 조회
  const wishlist = customer ? await getWishlist().catch(() => []) : []
  const wishlistIds = new Set(wishlist.map((item) => item.productId))

  return (
    <CategoryBestSection
      initialProducts={products}
      regionId={region?.id}
      customer={customer}
      wishlistIds={wishlistIds}
    />
  )
}
