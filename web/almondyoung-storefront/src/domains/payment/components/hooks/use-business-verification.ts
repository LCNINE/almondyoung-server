// src/domains/payment/components/hooks/use-business-verification.ts
import { HttpApiError } from "@lib/api/api-error"
import { fetchExternalBusinessInfo } from "@lib/api/users/business"
import { useState, useTransition } from "react"
import { UseFormReturn } from "react-hook-form"
import { toast } from "sonner"

type BusinessCheckStatus = "success" | "failed" | null

interface UseBusinessVerificationParams {
  form: UseFormReturn<any>
}

export function useBusinessVerification({
  form,
}: UseBusinessVerificationParams) {
  const [businessCheckStatus, setBusinessCheckStatus] =
    useState<BusinessCheckStatus>(null)

  const [isPending, startTransition] = useTransition()

  const handleVerifyBusiness = async () => {
    // 유효성 검사
    if (!form.watch("businessNumber")) {
      toast.error("사업자등록번호를 입력해주세요.")
      form.setFocus("businessNumber")
      return
    }
    if (!form.watch("ceoName")) {
      toast.error("대표이사 이름을 입력해주세요.")
      form.setFocus("ceoName")
      return
    }

    startTransition(async () => {
      try {
        // 사업자 정보 외부 조회
        const res = await fetchExternalBusinessInfo(
          form.getValues("businessNumber"),
          form.getValues("ceoName")
        )

        if (res.success) {
          toast.success(
            '사업자 정보 조회가 완료되었습니다. 아래 "등록하기" 버튼을 눌러 사업자 정보를 등록해주세요.'
          )
          setBusinessCheckStatus("success")
        }
      } catch (error: any) {
        setBusinessCheckStatus("failed")

        if (error instanceof HttpApiError) {
          switch (error.data.message) {
            case "사업자번호는 10자리이어야 합니다.":
              toast.error("사업자등록번호는 10자리이어야 합니다.")
              form.setFocus("businessNumber")
              break
            case "대표자 이름이 일치하지 않습니다.":
              toast.error("대표이사 이름이 일치하지 않습니다.")
              form.setFocus("ceoName")
              break
            default:
              toast.error(error.data.message || "조회 중 오류가 발생했습니다.")
          }
        } else {
          toast.error(error.message || "조회 중 오류가 발생했습니다.")
        }
      }
    })
  }

  return {
    businessCheckStatus,
    isPending,
    handleVerifyBusiness,
  }
}
