import { describe, expect, it } from "vitest"
import {
  buildAvailabilityMap,
  classifyCartLineItems,
  describeStockShortage,
  getAvailableQuantity,
  isInsufficientInventoryError,
  isLineItemVariantGone,
  isVariantQuantityUnavailable,
  isVariantSoldOut,
  resolveStockNotice,
} from "./cart-availability"

const tracked = { manage_inventory: true, allow_backorder: false }

describe("getAvailableQuantity", () => {
  it("재고를 추적하는 variant 는 남은 수량을 준다", () => {
    expect(getAvailableQuantity({ ...tracked, inventory_quantity: 3 })).toBe(3)
  })

  it("음수 재고는 0 으로 본다", () => {
    expect(getAvailableQuantity({ ...tracked, inventory_quantity: -2 })).toBe(0)
  })

  it("재고 미추적/백오더 허용은 상한 없음(null)", () => {
    expect(
      getAvailableQuantity({ manage_inventory: false, inventory_quantity: 0 })
    ).toBeNull()
    expect(
      getAvailableQuantity({
        ...tracked,
        allow_backorder: true,
        inventory_quantity: 0,
      })
    ).toBeNull()
  })

  it("variant 를 모르면 상한 없음 — 조회 실패로 구매를 막지 않는다", () => {
    expect(getAvailableQuantity(undefined)).toBeNull()
    expect(getAvailableQuantity(null)).toBeNull()
  })
})

// 재고부족을 전부 "품절" 로 안내하던 것이 문제였다. 재고가 남아있는데 요청 수량만 넘긴 경우와,
// 장바구니에 담긴 수량까지 합쳐 넘긴 경우는 고객이 취할 행동이 달라 구분해서 안내해야 한다.
describe("describeStockShortage", () => {
  it("요청 수량이 남은 재고보다 많으면 수량을 알려줄 수 있다", () => {
    expect(describeStockShortage({ available: 2, quantity: 5 })).toBe(
      "exceeds-stock"
    )
  })

  it("재고 안에서 요청했는데도 실패하면 장바구니 합산 초과로 본다", () => {
    expect(describeStockShortage({ available: 5, quantity: 2 })).toBe(
      "cart-sum"
    )
    expect(describeStockShortage({ available: 5, quantity: 5 })).toBe(
      "cart-sum"
    )
  })

  it("재고 0 은 품절로 구분한다 — 수량 안내로 가면 '0개 이하로 담아주세요' 가 된다", () => {
    expect(describeStockShortage({ available: 0, quantity: 1 })).toBe(
      "sold-out"
    )
    expect(describeStockShortage({ available: 0, quantity: 9 })).toBe(
      "sold-out"
    )
  })

  it("남은 재고를 모르는 화면은 수량 없는 일반 안내로 떨어진다", () => {
    expect(describeStockShortage({})).toBe("unknown")
    expect(describeStockShortage({ available: null, quantity: 3 })).toBe(
      "unknown"
    )
  })

  it("수량을 안 넘기면 1개 담기로 본다", () => {
    expect(describeStockShortage({ available: 1 })).toBe("cart-sum")
    expect(describeStockShortage({ available: 1, quantity: 2 })).toBe(
      "exceeds-stock"
    )
  })
})

describe("isInsufficientInventoryError", () => {
  it("Medusa 재고부족 원문을 알아본다 (이 판정이 깨지면 영문 원문이 그대로 토스트에 뜬다)", () => {
    expect(
      isInsufficientInventoryError(
        new Error("Some variant does not have the required inventory")
      )
    ).toBe(true)
    expect(
      isInsufficientInventoryError(
        "Variant does not have the required inventory"
      )
    ).toBe(true)
  })

  it("다른 에러는 재고부족으로 오인하지 않는다", () => {
    expect(isInsufficientInventoryError(new Error("Cart not found"))).toBe(
      false
    )
    expect(isInsufficientInventoryError(undefined)).toBe(false)
  })
})

