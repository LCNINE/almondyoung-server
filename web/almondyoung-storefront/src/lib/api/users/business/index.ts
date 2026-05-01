"use server"

import { api } from "@lib/api/api"
import { BusinessInfoDto, BusinessInfoRequestDto } from "@lib/types/dto/users"

// 사업자 정보 외부 조회
export const fetchExternalBusinessInfo = async (
  businessNumber: string,
  representativeName: string
): Promise<{ success: boolean }> => {
  const data = await api<{ success: boolean }>(
    "users",
    "/business-licenses/fetch",
    {
      method: "POST",
      body: { businessNumber, representativeName },
      withAuth: true,
    }
  )

  return data
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
