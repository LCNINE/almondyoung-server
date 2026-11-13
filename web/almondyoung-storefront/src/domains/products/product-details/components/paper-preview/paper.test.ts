import { describe, expect, it } from "vitest"
import { paperVariantOf, paperTemplateOf } from "./paper"

describe("paperVariantOf", () => {
  it.each([
    ["스노우지(무코팅) 250g", "uncoated"],
    ["스노우지(무광코팅) 250g", "matte_coated"],
    ["유광코팅", undefined],
    ["", undefined],
    [undefined, undefined],
  ])("maps %s to %s", (value, expected) => {
    expect(paperVariantOf(value)).toBe(expected)
  })
})

describe("paperTemplateOf", () => {
  const templates = [
    { id: "other", productId: "other-product", kind: "bizcard" },
    { id: "poster", productId: "product", kind: "poster" },
    { id: "card", productId: "product", kind: "card" },
  ]

  it("finds the matching published card template, not the first template", () => {
    expect(paperTemplateOf("product", templates)?.id).toBe("card")
    expect(paperTemplateOf("other-product", templates)?.id).toBe("other")
  })

  it("hides unrelated products and unavailable template lists", () => {
    expect(paperTemplateOf("missing", templates)).toBeUndefined()
    expect(paperTemplateOf("product", null)).toBeUndefined()
    expect(paperTemplateOf("product", templates.slice(0, 2))).toBeUndefined()
  })
})

describe("paperTemplateOf", () => {
  it("명함·주의사항 카드는 명함 모델, 네일팁은 네일 모델을 쓴다", () => {
    const templates = [
      { id: "t1", productId: "p1", kind: "bizcard" },
      { id: "t2", productId: "p2", kind: "nail" },
      { id: "t3", productId: "p3", kind: "menu" },
    ]

    expect(paperTemplateOf("p1", templates)).toEqual({
      id: "t1",
      shape: "card",
    })
    expect(paperTemplateOf("p2", templates)).toEqual({
      id: "t2",
      shape: "nail",
    })
    expect(paperTemplateOf("p3", templates)).toBeUndefined()
  })
})
