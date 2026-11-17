"use client"

import { CustomButton } from "@/components/shared/custom-buttons"
import { useAddToCart } from "@/hooks/api/use-add-to-cart"
import { showCartAddedToast } from "@/components/shared/cart-added-toast"
import { useTranslations } from "next-intl"

export default function OrderItemCartButton({
  variantId,
  title,
  thumbnail,
}: {
  variantId: string
  title: string
  thumbnail?: string | null
}) {
  const t = useTranslations("mypage.order.actions")
  const { addToCart, isLoading } = useAddToCart()

  const handleClick = async () => {
    const result = await addToCart({ variantId })
    if (result.success) {
      showCartAddedToast({ title, thumbnail })
    }
  }

  return (
    <CustomButton
      type="button"
      variant="outline"
      color="secondary"
      size="sm"
      isLoading={isLoading}
      onClick={handleClick}
      className="shrink-0"
    >
      {t("addToCart")}
    </CustomButton>
  )
}
