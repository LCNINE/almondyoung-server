"use client"

import { ShippingGroupNoticeLine } from "@/components/shared/shipping-group-notice-line"
import { useShippingGroups } from "@/contexts/shipping-groups-context"
import { itemRequiresShipping } from "@/lib/api/medusa/shipping-method-policy"
import { resolveShippingGroupNotice } from "@/lib/utils/shipping-group-notice"

import { type FreeShippingLineItem } from "../../utils/build-free-shipping-progress"

interface ShippingGroupNoticeProps {
  item: FreeShippingLineItem
  className?: string
}

/**
 * 장바구니/주문서 라인의 개별 배송비 그룹 안내.
 *
 * 배송비는 그룹별로 따로 붙는데 장바구니/주문서엔 합산 한 줄만 보여서, 기본 그룹이 무료배송이어도
 * 개별 그룹 상품 몫이 청구되면 고객이 이유를 알 수 없다. 어떤 그룹을 어떻게 그릴지는
 * `resolveShippingGroupNotice` 한 곳에서 정한다.
 */
export function ShippingGroupNotice({ item, className }: ShippingGroupNoticeProps) {
  const groups = useShippingGroups()

  if (!itemRequiresShipping(item)) return null

  return (
    <ShippingGroupNoticeLine
      notice={resolveShippingGroupNotice(item.product?.metadata, groups)}
      className={className}
    />
  )
}
