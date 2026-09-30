import {
  AdminAlmondTemplateDetailResponseDto,
  AdminAlmondTemplateSummaryResponseDto,
  AlmondTemplateDetailResponseDto,
  AlmondTemplateSummaryResponseDto,
} from '../dto/almond-template.dto';
import { type AlmondTemplateEntity, type AlmondTemplateSummary } from '../types/almond-template.types';

export class AlmondTemplateMapper {
  static toSummary(row: AlmondTemplateSummary): AlmondTemplateSummaryResponseDto {
    return {
      id: row.id,
      title: row.title,
      productId: row.productId,
      size: `${row.widthMm}x${row.heightMm}`,
      colors: row.colors,
      industry: row.industry,
      purpose: row.purpose,
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  static toDetail(row: AlmondTemplateEntity): AlmondTemplateDetailResponseDto {
    return { ...this.toSummary(row), design: row.design };
  }

  static toAdminSummary(row: AlmondTemplateSummary): AdminAlmondTemplateSummaryResponseDto {
    return {
      ...this.toSummary(row),
      status: row.status,
      createdBy: row.createdBy,
      createdAt: row.createdAt.toISOString(),
    };
  }

  static toAdminDetail(row: AlmondTemplateEntity): AdminAlmondTemplateDetailResponseDto {
    return { ...this.toAdminSummary(row), design: row.design };
  }
}
