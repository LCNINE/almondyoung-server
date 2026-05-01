"use server"

import { cache } from "react"
import { api } from "../api"
import type { ProductDetailDto } from "@lib/types/dto/pim"

export const getProductByMasterId = async (masterId: string) => {
  const result = await api("pim", "/products", {
    method: "GET",
    params: {
      masterId,
    },
    withAuth: false,
  })

  return result
}

export const getProductDetailByMasterId = cache(
  async (masterId: string): Promise<ProductDetailDto> => {
    return await api("pim", `/masters/${masterId}`, {
      method: "GET",
      withAuth: false,
      next: { tags: [`pim-detail-${masterId}`] },
    })
  }
)

/**
 * 여러 masterId로 제품 정보를 조회합니다.
 * 배너 연관 제품 등에서 사용합니다.
 */
export const getProductsByMasterIds = async (
  masterIds: string[]
): Promise<ProductDetailDto[]> => {
  if (masterIds.length === 0) return []

  const results = await Promise.all(
    masterIds.map((masterId) =>
      api<ProductDetailDto>("pim", `/masters/${masterId}`, {
        method: "GET",
        withAuth: false,
          }).catch(() => null)
    )
  )

  return results.filter((r): r is ProductDetailDto => r !== null)
}
