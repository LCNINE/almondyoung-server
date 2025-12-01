import { HttpApiError } from "@lib/api/api-error"
import { getShopSurveyApi, modifyShopSurveyApi } from "@lib/data/shop-suvery"
import { useState } from "react"
import { toast } from "sonner"
import { ShopSurveySchema } from "../schemas/suvery-schema"

export const useShopSurvey = () => {
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isLoading, setIsLoading] = useState(true)

  const modifyShopSurvey = async (data: ShopSurveySchema) => {
    try {
      setIsSubmitting(true)

      const transformedData = {
        ...data,
        shopType: data.shopType ?? undefined,
      }

      const response = await modifyShopSurveyApi(transformedData)

      return response
    } catch (error) {
      if (error instanceof HttpApiError) {
        toast.error(error.message)
        return
      }

      toast.error("에러가 발생했습니다. 잠시 후 다시 시도해주세요.")
      return
    } finally {
      setIsSubmitting(false)
    }
  }

  const getShopSurvey = async () => {
    try {
      setIsLoading(true)
      const response = await getShopSurveyApi()
      return response
    } catch (error) {
      if (error instanceof HttpApiError) {
        toast.error(error.message)
        return
      }

      toast.error("정보를 가져오는데 실패했습니다. 잠시 후 다시 시도해주세요.")
      return
    } finally {
      setIsLoading(false)
    }
  }

  return { modifyShopSurvey, isLoading, isSubmitting, getShopSurvey }
}
