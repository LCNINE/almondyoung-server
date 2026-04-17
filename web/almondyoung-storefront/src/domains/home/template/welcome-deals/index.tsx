import { getCategoryByHandle } from "@/lib/api/medusa/categories"
import { retrieveCustomer } from "@/lib/api/medusa/customer"
import { listProducts } from "@/lib/api/medusa/products"
import { getRegion } from "@/lib/api/medusa/regions"
import { collectCategoryIds } from "@/lib/utils/collect-category-ids"
import { getWishlist } from "@lib/api/users/wishlist"
import { WelcomeDealSection } from "../../components/sections/welcome-deal-section"

const WELCOME_DEAL_HANDLE = "100won-welkeomdil"

export async function WelcomeDealWrapper({
  countryCode,
}: {
  countryCode: string
}) {
  const [region, category, customer] = await Promise.all([
    getRegion(countryCode),
    getCategoryByHandle([WELCOME_DEAL_HANDLE]),
    retrieveCustomer(),
  ])

  if (!category) return null

  const categoryIds = collectCategoryIds(category)

  const {
    response: { products },
  } = await listProducts({
    queryParams: {
      category_id: categoryIds,
      limit: 10,
    },
    regionId: region?.id,
  })

  // 로그인한 경우에만 위시리스트 조회
  const wishlist = customer ? await getWishlist().catch(() => []) : []
  const wishlistIds = new Set(wishlist.map((item) => item.productId))

  return (
    <WelcomeDealSection
      products={products}
      customer={customer}
      moreHref={`/category/${WELCOME_DEAL_HANDLE}`}
      wishlistIds={wishlistIds}
    />
  )
}
