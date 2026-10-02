import type { AlmondTemplateDesignDto } from "./almond-template"

export interface CreateAlmondDesignDto {
  design: AlmondTemplateDesignDto
  frontSvg: string
  backSvg?: string
  templateId?: string
}

export interface AlmondDesignCreatedDto {
  id: string
  createdAt: string
}

export interface AlmondDesignDto {
  id: string
  design: AlmondTemplateDesignDto
  templateId: string | null
  createdAt: string
}
