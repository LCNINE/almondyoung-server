import {
  getHideMembershipPriceForNonMembers,
  mapStoreProductToCardProps,
} from "@/lib/utils/product-card"
import { pickComingSoon } from "@/domains/products/product-details/components/product-actions/coming-soon"
import type { StoreProduct } from "@medusajs/types"

export type V1CardItem = {
  id: string
  handle: string
  title: string
  imageSrc: string
  /** 지금 내는 값 (할인 반영) */
  price: number
  /** 정가 */
  regularPrice: number
  /** 정가보다 싼 멤버십가. 없거나 비회원에게 숨긴 상품이면 null */
  membershipPrice: number | null
  comingSoon: { date: string | null } | null
}

export function toV1CardItem(
  product: StoreProduct,
  isMember: boolean
): V1CardItem | null {
  const props = mapStoreProductToCardProps(product, undefined, isMember)
  if (!props) return null

  const rawMembershipPrice = props.debugPrices?.membershipPrice ?? 0
  const hidden = !isMember && getHideMembershipPriceForNonMembers(product)

  return {
    id: props.id,
    handle: props.handle,
    title: props.title,
    imageSrc: props.imageSrc,
    price: props.price,
    regularPrice: props.originalPrice,
    membershipPrice:
      rawMembershipPrice > 0 && !hidden ? rawMembershipPrice : null,
    comingSoon: pickComingSoon(product.variants),
  }
}

export function toV1CardItems(
  products: StoreProduct[],
  isMember: boolean
): V1CardItem[] {
  return products
    .map((product) => toV1CardItem(product, isMember))
    .filter((item): item is V1CardItem => item !== null)
}

export type MemberSavingItem = V1CardItem & {
  membershipPrice: number
  saving: number
}

/** 멤버십가가 정가보다 싼 상품만 아끼는 돈이 큰 순서로 */
export function pickBiggestMemberSavings(
  items: V1CardItem[],
  limit: number
): MemberSavingItem[] {
  return items
    .flatMap((item) =>
      item.membershipPrice !== null && item.membershipPrice < item.regularPrice
        ? [
            {
              ...item,
              membershipPrice: item.membershipPrice,
              saving: item.regularPrice - item.membershipPrice,
            },
          ]
        : []
    )
    .sort((a, b) => b.saving - a.saving)
    .slice(0, limit)
}
