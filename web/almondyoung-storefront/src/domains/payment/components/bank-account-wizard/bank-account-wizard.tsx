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
import { useRouter, useSearchParams } from "next/navigation"
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

// @deprecated 잔존 폼. CMS 자동이체 등록은 wallet-web(/billing-change, /pay/[intentId]/billing-setup)으로
// 통일됐고, 멤버십 등록 CTA는 더 이상 이 위저드를 타지 않는다. 현재는 나중결제(BNPL) 계좌 등록/변경
// 플로우(bnpl-verification-wizard/step3, change-account-sheet)에서만 열린다. BNPL도 결국 wallet-web으로
// 이관 예정이며, 그 작업에서 이 위저드를 제거한다. 그 전까지는 코드 참조가 살아있어 삭제하지 않는다.
export default function BankAccountWizard({ user }: { user: UserDetail }) {
  const { isOpen, closeModal } = usePaymentMethodModalStore() // 결제 수단 선택 모달
  const { closeModal: closeBnplModal } = useBnplModalStore() // 나중결제 결제 수단관리 모달창 닫기

  const router = useRouter()
  const searchParams = useSearchParams()

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

  // payerNumber = 사업자번호 10자리(사업자) 또는 생년월일 6자리(개인).
  // 사업자 정보가 있으면 사업자번호를 우선 사용하고, 없으면 아래 effect가 생년월일을 동기화한다.
  const [hasBusinessNumber, setHasBusinessNumber] = useState(false)

  useEffect(() => {
    const fetchBusinessInfo = async () => {
      const businessInfo = await getMyBusiness()
      if (businessInfo?.businessNumber) {
        form.setValue("payerNumber", businessInfo.businessNumber as string)
        setHasBusinessNumber(true)
      }
    }

    fetchBusinessInfo()
  }, [isOpen])

  // 개인 가입자: birthDate 입력이 payerNumber의 유일한 소스다. 사업자번호가 없을 때
  // 생년월일(YYYY-MM-DD 8자리 또는 YYMMDD 6자리)의 끝 6자리를 payerNumber(YYMMDD)로
  // 반영한다. 이게 없으면 개인은 정상 입력을 해도 payerNumber="" 로 제출돼 등록이 막힌다.
  // (구 subscribe 폼의 payerNumber 입력칸이 위저드 리팩터에서 누락된 회귀 복구)
  const birthDateValue = form.watch("birthDate")
  useEffect(() => {
    if (hasBusinessNumber) return
    const digits = (birthDateValue ?? "").replace(/\D/g, "")
    const yymmdd = digits.length >= 6 ? digits.slice(-6) : digits
    form.setValue("payerNumber", yymmdd)
  }, [birthDateValue, hasBusinessNumber, form])

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
      if (state.success && "profileId" in state) {
        if (state.agreementUploadFailed) {
          toast.warning(
            "자동이체 계좌 심사 신청이 완료되었으나 동의자료 등록에 실패했습니다. 관리자에게 문의해 주세요."
          )
        } else {
          toast.success(
            "자동이체 계좌 심사 신청이 완료되었습니다. 심사에는 1~2영업일이 소요될 수 있습니다."
          )
        }

        form.reset()
        closeModal()
        closeBnplModal()

        // returnTo 파라미터가 있으면 해당 페이지로 복귀 (멤버십 재등록 플로우 등)
        const returnTo = searchParams.get("returnTo")
        if (returnTo && returnTo.startsWith("/") && !returnTo.startsWith("//")) {
          router.replace(returnTo)
        } else {
          router.refresh()
        }
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
