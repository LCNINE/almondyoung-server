"use server"

import type { SaleProduct } from "@packages/time-sale-ui"
import { getTimeSalePresentation } from "@/lib/api/medusa/time-sale"
import { getRegion } from "@/lib/api/medusa/regions"
import { detailProductLimit } from "@/lib/utils/time-sale-pagination"
import { buildSaleProducts } from "@/domains/home/template/time-sale/sale-products"
import { fetchProductsByIds } from "@/domains/home/template/time-sale/fetch-products"

// 상품상세의 타임세일 블록에 넣을 "같은 세일의 다른 상품". 현재 상품은 빼고 화면 한 장 x 3 까지.
// 가격은 /store/products 로 다시 받아 만든다(멤버십 은닉·가격 비공개 규칙이 거기서 적용된다).
export async function listSaleSiblingProducts({
  saleId,
  excludeProductId,
  countryCode,
}: {
  saleId: string
  excludeProductId: string
  countryCode: string
}): Promise<SaleProduct[]> {
  const { timeSales, settings } = await getTimeSalePresentation()
  const sale = timeSales.find((item) => item.saleId === saleId)
  if (!sale) return []

  const ids = sale.productIds
    .filter((id) => id !== excludeProductId)
    .slice(0, detailProductLimit(settings))
  if (ids.length === 0) return []

  const region = await getRegion(countryCode)
  const products = await fetchProductsByIds(ids, region?.id)

  return buildSaleProducts({ sale, ids, products, countryCode })
}
