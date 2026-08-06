/**
 * 배송비 그룹 타입. `shipping-groups.ts` 는 "use server" 라 async 함수만 export 할 수 있어서
 * 타입·상수는 여기에 둔다.
 */

export type ShippingFeeType =
  | "free"
  | "flat"
  | "conditional_free"
  | "per_quantity"

export type ShippingFeePolicy = {
  type: ShippingFeeType
  baseFee: number
  freeThreshold?: number
  jejuExtraFee?: number
  islandExtraFee?: number
}

/** 배송 안내용 정보. 배송비 계산에는 영향이 없고 상품 상세에 그대로 표시된다. */
export type ShippingGroupDelivery = {
  method: string
  area: string
  leadTimeMinDays: number
  leadTimeMaxDays: number
}

export type ShippingGroup = {
  code: string
  name: string
  policy: ShippingFeePolicy
  delivery?: ShippingGroupDelivery
}

export const DEFAULT_SHIPPING_GROUP_CODE = "default"
