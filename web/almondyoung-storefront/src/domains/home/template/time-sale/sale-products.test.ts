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
