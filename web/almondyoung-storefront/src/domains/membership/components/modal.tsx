"use client"

import { useTranslations } from "next-intl"
import { useEffect, useMemo, useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@components/common/ui/dialog"
import { RadioGroup, RadioGroupItem } from "@components/common/ui/radio-group"
import { Button } from "@components/common/ui/button"
import { Input } from "@components/common/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@components/common/ui/select"
import { TOSS_BANKS } from "@lib/constants/toss-banks"
import type { CancellationReasonDto } from "@lib/types/dto/membership"

export interface RefundReceiveAccount {
  bank: string
  accountNumber: string
  holderName: string
}

export function MembershipCancelModal({
  open,
  setOpen,
  reasons,
  isSubmitting,
  refundEligible,
  onConfirm,
}: {
  open: boolean
  setOpen: (open: boolean) => void
  reasons: CancellationReasonDto[]
  isSubmitting?: boolean
  /** 이번 주기 혜택 미사용 → 결제액 전액 환불 대상. false 면 환불 없이 해지. */
  refundEligible: boolean
  onConfirm: (payload: {
    reasonCode: string
    reasonText?: string
    refundReceiveAccount?: RefundReceiveAccount
  }) => void
}) {
  const t = useTranslations("mypage.membership.cancel")
  const [selectedReason, setSelectedReason] = useState<string>("")
  const [reasonText, setReasonText] = useState<string>("")
  const [bankCode, setBankCode] = useState<string>("")
  const [accountNumber, setAccountNumber] = useState<string>("")
  const [holderName, setHolderName] = useState<string>("")

  useEffect(() => {
    if (!open) {
      setSelectedReason("")
      setReasonText("")
      setBankCode("")
      setAccountNumber("")
      setHolderName("")
    }
  }, [open])

  const showOtherInput = useMemo(() => {
    const selected = reasons.find((reason) => reason.code === selectedReason)
    if (!selected) return false
    return selected.code === "OTHER"
  }, [reasons, selectedReason])

  const resolvedReasons =
    reasons.length > 0
      ? [...reasons].sort((a, b) => a.sortOrder - b.sortOrder)
      : [
          {
            code: "OTHER",
            displayText: t("etcLabel"),
            category: "GENERAL",
            sortOrder: 999,
          },
        ]

  // 무통장 환불계좌: 셋 다 채워지면 전송, 일부만 채우면 미완성으로 간주(완료 차단)
  const account = {
    bank: bankCode,
    accountNumber: accountNumber.trim(),
    holderName: holderName.trim(),
  }
  const accountFilled =
    !!account.bank && !!account.accountNumber && !!account.holderName
  const accountPartiallyFilled =
    !accountFilled &&
    (!!account.bank || !!account.accountNumber || !!account.holderName)

  const confirmDisabled =
    !selectedReason || isSubmitting || (refundEligible && accountPartiallyFilled)

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="w-72 rounded-[5px] bg-white pt-6 text-center sm:w-md md:w-136 md:rounded-lg md:pt-8 lg:w-152">
        <DialogHeader>
          <DialogTitle className="text-center text-xs leading-4 font-normal text-black sm:text-sm sm:leading-5 md:text-base md:leading-6 lg:text-lg lg:leading-7">
            {refundEligible ? (
              <>
                {t("titleNoUsage")}
                <br />
                {t("titleRefund")}
                <br />
                {t("titleRejoin")}
              </>
            ) : (
              <>
                {t("titleUsedLine1")}
                <br />
                {t("titleUsedLine2")}
                <br />
                {t("titleRejoin")}
              </>
            )}
          </DialogTitle>
        </DialogHeader>

        {/* 설명 문구 */}
        <div className="mt-5">
          <p className="text-xs leading-4 font-semibold text-black sm:text-sm sm:leading-5 md:text-base md:leading-6">
            {t("reasonHeading")}
          </p>
          <p className="text-xs leading-4 font-medium text-gray-500 sm:text-sm sm:leading-5 md:text-base md:leading-6">
            {t("reasonSubheading")}
          </p>
        </div>

        {/* 취소 이유 라디오 리스트 */}
        <div className="flex justify-center">
          <RadioGroup
            value={selectedReason}
            onValueChange={setSelectedReason}
            className="items-start gap-2"
          >
            {resolvedReasons.map((reason) => (
              <div key={reason.code} className="flex items-center gap-2">
                <RadioGroupItem id={reason.code} value={reason.code} />
                <label
                  htmlFor={reason.code}
                  className="cursor-pointer font-['Pretendard'] text-xs leading-4 text-gray-800 select-none sm:text-sm sm:leading-5 md:text-base md:leading-6"
                >
                  {reason.displayText}
                </label>
              </div>
            ))}
          </RadioGroup>
        </div>

        {showOtherInput && (
          <div className="mt-3">
            <Input
              value={reasonText}
              onChange={(event) => setReasonText(event.target.value)}
              placeholder={t("etcPlaceholder")}
            />
          </div>
        )}

        {/* 무통장 환불계좌 입력 (환불 대상일 때만) — 카드 결제는 비워두면 자동 환불 */}
        {refundEligible && (
          <div className="mt-4 space-y-2 rounded-lg bg-gray-50 p-3 text-left">
            <p className="text-xs font-semibold text-black sm:text-sm">
              {t("refundAccountHeading")}
            </p>
            <p className="text-[11px] leading-4 text-gray-500 sm:text-xs">
              {t("refundAccountNote")}
            </p>
            <Select value={bankCode} onValueChange={setBankCode}>
              <SelectTrigger className="w-full bg-white">
                <SelectValue placeholder={t("bankPlaceholder")} />
              </SelectTrigger>
              <SelectContent>
                {TOSS_BANKS.map((bank) => (
                  <SelectItem key={bank.code} value={bank.code}>
                    {bank.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              className="bg-white"
              inputMode="numeric"
              value={accountNumber}
              onChange={(event) =>
                setAccountNumber(event.target.value.replace(/[^0-9]/g, ""))
              }
              placeholder={t("accountNumberPlaceholder")}
            />
            <Input
              className="bg-white"
              value={holderName}
              onChange={(event) => setHolderName(event.target.value)}
              placeholder={t("holderNamePlaceholder")}
            />
            {accountPartiallyFilled && (
              <p className="text-[11px] text-red-500">
                {t("refundAccountIncomplete")}
              </p>
            )}
          </div>
        )}

        <DialogFooter className="flex w-full sm:flex-col">
          <div className="flex w-full flex-col gap-2">
            <Button
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={isSubmitting}
            >
              {t("cancelButton")}
            </Button>
            <Button
              onClick={() => {
                if (!selectedReason) return
                onConfirm({
                  reasonCode: selectedReason,
                  reasonText: showOtherInput ? reasonText : undefined,
                  refundReceiveAccount:
                    refundEligible && accountFilled ? account : undefined,
                })
              }}
              disabled={confirmDisabled}
            >
              {isSubmitting ? t("processing") : t("confirmButton")}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
