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
  FormLabel,
  FormMessage,
} from "@/components/ui/form"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table"
import { zodResolver } from "@hookform/resolvers/zod"
import { HttpApiError } from "@lib/api/api-error"
import { getBillingMethods } from "@lib/api/wallet"
import { subscribeWithBillingMethod, createMembershipCheckoutIntent } from "@lib/api/membership"
import { setPendingPaymentMode } from "@lib/utils/checkout-intent-map"
import { cn } from "@lib/utils"
import { providerLabel } from "@lib/utils/billing-provider"
import { useUser } from "@/contexts/user-context"
import type { BillingMethodDto } from "@lib/types/dto/wallet"
import { Calendar, CreditCard, Gift } from "lucide-react"
import { useParams, useRouter } from "next/navigation"
import React, { useEffect, useState } from "react"
import { useForm } from "react-hook-form"
import { toast } from "sonner"
import { z } from "zod"

// 순수 UI용 타입 정의
type SubscriptionType = "monthly" | "yearly" | null

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
  billingMode: z.enum(["recurring", "one_time"]).default("recurring"),
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
  const [selectedBillingMethodId, setSelectedBillingMethodId] = useState<string | null>(null)
  const [policyAgreed, setPolicyAgreed] = useState(false)

  useEffect(() => {
    getBillingMethods()
      .then((methods) => setBillingMethods(methods.filter((m) => m.status === "ACTIVE")))
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
    billingMode: "recurring" as const,
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
        await subscribeWithBillingMethod(selectedPlanId, selectedBillingMethodId, billingMode)
        if (billingMode === "recurring") {
          toast.success("7일 무료 체험이 시작되었습니다! 체험 종료 후 자동으로 결제됩니다.")
        } else {
          toast.success("멤버십 가입이 완료되었습니다.")
        }
        router.push(`/${countryCode}/mypage/membership/subscribe/success`)
      } else {
        // 신규 카드: 정기결제는 카드 먼저 등록 필요, 한번만결제는 wallet-web으로 바로 이동
        if (billingMode === "recurring") {
          toast.info("정기결제 무료체험을 시작하려면 먼저 카드를 등록해주세요.")
          router.push(`/${countryCode}/mypage/membership/payment-method?redirect=subscribe&planId=${selectedPlanId}&billingMode=recurring`)
        } else {
          if (!policyAgreed) {
            toast.error("결제 및 환불 정책에 동의해주세요.")
            return
          }
          const returnUrl = `${window.location.origin}/${countryCode}/checkout/callback`
          const { intentId } = await createMembershipCheckoutIntent(selectedPlanId, returnUrl, "one_time")
          setPendingPaymentMode("membership", { planId: selectedPlanId, billingMode: "one_time" })
          const walletWebUrl = process.env.NEXT_PUBLIC_WALLET_WEB_URL || "http://localhost:3200"
          window.location.href = `${walletWebUrl}/pay/${intentId}`
        }
      }
    } catch (error) {
      if (error instanceof HttpApiError) {
        toast.error(error.message)
      } else {
        toast.error(error instanceof Error ? error.message : "멤버십 등록에 실패했습니다.")
      }
      console.error(error)
    }
  }

  const totalTrialDays = trialBenefits.reduce((acc, cur) => acc + cur.days, 0)
  const discountCount = discountBenefits.length

  const billingMode = form.watch("billingMode")

  useEffect(() => {
    setPolicyAgreed(false)
  }, [billingMode])

  function getSubmitButtonLabel() {
    if (!form.watch("agreement")) return "약관에 동의해주세요"
    if (billingMode === "one_time" && !policyAgreed) return "결제 및 환불 정책에 동의해주세요"
    if (selectedBillingMethodId) {
      return billingMode === "recurring" ? "7일 무료체험 시작하기" : "이 카드로 구독하기"
    }
    return billingMode === "recurring" ? "카드 등록 후 무료체험 시작하기" : "새 카드로 결제하기"
  }
  const hasPrice =
    form.watch("subscriptionType") == "monthly" ||
    form.watch("subscriptionType") == "yearly"
  const subscriptionType = form.watch("subscriptionType")
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

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        className="grid grid-cols-1 gap-4"
      >
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>구독 유형</CardTitle>
            </CardHeader>

            <CardContent className="space-y-4">
              <FormField
                control={form.control}
                name="subscriptionType"
                render={({ field }) => (
                  <FormItem className="space-y-3">
                    <FormControl>
                      <RadioGroup
                        onValueChange={field.onChange}
                        defaultValue={field.value}
                        className="flex flex-col"
                      >
                        <FormItem className="flex flex-col items-center">
                          <FormControl>
                            <Label
                              htmlFor="monthly"
                              className="bg-popover hover:bg-accent hover:text-accent-foreground has-checked:border-primary flex w-full items-center justify-between rounded-md border-2 p-3"
                            >
                              <RadioGroupItem
                                hidden
                                id="monthly"
                                value="monthly"
                              />
                              <div className="flex flex-row items-center gap-2">
                                <div className="flex flex-row items-center gap-4">
                                  <Calendar className="h-5 w-5" />
                                  <div className="flex flex-col">
                                    <p className="text-base font-bold">
                                      월간 구독
                                    </p>
                                    <p className="text-muted-foreground text-sm">
                                      {monthlyPlan.plan.price.toLocaleString()}
                                      원 / 월
                                    </p>
                                  </div>
                                </div>
                              </div>
                            </Label>
                          </FormControl>

                          <FormControl>
                            <Label
                              htmlFor="yearly"
                              className="bg-popover hover:bg-accent hover:text-accent-foreground has-checked:border-primary flex w-full items-center justify-between rounded-md border-2 p-3"
                            >
                              <RadioGroupItem
                                hidden
                                id="yearly"
                                value="yearly"
                              />
                              <div className="flex w-full flex-row items-center justify-between gap-2">
                                <div className="flex flex-row items-center gap-4">
                                  <Calendar className="h-5 w-5" />
                                  <div className="flex flex-col">
                                    <p className="text-base font-bold">
                                      연간 구독
                                    </p>
                                    <p className="text-muted-foreground text-sm">
                                      {yearlyPlan.plan.price.toLocaleString()}원
                                      / 연
                                    </p>
                                  </div>
                                </div>

                                <Badge>2달 무료</Badge>
                              </div>
                            </Label>
                          </FormControl>
                        </FormItem>
                      </RadioGroup>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="agreement"
                render={({ field }) => (
                  <AgreementCheckbox
                    value={field.value}
                    onChange={field.onChange}
                    monthlyPrice={monthlyPlan.plan.price}
                    yearlyPrice={yearlyPlan.plan.price}
                  />
                )}
              />
            </CardContent>
          </Card>

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
                      <RadioGroup
                        onValueChange={field.onChange}
                        defaultValue={field.value}
                        className="flex flex-col gap-2"
                      >
                        <Label
                          htmlFor="recurring"
                          className="bg-popover hover:bg-accent has-checked:border-primary flex cursor-pointer flex-col rounded-md border-2 p-3"
                        >
                          <div className="flex items-center gap-3">
                            <RadioGroupItem hidden id="recurring" value="recurring" />
                            <Gift className="h-5 w-5 shrink-0 text-emerald-500" />
                            <div className="flex flex-col">
                              <p className="text-sm font-bold">정기결제 (자동갱신)</p>
                              <p className="text-muted-foreground text-xs">
                                7일 무료 체험 후 등록하신 카드로 자동 결제
                              </p>
                            </div>
                            <Badge className="ml-auto shrink-0 bg-emerald-500 text-white">추천</Badge>
                          </div>
                        </Label>
                        <Label
                          htmlFor="one_time"
                          className="bg-popover hover:bg-accent has-checked:border-primary flex cursor-pointer flex-col rounded-md border-2 p-3"
                        >
                          <div className="flex items-center gap-3">
                            <RadioGroupItem hidden id="one_time" value="one_time" />
                            <Calendar className="h-5 w-5 shrink-0 text-gray-500" />
                            <div className="flex flex-col">
                              <p className="text-sm font-bold">한번만 결제</p>
                              <p className="text-muted-foreground text-xs">
                                결제 즉시 구독 시작, 자동갱신 없음
                              </p>
                            </div>
                          </div>
                        </Label>
                      </RadioGroup>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>

          {/* 결제 안내 */}
          <Card>
            <CardHeader>
              <CardTitle>결제 안내</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {billingMode === "one_time" ? (
                <div className="space-y-2 text-sm text-gray-600">
                  <p className="font-medium text-gray-800">📌 1회 결제 (자동결제 없음)</p>
                  <ul className="ml-4 list-disc space-y-1 text-gray-600">
                    <li>1회 결제로, 자동결제는 진행되지 않습니다.</li>
                    <li>결제 즉시 이용이 시작되며, <span className="font-medium text-gray-800">이용 시작 후 환불은 불가</span>합니다.</li>
                    <li>결제한 기간 동안 서비스 이용이 가능합니다.</li>
                  </ul>
                </div>
              ) : (
                <div className="space-y-2 text-sm text-gray-600">
                  <p className="font-medium text-gray-800">🔄 정기결제 (매월 자동갱신)</p>
                  <ul className="ml-4 list-disc space-y-1 text-gray-600">
                    <li>매월 같은 날 자동으로 결제됩니다.</li>
                    <li>언제든지 <span className="font-medium text-gray-800">다음 결제일 전</span>에 해지할 수 있습니다.</li>
                    <li>해지 시 남은 기간은 그대로 이용 가능합니다.</li>
                    <li><span className="font-medium text-gray-800">이용 시작 후 환불은 불가</span>합니다.</li>
                  </ul>
                </div>
              )}

              <div className="rounded-lg bg-gray-50 p-3 text-xs text-gray-500">
                <p className="mb-1 font-semibold text-gray-600">[환불 정책]</p>
                <ul className="space-y-0.5">
                  <li>· 단순 변심에 의한 환불은 불가합니다.</li>
                  <li>· 서비스 장애, 기술적 오류 등으로 정상적인 이용이 어려운 경우, 이용하지 못한 기간에 대해 일부 환불이 진행될 수 있습니다.</li>
                  <li>· 환불 여부 및 금액은 내부 정책에 따라 산정됩니다.</li>
                </ul>
              </div>

              {billingMode === "one_time" && (
                <div className="flex items-start gap-2 pt-1">
                  <Checkbox
                    id="policy-agree"
                    checked={policyAgreed}
                    onCheckedChange={(checked) => setPolicyAgreed(checked === true)}
                    className="mt-0.5"
                  />
                  <Label
                    htmlFor="policy-agree"
                    className="cursor-pointer text-sm leading-snug text-gray-700"
                  >
                    결제 및 환불 정책을 확인하였으며 이에 동의합니다.
                  </Label>
                </div>
              )}
            </CardContent>
          </Card>

          {billingMethods.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>결제 수단</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <p className="text-muted-foreground text-sm">
                  등록된 카드로 바로 결제하거나, 새 카드를 등록할 수 있습니다.
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
                        {method.displayName ?? "등록된 카드"}
                      </p>
                      <span className="w-fit rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-500">
                        {providerLabel(method.providerType)}
                      </span>
                    </div>
                    {selectedBillingMethodId === method.id && (
                      <span className="text-primary text-xs font-semibold">선택됨</span>
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
                    {billingMode === "recurring" ? "새 카드 등록 후 무료체험 시작" : "새 카드로 결제하기"}
                  </p>
                  {selectedBillingMethodId === null && (
                    <span className="text-primary ml-auto text-xs font-semibold">선택됨</span>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {(totalTrialDays !== 0 || discountCount != 0) && (
            <Card>
              <CardHeader>
                <CardTitle>혜택</CardTitle>
              </CardHeader>
              <CardContent>
                {totalTrialDays !== 0 && (
                  <>
                    <h3 className="mb-2 text-lg font-bold">무료 기간</h3>
                    <Table>
                      <TableBody>
                        {trialBenefits.map((trialBenefit) => {
                          return (
                            <TableRow key={trialBenefit.id}>
                              <TableCell className="py-2">
                                {trialBenefit.title}
                              </TableCell>
                              <TableCell className="w-4 py-2 whitespace-nowrap">
                                {trialBenefit.days}일
                              </TableCell>
                            </TableRow>
                          )
                        })}
                      </TableBody>
                    </Table>
                    <div className="border-primary flex w-full items-center justify-between rounded-md border-2 p-3">
                      <div className="flex flex-row items-center gap-2">
                        <div className="flex flex-row items-center gap-4">
                          <Gift className="h-5 w-5" />
                          <div className="flex flex-col">
                            <p className="text-base font-bold">
                              총 {totalTrialDays}일
                            </p>
                          </div>
                        </div>
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
                        <>
                          <FormItem className="space-y-3">
                            <FormControl>
                              <FormItem className="flex flex-col items-center">
                                {discountBenefits.map((discountBenefit) => (
                                  <FormControl key={discountBenefit.id}>
                                    <div
                                      className={cn(
                                        "bg-popover hover:bg-accent hover:text-accent-foregroundx flex w-full items-center justify-between rounded-md border-2 p-3",
                                        field.value === discountBenefit.id &&
                                          "border-primary"
                                      )}
                                      onClick={() => {
                                        if (field.value === discountBenefit.id)
                                          field.onChange(undefined)
                                        else field.onChange(discountBenefit.id)
                                      }}
                                    >
                                      <div className="flex flex-row items-center gap-2">
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
                                    </div>
                                  </FormControl>
                                ))}
                              </FormItem>
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        </>
                      )}
                    />
                  </>
                )}
              </CardContent>
            </Card>
          )}
        </div>

        <div className="bg-card text-card-foreground grid grid-cols-1 items-center gap-4 rounded-lg border p-6 shadow-sm md:grid-cols-2">
          <div className="flex h-full w-full flex-row items-center">
            <div className="flex flex-col">
              {hasPrice ? (
                <>
                  {totalTrialDays != 0 && (
                    <p className="text-sm">{totalTrialDays}일 무료</p>
                  )}
                  <p className="text-lg font-bold">
                    {selectedDiscount ? (
                      <>
                        {discountPrice.toLocaleString()}원{" "}
                        <span className="text-sm">
                          ({selectedDiscount.maxUses}개월간 할인)
                        </span>
                      </>
                    ) : (
                      `${firstPrice.toLocaleString()}원`
                    )}
                  </p>
                  {form.watch("discountBenefitId") != null && (
                    <p className="text-sm">
                      할인 종료 후 {firstPrice.toLocaleString()}원
                    </p>
                  )}
                </>
              ) : (
                <p className="text-lg font-bold">구독 유형을 선택하세요</p>
              )}
            </div>
          </div>

          <div>
            <Button
              className="w-full"
              disabled={
                !form.watch("agreement") ||
                !form.watch("subscriptionType") ||
                form.formState.isSubmitting ||
                (billingMode === "one_time" && !policyAgreed)
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
          </div>
        </div>
      </form>
    </Form>
  )
}

interface AgreementCheckboxProps {
  value: boolean
  onChange: (checked: boolean) => void
  monthlyPrice: number
  yearlyPrice: number
}

const AgreementCheckbox: React.FC<AgreementCheckboxProps> = ({
  value,
  onChange,
  monthlyPrice,
  yearlyPrice,
}) => {
  const [isDialogOpen, setIsDialogOpen] = useState(false)

  const handleCheckboxClick = () => {
    if (!value) {
      // 체크 안 되어 있을 때 모달 열기
      setIsDialogOpen(true)
    } else {
      // 체크되어 있을 때 바로 해제
      onChange(false)
    }
  }
  const handleAgree = () => {
    onChange(true) // 체크 해제
    setIsDialogOpen(false)
  }

  return (
    <>
      <FormItem className="flex flex-row items-start space-y-0 space-x-3 rounded-md border p-4">
        <FormControl>
          <Checkbox checked={value} onCheckedChange={handleCheckboxClick} />
        </FormControl>
        <div className="space-y-1 leading-none">
          <FormLabel>아몬드영 멤버십 이용약관에 동의합니다</FormLabel>
        </div>
      </FormItem>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>아몬드영 멤버십 이용약관</DialogTitle>
            <DialogDescription>
              멤버십 이용약관을 확인하고 동의해주세요.
            </DialogDescription>
          </DialogHeader>
          <div className="h-60 overflow-y-auto border p-4">
            <TermsAndConditions
              monthlyPrice={monthlyPrice}
              yearlyPrice={yearlyPrice}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
              동의하지 않음
            </Button>
            <Button onClick={handleAgree}>동의함</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
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
    <div className="space-y-4 text-sm">
      <div>
        <h1 className="mb-2 text-xl font-bold">
          정기 자동 결제 및 이용 약관 동의서
        </h1>
        <p>
          본 동의서는 귀하의 정기 결제 서비스 이용과 관련하여 법적 보호 및
          명확한 이용 조건을 제공하기 위해 작성되었습니다.
        </p>
      </div>

      <div>
        <h2 className="mb-2 text-lg font-bold">결제 목적 및 내용</h2>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            본 서비스는 매월 정기적인 금액 결제를 통해 서비스 구독 및 제공을
            목적으로 합니다.
          </li>
          <li>신용카드 결제를 통해 진행됩니다.</li>
        </ul>
      </div>

      <div>
        <h2 className="mb-2 text-lg font-bold">결제 주기 및 금액</h2>
        <ul className="list-disc space-y-1 pl-5">
          <li>결제 주기: 매월 또는 매년 구독 기간이 하루 남았을 때 1회</li>
          <li>
            결제 금액: 매월 {monthlyPrice.toLocaleString()}원 또는 매년{" "}
            {yearlyPrice.toLocaleString()}원
          </li>
          <li>결제 금액은 동의 없이 변경되지 않습니다.</li>
        </ul>
      </div>

      <div>
        <h2 className="mb-2 text-lg font-bold">결제 정보 수집 항목</h2>
        <ul className="list-disc space-y-1 pl-5">
          <li>결제자 정보: 이름, 연락처, 생년월일</li>
          <li>결제 수단 정보: 카드번호, 유효기간, 비밀번호 앞 2자리</li>
        </ul>
      </div>

      <div>
        <h2 className="mb-2 text-lg font-bold">동의 철회 및 변경</h2>
        <ul className="list-disc space-y-1 pl-5">
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
        <h2 className="mb-2 text-lg font-bold">유의사항</h2>
        <ul className="list-disc space-y-1 pl-5">
          <li>결제 실패 시 서비스 이용이 제한될 수 있습니다.</li>
          <li>
            사전 고지 없이 결제 수단이 유효하지 않을 경우, 결제 처리가 진행되지
            않을 수 있습니다.
          </li>
        </ul>
      </div>

      <div>
        <h2 className="mb-2 text-lg font-bold">환불 정책</h2>

        <h3 className="mt-3 mb-1 text-base font-bold">제 1조 목적</h3>
        <p>
          본 약관은 아몬드영 멤버십 서비스(이하 "서비스")를 이용함에 있어 회원과
          회사 간의 권리·의무 및 책임 사항을 규정함을 목적으로 합니다.
        </p>

        <h3 className="mt-3 mb-1 text-base font-bold">제 2조 환불 불가 정책</h3>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            본 서비스는 구독형 서비스로, 서비스 제공이 개시된 이후에는 환불이
            불가능합니다.
          </li>
          <li>
            회원은 결제일로부터 7일 이내에 서비스가 제공되지 않은 경우에 한해
            결제를 취소할 수 있습니다.
          </li>
          <li>
            구독은 매월 또는 매년 자동 갱신되며, 회원이 해지를 요청하지 않는 한
            갱신된 결제 건에 대해 환불이 제공되지 않습니다.
          </li>
        </ul>

        <h3 className="mt-3 mb-1 text-base font-bold">
          제 3조 구독 해지 및 갱신
        </h3>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            회원은 언제든지 구독을 해지할 수 있으며, 해지 요청은 다음 결제일
            전에 완료되어야 합니다.
          </li>
          <li>
            해지 요청이 이루어지지 않은 경우, 서비스는 자동으로 갱신되며 결제가
            처리됩니다.
          </li>
        </ul>

        <h3 className="mt-3 mb-1 text-base font-bold">제 4조 회원의 동의</h3>
        <ul className="list-disc space-y-1 pl-5">
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
