import {
  resolveShippingGroupCodeFromMetadata,
  type ShippingGroup,
  type ShippingGroupDelivery,
} from "../../../../lib/api/medusa/shipping-group-types"

export type ShippingFeeDescription =
  | { kind: "unknown" }
  | { kind: "free" }
  | { kind: "flat"; amount: number }
  | { kind: "conditionalFree"; amount: number; threshold: number }
  | { kind: "perQuantity"; amount: number }

/**
 * 상품 상세에 표시할 배송비 문구의 재료.
 *
 * 예전엔 "배송 비용 : 2,500원" 이 i18n 문자열에 박혀 있어서 배송비 그룹이 다른 상품에서
 * 그냥 거짓말이 됐다. 상품 metadata 의 그룹 코드로 실제 정책을 찾아 쓴다.
 */
export function describeShippingFee(
  productMetadata: Record<string, unknown> | null | undefined,
  groups: ShippingGroup[] | null | undefined
): ShippingFeeDescription {
  const code = resolveShippingGroupCodeFromMetadata(productMetadata)

  const group = (groups ?? []).find((candidate) => candidate.code === code)
  if (!group) return { kind: "unknown" }

  const { policy } = group
  switch (policy.type) {
    case "free":
      return { kind: "free" }
    case "flat":
      return { kind: "flat", amount: policy.baseFee }
    case "conditional_free":
      return {
        kind: "conditionalFree",
        amount: policy.baseFee,
        threshold: policy.freeThreshold ?? 0,
      }
    case "per_quantity":
      return { kind: "perQuantity", amount: policy.baseFee }
    default:
      return { kind: "unknown" }
  }
}

/** 상품 metadata 의 그룹 코드로 배송 안내(택배·전국지역·2~3일)를 찾는다. */
export function findShippingGroupDelivery(
  productMetadata: Record<string, unknown> | null | undefined,
  groups: ShippingGroup[] | null | undefined
): ShippingGroupDelivery | null {
  const code = resolveShippingGroupCodeFromMetadata(productMetadata)
  return (groups ?? []).find((group) => group.code === code)?.delivery ?? null
}
