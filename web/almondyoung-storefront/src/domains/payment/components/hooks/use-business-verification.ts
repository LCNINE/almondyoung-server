// src/domains/payment/components/hooks/use-business-verification.ts
import { fetchExternalBusinessInfo } from "@lib/api/users/business"
import type { NtsLookupResult } from "@lib/types/dto/users"
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
  // 상태조회 결과 — 제출 시 metadata.nts 로 저장해 백엔드가 승인 상태를 판정한다.
  const [ntsResult, setNtsResult] = useState<NtsLookupResult | null>(null)

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
        // 국세청 상태조회 — 사업자번호만으로 실존 여부 확인. 결과와 무관하게 등록 가능.
        const res = await fetchExternalBusinessInfo(
          form.getValues("businessNumber")
        )

        setNtsResult(res)

        // 번호가 실존(계속/휴업/폐업)으로 확인되면 success, 미등록/조회실패면 failed.
        const verified =
          res.result === "active" ||
          res.result === "suspended" ||
          res.result === "closed"
        setBusinessCheckStatus(verified ? "success" : "failed")

        if (res.result === "active") {
          toast.success(
            '사업자 정보 조회가 완료되었습니다. 아래 "등록하기" 버튼을 눌러 사업자 정보를 등록해주세요.'
          )
        } else {
          toast.info("그대로 등록하실 수 있어요. 아래 \"등록하기\" 버튼을 눌러주세요.")
        }
      } catch (error: any) {
        // 인증 에러는 error.tsx 로 전파해 토큰 복구를 처리한다.
        if (
          error?.digest === "UNAUTHORIZED" ||
          error?.message === "UNAUTHORIZED"
        ) {
          throw error
        }
        setNtsResult({
          result: "lookup_failed",
          checkedAt: new Date().toISOString(),
        })
        setBusinessCheckStatus("failed")
        toast.info("조회 결과와 관계없이 입력하신 정보로 진행할 수 있습니다.")
      }
    })
  }

  return {
    businessCheckStatus,
    ntsResult,
    isPending,
    handleVerifyBusiness,
  }
}
