"use client"

import { Spinner } from "@components/common/spinner"
import { Button } from "@components/common/ui/button"
import { Card, CardContent } from "@components/common/ui/card"
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@components/common/ui/form"
import { Input } from "@components/common/ui/input"
import { Label } from "@components/common/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@components/common/ui/select"
import { HttpApiError } from "@lib/api/api-error"
import { getApickAccount } from "@lib/api/wallet"
import { ChevronRight, CreditCard } from "lucide-react"
import { useTransition } from "react"
import { useFormContext } from "react-hook-form"
import { toast } from "sonner"
import { PaymentMethodFormSchema } from "../schema"
import BANKS from "../banks.data.json"

/**
 * 은행 계좌 조회 폼 컴포넌트
 */
export default function BankAccountLookupStep({
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

      {/* 계좌 인증 조회 결과 컴포넌트 */}
      {isOwnerConfirmed && (
        <VerifiedBankAccountCard
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
function VerifiedBankAccountCard({
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
