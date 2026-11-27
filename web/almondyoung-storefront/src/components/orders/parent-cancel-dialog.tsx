"use client"

import { useTranslations } from "next-intl"

import { CustomButton } from "@/components/shared/custom-buttons"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

interface ParentCancelDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  withheldAmount: number
  isCancelling: boolean
  onCancelTogether: () => void
  onCancelOnlyThis: () => void
}

/** 함께 배송 주문이 붙은 부모를 취소할 때: 같이 취소(전액 환불)할지, 이 주문만 취소(배송비 차감)할지 묻는다 */
export default function ParentCancelDialog({
  open,
  onOpenChange,
  withheldAmount,
  isCancelling,
  onCancelTogether,
  onCancelOnlyThis,
}: ParentCancelDialogProps) {
  const t = useTranslations("mypage.order.cancelParent")

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm rounded-3xl">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>
            {withheldAmount > 0 ? t("body") : t("bodyNoDeduction")}
          </DialogDescription>
        </DialogHeader>
        {withheldAmount > 0 && (
          <p className="text-foreground text-sm font-bold" data-testid="parent-cancel-deduction">
            {t("deduction", { amount: withheldAmount.toLocaleString() })}
          </p>
        )}
        <DialogFooter className="flex-col gap-2 sm:flex-col">
          <CustomButton
            variant="fill"
            color="primary"
            size="md"
            onClick={onCancelTogether}
            isLoading={isCancelling}
          >
            {t("together")}
          </CustomButton>
          <CustomButton
            variant="outline"
            color="secondary"
            size="md"
            onClick={onCancelOnlyThis}
            disabled={isCancelling}
          >
            {t("onlyThis")}
          </CustomButton>
          <CustomButton
            variant="ghost"
            color="secondary"
            size="md"
            onClick={() => onOpenChange(false)}
            disabled={isCancelling}
          >
            {t("close")}
          </CustomButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
