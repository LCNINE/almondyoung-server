import { addToCart, createBuyNowCart } from "@lib/api/medusa/cart"
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

interface CreateBuyNowCartParams {
  items: Array<{
    variantId: string
    quantity: number
  }>
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

      if (result.error) {
        toast.error(result.error)
        return { success: false, error: result.error }
      }

      return { success: true, data: result }
    } catch (error) {
      toast.error("장바구니 추가 중 오류가 발생했습니다")
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      }
    } finally {
      setIsLoading(false)
    }
  }

  const createBuyNowCartAction = async ({ items }: CreateBuyNowCartParams) => {
    try {
      setIsLoading(true)

      const result = await createBuyNowCart({
        countryCode: "kr",
        items,
      })

      if (result.error) {
        toast.error(result.error)
        return { success: false, error: result.error }
      }

      return { success: true, data: result }
    } catch (error) {
      toast.error("바로구매 처리 중 오류가 발생했습니다")
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
    createBuyNowCart: createBuyNowCartAction,
    isLoading,
  }
}
