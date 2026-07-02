"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { TOSS_BANKS } from "@/lib/constants/toss-banks"
import { requestRefundAction } from "../refund-request-action"

interface RefundRequestDialogProps {
  intentId: string
  className?: string
}

export function RefundRequestDialog({ intentId, className }: RefundRequestDialogProps) {
  const t = useTranslations("mypage.order.refundRequest")
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [bankCode, setBankCode] = useState("")
  const [accountNumber, setAccountNumber] = useState("")
  const [holderName, setHolderName] = useState("")
  const [reason, setReason] = useState("")
  const [isPending, startTransition] = useTransition()

  const ready = !!bankCode && !!accountNumber && !!holderName

  const reset = () => {
    setBankCode("")
    setAccountNumber("")
    setHolderName("")
    setReason("")
  }

  const submit = () => {
    if (!ready) return
    startTransition(async () => {
      try {
        await requestRefundAction({
          intentId,
          bankCode,
          bankName: TOSS_BANKS.find((b) => b.code === bankCode)?.name,
          accountNumber: accountNumber.replace(/[^0-9]/g, ""),
          holderName: holderName.trim(),
          reason: reason || undefined,
        })
        toast.success(t("success"))
        setOpen(false)
        reset()
        router.refresh()
      } catch (error: unknown) {
        const err = error as Error & { digest?: string }
        if (err.digest === "UNAUTHORIZED" || err.message === "UNAUTHORIZED") throw error
        toast.error(t("error"))
      }
    })
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (!o) reset()
      }}
    >
      <DialogTrigger asChild>
        <button
          type="button"
          className={
            className ??
            "inline-flex cursor-pointer items-center justify-center rounded-[5px] px-4 py-3 text-sm text-red-600 outline-1 outline-red-300"
          }
        >
          {t("trigger")}
        </button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label>{t("bank")}</Label>
            <select
              className="h-11 w-full cursor-pointer rounded-md border border-neutral-300 bg-transparent px-3 text-sm"
              value={bankCode}
              onChange={(e) => setBankCode(e.target.value)}
            >
              <option value="">{t("bankPlaceholder")}</option>
              {TOSS_BANKS.map((b) => (
                <option key={b.code} value={b.code}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label>{t("accountNumber")}</Label>
            <Input
              className="h-11 rounded-md border border-neutral-300 bg-transparent text-sm"
              value={accountNumber}
              inputMode="numeric"
              placeholder={t("accountNumberPlaceholder")}
              onChange={(e) => setAccountNumber(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label>{t("holderName")}</Label>
            <Input
              className="h-11 rounded-md border border-neutral-300 bg-transparent text-sm"
              value={holderName}
              placeholder={t("holderNamePlaceholder")}
              onChange={(e) => setHolderName(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label>{t("reason")}</Label>
            <Textarea
              value={reason}
              maxLength={500}
              placeholder={t("reasonPlaceholder")}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            {t("cancel")}
          </Button>
          <Button onClick={submit} disabled={!ready || isPending}>
            {isPending ? t("submitting") : t("submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
