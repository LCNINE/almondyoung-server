// src/domains/payment/components/hooks/use-business-verification.ts
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
          return
        }

        setBusinessCheckStatus("failed")
        switch (res.field) {
          case "businessNumber":
            toast.error("사업자등록번호는 10자리이어야 합니다.")
            form.setFocus("businessNumber")
            break
          case "representativeName":
            toast.error("대표이사 이름이 일치하지 않습니다.")
            form.setFocus("ceoName")
            break
          default:
            // 백엔드 원본 메시지를 그대로 노출(없으면 generic).
            toast.error(res.message || "조회 중 오류가 발생했습니다.")
        }
      } catch (error: any) {
        // 인증 에러는 error.tsx 로 전파해 토큰 복구를 처리한다.
        if (error?.digest === "UNAUTHORIZED" || error?.message === "UNAUTHORIZED") {
          throw error
        }
        setBusinessCheckStatus("failed")
        toast.error(error?.message || "조회 중 오류가 발생했습니다.")
      }
    })
  }

  return {
    businessCheckStatus,
    isPending,
    handleVerifyBusiness,
  }
}
