"use server"

import { ShopSurveySchema } from "@/domains/shop-survey/schemas/suvery-schema"
import { api } from "../api"
import { ShopInfoDto } from "@/lib/types/dto/users"

export const modifyShopSurvey = async (data: ShopSurveySchema) => {
  const response = await api("users", `/shop/info`, {
    method: "POST",
    body: data,
    withAuth: true,
  })

  return response
}

export const getShopSurvey = async () => {
  return await api<ShopInfoDto>("users", `/shop/info`, {
    method: "GET",
    withAuth: true,
  })
}
