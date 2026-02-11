"use server"

import type { ShopFormSchema } from "@/components/shop-form/schema"
import { api } from "../api"
import { HttpApiError } from "../api-error"
import { ShopInfoDto } from "@/lib/types/dto/users"

export type ShopSurveyResult<T = unknown> =
  | { success: true; data: T }
  | { success: false; error: string }

export const modifyShopSurvey = async (
  data: ShopFormSchema
): Promise<ShopSurveyResult> => {
  try {
    const response = await api("users", `/shop/info`, {
      method: "POST",
      body: data,
      withAuth: true,
    })
    return { success: true, data: response }
  } catch (error) {
    if (error instanceof HttpApiError) {
      return { success: false, error: error.message }
    }
    return { success: false, error: "에러가 발생했습니다." }
  }
}

export const getShopSurvey = async (): Promise<ShopInfoDto | null> => {
  try {
    return await api<ShopInfoDto>("users", `/shop/info`, {
      method: "GET",
      withAuth: true,
    })
  } catch {
    return null
  }
}

/**
 * 설문 리마인드 날짜를 업데이트합니다.
 * 서버에서 설정된 REMIND_AFTER_DAYS 후에 다시 알림이 표시됩니다.
 */
export const updateSurveyRemind = async (): Promise<ShopSurveyResult> => {
  try {
    const response = await api("users", `/shop/remind`, {
      method: "PATCH",
      withAuth: true,
    })
    return { success: true, data: response }
  } catch (error) {
    if (error instanceof HttpApiError) {
      return { success: false, error: error.message }
    }
    return { success: false, error: "에러가 발생했습니다." }
  }
}
