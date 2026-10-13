import { describe, expect, it } from "vitest"
import type { TimeSale } from "@/lib/api/medusa/time-sale"
import { lineTimeSale } from "./time-sale-provider"

const sale: TimeSale = {
  id: "ts_1",
  startsAt: "2030-01-01T00:00:00.000Z",
  endsAt: "2030-01-10T00:00:00.000Z",
  priceListIds: ["pl_g", "pl_m"],
  productIds: ["prod_1"],
  variantIds: ["v_general", "v_member"],
  membershipOnlyVariantIds: ["v_member"],
}

const line = (
  variantId: string,
  unit: number,
  compareAt: number | null,
  membershipPrice?: number
) => ({
  product_id: "prod_1",
  variant_id: variantId,
  unit_price: unit,
  compare_at_unit_price: compareAt,
  variant: {
    metadata: membershipPrice === undefined ? {} : { membershipPrice },
  },
})

describe("lineTimeSale", () => {
  it("같은 상품이라도 세일에 없는 옵션은 세일이 아니다", () => {
    expect(lineTimeSale([sale], line("v_other", 10000, null))).toBeNull()
  })

  it("일반 세일 옵션은 세일이다", () => {
    expect(lineTimeSale([sale], line("v_general", 9000, 10000))).toEqual({
      sale,
      membershipOnly: false,
    })
  })

  // 세일가가 정가 이상으로 저장됐으면(경고 후 적용) Medusa 가 정가를 고른다.
  it("일반 세일 옵션도 정가보다 싸게 담겼을 때만 세일이다", () => {
    expect(lineTimeSale([sale], line("v_general", 10000, null))).toBeNull()
    expect(lineTimeSale([sale], line("v_general", 10000, 10000))).toBeNull()
  })

  it("멤버십 전용 옵션을 비회원이 정가로 담으면 세일이 아니다", () => {
    expect(
      lineTimeSale([sale], line("v_member", 18000, null, 11900))
    ).toBeNull()
  })

  it("멤버십 전용 옵션이 상시 멤버십가보다 싸게 담겼을 때만 특가다", () => {
    expect(lineTimeSale([sale], line("v_member", 9900, 18000, 11900))).toEqual({
      sale,
      membershipOnly: true,
    })
    // 상시 멤버십가가 더 싸 그쪽이 적용됐으면 기간 특가가 아니다.
    expect(
      lineTimeSale([sale], line("v_member", 11900, 18000, 11900))
    ).toBeNull()
  })

  it("옛 응답(variantIds 없음)은 상품 단위로 가른다", () => {
    const old = { ...sale, variantIds: undefined }
    expect(
      lineTimeSale([old], line("v_other", 9000, 10000))?.membershipOnly
    ).toBe(false)
  })
})
