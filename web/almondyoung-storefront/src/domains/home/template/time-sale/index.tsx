import { getActiveTimeSale } from "@/lib/api/medusa/time-sale"
import { listCategories } from "@/lib/api/medusa/categories"
import { listProducts } from "@/lib/api/medusa/products"
import { retrieveCustomer } from "@/lib/api/medusa/customer"
import { getRegion } from "@/lib/api/medusa/regions"
import { FIXED_CATEGORIES } from "@/lib/constants/categories"
import { PRODUCT_LIST_FIELDS_WITH_CATEGORIES } from "@lib/data/product-fields"
import { collectCategoryIds } from "@/lib/utils/collect-category-ids"
import { deriveTimeSaleTabs } from "@/lib/utils/time-sale-tabs"
import { getWishlist } from "@lib/api/users/wishlist"
import { getTranslations } from "next-intl/server"
import { TimeSaleSection } from "../../components/sections/time-sale-section"

/** 세일 상품은 수십 개 규모라 한 번에 받는다. 넘치면 캐러셀이 잘라 보여준다. */
const MAX_PRODUCTS = 100

export async function TimeSaleWrapper({ countryCode }: { countryCode: string }) {
  const timeSale = await getActiveTimeSale()
  if (!timeSale || timeSale.productIds.length === 0 || !timeSale.endsAt) return null

  const region = await getRegion(countryCode)

  const {
    response: { products },
  } = await listProducts({
    queryParams: {
      id: timeSale.productIds.slice(0, MAX_PRODUCTS),
      limit: MAX_PRODUCTS,
      // 탭을 상품의 카테고리에서 역산하므로 기본 필드에 카테고리를 얹는다.
      fields: PRODUCT_LIST_FIELDS_WITH_CATEGORIES,
    },
    regionId: region?.id,
  })

  if (products.length === 0) return null

  const [customer, categories, t] = await Promise.all([
    retrieveCustomer(),
    listCategories(),
    getTranslations("home.timeSale"),
  ])

  const rootHandles = new Set<string>(FIXED_CATEGORIES.map((category) => category.handle))
  const sources = categories
    .filter((category) => rootHandles.has(category.handle))
    .map((category) => {
      const fixed = FIXED_CATEGORIES.find(
        (item) => (item.handle as string) === category.handle
      )!
      return {
        key: fixed.key,
        name: category.name,
        handle: category.handle,
        categoryIds: collectCategoryIds(category),
      }
    })

  const tabs = deriveTimeSaleTabs(
    products.map((product) => ({
      id: product.id,
      categoryIds: (product.categories ?? []).map((category) => category.id),
    })),
    sources,
    t("allTab")
  )

  const wishlist = customer ? await getWishlist().catch(() => []) : []

  return (
    <TimeSaleSection
      endsAt={timeSale.endsAt}
      products={products}
      tabs={tabs}
      customer={customer}
      wishlistIds={new Set(wishlist.map((item) => item.productId))}
    />
  )
}
