"use server"

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

export const getProductDetailByMasterId = async (
  masterId: string
): Promise<ProductDetailDto> => {
  return await api("pim", `/masters/${masterId}`, {
    method: "GET",
    withAuth: false,
  })
}
