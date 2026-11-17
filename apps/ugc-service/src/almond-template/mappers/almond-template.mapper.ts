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
import { designPrintsBack } from '../services/almond-design.manager';

function kindOf(design: Record<string, unknown>): string | null {
  return typeof design.kind === 'string' ? design.kind : null;
}

function withDerived(row: AlmondTemplateEntity): AlmondTemplateSummary {
  return { ...row, kind: kindOf(row.design), printsBack: designPrintsBack(row.design) };
}

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
      kind: row.kind,
      printsBack: row.printsBack,
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  static toDetail(row: AlmondTemplateEntity): AlmondTemplateDetailResponseDto {
    return { ...this.toSummary(withDerived(row)), design: row.design };
  }

  static toAdminSummary(row: AdminAlmondTemplateSummary): AdminAlmondTemplateSummaryResponseDto {
    return {
      ...this.toSummary(row),
      status: row.status,
      createdBy: row.createdBy,
      updatedBy: row.updatedBy,
      createdAt: row.createdAt.toISOString(),
    };
  }

  static toAdminSummaryFromEntity(row: AlmondTemplateEntity): AdminAlmondTemplateSummaryResponseDto {
    return this.toAdminSummary(withDerived(row));
  }

  static toAdminDetail(row: AlmondTemplateEntity): AdminAlmondTemplateDetailResponseDto {
    return { ...this.toAdminSummaryFromEntity(row), design: row.design };
  }
}
