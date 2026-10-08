import { describe, expect, it } from "vitest"
import type { TimeSale } from "@/lib/api/medusa/time-sale"
import { mainProductIds, saleSectionPeriods } from "./section-plan"

const ids = Array.from({ length: 120 }, (_, i) => `p${i + 1}`)

describe("메인 섹션 상품 id", () => {
  it("더보기가 팝업이면 120개 전부를 넘겨 101~120번째도 팝업에서 보인다", () => {
    expect(mainProductIds(ids, "popup")).toHaveLength(120)
  })

  it("더보기가 페이지 이동이면 메인은 앞 100개만", () => {
    expect(mainProductIds(ids, "page")).toEqual(ids.slice(0, 100))
  })
})

describe("섹션 기준 기간", () => {
  it("세일의 모든 상품 기간을 낸다(상품별 기간이 없으면 세일 기간)", () => {
    const sale: TimeSale = {
      saleId: "s1",
      title: "세일",
      startsAt: "2026-10-07T04:00:00Z",
      endsAt: "2026-10-07T07:00:00Z",
      priceListIds: [],
      productIds: ["a", "b"],
      products: [
        {
          productId: "a",
          startsAt: "2026-10-07T04:00:00Z",
          endsAt: "2026-10-07T05:00:00Z",
        },
      ],
    }

    expect(saleSectionPeriods(sale)).toEqual([
      { startsAt: "2026-10-07T04:00:00Z", endsAt: "2026-10-07T05:00:00Z" },
      { startsAt: "2026-10-07T04:00:00Z", endsAt: "2026-10-07T07:00:00Z" },
    ])
  })
})
