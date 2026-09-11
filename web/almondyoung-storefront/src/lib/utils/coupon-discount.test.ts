import { describe, expect, it } from "vitest"
import {
  couponName,
  discountParts,
  maxPossibleDiscount,
  shouldShowCap,
} from "./coupon-discount"

const percentage = { type: "percentage", value: 10 }
const fixed = { type: "fixed", value: 50000 }

describe("shouldShowCap", () => {
  it("정률 + 캡이면 표기한다", () => {
    expect(shouldShowCap(percentage, 3000)).toBe(true)
  })
  it("캡이 없으면 표기하지 않는다", () => {
    expect(shouldShowCap(percentage, null)).toBe(false)
  })
  it("정액에는 캡이 있어도 표기하지 않는다", () => {
    expect(shouldShowCap(fixed, 3000)).toBe(false)
  })
  it("할인 정보 자체가 없으면 표기하지 않는다", () => {
    expect(shouldShowCap(null, 3000)).toBe(false)
  })
  it("캡 0 도 캡이다", () => {
    expect(shouldShowCap(percentage, 0)).toBe(true)
  })
})

describe("maxPossibleDiscount — 「할인 큰 순」 정렬 키", () => {
  it("정액은 할인액 자신이다", () => {
    expect(maxPossibleDiscount(fixed, null)).toBe(50000)
  })
  it("상한 있는 정률은 상한이다", () => {
    expect(maxPossibleDiscount(percentage, 3000)).toBe(3000)
  })
  it("상한 없는 정률은 무한이다 — 장바구니가 커질수록 커진다", () => {
    expect(maxPossibleDiscount(percentage, null)).toBe(Number.POSITIVE_INFINITY)
  })
  it("할인 정보가 없으면 0 이다", () => {
    expect(maxPossibleDiscount(null, null)).toBe(0)
  })

  it("🔴 회귀: 「10% 최대 3천원」은 「5만원 정액」보다 작다", () => {
    expect(maxPossibleDiscount(percentage, 3000)).toBeLessThan(
      maxPossibleDiscount(fixed, null)
    )
  })
})

describe("couponName — 「이름이 있으면 제목」 판정 (#789)", () => {
  it("이름이 있으면 그대로 돌려준다", () => {
    expect(couponName("신규 가입 축하 쿠폰")).toBe("신규 가입 축하 쿠폰")
  })
  it("이름이 없으면 null 이다 — 화면이 코드로 폴백한다", () => {
    expect(couponName(null)).toBeNull()
    expect(couponName(undefined)).toBeNull()
  })
  it("공백뿐인 이름은 「없음」이다 — 제목이 빈 줄로 나가면 안 된다", () => {
    expect(couponName("   ")).toBeNull()
  })
  it("앞뒤 공백은 털어낸다", () => {
    expect(couponName("  가을 배송비 지원  ")).toBe("가을 배송비 지원")
  })

  // 🔴 옛 medusa 가 배포된 조합에서는 `name` 키 자체가 응답에 없다. 두 앱이 한 SST 스택이라
  // 배포 순서를 정할 수단이 없으므로, 이 폴백이 유일한 안전장치다.
  it("서버가 아직 name 을 안 보내는 조합에서도 터지지 않는다", () => {
    const fromOldServer = {} as { name?: string | null }
    expect(couponName(fromOldServer.name)).toBeNull()
  })
})

describe("discountParts — 레일 숫자/단위 분리 (#790)", () => {
  it("정률은 숫자와 percent 단위로 쪼갠다", () => {
    expect(discountParts({ type: "percentage", value: 10 })).toEqual({
      value: "10",
      unit: "percent",
    })
  })

  // 「1,000원」이 한 덩어리라 88px 레일에서 접혔다. 단위를 떼면 숫자만 재면 된다.
  it("정액은 천단위 구분자를 넣고 won 단위로 쪼갠다", () => {
    expect(discountParts({ type: "fixed", value: 1000 })).toEqual({
      value: "1,000",
      unit: "won",
    })
    expect(discountParts({ type: "fixed", value: 100000 })).toEqual({
      value: "100,000",
      unit: "won",
    })
  })

  it("percentage 가 아닌 모든 타입은 정액으로 다룬다", () => {
    expect(discountParts({ type: "fixed_amount", value: 3000 })?.unit).toBe("won")
  })

  it("할인 정보가 없으면 null 이다 — 레일 자체를 그리지 않는다", () => {
    expect(discountParts(null)).toBeNull()
    expect(discountParts(undefined)).toBeNull()
  })

  // 🔴 정률에는 천단위 구분자를 넣지 않는다. `1,000%` 는 존재할 수 없는 값이고,
  // 넣으면 `toLocaleString` 이 레일 폭 계산의 전제를 조용히 바꾼다.
  it("정률에는 천단위 구분자를 넣지 않는다", () => {
    expect(discountParts({ type: "percentage", value: 1000 })?.value).toBe("1000")
  })
})
