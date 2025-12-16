"use client"

import { Spinner } from "@components/common/spinner"
import { Button } from "@components/common/ui/button"
import { Card, CardContent } from "@components/common/ui/card"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@components/common/ui/dialog"
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@components/common/ui/form"
import { Input } from "@components/common/ui/input"
import { Label } from "@components/common/ui/label"
import { ScrollArea } from "@components/common/ui/scroll-area"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@components/common/ui/select"
import { zodResolver } from "@hookform/resolvers/zod"
import { HttpApiError } from "@lib/api/api-error"
import { getMyBusiness } from "@lib/api/users/business"
import { getApickAccount, onboardHmsBnpl } from "@lib/api/wallet"
import { UserDetail } from "@lib/types/ui/user"
import { cn } from "@lib/utils"
import { format } from "date-fns"
import { ChevronLeft, ChevronRight, CreditCard } from "lucide-react"
import { useRouter } from "next/navigation"
import { useActionState, useEffect, useState, useTransition } from "react"
import { useForm, useFormContext } from "react-hook-form"
import { toast } from "sonner"
import { usePaymentMethodModalStore } from "../store/payment-method-modal-store"
import BANKS from "./banks.data.json"
import BillingAgreementForm from "./billing-agreement"
import { paymentMethodFormSchema, PaymentMethodFormSchema } from "./schema"

type Step = "method" | "bank" | "account" | "agreement" | "editAccount"

