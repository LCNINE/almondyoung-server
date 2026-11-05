"use server"

import {
  AdminAlmondTemplateDetailDto,
  AdminAlmondTemplateSummaryDto,
  AlmondTemplateDetailDto,
  AlmondTemplateCategoryDto,
  AlmondTemplateStatus,
  AlmondTemplateSummaryDto,
  UpsertAlmondTemplateDto,
} from "@/lib/types/dto/almond-template"
import type {
  AdminAlmondTemplateSummary,
  AlmondTemplateSummary,
} from "@/lib/types/ui/almond-template"
import { almondTemplateThumbnailUrl } from "@/lib/utils/almond-template-thumbnail-url"
import { parseDesign } from "@/domains/almond-template/lib/document"
import { decodeJwtPayload } from "@/lib/auth/jwt"
import { getAccessToken } from "@lib/data/cookies"
import { api } from "../api"
import { HttpApiError } from "../api-error"

// 어드민(admin-web)에서 게시·수정해도 여기 캐시를 비울 수 없어 템플릿·카테고리 모두 매번 받는다
export const listAlmondTemplates = async (): Promise<
  AlmondTemplateSummary[]
> => {
  const items = await api<AlmondTemplateSummaryDto[]>(
    "ugc",
    `/almond-templates`,
    {
      method: "GET",
      withAuth: false,
      cache: "no-store",
    }
  )
  return items.map((item) => ({
    ...item,
    thumbnail: almondTemplateThumbnailUrl(item.id, item.updatedAt),
  }))
}

export const listAlmondTemplateCategories = async (): Promise<
  AlmondTemplateCategoryDto[]
> =>
  await api("ugc", `/almond-template-categories`, {
    method: "GET",
    withAuth: false,
    cache: "no-store",
  })

export const getAlmondTemplate = async (
  id: string
): Promise<AlmondTemplateDetailDto> =>
  await api("ugc", `/almond-templates/${id}`, {
    method: "GET",
    withAuth: false,
    cache: "no-store",
  })

export const listAdminAlmondTemplates = async (): Promise<
  AdminAlmondTemplateSummary[]
> =>
  await api("ugc", `/admin/almond-templates`, {
    method: "GET",
    withAuth: true,
    cache: "no-store",
  })

export const getMyUserId = async (): Promise<string | null> => {
  const token = await getAccessToken()
  return (token && decodeJwtPayload(token)?.sub) || null
}

export const getAdminAlmondTemplate = async (
  id: string
): Promise<AdminAlmondTemplateDetailDto> =>
  await api("ugc", `/admin/almond-templates/${id}`, {
    method: "GET",
    withAuth: true,
    cache: "no-store",
  })

export const upsertAlmondTemplate = async (
  dto: UpsertAlmondTemplateDto
): Promise<AdminAlmondTemplateDetailDto | { conflict: true }> => {
  parseDesign(dto.design)
  try {
    const data = await api<AdminAlmondTemplateDetailDto>(
      "ugc",
      `/admin/almond-templates`,
      { method: "PUT", body: dto, withAuth: true }
    )
    return data
  } catch (error) {
    // 서버액션 경계를 넘으면 에러 클래스가 사라져 409 를 값으로 돌려준다
    if (error instanceof HttpApiError && error.status === 409)
      return { conflict: true }
    throw error
  }
}

export const updateAlmondTemplateStatus = async (
  id: string,
  status: AlmondTemplateStatus
): Promise<AdminAlmondTemplateSummary> => {
  const data = await api<AdminAlmondTemplateSummaryDto>(
    "ugc",
    `/admin/almond-templates/${id}/status`,
    { method: "PATCH", body: { status }, withAuth: true }
  )
  return data
}

export const deleteAlmondTemplate = async (id: string): Promise<void> => {
  await api("ugc", `/admin/almond-templates/${id}`, {
    method: "DELETE",
    withAuth: true,
  })
}
