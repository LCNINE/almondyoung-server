import type { ProductSearchItemDto } from "@/lib/types/dto/pim"
import type { ProductCard } from "@/lib/types/ui/product"

/**
 * Elasticsearch 검색 결과 아이템을 ProductCard UI 타입으로 변환
 */
export const mapSearchItemToCard = (
  item: ProductSearchItemDto
): ProductCard => {
  return {
    id: item.master_id,
    name: item.name,
    thumbnail: "", // 검색 결과에는 썸네일이 없음 - 별도 조회 필요
    basePrice: item.price ?? undefined,
    membershipPrice: undefined, // 검색 결과에는 멤버십 가격 미포함
    actualPrice: item.price ?? undefined,
    status: item.status === "active" ? "active" : "inactive",
    brand: item.brand ?? undefined,
    tags: item.tags?.map((tag) => tag.value_name) ?? [],
    createdAt: item.created_at,
  }
}

/**
 * Elasticsearch 검색 결과 배열을 ProductCard 배열로 변환
 */
export const mapSearchItemsToCards = (
  items: ProductSearchItemDto[]
): ProductCard[] => items.map(mapSearchItemToCard)
