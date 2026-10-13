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
): Promise<AlmondSavedDesignDetailDto | { conflict: true }> => {
  parseDesign(dto.design)
  try {
    return await api<AlmondSavedDesignDetailDto>(
      "ugc",
      `/me/almond-saved-designs`,
      { method: "PUT", body: dto, timeout: 30000 }
    )
  } catch (error) {
    if (error instanceof HttpApiError && error.status === 409)
      return { conflict: true }
    throw error
  }
}

export const deleteMyAlmondSavedDesign = async (id: string): Promise<void> => {
  await api("ugc", `/me/almond-saved-designs/${id}`, { method: "DELETE" })
}
