import { BannerGroupDto } from "@/lib/types/dto/pim"
import { api } from "../api"
import { HttpApiError } from "../api-error"

export async function getBannerGroupByCode(code: string) {
  try {
    return await api<BannerGroupDto>("pim", `/banner-groups/by-code/${code}`, {
      method: "GET",
      withAuth: false,
    })
  } catch (error) {
    if (error instanceof HttpApiError && error.status === 404) {
      return null
    }
    throw error
  }
}
