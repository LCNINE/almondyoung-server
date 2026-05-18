"use client"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Check, ShoppingCart } from "lucide-react"
import { useTranslations } from "next-intl"

interface CartSuccessModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onGoToCart: () => void
  onContinueShopping: () => void
}

/**
 * 장바구니 담기 성공 모달
 * - 장바구니로 이동 또는 쇼핑 계속하기 선택
 */
export function CartSuccessModal({
  open,
  onOpenChange,
  onGoToCart,
  onContinueShopping,
}: CartSuccessModalProps) {
  const t = useTranslations("cartSuccess")
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="z-80 max-w-[400px]">
        <AlertDialogHeader>
          <div className="bg-yellow-10 mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full">
            <Check className="text-yellow-30 h-6 w-6" />
          </div>
          <AlertDialogTitle className="text-center">
            {t("title")}
          </AlertDialogTitle>
          <AlertDialogDescription className="text-center">
            {t("description")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="flex-col gap-2 sm:flex-col">
          <AlertDialogAction
            onClick={onGoToCart}
            className="bg-yellow-30 hover:bg-yellow-40 w-full text-white"
          >
            <ShoppingCart className="mr-2 h-4 w-4" />
            {t("goToCart")}
          </AlertDialogAction>
          <AlertDialogCancel
            onClick={onContinueShopping}
            className="w-full"
          >
            {t("continueShopping")}
          </AlertDialogCancel>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
