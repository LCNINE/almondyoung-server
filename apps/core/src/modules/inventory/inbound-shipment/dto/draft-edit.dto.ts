import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
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
  @ArrayMaxSize(200)
  @IsString({ each: true })
  @MaxLength(64, { each: true })
  boxLabels?: string[];
}

export class EditBoxDto {
  @ApiPropertyOptional({ enum: ['stock', 'forward'] })
  @IsOptional()
  @IsIn(['stock', 'forward'])
  disposition?: 'stock' | 'forward';

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  forwardNote?: string | null;

  @ApiPropertyOptional({ description: '초안일 때만' })
  @IsOptional()
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
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(1) @MaxLength(255) name?: string;

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
