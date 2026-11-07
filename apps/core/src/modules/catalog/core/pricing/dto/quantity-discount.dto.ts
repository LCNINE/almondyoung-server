import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsInt, IsOptional, IsString, Matches, ValidateIf, ValidateNested } from 'class-validator';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export class QuantityDiscountTierDto {
  @ApiProperty({ description: '이 수량 이상이면 적용(같은 옵션 한 줄 기준)', minimum: 2 })
  @IsInt()
  minQuantity: number;

  @ApiProperty({ description: '일반 고객 할인율, 1/100 % 단위(10% = 1000). 정수 % 만 허용, 0 이면 일반 고객은 이 구간 할인 없음', example: 500 })
  @IsInt()
  regularRateBp: number;

  @ApiProperty({ description: '멤버십 회원 할인율(멤버십가 기준), 1/100 % 단위, 0 이면 회원은 이 구간 할인 없음', example: 1000 })
  @IsInt()
  membershipRateBp: number;
}

export class QuantityDiscountOverrideDto {
  @ApiProperty({ description: '옵션 조합 키 — 그 옵션의 옵션값 id 를 정렬해 «+» 로 이은 값' })
  @IsString()
  combination: string;

  @ApiProperty({ type: [QuantityDiscountTierDto], description: '이 옵션만 쓰는 구간. 빈 배열이면 이 옵션은 할인 없음' })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => QuantityDiscountTierDto)
  tiers: QuantityDiscountTierDto[];
}

export class UpsertQuantityDiscountDto {
  @ApiProperty()
  @IsBoolean()
  enabled: boolean;

  @ApiProperty({ required: false, nullable: true, description: 'KST 시작일(YYYY-MM-DD). 없으면 상시' })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Matches(DATE_ONLY)
  startsOn?: string | null;

  @ApiProperty({ required: false, nullable: true, description: 'KST 종료일(YYYY-MM-DD, 그날 끝까지)' })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Matches(DATE_ONLY)
  endsOn?: string | null;

  @ApiProperty({ type: [QuantityDiscountTierDto], description: '빈 배열이면 구간표를 지운다' })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => QuantityDiscountTierDto)
  tiers: QuantityDiscountTierDto[];

  @ApiProperty({ type: [QuantityDiscountOverrideDto], required: false, description: '옵션별 예외. 없으면 모든 옵션이 기본 표' })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => QuantityDiscountOverrideDto)
  variantOverrides?: QuantityDiscountOverrideDto[];
}

export class QuantityDiscountResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  enabled: boolean;

  @ApiProperty({ nullable: true })
  startsOn: string | null;

  @ApiProperty({ nullable: true })
  endsOn: string | null;

  @ApiProperty({ type: [QuantityDiscountTierDto] })
  tiers: QuantityDiscountTierDto[];

  @ApiProperty({ type: [QuantityDiscountOverrideDto] })
  variantOverrides: QuantityDiscountOverrideDto[];
}
