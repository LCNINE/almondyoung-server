"use client"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { useTranslations } from "next-intl"
import { useState } from "react"

export function useCancelFailureAlert() {
  const tActions = useTranslations("mypage.order.actions")
  const [message, setMessage] = useState<string | null>(null)

  const cancelFailureAlert = (
    <AlertDialog open={message !== null}>
      <AlertDialogContent
        className="max-w-sm"
        onEscapeKeyDown={(event) => event.preventDefault()}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>{tActions("cancelDialogTitle")}</AlertDialogTitle>
          <AlertDialogDescription className="whitespace-pre-line">
            {message}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogAction onClick={() => setMessage(null)}>
            {tActions("cancelFailedConfirm")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )

  return { showCancelFailure: setMessage, cancelFailureAlert }
}
