import type { StoreProduct } from "@medusajs/types"
import { describe, expect, it } from "vitest"
import { pickBiggestMemberSavings, toV1CardItem } from "./v1-card-data"

const product = (
  id: string,
  price: number,
  membershipPrice?: number,
  metadata: Record<string, unknown> = {}
): StoreProduct =>
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
        inventory_quantity: 5,
        metadata: membershipPrice ? { membershipPrice } : {},
        calculated_price: {
          calculated_amount: price,
          original_amount: price,
          currency_code: "krw",
        },
      },
    ],
  }) as unknown as StoreProduct

describe("toV1CardItem", () => {
  it("정가보다 싼 멤버십가를 싣는다", () => {
    expect(toV1CardItem(product("a", 10000, 8000), false)).toMatchObject({
      price: 10000,
      regularPrice: 10000,
      membershipPrice: 8000,
    })
  })

  it("멤버십가가 없으면 null", () => {
    expect(toV1CardItem(product("a", 10000), false)?.membershipPrice).toBeNull()
  })

  it("비회원에게 숨긴 멤버십가는 비회원에게만 감춘다", () => {
    const hidden = product("a", 10000, 8000, {
      hideMembershipPriceForNonMembers: true,
    })

    expect(toV1CardItem(hidden, false)?.membershipPrice).toBeNull()
    expect(toV1CardItem(hidden, true)?.membershipPrice).toBe(8000)
  })
})

describe("pickBiggestMemberSavings", () => {
  it("멤버십가로 아끼는 돈이 큰 순서로 고르고 멤버십가 없는 상품은 뺀다", () => {
    const items = [
      product("small", 10000, 9000),
      product("none", 50000),
      product("big", 300000, 250000),
      product("mid", 100000, 80000),
    ].map((p) => toV1CardItem(p, false)!)

    const picked = pickBiggestMemberSavings(items, 2)

    expect(picked.map((i) => [i.id, i.saving])).toEqual([
      ["big", 50000],
      ["mid", 20000],
    ])
  })
})