// 결제 수단 선택 모달 컴포넌트
export default function PaymentMethodForm({ user }: { user: UserDetail }) {
  const { isOpen, openModal, closeModal } = usePaymentMethodModalStore() // 결제 수단 선택 모달
  const router = useRouter()

  const form = useForm<PaymentMethodFormSchema>({
    resolver: zodResolver(paymentMethodFormSchema),
    defaultValues: {
      bankCode: "",
      accountNumber: "",
      accountHolderName: "",
      billingDate: "10",
      birthDate: user.profile?.birthDate
        ? format(user.profile.birthDate, "yyyy-MM-dd")
        : "",
      payerNumber: "",
      email: user.email || "",
      isOwnerConfirmed: false,
      electronicTransaction: false,
      privacyPolicy: false,
      thirdPartySharing: false,
      signature: undefined,
    },
  })

  const [state, formAction, pending] = useActionState(onboardHmsBnpl, null)
  const [isPending, startTransition] = useTransition()

  useEffect(() => {
    const fetchBusinessInfo = async () => {
      const businessInfo = await getMyBusiness()
      if (businessInfo) {
        form.setValue("payerNumber", businessInfo.businessNumber as string)
      }
    }

    fetchBusinessInfo()
  }, [])

  useEffect(() => {
    if (user.profile?.birthDate) {
      form.setValue("birthDate", format(user.profile.birthDate, "yyyy-MM-dd"))
    }

    if (user) {
      form.setValue("email", user.email)
    }
  }, [user])

  useEffect(() => {
    if (state) {
      if (state && state.success) {
        toast.success("정기 결제 등록이 완료되었습니다.")
        router.refresh()
        closeModal()
      } else {
        toast.error(state?.message || "정기결제 신청에 실패했습니다.")
      }
    }
  }, [state])

  const [step, setStep] = useState<Step>("method")

  const handleBankSelect = (nextStep: "bank" | "account" | "agreement") => {
    setStep(nextStep)
  }

  const handleBack = () => {
    if (step === "method") {
      closeModal()
    } else {
      setStep(
        step === "bank"
          ? "method"
          : step === "account"
            ? "bank"
            : step === "agreement"
              ? "account"
              : "method"
      )
    }
  }

  const handleModalClose = () => {
    if (
      confirm(
        "결제수단 등록을 취소하시겠습니까? 입력한 정보는 모두 삭제됩니다."
      )
    ) {
      setStep("method")
      form.reset()
      closeModal()
    }
  }

  const handleSubmit = async (data: PaymentMethodFormSchema) => {
    // 전화번호 형식 변환: +821012345678 -> 01012345678
    const phoneNumber = user.profile?.phoneNumber || ""
    const formattedPhone = phoneNumber.startsWith("+82")
      ? "0" + phoneNumber.slice(3) // +82 제거하고 0 추가
      : phoneNumber

    const formData = new FormData()
    formData.append("payerName", data.accountHolderName) // 납부자 명
    formData.append("phone", formattedPhone) // 전화번호
    formData.append("paymentCompany", data.bankCode) // 은행코드
    formData.append("paymentNumber", data.accountNumber) // 계좌번호
    formData.append("payerNumber", data.payerNumber || "") // 납부자 사업자 번호
    formData.append("file", data.signature as File) //  전자서명 파일

    startTransition(async () => {
      formAction(formData)
    })
  }

  const renderContent = () => {
    switch (step) {
      // 결제 방법 선택 컴포넌트
      case "method":
        return (
          <Card
            className="cursor-pointer border border-none shadow-md transition-all hover:translate-y-[-2px] hover:shadow-lg"
            onClick={() => setStep("bank")}
          >
            <CardContent className="flex items-center justify-between p-4">
              <div
                className="flex items-center gap-3"
                onClick={() => setStep("bank")}
              >
                <div className="flex size-10 items-center justify-center rounded-lg bg-blue-500">
                  <CreditCard className="size-5 text-white" />
                </div>
                <span className="text-sm font-bold">은행계좌</span>
              </div>
              <ChevronRight className="size-5" />
            </CardContent>
          </Card>
        )

      // 은행 선택하는 은행 리스트 컴포넌트
      case "bank":
        return (
          <BankSelector
            onSelect={(bank) => {
              form.setValue("bankCode", bank.code)
              form.setValue("bankName", bank.name)
              handleBankSelect("account")
            }}
          />
        )

      // 은행 계좌 조회 폼 컴포넌트
      case "account":
        return (
          <BankAccountLookupForm
            bankCode={form.watch("bankCode")}
            onNextStep={() => handleBankSelect("agreement")}
            userName={user.username}
          />
        )

      case "editAccount":
        return (
          <BankAccountLookupForm
            bankCode={form.watch("bankCode")}
            onNextStep={() => handleBankSelect("agreement")}
            userName={user.username}
          />
        )

      // 결제 동의 폼 컴포넌트
      case "agreement":
        return (
          <BillingAgreementForm
            user={user}
            isFormSubmitting={pending || isPending}
          />
        )
      default:
        return null
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={handleModalClose}>
      <DialogContent className="flex min-h-2/3 flex-col overflow-hidden sm:max-w-md">
        <DialogHeader className="relative flex flex-row items-center justify-center pb-4">
          <button
            type="button"
            onClick={handleBack}
            className="absolute left-0 flex cursor-pointer items-center justify-center p-1 hover:opacity-70"
          >
            <ChevronLeft className="size-5" />
          </button>
          <DialogTitle className="text-base font-semibold">
            결제수단 등록
          </DialogTitle>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleSubmit)}>
            <div
              className={cn(
                `bg-gray-10 border-t-gray-20 absolute top-16 right-0 bottom-0 left-0 h-full w-full flex-1 border-t p-4`,
                step === "agreement" && "bg-gray-0"
              )}
            >
              {renderContent()}
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}

/**
 * 은행 선택 컴포넌트
 */
function BankSelector({
  onSelect,
}: {
  onSelect: (bank: { code: string; name: string }) => void
}) {
  return (
    <>
      <p className="mb-4 text-center text-sm">
        본인 명의의 계좌만 등록 가능합니다.
      </p>
      <ScrollArea className="h-80">
        <div className="grid grid-cols-3 gap-3">
          {BANKS.map((bank) => (
            <Button
              variant="outline"
              key={bank.code}
              onClick={() => onSelect(bank)}
              className={cn(
                "flex w-full items-center gap-3 rounded-lg border p-3 transition"
              )}
            >
              <span className="text-[15px] font-medium">{bank.name}</span>
            </Button>
          ))}
        </div>
      </ScrollArea>
    </>
  )
}

/**
 * 은행 계좌 조회 폼 컴포넌트
 */
