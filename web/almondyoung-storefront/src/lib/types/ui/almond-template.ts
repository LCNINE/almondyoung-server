import type {
  AdminAlmondTemplateSummaryDto,
  AlmondTemplateSummaryDto,
} from "@/lib/types/dto/almond-template"

export interface AlmondTemplateSummary extends AlmondTemplateSummaryDto {
  thumbnail: string
}

export interface AdminAlmondTemplateSummary extends AdminAlmondTemplateSummaryDto {}
