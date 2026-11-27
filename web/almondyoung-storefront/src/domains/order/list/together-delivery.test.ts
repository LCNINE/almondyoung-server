import { describe, expect, it } from "vitest"

import { groupForTogetherDelivery, parentCancelInfo } from "./together-delivery"

const link = (over: Record<string, unknown> = {}) => ({
  parentOrderId: null,
  parentDisplayId: null,
  parentCanceled: false,
  parentWithheldAmount: 0,
  children: [] as string[],
  waivedAmount: 0,
  withheldAmount: 0,
  ...over,
})
const actions = (orderStatus: string) => ({ orderStatus }) as never

describe("groupForTogetherDelivery", () => {
  const orders = [{ orderId: "c" }, { orderId: "p" }, { orderId: "x" }]

  it("같은 페이지의 출고 전 부모 아래로 자식을 모은다", () => {
    const groups = groupForTogetherDelivery(
      orders,
      { c: link({ parentOrderId: "p" }), p: link({ children: ["c"] }) },
      { p: actions("confirmed") }
    )

    expect(groups.map((g) => [g.parent.orderId, g.children.map((c) => c.orderId)])).toEqual([
      ["p", ["c"]],
      ["x", []],
    ])
  })

  it("취소된 자식은 부모 아래로 묶지 않는다", () => {
    const groups = groupForTogetherDelivery(
      orders,
      { c: link({ parentOrderId: "p" }) },
      { p: actions("confirmed"), c: actions("cancelled") }
    )

    expect(groups.map((g) => g.parent.orderId)).toEqual(["c", "p", "x"])
  })

  it("부모가 취소됐거나 이 페이지에 없으면 자식은 혼자 그린다", () => {
    const canceled = groupForTogetherDelivery(
      orders,
      { c: link({ parentOrderId: "p" }) },
      { p: actions("cancelled") }
    )
    const missing = groupForTogetherDelivery([{ orderId: "c" }], { c: link({ parentOrderId: "p" }) }, {})

    expect(canceled.map((g) => g.parent.orderId)).toEqual(["c", "p", "x"])
    expect(missing.map((g) => g.parent.orderId)).toEqual(["c"])
  })
})

describe("parentCancelInfo", () => {
  it("살아 있는 자식이 있는 출고 전 부모만 취소 창 정보를 낸다", () => {
    expect(parentCancelInfo(link({ children: ["c"], withheldAmount: 3000 }), actions("confirmed"))).toEqual({
      withheldAmount: 3000,
      childOrderIds: ["c"],
    })
    expect(parentCancelInfo(link({ children: ["c"], withheldAmount: 3000 }), actions("cancelled"))).toBeUndefined()
    expect(parentCancelInfo(link({ parentOrderId: "p", withheldAmount: 3000 }), actions("confirmed"))).toBeUndefined()
    expect(parentCancelInfo(undefined, undefined)).toBeUndefined()
  })
})
