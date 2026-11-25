import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Matches, MaxLength, Min, MinLength } from 'class-validator';
import type { Sku3dDimensionBasis } from '../schema/inventory.schema';

const BASES: Sku3dDimensionBasis[] = ['body', 'package', 'unknown'];

export class ConfirmWorkshopDimensionsDto {
  @ApiProperty({ enum: BASES, description: '실측값이 본체 크기인지 포장째 크기인지' })
  @IsIn(BASES)
  basis!: Sku3dDimensionBasis;
}

export class PostWorkshopMessageDto {
  @ApiProperty({ description: '작업자 수정 요청', maxLength: 2000 })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  body!: string;
}

export class WorkshopEventsQueryDto {
  @ApiPropertyOptional({ description: '이미 받은 마지막 이벤트 seq' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  afterSeq?: number;
}

export class WorkshopFileParamDto {
  @ApiProperty({ description: 'glb 또는 render-<번호>' })
  @Matches(/^(glb|render-\d{1,2})$/)
  kind!: string;
}
