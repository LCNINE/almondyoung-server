import { describe, expect, it } from "vitest"
import { groupOrderItems } from "./order-status-groups"

const item = (id: string, statusLabel?: string, statusHint?: string) => ({
  id,
  title: id,
  thumbnail: "",
  price: "1,000원 · 1개",
  statusLabel,
  statusHint,
})

describe("groupOrderItems", () => {
  it("combines ordinary items and keeps return statuses separate in item order", () => {
    const groups = groupOrderItems(
      [
        item("a", "반품 진행 중"),
        item("b"),
        item("c", "반품 진행 중"),
        item("d", "교환 완료"),
        item("e"),
      ],
      "상품 준비 중"
    )

    expect(
      groups.map((group) => [group.status, group.items.map((i) => i.id)])
    ).toEqual([
      ["반품 진행 중", ["a", "c"]],
      ["상품 준비 중", ["b", "e"]],
      ["교환 완료", ["d"]],
    ])
    expect(groups.filter((group) => group.isOrderStatus)).toHaveLength(1)
  })

  it("keeps an order group distinct even when its label matches a return label", () => {
    const groups = groupOrderItems(
      [item("a", "반품 완료"), item("b")],
      "반품 완료"
    )

    expect(groups).toHaveLength(2)
    expect(groups.map((group) => group.isOrderStatus)).toEqual([false, true])
  })

  it("does not invent an empty order card for fully returned or empty orders", () => {
    expect(
      groupOrderItems(
        [item("a", "반품 완료"), item("b", "반품 완료")],
        "결제 완료"
      )
    ).toHaveLength(1)
    expect(groupOrderItems([], "결제 완료")).toEqual([])
  })

  it("only promotes a shared hint to the group title", () => {
    const same = groupOrderItems(
      [
        item("a", "반품 완료", "10/20 환불"),
        item("b", "반품 완료", "10/20 환불"),
      ],
      "결제 완료"
    )
    const different = groupOrderItems(
      [item("a", "반품 완료", "1개"), item("b", "반품 완료")],
      "결제 완료"
    )

    expect(same[0].hint).toBe("10/20 환불")
    expect(different[0].hint).toBeUndefined()
    expect(different[0].items[0].statusHint).toBe("1개")
    expect(
      groupOrderItems([item("a")], "배송 완료", "10/20 도착")[0].hint
    ).toBe("10/20 도착")
  })
})
