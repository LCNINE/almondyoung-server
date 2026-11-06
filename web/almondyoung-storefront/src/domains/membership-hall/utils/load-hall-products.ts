import "server-only"
import type { HttpTypes } from "@medusajs/types"
import { fetchProductsByIds } from "@/domains/home/template/time-sale/fetch-products"
import { retrieveCustomer } from "@/lib/api/medusa/customer"
import { getMembershipHall } from "@/lib/api/medusa/membership-hall"
import { getRegion } from "@/lib/api/medusa/regions"
import type {
  MembershipHallSort,
  MembershipHallTab,
} from "@/lib/types/ui/membership-hall"
import { isMembershipGroup } from "@/lib/utils/membership-group"
import { getWishlist } from "@lib/api/users/wishlist"

/**
 * 멤버십관 id 목록을 받아 그 순서대로 `/store/products` 로 상품을 채운다. 상품 조회를 따로 거치는 이유는
 * 멤버십가 은닉·구매 게이트·가격 계산이 다른 목록과 똑같이 걸리게 하려는 것이다.
 */
export async function loadHallProducts({
  countryCode,
  tab,
  sort,
  category,
  limit,
  offset,
}: {
  countryCode: string
  tab: MembershipHallTab
  sort: MembershipHallSort
  category?: string
  limit: number
  offset: number
}) {
  const [region, customer, hall] = await Promise.all([
    getRegion(countryCode),
    retrieveCustomer().catch(() => null),
    getMembershipHall({ tab, sort, category, limit, offset }),
  ])

  const [fetched, wishlist] = await Promise.all([
    hall.productIds.length > 0
      ? fetchProductsByIds(hall.productIds, region?.id)
      : Promise.resolve<HttpTypes.StoreProduct[]>([]),
    customer ? getWishlist().catch(() => []) : Promise.resolve([]),
  ])

  const byId = new Map(fetched.map((product) => [product.id, product]))
  const products = hall.productIds.flatMap((id) => {
    const product = byId.get(id)

    return product ? [product] : []
  })

  return {
    hall,
    products,
    isMember: isMembershipGroup(customer?.groups),
    wishlistIds: wishlist.map((item) => item.productId),
  }
}
