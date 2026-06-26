"use server"

import { api } from "@lib/api/api"
import { ApiAuthError } from "@lib/api/api-error"
import {
  BusinessInfoDto,
  BusinessInfoRequestDto,
  NtsLookupResult,
} from "@lib/types/dto/users"

/**
 * 사업자 정보 외부 조회 (국세청 상태조회).
 *
 * 등록을 막지 않는다 — 결과(계속/휴업/폐업/미등록/조회실패)를 그대로 돌려주고
 * 호출 측이 metadata 에 담는다. 인증 에러만 error.tsx 로 전파(토큰 복구), 그 외 호출 실패는
 * lookup_failed 로 흡수해 사용자가 계속 등록할 수 있게 한다.
 */
export const fetchExternalBusinessInfo = async (
  businessNumber: string
): Promise<NtsLookupResult> => {
  try {
    return await api<NtsLookupResult>("users", "/business-licenses/fetch", {
      method: "POST",
      body: { businessNumber },
      withAuth: true,
    })
  } catch (error) {
    if (
      error instanceof ApiAuthError ||
      (error as { digest?: string })?.digest === "UNAUTHORIZED"
    ) {
      throw error
    }

    return {
      result: "lookup_failed",
      checkedAt: new Date().toISOString(),
      error: error instanceof Error ? error.message : "request_failed",
    }
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
