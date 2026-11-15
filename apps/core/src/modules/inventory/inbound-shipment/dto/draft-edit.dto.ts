import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

export class EditLineDto {
  @ApiProperty({ enum: ['sku', 'free'] })
  @IsIn(['sku', 'free'])
  kind: 'sku' | 'free';

  @ApiPropertyOptional({ description: 'kind=sku 일 때 필수' })
  @ValidateIf((o: EditLineDto) => o.kind === 'sku')
  @IsUUID()
  skuId?: string;

  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) expectedQty?: number;

  @ApiPropertyOptional({ type: [String], description: '초안일 때만 — 줄이 덮는 상자 이름(범위 표기 가능)' })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(64, { each: true })
  boxLabels?: string[];
}

export class EditBoxDto {
  @ApiPropertyOptional({ enum: ['stock', 'forward'] })
  @ValidateIf((_o, v) => v !== undefined)
  @IsIn(['stock', 'forward'])
  disposition?: 'stock' | 'forward';

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  forwardNote?: string | null;

  @ApiPropertyOptional({ description: '초안일 때만' })
  @ValidateIf((_o, v) => v !== undefined)
  @IsString()
  @MinLength(1)
  @MaxLength(32)
  label?: string;
}

export class AiCandidateDto {
  @ApiProperty() @IsUUID() skuId: string;
  @ApiProperty() @IsString() @MaxLength(500) reason: string;
}

export class SetAiCandidatesDto {
  @ApiProperty({ type: [AiCandidateDto] })
  @IsArray()
  @ArrayMaxSize(5)
  @ValidateNested({ each: true })
  @Type(() => AiCandidateDto)
  candidates: AiCandidateDto[];
}

export class UpdateHeaderDto {
  @ApiPropertyOptional()
  @ValidateIf((_o, v) => v !== undefined)
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name?: string;

  @ApiPropertyOptional({ nullable: true, description: 'YYYY-MM-DD 또는 null' })
  @ValidateIf((_o, v) => v !== null)
  @IsOptional()
  @IsDateString({ strict: true })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  expectedArrival?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  memo?: string | null;
}

/** 사람이 선적을 끝낸다 — 상자 분실 등. 앞뒤 공백을 뺀 1~500자 — 매니저도 같은 검사를 한다 (spec §8.4). */
export class CloseInboundShipmentDto {
  @ApiProperty({ maxLength: 500, description: '끝내는 사유(상자 분실 등). 앞뒤 공백은 빼고 센다' })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Matches(/\S/)
  @MaxLength(500)
  reason: string;
}
