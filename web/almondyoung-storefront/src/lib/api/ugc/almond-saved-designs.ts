"use server"

import type {
  AlmondSavedDesignDetailDto,
  AlmondSavedDesignSummaryDto,
  UpsertAlmondSavedDesignDto,
} from "@/lib/types/dto/almond-template"
import type { AlmondSavedDesignSummary } from "@/lib/types/ui/almond-template"
import { parseDesign } from "@/domains/almond-template/lib/document"
import { api } from "../api"
import { HttpApiError } from "../api-error"

const designProblem = (design: unknown) => {
  try {
    parseDesign(design)
    return null
  } catch (error) {
    return error instanceof Error
      ? error.message
      : "저장할 수 없는 디자인입니다."
  }
}

const rejectionMessage = (error: HttpApiError) => {
  const message: unknown = error.data?.message
  return typeof message === "string" && message
    ? message
    : "저장할 수 없는 시안입니다."
}

export const listMyAlmondSavedDesigns = async (
  productId: string,
  size: string
): Promise<AlmondSavedDesignSummary[]> =>
  await api<AlmondSavedDesignSummaryDto[]>("ugc", `/me/almond-saved-designs`, {
    method: "GET",
    params: { ...(productId && { productId }), ...(size && { size }) },
    cache: "no-store",
  })

export const getMyAlmondSavedDesign = async (
  id: string
): Promise<AlmondSavedDesignDetailDto> =>
  await api("ugc", `/me/almond-saved-designs/${id}`, {
    method: "GET",
    cache: "no-store",
  })

export const getMyAlmondSavedDesignThumbnail = async (
  id: string
): Promise<string> =>
  (
    await api<{ thumbnailSvg: string }>(
      "ugc",
      `/me/almond-saved-designs/${id}/thumbnail`,
      { method: "GET", cache: "no-store" }
    )
  ).thumbnailSvg

export const upsertMyAlmondSavedDesign = async (
  dto: UpsertAlmondSavedDesignDto
): Promise<
  AlmondSavedDesignDetailDto | { conflict: true } | { invalid: string }
> => {
  const invalid = designProblem(dto.design)
  if (invalid) return { invalid }
  try {
    return await api<AlmondSavedDesignDetailDto>(
      "ugc",
      `/me/almond-saved-designs`,
      { method: "PUT", body: dto, timeout: 30000 }
    )
  } catch (error) {
    if (error instanceof HttpApiError && error.status === 409)
      return { conflict: true }
    // 서버액션 경계를 넘으면 오류 문구가 지워지므로, 서버가 거절한 이유는 값으로 돌려준다
    if (error instanceof HttpApiError && error.status === 400)
      return { invalid: rejectionMessage(error) }
    throw error
  }
}

export const deleteMyAlmondSavedDesign = async (id: string): Promise<void> => {
  await api("ugc", `/me/almond-saved-designs/${id}`, { method: "DELETE" })
}