// 카트 라인아이템에 붙어오는 variant 에는 inventory_quantity 가 없다. 그걸 폴백으로 쓰면
// 전 라인이 재고 0 으로 읽혀 수량 증가가 통째로 막히고 "재고가 0개 남았어요" 가 뜬다.
describe("buildAvailabilityMap", () => {
  const fetched = new Map([
    ["variant_a", { ...tracked, inventory_quantity: 4 }],
    ["variant_b", { manage_inventory: false, inventory_quantity: 0 }],
  ])

  it("재고가 계산된 variant 만 상한을 갖는다", () => {
    const map = buildAvailabilityMap(
      [{ variant_id: "variant_a" }, { variant_id: "variant_b" }],
      fetched
    )
    expect(map).toEqual({ variant_a: 4 })
  })

  it("상품 조회에 없던 variant 는 상한을 두지 않는다 (조회 실패로 구매를 막지 않는다)", () => {
    const map = buildAvailabilityMap(
      [{ variant_id: "variant_missing" }],
      fetched
    )
    expect(map).toEqual({})
    expect(map.variant_missing).toBeUndefined()
  })

  it("조회가 통째로 실패해도(빈 맵) 아무 라인도 막지 않는다", () => {
    const map = buildAvailabilityMap(
      [{ variant_id: "variant_a" }, { variant_id: "variant_b" }],
      new Map()
    )
    expect(map).toEqual({})
  })

  it("variant_id 가 없는 라인은 건너뛴다", () => {
    expect(buildAvailabilityMap([{ variant_id: null }, {}], fetched)).toEqual(
      {}
    )
  })
})

// 결제 전 게이트(체크아웃)가 쓰는 판정. 품절(isVariantSoldOut)만 보던 기존 게이트는
// "담은 수량 > 가용재고" 를 통과시켰고, 그대로 결제로 가면 cart.complete 의 재고예약이 실패했다.
describe("isVariantQuantityUnavailable", () => {
  it("담은 수량이 가용재고를 넘으면 불가로 본다", () => {
    expect(
      isVariantQuantityUnavailable({ ...tracked, inventory_quantity: 1 }, 2)
    ).toBe(true)
  })

  it("가용재고와 같은 수량은 구매 가능하다", () => {
    expect(
      isVariantQuantityUnavailable({ ...tracked, inventory_quantity: 2 }, 2)
    ).toBe(false)
  })

  it("품절(재고 0)은 기존 판정과 겹친다", () => {
    const variant = { ...tracked, inventory_quantity: 0 }
    expect(isVariantSoldOut(variant)).toBe(true)
    expect(isVariantQuantityUnavailable(variant, 1)).toBe(true)
  })

  it("재고관리를 안 하거나 백오더 허용이면 수량 제한이 없다", () => {
    expect(
      isVariantQuantityUnavailable(
        { manage_inventory: false, inventory_quantity: 0 },
        10
      )
    ).toBe(false)
    expect(
      isVariantQuantityUnavailable(
        {
          manage_inventory: true,
          allow_backorder: true,
          inventory_quantity: 0,
        },
        10
      )
    ).toBe(false)
  })

  it("variant 정보가 없으면 막지 않는다 (조회 실패로 구매를 막지 않기 위함)", () => {
    expect(isVariantQuantityUnavailable(undefined, 3)).toBe(false)
    expect(isVariantQuantityUnavailable(null, 3)).toBe(false)
  })
})

