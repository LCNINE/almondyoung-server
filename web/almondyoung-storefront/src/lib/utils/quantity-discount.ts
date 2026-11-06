// 수량 할인(같은 옵션 N개 이상 개당 할인) 화면 계산. 데이터는 상품 응답 메타데이터뿐이다:
// variant.metadata.tieredPrices(일반 구간가)·membershipTieredPrices(회원 구간가),
// product.metadata.quantityDiscount({ startsAt, endsAt } | null — 없으면 상시).
// 단가는 Medusa 가격 엔진과 같은 «가장 싼 가격»: 회원은 회원·일반 구간 모두, 비회원은 일반 구간만.
// 비회원에게 보일 회원 구간은 `memberTierHints` 가 따로 만든다.

export type QuantityTier = { minQuantity: number; price: number }
export type QuantityTiers = { regular: QuantityTier[]; membership: QuantityTier[] }

export type TierRow = {
  minQuantity: number
  unitPrice: number
  /** 지금 가격 대비 개당 할인율(정수 %, 내림) */
  percent: number
}

type Metadata = Record<string, unknown> | null | undefined

const EMPTY: QuantityTiers = { regular: [], membership: [] }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function readTierList(value: unknown): QuantityTier[] {
  if (!Array.isArray(value)) return []
  return value
    .filter(
      (t): t is QuantityTier =>
        isRecord(t) &&
        typeof t.minQuantity === "number" &&
        Number.isInteger(t.minQuantity) &&
        t.minQuantity > 1 &&
        typeof t.price === "number" &&
        Number.isFinite(t.price)
    )
    .map((t) => ({ minQuantity: t.minQuantity, price: t.price }))
    .sort((a, b) => a.minQuantity - b.minQuantity)
}

function parseInstant(value: unknown): number | null | undefined {
  if (value === null || value === undefined) return null
  if (typeof value !== "string") return undefined
  const ms = Date.parse(value)
  return Number.isNaN(ms) ? undefined : ms
}

/** 기간 밖이거나 기간 값이 깨져 있으면 false. 기간이 없으면(상시) true. */
function isWithinPeriod(productMetadata: Metadata, now: Date): boolean {
  const period = productMetadata?.quantityDiscount
  if (period === null || period === undefined) return true
  if (!isRecord(period)) return false
  const startsAt = parseInstant(period.startsAt)
  const endsAt = parseInstant(period.endsAt)
  if (startsAt === undefined || endsAt === undefined) return false
  const t = now.getTime()
  return (startsAt === null || t >= startsAt) && (endsAt === null || t <= endsAt)
}

export function readTiers(
  variantMetadata: Metadata,
  productMetadata: Metadata,
  now: Date
): QuantityTiers {
  if (!isWithinPeriod(productMetadata, now)) return EMPTY
  return {
    regular: readTierList(variantMetadata?.tieredPrices),
    membership: readTierList(variantMetadata?.membershipTieredPrices),
  }
}

export function hasTiers(tiers: QuantityTiers): boolean {
  return tiers.regular.length > 0 || tiers.membership.length > 0
}

function bestTierPrice(tiers: QuantityTier[], quantity: number): number | null {
  let best: number | null = null
  for (const t of tiers) {
    if (t.minQuantity <= quantity && (best === null || t.price < best)) best = t.price
  }
  return best
}

/** 이 수량에서 실제로 낼 개당 가격. currentPrice 는 1개 기준 지금 가격(회원가·세일가 반영). */
export function unitPriceFor(
  quantity: number,
  currentPrice: number,
  tiers: QuantityTiers,
  isMember: boolean
): number {
  const candidates = [currentPrice, bestTierPrice(tiers.regular, quantity)]
  if (isMember) candidates.push(bestTierPrice(tiers.membership, quantity))
  return Math.min(...candidates.filter((p): p is number => p !== null))
}