function BankAccountLookupForm({
  bankCode,
  onNextStep,
  userName,
}: {
  bankCode: string | null
  onNextStep: () => void
  userName: string
}) {
  const form = useFormContext<PaymentMethodFormSchema>()
  const isOwnerConfirmed = form.watch("isOwnerConfirmed") // 예금주 확인 여부
  const [isPending, startTransition] = useTransition()

  const handleSearch = () => {
    const bankCode = form.watch("bankCode")
    const accountNumber = form.watch("accountNumber")

    if (!bankCode || !accountNumber) {
      form.setError("accountNumber", {
        message: "계좌번호를 입력해주세요",
      })

      return
    }

    form.setValue("isOwnerConfirmed", false)
    startTransition(async () => {
      try {
        const data = await getApickAccount(bankCode, accountNumber)

        if (data.api.success) {
          if (data.data.계좌실명 !== userName) {
            toast.error("본인 명의의 계좌만 등록 가능합니다.")
            form.setValue("isOwnerConfirmed", false)
            return
          }

          form.setValue("bankCode", data.data.은행코드)
          form.setValue("accountHolderName", data.data.계좌실명)
          form.setValue("isOwnerConfirmed", true)
        }
      } catch (error) {
        if (error instanceof HttpApiError) {
          toast.error(error.message)
          form.setValue("isOwnerConfirmed", false)
          return
        }

        toast.error("계좌 조회에 실패했습니다. 정보를 확인해주세요.")
        form.setValue("isOwnerConfirmed", false)
      }
    })
  }
  return (
    <>
      <div className="space-y-4">
        <div className="space-y-2">
          <Label className="text-sm font-medium">은행</Label>
          <Select
            onValueChange={(value) => form.setValue("bankCode", value)}
            defaultValue={form.watch("bankCode") ?? undefined}
          >
            <SelectTrigger className="w-full bg-white">
              <SelectValue placeholder="은행 선택" />
            </SelectTrigger>

            <SelectContent className="max-h-60">
              {BANKS.map((bank) => (
                <SelectItem key={bank.code} value={bank.code}>
                  {bank.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <FormField
          control={form.control}
          name="accountNumber"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-sm font-medium">계좌번호</FormLabel>
              <FormControl>
                <Input
                  placeholder="계좌번호를 입력해주세요"
                  maxLength={14}
                  inputMode="numeric"
                  pattern="[0-9]*"
                  {...field}
                  onChange={(e) => {
                    // 숫자만 허용
                    const value = e.target.value.replace(/[^0-9]/g, "")
                    field.onChange(value)
                    form.clearErrors("accountNumber")
                  }}
                  onKeyDown={(e) => {
                    // Enter 키로 form submit 방지
                    if (e.key === "Enter") {
                      e.preventDefault()
                      handleSearch()
                    }
                  }}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="flex justify-end">
          <Button
            type="button"
            className="cursor-pointer px-8 py-2"
            onClick={handleSearch}
            disabled={isPending}
          >
            {isPending ? <Spinner size="sm" /> : "조회"}
          </Button>
        </div>
      </div>

      {isOwnerConfirmed && (
        <BankAccountLookupResult
          bankCode={bankCode}
          onNextStep={() => {
            onNextStep()
          }}
        />
      )}
    </>
  )
}

// 계좌 인증 조회 결과 컴포넌트
function BankAccountLookupResult({
  bankCode,
  onNextStep,
}: {
  bankCode: string | null
  onNextStep: () => void
}) {
  if (!bankCode) return null

  const form = useFormContext<PaymentMethodFormSchema>()
  const accountHolderName = form.watch("accountHolderName")
  const accountNumber = form.watch("accountNumber")

  return (
    <>
      <p className="my-4 text-sm font-bold">이 계좌가 맞나요?</p>

      <Card
        className="cursor-pointer border border-none shadow-sm transition-all hover:translate-y-[-2px] hover:shadow-md"
        onClick={onNextStep}
      >
        <CardContent className="flex items-center justify-between p-4">
          <div className="flex items-center gap-3" onClick={onNextStep}>
            <div className="flex size-10 items-center justify-center rounded-lg bg-blue-500">
              <CreditCard className="size-5 text-white" />
            </div>

            <div className="flex flex-col">
              <p className="text-xs font-medium">{accountNumber}</p>
              <p className="text-sm font-medium">{accountHolderName}</p>
            </div>
          </div>
          <ChevronRight className="size-5" />
        </CardContent>
      </Card>
    </>
  )
}
