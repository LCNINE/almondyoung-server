import { addToCart, createBuyNowCart } from "@lib/api/medusa/cart"
import { isInsufficientInventoryError } from "@lib/utils/cart-availability"
import { useTranslations } from "next-intl"
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
  const t = useTranslations("productDetail.options")

  // 백엔드 원문 에러(영문 Medusa 메시지: 재고부족, sales channel-재고위치 미연결 등)를
  // 그대로 노출하지 않는다. 재고부족은 품절 안내로, 그 외는 일반 실패 문구로 치환.
  // 단, 디버깅용으로 원문은 콘솔에 남긴다.
  const toCartError = (message: string) => {
    if (isInsufficientInventoryError(message)) return t("soldOutToast")
    console.error("[useAddToCart] 장바구니 담기 실패:", message)
    return t("addCartFail")
  }

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
        toast.error(toCartError(result.error))
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
        toast.error(toCartError(result.error))
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
