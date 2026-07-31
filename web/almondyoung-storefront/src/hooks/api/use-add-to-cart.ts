import { addToCart, createBuyNowCart } from "@lib/api/medusa/cart"
import {
  describeStockShortage,
  isInsufficientInventoryError,
} from "@lib/utils/cart-availability"
import { useTranslations } from "next-intl"
import { useState } from "react"
import { toast } from "sonner"

interface AddToCartParams {
  variantId: string
  /** 남은 재고를 아는 호출부만 넘긴다. 넘기면 "N개 이하로 담아주세요" 로 구체적으로 안내한다. */
  availableQuantity?: number | null
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
  // 그대로 노출하지 않는다. 재고부족은 남은 수량 안내로, 그 외는 일반 실패 문구로 치환.
  // (예전에는 "품절" 이라고 안내했는데, 재고가 남아있는데 요청 수량만 초과한 경우에도 품절로
  //  보여 고객이 혼란스러웠다.)
  // 단, 웰컴 멤버십 구매 제한/멤버십 전용 상품 등 백엔드가 한글로 던진 메시지는
  // 사용자용으로 작성된 것이므로 그대로 노출한다. 디버깅용으로 원문은 콘솔에 남긴다.
  const toCartError = (
    message: string,
    stock?: { available?: number | null; quantity?: number }
  ) => {
    if (isInsufficientInventoryError(message)) {
      switch (describeStockShortage(stock ?? {})) {
        case "sold-out":
          return t("soldOutToast")
        case "exceeds-stock":
          return t("stockLimitToast", { max: stock!.available! })
        case "cart-sum":
          return t("stockConflictToast")
        default:
          return t("stockShortToast")
      }
    }
    console.error("[useAddToCart] 장바구니 담기 실패:", message)
    if (/[가-힣]/.test(message)) return message
    return t("addCartFail")
  }

  const addToCartAction = async ({
    variantId,
    quantity = 1,
    availableQuantity,
  }: AddToCartParams) => {
    try {
      setIsLoading(true)

      const result = await addToCart({
        variantId: variantId,
        countryCode: "kr",
        quantity,
      })

      if (result.error) {
        toast.error(toCartError(result.error, { available: availableQuantity, quantity }))
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
