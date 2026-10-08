import { describe, expect, it } from "vitest"
import type { HttpTypes } from "@medusajs/types"
import type { TimeSale } from "@/lib/api/medusa/time-sale"
import { buildSaleProducts } from "./sale-products"

describe("buildSaleProducts", () => {
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
