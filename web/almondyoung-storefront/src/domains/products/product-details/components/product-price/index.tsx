import { getProductPrice } from "@/lib/utils/get-product-price"
import { HttpTypes } from "@medusajs/types"

export default function ProductPrice({
  product,
  variant,
  quantity = 1,
}: {
  product: HttpTypes.StoreProduct
  variant?: HttpTypes.StoreProductVariant
  quantity?: number
}) {
  const { cheapestPrice, variantPrice } = getProductPrice({
    product,
    variantId: variant?.id,
  })

  const selectedPrice = variant ? variantPrice : cheapestPrice

  if (!selectedPrice) {
    return <div className="block h-9 w-32 animate-pulse bg-gray-100" />
  }

  const unitPrice = selectedPrice.calculated_price_number
  const subtotal = unitPrice * quantity

  const hasDiscount =
    selectedPrice.percentage_diff &&
    Number(selectedPrice.percentage_diff) > 0

  return (
    <div className="relative flex flex-col">
      {/* 원래 가격 (취소선) - 할인이 있을 때만 표시 */}
      {hasDiscount && (
        <span className="absolute -top-4 right-0 text-xs text-gray-400 line-through">
          {selectedPrice.original_price}
        </span>
      )}

      <div className="flex items-center gap-2">
        {hasDiscount && (
          <span className="text-sm font-semibold text-red-500">
            {selectedPrice.percentage_diff}%
          </span>
        )}

        <span className="text-base font-bold">
          {subtotal.toLocaleString()}원
        </span>
      </div>
    </div>
  )
}
