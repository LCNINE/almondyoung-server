import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';

export class MatchingLinkDto {
  @ApiProperty({ description: 'SKU ID', example: '123e4567-e89b-12d3-a456-426614174000' })
  @IsUUID()
  skuId: string;

  @ApiProperty({ description: '수량', example: 1, default: 1, minimum: 1 })
  @IsInt()
  @IsPositive()
  quantity: number = 1;
}

export class MatchingPolicyDto {
  @ApiProperty({ description: '선입고 판매 가능 여부', required: false, example: false })
  @IsOptional()
  @IsBoolean()
  preStockSellable?: boolean;

  @ApiProperty({ description: '재고 0일 때도 항상 판매 가능 여부', required: false, example: false })
  @IsOptional()
  @IsBoolean()
  alwaysSellableZeroStock?: boolean;

  @ApiProperty({
    description: '수동 판매 가능 상태 override. manual_out_of_stock이면 노출은 유지하되 판매가능수량을 0으로 projection합니다.',
    required: false,
    nullable: true,
    enum: ['manual_out_of_stock'],
  })
  @IsOptional()
  @IsEnum(['manual_out_of_stock'])
  availabilityOverride?: 'manual_out_of_stock' | null;
}

export class UpsertMatchingDto {
  @ApiProperty({ description: 'Master ID', required: false, nullable: true })
  @IsOptional()
  @IsString()
  @IsUUID()
  masterId?: string | null;

  @ApiProperty({ description: '매칭 링크 목록', type: [MatchingLinkDto], default: [] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MatchingLinkDto)
  links: MatchingLinkDto[] = [];

  @ApiProperty({ description: '매칭 정책', type: MatchingPolicyDto, required: false })
  @IsOptional()
  @ValidateNested()
  @Type(() => MatchingPolicyDto)
  policy?: MatchingPolicyDto;
}