describe("isLineItemVariantGone", () => {
  const published = new Set(["prod_1"])
  const variantsOf = (ids: string[]) => new Map([["prod_1", new Set(ids)]])

  it("상품은 게시 중인데 variant 만 없어진 라인을 잡는다", () => {
    expect(
      isLineItemVariantGone(
        { product_id: "prod_1", variant_id: "variant_gone" },
        published,
        variantsOf(["variant_alive"])
      )
    ).toBe(true)
  })

  it("살아있는 variant 는 잡지 않는다", () => {
    expect(
      isLineItemVariantGone(
        { product_id: "prod_1", variant_id: "variant_alive" },
        published,
        variantsOf(["variant_alive"])
      )
    ).toBe(false)
  })

  it("상품 조회가 통째로 실패하면 판정하지 않는다 (미게시 판정이 맡는다)", () => {
    expect(
      isLineItemVariantGone(
        { product_id: "prod_1", variant_id: "variant_gone" },
        new Set(),
        new Map()
      )
    ).toBe(false)
  })

  it("응답에 variant 가 안 실려왔으면 판정하지 않는다 — 멀쩡한 카트를 막는 게 더 나쁘다", () => {
    expect(
      isLineItemVariantGone(
        { product_id: "prod_1", variant_id: "variant_gone" },
        published,
        variantsOf([])
      )
    ).toBe(false)
  })

  it("id 를 모르는 라인은 판정하지 않는다", () => {
    expect(
      isLineItemVariantGone(
        { product_id: "prod_1" },
        published,
        variantsOf(["v"])
      )
    ).toBe(false)
    expect(
      isLineItemVariantGone(
        { variant_id: "variant_gone" },
        published,
        variantsOf(["v"])
      )
    ).toBe(false)
  })
})

describe("classifyCartLineItems", () => {
  const inStock = {
    id: "variant_ok",
    manage_inventory: true,
    allow_backorder: false,
    inventory_quantity: 5,
  }

  it("상품은 게시 중인데 variant 만 삭제된 라인을 결제 차단 대상으로 넘긴다", () => {
    const result = classifyCartLineItems(
      [
        {
          product_id: "prod_1",
          variant_id: "variant_deleted",
          quantity: 1,
          product_title: "사라진 옵션 상품",
          variant: null,
        },
      ],
      [{ id: "prod_1", variants: [inStock] }]
    )

    expect(result.variantIds).toEqual(["variant_deleted"])
    expect(result.productNames).toEqual(["사라진 옵션 상품"])
  })

  it("멀쩡한 라인은 통과시킨다", () => {
    const result = classifyCartLineItems(
      [
        {
          product_id: "prod_1",
          variant_id: "variant_ok",
          quantity: 2,
          product_title: "정상 상품",
        },
      ],
      [{ id: "prod_1", variants: [inStock] }]
    )

    expect(result.variantIds).toEqual([])
    expect(result.insufficientVariantIds).toEqual([])
    expect(result.availableByVariantId).toEqual({ variant_ok: 5 })
  })

  it("상품 조회가 통째로 비면 라인을 전부 막되 variant 판정을 이중으로 세지 않는다", () => {
    const result = classifyCartLineItems(
      [
        {
          product_id: "prod_1",
          variant_id: "variant_deleted",
          quantity: 1,
          product_title: "조회 실패",
        },
      ],
      []
    )

    expect(result.variantIds).toEqual(["variant_deleted"])
  })

  it("담은 수량이 남은 재고를 넘으면 부족 목록으로 간다", () => {
    const result = classifyCartLineItems(
      [
        {
          product_id: "prod_1",
          variant_id: "variant_ok",
          quantity: 9,
          product_title: "재고보다 많이 담음",
        },
      ],
      [{ id: "prod_1", variants: [inStock] }]
    )

    expect(result.variantIds).toEqual([])
    expect(result.insufficientVariantIds).toEqual(["variant_ok"])
    expect(result.insufficientNames).toEqual(["재고보다 많이 담음"])
  })

  it("품절 라인은 부족이 아니라 구매 불가로 분류한다", () => {
    const result = classifyCartLineItems(
      [
        {
          product_id: "prod_1",
          variant_id: "variant_out",
          quantity: 1,
          product_title: "품절",
        },
      ],
      [
        {
          id: "prod_1",
          variants: [
            {
              id: "variant_out",
              manage_inventory: true,
              allow_backorder: false,
              inventory_quantity: 0,
            },
          ],
        },
      ]
    )

    expect(result.variantIds).toEqual(["variant_out"])
    expect(result.insufficientVariantIds).toEqual([])
  })
})

