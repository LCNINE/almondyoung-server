import { HttpTypes } from "@medusajs/types"
// vitest 에 `@/` alias 가 없어 상대경로로 둔다 (stock-status.test.ts 가 이 파일을 로드한다)
import {
  getAvailableQuantity,
  isVariantSoldOut as isSoldOut,
} from "../../../../../lib/utils/cart-availability"

export const LOW_STOCK_THRESHOLD = 5

export type StockStatus =
  | { kind: "untracked" }
  | { kind: "soldOut" }
  | { kind: "partialSoldOut"; total: number }
  | { kind: "lowStock"; total: number }
  | { kind: "inStock" }

export const isVariantSoldOut = (variant: HttpTypes.StoreProductVariant) =>
  isSoldOut(variant)

// 추적 가능한 재고를 반환. 재고관리 안 함 / 백오더 허용은 null.
export const getVariantStock = (variant: HttpTypes.StoreProductVariant) =>
  getAvailableQuantity(variant)

export const getVariantLabel = (variant: HttpTypes.StoreProductVariant) =>
  variant.options?.map((o) => o.value).join(" / ") ||
  variant.title ||
  "기본 옵션"

export const calculateStockStatus = (
  product: HttpTypes.StoreProduct
): StockStatus => {
  const variants = product.variants ?? []
  if (variants.length === 0) return { kind: "untracked" }

  const stocks = variants.map(getVariantStock)
  const trackedStocks = stocks.filter((s): s is number => s !== null)

  if (trackedStocks.length === 0) return { kind: "untracked" }

  const soldOutCount = variants.filter(isVariantSoldOut).length
  const total = trackedStocks.reduce((sum, qty) => sum + qty, 0)

  if (soldOutCount === variants.length) return { kind: "soldOut" }
  if (soldOutCount > 0) return { kind: "partialSoldOut", total }
  if (total <= LOW_STOCK_THRESHOLD) return { kind: "lowStock", total }

  return { kind: "inStock" }
}

// 목록에서 품절 카드를 빼고 뒤 상품을 당겨 올린다. 호출부는 limit 보다 넉넉히 받아
// 필터 뒤에 slice 해야 칸이 비지 않는다.
export const filterSoldOut = (products: HttpTypes.StoreProduct[]) =>
  products.filter((p) => calculateStockStatus(p).kind !== "soldOut")
