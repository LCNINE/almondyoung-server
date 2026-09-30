"use server"

import { revalidateTag } from "next/cache"
import {
  ALMOND_TEMPLATES_TAG,
  AdminAlmondTemplateDetailDto,
  AdminAlmondTemplateSummaryDto,
  AlmondTemplateDetailDto,
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
import { api } from "../api"

export const listAlmondTemplates = async (): Promise<
  AlmondTemplateSummary[]
> => {
  const items = await api<AlmondTemplateSummaryDto[]>(
    "ugc",
    `/almond-templates`,
    {
      method: "GET",
      withAuth: false,
      next: { tags: [ALMOND_TEMPLATES_TAG], revalidate: 300 },
    }
  )
  return items.map((item) => ({
    ...item,
    thumbnail: almondTemplateThumbnailUrl(item.id, item.updatedAt),
  }))
}

export const getAlmondTemplate = async (
  id: string
): Promise<AlmondTemplateDetailDto> =>
  await api("ugc", `/almond-templates/${id}`, {
    method: "GET",
    withAuth: false,
    next: { tags: [ALMOND_TEMPLATES_TAG], revalidate: 300 },
  })

export const listAdminAlmondTemplates = async (): Promise<
  AdminAlmondTemplateSummary[]
> =>
  await api("ugc", `/admin/almond-templates`, {
    method: "GET",
    withAuth: true,
    cache: "no-store",
  })

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
): Promise<AdminAlmondTemplateDetailDto> => {
  parseDesign(dto.design)
  const data = await api<AdminAlmondTemplateDetailDto>(
    "ugc",
    `/admin/almond-templates`,
    { method: "PUT", body: dto, withAuth: true }
  )
  revalidateTag(ALMOND_TEMPLATES_TAG)
  return data
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
  revalidateTag(ALMOND_TEMPLATES_TAG)
  return data
}

export const deleteAlmondTemplate = async (id: string): Promise<void> => {
  await api("ugc", `/admin/almond-templates/${id}`, {
    method: "DELETE",
    withAuth: true,
  })
  revalidateTag(ALMOND_TEMPLATES_TAG)
}
