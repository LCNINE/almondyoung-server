import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsObject, IsOptional, IsString, IsUUID, Matches } from 'class-validator';

export class UpsertAlmondSavedDesignDto {
  @ApiPropertyOptional({ description: '덮어쓸 내 디자인 id. 없으면 새로 만든다', format: 'uuid' })
  @IsOptional()
  @IsUUID()
  id?: string;

  @ApiProperty({ description: '편집기 시안 JSON (version 1). title 필수', type: 'object', additionalProperties: true })
  @IsObject()
  design: Record<string, unknown>;

  @ApiProperty({ description: '보관함 카드에 쓰는 SVG 문자열' })
  @IsString()
  thumbnailSvg: string;
}

export class ListAlmondSavedDesignsQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  productId?: string;

  @ApiPropertyOptional({ example: '90x50', description: '`{widthMm}x{heightMm}`' })
  @IsOptional()
  @Matches(/^\d{2,5}x\d{2,5}$/)
  size?: string;
}

export class AlmondSavedDesignSummaryResponseDto {
  @ApiProperty() id: string;
  @ApiProperty() title: string;
  @ApiProperty() productId: string;
  @ApiProperty({ example: '90x50' }) size: string;
  @ApiProperty() updatedAt: string;
}

export class AlmondSavedDesignDetailResponseDto extends AlmondSavedDesignSummaryResponseDto {
  @ApiProperty({ type: 'object', additionalProperties: true }) design: Record<string, unknown>;
}

export class AlmondSavedDesignThumbnailResponseDto {
  @ApiProperty() thumbnailSvg: string;
}
