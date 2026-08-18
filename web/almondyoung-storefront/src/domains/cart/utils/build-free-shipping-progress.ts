import {
  resolveShippingGroupCodeFromMetadata,
  type ShippingGroup,
} from "../../../lib/api/medusa/shipping-group-types"
import { itemRequiresShipping } from "../../../lib/api/medusa/shipping-method-policy"

export type FreeShippingLineItem = {
  unit_price?: number | null
  quantity?: number | null
  requires_shipping?: boolean | null
  product_type?: string | null
  product?: { metadata?: Record<string, unknown> | null } | null
}

export type FreeShippingProgressEntry = {
  groupCode: string
  groupName: string
  threshold: number
  subtotal: number
  reached: boolean
  remaining: number
  /** 0~100 */
  percent: number
}

export function resolveShippingGroupCode(item: FreeShippingLineItem): string {
  return resolveShippingGroupCodeFromMetadata(item.product?.metadata)
}

/**
 * 배송비 그룹별 무료배송 진행 상태.
 *
 * 무료 판정은 **그 그룹 상품들의 합계**로 한다. 카트 전체 합계로 계산하면 그룹을 나눈 의미가
 * 사라진다 (간편식 3천원 + 일반 6만원인데 간편식 배송비까지 무료가 되는 식).
 * 조건부 무료 정책이 아닌 그룹과, 담긴 상품이 없는 그룹은 진행바를 그리지 않는다.
 */
export function buildFreeShippingProgress(
  items: FreeShippingLineItem[] | null | undefined,
  groups: ShippingGroup[] | null | undefined
): FreeShippingProgressEntry[] {
  const subtotalByGroup = new Map<string, number>()

  for (const item of items ?? []) {
    if (!itemRequiresShipping(item)) continue
    const code = resolveShippingGroupCode(item)
    const lineTotal = (item.unit_price ?? 0) * (item.quantity ?? 0)
    subtotalByGroup.set(code, (subtotalByGroup.get(code) ?? 0) + lineTotal)
  }

  return (groups ?? [])
    .filter((group) => group.policy.type === "conditional_free")
    .map((group) => {
      const threshold = group.policy.freeThreshold ?? 0
      const subtotal = subtotalByGroup.get(group.code) ?? 0
      return {
        groupCode: group.code,
        groupName: group.name,
        threshold,
        subtotal,
        reached: subtotal >= threshold,
        remaining: Math.max(0, threshold - subtotal),
        percent:
          threshold > 0
            ? Math.min(100, Math.round((subtotal / threshold) * 100))
            : 100,
      }
    })
    .filter((entry) => entry.threshold > 0 && entry.subtotal > 0)
}
