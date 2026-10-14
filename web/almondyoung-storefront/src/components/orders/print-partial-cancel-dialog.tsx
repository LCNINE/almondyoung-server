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
import { useTranslations } from "next-intl"
import { useState } from "react"

// core 가 인쇄 상품이 제작 중일 때 고객 취소에 돌려주는 코드. 동의하면 excludePrint 로 다시 요청한다
export const PRINT_PARTIAL_CANCEL_AVAILABLE = "PRINT_PARTIAL_CANCEL_AVAILABLE"

export function usePrintPartialCancelDialog(onConfirm: () => void) {
  const tActions = useTranslations("mypage.order.actions")
  const [open, setOpen] = useState(false)

  const printPartialCancelDialog = (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogContent className="max-w-sm">
        <AlertDialogHeader>
          <AlertDialogTitle>{tActions("printPartialCancel.title")}</AlertDialogTitle>
          <AlertDialogDescription className="whitespace-pre-line">
            {tActions("printPartialCancel.description")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{tActions("printPartialCancel.keep")}</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              setOpen(false)
              onConfirm()
            }}
          >
            {tActions("printPartialCancel.confirm")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )

  return { askPrintPartialCancel: () => setOpen(true), printPartialCancelDialog }
}
