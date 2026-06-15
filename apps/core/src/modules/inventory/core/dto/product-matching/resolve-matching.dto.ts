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

  @ApiProperty({
    description: 'Deprecated compatibility input. true이면 재고상품 비매칭(void) 전략으로 해소합니다.',
    required: false,
    deprecated: true,
  })
  @IsBoolean()
  @IsOptional()
  ignore?: boolean;

  @ApiProperty({
    description: '재고상품과 매칭하지 않는 void 전략으로 해소할지 여부',
    required: false,
    default: false,
  })
  @IsBoolean()
  @IsOptional()
  resolveAsVoid?: boolean;

  @ApiProperty({
    description: '매칭 전략. void는 SKU 링크 없이 재고상품 비매칭 전략으로 해소합니다.',
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
