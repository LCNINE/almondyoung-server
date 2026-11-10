import type { StoreProduct } from "@medusajs/types"
import { describe, expect, it } from "vitest"
import {
  collectBrandCategoryIds,
  flattenBrandTiles,
  pickTopBrandProducts,
} from "./brand-hall-data"

type ProductInput = {
  id: string
  stock?: number
  price?: number
  membershipPrice?: number
  metadata?: Record<string, unknown>
}

const product = ({
  id,
  stock = 10,
  price = 10000,
  membershipPrice,
  metadata = {},
}: ProductInput): StoreProduct =>
  ({
    id,
    handle: `h-${id}`,
    title: `상품 ${id}`,
    thumbnail: `file-${id}`,
    metadata,
    variants: [
      {
        id: `v-${id}`,
        manage_inventory: true,
        inventory_quantity: stock,
        metadata: membershipPrice ? { membershipPrice } : {},
        calculated_price: {
          calculated_amount: price,
          original_amount: price,
          currency_code: "krw",
        },
      },
    ],
  }) as unknown as StoreProduct

describe("pickTopBrandProducts", () => {
  it("판매량 순서를 지키며 3개까지 고른다", () => {
    const picked = pickTopBrandProducts(
      ["a", "b", "c", "d"].map((id) => product({ id })),
      false
    )

    expect(picked.map((p) => p.id)).toEqual(["a", "b", "c"])
  })

  it("재고 있는 상품을 품절보다 앞에 두되, 품절로라도 채운다", () => {
    const picked = pickTopBrandProducts(
      [
        product({ id: "a", stock: 0 }),
        product({ id: "b" }),
        product({ id: "c", stock: 0 }),
      ],
      false
    )

    expect(picked.map((p) => p.id)).toEqual(["b", "a", "c"])
  })

  it("비회원에게는 회원 전용 노출 상품을 뺀다", () => {
    const products = [
      product({ id: "a", metadata: { isVisibleToMembersOnly: true } }),
      product({ id: "b" }),
    ]

    expect(pickTopBrandProducts(products, false).map((p) => p.id)).toEqual([
      "b",
    ])
    expect(pickTopBrandProducts(products, true).map((p) => p.id)).toEqual([
      "a",
      "b",
    ])
  })

  it("멤버십가는 더 싸고 공개된 경우에만 싣는다", () => {
    const [open, hidden] = pickTopBrandProducts(
      [
        product({ id: "a", membershipPrice: 8000 }),
        product({
          id: "b",
          membershipPrice: 8000,
          metadata: { hideMembershipPriceForNonMembers: true },
        }),
      ],
      false
    )

    expect(open.membershipPrice).toBe(8000)
    expect(hidden.membershipPrice).toBeNull()
  })
})

describe("flattenBrandTiles / collectBrandCategoryIds", () => {
  const brand = (
    id: string,
    children: { id: string; name: string; handle: string }[] = []
  ) => ({
    category: { id, name: id, handle: id, category_children: children },
    handlePath: ["brand", id],
  })

  it("그룹을 펼치고 중복 브랜드는 한 번만, 최대 개수로 자른다", () => {
    const tiles = flattenBrandTiles(
      [
        { category: null, brands: [brand("a"), brand("b")] },
        { category: null, brands: [brand("b"), brand("c"), brand("d")] },
      ],
      3
    )

    expect(tiles.map((t) => t.category.id)).toEqual(["a", "b", "c"])
  })

  it("하위 카테고리 id 까지 모은다", () => {
    const { category } = brand("a", [{ id: "a-1", name: "a-1", handle: "a-1" }])

    expect(collectBrandCategoryIds(category)).toEqual(["a", "a-1"])
  })
})
