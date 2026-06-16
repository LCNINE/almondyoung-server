"use server"

import { api } from "@lib/api/api"
import { ApiAuthError, HttpApiError } from "@lib/api/api-error"
import { BusinessInfoDto, BusinessInfoRequestDto } from "@lib/types/dto/users"

/**
 * 사업자 외부 조회 결과.
 *
 * `api()`가 던지는 HttpApiError 는 Server Action → Client 경계를 넘으면서
 * 커스텀 Error 클래스와 `data` 프로퍼티가 사라진다(Next.js 가 message+digest 만 보존).
 * 그래서 에러 분기는 여기(서버)에서 끝내고, 클라이언트엔 직렬화 가능한 평범한 객체로 돌려준다.
 * - `field`: 에러가 가리키는 입력 필드(포커스/하이라이트용). 특정 못하면 null.
 * - `message`: 백엔드가 내려준 원본 메시지(기본 노출용).
 */
export type BusinessLookupResult =
  | { success: true }
  | {
      success: false
      field: "businessNumber" | "representativeName" | null
      message: string
    }

// 사업자 정보 외부 조회
export const fetchExternalBusinessInfo = async (
  businessNumber: string,
  representativeName: string
): Promise<BusinessLookupResult> => {
  try {
    await api<{ success: boolean }>("users", "/business-licenses/fetch", {
      method: "POST",
      body: { businessNumber, representativeName },
      withAuth: true,
    })

    return { success: true }
  } catch (error) {
    // 인증 에러는 그대로 전파 → error.tsx 가 토큰 복구를 처리한다.
    if (
      error instanceof ApiAuthError ||
      (error as { digest?: string })?.digest === "UNAUTHORIZED"
    ) {
      throw error
    }

    if (error instanceof HttpApiError) {
      const errorCode = error.data?.error as string | undefined
      const message = (error.data?.message as string) ?? error.message

      // 대표자명 불일치 (ApplicationException 의 안정적 errorCode)
      if (errorCode === "BUSINESS_LICENSE_CEO_NAME_NOT_MATCH") {
        return { success: false, field: "representativeName", message }
      }

      // 사업자번호 길이 검증 (class-validator → BAD_REQUEST 라 메시지로 식별)
      if (message.includes("10자리")) {
        return { success: false, field: "businessNumber", message }
      }

      return { success: false, field: null, message }
    }

    // 알 수 없는 에러도 사용자에겐 메시지를 보여주되 경계 너머로 던지지 않는다.
    const message =
      error instanceof Error ? error.message : "조회 중 오류가 발생했습니다."
    return { success: false, field: null, message }
  }
}

export const createBusiness = async (
  business: BusinessInfoRequestDto
): Promise<{ success: boolean }> => {
  const data = await api<{ success: boolean }>("users", "/business-licenses", {
    method: "POST",
    body: business,
    withAuth: true,
  })

  return data
}

export const updateBusiness = async ({
  business,
  businessId,
}: {
  business: BusinessInfoRequestDto
  businessId: string
}): Promise<{ success: boolean }> => {
  const data = await api<{ success: boolean }>(
    "users",
    `/business-licenses/${businessId}`,
    {
      method: "PUT",
      body: business,
      withAuth: true,
    }
  )

  return data
}

export const getMyBusiness = async (): Promise<BusinessInfoDto | null> => {
  const data = await api<BusinessInfoDto | null>(
    "users",
    "/business-licenses/me",
    {
      method: "GET",
      withAuth: true,
    }
  )

  return data
}
