/**
 * 카트에 담긴 variant 가 draft/미게시/삭제 상태라 Medusa 가 카트 작업
 * (배송수단 추가, 라인아이템 생성 등)을 거부할 때 나오는 에러를 다루는 유틸.
 */
const UNAVAILABLE_VARIANT_MESSAGE_REGEX =
  /do not exist or belong to a product that is not published/i

export function isUnavailableVariantError(error: unknown): boolean {
  const message = (error as { message?: string })?.message ?? ""
  return UNAVAILABLE_VARIANT_MESSAGE_REGEX.test(message)
}

/** Medusa confirmInventory 의 재고 부족 에러(품절)인지 판단한다. 문자열/에러 모두 허용. */
const INSUFFICIENT_INVENTORY_MESSAGE_REGEX =
  /does not have the required inventory/i

export function isInsufficientInventoryError(error: unknown): boolean {
  const message =
    typeof error === "string"
      ? error
      : ((error as { message?: string })?.message ?? "")
  return INSUFFICIENT_INVENTORY_MESSAGE_REGEX.test(message)
}

/** 에러 메시지에서 문제된 variant id 목록을 중복 제거해 추출한다. */
export function extractUnavailableVariantIds(error: unknown): string[] {
  const message = (error as { message?: string })?.message ?? ""
  const ids = message.match(/variant_[A-Za-z0-9]+/g) ?? []
  return Array.from(new Set(ids))
}

type VariantStock = {
  manage_inventory?: boolean | null
  allow_backorder?: boolean | null
  inventory_quantity?: number | null
}

/**
 * variant 에 남은 구매 가능 수량. 재고관리를 안 하거나 백오더 허용이면 상한이 없다는 뜻으로 null.
 *
 * 상한을 아는 화면(상품상세·장바구니)은 이 값으로 "N개 이하로 담아주세요" 처럼 구체적으로 안내한다.
 * Medusa 의 재고부족 에러는 `Some variant does not have the required inventory` 라 수량 정보가 없어,
 * 에러 문구를 파싱하는 방식으로는 안내할 수 없다.
 */
export function getAvailableQuantity(
  variant?: VariantStock | null
): number | null {
  if (!variant) return null
  if (!variant.manage_inventory) return null
  if (variant.allow_backorder) return null
  return Math.max(0, variant.inventory_quantity ?? 0)
}

/**
 * variant 가 품절은 아니지만 요청 수량을 감당하지 못하는지 판단한다.
 * 담기 시점엔 Medusa 가 "수량 > 가용재고"를 거부하지만, 담은 뒤 다른 주문/재고 조정으로
 * 재고가 줄면 결제 직전에 이 상태가 된다.
 */
export function isVariantQuantityUnavailable(
  variant?: VariantStock | null,
  quantity?: number | null
): boolean {
  const available = getAvailableQuantity(variant)
  return available !== null && (quantity ?? 0) > available
}

/**
 * 재고부족 응답을 어떤 안내로 바꿀지 결정한다.
 *
 * - `sold-out`: 남은 재고가 0 → 수량 안내("0개 이하로 담아주세요")는 말이 안 되므로 품절로 안내한다.
 * - `exceeds-stock`: 요청 수량이 남은 재고보다 많다 → "재고가 N개 남았어요" 로 수량을 알려줄 수 있다.
 * - `cart-sum`: 재고 안에서 요청했는데도 실패 → 장바구니에 이미 담긴 수량과 합쳐 넘긴 경우
 *   (또는 방금 재고가 줄었다). 남은 수량만 알려주면 "N개인데 왜 안 되냐" 가 되므로 다르게 안내한다.
 * - `unknown`: 남은 재고를 모르는 화면(상품카드 퀵담기 등) → 수량 없이 일반 재고부족 안내.
 */
export type StockShortageKind =
  | "sold-out"
  | "exceeds-stock"
  | "cart-sum"
  | "unknown"

export function describeStockShortage(input: {
  available?: number | null
  quantity?: number | null
}): StockShortageKind {
  const { available } = input
  if (available === null || available === undefined) return "unknown"
  if (available <= 0) return "sold-out"
  return (input.quantity ?? 1) > available ? "exceeds-stock" : "cart-sum"
}

