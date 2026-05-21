import { IsUUID, IsOptional, IsBoolean, IsArray, IsEnum, ValidateNested, IsNumber, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { matchingStrategyEnum } from '../../../schema/inventory.schema';

export class SkuMappingDto {
  @ApiProperty({ description: 'SKU ID' })
  @IsUUID()
  skuId: string;

  @ApiProperty({ description: '수량', minimum: 1, default: 1 })
  @IsNumber()
  @Min(1)
  @IsOptional()
  quantity?: number;
}

// 재고 정책 DTO 추가
export class StockPolicyDto {
  @ApiProperty({ description: '재고 0이어도 선판매 가능 여부', default: true })
  @IsBoolean()
  @IsOptional()
  preStockSellable?: boolean = true;

  @ApiProperty({ description: '재고 0이어도 항상 판매 가능 (직배/신상품)', default: false })
  @IsBoolean()
  @IsOptional()
  alwaysSellableZeroStock?: boolean = false;
}

export class ResolveMatchingDto {
  @ApiProperty({
    description: '매칭될 SKU ID 목록 (matched 상태일 경우 최소 하나 이상의 UUID 필수)',
    type: [String],
    required: false,
  })
  @IsArray()
  @IsUUID('all', { each: true })
  @IsOptional()
  skuIds?: string[];

  @ApiProperty({
    description: '매칭될 SKU와 수량 정보 목록 (수동 매칭 시 수량 지정 필요한 경우)',
    type: [SkuMappingDto],
    required: false,
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SkuMappingDto)
  @IsOptional()
  skuMappings?: SkuMappingDto[];

  @ApiProperty({ description: '매칭을 무시할지 여부 (true인 경우 ignored 상태로 전환)' })
  @IsBoolean()
  @IsOptional()
  ignore?: boolean;

  @ApiProperty({
    description: '매칭 전략',
    enum: matchingStrategyEnum.enumValues,
    default: 'variant',
  })
  @IsEnum(matchingStrategyEnum.enumValues)
  @IsOptional()
  strategy?: (typeof matchingStrategyEnum.enumValues)[number];

  @ApiProperty({ description: '재고 정책 설정', type: StockPolicyDto })
  @ValidateNested()
  @Type(() => StockPolicyDto)
  @IsOptional()
  stockPolicy?: StockPolicyDto;

  @ApiProperty({ description: '사은품 여부', default: false })
  @IsBoolean()
  @IsOptional()
  isGift?: boolean = false;
}
