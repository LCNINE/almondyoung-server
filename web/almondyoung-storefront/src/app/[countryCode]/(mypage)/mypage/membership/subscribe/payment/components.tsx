"use client"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormMessage,
} from "@/components/ui/form"
import { Label } from "@/components/ui/label"
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table"
import { zodResolver } from "@hookform/resolvers/zod"
import { HttpApiError } from "@lib/api/api-error"
import { getBillingMethods, getCmsBillingMethodStatuses } from "@lib/api/wallet"
import {
  subscribeWithBillingMethod,
  createMembershipCheckoutIntent,
} from "@lib/api/membership"
import { setPendingPaymentMode } from "@lib/utils/checkout-intent-map"
import { cn } from "@lib/utils"
import { providerLabel } from "@lib/utils/billing-provider"
import { useUser } from "@/contexts/user-context"
import type {
  BillingMethodDto,
  CmsBillingMethodStatusDto,
} from "@lib/types/dto/wallet"
import { Calendar, Check, CreditCard, Gift } from "lucide-react"
import { useParams, useRouter } from "next/navigation"
import React, { useEffect, useState } from "react"
import { useForm } from "react-hook-form"
import { toast } from "sonner"
import { z } from "zod"

// 순수 UI용 타입 정의
type SubscriptionType = "monthly" | "yearly" | null

// 정기결제(CMS 자동이체) 일시 비활성화 스위치. CMS 재개 시 true 로 되돌리면 원복.
// ponytail: 연간구독 선택 시 정기결제가 비활성화되던 로직을 항상 적용하는 단일 플래그.
const RECURRING_ENABLED = false

type MemberBenefitCommon = {
  id: string
  title: string
  isSuspended: boolean
}

type MembershipTrialBenefit = MemberBenefitCommon & {
  type: "trial"
  days: number
  used: boolean
}

type MembershipDiscountBenefit = MemberBenefitCommon & {
  type: "discount"
  percentage: number
  maxUses: number
  usedPayments: Array<{ uses: number }>
}

type MemberBenefit = MembershipTrialBenefit | MembershipDiscountBenefit

const subscriptionSchema = z.object({
  subscriptionType: z
    .enum(["monthly", "yearly"])
    .optional()
    .refine((val) => val === "monthly" || val === "yearly", {
      message: "구독 유형을 선택해주세요",
    }),
  billingMode: z.enum(["recurring", "one_time"]),
  discountBenefitId: z.string().optional(),
  agreement: z.boolean().refine((value) => value === true, {
    message: "약관에 동의해주세요",
  }),
})

type MembershipFormProps = {
  monthlyPlan: {
    plan: {
      id: string
      price: number
      durationDays: number
      trialDays: number
    }
    tier: {
      code: string
      name: string
    }
  }
  yearlyPlan: {
    plan: {
      id: string
      price: number
      durationDays: number
      trialDays: number
    }
    tier: {
      code: string
      name: string
    }
  }
  existingSubType: SubscriptionType
  availableBenefits: MemberBenefit[]
}

