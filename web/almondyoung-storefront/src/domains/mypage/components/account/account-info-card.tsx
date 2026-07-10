"use client"

import LocalizedClientLink from "@/components/shared/localized-client-link"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { cn } from "@/lib/utils"
import {
  AlertCircle,
  Check,
  ChevronRight,
  Lock,
  Mail,
  MailCheck,
  Smartphone,
} from "lucide-react"
import { useTranslations } from "next-intl"
import Image from "next/image"
import {
  formatPhoneNumber,
  getCleanKoreanNumber,
} from "@/lib/utils/format-phone-number"
import { useState, useTransition } from "react"
import { toast } from "sonner"
import { resendVerificationEmailAction } from "../actions/profile"
import { PhoneChangeDialog } from "./phone-change-dialog"

interface AccountInfoCardProps {
  email: string
  isEmailVerified: boolean
  phoneNumber: string | null
}

export function AccountInfoCard({
  email,
  isEmailVerified,
  phoneNumber,
}: AccountInfoCardProps) {
  const t = useTranslations("mypage.account.accountInfo")
  const [dialogOpen, setDialogOpen] = useState(false)
  const [phoneDialogOpen, setPhoneDialogOpen] = useState(false)

  const rowClass =
    "group flex w-full cursor-pointer items-center gap-5 px-3 py-5 text-left transition-colors hover:bg-gray-50"

  return (
    <>
      <Card>
        <CardContent className="px-4 py-2 md:px-6">
          <div className="divide-y divide-gray-100">
            {/* 비밀번호 */}
            <LocalizedClientLink
              href="/mypage/account/password"
              className={rowClass}
            >
              <Lock className="text-gray-500 size-6 shrink-0" />
              <span className="flex-1 text-base font-semibold md:text-lg">
                {t("password")}
              </span>
              <ChevronRight className="text-gray-400 size-5" />
            </LocalizedClientLink>

            {/* 이메일 */}
            <button
              type="button"
              onClick={() => setDialogOpen(true)}
              className={rowClass}
            >
              <Mail className="text-gray-500 size-6 shrink-0" />
              <span className="flex-1 space-y-1">
                <span className="block text-base font-semibold md:text-lg">
                  {t("email")}
                </span>
                <span className="block text-sm text-gray-600 md:text-base">
                  {email}
                </span>
                <span
                  className={cn(
                    "flex items-center gap-1 text-sm",
                    isEmailVerified ? "text-gray-500" : "text-red-500"
                  )}
                >
                  {isEmailVerified ? (
                    <>
                      <Check className="size-4" />
                      {t("verified")}
                    </>
                  ) : (
                    <>
                      <AlertCircle className="size-4" />
                      {t("verifyNeeded")}
                    </>
                  )}
                </span>
              </span>
              <ChevronRight className="text-gray-400 size-5" />
            </button>

            {/* 휴대폰 — 본인확인(SMS) → 번호 변경 다이얼로그 */}
            <button
              type="button"
              onClick={() => setPhoneDialogOpen(true)}
              className={rowClass}
            >
              <Smartphone className="text-gray-500 size-6 shrink-0" />
              <span className="flex-1 space-y-1">
                <span className="block text-base font-semibold md:text-lg">
                  {t("phone")}
                </span>
                {phoneNumber && (
                  <span className="block text-sm text-gray-600 md:text-base">
                    {formatPhoneNumber(getCleanKoreanNumber(phoneNumber))}
                  </span>
                )}
              </span>
              <ChevronRight className="text-gray-400 size-5" />
            </button>
          </div>
        </CardContent>
      </Card>

      <EmailVerifyDialog
        email={email}
        isEmailVerified={isEmailVerified}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
      />
      <PhoneChangeDialog
        phoneNumber={phoneNumber}
        open={phoneDialogOpen}
        onOpenChange={setPhoneDialogOpen}
      />
    </>
  )
}

function EmailVerifyDialog({
  email,
  isEmailVerified,
  open,
  onOpenChange,
  initialStep = "confirm",
}: {
  email: string
  isEmailVerified: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
  initialStep?: "confirm" | "sent"
}) {
  const t = useTranslations("mypage.account.accountInfo.verifyDialog")
  const tInfo = useTranslations("mypage.account.accountInfo")
  const [step, setStep] = useState<"confirm" | "sent">(initialStep)
  const [isPending, startTransition] = useTransition()

  const handleOpenChange = (next: boolean) => {
    if (isPending) return
    onOpenChange(next)
    if (!next) setStep(initialStep)
  }

  const handleSendLink = () => {
    startTransition(async () => {
      const result = await resendVerificationEmailAction(email)
      if (result.success) {
        setStep("sent")
      } else {
        toast.error(result.error || t("sendFailed"))
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        {isEmailVerified ? (
          // 이미 인증된 경우: 상태만 안내
          <DialogHeader className="items-center gap-3 pt-4 text-center sm:text-center">
            <div className="grid rounded-full size-14 place-items-center bg-green-50">
              <MailCheck className="text-green-600 size-7" />
            </div>
            <DialogTitle>{tInfo("verified")}</DialogTitle>
            <DialogDescription className="break-all">{email}</DialogDescription>
          </DialogHeader>
        ) : step === "confirm" ? (
          <>
            <DialogHeader className="items-center gap-3 pt-4 text-center sm:text-center">
              <Image
                src="/images/verify/shield.png"
                alt=""
                width={160}
                height={160}
                className="object-contain size-32 md:size-40"
              />
              <DialogTitle className="text-xl">{t("title")}</DialogTitle>
              <DialogDescription className="leading-relaxed break-keep">
                {t("description", { email })}
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-2 mt-2">
              <Button
                type="button"
                className="w-full h-11"
                disabled={isPending}
                onClick={handleSendLink}
              >
                {isPending ? t("sendLink") + "..." : t("sendLink")}
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="w-full h-11"
                disabled={isPending}
                onClick={() => handleOpenChange(false)}
              >
                {t("cancel")}
              </Button>
            </div>
          </>
        ) : (
          <>
            <DialogHeader className="items-center gap-3 pt-4 text-center sm:text-center">
              <Image
                src="/images/verify/email-img.png"
                alt=""
                width={160}
                height={160}
                className="object-contain size-32 md:size-40"
              />
              <DialogTitle className="text-xl">{t("sentTitle")}</DialogTitle>
              <DialogDescription className="leading-relaxed break-keep">
                {t("sentDescription", { email })}
              </DialogDescription>
            </DialogHeader>
            <div className="mt-2">
              <Button
                type="button"
                className="w-full h-11"
                onClick={() => handleOpenChange(false)}
              >
                {t("done")}
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
