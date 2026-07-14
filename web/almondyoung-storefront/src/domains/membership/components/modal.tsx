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
import { cn } from "@lib/utils"
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
  // 환불 대상일 때만 2스텝(1=사유, 2=환불계좌+확인). 아니면 1스텝(사유→해지).
  const [step, setStep] = useState<1 | 2>(1)
  const [selectedReason, setSelectedReason] = useState<string>("")
  const [reasonText, setReasonText] = useState<string>("")
  const [bankCode, setBankCode] = useState<string>("")
  const [accountNumber, setAccountNumber] = useState<string>("")
  const [holderName, setHolderName] = useState<string>("")

  useEffect(() => {
    if (!open) {
      setStep(1)
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

  // 스텝1(사유)은 사유만 있으면 진행. 스텝2 최종 완료는 무통장 환불계좌 입력 필수.
  const stepOneDisabled = !selectedReason || isSubmitting
  const finalDisabled = stepOneDisabled || (refundEligible && !accountFilled)

  const submit = () => {
    if (!selectedReason) return
    onConfirm({
      reasonCode: selectedReason,
      reasonText: showOtherInput ? reasonText : undefined,
      refundReceiveAccount:
        refundEligible && accountFilled ? account : undefined,
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-h-[90vh] gap-4 overflow-y-auto rounded-3xl pt-6 sm:max-w-md">
        {/* 스텝 인디케이터 (환불 대상 = 2스텝) — 클릭으로 스텝 이동. 2로 가려면 사유 선택 필요 */}
        {refundEligible && (
          <div className="flex justify-center gap-1.5">
            <button
              type="button"
              aria-label={t("stepReasonLabel")}
              aria-current={step === 1 ? "step" : undefined}
              onClick={() => setStep(1)}
              className={cn(
                "h-1.5 w-6 cursor-pointer rounded-full transition-colors",
                step === 1 ? "bg-primary" : "bg-border hover:bg-muted-foreground/40"
              )}
            />
            <button
              type="button"
              aria-label={t("stepRefundLabel")}
              aria-current={step === 2 ? "step" : undefined}
              disabled={!selectedReason}
              onClick={() => selectedReason && setStep(2)}
              className={cn(
                "h-1.5 w-6 rounded-full transition-colors",
                step === 2 ? "bg-primary" : "bg-border",
                selectedReason
                  ? "cursor-pointer hover:bg-muted-foreground/40"
                  : "cursor-not-allowed opacity-60"
              )}
            />
          </div>
        )}

        {step === 1 ? (
          <>
            <DialogHeader>
              <DialogTitle className="text-foreground text-center text-base leading-6 font-medium sm:text-lg sm:leading-7">
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

            {/* 사유 안내 */}
            <div className="text-center">
              <p className="text-foreground text-base leading-6 font-bold">
                {t("reasonHeading")}
              </p>
              <p className="text-muted-foreground mt-1 text-sm leading-5">
                {t("reasonSubheading")}
              </p>
            </div>

            {/* 취소 이유  */}
            <RadioGroup
              value={selectedReason}
              onValueChange={setSelectedReason}
              className="w-full gap-1"
            >
              {resolvedReasons.map((reason) => {
                const active = selectedReason === reason.code
                return (
                  <label
                    key={reason.code}
                    htmlFor={reason.code}
                    className={cn(
                      "flex cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2.5 transition-colors",
                      active ? "bg-[#fff2ec]" : "hover:bg-muted"
                    )}
                  >
                    <RadioGroupItem
                      id={reason.code}
                      value={reason.code}
                      className="border-border data-[state=checked]:border-primary shadow-none"
                    />
                    <span
                      className={cn(
                        "text-sm leading-5 select-none",
                        active
                          ? "text-foreground font-medium"
                          : "text-muted-foreground"
                      )}
                    >
                      {reason.displayText}
                    </span>
                  </label>
                )
              })}
            </RadioGroup>

            {showOtherInput && (
              <Input
                value={reasonText}
                onChange={(event) => setReasonText(event.target.value)}
                placeholder={t("etcPlaceholder")}
                className="border-border h-11 rounded-lg border text-sm placeholder:text-sm"
              />
            )}

            <DialogFooter className="flex w-full sm:flex-col">
              <div className="flex w-full flex-col gap-2">
                <Button
                  onClick={() => (refundEligible ? setStep(2) : submit())}
                  disabled={stepOneDisabled}
                  className="h-[52px] rounded-xl text-base font-bold"
                >
                  {isSubmitting
                    ? t("processing")
                    : refundEligible
                      ? t("next")
                      : t("confirmButton")}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setOpen(false)}
                  disabled={isSubmitting}
                  className="h-11 rounded-xl"
                >
                  {t("cancelButton")}
                </Button>
              </div>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="text-foreground text-center text-base leading-6 font-bold sm:text-lg sm:leading-7">
                {t("refundStepTitle")}
              </DialogTitle>
            </DialogHeader>

            {/* 무통장 환불계좌 */}
            <div className="bg-muted space-y-2.5 rounded-2xl p-4 text-left">
              <p className="text-foreground text-sm font-semibold">
                {t("refundAccountHeading")}
              </p>
              <p className="text-muted-foreground text-xs leading-4">
                {t("refundAccountNote")}
              </p>
              <Select value={bankCode} onValueChange={setBankCode}>
                <SelectTrigger className="bg-background border-border h-11 w-full rounded-lg">
                  <SelectValue placeholder={t("bankPlaceholder")} />
                </SelectTrigger>
                <SelectContent className="max-h-60">
                  {TOSS_BANKS.map((bank) => (
                    <SelectItem key={bank.code} value={bank.code}>
                      {bank.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                className="bg-background border-border h-11 rounded-lg border text-sm placeholder:text-sm"
                inputMode="numeric"
                value={accountNumber}
                onChange={(event) =>
                  setAccountNumber(event.target.value.replace(/[^0-9]/g, ""))
                }
                placeholder={t("accountNumberPlaceholder")}
              />
              <Input
                className="bg-background border-border h-11 rounded-lg border text-sm placeholder:text-sm"
                value={holderName}
                onChange={(event) => setHolderName(event.target.value)}
                placeholder={t("holderNamePlaceholder")}
              />
              {accountPartiallyFilled && (
                <p className="text-destructive text-xs">
                  {t("refundAccountIncomplete")}
                </p>
              )}
            </div>

            <DialogFooter className="flex w-full sm:flex-col">
              <div className="flex w-full flex-col gap-2">
                <Button
                  onClick={submit}
                  disabled={finalDisabled}
                  className="h-[52px] rounded-xl text-base font-bold"
                >
                  {isSubmitting ? t("processing") : t("confirmButton")}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setStep(1)}
                  disabled={isSubmitting}
                  className="h-11 rounded-xl"
                >
                  {t("back")}
                </Button>
              </div>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