function percentOff(from: number, to: number): number {
  return from > 0 ? Math.floor(((from - to) * 100) / from) : 0
}

/** 앞 구간보다 실제로 싸지는 구간만, 수량 순으로(효과 없는 구간은 표에 보이지 않는다). */
export function tierRows(
  currentPrice: number,
  tiers: QuantityTiers,
  options: { isMember: boolean }
): TierRow[] {
  const quantities = [
    ...Array.from(new Set([...tiers.regular, ...(options.isMember ? tiers.membership : [])].map((t) => t.minQuantity))),
  ].sort((a, b) => a - b)

  const rows: TierRow[] = []
  let previous = currentPrice
  for (const minQuantity of quantities) {
    const unitPrice = unitPriceFor(minQuantity, currentPrice, tiers, options.isMember)
    if (unitPrice >= previous) continue
    previous = unitPrice
    rows.push({ minQuantity, unitPrice, percent: percentOff(currentPrice, unitPrice) })
  }
  return rows
}

export type MemberTierHint = { minQuantity: number; unitPrice: number; percent: number }

/**
 * 비회원 화면에 «멤버십 회원은 …»으로 알릴 회원 구간. 비회원이 그 수량에 내는 값보다 싼 것만.
 * % 는 멤버십가 기준(관리자가 넣은 회원 %와 같은 기준)이고, 멤버십가를 모르면 지금 가격 기준이다.
 */
export function memberTierHints(
  currentPrice: number,
  tiers: QuantityTiers,
  membershipPrice: number | undefined,
  options: { isMember: boolean; hideMemberPrices: boolean }
): MemberTierHint[] {
  if (options.isMember || options.hideMemberPrices) return []
  const basis = membershipPrice && membershipPrice > 0 ? membershipPrice : currentPrice
  return [...tiers.membership]
    .sort((a, b) => a.minQuantity - b.minQuantity)
    .filter((t) => t.price < unitPriceFor(t.minQuantity, currentPrice, tiers, false))
    .map((t) => ({ minQuantity: t.minQuantity, unitPrice: t.price, percent: percentOff(basis, t.price) }))
}

export function currentTierIndex(quantity: number, rows: TierRow[]): number {
  let index = -1
  rows.forEach((row, i) => {
    if (row.minQuantity <= quantity) index = i
  })
  return index
}

export function nextTier(
  quantity: number,
  rows: TierRow[]
): { addQuantity: number; unitPrice: number; percent: number } | null {
  const next = rows.find((row) => row.minQuantity > quantity)
  return next
    ? { addQuantity: next.minQuantity - quantity, unitPrice: next.unitPrice, percent: next.percent }
    : null
}

type DiscountLine = {
  unit_price?: number | null
  compare_at_unit_price?: number | null
  quantity?: number | null
  variant?: { metadata?: Metadata } | null
  product?: { metadata?: Metadata } | null
}

/**
 * 라인의 «정가 − 단가»를 수량 할인과 나머지(멤버십·세일)로 나눈다.
 * 단가가 그 수량의 구간가와 정확히 같을 때만 «구간 적용 전 가격(회원=멤버십가, 비회원=정가) − 단가»를 수량 할인으로 센다.
 * 타임세일 라인은 구간 적용 전 가격(세일가)을 메타데이터로 알 수 없으므로 나누지 않는다.
 */
