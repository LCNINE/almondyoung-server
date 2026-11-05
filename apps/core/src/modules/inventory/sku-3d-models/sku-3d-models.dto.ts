import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import type { Sku3dModelStatus } from '../schema/inventory.schema';
import type { Sku3dModelVisibility } from './sku-3d-models.reader';

const MODEL_STATUSES: Sku3dModelStatus[] = ['draft', 'approved', 'needs_revision', 'needs_more_photos', 'failed'];

export class ReviewSku3dModelDto {
  @ApiProperty({ enum: MODEL_STATUSES })
  @IsIn(MODEL_STATUSES)
  status!: Sku3dModelStatus;

  @ApiPropertyOptional({ description: '사용 치수, 추정·단순화 부분, 원본 사진 ID, 추가 촬영 방향' })
  @ValidateIf((_object, value) => value !== undefined)
  @IsObject()
  notes?: Record<string, unknown>;
}

export class RegisterSku3dModelDto extends ReviewSku3dModelDto {
  @ApiPropertyOptional({ description: 'file-service sku-3d-model 컨텍스트로 업로드한 GLB 파일 ID' })
  @IsOptional()
  @IsUUID()
  glbFileId?: string;
}

export class BatchReviewSku3dModelsDto extends ReviewSku3dModelDto {
  @ApiProperty({ type: [String], maxItems: 100 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  ids!: string[];
}

const VISIBILITIES: Sku3dModelVisibility[] = ['public', 'private'];

export class ListSku3dModelUploadsQueryDto {
  @ApiPropertyOptional({ description: 'SKU 이름·코드 부분일치' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @ApiPropertyOptional({ description: '올린 사람 이름 부분일치' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  uploader?: string;

  @ApiPropertyOptional({ enum: VISIBILITIES })
  @IsOptional()
  @IsIn(VISIBILITIES)
  visibility?: Sku3dModelVisibility;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 50, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
