"use server"

import { ShopSurveySchema } from "@/domains/shop-survey/schemas/suvery-schema"
import { api } from "../api"

export const modifyShopSurvey = async (data: ShopSurveySchema) => {
  const response = await api("users", `/shop/info`, {
    method: "POST",
    body: data,
    withAuth: true,
  })

  return response
}

export const getShopSurvey = async () => {
  const response = await api("users", `/shop/info`, {
    withAuth: true,
  })

  return response
}
