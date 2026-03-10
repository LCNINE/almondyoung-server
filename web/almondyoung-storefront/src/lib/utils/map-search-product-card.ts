import type { SearchServiceProductItem } from "@/lib/types/dto/search"
import type { ProductCard } from "@/lib/types/ui/product"
import { shouldHideWelcomeMembershipProductByTitle } from "@/lib/utils/welcome-membership-visibility"

/**
 * search 서비스 검색 결과 아이템을 ProductCard UI 타입으로 변환
 */
export const mapSearchItemToCard = (
  item: SearchServiceProductItem
): ProductCard => {
  return {
    id: item.productId,
    name: item.name,
    thumbnail: item.thumbnail ?? "",
    basePrice: item.minBasePrice ?? undefined,
    membershipPrice: item.minMembershipPrice ?? undefined,
    actualPrice: item.minMembershipPrice ?? item.minBasePrice ?? undefined,
    status: "active",
    brand: item.brand ?? undefined,
    tags: [],
  }
}

/**
 * search 서비스 검색 결과 배열을 ProductCard 배열로 변환
 */
export const mapSearchItemsToCards = (
  items: SearchServiceProductItem[]
): ProductCard[] =>
  items
    // 일단 임시로 웰컴멤버십 노출 안되게
    .filter((item) => !shouldHideWelcomeMembershipProductByTitle(item.name))
    .map(mapSearchItemToCard)
