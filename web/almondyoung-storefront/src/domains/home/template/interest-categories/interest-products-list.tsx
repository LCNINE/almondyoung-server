import { retrieveCustomer } from "@/lib/api/medusa/customer"
import { getRegion } from "@/lib/api/medusa/regions"
import { getWishlist } from "@/lib/api/users/wishlist"
import { FIXED_CATEGORIES } from "@/lib/constants/categories"
import { getBestProductsByCategory } from "@/domains/home/actions"
import { InterestProductSection } from "@/domains/home/components/interest/interest-product-section"
import type { HttpTypes } from "@medusajs/types"

interface InterestProductsListProps {
  countryCode: string
  selectedKeys: string[]
}

type Section = {
  cat: (typeof FIXED_CATEGORIES)[number]
  products: HttpTypes.StoreProduct[]
}

/*───────────────────────────
 * 관심 카테고리 1~3개의 베스트 상품 섹션을 SSR 병렬 fetch.
 * 첫 섹션 헤더에만 "편집" 버튼 노출.
 *──────────────────────────*/
export async function InterestProductsList({
  countryCode,
  selectedKeys,
}: InterestProductsListProps) {
  const region = await getRegion(countryCode)
  const customer = await retrieveCustomer()
  const wishlist = customer ? await getWishlist().catch(() => []) : []
  const wishlistIds = new Set(wishlist.map((item) => item.productId))

  const sections = (await Promise.all(
    selectedKeys.map(async (key) => {
      const cat = FIXED_CATEGORIES.find((c) => c.key === key)
      if (!cat) return null

      const products = await getBestProductsByCategory({
        categoryId: cat.id,
        regionId: region?.id,
        limit: 10,
      })
      return { cat, products }
    })
  )).filter((s): s is Section => s !== null)

  if (sections.length === 0) return null

  return (
    <div className="space-y-8 md:space-y-12">
      {sections.map((section, i) => (
        <InterestProductSection
          key={section.cat.key}
          category={{
            key: section.cat.key,
            name: section.cat.name,
            handle: section.cat.handle,
          }}
          products={section.products}
          customer={customer}
          wishlistIds={wishlistIds}
          selectedKeys={selectedKeys}
          showEditButton={i === 0}
        />
      ))}
    </div>
  )
}
