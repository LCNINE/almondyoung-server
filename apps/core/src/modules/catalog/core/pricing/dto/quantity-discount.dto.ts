import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsInt, IsOptional, Matches, ValidateIf, ValidateNested } from 'class-validator';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export class QuantityDiscountTierDto {
  @ApiProperty({ description: '이 수량 이상이면 적용(같은 옵션 한 줄 기준)', minimum: 2 })
  @IsInt()
  minQuantity: number;

  @ApiProperty({ description: '일반 고객 할인율, 1/100 % 단위(10% = 1000). 정수 % 만 허용', example: 500 })
  @IsInt()
  regularRateBp: number;

  @ApiProperty({ description: '멤버십 회원 할인율(멤버십가 기준), 1/100 % 단위', example: 1000 })
  @IsInt()
  membershipRateBp: number;
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
}
