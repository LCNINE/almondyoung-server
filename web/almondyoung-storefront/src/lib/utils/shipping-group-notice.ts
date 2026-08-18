import {
  DEFAULT_SHIPPING_GROUP_CODE,
  resolveShippingGroupCodeFromMetadata,
  type ShippingGroup,
} from "../api/medusa/shipping-group-types"

export type ShippingGroupNoticeContent =
  | { key: "flat" | "perQuantity"; group: string; amount: number; description?: string }
  | {
      key: "conditionalFree"
      group: string
      amount: number
      threshold: number
      description?: string
    }

/**
 * 개별 배송비 그룹 안내 문구의 재료. 상품 상세·장바구니·주문서가 같은 판정으로 같은 말을 하도록
 * 여기 한 곳에서만 정한다.
 *
 * 기본 그룹은 무료배송 진행바가 이미 설명하므로 그리지 않고, 무료(free) 정책 그룹과
 * 그룹을 못 찾은 경우(정책을 모르면 조용한 쪽이 거짓말보다 낫다)도 그리지 않는다.
 */
export function resolveShippingGroupNotice(
  metadata: Record<string, unknown> | null | undefined,
  groups: ShippingGroup[] | null | undefined
): ShippingGroupNoticeContent | null {
  const code = resolveShippingGroupCodeFromMetadata(metadata)
  if (code === DEFAULT_SHIPPING_GROUP_CODE) return null

  const group = (groups ?? []).find((candidate) => candidate.code === code)
  if (!group) return null

  const { policy } = group
  const description = group.description?.trim() || undefined
  switch (policy.type) {
    case "flat":
      return { key: "flat", group: group.name, amount: policy.baseFee, description }
    case "per_quantity":
      return {
        key: "perQuantity",
        group: group.name,
        amount: policy.baseFee,
        description,
      }
    case "conditional_free":
      return {
        key: "conditionalFree",
        group: group.name,
        amount: policy.baseFee,
        threshold: policy.freeThreshold ?? 0,
        description,
      }
    default:
      return null
  }
}
