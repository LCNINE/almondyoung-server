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
import LocalizedClientLink from "@/components/shared/localized-client-link"
import { useTranslations } from "next-intl"
import { useRouter } from "next/navigation"
import { useId, useState, useTransition } from "react"
import { toast } from "sonner"
import { withdrawUserAction } from "../actions/profile"
import { Button } from "@/components/ui/button"

interface WithdrawFormProps {
  countryCode: string
  /** 이용 중인 멤버십이 있는지. 있으면 자동 해지 사실을 안내한다. */
  hasMembership?: boolean
  /** 정책상 환급받을 금액이 남아 있는지. 있을 때만 "먼저 해지" 를 권한다. */
  hasRefundableAmount?: boolean
}

export function WithdrawForm({
  countryCode,
  hasMembership = false,
  hasRefundableAmount = false,
}: WithdrawFormProps) {
  const t = useTranslations("mypage.account.withdraw")
  const router = useRouter()
  const checkboxId = useId()
  const [agreed, setAgreed] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [isPending, startTransition] = useTransition()

  const notices = [
    t("notice1"),
    t("notice2"),
    t("notice3"),
    t("notice4"),
    t("notice5"),
  ]

  const handleWithdraw = () => {
    setConfirmOpen(false)

    startTransition(async () => {
      try {
        const { redirectUrl } = await withdrawUserAction(countryCode)
        // IdP 세션까지 끊어야 하므로 end_session 으로 이동한다 (없으면 홈).
        window.location.replace(redirectUrl)
      } catch (error) {
        const err = error as Error & { digest?: string }
        // UNAUTHORIZED 는 error.tsx 의 토큰 복구로 넘긴다.
        if (err.digest === "UNAUTHORIZED" || err.message === "UNAUTHORIZED") {
          throw error
        }
        toast.error(err.message || t("error"))
      }
    })
  }

  return (
    <div className="mx-auto max-w-2xl space-y-8 py-2 md:py-4">
      <p className="text-sm text-gray-500">{t("description")}</p>

      {hasMembership && (
        <section className="rounded-md border border-primary/30 bg-primary/5 px-5 py-4">
          <h2 className="mb-2 text-sm font-semibold text-foreground">
            {t("membershipNoticeTitle")}
          </h2>
          <p className="text-sm leading-relaxed text-muted-foreground">
            {hasRefundableAmount
              ? t("membershipNoticeRefundable")
              : t("membershipNotice")}
          </p>
          {hasRefundableAmount && (
            <LocalizedClientLink
              href="/mypage/membership"
              className="mt-3 inline-flex text-sm font-medium text-primary underline underline-offset-4"
            >
              {t("membershipNoticeAction")}
            </LocalizedClientLink>
          )}
        </section>
      )}

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
