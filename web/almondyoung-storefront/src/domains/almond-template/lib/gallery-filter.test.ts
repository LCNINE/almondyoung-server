import { expect, it } from "vitest"
import { PRINT_PRODUCTS } from "./catalog"
import {
  filterTemplates,
  published,
  type PublishedTemplate,
} from "./gallery-filter"

it("게시 시안을 상품·규격·색상·검색어로 걸러낸다", () => {
  const pet = Object.keys(PRINT_PRODUCTS).find(
    (id) => PRINT_PRODUCTS[id].kind === "pet"
  )!
  const mini = Object.keys(PRINT_PRODUCTS).find(
    (id) => PRINT_PRODUCTS[id].kind === "mini"
  )!
  const items: PublishedTemplate[] = [
    {
      id: "red",
      title: "여름 행사",
      productId: pet,
      size: "600x1800",
      thumbnail: "https://ugc.test/red.svg",
      updatedAt: "2026-09-30T00:00:00.000Z",
      colors: ["#e53935"],
      industry: "미용·뷰티",
      purpose: "이벤트·홍보",
    },
    {
      id: "blue",
      title: "여름 행사",
      productId: pet,
      size: "600x1800",
      thumbnail: "https://ugc.test/blue.svg",
      updatedAt: "2026-09-30T00:00:00.000Z",
      colors: ["#2563eb"],
      industry: "미용·뷰티",
      purpose: "이벤트·홍보",
    },
    {
      id: "small",
      title: "가격표",
      productId: mini,
      size: "150x300",
      thumbnail: "https://ugc.test/small.svg",
      updatedAt: "2026-09-30T00:00:00.000Z",
      colors: ["#e53935"],
      industry: "카페·음료",
      purpose: "가격·메뉴",
    },
  ]
  const filters = {
    productId: pet,
    availableKinds: ["pet", "mini"] as const,
    kind: "pet" as const,
    size: "600x1800",
    keyword: "여름",
    colors: ["#e53935"],
    industry: "미용·뷰티",
    purpose: "이벤트·홍보",
  }
  expect(filterTemplates(items, filters).map((item) => item.id)).toEqual([
    "red",
  ])
  expect(
    filterTemplates(items, { ...filters, colors: ["#2563eb"] }).map(
      (item) => item.id
    )
  ).toEqual(["blue"])
  expect(filterTemplates(items, { ...filters, keyword: "가격표" })).toEqual([])
})

it("카탈로그에 없는 상품이나 잘못된 규격은 게시 목록에서 뺀다", () => {
  const item: PublishedTemplate = {
    id: "sample",
    title: "시안",
    productId: Object.keys(PRINT_PRODUCTS)[0],
    size: "90x50",
    thumbnail: "https://ugc.test/sample.svg",
    colors: [],
    industry: null,
    purpose: null,
    updatedAt: "2026-09-30T00:00:00.000Z",
  }
  expect(published(item)).toBe(true)
  expect(published({ ...item, productId: "unknown" })).toBe(false)
  expect(published({ ...item, size: "90x50x1" })).toBe(false)
})
