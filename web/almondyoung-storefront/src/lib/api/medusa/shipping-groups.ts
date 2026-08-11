"use server"

import { sdk } from "@/lib/config/medusa"
import { getCacheOptions } from "@lib/data/cookies"
import type { ShippingGroup } from "./shipping-group-types"
import { buildShippingGroupsFetchOptions } from "./shipping-groups-cache"

/**
 * 배송비 그룹 정책 목록.
 *
 * 상품상세의 배송비 안내와 장바구니 무료배송 진행바가 쓴다. /store/shipping-options 는 cart_id 가
 * 필수라 카트 없이는 쓸 수 없어서 별도 엔드포인트를 둔다. 금액의 단일 진실은 Medusa 배송옵션이다.
 *
 * 호출 지점은 루트 레이아웃이라 **모든 페이지의 모든 렌더**를 탄다. 캐시 정책을 빼면
 * 그대로 Medusa 부하가 되므로 `buildShippingGroupsFetchOptions` 를 거쳐야 한다.
 */
export const listShippingGroups = async (): Promise<ShippingGroup[]> => {
  const next = buildShippingGroupsFetchOptions(
    await getCacheOptions("fulfillment")
  )

  return sdk.client
    .fetch<{ shipping_groups: ShippingGroup[] }>("/store/shipping-groups", {
      method: "GET",
      next,
    })
    .then(({ shipping_groups }) => shipping_groups ?? [])
    .catch(() => [])
}
