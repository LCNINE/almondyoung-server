import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

const toLowerTrim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toLowerCase() : value);

// ─── Catalog ───────────────────────────────────────────────────────────────

export class UpdateCatalogDto {
  @ApiPropertyOptional({ description: '글로벌 활성화 여부' })
  @IsOptional()
  @IsBoolean()
  isEnabled?: boolean;

  @ApiPropertyOptional({ description: '표시 이름' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  displayName?: string;

  @ApiPropertyOptional({ description: '정렬 순서 (작을수록 먼저)' })
  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}

export class CatalogResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty({ description: 'provider 코드 (TOSS, NICEPAY, ...)' }) code!: string;
  @ApiProperty() displayName!: string;
  @ApiProperty({ nullable: true, type: String }) description!: string | null;
  @ApiProperty() isEnabled!: boolean;
  @ApiProperty() sortOrder!: number;
}

// ─── Region ──────────────────────────────────────────────────────────────────

export class CreateRegionDto {
  @ApiProperty({ description: '소문자 alpha-2 국가코드', example: 'kr' })
  @Transform(toLowerTrim)
  @IsString()
  @Matches(/^[a-z]{2}$/, { message: 'code must be a lowercase ISO 3166-1 alpha-2 code (e.g. kr, us)' })
  code!: string;

  @ApiProperty({ description: '리전 이름', example: '대한민국' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  name!: string;

  @ApiPropertyOptional({ description: '활성 여부 (기본 true)' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ description: '정렬 순서' })
  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}

export class UpdateRegionDto {
  @ApiPropertyOptional({ description: '리전 이름' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  name?: string;

  @ApiPropertyOptional({ description: '활성 여부' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ description: '정렬 순서' })
  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}

export class RegionResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty({ example: 'kr' }) code!: string;
  @ApiProperty() name!: string;
  @ApiProperty() isActive!: boolean;
  @ApiProperty() sortOrder!: number;
}

// ─── Region ↔ Catalog mapping ─────────────────────────────────────────────────

export class RegionMethodItemDto {
  @ApiProperty({ description: '카탈로그 코드', example: 'TOSS' })
  @IsString()
  @IsNotEmpty()
  code!: string;

  @ApiProperty({ description: '이 리전에서의 활성화 여부' })
  @IsBoolean()
  isEnabled!: boolean;

  @ApiPropertyOptional({ description: '정렬 순서' })
  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}

export class PutRegionMethodsDto {
  @ApiProperty({ type: [RegionMethodItemDto], description: '리전별 결제수단 설정 일괄' })
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => RegionMethodItemDto)
  items!: RegionMethodItemDto[];
}

/** 어드민 매트릭스: 카탈로그 전체 + 해당 리전에서의 설정 상태 */
export class RegionMethodMatrixItemDto {
  @ApiProperty() code!: string;
  @ApiProperty() displayName!: string;
  @ApiProperty({ nullable: true, type: String }) description!: string | null;
  @ApiProperty({ description: '카탈로그 글로벌 활성화' }) globalEnabled!: boolean;
  @ApiProperty({ description: '이 리전에서의 활성화 (매핑 없으면 false)' }) regionEnabled!: boolean;
  @ApiProperty({ description: '글로벌·리전 모두 켜져 실제 노출되는지' }) available!: boolean;
  @ApiProperty() sortOrder!: number;
}

export class RegionMethodMatrixResponseDto {
  @ApiProperty({ type: RegionResponseDto }) region!: RegionResponseDto;
  @ApiProperty({ type: [RegionMethodMatrixItemDto] }) items!: RegionMethodMatrixItemDto[];
}

// ─── Public: available payment methods ────────────────────────────────────────

export class AvailablePaymentMethodDto {
  @ApiProperty({ description: 'provider 코드', example: 'TOSS' }) code!: string;
  @ApiProperty({ example: '토스페이먼츠' }) displayName!: string;
  @ApiProperty({ nullable: true, type: String }) description!: string | null;
  @ApiProperty() sortOrder!: number;
}
