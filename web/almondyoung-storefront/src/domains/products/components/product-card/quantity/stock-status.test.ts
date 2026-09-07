import { describe, expect, it } from "vitest"
import type { HttpTypes } from "@medusajs/types"
import { filterSoldOut } from "./stock-status"

const product = (
  id: string,
  variants: Partial<HttpTypes.StoreProductVariant>[]
) => ({ id, variants }) as HttpTypes.StoreProduct

describe("filterSoldOut", () => {
  it("전 옵션 품절만 빼고 순서는 유지한다", () => {
    const list = [
      product("a", [{ manage_inventory: true, inventory_quantity: 3 }]),
      product("sold", [{ manage_inventory: true, inventory_quantity: 0 }]),
      product("b", [{ manage_inventory: true, inventory_quantity: 1 }]),
    ]

    expect(filterSoldOut(list).map((p) => p.id)).toEqual(["a", "b"])
  })

  it("재고 미관리·백오더·일부 품절은 남긴다", () => {
    const list = [
      product("untracked", [{ manage_inventory: false }]),
      product("backorder", [
        { manage_inventory: true, allow_backorder: true, inventory_quantity: 0 },
      ]),
      product("partial", [
        { manage_inventory: true, inventory_quantity: 0 },
        { manage_inventory: true, inventory_quantity: 2 },
      ]),
    ]

    expect(filterSoldOut(list)).toHaveLength(3)
  })
})
