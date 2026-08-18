"use client"

import { ShippingGroupNoticeLine } from "@/components/shared/shipping-group-notice-line"
import { useShippingGroups } from "@/contexts/shipping-groups-context"
import {
  isDigitalProduct,
  type DigitalProductInput,
} from "@/lib/api/medusa/shipping-method-policy"
import { resolveShippingGroupNotice } from "@/lib/utils/shipping-group-notice"

interface ProductShippingNoticeProps {
  product: DigitalProductInput
  className?: string
}

/**
 * 상품 상세의 개별 배송비 그룹 안내.
 *
 * 배송비 안내가 접힌 아코디언 안에만 있으면 고객이 개별 배송비를 모른 채 담는다(#661).
 * 담기 전에 보이는 가격 영역 근처에 장바구니/주문서와 같은 문구로 한 줄 노출한다.
 * 기본 그룹·무료 그룹·그룹 미상은 그리지 않고, 배송이 없는 디지털 상품도 그리지 않는다.
 */
export function ProductShippingNotice({
  product,
  className,
}: ProductShippingNoticeProps) {
  const groups = useShippingGroups()

  if (isDigitalProduct(product)) return null

  return (
    <ShippingGroupNoticeLine
      notice={resolveShippingGroupNotice(product.metadata, groups)}
      className={className}
    />
  )
}
