"use client"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
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
  Drawer,
  DrawerContent,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer"
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
import { isInvoiceBillingEnabled } from "@lib/utils/invoice-billing"
import { cn } from "@lib/utils"
import { providerLabel } from "@lib/utils/billing-provider"
import { useUser } from "@/contexts/user-context"
import { TermsAndConditions } from "@/domains/membership/components/terms-and-conditions"
import type {
  BillingMethodDto,
  CmsBillingMethodStatusDto,
} from "@lib/types/dto/wallet"
import {
  Calendar,
  Check,
  ChevronRight,
  CreditCard,
  Gift,
  Info,
} from "lucide-react"
import { useParams, useRouter } from "next/navigation"
import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react"
import { useTranslations } from "next-intl"
import { useForm } from "react-hook-form"
import { toast } from "sonner"
import { z } from "zod"

// 순수 UI용 타입 정의
type SubscriptionType = "monthly" | "yearly" | null

// 플랜(월/연) × 결제방식(정기/1회) 4조합 중 실제로 가능한 3개만 평탄화한다.
// 연간+정기는 미지원이라 조합으로 두면 비활성 선택지와 그 사유 안내가 따라붙는다.
const PLAN_CHOICES = z.enum([
  "monthly_recurring",
  "monthly_one_time",
  "yearly_one_time",
])
type PlanChoice = z.infer<typeof PLAN_CHOICES>

// 정기결제(CMS 자동이체) 개통 여부 = 인보이스(선적용) 정기결제 플래그와 연동한다.
// 플래그가 켜지면 월간 정기가입(선적용 인보이스 경로)이 폼에서 열리고, 꺼지면 one_time 만 노출한다.
// (연간구독은 별도로 always one_time — recurringDisabled 에서 처리.)
const RECURRING_ENABLED = isInvoiceBillingEnabled()

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

// 검증 메시지는 사용자 노출 문구라 호출부에서 i18n 메시지를 주입한다(CLAUDE.md zod 빌더 패턴).
const buildSubscriptionSchema = (m: {
  selectType: string
  agreeTerms: string
}) =>
  z.object({
    choice: PLAN_CHOICES.optional().refine((val) => val !== undefined, {
      message: m.selectType,
    }),
    discountBenefitId: z.string().optional(),
    agreement: z.boolean().refine((value) => value === true, {
      message: m.agreeTerms,
    }),
  })

type SubscriptionFormValues = z.infer<
  ReturnType<typeof buildSubscriptionSchema>
