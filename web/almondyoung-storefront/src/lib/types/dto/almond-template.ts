export const ALMOND_TEMPLATES_TAG = "almond-templates"

export type AlmondTemplateStatus = "draft" | "published"

export type AlmondTemplateDesignDto = Record<string, unknown>

export interface AlmondTemplateSummaryDto {
  id: string
  title: string
  productId: string
  size: string
  colors: string[]
  industry: string | null
  purpose: string | null
  updatedAt: string
}

export interface AlmondTemplateDetailDto extends AlmondTemplateSummaryDto {
  design: AlmondTemplateDesignDto
}

export interface AdminAlmondTemplateSummaryDto extends AlmondTemplateSummaryDto {
  status: AlmondTemplateStatus
  createdBy: string
  createdAt: string
}

export interface AdminAlmondTemplateDetailDto extends AdminAlmondTemplateSummaryDto {
  design: AlmondTemplateDesignDto
}

export interface UpsertAlmondTemplateDto {
  design: AlmondTemplateDesignDto
  thumbnailSvg: string
  status: AlmondTemplateStatus
}
