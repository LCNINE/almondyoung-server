import { afterEach, describe, expect, it, vi } from "vitest"
import type { TimeSale } from "@/lib/api/medusa/time-sale"
import {
  activeSaleEpoch,
  boundaryDelayMs,
  createSaleClock,
  earliestActiveSaleEnd,
  matchProductSale,
  nextSaleBoundary,
} from "./time-sale-product-period"

const at = (time: string) => `2026-10-07T${time}:00.000Z`

const sale = (over: Partial<TimeSale> = {}): TimeSale => ({
  saleId: "s1",
  title: "상품별",
  startsAt: at("13:00"),
  endsAt: at("16:00"),
  priceListIds: ["plist_a", "plist_b"],
  productIds: ["a", "b"],
  products: [
    { productId: "a", startsAt: at("13:00"), endsAt: at("14:00") },
    { productId: "b", startsAt: at("15:00"), endsAt: at("16:00") },
  ],
  ...over,
})

describe("상품별 기간 판정", () => {
  it("상품의 현재 상태는 자기 기간으로 판정한다", () => {
    const now = Date.parse(at("13:30"))

    expect(matchProductSale([sale()], "a", now)?.state).toBe("active")
    expect(matchProductSale([sale()], "b", now)?.state).toBe("scheduled")
    expect(matchProductSale([sale()], "c", now)).toBeNull()
  })

  it("끝난 세일보다 진행 중인 세일을 고른다", () => {
    const ended = sale({
      saleId: "old",
      products: [
        { productId: "a", startsAt: at("10:00"), endsAt: at("11:00") },
      ],
    })
    const running = sale({ saleId: "new" })
    const match = matchProductSale(
      [ended, running],
      "a",
      Date.parse(at("13:30"))
    )

    expect(match?.sale.saleId).toBe("new")
    expect(match?.endsAt).toBe(at("14:00"))
  })

  it("가장 이른 마감은 지금 진행 중인 상품만 본다", () => {
    expect(
      earliestActiveSaleEnd([sale()], ["a", "b"], Date.parse(at("13:30")))
    ).toBe(at("14:00"))
    expect(
      earliestActiveSaleEnd([sale()], ["a", "b"], Date.parse(at("14:30")))
    ).toBeNull()
    expect(
      earliestActiveSaleEnd([sale()], ["a", "b"], Date.parse(at("15:30")))
    ).toBe(at("16:00"))
  })

  it("카트 스로틀 키는 상품 하나의 경계만 지나도 바뀐다", () => {
    const keys = ["13:30", "14:30", "15:30"].map((time) =>
      activeSaleEpoch([sale()], Date.parse(at(time)))
    )

    expect(new Set(keys).size).toBe(3)
    expect(activeSaleEpoch([sale()], Date.parse(at("13:40")))).toBe(keys[0])
  })

  it("옛 응답처럼 products 가 없으면 세일 기간을 쓴다", () => {
    const legacy = sale({ products: undefined as never })

    expect(
      matchProductSale([legacy], "b", Date.parse(at("13:30")))?.state
    ).toBe("active")
  })

  it("다음 경계는 지금 이후의 가장 가까운 시작·종료다", () => {
    expect(nextSaleBoundary([sale()], Date.parse(at("13:30")))).toBe(
      Date.parse(at("14:00"))
    )
    expect(nextSaleBoundary([sale()], Date.parse(at("14:30")))).toBe(
      Date.parse(at("15:00"))
    )
    expect(nextSaleBoundary([sale()], Date.parse(at("16:30")))).toBeNull()
  })
})

describe("경계 시계", () => {
  const MAX_TIMER_MS = 2147483647
  const DAY = 24 * 60 * 60 * 1000

  afterEach(() => {
    vi.useRealTimers()
  })

  it("타이머 지연은 1ms 를 더한 뒤 최대값으로 자른다", () => {
    const now = Date.parse(at("13:00"))

    expect(boundaryDelayMs(now + 1000, now)).toBe(1001)
    expect(boundaryDelayMs(now + 40 * DAY, now)).toBe(MAX_TIMER_MS)
  })

  it("먼 경계는 즉시 다시 돌지 않고 최대 지연 뒤 재평가만 한다", () => {
    vi.useFakeTimers()
    vi.setSystemTime(Date.parse(at("13:00")))
    const far = sale({
      products: [
        {
          productId: "a",
          startsAt: new Date(Date.now() + 40 * DAY).toISOString(),
          endsAt: new Date(Date.now() + 41 * DAY).toISOString(),
        },
      ],
      productIds: ["a"],
    })
    const ticks: number[] = []
    const clock = createSaleClock((now) => ticks.push(now))

    clock.setSales([far])
    vi.advanceTimersByTime(10)

    expect(ticks).toHaveLength(1)

    vi.advanceTimersByTime(MAX_TIMER_MS)

    expect(ticks).toHaveLength(2)
    clock.dispose()
  })

  it("세일 목록이 바뀌면 지금 시각으로 다시 판정하고 다음 경계를 잡는다", () => {
    vi.useFakeTimers()
    vi.setSystemTime(Date.parse(at("13:00")))
    const ticks: number[] = []
    const clock = createSaleClock((now) => ticks.push(now))

    clock.setSales([])
    vi.setSystemTime(Date.parse(at("15:00")))
    clock.setSales([
      sale({
        productIds: ["b"],
        products: [
          { productId: "b", startsAt: at("14:00"), endsAt: at("16:00") },
        ],
      }),
    ])

    expect(ticks.at(-1)).toBe(Date.parse(at("15:00")))

    vi.advanceTimersByTime(60 * 60 * 1000 - 1000)
    expect(ticks).toHaveLength(2)

    vi.advanceTimersByTime(2000)
    expect(ticks).toHaveLength(3)
    clock.dispose()
  })
})
