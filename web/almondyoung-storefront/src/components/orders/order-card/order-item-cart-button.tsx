"use client"

import { CustomButton } from "@/components/shared/custom-buttons"
import { useAddToCart } from "@/hooks/api/use-add-to-cart"
import { useTranslations } from "next-intl"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

export default function OrderItemCartButton({
  variantId,
}: {
  variantId: string
}) {
  const t = useTranslations("mypage.order.actions")
  const router = useRouter()
  const { addToCart, isLoading } = useAddToCart()

  const handleClick = async () => {
    const result = await addToCart({ variantId })
    if (result.success) {
      toast.success(t("addToCartSuccess"), {
        action: { label: t("goToCart"), onClick: () => router.push("/cart") },
      })
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
