"use client"

import { CustomButton } from "@/components/shared/custom-buttons/custom-button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { useTranslations } from "next-intl"
import type { ReactNode } from "react"
import { toast } from "sonner"

export function PickupTrackingButton() {
  const t = useTranslations("mypage.order.returnDetail")

  function trackPickup() {
    // 한진 연동이 완료되면 반송장 조회를 열어요.
    // todo: 한진 연동이 완료되면 실제 반송장 조회 로직을 구현해야 함.
    toast.info(t("pickup.comingSoon"))
  }

  return (
    <CustomButton
      type="button"
      variant="outline"
      color="primary"
      size="sm"
      className="border-primary text-primary hover:border-primary hover:text-primary active:border-primary active:text-primary text-xs font-normal hover:bg-transparent active:bg-transparent"
      rounded="sm"
      onClick={trackPickup}
    >
      {t("pickup.track")}
    </CustomButton>
  )
}

export function CancellationReceiptDialog({
  children,
}: {
  children: ReactNode
}) {
  const t = useTranslations("mypage.order.returnDetail")

  return (
    <Dialog>
      <DialogTrigger asChild>
        <button
          type="button"
          className="border-border text-foreground rounded-sm border bg-white px-2 py-1 text-xs hover:bg-gray-50 md:text-sm"
        >
          {t("receipt.open")}
        </button>
      </DialogTrigger>
      <DialogContent
        showCloseButton={false}
        aria-describedby={undefined}
        className="max-h-[85dvh] overflow-y-auto"
      >
        <DialogHeader>
          <DialogTitle>{t("receipt.title")}</DialogTitle>
        </DialogHeader>
        {children}
        <DialogFooter>
          <DialogClose asChild>
            <CustomButton
              type="button"
              className="bg-primary text-primary-foreground hover:bg-primary/90 active:bg-primary/80"
            >
              {t("receipt.close")}
            </CustomButton>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
