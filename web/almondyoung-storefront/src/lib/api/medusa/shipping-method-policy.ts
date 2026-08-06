export type CartShippingPolicyItem = {
  requires_shipping?: boolean | null
  product_type?: string | null
}

export type CartShippingPolicyOption = {
  id: string
  /** 배송비 그룹. Medusa 는 카트에 담긴 profile 마다 배송수단을 하나씩 요구한다. */
  shipping_profile_id?: string | null
  type?: {
    code?: string | null
  } | null
}

export function itemRequiresShipping(item: CartShippingPolicyItem): boolean {
  if (typeof item.requires_shipping === "boolean") {
    return item.requires_shipping
  }

  return item.product_type !== "digital_sale"
}

export function cartRequiresShipping(
  items?: CartShippingPolicyItem[] | null
): boolean {
  return Boolean(items?.some(itemRequiresShipping))
}

// 디지털(배송 불필요) 라인 여부. requires_shipping === false 우선, 없으면 product_type === 'digital_sale'.
export function isDigitalItem(item: CartShippingPolicyItem): boolean {
  return !itemRequiresShipping(item)
}

export type DigitalProductInput = {
  metadata?: Record<string, unknown> | null
  type?: { value?: string | null } | null
}

// 상품 단위 디지털 여부(PDP/카드용). metadata.fulfillmentKind / requiresShipping 우선, type.value='digital_sale' fallback.
export function isDigitalProduct(product?: DigitalProductInput | null): boolean {
  if (!product) return false
  const meta = product.metadata ?? {}
  if (meta.fulfillmentKind === "digital") return true
  if (meta.requiresShipping === false) return true
  return product.type?.value === "digital_sale"
}

/**
 * 카트가 실제로 요구하는 배송비 그룹(shipping profile) id 집합.
 *
 * `/store/shipping-options` 는 카트 profile 로 걸러주지 않고 배송권역의 모든 옵션을 준다.
 * 담기지도 않은 그룹의 배송수단이 붙는 걸 막으려면 카트 쪽에서 판정해야 한다.
 *
 * Medusa SDK 의 StoreProduct 타입에는 shipping_profile 이 없다 — fields 로 명시 요청해 받는
 * 값이라 런타임엔 있지만 타입에는 없어서, 이 한 곳에서만 좁혀 읽는다.
 */
export function collectRequiredShippingProfileIds(
  items?: CartShippingPolicyItem[] | null
): Set<string> {
  const ids = new Set<string>()
  for (const item of items ?? []) {
    if (!itemRequiresShipping(item)) continue
    const id = (item as { product?: { shipping_profile?: { id?: string | null } | null } | null })
      .product?.shipping_profile?.id
    if (id) ids.add(id)
  }
  return ids
}

/**
 * 카트에 붙여야 할 배송 옵션 목록. **배송비 그룹(shipping profile)마다 하나씩** 고른다.
 *
 * 그룹이 2개 이상 담긴 카트는 그룹마다 배송수단이 있어야 결제 완료를 통과한다
 * (core-flows 의 validateShippingStep). 하나만 붙이면 "The cart items require shipping
 * profiles that are not satisfied by the current shipping methods" 로 막힌다.
 */
export function selectShippingOptionsForCart<
  T extends CartShippingPolicyOption,
>(options: T[] | null | undefined, items?: CartShippingPolicyItem[] | null): T[] {
  if (!cartRequiresShipping(items)) {
    return []
  }

  const requiredProfileIds = collectRequiredShippingProfileIds(items)

  const byProfile = new Map<string, T>()
  for (const option of options ?? []) {
    if (option.type?.code !== "standard") continue
    const profileKey = option.shipping_profile_id ?? "__unknown_profile__"
    // profile 정보를 못 읽었으면(필드 미요청) 전부 유지 — 잘못 걸러 배송수단이 빠지면
    // 결제 자체가 막히므로 fail-open 이 안전하다.
    if (requiredProfileIds.size > 0 && !requiredProfileIds.has(profileKey)) {
      continue
    }
    if (!byProfile.has(profileKey)) {
      byProfile.set(profileKey, option)
    }
  }

  return Array.from(byProfile.values())
}

export type CartShippingMethodSnapshot = {
  shipping_option_id?: string | null
  amount?: number | string | null
}

function toAmount(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null
  const parsed = typeof value === "string" ? Number(value) : value
  return Number.isFinite(parsed) ? parsed : null
}

/**
 * 카트에 이미 붙은 배송수단이 지금 필요한 옵션과 **구성도 금액도** 같은지.
 *
 * 금액까지 보는 이유: 어드민이 배송비 그룹 금액을 고쳐도 이미 배송수단이 붙은 카트는 그대로
 * 남는다. Medusa 의 complete-cart 는 카트에 저장된 금액을 그대로 청구하므로(재계산 없음),
 * 구성만 비교하면 옛 금액이 결제될 수 있다. 금액이 다르면 다시 붙여 최신가로 맞춘다.
 *
 * 어느 한쪽 금액을 못 읽으면(필드 미요청) 금액 비교는 건너뛴다 — 판정 불가로 매번 다시 붙이면
 * 카트가 불필요하게 요동친다.
 */
export function shippingMethodsMatchOptions(
  currentMethods:
    | Array<string | null | undefined>
    | Array<CartShippingMethodSnapshot>
    | null
    | undefined,
  targetOptions: Array<{ id: string; amount?: number | string | null }>
): boolean {
  const normalized: CartShippingMethodSnapshot[] = (currentMethods ?? []).map((method) =>
    typeof method === "string" || method === null || method === undefined
      ? { shipping_option_id: method }
      : method
  )

  const amountByOptionId = new Map<string, number | null>()
  for (const method of normalized) {
    if (!method.shipping_option_id) continue
    amountByOptionId.set(method.shipping_option_id, toAmount(method.amount))
  }

  if (amountByOptionId.size !== targetOptions.length) return false

  return targetOptions.every((option) => {
    if (!amountByOptionId.has(option.id)) return false
    const currentAmount = amountByOptionId.get(option.id) ?? null
    const targetAmount = toAmount(option.amount)
    if (currentAmount === null || targetAmount === null) return true
    return currentAmount === targetAmount
  })
}
