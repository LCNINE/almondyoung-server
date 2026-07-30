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
import { DATE_FORMATS, formatDate } from "@/lib/utils/format-date"
import type {
  CancellationMode,
  CancellationPreviewDto,
  CancellationReasonDto,
} from "@lib/types/dto/membership"

export interface RefundReceiveAccount {
  bank: string
  accountNumber: string
  holderName: string
}

type Step = "mode" | "reason" | "account"

/**
 * 멤버십 해지 모달
 *
 * 해지 방식(해지예약/즉시해지+환불)은 **고객이 고른다**. 선택지와 환불 금액은 서버 미리보기
 * (`/subscriptions/cancel-preview`)가 정하므로 화면 금액과 실제 환불액이 어긋나지 않는다.
 */
export function MembershipCancelModal({
  open,
  setOpen,
  reasons,
  isSubmitting,
  preview,
  onConfirm,
}: {
  open: boolean
  setOpen: (open: boolean) => void
  reasons: CancellationReasonDto[]
  isSubmitting?: boolean
  preview: CancellationPreviewDto | null
  onConfirm: (payload: {
    reasonCode: string
    reasonText?: string
    refundReceiveAccount?: RefundReceiveAccount
    cancelType: CancellationMode
  }) => void
}) {
  const t = useTranslations("mypage.membership.cancel")
  const atPeriodEnd = preview?.options.find((o) => o.mode === "AT_PERIOD_END")
  const immediate = preview?.options.find((o) => o.mode === "IMMEDIATE_REFUND")
  const canChooseImmediate = !!immediate?.available

  const [mode, setMode] = useState<CancellationMode>("AT_PERIOD_END")
  const [step, setStep] = useState<Step>("reason")
  const [selectedReason, setSelectedReason] = useState<string>("")
  const [reasonText, setReasonText] = useState<string>("")
  const [bankCode, setBankCode] = useState<string>("")
  const [accountNumber, setAccountNumber] = useState<string>("")
  const [holderName, setHolderName] = useState<string>("")

  // 열릴 때마다 초기화. 즉시해지가 가능한 경우에만 방식 선택 단계를 띄우고, 기본값은 서버 권장값.
  useEffect(() => {
    if (!open) return
    setMode(canChooseImmediate ? (preview?.recommendedMode ?? "AT_PERIOD_END") : "AT_PERIOD_END")
    setStep(canChooseImmediate ? "mode" : "reason")
    setSelectedReason("")
    setReasonText("")
    setBankCode("")
    setAccountNumber("")
    setHolderName("")
  }, [open, canChooseImmediate, preview?.recommendedMode])

  const selectedOption = mode === "IMMEDIATE_REFUND" ? immediate : atPeriodEnd
  const needsAccount = mode === "IMMEDIATE_REFUND" && !!selectedOption?.requiresReceiveAccount

  const steps: Step[] = useMemo(() => {
    const list: Step[] = []
    if (canChooseImmediate) list.push("mode")
    list.push("reason")
    if (needsAccount) list.push("account")
    return list
  }, [canChooseImmediate, needsAccount])

  const showOtherInput = selectedReason === "OTHER"

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

  const fmt = (d?: string | null) => formatDate(d, DATE_FORMATS.KO_LONG)
  const won = (amount: number) => amount.toLocaleString("ko-KR")

  const goNext = () => {
    const index = steps.indexOf(step)
    if (index < steps.length - 1) {
      setStep(steps[index + 1])
      return
    }
    submit()
  }

  const goBack = () => {
    const index = steps.indexOf(step)
    if (index > 0) setStep(steps[index - 1])
    else setOpen(false)
  }

  const submit = () => {
    if (!selectedReason) return
    onConfirm({
      reasonCode: selectedReason,
      reasonText: showOtherInput ? reasonText : undefined,
      cancelType: mode,
      refundReceiveAccount: needsAccount && accountFilled ? account : undefined,
    })
  }

  const nextDisabled =
    isSubmitting ||
    (step === "reason" && !selectedReason) ||
    (step === "account" && !accountFilled)

  const isLastStep = steps.indexOf(step) === steps.length - 1

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-h-[90vh] gap-4 overflow-y-auto rounded-3xl pt-6 sm:max-w-md">
        {steps.length > 1 && (
          <div className="flex justify-center gap-1.5">
            {steps.map((s) => (
              <span
                key={s}
                aria-current={step === s ? "step" : undefined}
                className={cn(
                  "h-1.5 w-6 rounded-full transition-colors",
                  step === s ? "bg-primary" : "bg-border"
                )}
              />
            ))}
          </div>
        )}

        {step === "mode" && (
          <>
            <DialogHeader>
              <DialogTitle className="text-foreground text-center text-base leading-6 font-medium sm:text-lg sm:leading-7">
                {t("modeStepTitle")}
              </DialogTitle>
            </DialogHeader>

            <RadioGroup
              value={mode}
              onValueChange={(value) => setMode(value as CancellationMode)}
              className="w-full gap-2"
            >
              {/* 해지예약 — 잔여 기간을 그대로 쓰고 자동결제만 중단 */}
              <label
                htmlFor="mode-at-period-end"
                className={cn(
                  "flex cursor-pointer items-start gap-2.5 rounded-xl border p-3.5 transition-colors",
                  mode === "AT_PERIOD_END"
                    ? "border-primary bg-[#fff2ec]"
                    : "border-border hover:bg-muted"
                )}
              >
                <RadioGroupItem
                  id="mode-at-period-end"
                  value="AT_PERIOD_END"
                  className="border-border data-[state=checked]:border-primary mt-0.5 shadow-none"
                />
                <span className="flex flex-col gap-0.5">
                  <span className="text-foreground text-sm font-bold">
                    {preview?.isRecurring
                      ? t("modeAtPeriodEndTitle")
                      : t("modeAtPeriodEndTitleOneTime")}
                  </span>
                  <span className="text-muted-foreground text-xs leading-4">
                    {t("modeAtPeriodEndDesc", {
                      date: fmt(atPeriodEnd?.effectiveEndsAt),
                    })}
                  </span>
                </span>
              </label>

              {/* 즉시해지 — 잔여 기간을 포기하고 환불 */}
              <label
                htmlFor="mode-immediate"
                className={cn(
                  "flex cursor-pointer items-start gap-2.5 rounded-xl border p-3.5 transition-colors",
                  mode === "IMMEDIATE_REFUND"
                    ? "border-primary bg-[#fff2ec]"
                    : "border-border hover:bg-muted"
                )}
              >
                <RadioGroupItem
                  id="mode-immediate"
                  value="IMMEDIATE_REFUND"
                  className="border-border data-[state=checked]:border-primary mt-0.5 shadow-none"
                />
                <span className="flex flex-col gap-0.5">
                  <span className="text-foreground text-sm font-bold">
                    {t("modeImmediateTitle", {
                      amount: won(immediate?.refundAmount ?? 0),
                    })}
                  </span>
                  <span className="text-muted-foreground text-xs leading-4">
                    {t("modeImmediateDesc")}
                  </span>
                  {/* 연간 중도해지 정산 내역 — 왜 이 금액인지 그대로 보여준다 */}
                  {immediate?.breakdown && (
                    <span className="text-muted-foreground mt-1 flex flex-col gap-0.5 text-xs leading-4">
                      <span>
                        {t("breakdownPaid", {
                          amount: won(immediate.breakdown.paidAmount),
                        })}
                      </span>
                      <span>
                        {t("breakdownUsage", {
                          months: immediate.breakdown.monthsElapsed,
                          monthly: won(immediate.breakdown.monthlyListPrice),
                          amount: won(immediate.breakdown.usageDeduction),
                        })}
                      </span>
                      {immediate.breakdown.benefitDeduction > 0 && (
                        <span>
                          {t("breakdownBenefit", {
                            amount: won(immediate.breakdown.benefitDeduction),
                          })}
                        </span>
                      )}
                    </span>
                  )}
                  {immediate?.refundExecution === "MANUAL" && (
                    <span className="text-muted-foreground mt-1 text-xs leading-4">
                      {t("manualRefundNotice", {
                        days: preview?.refundProcessingBusinessDays ?? 3,
                      })}
                    </span>
                  )}
                </span>
              </label>
            </RadioGroup>
          </>
        )}

        {step === "reason" && (
          <>
            <DialogHeader>
              <DialogTitle className="text-foreground text-center text-base leading-6 font-medium sm:text-lg sm:leading-7">
                {mode === "IMMEDIATE_REFUND" ? (
                  <>
                    {t("summaryImmediate", {
                      amount: won(immediate?.refundAmount ?? 0),
                    })}
                    <br />
                    {t("titleRejoin")}
                  </>
                ) : (
                  <>
                    {t("summaryAtPeriodEnd", {
                      date: fmt(atPeriodEnd?.effectiveEndsAt),
                    })}
                    <br />
                    {t("titleRejoin")}
                  </>
                )}
              </DialogTitle>
            </DialogHeader>

            {/* 즉시해지를 고를 수 없는 경우 그 이유를 숨기지 않는다 */}
            {!canChooseImmediate && immediate?.unavailableReason && (
              <p className="bg-muted text-muted-foreground rounded-xl px-3 py-2 text-xs leading-4">
                {immediate.unavailableReason}
              </p>
            )}

            <div className="text-center">
              <p className="text-foreground text-base leading-6 font-bold">
                {t("reasonHeading")}
              </p>
              <p className="text-muted-foreground mt-1 text-sm leading-5">
                {t("reasonSubheading")}
              </p>
            </div>

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
          </>
        )}

        {step === "account" && (
          <>
            <DialogHeader>
              <DialogTitle className="text-foreground text-center text-base leading-6 font-bold sm:text-lg sm:leading-7">
                {t("refundStepTitle")}
              </DialogTitle>
            </DialogHeader>

            <div className="bg-muted space-y-2.5 rounded-2xl p-4 text-left">
              <p className="text-foreground text-sm font-semibold">
                {t("refundAccountHeading")}
              </p>
              <p className="text-muted-foreground text-xs leading-4">
                {t("refundAccountNoteAmount", {
                  amount: won(immediate?.refundAmount ?? 0),
                  days: preview?.refundProcessingBusinessDays ?? 3,
                })}
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
          </>
        )}

        <DialogFooter className="flex w-full sm:flex-col">
          <div className="flex w-full flex-col gap-2">
            <Button
              onClick={goNext}
              disabled={nextDisabled}
              className="h-[52px] rounded-xl text-base font-bold"
            >
              {isSubmitting
                ? t("processing")
                : isLastStep
                  ? t("confirmButton")
                  : t("next")}
            </Button>
            <Button
              variant="outline"
              onClick={goBack}
              disabled={isSubmitting}
              className="h-11 rounded-xl"
            >
              {steps.indexOf(step) > 0 ? t("back") : t("cancelButton")}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
