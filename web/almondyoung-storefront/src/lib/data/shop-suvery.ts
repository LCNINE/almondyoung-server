import { clientApi } from "@lib/client-api"
// import { ShopSurveySchema } from "@modules/shop-survey/schemas/suvery-schema"

// 임시 타입 정의
type ShopSurveySchema = {
  [key: string]: any
}

export const modifyShopSurveyApi = async (data: ShopSurveySchema) => {
  const response = await clientApi("/shop/info", {
    method: "POST",
    body: JSON.stringify(data),
  })

  return response
}

export const getShopSurveyApi = async () => {
  const response = await clientApi("/shop/info", {
    method: "GET",
  })

  return response
}
