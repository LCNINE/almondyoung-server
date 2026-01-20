import { addToCart } from "@lib/api/medusa/cart"
import { useState } from "react"
import { toast } from "sonner"

interface AddToCartParams {
  variantId: string
  productVariantId?: string
  productId?: string
  productName?: string
  productImage?: string
  quantity?: number
}

export function useAddToCart() {
  const [isLoading, setIsLoading] = useState(false)

  const addToCartAction = async ({
    variantId,
    quantity = 1,
  }: AddToCartParams) => {
    try {
      setIsLoading(true)

      const result = await addToCart({
        variantId: variantId,
        countryCode: "kr",
        quantity,
      })

      toast.success("장바구니에 추가되었습니다.")
      return { success: true, data: result }
    } catch (error) {
      toast.error("장바구니 추가 중 오류가 발생했습니다.")
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      }
    } finally {
      setIsLoading(false)
    }
  }

  return {
    addToCart: addToCartAction,
    isLoading,
  }
}
