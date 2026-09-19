import { describe, expect, it } from "vitest"

import { pageTypeEvent } from "./page-type"

describe("pageTypeEvent", () => {
  it("국가코드 뒤 첫 경로로 화면 종류를 고른다", () => {
    expect(pageTypeEvent("/kr")).toBe("view_home")
    expect(pageTypeEvent("/kr/")).toBe("view_home")
    expect(pageTypeEvent("/kr/category/eyebrow/pigment")).toBe("view_item_list")
    expect(pageTypeEvent("/kr/search")).toBe("view_item_list")
    expect(pageTypeEvent("/kr/cart")).toBe("view_cart")
    expect(pageTypeEvent("/kr/shop-trade/abc")).toBe("view_board")
    expect(pageTypeEvent("/kr/checkout")).toBe("view_checkout")
    expect(pageTypeEvent("/kr/checkout/success/intent_1")).toBe("view_order_complete")
  })

  it("이벤트를 따로 보내는 화면과 그 밖의 화면은 보내지 않는다", () => {
    expect(pageTypeEvent("/kr/products/abc")).toBeNull()
    expect(pageTypeEvent("/kr/mypage")).toBeNull()
    expect(pageTypeEvent("/kr/checkout/fail")).toBeNull()
  })
})
