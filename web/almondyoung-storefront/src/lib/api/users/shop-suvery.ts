"use server"

import type { ShopFormSchema } from "@/components/shop-form/schema"
import { api } from "../api"
import { ShopInfoDto } from "@/lib/types/dto/users"

export const modifyShopSurvey = async (data: ShopFormSchema) => {
  const response = await api("users", `/shop/info`, {
    method: "POST",
    body: data,
    withAuth: true,
  })

  return response
}

export const getShopSurvey = async (): Promise<ShopInfoDto | null> => {
  return await api<ShopInfoDto>("users", `/shop/info`, {
    method: "GET",
    withAuth: true,
  })
}
