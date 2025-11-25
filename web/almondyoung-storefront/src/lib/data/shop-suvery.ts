// import { ShopSurveySchema } from "@modules/shop-survey/schemas/suvery-schema"

// 임시 타입 정의
type ShopSurveySchema = {
  [key: string]: any
}

export const modifyShopSurveyApi = async (data: ShopSurveySchema) => {
  // todo: 라우트핸들러 만들어야함
  const response = await fetch(`${process.env.APP_URL}/api/shop/info`, {
    method: "POST",
    body: JSON.stringify(data),
    headers: {
      "Content-Type": "application/json",
    },
  })

  return response
}

export const getShopSurveyApi = async () => {
  // todo: 라우트핸들러 만들어야함
  const response = await fetch(`${process.env.APP_URL}/api/shop/info`, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
    },
  })

  return response
}