/**
 * 라인아이템별 수량 상한 맵. **재고가 계산된 variant(=/store/products 응답)** 에서만 상한을 뽑는다.
 *
 * 카트 라인아이템에 붙어오는 variant 에는 Medusa 가 inventory_quantity 를 채워주지 않는다.
 * 그걸 폴백으로 쓰면 재고 0 으로 읽혀 "재고가 0개 남았어요" 를 띄우고 수량 증가를 통째로 막아버린다
 * (상품 조회가 실패하면 전 라인이 그렇게 된다). 그래서 조회 결과에 없는 variant 는 상한 없음으로 둔다 —
 * 잘못된 차단보다 서버 판정에 맡기는 쪽이 안전하다.
 */
export function buildAvailabilityMap(
  items: Array<{ variant_id?: string | null }>,
  variantById: Map<string, VariantStock>
): Record<string, number> {
  const map: Record<string, number> = {}
  for (const item of items) {
    if (!item.variant_id) continue
    const fetched = variantById.get(item.variant_id)
    if (!fetched) continue
    const available = getAvailableQuantity(fetched)
    if (available !== null) map[item.variant_id] = available
  }
  return map
}

/**
 * 상품은 그대로 노출되는데 그 variant 만 사라진 라인인지 판단한다.
 *
 * variant 가 없으면 Medusa 의 카트 재계산이 `Variants ... do not exist` 로 거부해, 그 라인을
 * 뺄 때까지 결제도 수량 변경도 막힌다. 그런데 라인아이템에 붙어오는 variant 는 이 경우 그냥
 * 비어 있어서 품절 판정(isVariantSoldOut)으로는 안 잡히고, 상품은 멀쩡히 게시 중이라
 * 미게시 판정으로도 안 잡힌다. 화면상 정상인 상품을 담은 채 결제에서만 계속 실패한다.
 *
 * 판정 조건을 좁게 잡는다. 그 상품이 조회 결과에 있고, **그 상품의 variant 목록을 실제로
 * 받아왔을 때만** 없어졌다고 본다. 상품 조회가 실패하거나 응답에 variant 가 안 실려오면
 * 멀쩡한 라인이 전부 구매 불가로 찍혀 결제를 통째로 막는다 — 못 잡는 쪽보다 나쁘다.
 * (조회 실패는 미게시 판정이 이미 잡는다.)
 */
export function isLineItemVariantGone(
  item: { product_id?: string | null; variant_id?: string | null },
  publishedProductIds: Set<string>,
  variantIdsByProductId: Map<string, Set<string>>
): boolean {
  if (!item.variant_id || !item.product_id) return false
  if (!publishedProductIds.has(item.product_id)) return false

  const knownVariantIds = variantIdsByProductId.get(item.product_id)
  if (!knownVariantIds?.size) return false

  return !knownVariantIds.has(item.variant_id)
}

/**
 * variant 가 재고 기준으로 품절인지 판단한다.
 * 상품 상세의 `isInStock`/`hasStock` 과 동일 기준 — 재고관리를 켜고(manage_inventory),
 * 백오더 불가(allow_backorder=false)이며, 가용 재고가 0 이하이면 품절.
 *
 * 어드민 "수동 품절" 은 Medusa 재고를 0 으로 만들므로 이 함수로 잡힌다.
 * (상품은 여전히 published 라 publish 상태 기반 가드로는 안 잡힌다)
 */
export function isVariantSoldOut(variant?: VariantStock | null): boolean {
  if (!variant) return false
  if (!variant.manage_inventory) return false
  if (variant.allow_backorder) return false
  return (variant.inventory_quantity ?? 0) <= 0
}

type ClassifiableVariant = VariantStock & { id?: string | null }

export type ClassifiableLineItem = {
  product_id?: string | null
  variant_id?: string | null
  quantity?: number | null
  product_title?: string | null
  title?: string | null
  variant?: ClassifiableVariant | null
}

export type ClassifiableProduct = {
  id?: string | null
  variants?: ClassifiableVariant[] | null
}