describe("classifyCartLineItems — 구매 불가 사유 구분", () => {
  it("옵션만 없어진 라인은 상품 판매중단과 따로 표시한다", () => {
    const result = classifyCartLineItems(
      [
        {
          product_id: "prod_live",
          variant_id: "variant_gone",
          quantity: 1,
          product_title: "판매중인 상품",
        },
        {
          product_id: "prod_dead",
          variant_id: "variant_dead",
          quantity: 1,
          product_title: "내려간 상품",
        },
      ],
      [{ id: "prod_live", variants: [{ id: "variant_other" }] }]
    )

    expect(result.variantIds.sort()).toEqual(["variant_dead", "variant_gone"])
    expect(result.optionGoneVariantIds).toEqual(["variant_gone"])
  })

  it("상품은 왔는데 variant 목록이 비어 있으면 구매를 막지 않는다", () => {
    const result = classifyCartLineItems(
      [{ product_id: "prod_1", variant_id: "variant_x", quantity: 1 }],
      [{ id: "prod_1", variants: [] }]
    )

    expect(result.variantIds).toEqual([])
    expect(result.optionGoneVariantIds).toEqual([])
  })

  it("품절은 옵션 소멸이 아니다", () => {
    const result = classifyCartLineItems(
      [{ product_id: "prod_1", variant_id: "variant_out", quantity: 1 }],
      [
        {
          id: "prod_1",
          variants: [
            {
              id: "variant_out",
              manage_inventory: true,
              allow_backorder: false,
              inventory_quantity: 0,
            },
          ],
        },
      ]
    )

    expect(result.variantIds).toEqual(["variant_out"])
    expect(result.optionGoneVariantIds).toEqual([])
  })
})

describe("resolveStockNotice", () => {
  it("상한을 모르면 아무 안내도 하지 않는다", () => {
    expect(resolveStockNotice(3, undefined)).toBeNull()
  })

  it("품절 라인은 구매 불가로 따로 잡히므로 여기서는 안내하지 않는다", () => {
    expect(resolveStockNotice(2, 0)).toBeNull()
  })

  it("담긴 수량이 재고를 넘으면 남은 수량과 함께 안내한다", () => {
    expect(resolveStockNotice(10, 5)).toEqual({ kind: "overStock", max: 5 })
  })

  it("담긴 수량이 재고와 같으면 상한에 닿았다고만 알린다", () => {
    expect(resolveStockNotice(5, 5)).toEqual({ kind: "atLimit", max: 5 })
  })

  it("여유가 있으면 아무 안내도 하지 않는다", () => {
    expect(resolveStockNotice(2, 5)).toBeNull()
  })
})

describe("classifyCartLineItems — 품절과 판매중단 구분", () => {
  it("재고 0 인 라인은 품절로 따로 표시된다", () => {
    const result = classifyCartLineItems(
      [{ product_id: "prod_1", variant_id: "var_1", quantity: 1 }],
      [
        {
          id: "prod_1",
          variants: [
            {
              id: "var_1",
              manage_inventory: true,
              allow_backorder: false,
              inventory_quantity: 0,
            },
          ],
        },
      ]
    )

    expect(result.variantIds).toContain("var_1")
    expect(result.soldOutVariantIds).toEqual(["var_1"])
    expect(result.optionGoneVariantIds).toEqual([])
  })

  it("미게시 상품은 품절이 아니라 판매중단으로 남는다", () => {
    const result = classifyCartLineItems(
      [{ product_id: "prod_gone", variant_id: "var_2", quantity: 1 }],
      []
    )

    expect(result.variantIds).toContain("var_2")
    expect(result.soldOutVariantIds).toEqual([])
  })
})
