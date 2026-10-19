import type {
  AdminAlmondTemplateSummaryDto,
  AlmondFontDto,
  AlmondSavedDesignSummaryDto,
  AlmondTemplateSummaryDto,
} from "@/lib/types/dto/almond-template"

export interface AlmondTemplateSummary extends AlmondTemplateSummaryDto {
  thumbnail: string
}

export interface AdminAlmondTemplateSummary extends AdminAlmondTemplateSummaryDto {}

export interface AlmondSavedDesignSummary extends AlmondSavedDesignSummaryDto {}

export interface AlmondFont extends AlmondFontDto {}