export function MembershipForm({
  monthlyPlan,
  yearlyPlan,
  existingSubType,
  availableBenefits,
}: MembershipFormProps) {
  const router = useRouter()
  const params = useParams()
  const countryCode =
    typeof params.countryCode === "string" ? params.countryCode : "kr"
  const { user } = useUser()

  const [billingMethods, setBillingMethods] = useState<BillingMethodDto[]>([])
  const [cmsBillingStatuses, setCmsBillingStatuses] = useState<
    CmsBillingMethodStatusDto[]
  >([])
  const [selectedBillingMethodId, setSelectedBillingMethodId] = useState<
    string | null
  >(null)

  useEffect(() => {
    Promise.all([getBillingMethods(), getCmsBillingMethodStatuses()])
      .then(([methods, cmsStatuses]) => {
        setBillingMethods(methods.filter((m) => m.status === "ACTIVE"))
        setCmsBillingStatuses(cmsStatuses)
      })
      .catch(() => {})
  }, [])

  const trialBenefits: MembershipTrialBenefit[] = []
  const discountBenefits: MembershipDiscountBenefit[] = []
  availableBenefits.forEach((b) => {
    switch (b.type) {
      case "trial":
        trialBenefits.push(b as MembershipTrialBenefit)
        break
      case "discount":
        discountBenefits.push(b as MembershipDiscountBenefit)
        break
    }
  })

  const formDefaultValues = {
    subscriptionType:
      existingSubType === "monthly" || existingSubType === "yearly"
        ? existingSubType
        : undefined,
    billingMode: RECURRING_ENABLED
      ? ("recurring" as const)
      : ("one_time" as const),
    agreement: false,
  }

  const form = useForm<z.infer<typeof subscriptionSchema>>({
    mode: "onChange",
    resolver: zodResolver(subscriptionSchema),
    defaultValues: formDefaultValues,
  })

  async function onSubmit(data: z.infer<typeof subscriptionSchema>) {
    try {
      if (!user) {
        toast.error("로그인이 필요합니다.")
        return
      }
      if (!data.subscriptionType) {
        toast.error("구독 유형을 선택해주세요.")
        return
      }

      const selectedPlanId =
        data.subscriptionType === "monthly"
          ? monthlyPlan.plan.id
          : yearlyPlan.plan.id

      const billingMode = data.billingMode

      if (selectedBillingMethodId) {
        const attemptId = crypto.randomUUID()
        await subscribeWithBillingMethod(
          selectedPlanId,
          selectedBillingMethodId,
          billingMode,
          attemptId
        )
        if (billingMode === "recurring") {
          const trialMsg =
            totalTrialDays > 0
              ? `${totalTrialDays}일 무료 체험이 시작되었습니다! 체험 종료 후 자동으로 결제됩니다.`
              : "정기결제가 시작되었습니다."
          toast.success(trialMsg)
        } else {
          toast.success("멤버십 가입이 완료되었습니다.")
        }
        router.push(`/${countryCode}/mypage/membership/subscribe/success`)
      } else {
        // 신규 결제수단: 정기결제는 자동이체 수단 먼저 등록 필요, 한번만결제는 wallet-web으로 바로 이동
        if (billingMode === "recurring") {
          toast.info("정기결제를 시작하려면 먼저 자동이체 수단을 등록해주세요.")
          router.push(
            `/${countryCode}/mypage/membership/payment-method?redirect=subscribe&planId=${selectedPlanId}`
          )
        } else {
          const returnUrl = `${window.location.origin}/${countryCode}/checkout/callback`
          const { intentId } = await createMembershipCheckoutIntent(
            selectedPlanId,
            returnUrl,
            "one_time"
          )
          setPendingPaymentMode("membership", {
            planId: selectedPlanId,
            billingMode: "one_time",
          })
          const walletWebUrl =
            process.env.NEXT_PUBLIC_WALLET_WEB_URL || "http://localhost:3200"
          window.location.href = `${walletWebUrl}/pay/${intentId}?region=${countryCode}`
        }
      }
    } catch (error) {
      // UNAUTHORIZED(토큰 만료)는 삼키지 않고 re-throw → error.tsx가 토큰 복구 처리
      const err = error as Error & { digest?: string; status?: number }
      if (err?.digest === "UNAUTHORIZED" || err?.message === "UNAUTHORIZED" || err?.status === 401) {
        throw error
      }
      if (error instanceof HttpApiError) {
        toast.error(error.message)
      } else {
        toast.error(
          error instanceof Error ? error.message : "멤버십 등록에 실패했습니다."
        )
      }
      console.error(error)
    }
  }

  const discountCount = discountBenefits.length
  const hasPendingMethods = cmsBillingStatuses.some(
    (s) => s.cmsMemberStatus === "PENDING"
  )

  const billingMode = form.watch("billingMode")
  const subscriptionType = form.watch("subscriptionType")
  // 정기결제 비활성화 조건: 기능 스위치 OFF 이거나 연간 플랜(1회 결제만 지원).
  const recurringDisabled = !RECURRING_ENABLED || subscriptionType === "yearly"

  // 무료체험은 정기결제(recurring)일 때만, 선택한 플랜의 trialDays 기준으로 안내한다.
  // (availableBenefits는 현재 비어 전달되므로 trialBenefits는 0이고, 플랜 trialDays가 실제 기준)
  // 재가입자는 서버가 무료체험을 제거하므로 실제 적용 일수는 가입 응답 effectiveTrialDays로 확정된다.
  const selectedPlan = subscriptionType === "yearly" ? yearlyPlan : monthlyPlan
  const totalTrialDays =
    billingMode === "recurring"
      ? (selectedPlan?.plan?.trialDays ?? 0) + trialBenefits.reduce((acc, cur) => acc + cur.days, 0)
      : 0

  useEffect(() => {
    if (billingMode === "one_time") {
      setSelectedBillingMethodId(null)
    }
  }, [billingMode])

  useEffect(() => {
    if (recurringDisabled) {
      form.setValue("billingMode", "one_time")
    }
  }, [recurringDisabled, form])

  function getSubmitButtonLabel() {
    if (!subscriptionType) return "구독 유형을 선택하세요"
    if (!form.watch("agreement")) return "약관에 동의해주세요"

    if (billingMode === "recurring") {
      if (selectedBillingMethodId) {
        const trialLabel =
          totalTrialDays > 0 ? `${totalTrialDays}일 무료체험` : "정기결제"
        return `${trialLabel} 시작하기`
      }
      if (hasPendingMethods) return "심사 완료 후 정기결제 가능"
      return "자동이체 계좌 심사 신청하기"
    }

    return `${firstPrice.toLocaleString()}원 결제하기`
  }
  const hasPrice = subscriptionType == "monthly" || subscriptionType == "yearly"
  let firstPrice =
    subscriptionType === "monthly"
      ? monthlyPlan.plan.price
      : subscriptionType === "yearly"
        ? yearlyPlan.plan.price
        : 0
  const selectedDiscount = discountBenefits.find(
    (b) => b.id === form.watch("discountBenefitId")
  )
  const discountPrice = Math.floor(
    (firstPrice * (100 - (selectedDiscount?.percentage ?? 0))) / 100
  )
  const finalPrice = selectedDiscount ? discountPrice : firstPrice

  const yearlyMonthly = Math.round(yearlyPlan.plan.price / 12)

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        className="mx-auto flex max-w-xl flex-col gap-4 px-4 py-4 md:px-0"
      >
        {/* 1. 플랜 선택 */}
        <Card>
          <CardHeader>
            <CardTitle>플랜 선택</CardTitle>
          </CardHeader>
          <CardContent>
            <FormField
              control={form.control}
              name="subscriptionType"
              render={({ field }) => (
                <FormItem className="space-y-3">
                  <FormControl>
                    <div className="flex flex-col gap-3">
                      <PlanOption
                        selected={field.value === "monthly"}
                        onSelect={() => field.onChange("monthly")}
                        title="월간 구독"
                        price={`${monthlyPlan.plan.price.toLocaleString()}원`}
                        unit="/ 월"
                      />
                      <PlanOption
                        selected={field.value === "yearly"}
                        onSelect={() => field.onChange("yearly")}
                        title="연간 구독"
                        price={`${yearlyPlan.plan.price.toLocaleString()}원`}
                        unit="/ 연"
                        badge="2달 무료"
                        subNote={`월 ${yearlyMonthly.toLocaleString()}원 꼴`}
                      />
                    </div>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </CardContent>
        </Card>

        {/* 2. 결제 방식 — 정기결제가 켜졌을 때만 노출. OFF 상태에선 항상 1회결제라 카드 자체를 숨김 */}
        {RECURRING_ENABLED && (
          <Card>
            <CardHeader>
              <CardTitle>결제 방식</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <FormField
                control={form.control}
                name="billingMode"
                render={({ field }) => (
                  <FormItem>
                    <FormControl>
                      <div className="flex flex-col gap-2">
                        <button
                          type="button"
                          disabled={recurringDisabled}
                          className={cn(
                            "flex cursor-pointer flex-col rounded-md border-2 p-3 text-left",
                            recurringDisabled
                              ? "border-border bg-muted cursor-not-allowed opacity-50"
                              : field.value === "recurring"
                                ? "bg-primary/5 border-primary"
                                : "bg-popover hover:bg-accent border-border"
                          )}
                          onClick={() =>
                            !recurringDisabled && field.onChange("recurring")
                          }
                        >
                          <div className="flex items-center gap-3">
                            <Gift className="h-5 w-5 shrink-0 text-emerald-500" />
                            <div className="flex flex-col">
                              <p className="text-sm font-bold">
                                정기결제 (자동갱신)
                              </p>
                              <p className="text-muted-foreground text-xs">
                                {totalTrialDays > 0
                                  ? `${totalTrialDays}일 무료 체험 후 `
                                  : ""}
                                등록하신 자동이체 수단으로 매월 결제
                              </p>
                            </div>
                            {!recurringDisabled && (
                              <Badge className="ml-auto shrink-0 bg-emerald-500 text-white">
                                추천
                              </Badge>
                            )}
                          </div>
                        </button>
                        {!recurringDisabled && field.value === "recurring" && (
                          <p className="rounded-md border border-amber-100 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-700">
                            새 자동이체 계좌를 등록하는 경우 효성 CMS 심사에{" "}
                            <strong>1~2영업일</strong>이 걸립니다. 즉시
                            이용하려면 &apos;한번만 결제&apos;를 선택해 주세요.
                          </p>
                        )}
                        {subscriptionType === "yearly" && (
                          <p className="text-muted-foreground px-1 text-xs">
                            연간 플랜은 1회 결제만 지원합니다.
                          </p>
                        )}
                        <button
                          type="button"
                          className={cn(
                            "bg-popover hover:bg-accent flex cursor-pointer flex-col rounded-md border-2 p-3 text-left",
                            field.value === "one_time"
                              ? "border-primary bg-primary/5"
                              : "border-border"
                          )}
                          onClick={() => field.onChange("one_time")}
                        >
                          <div className="flex items-center gap-3">
                            <Calendar className="h-5 w-5 shrink-0 text-gray-500" />
                            <div className="flex flex-col">
                              <p className="text-sm font-bold">한번만 결제</p>
                              <p className="text-muted-foreground text-xs">
                                결제 즉시 구독 시작, 자동갱신 없음
                              </p>
                            </div>
                          </div>
                        </button>
                      </div>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>
        )}

        {/* 3. 정기결제 결제수단 — recurring 선택 + 등록수단 있을 때만 */}
        {billingMode === "recurring" && billingMethods.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>결제 수단</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <p className="text-muted-foreground text-sm">
                등록된 정기결제 수단으로 무료체험을 시작하거나, 새 결제수단을
                등록할 수 있습니다.
              </p>
              {billingMethods.map((method) => (
                <div
                  key={method.id}
                  onClick={() =>
                    setSelectedBillingMethodId(
                      selectedBillingMethodId === method.id ? null : method.id
                    )
                  }
                  className={cn(
                    "flex cursor-pointer items-center gap-3 rounded-md border-2 p-3 transition-colors",
                    selectedBillingMethodId === method.id
                      ? "border-primary bg-primary/5"
                      : "hover:bg-accent"
                  )}
                >
                  <CreditCard className="h-5 w-5 shrink-0 text-gray-500" />
                  <div className="flex flex-1 flex-col gap-0.5">
                    <p className="text-sm font-semibold">
                      {method.displayName ?? "등록된 자동이체 수단"}
                    </p>
                    <span className="w-fit rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-500">
                      {providerLabel(method.providerType)}
                    </span>
                  </div>
                  {selectedBillingMethodId === method.id && (
                    <span className="text-primary text-xs font-semibold">
                      선택됨
                    </span>
                  )}
                </div>
              ))}
              <div
                onClick={() => setSelectedBillingMethodId(null)}
                className={cn(
                  "flex cursor-pointer items-center gap-3 rounded-md border-2 p-3 transition-colors",
                  selectedBillingMethodId === null
                    ? "border-primary bg-primary/5"
                    : "hover:bg-accent"
                )}
              >
                <CreditCard className="h-5 w-5 shrink-0 text-gray-400" />
                <p className="text-sm text-gray-600">
                  새 자동이체 계좌 심사 신청 후 시작
                </p>
                {selectedBillingMethodId === null && (
                  <span className="text-primary ml-auto text-xs font-semibold">
                    선택됨
                  </span>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* 할인/무료기간 혜택 — 있을 때만 */}
        {(totalTrialDays !== 0 || discountCount != 0) && (
          <Card>
            <CardHeader>
              <CardTitle>혜택</CardTitle>
            </CardHeader>
            <CardContent>
              {totalTrialDays !== 0 && (
                <>
                  <h3 className="mb-2 text-base font-bold text-[#1a1c20]">무료 기간</h3>
                  <Table>
                    <TableBody>
                      {trialBenefits.map((trialBenefit) => (
                        <TableRow key={trialBenefit.id}>
                          <TableCell className="py-2">
                            {trialBenefit.title}
                          </TableCell>
                          <TableCell className="w-4 py-2 whitespace-nowrap">
                            {trialBenefit.days}일
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  <div className="border-primary flex w-full items-center justify-between rounded-md border-2 p-3">
                    <div className="flex flex-row items-center gap-4">
                      <Gift className="h-5 w-5" />
                      <p className="text-base font-bold">
                        총 {totalTrialDays}일
                      </p>
                    </div>
                  </div>
                </>
              )}

              {discountCount != 0 && (
                <>
                  <h3 className="mt-4 mb-2 text-lg font-bold">할인 선택</h3>
                  <FormField
                    control={form.control}
                    name="discountBenefitId"
                    render={({ field }) => (
                      <FormItem className="space-y-3">
                        <FormControl>
                          <div className="flex flex-col gap-2">
                            {discountBenefits.map((discountBenefit) => (
                              <div
                                key={discountBenefit.id}
                                className={cn(
                                  "bg-popover hover:bg-accent flex w-full items-center justify-between rounded-md border-2 p-3",
                                  field.value === discountBenefit.id &&
                                    "border-primary"
                                )}
                                onClick={() =>
                                  field.onChange(
                                    field.value === discountBenefit.id
                                      ? undefined
                                      : discountBenefit.id
                                  )
                                }
                              >
                                <div className="flex flex-row items-center gap-4">
                                  <Calendar className="h-5 w-5" />
                                  <div className="flex flex-col">
                                    <p className="text-base font-bold">
                                      {discountBenefit.title}
                                    </p>
                                    <p className="text-muted-foreground text-sm">
                                      {discountBenefit.maxUses}개월간{" "}
                                      {discountBenefit.percentage}% 할인
                                    </p>
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </>
              )}
            </CardContent>
          </Card>
        )}

        {/* 4. 결제 요약 + 안내 + 동의 */}
        <Card>
          <CardHeader>
            <CardTitle>결제 확인</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* 요약 */}
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-600">
                {hasPrice
                  ? subscriptionType === "monthly"
                    ? "월간 구독 · 1회 결제"
                    : "연간 구독 · 1회 결제"
                  : "구독 유형을 선택하세요"}
              </span>
              {hasPrice && (
                <span className="text-lg font-bold">
                  {finalPrice.toLocaleString()}원
                </span>
              )}
            </div>
            {selectedDiscount && (
              <p className="-mt-2 text-right text-xs text-gray-400">
                할인 종료 후 {firstPrice.toLocaleString()}원
              </p>
            )}

            {/* 결제/환불 안내 (접이식) */}
            <details className="rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-500">
              <summary className="cursor-pointer font-medium text-gray-600 select-none">
                결제 · 환불 안내
              </summary>
              <ul className="mt-2 list-disc space-y-1 pl-4">
                <li>1회 결제로, 자동결제는 진행되지 않습니다.</li>
                <li>
                  결제 즉시 이용이 시작되며,{" "}
                  <span className="font-medium text-gray-700">
                    이용 시작 후 환불은 불가
                  </span>
                  합니다.
                </li>
                <li>
                  서비스 장애 등 정상 이용이 어려운 경우 일부 환불이 검토될 수
                  있습니다.
                </li>
              </ul>
            </details>

            {/* 통합 동의 */}
            <FormField
              control={form.control}
              name="agreement"
              render={({ field }) => (
                <AgreementRow
                  value={field.value}
                  onChange={field.onChange}
                  monthlyPrice={monthlyPlan.plan.price}
                  yearlyPrice={yearlyPlan.plan.price}
                />
              )}
            />
          </CardContent>
        </Card>

        {/* 결제 버튼 — 폼 흐름 끝 (모바일 전역 하단 네비와 충돌 피하려 고정바 미사용) */}
        <Button
          className="h-12 w-full text-base"
          disabled={
            !form.watch("agreement") ||
            !form.watch("subscriptionType") ||
            form.formState.isSubmitting ||
            (billingMode === "recurring" &&
              !selectedBillingMethodId &&
              hasPendingMethods)
          }
          type="submit"
        >
          {form.formState.isSubmitting ? (
            <span className="flex items-center gap-2">
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
              처리중...
            </span>
          ) : (
            getSubmitButtonLabel()
          )}
        </Button>
      </form>
    </Form>
  )
}

interface PlanOptionProps {
  selected: boolean
  onSelect: () => void
  title: string
  price: string
  unit: string
  badge?: string
  subNote?: string
}

function PlanOption({
  selected,
  onSelect,
  title,
  price,
  unit,
  badge,
  subNote,
}: PlanOptionProps) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "flex w-full items-center gap-3 rounded-lg border-2 p-4 text-left transition-colors",
        selected
          ? "border-primary bg-primary/5"
          : "border-border bg-popover hover:bg-accent"
      )}
    >
      <span
        className={cn(
          "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2",
          selected ? "border-primary bg-primary text-white" : "border-gray-300"
        )}
      >
        {selected && <Check className="h-3 w-3" strokeWidth={3} />}
      </span>
      <div className="flex flex-1 flex-col">
        <div className="flex items-center gap-2">
          <p className="text-base font-bold">{title}</p>
          {badge && <Badge className="bg-primary text-white">{badge}</Badge>}
        </div>
        {subNote && <p className="text-muted-foreground text-xs">{subNote}</p>}
      </div>
      <div className="text-right">
        <p className="text-base font-bold">{price}</p>
        <p className="text-muted-foreground text-xs">{unit}</p>
      </div>
    </button>
  )
}

interface AgreementRowProps {
  value: boolean
  onChange: (checked: boolean) => void
  monthlyPrice: number
  yearlyPrice: number
}

const AgreementRow: React.FC<AgreementRowProps> = ({
  value,
  onChange,
  monthlyPrice,
  yearlyPrice,
}) => {
  const [isDialogOpen, setIsDialogOpen] = useState(false)

  return (
    <FormItem className="flex flex-row items-center gap-2.5 space-y-0 rounded-lg border p-3.5">
      <FormControl>
        <Checkbox
          id="agreement"
          checked={value}
          onCheckedChange={(checked) => onChange(checked === true)}
        />
      </FormControl>
      <Label
        htmlFor="agreement"
        className="flex-1 cursor-pointer text-sm leading-snug font-normal text-gray-700"
      >
        이용약관 및 결제·환불 정책에 동의합니다
      </Label>
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault()
          setIsDialogOpen(true)
        }}
        className="text-primary shrink-0 whitespace-nowrap text-xs font-semibold underline underline-offset-2"
      >
        전문 보기
      </button>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="gap-0 overflow-hidden rounded-3xl p-0 sm:max-w-md">
          <DialogHeader className="space-y-1 px-6 pt-6 pb-4 text-left">
            <DialogTitle className="text-lg font-bold text-[#1a1c20]">
              아몬드영 멤버십 이용약관
            </DialogTitle>
            <DialogDescription className="text-[13px] text-[#868b94]">
              이용약관 및 결제·환불 정책 전문입니다.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[58vh] overflow-y-auto border-y border-[#dcdee3] bg-[#f7f8f9] px-6 py-5">
            <TermsAndConditions
              monthlyPrice={monthlyPrice}
              yearlyPrice={yearlyPrice}
            />
          </div>
          <DialogFooter className="p-4">
            <Button
              className="h-[52px] w-full rounded-xl bg-[#ff6600] text-base font-bold text-white hover:bg-[#e14d00]"
              onClick={() => {
                onChange(true)
                setIsDialogOpen(false)
              }}
            >
              확인하고 동의하기
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </FormItem>
  )
}

function TermsAndConditions({
  monthlyPrice,
  yearlyPrice,
}: {
  monthlyPrice: number
  yearlyPrice: number
}) {
  return (
    <div className="space-y-6 text-sm leading-[19px] text-[#555d6d]">
      <div>
        <h1 className="mb-2 text-lg font-bold text-[#1a1c20]">
          정기 자동 결제 및 이용 약관 동의서
        </h1>
        <p>
          본 동의서는 귀하의 정기 결제 서비스 이용과 관련하여 법적 보호 및
          명확한 이용 조건을 제공하기 위해 작성되었습니다.
        </p>
      </div>

      <div>
        <h2 className="mb-2 text-base font-bold text-[#1a1c20]">결제 목적 및 내용</h2>
        <ul className="list-disc space-y-1.5 pl-5 marker:text-[#b0b3ba]">
          <li>
            본 서비스는 매월 정기적인 금액 결제를 통해 서비스 구독 및 제공을
            목적으로 합니다.
          </li>
          <li>자동이체(CMS)를 통해 진행됩니다.</li>
        </ul>
      </div>

      <div>
        <h2 className="mb-2 text-base font-bold text-[#1a1c20]">결제 주기 및 금액</h2>
        <ul className="list-disc space-y-1.5 pl-5 marker:text-[#b0b3ba]">
          <li>
            결제 주기: 매월 구독 기간이 하루 남았을 때 1회 (정기결제 기준)
          </li>
          <li>
            결제 금액: 월간 정기결제 {monthlyPrice.toLocaleString()}원 / 연간
            1회 결제 {yearlyPrice.toLocaleString()}원
          </li>
          <li>결제 금액은 동의 없이 변경되지 않습니다.</li>
        </ul>
      </div>

      <div>
        <h2 className="mb-2 text-base font-bold text-[#1a1c20]">결제 정보 수집 항목</h2>
        <ul className="list-disc space-y-1.5 pl-5 marker:text-[#b0b3ba]">
          <li>결제자 정보: 이름, 연락처, 생년월일</li>
          <li>
            결제 수단 정보: 계좌번호, 은행명, 예금주명, 생년월일(개인) 또는
            사업자번호(법인)
          </li>
        </ul>
      </div>

      <div>
        <h2 className="mb-2 text-base font-bold text-[#1a1c20]">동의 철회 및 변경</h2>
        <ul className="list-disc space-y-1.5 pl-5 marker:text-[#b0b3ba]">
          <li>
            귀하는 언제든 동의를 철회하거나 결제 정보를 변경할 권리가 있습니다.
          </li>
          <li>
            고객센터(1877-7184)로 연락 또는 아몬드영 홈페이지를 통해 해지가
            가능합니다.
          </li>
          <li>
            철회 이후 결제된 금액은 환불되지 않으며, 해당 월의 서비스는
            정상적으로 유지됩니다.
          </li>
        </ul>
      </div>

      <div>
        <h2 className="mb-2 text-base font-bold text-[#1a1c20]">유의사항</h2>
        <ul className="list-disc space-y-1.5 pl-5 marker:text-[#b0b3ba]">
          <li>결제 실패 시 서비스 이용이 제한될 수 있습니다.</li>
          <li>
            사전 고지 없이 결제 수단이 유효하지 않을 경우, 결제 처리가 진행되지
            않을 수 있습니다.
          </li>
        </ul>
      </div>

      <div>
        <h2 className="mb-2 text-base font-bold text-[#1a1c20]">환불 정책</h2>

        <h3 className="mt-4 mb-1.5 text-sm font-bold text-[#1a1c20]">제 1조 목적</h3>
        <p>
          본 약관은 아몬드영 멤버십 서비스(이하 &quot;서비스&quot;)를 이용함에
          있어 회원과 회사 간의 권리·의무 및 책임 사항을 규정함을 목적으로
          합니다.
        </p>

        <h3 className="mt-4 mb-1.5 text-sm font-bold text-[#1a1c20]">제 2조 환불 불가 정책</h3>
        <ul className="list-disc space-y-1.5 pl-5 marker:text-[#b0b3ba]">
          <li>
            본 서비스는 구독형 서비스로, 서비스 제공이 개시된 이후에는 환불이
            불가능합니다.
          </li>
          <li>
            서비스 장애, 기술적 오류 등으로 정상 이용이 어려운 경우, 이용하지
            못한 기간에 대해 예외적으로 환불이 검토될 수 있습니다.
          </li>
          <li>
            정기결제는 매월 자동 갱신되며, 회원이 해지를 요청하지 않는 한 갱신된
            결제 건에 대해 환불이 제공되지 않습니다.
          </li>
        </ul>

        <h3 className="mt-4 mb-1.5 text-sm font-bold text-[#1a1c20]">
          제 3조 구독 해지 및 갱신
        </h3>
        <ul className="list-disc space-y-1.5 pl-5 marker:text-[#b0b3ba]">
          <li>
            회원은 언제든지 구독을 해지할 수 있으며, 해지 요청은 다음 결제일
            전에 완료되어야 합니다.
          </li>
          <li>
            해지 요청이 이루어지지 않은 경우, 서비스는 자동으로 갱신되며 결제가
            처리됩니다.
          </li>
        </ul>

        <h3 className="mt-4 mb-1.5 text-sm font-bold text-[#1a1c20]">제 4조 회원의 동의</h3>
        <ul className="list-disc space-y-1.5 pl-5 marker:text-[#b0b3ba]">
          <li>
            회원은 구독 결제를 진행함으로써 본 약관에 동의한 것으로 간주됩니다.
          </li>
          <li>
            회원은 결제 전 환불 불가 정책을 충분히 숙지할 책임이 있습니다.
          </li>
        </ul>
      </div>
    </div>
  )
}
