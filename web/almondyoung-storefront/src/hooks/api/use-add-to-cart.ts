import { useState } from "react"
import { addToCart } from "@lib/data/cart"
import { toast } from "sonner"

interface AddToCartParams {
  variantId: string
  productVariantId?: string // 추가
  productId?: string // 추가
  productName?: string // 추가
  productImage?: string // 추가
  quantity?: number
}

export function useAddToCart() {
  const [isLoading, setIsLoading] = useState(false)

  const addToCartAction = async ({ variantId, quantity = 1 }: AddToCartParams) => {
    try {
      setIsLoading(true)
      
      const result = await addToCart({
        variantId: variantId,
        countryCode: 'kr',
        quantity,
      })

      if (result !== undefined) {
        toast.success("장바구니에 추가되었습니다.")
        return { success: true, data: result }
      } else {
        toast.error("장바구니 추가에 실패했습니다.")
        return { success: false, error: "Failed to add to cart" }
      }
    } catch (error) {
      console.error("Add to cart error:", error)
      toast.error("장바구니 추가 중 오류가 발생했습니다.")
      return { success: false, error: error instanceof Error ? error.message : "Unknown error" }
    } finally {
      setIsLoading(false)
    }
  }

  return {
    addToCart: addToCartAction,
    isLoading,
  }
}
