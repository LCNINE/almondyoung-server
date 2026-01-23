import type { StoreProduct } from "@medusajs/types"
import type { ProductCard } from "@/lib/types/ui/product"
import { getProductPrice } from "@/lib/utils/get-product-price"

export const mapMedusaProductToCard = (product: StoreProduct): ProductCard => {
  const thumbnail = product.thumbnail || product.images?.[0]?.url || ""

  const priceInfo = getProductPrice({ product })
  const basePrice = priceInfo?.cheapestPrice?.original_price_number
  const membershipPrice = priceInfo?.cheapestPrice?.calculated_price_number

  return {
    id: product.id,
    name: product.title,
    thumbnail,
    basePrice,
    membershipPrice,
    status: product.status === "published" ? "active" : "inactive",
    optionMeta: {
      isSingle: (product.variants?.length ?? 0) <= 1,
    },
  }
}

export const mapMedusaProductsToCards = (
  products: StoreProduct[]
): ProductCard[] => products.map(mapMedusaProductToCard)
