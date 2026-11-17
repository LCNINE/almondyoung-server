// 홈 브랜드관 섹션의 순수 데이터 가공. 페치·URL 변환은 index.tsx 가 맡는다.

import {
  filterProductsByMembershipVisibility,
  mapStoreProductToCardProps,
} from "@/lib/utils/product-card"
import type { StoreProduct } from "@medusajs/types"
import type {
  BrandGroup,
  BrandTile,
  BrandTileCategory,
} from "./select-brand-tiles"

export interface BrandHallProduct {
  id: string
  handle: string
  title: string
  thumbnail: string | null
  price: number
  /** 보여줘도 되고 지금 가격보다 쌀 때만 값이 있다 */
  membershipPrice: number | null
}

/** 탭 없이 한 판에 깔기 위해 그룹을 펼친다. 여러 그룹에 걸린 브랜드는 한 번만. */
export function flattenBrandTiles<T extends BrandTileCategory>(
  groups: BrandGroup<T>[],
  max: number
): BrandTile<T>[] {
  const seen = new Set<string>()
  const tiles: BrandTile<T>[] = []

  for (const group of groups) {
    for (const tile of group.brands) {
      if (seen.has(tile.category.id)) continue

      seen.add(tile.category.id)
      tiles.push(tile)
    }
  }

  return tiles.slice(0, max)
}

/** 브랜드 아래 하위 카테고리에만 걸린 상품도 잡히도록 자손 id 를 모두 모은다. */
export function collectBrandCategoryIds(category: BrandTileCategory): string[] {
  const ids = [category.id]

  for (const child of category.category_children ?? []) {
    ids.push(...collectBrandCategoryIds(child))
  }

  return ids
}

/**
 * 판매량순으로 받은 상품에서 카드에 올릴 몇 개를 고른다.
 * 회원 전용 노출 상품은 비회원에게서 빼고, 재고 있는 상품을 앞에 둔다
 * (같은 재고 상태 안에서는 판매량 순서를 지킨다). 품절만 있으면 품절이라도 채운다.
 */
export function pickTopBrandProducts(
  products: StoreProduct[],
  isMembership: boolean,
  limit = 3
): BrandHallProduct[] {
  const mapped = filterProductsByMembershipVisibility(products, isMembership)
    .map((product) => {
      const card = mapStoreProductToCardProps(product, undefined, isMembership)
      if (!card) return null

      const membershipPrice = card.debugPrices?.membershipPrice ?? 0
      const canShowMembershipPrice = isMembership || !card.isMembershipOnly

      return {
        inStock: !card.manageInventory || (card.available ?? 0) > 0,
        item: {
          id: product.id,
          handle: product.handle ?? product.id,
          title: card.title,
          thumbnail: product.thumbnail || null,
          price: card.price,
          membershipPrice:
            canShowMembershipPrice &&
            membershipPrice > 0 &&
            membershipPrice < card.price
              ? membershipPrice
              : null,
        },
      }
    })
    .filter((entry) => entry !== null)

  const inStock = mapped.filter((entry) => entry.inStock)
  const soldOut = mapped.filter((entry) => !entry.inStock)

  return [...inStock, ...soldOut].slice(0, limit).map((entry) => entry.item)
}
