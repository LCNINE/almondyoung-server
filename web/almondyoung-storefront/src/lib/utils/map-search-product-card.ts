import type { ProductSearchItemDto } from "@/lib/types/dto/pim"
import type { ProductCard } from "@/lib/types/ui/product"

/**
 * Elasticsearch 검색 결과 아이템을 ProductCard UI 타입으로 변환
 */
export const mapSearchItemToCard = (
  item: ProductSearchItemDto
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
 * Elasticsearch 검색 결과 배열을 ProductCard 배열로 변환
 */
export const mapSearchItemsToCards = (
  items: ProductSearchItemDto[]
): ProductCard[] => items.map(mapSearchItemToCard)
