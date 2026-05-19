"use client"

import { CustomButton } from "@/components/shared/custom-buttons"
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
import { Checkbox } from "@/components/ui/checkbox"
import { toLocalizedPath } from "@lib/utils/locale-path"
import { useTranslations } from "next-intl"
import { useRouter } from "next/navigation"
import { useId, useState, useTransition } from "react"
import { toast } from "sonner"
import { withdrawUserAction } from "../actions/profile"
import { Button } from "@/components/ui/button"

interface WithdrawFormProps {
  countryCode: string
}

export function WithdrawForm({ countryCode }: WithdrawFormProps) {
  const t = useTranslations("mypage.account.withdraw")
  const router = useRouter()
  const checkboxId = useId()
  const [agreed, setAgreed] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [isPending, startTransition] = useTransition()

  const notices = [t("notice1"), t("notice2"), t("notice3"), t("notice4")]

  const handleWithdraw = () => {
    setConfirmOpen(false)

    startTransition(async () => {
      try {
        await withdrawUserAction()
        window.location.replace(toLocalizedPath(countryCode, "/"))
      } catch (error) {
        const message =
          error instanceof Error && error.message ? error.message : t("error")
        toast.error(message)
      }
    })
  }

  return (
    <div className="mx-auto max-w-2xl space-y-8 py-2 md:py-4">
      <p className="text-sm text-gray-500">{t("description")}</p>

      <section className="rounded-md bg-gray-50 px-5 py-4">
        <h2 className="mb-3 text-sm font-semibold text-gray-900">
          {t("noticeTitle")}
        </h2>
        <ul className="space-y-2 text-sm leading-relaxed text-gray-600">
          {notices.map((notice, index) => (
            <li key={index} className="flex gap-2">
              <span aria-hidden className="mt-[1px] text-gray-300">
                •
              </span>
              <span>{notice}</span>
            </li>
          ))}
        </ul>
      </section>

      <div className="space-y-5 border-t border-gray-100 pt-6">
        <label
          htmlFor={checkboxId}
          className="flex cursor-pointer items-start gap-2"
        >
          <Checkbox
            id={checkboxId}
            checked={agreed}
            onCheckedChange={(checked) => setAgreed(checked === true)}
            className="mt-0.5"
          />
          <span className="text-sm leading-relaxed text-gray-800">
            {t("agreement")}
          </span>
        </label>

        <div className="flex flex-col gap-2">
          <Button
            type="button"
            // variant="outline"
            // color="secondary"
            onClick={() => setConfirmOpen(true)}
            disabled={!agreed || isPending}
            size="lg"
          >
            {isPending ? t("submitting") : t("submit")}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => router.back()}
            disabled={isPending}
            size="lg"
          >
            {t("cancel")}
          </Button>
        </div>
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("confirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("confirmDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>
              {t("cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleWithdraw}
              disabled={isPending}
              className="bg-gray-900 text-white hover:bg-gray-800"
            >
              {t("confirmAction")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
