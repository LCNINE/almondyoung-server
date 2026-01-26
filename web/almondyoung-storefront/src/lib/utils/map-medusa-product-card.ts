import type { StoreProduct } from "@medusajs/types"
import type { ProductCard } from "@/lib/types/ui/product"
import { getPricesForVariant, getProductPrice } from "@/lib/utils/get-product-price"
import { getTimeSaleInfo } from "@/lib/utils/time-sale"

export const mapMedusaProductToCard = (product: StoreProduct): ProductCard => {
  const thumbnail = product.thumbnail || product.images?.[0]?.url || ""

  const defaultVariant =
    (product.variants as any[])?.find(
      (variant) => variant?.is_default || variant?.isDefault
    ) ?? (product.variants as any[])?.[0]
  const defaultPrice = defaultVariant ? getPricesForVariant(defaultVariant) : null
  const priceInfo = getProductPrice({ product })
  const basePrice =
    defaultPrice?.original_price_number ||
    priceInfo?.cheapestPrice?.original_price_number
  const membershipPrice =
    defaultPrice?.calculated_price_number ||
    priceInfo?.cheapestPrice?.calculated_price_number
  const timeSaleInfo = getTimeSaleInfo(product)

  return {
    id: product.id,
    name: product.title,
    thumbnail,
    basePrice,
    membershipPrice,
    status: product.status === "published" ? "active" : "inactive",
    isTimeSale: timeSaleInfo.isActive,
    timeSaleEndTime: timeSaleInfo.endTime,
    optionMeta: {
      isSingle: (product.variants?.length ?? 0) <= 1,
    },
  }
}

export const mapMedusaProductsToCards = (
  products: StoreProduct[]
): ProductCard[] => products.map(mapMedusaProductToCard)
