"use client"

import { ShopInfoDto } from "@lib/types/dto/users"

/**
 * 서버 에러 응답을 포함하는 커스텀 에러 클래스
 * 서버 응답 전체를 보존하여 클라이언트에서 필요에 따라 활용할 수 있도록 함
 */
export class ServerError extends Error {
  constructor(
    message: string,
    public readonly response: any,
    public readonly status: number
  ) {
    super(message)
    this.name = "ServerError"
  }
}

export interface ShopInfoResponse {
  data: ShopInfoDto | null
}

export interface CreateShopInfoDto {
  isOperating: boolean
  yearsOperating?: number
  categories: string[]
  targetCustomers?: string[]
  openDays?: string[]
}

export interface UpdateShopInfoDto extends CreateShopInfoDto {}

/**
 * 상점 정보를 조회합니다
 */
export const getShopInfo = async (): Promise<ShopInfoDto | null> => {
  try {
    const response = await fetch("/api/users/shop/info", {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
      credentials: "include",
    })

    if (!response.ok) {
      if (response.status === 404) {
        return null
      }
      const errorData = await response.json().catch(() => ({}))
      // 서버 응답 그대로 전달
      const message =
        typeof errorData?.message === "string"
          ? errorData.message
          : Array.isArray(errorData?.message)
            ? errorData.message.join(", ")
            : errorData?.error || "상점 정보 조회에 실패했습니다"
      throw new ServerError(message, errorData, response.status)
    }

    const result: ShopInfoResponse = await response.json()
    return result.data
  } catch (error) {
    console.error("상점 정보 조회 실패:", error)
    throw error
  }
}

/**
 * 상점 정보를 생성합니다
 */
export const createShopInfo = async (
  data: CreateShopInfoDto
): Promise<void> => {
  try {
    const response = await fetch("/api/users/shop/info", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      credentials: "include",
      body: JSON.stringify(data),
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      // 서버 응답 그대로 전달
      const message =
        typeof errorData?.message === "string"
          ? errorData.message
          : Array.isArray(errorData?.message)
            ? errorData.message.join(", ")
            : errorData?.error || "상점 정보 생성에 실패했습니다"
      throw new ServerError(message, errorData, response.status)
    }
  } catch (error) {
    console.error("상점 정보 생성 실패:", error)
    throw error
  }
}

/**
 * 상점 정보를 수정합니다
 */
export const updateShopInfo = async (
  data: UpdateShopInfoDto
): Promise<void> => {
  try {
    const response = await fetch("/api/users/shop/info", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      credentials: "include",
      body: JSON.stringify(data),
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      // 서버 응답 그대로 전달
      const message =
        typeof errorData?.message === "string"
          ? errorData.message
          : Array.isArray(errorData?.message)
            ? errorData.message.join(", ")
            : errorData?.error || "상점 정보 수정에 실패했습니다"
      throw new ServerError(message, errorData, response.status)
    }
  } catch (error) {
    console.error("상점 정보 수정 실패:", error)
    throw error
  }
}
