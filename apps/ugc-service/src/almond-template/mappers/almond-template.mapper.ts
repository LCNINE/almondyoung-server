import {
  AdminAlmondTemplateDetailResponseDto,
  AdminAlmondTemplateSummaryResponseDto,
  AlmondTemplateDetailResponseDto,
  AlmondTemplateSummaryResponseDto,
} from '../dto/almond-template.dto';
import {
  type AdminAlmondTemplateSummary,
  type AlmondTemplateEntity,
  type AlmondTemplateSummary,
} from '../types/almond-template.types';

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

  static toAdminSummary(row: AdminAlmondTemplateSummary): AdminAlmondTemplateSummaryResponseDto {
    return {
      ...this.toSummary(row),
      kind: row.kind,
      status: row.status,
      createdBy: row.createdBy,
      createdAt: row.createdAt.toISOString(),
    };
  }

  static toAdminSummaryFromEntity(row: AlmondTemplateEntity): AdminAlmondTemplateSummaryResponseDto {
    const kind = row.design.kind;
    return this.toAdminSummary({ ...row, kind: typeof kind === 'string' ? kind : null });
  }

  static toAdminDetail(row: AlmondTemplateEntity): AdminAlmondTemplateDetailResponseDto {
    return { ...this.toAdminSummaryFromEntity(row), design: row.design };
  }
}
