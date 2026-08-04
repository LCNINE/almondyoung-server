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
    /** 등록된 자동이체 계좌까지 지울지. 정기결제 계약에서만 값이 온다. */
    deleteBillingMethod?: boolean
  }) => void
}) {
  const t = useTranslations("mypage.membership.cancel")
  const atPeriodEnd = preview?.options.find((o) => o.mode === "AT_PERIOD_END")
  const immediate = preview?.options.find((o) => o.mode === "IMMEDIATE_REFUND")
  // 이미 해지 예약된 구독은 예약을 또 걸 수 없다(서버가 409). 남은 선택지는 즉시해지 + 환불뿐이라
  // 방식 선택 단계를 건너뛴다 — 고르면 반드시 거절되는 선택지를 보여주지 않는다.
  const alreadyScheduled = !!preview?.alreadyScheduledForCancellation
  // 효성 CMS 선지급 건: 출금 전이라 청구 없이 끝난다. '0원 환불' 로 읽히면 손해 보는 선택처럼 보인다.
  const preCollection = immediate?.refundKind === "PRE_COLLECTION_WITHDRAWAL"
  const canChooseImmediate = !!immediate?.available && !alreadyScheduled
  const immediateOnly = alreadyScheduled && !!immediate?.available

  const [mode, setMode] = useState<CancellationMode>("AT_PERIOD_END")
  const [step, setStep] = useState<Step>("reason")
  const [selectedReason, setSelectedReason] = useState<string>("")
  const [reasonText, setReasonText] = useState<string>("")
  const [deleteBillingMethod, setDeleteBillingMethod] = useState(false)
  const [bankCode, setBankCode] = useState<string>("")
  const [accountNumber, setAccountNumber] = useState<string>("")
  const [holderName, setHolderName] = useState<string>("")

  // 열릴 때마다 초기화. 즉시해지가 가능한 경우에만 방식 선택 단계를 띄우고, 기본값은 서버 권장값.
  useEffect(() => {
    if (!open) return
    setMode(
      immediateOnly
        ? "IMMEDIATE_REFUND"
        : canChooseImmediate
          ? (preview?.recommendedMode ?? "AT_PERIOD_END")
          : "AT_PERIOD_END"
    )
    setStep(canChooseImmediate ? "mode" : "reason")
    setSelectedReason("")
    setReasonText("")
    setDeleteBillingMethod(false)
    setBankCode("")
    setAccountNumber("")
    setHolderName("")
  }, [open, canChooseImmediate, immediateOnly, preview?.recommendedMode])

  // 등록된 자동이체 계좌가 있는 정기결제 계약에서만 물어본다(1회 결제는 지울 계좌가 없다).
  const canKeepBillingMethod = !!preview?.isRecurring
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
      deleteBillingMethod: canKeepBillingMethod ? deleteBillingMethod : undefined,
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
          // 단계는 각 단계의 제목이 알려주므로, 점 표시는 장식으로 둔다(이름 없는 요소가 읽히지 않게).
          <div className="flex justify-center gap-1.5" aria-hidden="true">
            {steps.map((s) => (
              <span
                key={s}
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
                  {/* 아직 출금 전이라면 '예약' 을 고르는 순간 이번 기간 요금이 나간다 — 고르기 전에 알려야 한다. */}
                  {preCollection && (
                    <span className="text-muted-foreground text-xs leading-4">
                      {t("atPeriodEndPreCollectionNote")}
                    </span>
                  )}
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
                    {preCollection
                      ? t("modeImmediatePreCollectionTitle")
                      : t("modeImmediateTitle", {
                          amount: won(immediate?.refundAmount ?? 0),
                        })}
                  </span>
                  <span className="text-muted-foreground text-xs leading-4">
                    {preCollection
                      ? t("modeImmediatePreCollectionDesc")
                      : t("modeImmediateDesc")}
                  </span>
                  {/* 왜 환불이 되는지를 알려준다 — 금액만 보여주면 고객은 근거를 알 수 없다. */}
                  {immediate?.refundKind === "WITHDRAWAL_FULL" && (
                    <span className="text-primary text-xs leading-4">
                      {t("whyWithdrawal", {
                        days: preview?.withdrawalWindowDays ?? 7,
                      })}
                    </span>
                  )}
                  {immediate?.refundKind === "ANNUAL_PRORATION" && (
                    <span className="text-primary text-xs leading-4">
                      {t("whyAnnual")}
                    </span>
                  )}
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
                    {preCollection
                      ? t("summaryImmediatePreCollection")
                      : t("summaryImmediate", {
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

            {/* 해지해도 출금은 멈추므로 계좌는 남기는 것이 기본이다 — 남겨두면 재가입할 때
                은행 심사를 다시 받지 않아도 된다. 출금동의까지 철회하려는 고객은 여기서 고른다. */}
            {canKeepBillingMethod && (
              <div
                className="border-border space-y-2 rounded-xl border p-3 text-left"
                data-testid="billing-method-choice"
              >
                <p className="text-foreground text-sm font-semibold">
                  {t("keepBillingMethodTitle")}
                </p>
                <RadioGroup
                  value={deleteBillingMethod ? "delete" : "keep"}
                  onValueChange={(v) => setDeleteBillingMethod(v === "delete")}
                  className="w-full gap-1"
                >
                  <label
                    htmlFor="billing-method-keep"
                    className="flex cursor-pointer items-start gap-2.5 py-1"
                  >
                    <RadioGroupItem
                      id="billing-method-keep"
                      value="keep"
                      className="border-border data-[state=checked]:border-primary mt-0.5 shadow-none"
                    />
                    <span className="text-foreground text-sm leading-5 select-none">
                      {t("keepBillingMethodKeep")}
                    </span>
                  </label>
                  <label
                    htmlFor="billing-method-delete"
                    className="flex cursor-pointer items-start gap-2.5 py-1"
                  >
                    <RadioGroupItem
                      id="billing-method-delete"
                      value="delete"
                      className="border-border data-[state=checked]:border-primary mt-0.5 shadow-none"
                    />
                    <span className="text-foreground text-sm leading-5 select-none">
                      {t("keepBillingMethodDelete")}
                    </span>
                  </label>
                </RadioGroup>
                <p className="text-muted-foreground text-xs leading-4">
                  {deleteBillingMethod
                    ? t("keepBillingMethodNote")
                    : t("keepBillingMethodSafe")}
                </p>
              </div>
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
                <SelectTrigger
                  aria-label={t("bankPlaceholder")}
                  className="bg-background border-border h-11 w-full rounded-lg"
                >
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
                autoComplete="off"
                spellCheck={false}
                aria-label={t("accountNumberPlaceholder")}
                value={accountNumber}
                onChange={(event) =>
                  setAccountNumber(event.target.value.replace(/[^0-9]/g, ""))
                }
                placeholder={t("accountNumberPlaceholder")}
              />
              <Input
                className="bg-background border-border h-11 rounded-lg border text-sm placeholder:text-sm"
                autoComplete="off"
                spellCheck={false}
                aria-label={t("holderNamePlaceholder")}
                value={holderName}
                onChange={(event) => setHolderName(event.target.value)}
                placeholder={t("holderNamePlaceholder")}
              />
              {/* 입력 도중 나타나는 안내라 스크린리더에도 전달돼야 한다 */}
              <p className="text-destructive text-xs" role="status" aria-live="polite">
                {accountPartiallyFilled ? t("refundAccountIncomplete") : ""}
              </p>
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
