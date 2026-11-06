import { expect, it } from "vitest"
import { PRINT_PRODUCTS } from "./catalog"
import { templateProductOf } from "./template-product"

it("고정 상품은 PRINT_PRODUCTS 값을 그대로 돌려준다", () => {
  const [id, item] = Object.entries(PRINT_PRODUCTS)[0]

  expect(templateProductOf(id, [])).toEqual({
    productId: id,
    kind: item.kind,
    title: item.title,
  })
})

it("고정 상품이 아니면 공개 템플릿의 kind 로 판단한다", () => {
  expect(
    templateProductOf("new", [
      { productId: "other", kind: "menu", title: "다른" },
      { productId: "new", kind: "bizcard", title: "명함" },
    ])
  ).toEqual({ productId: "new", kind: "bizcard", title: "명함" })
})

it("어느 쪽에도 없거나 kind 가 올바르지 않으면 undefined", () => {
  expect(templateProductOf("none", [])).toBeUndefined()
  expect(
    templateProductOf("new", [{ productId: "new", kind: "zzz", title: "x" }])
  ).toBeUndefined()
})
