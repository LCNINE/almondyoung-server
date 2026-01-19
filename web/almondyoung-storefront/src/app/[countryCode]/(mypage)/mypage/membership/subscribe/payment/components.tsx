"use client"

import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from "@/components/ui/dialog"
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import {
  Table,
  TableBody,
  TableCell,
  TableRow,
} from "@/components/ui/table"
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs"
import { zodResolver } from "@hookform/resolvers/zod"
import { HttpApiError } from "@lib/api/api-error"
import { cn } from "@lib/utils"
import { useUser } from "@/contexts/user-context"
import { Calendar, CreditCard, Gift, TriangleAlert } from "lucide-react"
import { useRouter } from "next/navigation"
import React, { useState } from "react"
import { useForm } from "react-hook-form"
import { toast } from "sonner"
import { z } from "zod"
import FormattedInput from "./formatted-input"

// 순수 UI용 타입 정의
type SubscriptionType = "inactive" | "monthly" | "yearly" | null
type FmsMember = {
  paymentCompany: string
  paymentCompanyName: string
  paymentNumber: string
  cardLast4: string
  payerName: string
} | null

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

const cardDetailsSchema = z.object({
  phone: z
    .string()
    .min(10, "전화번호는 10-11자리여야 합니다")
    .max(11, "전화번호는 10-11자리여야 합니다")
    .regex(
      /^01[0-9]{8,9}$/,
      "올바른 휴대폰번호 형식이 아닙니다 (예: 01012345678)"
    ),
  payerNumber: z
    .string()
    .max(10, "10자 이내로 입력해주세요")
    .min(6, "6자리 생년월일을 입력해주세요")
    .regex(/^\d+$/, "숫자만 입력해주세요"),
  paymentNumber: z
    .string()
    .max(16, "16자 이내로 입력해주세요")
    .min(1, "카드번호를 입력해주세요")
    .regex(/^\d+$/, "숫자만 입력해주세요"),
  payerName: z
    .string()
    .max(10, "10자 이내로 입력해주세요")
    .min(1, "납부자명을 입력해주세요"),
  validUntil: z
    .string()
    .max(4, "카드 유효기간을 입력해주세요")
    .min(4, "카드 유효기간을 입력해주세요"),
  password: z
    .string()
    .max(2, "비밀번호 앞 2자리를 입력해주세요")
    .min(2, "비밀번호 앞 2자리를 입력해주세요")
    .regex(/^\d+$/, "숫자만 입력해주세요"),
})
const subscriptionSchema = z.object({
  useNewCard: z.boolean(),
  subscriptionType: z
    .enum(["inactive", "monthly", "yearly"])
    .refine((val) => val === "monthly" || val === "yearly", {
      message: "구독 유형을 선택해주세요",
    }),
  discountBenefitId: z.string().optional(),
  agreement: z.boolean().refine((value) => value === true, {
    message: "약관에 동의해주세요",
  }),
})
const registerMembershipFormSchema = z.union([
  subscriptionSchema.extend({
    useNewCard: z.literal(true),
    ...cardDetailsSchema.shape,
  }),
  subscriptionSchema.extend({
    useNewCard: z.literal(false),
  }),
])

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
  existingFmsMember: FmsMember
  existingSubType: SubscriptionType
  availableBenefits: MemberBenefit[]
}
export function MembershipForm({
  monthlyPlan,
  yearlyPlan,
  existingFmsMember,
  existingSubType,
  availableBenefits,
}: MembershipFormProps) {
  const router = useRouter()
  const { user } = useUser()

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
    useNewCard: existingFmsMember == null,
    phone: "",
    payerNumber: "",
    paymentNumber: "",
    payerName: "",
    validUntil: "",
    password: "",
    subscriptionType:
      existingSubType === "monthly" || existingSubType === "yearly"
        ? existingSubType
        : ("inactive" as const),
    agreement: false,
  }

  const form = useForm<z.infer<typeof registerMembershipFormSchema>>({
    mode: "onChange",
    resolver: zodResolver(registerMembershipFormSchema),
    defaultValues: formDefaultValues,
  })

  async function onSubmit(data: z.infer<typeof registerMembershipFormSchema>) {
    try {
      // 사용자 인증 확인
      if (!user) {
        toast.error("로그인이 필요합니다.")
        return
      }

      // 1단계: 새 카드 등록 (조건부)
      if (data.useNewCard) {
        const validMonth = data.validUntil.slice(0, 2) // "2812" → "28"
        const validYear = data.validUntil.slice(2, 4) // "2812" → "12"

        const { createHmsCardProfile } = await import("@lib/api/wallet")
        await createHmsCardProfile({
          memberName: data.payerName,
          phone: data.phone,
          payerNumber: data.payerNumber,
          paymentNumber: data.paymentNumber,
          payerName: data.payerName,
          validYear: validYear,
          validMonth: validMonth,
          validUntil: data.validUntil,
          password: data.password,
        })

        // 카드 등록 후 페이지 데이터 새로고침
        router.refresh()
      }

      // // 2단계: 멤버십 구독 생성
      // const selectedPlanId =
      //   data.subscriptionType === "monthly"
      //     ? monthlyPlan.plan.id
      //     : yearlyPlan.plan.id

      // await clientApi("/api/membership/subscriptions", {
      //   method: "POST",
      //   body: JSON.stringify({
      //     planId: selectedPlanId,
      //   }),
      // })

      toast.success("멤버십이 등록되었습니다!")
      router.push("/mypage/membership")
    } catch (error) {
      if (error instanceof HttpApiError) {
        toast.error(error.message)
      } else {
        toast.error("멤버십 등록에 실패했습니다.")
      }
      console.error(error)
    }
  }

  const totalTrialDays = trialBenefits.reduce((acc, cur) => acc + cur.days, 0)
  const discountCount = discountBenefits.length

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
        className="grid grid-cols-1 gap-4 md:grid-cols-2"
      >
        <div>
          <Card>
            <CardHeader>
              <CardTitle>결제 정보</CardTitle>
            </CardHeader>
            <CardContent>
              <Tabs
                value={form.watch("useNewCard") ? "newCard" : "existingCard"}
                onValueChange={(value) =>
                  form.setValue("useNewCard", value === "newCard", {
                    shouldValidate: true,
                  })
                }
              >
                <TabsList className="w-full">
                  <TabsTrigger
                    className="flex-1"
                    value="existingCard"
                    disabled={existingFmsMember == null}
                  >
                    {existingFmsMember == null
                      ? "등록된 카드 없음"
                      : "기존 카드 사용"}
                  </TabsTrigger>
                  <TabsTrigger className="flex-1" value="newCard">
                    새 카드 등록
                  </TabsTrigger>
                </TabsList>

                <TabsContent className="space-y-3" value="newCard">
                  {existingFmsMember != null && (
                    <Alert>
                      <TriangleAlert className="h-4 w-4" />
                      <AlertTitle>이미 등록된 카드가 있습니다!</AlertTitle>
                      <AlertDescription>
                        새 카드를 등록하면 기존 카드 정보는 삭제됩니다.
                      </AlertDescription>
                    </Alert>
                  )}

                  <div className="grid grid-cols-2 gap-2">
                    <FormField
                      control={form.control}
                      name="payerName"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>카드 소유자명</FormLabel>
                          <FormControl>
                            <Input {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="payerNumber"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>6자리 생년월일/사업자번호</FormLabel>
                          <FormControl>
                            <Input placeholder="YYMMDD" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  <FormField
                    control={form.control}
                    name="phone"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>전화번호</FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            placeholder="01012345678"
                            maxLength={11}
                          />
                        </FormControl>
                        <p className="text-xs text-gray-500">
                          하이픈 없이 10-11자리 입력
                        </p>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="paymentNumber"
                    render={({ field: { onChange, ...rest } }) => (
                      <FormItem>
                        <FormLabel>카드번호</FormLabel>
                        <FormControl>
                          <FormattedInput
                            pattern="#### - #### - #### - ####"
                            {...rest}
                            onValueChange={onChange}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <FormField
                      control={form.control}
                      name="validUntil"
                      render={({ field: { onChange, ...rest } }) => (
                        <FormItem>
                          <FormLabel>유효기간</FormLabel>
                          <FormControl>
                            <FormattedInput
                              pattern="## / ##"
                              placeholder="MM / YY"
                              {...rest}
                              onValueChange={onChange}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="password"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>비밀번호 앞 2자리</FormLabel>
                          <FormControl>
                            <Input maxLength={2} {...field} type="password" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                </TabsContent>

                {existingFmsMember && (
                  <TabsContent value="existingCard">
                    {/* 등록된 카드 UI */}
                    <div className="bg-linear-to-brrom-blue-500 relative h-48 w-full max-w-md rounded-2xl to-blue-700 p-6 shadow-lg">
                      {/* 카드 패턴 */}
                      <div className="absolute inset-0 rounded-2xl bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAiIGhlaWdodD0iNDAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGRlZnM+PHBhdHRlcm4gaWQ9ImdyaWQiIHdpZHRoPSI0MCIgaGVpZ2h0PSI0MCIgcGF0dGVyblVuaXRzPSJ1c2VyU3BhY2VPblVzZSI+PHBhdGggZD0iTSAwIDEwIEwgNDAgMTAgTSAxMCAwIEwgMTAgNDAgTSAwIDIwIEwgNDAgMjAgTSAyMCAwIEwgMjAgNDAgTSAwIDMwIEwgNDAgMzAgTSAzMCAwIEwgMzAgNDAiIGZpbGw9Im5vbmUiIHN0cm9rZT0id2hpdGUiIHN0cm9rZS13aWR0aD0iMC41IiBvcGFjaXR5PSIwLjEiLz48L3BhdHRlcm4+PC9kZWZzPjxyZWN0IHdpZHRoPSIxMDAlIiBoZWlnaHQ9IjEwMCUiIGZpbGw9InVybCgjZ3JpZCkiLz48L3N2Zz4=')] opacity-20" />

                      {/* 카드 내용 */}
                      <div className="relative z-10 flex h-full flex-col justify-between text-white">
                        {/* 카드 상단 */}
                        <div className="flex items-start justify-between">
                          <div>
                            <p className="text-sm font-medium opacity-90">
                              HMS Card
                            </p>
                            <h3 className="mt-1 text-xl font-bold">
                              {existingFmsMember.paymentCompanyName}
                            </h3>
                          </div>
                          <div className="rounded-full bg-white/20 p-2 backdrop-blur-sm">
                            <CreditCard className="h-6 w-6" />
                          </div>
                        </div>

                        {/* 카드 중앙: 카드번호 */}
                        <div>
                          <p className="font-mono text-lg tracking-wider">
                            {existingFmsMember.paymentNumber}
                          </p>
                        </div>

                        {/* 카드 하단 */}
                        <div className="flex items-end justify-between">
                          <div>
                            <p className="text-xs opacity-75">카드 소유자</p>
                            <p className="mt-1 font-medium">
                              {existingFmsMember.payerName || "등록된 카드"}
                            </p>
                          </div>
                          <Badge className="bg-green-500 text-white hover:bg-green-600">
                            사용 가능
                          </Badge>
                        </div>
                      </div>
                    </div>
                  </TabsContent>
                )}
              </Tabs>
            </CardContent>
          </Card>
        </div>

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
                  />
                )}
              />
            </CardContent>
          </Card>

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

        <div className="bg-card text-card-foreground grid grid-cols-1 items-center gap-4 rounded-lg border p-6 shadow-sm md:col-span-2 md:grid-cols-2">
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
                form.watch("subscriptionType") === "inactive" ||
                form.formState.isSubmitting
              }
              type="submit"
            >
              {form.formState.isSubmitting ? (
                <span className="flex items-center gap-2">
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                  처리중...
                </span>
              ) : form.watch("agreement") ? (
                "멤버십 등록하기"
              ) : (
                "약관에 동의해주세요"
              )}
            </Button>
          </div>
        </div>

        <div></div>
      </form>
    </Form>
  )
}

interface AgreementCheckboxProps {
  value: boolean
  onChange: (checked: boolean) => void
}

const AgreementCheckbox: React.FC<AgreementCheckboxProps> = ({
  value,
  onChange,
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
          <DialogHeader>아몬드영 멤버십 이용약관</DialogHeader>
          <div className="h-60 overflow-y-auto border p-4">
            <TermsAndConditions />
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

function TermsAndConditions() {
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
          <li>결제 금액: 매월 4,990원 또는 매년 49,900원</li>
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
