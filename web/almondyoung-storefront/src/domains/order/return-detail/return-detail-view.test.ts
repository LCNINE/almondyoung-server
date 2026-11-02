import { describe, expect, it } from "vitest"
import {
  pickupLabelKey,
  returnedAmount,
  receiptItemAmounts,
} from "./return-detail-view"

describe("receiptItemAmounts", () => {
  const item = {
    id: "item-1",
    unit_price: 10000,
    quantity: 3,
    adjustments: [{ amount: 3000 }],
  }
  const returned = [{ itemId: "item-1", quantity: 1 }]

  it("부분 반품의 할인 전 상품금액과 할인액을 구한다", () => {
    expect(receiptItemAmounts([item], returned, 9000)).toEqual({
      itemTotal: 10000,
      discount: 1000,
    })
  })

  it("세금 포함 할인과 여러 상품의 금액을 합한다", () => {
    const taxed = {
      ...item,
      tax_lines: [{ rate: 10 }],
      adjustments: [{ amount: 3300, is_tax_inclusive: true }],
    }
    const other = { id: "item-2", unit_price: 2000, quantity: 1 }

    expect(
      receiptItemAmounts(
        [taxed, other],
        [...returned, { itemId: "item-2", quantity: 1 }],
        10900
      )
    ).toEqual({ itemTotal: 12000, discount: 1100 })
  })

  it("할인이 없으면 차감은 0이다", () => {
    expect(
      receiptItemAmounts([{ ...item, adjustments: [] }], returned, 10000)
    ).toEqual({ itemTotal: 10000, discount: 0 })
  })

  it("정산액이 다르면 차액을 할인으로 추정하지 않는다", () => {
    expect(receiptItemAmounts([item], returned, 6000)).toEqual({
      itemTotal: 6000,
      discount: null,
    })
  })

  it("상품이나 수량이 없으면 정산 상품금액만 사용한다", () => {
    expect(receiptItemAmounts([], returned, 9000)).toEqual({
      itemTotal: 9000,
      discount: null,
    })
    expect(receiptItemAmounts([{ ...item, quantity: 0 }], returned, 0)).toEqual(
      { itemTotal: 0, discount: null }
    )
  })
})

describe("returnedAmount", () => {
  it("줄 금액을 반품 수량만큼 나눈다", () => {
    expect(returnedAmount(30000, 3, 1)).toBe(10000)
  })

  it("수량 0 인 줄은 0", () => {
    expect(returnedAmount(30000, 0, 1)).toBe(0)
  })
})

describe("pickupLabelKey", () => {
  it("창고에 도착했으면 회수 행이 없어도 회수 완료", () => {
    expect(
      pickupLabelKey({
        pickupStatus: "none",
        arrivedAt: "2026-10-21T00:00:00.000Z",
      })
    ).toBe("pickedUp")
  })

  it("접수된 회수는 requested, 아무것도 없으면 none", () => {
    expect(pickupLabelKey({ pickupStatus: "requested", arrivedAt: null })).toBe(
      "requested"
    )
    expect(pickupLabelKey({ pickupStatus: "none", arrivedAt: null })).toBe(
      "none"
    )
  })
})
