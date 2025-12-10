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
import { getApickAccount } from "@lib/api/wallet"
import { UserDetail } from "@lib/types/ui/user"
import { cn } from "@lib/utils"
import { format } from "date-fns"
import { ChevronLeft, ChevronRight, CreditCard } from "lucide-react"
import { useEffect, useState, useTransition } from "react"
import { useForm, useFormContext } from "react-hook-form"
import { toast } from "sonner"
import { usePaymentMethodModalStore } from "../store/payment-method-modal-store"
import BANKS from "./banks.data.json"
import BillingAgreementForm from "./billing-agreement"
import { paymentMethodFormSchema, PaymentMethodFormSchema } from "./schema"
import { Label } from "@components/common/ui/label"

type Step = "method" | "bank" | "account" | "agreement"

// 결제 수단 선택 모달 컴포넌트
export default function PaymentMethodForm({ user }: { user: UserDetail }) {
  const { isOpen, openModal, closeModal } = usePaymentMethodModalStore()
  const form = useForm<PaymentMethodFormSchema>({
    resolver: zodResolver(paymentMethodFormSchema),
    defaultValues: {
      bankCode: "",
      accountNumber: "",
      accountHolderName: "",
      accountHolderBirthDate: "",
    },
  })

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

  useEffect(() => {
    if (user.profile?.birthDate) {
      form.setValue("birthDate", format(user.profile.birthDate, "yyyy-MM-dd"))
    }
  }, [user.profile?.birthDate])

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
            onSelect={(bankCode: string) => {
              form.setValue("bankCode", bankCode)
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
          />
        )

      // 결제 동의 폼 컴포넌트
      case "agreement":
        return <BillingAgreementForm user={user} />
      default:
        return null
    }
  }

  const handleSubmit = (data: PaymentMethodFormSchema) => {
    console.log(data)
    // TODO: 결제수단 등록 로직 구현
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
function BankSelector({ onSelect }: { onSelect: (bankCode: string) => void }) {
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
              onClick={() => onSelect(bank.code)}
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
}: {
  bankCode: string | null
  onNextStep: () => void
}) {
  const form = useFormContext<PaymentMethodFormSchema>()

  const [isPending, startTransition] = useTransition()

  console.log("form.getValues():", form.formState.errors)

  const handleSearch = () => {
    const bankCode = form.watch("bankCode")
    const accountNumber = form.watch("accountNumber")
    const accountHolderName = form.watch("accountHolderName")

    if (!bankCode || !accountNumber) {
      form.setError("accountNumber", {
        message: "계좌번호를 입력해주세요",
      })

      form.setError("accountHolderName", {
        message: "예금주를 입력해주세요",
      })

      return
    }

    startTransition(async () => {
      try {
        const data = await getApickAccount(bankCode, accountNumber)
        if (data.api.success) {
          if (accountHolderName !== data.api.data.account_holder_name) {
            form.setError("accountHolderName", {
              message: "예금주가 일치하지 않습니다.",
            })
            return
          }
        }
      } catch (error) {
        if (error instanceof HttpApiError) {
          toast.error(error.message)
          return
        }
        toast.error("계좌 조회에 실패했습니다. 정보를 확인해주세요.")
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
          name="accountHolderName"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-sm font-medium">예금주</FormLabel>
              <FormControl>
                <Input
                  placeholder="예금주를 입력해주세요"
                  maxLength={10}
                  {...field}
                  onChange={(e) => {
                    const value = e.target.value.replace(/\s/g, "")
                    field.onChange(value)
                    form.clearErrors("accountHolderName")
                  }}
                  type="text"
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

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

      <BankAccountLookupResult bankCode={bankCode} onNextStep={onNextStep} />
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

  return (
    <Card
      className="mt-8 cursor-pointer border border-none shadow-sm transition-all hover:translate-y-[-2px] hover:shadow-md"
      onClick={onNextStep}
    >
      <CardContent className="flex items-center justify-between p-4">
        <div className="flex items-center gap-3" onClick={onNextStep}>
          <div className="flex size-10 items-center justify-center rounded-lg bg-blue-500">
            <CreditCard className="size-5 text-white" />
          </div>
          <span className="text-sm font-bold">은행계좌</span>
        </div>
        <ChevronRight className="size-5" />
      </CardContent>
    </Card>
  )
}
