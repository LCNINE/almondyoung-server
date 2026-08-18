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

/**
 * metadata(`shippingGroupCode`)에서 배송비 그룹 코드를 읽는다. 상품 상세·장바구니·주문서가
 * 전부 이 판정을 거쳐야 화면마다 다른 그룹으로 읽는 사고가 안 난다.
 */
export function resolveShippingGroupCodeFromMetadata(
  metadata: Record<string, unknown> | null | undefined
): string {
  const raw = metadata?.shippingGroupCode
  return typeof raw === "string" && raw.trim().length > 0
    ? raw.trim()
    : DEFAULT_SHIPPING_GROUP_CODE
}
