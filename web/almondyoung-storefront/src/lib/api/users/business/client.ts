import { ApiAuthError, HttpApiError } from "../../api-error"
import {
  CreateBusinessInfoRequestDto,
  UpdateBusinessInfoRequestDto,
} from "./types"

// 사업자 정보 외부 조회
export const fetchExternalBusinessInfo = async (
  businessNumber: string,
  representativeName: string
): Promise<{ success: boolean }> => {
  const response = await fetch(`/api/users/business/external`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    credentials: "include",
    body: JSON.stringify({ businessNumber, representativeName }),
  })

  const data = await response.json()
  if (!response.ok) {
    throw new HttpApiError(
      data.message || "Failed to get business",
      response.status,
      response.statusText,
      data
    )
  }

  return data
}

export const createBusiness = async (
  business: CreateBusinessInfoRequestDto
) => {
  const response = await fetch(`/api/users/business`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    credentials: "include",
    body: JSON.stringify(business),
  })

  const data = await response.json()

  if (!response.ok) {
    if (response.status === 401) {
      throw new ApiAuthError(
        "Unauthorized",
        response.status,
        data.message,
        data
      )
    }

    throw new HttpApiError(
      data.error || "Failed to create business",
      response.status,
      response.statusText,
      data
    )
  }

  return data
}

export const updateBusiness = async (
  business: UpdateBusinessInfoRequestDto,
  businessId: string
) => {
  const response = await fetch(`/api/users/business/${businessId}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
    },
    credentials: "include",
    body: JSON.stringify(business),
  })

  const data = await response.json()

  if (!response.ok) {
    throw new HttpApiError(
      data.error || "Failed to update business",
      response.status,
      response.statusText,
      data
    )
  }

  return data
}
