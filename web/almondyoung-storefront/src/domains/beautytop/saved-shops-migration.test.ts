import { describe, expect, it } from "vitest"
import { planLocalMigration } from "./saved-shops-migration"

const empty = { myShop: null, watch: [] }
const local = (id: number) => ({ id, kind: "SHOP" as const, name: `Shop ${id}`, sido: "서울" })

describe("moving browser-saved shops to the account", () => {
  it("moves my shop and watched shops into an empty account", () => {
    expect(planLocalMigration(empty, { id: 1, name: "Mine" }, [local(2), local(3)], 7)).toEqual({
      myShop: { shopKind: "SHOP", shopId: 1, name: "Mine", sido: null, gugun: null, category: null },
      watch: [
        { shopKind: "SHOP", shopId: 2, name: "Shop 2", sido: "서울", gugun: null, category: null },
        { shopKind: "SHOP", shopId: 3, name: "Shop 3", sido: "서울", gugun: null, category: null },
      ],
    })
  })

  it("never overwrites an account that already has shops", () => {
    const server = { myShop: null, watch: [{ shopKind: "SHOP" as const, shopId: 9, name: "Elsewhere" }] }
    expect(planLocalMigration(server, local(1), [local(2)], 7)).toBeNull()
  })

  it("drops junk, duplicates and anything past the limit", () => {
    const plan = planLocalMigration(empty, "garbage", [local(2), local(2), { id: 0, name: "x" }, null, ...[3, 4, 5, 6, 7, 8, 9].map(local)], 7)
    expect(plan?.myShop).toBeNull()
    expect(plan?.watch.map((s) => s.shopId)).toEqual([2, 3, 4, 5, 6, 7, 8])
  })

  it("has nothing to do when the browser saved nothing", () => {
    expect(planLocalMigration(empty, null, null, 7)).toBeNull()
  })
})
