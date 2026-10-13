import { describe, expect, it } from "vitest"
import type { HttpTypes } from "@medusajs/types"
import type { TimeSale } from "@/lib/api/medusa/time-sale"
import { buildSaleProducts, productPeriods } from "./sale-products"

describe("buildSaleProducts", () => {
  it("현재 판매가를 만든 옵션의 공개 멤버십가만 연결한다", () => {
    const product = {
      id: "prod_1",
      title: "상품",
      handle: "prod-1",
      metadata: {},
      variants: [
        {
          id: "cheap",
          calculated_price: { calculated_amount: 5000, original_amount: 6700 },
          metadata: { membershipPrice: 3990 },
        },
        {
          id: "other",
          calculated_price: { calculated_amount: 6000, original_amount: 7000 },
          metadata: { membershipPrice: 1000 },
        },
      ],
    } as unknown as HttpTypes.StoreProduct
    const build = () =>
      buildSaleProducts({
        sales: [],
        ids: ["prod_1"],
        products: [product],
        countryCode: "kr",
      })[0]

    expect(build().membershipPrice).toBe(3990)
    expect(build().quickActions).toMatchObject({
      handle: "prod-1",
      variantId: "cheap",
      isSingleOption: false,
      isWishlisted: false,
      membersOnlyPurchase: false,
    })
    const wishlisted = buildSaleProducts({
      sales: [],
      ids: ["prod_1"],
      products: [product],
      countryCode: "kr",
      wishlistIds: ["prod_1"],
    })[0]
    expect(wishlisted.quickActions?.isWishlisted).toBe(true)
    delete product.variants![0].metadata!.membershipPrice
    expect(build().membershipPrice).toBeNull()
  })

  it.each([NaN, Infinity, -Infinity])(
    "유효하지 않은 가격 %s를 카드에 노출하지 않는다",
    (amount) => {
      const product = {
        id: "prod_1",
        title: "상품",
        handle: "prod-1",
        variants: [
          {
            id: "variant",
            calculated_price: {
              calculated_amount: amount,
              original_amount: amount,
            },
          },
        ],
      } as unknown as HttpTypes.StoreProduct

      const [card] = buildSaleProducts({
        sales: [],
        ids: ["prod_1"],
        products: [product],
        countryCode: "kr",
      })

      expect(card.price).toBeNull()
      expect(card.originalPrice).toBeNull()
    }
  )

  describe("멤버십 전용 특가", () => {
    const sale = {
      id: "ts_1",
      startsAt: "2030-01-01T00:00:00.000Z",
      endsAt: "2030-01-10T00:00:00.000Z",
      priceListIds: ["pl_m"],
      productIds: ["prod_m"],
      membershipOnlyVariantIds: ["v_m"],
    } satisfies TimeSale
    const product = (calculated: number, priceListId: string | null = null) =>
      ({
        id: "prod_m",
        title: "롤리킹",
        handle: "prod-m",
        metadata: {},
        variants: [
          {
            id: "v_m",
            calculated_price: {
              calculated_amount: calculated,
              original_amount: 18000,
              calculated_price: { price_list_id: priceListId },
            },
            metadata: { membershipPrice: 16000 },
          },
        ],
      }) as unknown as HttpTypes.StoreProduct
    const build = (
      calculated: number,
      isMember: boolean,
      priceListId: string | null = null
    ) =>
      buildSaleProducts({
        sales: [sale],
        ids: ["prod_m"],
        products: [product(calculated, priceListId)],
        countryCode: "kr",
        isMember,
      })[0]

    it("비회원에게는 일반가 그대로, 특가는 회원 공개로 숨긴다", () => {
      expect(build(18000, false)).toMatchObject({
        membershipSale: true,
        membershipOnly: true,
        price: 18000,
        originalPrice: 18000,
        membershipPrice: null,
      })
    })

    it("회원에게는 일반가 아래 특가를 보인다", () => {
      expect(build(14000, true, "pl_m")).toMatchObject({
        membershipSale: true,
        price: 18000,
        originalPrice: 18000,
        membershipPrice: 14000,
      })
    })

    it("회원에게 상시 멤버십가가 더 싸게 적용됐으면 기간 특가로 그리지 않는다", () => {
      expect(
        build(11900, true, "pl_membership_prices").membershipSale
      ).toBeUndefined()
    })

    it("회원에게 상시 멤버십가가 적용됐으면 타임세일 배지·카운트다운도 끈다", () => {
      expect(build(11900, true, "pl_membership_prices").onSale).toBe(false)
      expect(build(9900, true, "pl_m").onSale).toBeUndefined()
      expect(build(18000, false).onSale).toBeUndefined()
    })

    it("대표 옵션이 멤버십 전용 특가가 아니면 멤버십 특가로 그리지 않는다", () => {
      const mixed = product(18000)
      mixed.variants![0].id = "v_plain"
      const [card] = buildSaleProducts({
        sales: [sale],
        ids: ["prod_m"],
        products: [mixed],
        countryCode: "kr",
      })
      expect(card.membershipSale).toBeUndefined()
    })
  })

  it("썸네일 파일 id 를 파일 서비스 주소로 바꾼다", () => {
    const product = {
      id: "prod_1",
      title: "상품",
      handle: "prod-1",
      thumbnail: "01a047c4-b9d8-76cf-8294-1b10eecc9823",
      variants: [],
    } as unknown as HttpTypes.StoreProduct

    const [card] = buildSaleProducts({
      sales: [],
      ids: ["prod_1"],
      products: [product],
      countryCode: "kr",
    })

    expect(card.image).toMatch(
      /^https?:\/\/.+\/files\/public\/01a047c4-b9d8-76cf-8294-1b10eecc9823$/
    )
  })

  // 옵션마다 다른 세일에 걸릴 수 있다(겹침 검사가 옵션 단위). 카드 가격을 만든 세일의 기간을 써야 타이머가 맞는다.
  it("대표 옵션 가격을 만든 세일의 기간을 쓴다", () => {
    const early = {
      id: "ts_early",
      startsAt: "2030-01-01T00:00:00.000Z",
      endsAt: "2030-01-02T00:00:00.000Z",
      priceListIds: ["pl_early"],
      productIds: ["prod_1"],
      variantIds: ["v_other"],
    } satisfies TimeSale
    const late = {
      id: "ts_late",
      startsAt: "2030-01-01T00:00:00.000Z",
      endsAt: "2030-01-09T00:00:00.000Z",
      priceListIds: ["pl_late"],
      productIds: ["prod_1"],
      variantIds: ["v_cheap"],
    } satisfies TimeSale
    const product = {
      id: "prod_1",
      title: "상품",
      handle: "prod-1",
      variants: [
        {
          id: "v_cheap",
          calculated_price: {
            calculated_amount: 5000,
            original_amount: 7000,
            calculated_price: { price_list_id: "pl_late" },
          },
        },
      ],
    } as unknown as HttpTypes.StoreProduct

    const [card] = buildSaleProducts({
      sales: [early, late],
      ids: ["prod_1"],
      products: [product],
      countryCode: "kr",
    })
    expect(card.endsAt).toBe("2030-01-09T00:00:00.000Z")
  })

  it("상품이 세일 여럿에 걸리면 먼저 끝나는 세일 기간을 쓴다", () => {
    const sale = (id: string, endsAt: string, productIds: string[]) =>
      ({
        id,
        startsAt: "2026-10-01T00:00:00.000Z",
        endsAt,
        priceListIds: [],
        productIds,
      }) as TimeSale

    const periods = productPeriods([
      sale("tsale_late", "2026-10-20T00:00:00.000Z", ["p1", "p2"]),
      sale("tsale_early", "2026-10-15T00:00:00.000Z", ["p1"]),
    ])

    expect(periods.get("p1")?.endsAt).toBe("2026-10-15T00:00:00.000Z")
    expect(periods.get("p2")?.endsAt).toBe("2026-10-20T00:00:00.000Z")
  })
})