export function splitLineDiscount(
  line: DiscountLine,
  context: { isMember: boolean; isTimeSale: boolean; now: Date }
): { quantityDiscount: number; otherDiscount: number } {
  const unit = line.unit_price ?? 0
  const quantity = line.quantity ?? 0
  const compareAt = line.compare_at_unit_price ?? null
  if (compareAt === null || compareAt <= unit || quantity <= 0) {
    return { quantityDiscount: 0, otherDiscount: 0 }
  }
  const total = (compareAt - unit) * quantity
  if (context.isTimeSale) return { quantityDiscount: 0, otherDiscount: total }

  const tiers = readTiers(line.variant?.metadata, line.product?.metadata, context.now)
  const regularTier = bestTierPrice(tiers.regular, quantity)
  const memberTier = context.isMember ? bestTierPrice(tiers.membership, quantity) : null
  const tierPrice = Math.min(...[regularTier, memberTier].filter((p): p is number => p !== null))

  const membershipPrice = Number(line.variant?.metadata?.membershipPrice)
  const beforeTier =
    context.isMember && Number.isFinite(membershipPrice) && membershipPrice > 0
      ? Math.min(compareAt, membershipPrice)
      : compareAt

  if (!Number.isFinite(tierPrice) || unit !== tierPrice || unit >= beforeTier) {
    return { quantityDiscount: 0, otherDiscount: total }
  }
  const quantityDiscount = (beforeTier - unit) * quantity
  return { quantityDiscount, otherDiscount: total - quantityDiscount }
}

/**
 * 장바구니 라인 아래 안내: 이 라인이 받은 수량 할인과 다음 구간.
 * 다음 구간은 «구간 적용 전 가격»(회원=멤버십가, 비회원=정가)에서 계산하며, 그 값을 알 수 없는 타임세일 라인은 안내하지 않는다.
 */
export function cartLineTierInfo(
  line: DiscountLine,
  context: { isMember: boolean; isTimeSale: boolean; now: Date }
): { quantityDiscount: number; next: ReturnType<typeof nextTier> } {
  const { quantityDiscount } = splitLineDiscount(line, context)
  if (context.isTimeSale) return { quantityDiscount, next: null }

  const unit = line.unit_price ?? 0
  const compareAt = line.compare_at_unit_price ?? unit
  const membershipPrice = Number(line.variant?.metadata?.membershipPrice)
  const beforeTier =
    context.isMember && Number.isFinite(membershipPrice) && membershipPrice > 0
      ? Math.min(compareAt, membershipPrice)
      : compareAt
  const tiers = readTiers(line.variant?.metadata, line.product?.metadata, context.now)
  const rows = tierRows(beforeTier, tiers, { isMember: context.isMember })
  const next = nextTier(line.quantity ?? 0, rows)
  return { quantityDiscount, next: next && next.unitPrice < unit ? next : null }
}

/** 주문 라인의 수량 할인 금액 — 주문 때 Medusa 가 기록한 `metadata.price_breakdown` 에서 읽는다(없으면 0). */
export function orderLineQuantityDiscount(item: {
  quantity?: number | null
  metadata?: Metadata
}): number {
  const breakdown = item.metadata?.price_breakdown
  if (!isRecord(breakdown)) return 0
  const perUnit = breakdown.tier_discount_unit
  if (typeof perUnit !== "number" || !Number.isFinite(perUnit) || perUnit <= 0) return 0
  return perUnit * (item.quantity ?? 0)
}

const MAX_TIMER_MS = 2_147_483_647

/**
 * 열려 있는 화면이 기간 경계(시작 순간, 종료 다음 순간)를 지날 때까지 남은 시간. 화면은 이 시각에 다시 계산해야
 * 끝난 구간가를 약속하지 않는다. 경계가 없거나 다 지났으면 null.
 */
export function msUntilNextBoundary(productMetadatas: Metadata[], now: Date): number | null {
  const t = now.getTime()
  let next: number | null = null
  for (const metadata of productMetadatas) {
    const period = metadata?.quantityDiscount
    if (!isRecord(period)) continue
    const startsAt = parseInstant(period.startsAt)
    const endsAt = parseInstant(period.endsAt)
    for (const boundary of [startsAt, typeof endsAt === "number" ? endsAt + 1 : endsAt]) {
      if (typeof boundary === "number" && boundary > t && (next === null || boundary < next)) next = boundary
    }
  }
  return next === null ? null : Math.min(next - t, MAX_TIMER_MS)
}
