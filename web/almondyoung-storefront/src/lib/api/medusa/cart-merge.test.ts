import { describe, expect, it } from "vitest"

import { findMergeableLine } from "./cart-merge"

const line = (
  id: string,
  variant_id: string,
  metadata?: Record<string, unknown> | null
) => ({ id, variant_id, quantity: 3, metadata })

describe("findMergeableLine", () => {
  it("variant 가 같고 양쪽 metadata 가 없으면 그 라인을 고른다", () => {
    expect(findMergeableLine([line("li_1", "var_a")], "var_a")?.id).toBe("li_1")
  })

  it("undefined 와 빈 객체 metadata 를 같다고 본다", () => {
    expect(findMergeableLine([line("li_1", "var_a", {})], "var_a")?.id).toBe(
      "li_1"
    )
    expect(
      findMergeableLine([line("li_1", "var_a", null)], "var_a", {})?.id
    ).toBe("li_1")
  })

  it("metadata 가 다르면 고르지 않는다", () => {
    expect(
      findMergeableLine([line("li_1", "var_a", { bundle: { a: 1 } })], "var_a")
    ).toBeNull()
  })

  it("같은 variant 의 여러 라인 중 metadata 가 맞는 라인을 고른다", () => {
    const items = [
      line("li_bundle", "var_a", { bundle: { a: 1 } }),
      line("li_plain", "var_a"),
    ]
    expect(findMergeableLine(items, "var_a")?.id).toBe("li_plain")
  })

  it("중첩 metadata 는 값으로 비교한다", () => {
    expect(
      findMergeableLine(
        [line("li_1", "var_a", { gift: { to: "x" } })],
        "var_a",
        { gift: { to: "x" } }
      )?.id
    ).toBe("li_1")
  })

  it("variant 가 없으면 null", () => {
    expect(findMergeableLine([line("li_1", "var_b")], "var_a")).toBeNull()
  })

  it("items 가 없으면 null", () => {
    expect(findMergeableLine(null, "var_a")).toBeNull()
    expect(findMergeableLine(undefined, "var_a")).toBeNull()
  })
})
