import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsObject, IsString } from 'class-validator';
import { ALMOND_TEMPLATE_STATUSES, type AlmondTemplateStatus } from '../constants/almond-template.constants';

export class UpsertAlmondTemplateDto {
  @ApiProperty({
    description: '편집기가 내려받는 시안 JSON (version 1). productId·widthMm·heightMm·title 이 업서트 키다',
    type: 'object',
    additionalProperties: true,
  })
  @IsObject()
  design: Record<string, unknown>;

  @ApiProperty({ description: '목록 카드에 쓰는 SVG 문자열' })
  @IsString()
  thumbnailSvg: string;

  @ApiProperty({ enum: ALMOND_TEMPLATE_STATUSES })
  @IsIn(ALMOND_TEMPLATE_STATUSES)
  status: AlmondTemplateStatus;
}

export class UpdateAlmondTemplateStatusDto {
  @ApiProperty({ enum: ALMOND_TEMPLATE_STATUSES })
  @IsIn(ALMOND_TEMPLATE_STATUSES)
  status: AlmondTemplateStatus;
}

export class AlmondTemplateSummaryResponseDto {
  @ApiProperty() id: string;
  @ApiProperty() title: string;
  @ApiProperty() productId: string;
  @ApiProperty({ example: '90x50', description: '`{widthMm}x{heightMm}`' }) size: string;
  @ApiProperty({ type: [String], example: ['#ffffff', '#00aa00'] }) colors: string[];
  @ApiProperty({ nullable: true, type: String }) industry: string | null;
  @ApiProperty({ nullable: true, type: String }) purpose: string | null;
  @ApiProperty() updatedAt: string;
}

export class AlmondTemplateDetailResponseDto extends AlmondTemplateSummaryResponseDto {
  @ApiProperty({ type: 'object', additionalProperties: true }) design: Record<string, unknown>;
}

export class AdminAlmondTemplateSummaryResponseDto extends AlmondTemplateSummaryResponseDto {
  @ApiProperty({ nullable: true, type: String, example: 'pet', description: 'design.kind' }) kind: string | null;
  @ApiProperty({ enum: ALMOND_TEMPLATE_STATUSES }) status: AlmondTemplateStatus;
  @ApiProperty() createdBy: string;
  @ApiProperty() createdAt: string;
}

export class AdminAlmondTemplateDetailResponseDto extends AdminAlmondTemplateSummaryResponseDto {
  @ApiProperty({ type: 'object', additionalProperties: true }) design: Record<string, unknown>;
}