>

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
    Promise.all([
      getBillingMethods({ includePendingMandate: isInvoiceBillingEnabled() }),
      getCmsBillingMethodStatuses(),
    ])
      .then(([methods, cmsStatuses]) => {
        const active = methods.filter((m) => m.status === "ACTIVE")
        setBillingMethods(active)
        setCmsBillingStatuses(cmsStatuses)
        // 은행 확인이 끝난 계좌를 우선, 없으면 심사 중인 것이라도 고른다.
        const usable =
          active.find((m) => m.cmsMemberStatus !== "PENDING") ?? active[0]
        if (usable) setSelectedBillingMethodId(usable.id)
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
    choice:
      existingSubType === "yearly"
        ? ("yearly_one_time" as PlanChoice)
        : existingSubType === "monthly"
          ? ((RECURRING_ENABLED
              ? "monthly_recurring"
              : "monthly_one_time") as PlanChoice)
          : undefined,
    agreement: false,
  }

  // 가입 결과 토스트/검증 메시지는 payment-method 화면과 동일 문구라 같은 네임스페이스를 공유한다.
  const tPm = useTranslations("mypage.membershipPaymentMethod")
  const t = useTranslations("mypage.membershipSubscribeForm")
  const subscriptionSchema = useMemo(
    () =>
      buildSubscriptionSchema({
        selectType: tPm("selectSubscriptionType"),
        agreeTerms: tPm("agreeTermsRequired"),
      }),
    [tPm]
  )

  const form = useForm<SubscriptionFormValues>({
    mode: "onChange",
    resolver: zodResolver(subscriptionSchema),
    defaultValues: formDefaultValues,
  })

  const [isSubmitting, startTransition] = useTransition()
  const planSectionRef = useRef<HTMLElement>(null)
  const agreementSectionRef = useRef<HTMLDivElement>(null)

  // 버튼 문구로 미충족을 알리는 대신, 제출 시 해당 항목으로 스크롤한다.
  function onInvalid(errors: Record<string, unknown>) {
    const target = errors.choice
      ? planSectionRef.current
      : agreementSectionRef.current
    target?.scrollIntoView({ behavior: "smooth", block: "center" })
  }

  function onSubmit(data: SubscriptionFormValues) {
    // 인증 필요한 Server Action 호출은 startTransition 안에서 실행해야
    // catch에서 re-throw한 UNAUTHORIZED가 error.tsx로 전파돼 토큰 복구가 동작한다.
    startTransition(async () => {
      try {
        if (!user) {
          toast.error(tPm("loginRequired"))
          return
        }
        if (!data.choice) {
          toast.error(tPm("selectSubscriptionType"))
          return
        }

        const selectedPlanId =
          data.choice === "yearly_one_time"
            ? yearlyPlan.plan.id
            : monthlyPlan.plan.id

        const billingMode =
          data.choice === "monthly_recurring" ? "recurring" : "one_time"
        // 등록된 수단은 정기결제에서만 쓴다. 1회결제는 항상 새 결제창으로 간다.
        const methodId =
          billingMode === "recurring" ? selectedBillingMethodId : null

        if (methodId) {
          const attemptId = crypto.randomUUID()
          const res = await subscribeWithBillingMethod(
            selectedPlanId,
            methodId,
            billingMode,
            attemptId
          )
          if (billingMode === "recurring") {
            // 재가입자는 backend가 무료체험을 제거하므로 실제 적용된 일수로 안내한다.
            const appliedTrialDays = res.effectiveTrialDays ?? 0
            toast.success(
              appliedTrialDays > 0
                ? tPm("trialStartedSuccess", { days: appliedTrialDays })
                : tPm("recurringStartedSuccess")
            )
          } else {
            toast.success(tPm("membershipJoinedSuccess"))
          }
          router.push(`/${countryCode}/mypage/membership/subscribe/success`)
        } else {
          // 신규 결제수단: 정기결제는 자동이체 등록(wallet-web) 후 자동 가입, 한번만결제는 wallet-web으로 바로 이동
          if (billingMode === "recurring") {
            // 최초 정기결제 가입: 빈 결제수단 목록 페이지를 거치지 않고 자동이체 등록 화면(wallet-web)으로
            // 바로 보낸다. 등록을 마치면 결제수단 페이지로 복귀(cardChanged=1)하면서 방금 등록한 수단으로
            // 정기결제 가입이 자동 완료된다(payment-method/content.tsx 의 autoSubscribeOnLoad).
            const returnUrl = `${window.location.origin}/${countryCode}/mypage/membership/payment-method?redirect=subscribe&planId=${selectedPlanId}`
            const walletWebUrl =
              process.env.NEXT_PUBLIC_WALLET_WEB_URL || "http://localhost:3200"
            window.location.href = `${walletWebUrl}/billing-change?returnUrl=${encodeURIComponent(
              returnUrl
            )}`
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
        if (
          err?.digest === "UNAUTHORIZED" ||
          err?.message === "UNAUTHORIZED" ||
          err?.status === 401
        ) {
          throw error
        }
        if (error instanceof HttpApiError) {
          toast.error(error.message)
        } else {
          toast.error(
            error instanceof Error ? error.message : tPm("membershipJoinFailed")
          )
        }
        console.error(error)
      }
    })
  }

  const discountCount = discountBenefits.length
  const invoiceBillingEnabled = isInvoiceBillingEnabled()
  const hasPendingMethods = cmsBillingStatuses.some(
    (s) => s.cmsMemberStatus === "PENDING"
  )
  // 선적용(인보이스 경로)이 켜지면 심사 중 계좌도 가입 가능 — PENDING 이 제출을 막지 않는다.
  const pendingBlocksSubmit = hasPendingMethods && !invoiceBillingEnabled

  const choice = form.watch("choice")
  const subscriptionType: SubscriptionType = !choice
    ? null
    : choice === "yearly_one_time"
      ? "yearly"
      : "monthly"
  const billingMode: "recurring" | "one_time" =
    choice === "monthly_recurring" ? "recurring" : "one_time"

  // 무료체험은 정기결제(recurring)일 때만, 선택한 플랜의 trialDays 기준으로 안내한다.
  // (availableBenefits는 현재 비어 전달되므로 trialBenefits는 0이고, 플랜 trialDays가 실제 기준)
  // 재가입자는 서버가 무료체험을 제거하므로 실제 적용 일수는 가입 응답 effectiveTrialDays로 확정된다.
  const monthlyTrialDays =
    (monthlyPlan?.plan?.trialDays ?? 0) +
    trialBenefits.reduce((acc, cur) => acc + cur.days, 0)
  const totalTrialDays = billingMode === "recurring" ? monthlyTrialDays : 0

  function getSubmitButtonLabel() {
    if (!choice) return t("ctaEmpty")
    if (billingMode === "recurring" && !selectedBillingMethodId) {
      return invoiceBillingEnabled
        ? tPm("registerAndStart")
        : tPm("applyAutoDebitReview")
    }
    if (totalTrialDays > 0)
      return tPm("startWithTrial", { days: totalTrialDays })
    return t("ctaPay", { price: finalPrice.toLocaleString() })
  }
  const hasPrice = choice !== undefined
  // 누르면 이 화면을 떠나는가. 떠나는 경우엔 버튼 밑에 다음 화면을 미리 알린다.
  const nextStepNote = !choice
    ? null
    : billingMode === "recurring" && !selectedBillingMethodId
      ? pendingBlocksSubmit
        ? tPm("recurringAfterReview")
        : t("nextRegister")
      : billingMode === "one_time"
        ? t("nextPay")
        : null
  const planLabel =
    choice === "monthly_recurring"
      ? t("planLabelRecurring")
      : choice === "monthly_one_time"
        ? t("planLabelMonthly")
        : t("planLabelYearly")
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
        onSubmit={form.handleSubmit(onSubmit, onInvalid)}
        className="mx-auto flex max-w-xl flex-col px-4 pt-4 md:px-0"
      >
        {/* 1. 플랜 선택 — 결제방식까지 합친 단일 리스트 */}
        <Section title={t("sectionPlan")} first innerRef={planSectionRef}>
          <FormField
            control={form.control}
            name="choice"
            render={({ field }) => (
              <FormItem className="space-y-3">
                <FormControl>
                  <div className="flex flex-col gap-3">
                    {RECURRING_ENABLED && (
                      <PlanOption
                        selected={field.value === "monthly_recurring"}
                        onSelect={() => field.onChange("monthly_recurring")}
                        title={t("planRecurring")}
                        subNote={
                          monthlyTrialDays > 0
                            ? t("planRecurringTrialDesc", {
                                days: monthlyTrialDays,
                              })
                            : t("planRecurringDesc")
                        }
                        price={`${monthlyPlan.plan.price.toLocaleString()}원`}
                        unit={t("unitMonth")}
                        badge={t("badgeRecommend")}
                        badgeTone="emerald"
                        note={
                          invoiceBillingEnabled
                            ? t("noteRecurringInvoice")
                            : t("noteRecurringCms")
                        }
                      />
                    )}
                    <PlanOption
                      selected={field.value === "monthly_one_time"}
                      onSelect={() => field.onChange("monthly_one_time")}
                      title={t("planMonthlyOnce")}
                      subNote={t("planMonthlyOnceDesc")}
                      price={`${monthlyPlan.plan.price.toLocaleString()}원`}
                      unit={t("unitOnce")}
                    />
                    <PlanOption
                      selected={field.value === "yearly_one_time"}
                      onSelect={() => field.onChange("yearly_one_time")}
                      title={t("planYearly")}
                      subNote={t("planYearlyDesc", {
                        price: yearlyMonthly.toLocaleString(),
                      })}
                      price={`${yearlyPlan.plan.price.toLocaleString()}원`}
                      unit={t("unitYear")}
                      badge={t("badgeTwoMonthsFree")}
                    />
                  </div>
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </Section>

        {/* 할인/무료기간 혜택 — 있을 때만 */}
        {(trialBenefits.length !== 0 || discountCount != 0) && (
          <Section title={t("sectionBenefit")}>
            {trialBenefits.length !== 0 && (
              <>
                <h3 className="text-foreground mb-2 text-base font-bold">
                  {t("benefitFreePeriod")}
                </h3>
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
                      {t("benefitTotalDays", { days: totalTrialDays })}
                    </p>
                  </div>
                </div>
              </>
            )}

            {discountCount != 0 && (
              <>
                <h3 className="mt-4 mb-2 text-lg font-bold">
                  {t("benefitDiscountTitle")}
                </h3>
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
                                "border-border hover:bg-muted active:bg-secondary flex w-full cursor-pointer items-center justify-between rounded-md border-2 p-3 transition-colors",
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
                                    {t("benefitDiscountDesc", {
                                      months: discountBenefit.maxUses,
                                      percent: discountBenefit.percentage,
                                    })}
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
          </Section>
        )}

        {/* 4. 결제 금액 — 요약 한 줄이 아니라 내역. 헤더의 큰 숫자와 중복되지 않게. */}
        <Section title={t("sectionAmount")}>
          {hasPrice ? (
            <div className="space-y-2.5">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">{planLabel}</span>
                <span className="text-foreground">
                  {firstPrice.toLocaleString()}원
                </span>
              </div>
              {selectedDiscount && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">
                    {selectedDiscount.title}
                  </span>
                  <span className="text-primary">
                    -{(firstPrice - discountPrice).toLocaleString()}원
                  </span>
                </div>
              )}
              {billingMode === "recurring" && (
                <BillingMethodRow
                  methods={billingMethods}
                  selectedId={selectedBillingMethodId}
                  onSelect={setSelectedBillingMethodId}
                  invoiceBillingEnabled={invoiceBillingEnabled}
                />
              )}
              <div className="border-border flex items-baseline justify-between border-t pt-3">
                <span className="text-foreground text-[15px] font-bold">
                  {t("amountTotal")}
                </span>
                <span className="text-foreground text-xl font-bold">
                  {finalPrice.toLocaleString()}원
                </span>
              </div>
              {billingMode === "recurring" && (
                <p className="text-muted-foreground text-xs">
                  {totalTrialDays > 0
                    ? t("amountRecurringTrialNote", { days: totalTrialDays })
                    : t("amountRecurringNote")}
                </p>
              )}
              {selectedDiscount && (
                <p className="text-muted-foreground text-xs">
                  {t("amountAfterDiscount", {
                    price: firstPrice.toLocaleString(),
                  })}
                </p>
              )}
            </div>
          ) : (
            <p className="text-muted-foreground text-sm">{t("amountEmpty")}</p>
          )}
        </Section>

        {/* 안내 + 동의 — 제목 없이 CTA 바로 위에 붙인다 */}
        <div className="border-muted md:border-border -mx-4 space-y-3 border-t-8 px-4 py-6 md:mx-0 md:border-t md:px-0">
          <PaymentNoticeSheet
            billingMode={billingMode}
            subscriptionType={subscriptionType}
            invoiceBillingEnabled={invoiceBillingEnabled}
            bankTransferDelay={tPm("bankTransferDelay")}
          />
          <div ref={agreementSectionRef}>
            <FormField
              control={form.control}
              name="agreement"
              render={({ field }) => (
                <AgreementRow
                  value={field.value}
                  onChange={field.onChange}
                  monthlyPrice={monthlyPlan.plan.price}
                  yearlyPrice={yearlyPlan.plan.price}
                  billingMode={billingMode}
                />
              )}
            />
          </div>
        </div>

        {/* 결제 버튼 — 하단 고정. 이 경로에서는 bottom-nav 가 스스로 숨는다(bottom-nav.tsx) */}
        <div className="border-border bg-background sticky bottom-0 z-40 -mx-4 mt-1 border-t px-4 pt-3 pb-[max(12px,env(safe-area-inset-bottom))] md:mx-0 md:border-0 md:px-0">
          <Button
            className="h-[52px] w-full rounded-xl text-base font-bold"
            disabled={
              isSubmitting ||
              (billingMode === "recurring" &&
                !selectedBillingMethodId &&
                pendingBlocksSubmit)
            }
            type="submit"
          >
            {isSubmitting ? (
              <span className="flex items-center gap-2">
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                {t("ctaProcessing")}
              </span>
            ) : (
              getSubmitButtonLabel()
            )}
          </Button>
          {nextStepNote && (
            <p className="text-muted-foreground mt-2 text-center text-xs">
              {nextStepNote}
            </p>
          )}
        </div>
      </form>
    </Form>
  )
}

// 결제수단은 「고르는 화면」이 아니라 결제 금액의 한 줄이다. 대부분은 계좌가 하나뿐이라
// 고를 일이 없는데, 섹션으로 두면 플랜을 탭할 때마다 블록이 끼어들어 아래가 밀렸다.
function BillingMethodRow({
  methods,
  selectedId,
  onSelect,
  invoiceBillingEnabled,
}: {
  methods: BillingMethodDto[]
  selectedId: string | null
  onSelect: (id: string | null) => void
  invoiceBillingEnabled: boolean
}) {
  const t = useTranslations("mypage.membershipSubscribeForm")
  const [open, setOpen] = useState(false)
  const selected = methods.find((m) => m.id === selectedId)
  const newMethodLabel = invoiceBillingEnabled
    ? t("methodNew")
    : t("methodNewReview")

  return (
    <>
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="text-muted-foreground shrink-0">{t("rowMethod")}</span>
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="text-foreground truncate">
            {selected
              ? (selected.displayName ?? t("methodFallback"))
              : newMethodLabel}
          </span>
          {selected?.cmsMemberStatus === "PENDING" && (
            <span className="bg-secondary text-muted-foreground shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium">
              {t("methodPendingBadge")}
            </span>
          )}
          {methods.length > 0 && (
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="text-muted-foreground hover:text-foreground active:bg-secondary -mr-1 flex shrink-0 cursor-pointer items-center rounded px-1 py-0.5 text-xs font-medium transition-colors"
            >
              {t("methodChange")}
              <ChevronRight className="size-3.5" />
            </button>
          )}
        </div>
      </div>

      <Drawer open={open} onOpenChange={setOpen}>
        <DrawerContent className="max-h-[85vh]">
          <DrawerHeader className="text-left">
            <DrawerTitle className="text-foreground text-lg font-bold">
              {t("sheetMethodTitle")}
            </DrawerTitle>
          </DrawerHeader>
          <div className="space-y-2 overflow-y-auto px-6 pb-[max(24px,env(safe-area-inset-bottom))]">
            {methods.map((method) => (
              <MethodPickerRow
                key={method.id}
                selected={selectedId === method.id}
                onSelect={() => {
                  onSelect(method.id)
                  setOpen(false)
                }}
                title={method.displayName ?? t("methodFallback")}
                caption={providerLabel(method.providerType)}
                note={
                  method.cmsMemberStatus === "PENDING"
                    ? t("methodPendingNote")
                    : undefined
                }
              />
            ))}
            <MethodPickerRow
              selected={selectedId === null}
              onSelect={() => {
                onSelect(null)
                setOpen(false)
              }}
              title={newMethodLabel}
              note={t("methodNewNote")}
            />
          </div>
        </DrawerContent>
      </Drawer>
    </>
  )
}

function MethodPickerRow({
  selected,
  onSelect,
  title,
  caption,
  note,
}: {
  selected: boolean
  onSelect: () => void
  title: string
  caption?: string
  note?: string
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "active:bg-secondary flex w-full cursor-pointer items-center gap-3 rounded-lg border-2 p-3 text-left transition-colors",
        selected ? "border-primary" : "border-border hover:bg-muted"
      )}
    >
      <CreditCard className="text-muted-foreground h-5 w-5 shrink-0" />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p className="text-sm font-semibold">{title}</p>
        {caption && (
          <span className="bg-secondary text-muted-foreground w-fit rounded px-1.5 py-0.5 text-[10px] font-medium">
            {caption}
          </span>
        )}
        {note && <span className="text-muted-foreground text-xs">{note}</span>}
      </div>
      {selected && (
        <Check className="text-primary size-5 shrink-0" strokeWidth={3} />
      )}
    </button>
  )
}

// 결제 전 고지는 전부 여기로 모은다. 본문에 경고 박스 둘과 <details> 를 나란히 쌓으면
// 셋 다 같은 무게로 보여서 결국 아무것도 안 읽힌다.
function PaymentNoticeSheet({
  billingMode,
  subscriptionType,
  invoiceBillingEnabled,
  bankTransferDelay,
}: {
  billingMode: "recurring" | "one_time"
  subscriptionType: SubscriptionType
  invoiceBillingEnabled: boolean
  bankTransferDelay: string
}) {
  const t = useTranslations("mypage.membershipSubscribeForm")
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="hover:bg-muted active:bg-secondary -mx-2 flex w-[calc(100%+16px)] items-center gap-2.5 rounded-lg px-2 py-3 text-left transition-colors"
      >
        <Info className="text-muted-foreground size-[18px] shrink-0" />
        <span className="text-foreground flex-1 text-sm font-medium">
          {t("noticeTrigger")}
        </span>
        <ChevronRight className="text-muted-foreground size-[18px] shrink-0" />
      </button>

      <Drawer open={open} onOpenChange={setOpen}>
        <DrawerContent className="max-h-[85vh]">
          <DrawerHeader className="text-left">
            <DrawerTitle className="text-foreground text-lg font-bold">
              {t("noticeTrigger")}
            </DrawerTitle>
          </DrawerHeader>

          <PaymentNoticeBody
            billingMode={billingMode}
            subscriptionType={subscriptionType}
            invoiceBillingEnabled={invoiceBillingEnabled}
            bankTransferDelay={bankTransferDelay}
          />

          <DrawerFooter className="px-6 pt-0 pb-[max(1rem,env(safe-area-inset-bottom))]">
            <Button
              type="button"
              variant="outline"
              className="h-12 w-full"
              onClick={() => setOpen(false)}
            >
              확인
            </Button>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>
    </>
  )
}

// 결제·환불·청약철회 고지 «본문». 시트 껍데기와 분리해 문구를 한 벌만 둔다.
export function PaymentNoticeBody({
  billingMode,
  subscriptionType,
  invoiceBillingEnabled,
  bankTransferDelay,
}: {
  billingMode: "recurring" | "one_time"
  subscriptionType: SubscriptionType
  invoiceBillingEnabled: boolean
  bankTransferDelay: string
}) {
  const t = useTranslations("mypage.membershipSubscribeForm")
  // 고지 문구 안의 강조는 <b>…</b> 로 메시지에 들어 있다 (CLAUDE.md §11 리치 텍스트).
  const b = (chunks: React.ReactNode) => (
    <span className="text-foreground font-medium">{chunks}</span>
  )

  return (
    <div className="text-muted-foreground space-y-5 overflow-y-auto px-6 pb-8 text-sm">
      <NoticeSection title={t("noticeWithdrawTitle")}>
        <p>
          {t.rich("noticeWithdrawBody", { b })}
          {subscriptionType === "yearly" && (
            <> {t("noticeWithdrawYearlySuffix")}</>
          )}
        </p>
      </NoticeSection>

      {billingMode === "one_time" && (
        <NoticeSection title={t("noticeBankTitle")}>
          <p>{bankTransferDelay}</p>
        </NoticeSection>
      )}

      {billingMode === "recurring" && (
        <NoticeSection title={t("noticeMandateTitle")}>
          <p>
            {invoiceBillingEnabled
              ? t("noticeMandateInvoice")
              : t.rich("noticeMandateCms", { b })}
          </p>
        </NoticeSection>
      )}

      <NoticeSection title={t("noticeRefundTitle")}>
        <ul className="list-disc space-y-2 pl-4">
          {billingMode === "recurring" ? (
            <>
              <li>{t("refundRecurring1")}</li>
              <li>{t.rich("refundRecurring2", { b })}</li>
              <li>{t("refundRecurring3")}</li>
            </>
          ) : subscriptionType === "yearly" ? (
            <>
              <li>{t("refundOnce1")}</li>
              <li>{t.rich("refundOnce2", { b })}</li>
              <li>{t.rich("refundYearly1", { b })}</li>
              <li>{t("refundYearly2")}</li>
            </>
          ) : (
            <>
              <li>{t("refundOnce1")}</li>
              <li>{t.rich("refundOnce2", { b })}</li>
              <li>{t("refundOnce3")}</li>
            </>
          )}
          <li>{t("refundCommon")}</li>
        </ul>
      </NoticeSection>
    </div>
  )
}

function NoticeSection({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <section>
      <h4 className="text-foreground mb-1.5 text-[13px] font-bold">{title}</h4>
      <div className="leading-relaxed">{children}</div>
    </section>
  )
}

// 토스식 섹션 구분 — 카드 테두리 대신 모바일은 8px 회색 밴드, 데스크톱은 얇은 선.
// 카드로 감싸면 5개 블록이 전부 같은 무게로 보여서 정보 계층이 사라진다.
function Section({
  title,
  first,
  innerRef,
  children,
}: {
  title: string
  first?: boolean
  innerRef?: React.Ref<HTMLElement>
  children: React.ReactNode
}) {
  return (
    <section
      ref={innerRef}
      className={cn(
        "-mx-4 px-4 py-6 md:mx-0 md:px-0",
        first ? "pt-2" : "border-muted md:border-border border-t-8 md:border-t"
      )}
    >
      <h2 className="text-foreground mb-3 text-[17px] font-bold">{title}</h2>
      {children}
    </section>
  )
}

interface PlanOptionProps {
  selected: boolean
  onSelect: () => void
  title: string
  price: string
  unit: string
  badge?: string
  badgeTone?: "primary" | "emerald"
  subNote?: string
  /** 고른 뒤에만 칸 안에 붙는 주의사항. 목록 밖에 두면 검증 에러처럼 읽힌다. */
  note?: string
}

function PlanOption({
  selected,
  onSelect,
  title,
  price,
  unit,
  badge,
  badgeTone = "primary",
  subNote,
  note,
}: PlanOptionProps) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "active:bg-secondary w-full cursor-pointer rounded-lg border-2 p-4 text-left transition-colors",
        selected ? "border-primary" : "border-border hover:bg-muted"
      )}
    >
      <div className="flex items-center gap-3">
        <span
          className={cn(
            "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2",
            selected ? "border-primary bg-primary text-white" : "border-border"
          )}
        >
          {selected && <Check className="h-3 w-3" strokeWidth={3} />}
        </span>
        <div className="flex flex-1 flex-col">
          <div className="flex items-center gap-2">
            <p className="text-base font-bold">{title}</p>
            {badge && (
              <Badge
                className={cn(
                  "text-white",
                  badgeTone === "emerald" ? "bg-emerald-500" : "bg-primary"
                )}
              >
                {badge}
              </Badge>
            )}
          </div>
          {subNote && (
            <p className="text-muted-foreground text-xs">{subNote}</p>
          )}
        </div>
        <div className="text-right">
          <p className="text-base font-bold">{price}</p>
          <p className="text-muted-foreground text-xs">{unit}</p>
        </div>
      </div>
      {selected && note && (
        <p className="border-border text-muted-foreground mt-3 border-t pt-2.5 text-xs leading-relaxed">
          {note}
        </p>
      )}
    </button>
  )
}