export type CartLineItemClassification = {
  /** 결제를 막아야 하는 라인의 variant id */
  variantIds: string[]
  productNames: string[]
  /**
   * 그중 상품은 계속 팔리는데 그 옵션만 없어진 라인. 고객이 취할 행동이 달라서
   * (다른 옵션으로 다시 담으면 된다) 상품 자체의 판매중단과 구분해 안내한다.
   */
  optionGoneVariantIds: string[]
  /** 팔긴 하지만 담은 수량을 못 채우는 라인 */
  insufficientVariantIds: string[]
  insufficientNames: string[]
  availableByVariantId: Record<string, number>
}

/**
 * 카트 라인을 구매 가능/불가로 가른다. `products` 는 재고가 계산된 조회 결과
 * (`/store/products`) 로, 미게시·삭제 상품은 애초에 들어있지 않다.
 */
export function classifyCartLineItems(
  items: ClassifiableLineItem[],
  products: ClassifiableProduct[]
): CartLineItemClassification {
  const publishedProductIds = new Set(
    products.map((product) => product.id).filter((id): id is string => !!id)
  )
  // variant_id → 재고가 계산된 variant. 카트 라인아이템 variant 는 inventory_quantity 가 비어있으므로 사용하지 않는다.
  const variantById = new Map<string, ClassifiableVariant>()
  // 상품별 variant 목록. 응답에 variant 가 안 실려온 상품과 진짜로 variant 가 사라진 상품을
  // 구분하려면 상품 단위로 봐야 한다.
  const variantIdsByProductId = new Map<string, Set<string>>()
  for (const product of products) {
    const ids = new Set<string>()
    for (const variant of product.variants ?? []) {
      if (variant.id) {
        variantById.set(variant.id, variant)
        ids.add(variant.id)
      }
    }
    if (product.id) variantIdsByProductId.set(product.id, ids)
  }

  // 판매중단(미게시) 이거나, variant 가 사라졌거나, 재고 기준 품절(수동 품절 포함)이면
  // 구매 불가로 본다.
  const unavailableItems = items.filter((item) => {
    if (item.product_id && !publishedProductIds.has(item.product_id)) {
      return true
    }
    if (isLineItemVariantGone(item, publishedProductIds, variantIdsByProductId)) {
      return true
    }
    // 재고가 계산된 variant 로 판정. 조회 실패 시에만 카트 라인아이템 variant 로 폴백.
    const variant =
      (item.variant_id ? variantById.get(item.variant_id) : undefined) ??
      item.variant
    return isVariantSoldOut(variant)
  })

  // 품절은 아니지만 담은 수량이 가용 재고를 넘어선 라인 (담은 뒤 재고가 줄어든 경우).
  const unavailableSet = new Set(unavailableItems)
  // 재고가 계산된 variant 로만 판정한다. 카트 라인아이템 variant 는 inventory_quantity 가 비어 있어
  // 폴백으로 쓰면 전 라인이 재고 0 으로 읽혀 멀쩡한 결제까지 막는다.
  const insufficientItems = items.filter((item) => {
    if (unavailableSet.has(item)) return false
    const variant = item.variant_id ? variantById.get(item.variant_id) : undefined
    return isVariantQuantityUnavailable(variant, item.quantity)
  })

  const toVariantIds = (list: ClassifiableLineItem[]) =>
    Array.from(
      new Set(
        list
          .map((item) => item.variant_id)
          .filter((id): id is string => Boolean(id))
      )
    )
  const toNames = (list: ClassifiableLineItem[]) =>
    Array.from(
      new Set(
        list
          .map((item) => item.product_title || item.title || "")
          .filter(Boolean)
      )
    )

  const optionGoneItems = unavailableItems.filter((item) =>
    isLineItemVariantGone(item, publishedProductIds, variantIdsByProductId)
  )

  return {
    variantIds: toVariantIds(unavailableItems),
    productNames: toNames(unavailableItems),
    optionGoneVariantIds: toVariantIds(optionGoneItems),
    insufficientVariantIds: toVariantIds(insufficientItems),
    insufficientNames: toNames(insufficientItems),
    availableByVariantId: buildAvailabilityMap(items, variantById),
  }
}
