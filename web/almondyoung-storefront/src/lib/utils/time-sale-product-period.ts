import type { TimeSale } from "@/lib/api/medusa/time-sale"

export type ProductSaleState = "scheduled" | "active" | "ended"

export type ProductSalePeriod = {
  startsAt: string | null
  endsAt: string | null
}

// 상품이 걸린 세일 하나와 그 상품 기준의 기간·상태.
export type ProductSaleMatch = ProductSalePeriod & {
  sale: TimeSale
  state: ProductSaleState
}

// setTimeout 이 받을 수 있는 최대 지연(2^31-1 ms ≈ 24.8일). 넘기면 즉시 실행돼 버린다.
const MAX_TIMER_MS = 2147483647

// 한 상품이 여러 세일에 걸렸을 때 보여줄 우선순위: 진행 중 > 예정 > 종료.
const STATE_RANK: Record<ProductSaleState, number> = {
  active: 0,
  scheduled: 1,
  ended: 2,
}

// 상품의 기간: 상품별 기간이 있으면 그것, 없으면 세일 전체 기간. 세일에 없는 상품은 null.
export function productSalePeriod(
  sale: TimeSale,
  productId: string
): ProductSalePeriod | null {
  if (!sale.productIds.includes(productId)) return null

  const product = sale.products?.find((item) => item.productId === productId)
  if (product) return { startsAt: product.startsAt, endsAt: product.endsAt }

  return { startsAt: sale.startsAt, endsAt: sale.endsAt }
}

// 기간과 현재 시각으로 예정/진행/종료 판정(종료 시각 정각부터 종료).
export function productSaleState(
  period: ProductSalePeriod,
  now: number
): ProductSaleState {
  if (period.startsAt && now < Date.parse(period.startsAt)) return "scheduled"
  if (period.endsAt && now >= Date.parse(period.endsAt)) return "ended"

  return "active"
}

const time = (value: string | null, fallback: number) =>
  value ? Date.parse(value) : fallback

// 같은 상태끼리는 진행=마감 임박순, 예정=시작 임박순, 종료=최근 종료순.
const compareMatches = (a: ProductSaleMatch, b: ProductSaleMatch) => {
  const rank = STATE_RANK[a.state] - STATE_RANK[b.state]
  if (rank !== 0) return rank

  if (a.state === "active") {
    return time(a.endsAt, Infinity) - time(b.endsAt, Infinity)
  }

  if (a.state === "scheduled") {
    return time(a.startsAt, Infinity) - time(b.startsAt, Infinity)
  }

  return time(b.endsAt, 0) - time(a.endsAt, 0)
}

// 이 상품이 걸린 세일 중 지금 가장 보여줄 만한 하나(우선순위는 compareMatches).
export function matchProductSale(
  sales: TimeSale[],
  productId: string,
  now: number
): ProductSaleMatch | null {
  const matches = sales.flatMap((sale) => {
    const period = productSalePeriod(sale, productId)
    if (!period) return []

    return [{ sale, ...period, state: productSaleState(period, now) }]
  })

  return matches.sort(compareMatches)[0] ?? null
}

// 상품들 중 진행 중인 세일의 가장 이른 종료 시각(카트의 마감 임박 안내용).
export function earliestActiveSaleEnd(
  sales: TimeSale[],
  productIds: string[],
  now: number
): string | null {
  const ends = productIds.flatMap((productId) => {
    const match = matchProductSale(sales, productId, now)
    if (match?.state !== "active" || !match.endsAt) return []

    return [match.endsAt]
  })

  return ends.reduce<string | null>(
    (earliest, end) =>
      !earliest || Date.parse(end) < Date.parse(earliest) ? end : earliest,
    null
  )
}

// 진행 중인 (세일, 상품) 조합의 지문. 세일이 시작·종료돼
// 바뀌면 값이 달라져 캐시·리렌더 기준으로 쓴다.
export function activeSaleEpoch(sales: TimeSale[], now: number): string {
  const active = sales.flatMap((sale) =>
    sale.productIds.flatMap((productId) => {
      const period = productSalePeriod(sale, productId)
      if (!period || productSaleState(period, now) !== "active") return []

      return [`${sale.saleId}:${productId}`]
    })
  )

  return active.sort().join(",") || "none"
}

// 지금 이후 가장 가까운 시작·종료 시각(없으면 null). 시계가 다음에 깨어날 시점이다.
export function nextSaleBoundary(
  sales: TimeSale[],
  now: number
): number | null {
  const boundaries = sales.flatMap((sale) =>
    sale.productIds.flatMap((productId) => {
      const period = productSalePeriod(sale, productId)

      return [period?.startsAt, period?.endsAt]
        .filter((value): value is string => Boolean(value))
        .map((value) => Date.parse(value))
        .filter((value) => value > now)
    })
  )

  return boundaries.length > 0 ? Math.min(...boundaries) : null
}

// 경계까지 남은 ms(+1ms 로 경계를 확실히 넘김), setTimeout 상한으로 자른다.
export function boundaryDelayMs(boundary: number, now: number): number {
  return Math.min(MAX_TIMER_MS, Math.max(0, boundary - now) + 1)
}

// 세일 경계(시작·종료) 시각마다 onTick 을 부르는 시계. 매초 도는 대신 다음 경계에만 타이머를 건다.
export function createSaleClock(onTick: (now: number) => void) {
  let sales: TimeSale[] = []
  let timer: ReturnType<typeof setTimeout> | null = null

  const clear = () => {
    if (timer) clearTimeout(timer)
    timer = null
  }

  const evaluate = () => {
    clear()

    const now = Date.now()
    onTick(now)

    const boundary = nextSaleBoundary(sales, now)
    if (boundary === null) return

    timer = setTimeout(evaluate, boundaryDelayMs(boundary, now))
  }

  return {
    setSales(next: TimeSale[]) {
      sales = next
      evaluate()
    },
    dispose: clear,
  }
}
