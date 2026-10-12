import { describe, expect, it } from "vitest"
import type { HttpTypes } from "@medusajs/types"
import type { TimeSale } from "@/lib/api/medusa/time-sale"
import { buildSaleProducts } from "./sale-products"

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
    const sale = { products: [] } as unknown as TimeSale
    const build = () =>
      buildSaleProducts({
        sale,
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
      sale,
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
        sale: { products: [] } as unknown as TimeSale,
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
    const sale = { products: [] } as unknown as TimeSale

    const [card] = buildSaleProducts({
      sale,
      ids: ["prod_1"],
      products: [product],
      countryCode: "kr",
    })

    expect(card.image).toMatch(
      /^https?:\/\/.+\/files\/public\/01a047c4-b9d8-76cf-8294-1b10eecc9823$/
    )
  })
})
