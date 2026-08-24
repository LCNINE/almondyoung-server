"use client"

import { Button } from "@/components/ui/button"
import {
  FullScreenDialog,
  FullScreenDialogBody,
  FullScreenDialogContent,
  FullScreenDialogFooter,
  FullScreenDialogHeader,
  FullScreenDialogTitle,
} from "@/components/ui/full-screen-dialog"
import { useTranslations } from "next-intl"
import { useEffect, useState } from "react"
import type { ShippingMemo } from "../types"
import { findShippingMemoError } from "../utils"
import { ShippingMemoSelector } from "./shipping-memo-selector"

interface ShippingMemoDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  shippingMemo: ShippingMemo
  onSubmit: (memo: ShippingMemo) => void
}

/**
 * 배송 요청사항 편집 화면
 */
export function ShippingMemoDialog({
  open,
  onOpenChange,
  shippingMemo,
  onSubmit,
}: ShippingMemoDialogProps) {
  const t = useTranslations("checkout.shipping.memo")
  const [draft, setDraft] = useState<ShippingMemo>(shippingMemo)

  const [submitAttempt, setSubmitAttempt] = useState(0)

  useEffect(() => {
    if (open) {
      setDraft(shippingMemo)
      setSubmitAttempt(0)
    }
  }, [open, shippingMemo])

  const error = findShippingMemoError(draft)

  const handleSubmit = () => {
    if (error) {
      setSubmitAttempt((n) => n + 1)
      return
    }
    onSubmit(draft)
    onOpenChange(false)
  }

  return (
    <FullScreenDialog open={open} onOpenChange={onOpenChange}>
      <FullScreenDialogContent className="lg:inset-x-auto lg:top-1/2 lg:left-1/2 lg:h-auto lg:max-h-[80dvh] lg:w-[560px] lg:-translate-x-1/2 lg:-translate-y-1/2">
        <FullScreenDialogHeader closeLabel={t("closeAria")}>
          <FullScreenDialogTitle>{t("title")}</FullScreenDialogTitle>
        </FullScreenDialogHeader>

        <FullScreenDialogBody>
          <ShippingMemoSelector
            shippingMemo={draft}
            onShippingMemoChange={setDraft}
            error={submitAttempt > 0 ? error : null}
            errorAttempt={submitAttempt}
          />
        </FullScreenDialogBody>

        <FullScreenDialogFooter>
          <Button
            type="button"
            onClick={handleSubmit}
            className="h-12 w-full rounded bg-[#ff6600] text-[15px] font-bold text-white hover:bg-[#ff6600]/90"
          >
            {t("submit")}
          </Button>
        </FullScreenDialogFooter>
      </FullScreenDialogContent>
    </FullScreenDialog>
  )
}
