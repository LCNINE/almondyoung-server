"use client"

import { Card, CardContent } from "@components/common/ui/card"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@components/common/ui/dialog"
import { Form } from "@components/common/ui/form"
import { zodResolver } from "@hookform/resolvers/zod"
import { getMyBusiness } from "@lib/api/users/business"
import { onboardHmsBnpl } from "@lib/api/wallet"
import { UserDetail } from "@lib/types/ui/user"
import { cn } from "@lib/utils"
import { format } from "date-fns"
import { ChevronLeft, ChevronRight, CreditCard } from "lucide-react"
import { useRouter } from "next/navigation"
import { useActionState, useEffect, useState, useTransition } from "react"
import { useForm } from "react-hook-form"
import { toast } from "sonner"
import { useBnplModalStore } from "../store/bnpl-modal-store"
import { usePaymentMethodModalStore } from "../store/payment-method-modal-store"
import { paymentMethodFormSchema, PaymentMethodFormSchema } from "./schema"
import BankSelectorStep from "./step1"
import BankAccountLookupStep from "./step2"
import BankAgreementStep from "./step3"

type Step = "method" | "bank" | "account" | "agreement"

// 결제 수단 선택 모달 컴포넌트
export default function BankAccountWizard({ user }: { user: UserDetail }) {
  const { isOpen, closeModal } = usePaymentMethodModalStore() // 결제 수단 선택 모달
  const { closeModal: closeBnplModal } = useBnplModalStore() // 나중결제 결제 수단관리 모달창 닫기

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
  }, [isOpen])

  useEffect(() => {
    if (user.profile?.birthDate) {
      form.setValue("birthDate", format(user.profile.birthDate, "yyyy-MM-dd"))
    }

    if (user) {
      form.setValue("email", user.email)
    }
  }, [user, isOpen])

  useEffect(() => {
    if (state) {
      if (state && state.success && "profileId" in state) {
        toast.success("정기 결제 등록이 완료되었습니다.")

        form.reset()
        router.refresh()
        closeModal()
        closeBnplModal()
      } else {
        toast.error(state?.message || "정기결제 신청에 실패했습니다.")
      }
    }
  }, [state])

  const [step, setStep] = useState<Step>("method")

  const handleBankSelect = (
    nextStep: "method" | "bank" | "account" | "agreement"
  ) => {
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
    formData.append("name", data.bankName) // 은행 명
    formData.append("paymentNumber", data.accountNumber) // 계좌번호
    formData.append("payerNumber", data.payerNumber || "") // 납부자 사업자 번호
    formData.append("file", data.signature as File) //  전자서명 파일
    startTransition(async () => {
      formAction(formData)
      handleBankSelect("method")
    })
  }

  // 각 스텝별 렌더링 설정
  const stepComponents = {
    method: (
      <Card
        className="cursor-pointer border border-none shadow-md transition-all hover:translate-y-[-2px] hover:shadow-lg"
        onClick={() => setStep("bank")}
      >
        <CardContent className="flex items-center justify-between p-4">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-lg bg-blue-500">
              <CreditCard className="size-5 text-white" />
            </div>
            <span className="text-sm font-bold">은행계좌</span>
          </div>
          <ChevronRight className="size-5" />
        </CardContent>
      </Card>
    ),
    bank: (
      <BankSelectorStep
        onSelect={(bank) => {
          form.setValue("bankCode", bank.code)
          form.setValue("bankName", bank.name)
          handleBankSelect("account")
        }}
      />
    ),
    account: (
      <BankAccountLookupStep
        bankCode={form.watch("bankCode")}
        onNextStep={() => handleBankSelect("agreement")}
        userName={user.username}
      />
    ),
    agreement: (
      <BankAgreementStep user={user} isFormSubmitting={pending || isPending} />
    ),
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
              {stepComponents[step] || null}
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
