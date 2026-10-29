import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsObject,
  IsOptional,
  IsUUID,
  ValidateIf,
} from 'class-validator';
import type { Sku3dModelStatus } from '../schema/inventory.schema';

const MODEL_STATUSES: Sku3dModelStatus[] = ['approved', 'needs_revision', 'needs_more_photos', 'failed'];

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
