import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsUUID,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import type { LabelSkipReason, SkuLabelSize } from './label-templates';

export class LocationLabelsRequestDto {
  @ApiPropertyOptional({ description: '랙 id — 그 랙의 로케이션 전부. locationIds 와 둘 중 하나만' })
  @IsOptional()
  @IsUUID()
  rackId?: string;

  @ApiPropertyOptional({ type: [String], description: '로케이션 id 목록(1~500개). rackId 와 둘 중 하나만' })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @IsUUID('all', { each: true })
  locationIds?: string[];
}

export class SkuLabelItemDto {
  @ApiProperty()
  @IsUUID()
  skuId!: string;

  @ApiProperty({ minimum: 1, maximum: 200, description: '찍을 장수' })
  @IsInt()
  @Min(1)
  @Max(200)
  copies!: number;
}

export class SkuLabelsRequestDto {
  @ApiProperty({ enum: ['30x10', '50x30'] })
  @IsIn(['30x10', '50x30'])
  size!: SkuLabelSize;

  @ApiProperty({ type: [SkuLabelItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => SkuLabelItemDto)
  items!: SkuLabelItemDto[];
}

export class LabelSkipDto {
  @ApiProperty({ description: '요청이 준 id' })
  ref!: string;

  @ApiProperty({ type: String, nullable: true, description: '로케이션 코드 또는 SKU 코드(못 찾았으면 null)' })
  code!: string | null;

  @ApiProperty({ enum: ['UNSUPPORTED_CODE', 'NO_BARCODE', 'BARCODE_TOO_WIDE', 'NOT_FOUND'] })
  reason!: LabelSkipReason;
}

export class LabelBatchDto {
  @ApiProperty({ enum: ['zpl'] })
  format!: 'zpl';

  @ApiProperty({ description: '프린터로 보낼 ZPL. 그릴 것이 없으면 빈 문자열' })
  data!: string;

  @ApiProperty({ description: '그린 라벨 장수(장수 포함)' })
  labels!: number;

  @ApiProperty({ type: [LabelSkipDto] })
  skipped!: LabelSkipDto[];
}