interface AgreementRowProps {
  value: boolean
  onChange: (checked: boolean) => void
  monthlyPrice: number
  yearlyPrice: number
  billingMode: "recurring" | "one_time"
}

const AgreementRow: React.FC<AgreementRowProps> = ({
  value,
  onChange,
  monthlyPrice,
  yearlyPrice,
  billingMode,
}) => {
  const t = useTranslations("mypage.membershipSubscribeForm")
  const [isDialogOpen, setIsDialogOpen] = useState(false)

  return (
    <FormItem className="space-y-1.5">
      <div className="border-border flex flex-row items-center gap-2.5 rounded-lg border p-3.5">
        <FormControl>
          <Checkbox
            id="agreement"
            checked={value}
            onCheckedChange={(checked) => onChange(checked === true)}
          />
        </FormControl>
        <Label
          htmlFor="agreement"
          className="text-foreground flex-1 cursor-pointer text-sm leading-snug font-normal"
        >
          {t("agree")}
        </Label>
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault()
            setIsDialogOpen(true)
          }}
          className="text-primary shrink-0 text-xs font-semibold whitespace-nowrap underline underline-offset-2"
        >
          {t("agreeView")}
        </button>
      </div>
      <FormMessage />

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="gap-0 overflow-hidden rounded-3xl p-0 sm:max-w-md">
          <DialogHeader className="space-y-1 px-6 pt-6 pb-4 text-left">
            <DialogTitle className="text-foreground text-lg font-bold">
              {t("termsTitle")}
            </DialogTitle>
            <DialogDescription className="text-muted-foreground text-[13px]">
              {t("termsDesc")}
            </DialogDescription>
          </DialogHeader>
          <div className="border-border bg-muted max-h-[58vh] overflow-y-auto border-y px-6 py-5">
            <TermsAndConditions
              monthlyPrice={monthlyPrice}
              yearlyPrice={yearlyPrice}
              billingMode={billingMode}
            />
          </div>
          <DialogFooter className="p-4">
            <Button
              className="h-[52px] w-full rounded-xl text-base font-bold"
              onClick={() => {
                onChange(true)
                setIsDialogOpen(false)
              }}
            >
              {t("agreeConfirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </FormItem>
  )
}
