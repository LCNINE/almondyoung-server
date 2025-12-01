import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  PricingRulesSetInput,
  BasePriceRule,
  MembershipPriceRule,
  TieredPriceRule,
} from './pricing-rule.schema';
import { IsArray, IsInt, Min, IsEnum, IsOptional, IsUUID, ValidateNested } from 'class-validator';


export enum PricingLayer {
  BASE_PRICE = 'base_price',
  MEMBERSHIP_PRICE = 'membership_price',
  TIERED_PRICE = 'tiered_price',
}

export enum PricingScopeType {
  ALL_VARIANTS = 'all_variants',
  WITH_OPTION = 'with_option',
  VARIANTS = 'variants',
}

export enum PricingOperationType {
  OFFSET = 'offset',
  SCALE = 'scale',
  OVERRIDE = 'override',
}

export class PricingRuleDto {
  @ApiProperty({ description: 'Rule order within layer', minimum: 1 })
  @IsInt()
  @Min(1)
  order: number;

  @ApiProperty({
    description: 'Layer type',
    enum: PricingLayer,
  })
  @IsEnum(PricingLayer)
  layer: PricingLayer;

  @ApiProperty({
    description: 'Scope type',
    enum: PricingScopeType,
  })
  @IsEnum(PricingScopeType)
  scopeType: PricingScopeType;

  @ApiProperty({
    description: 'Target IDs (option_value_ids or variant_ids)',
    type: [String],
    required: false,
  })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  scopeTargetIds?: string[];

  @ApiProperty({
    description: 'Operation type',
    enum: PricingOperationType,
  })
  @IsEnum(PricingOperationType)
  operationType: PricingOperationType;

  @ApiProperty({
    description: 'Operation value (원 단위, scale은 1000 배)',
  })
  @IsInt()
  operationValue: number;

  @ApiProperty({
    description: 'Minimum quantity (tiered_price only)',
    required: false,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  minQuantity?: number;
}

export class ReplacePricingRulesDto {
  @ApiProperty({
    description: 'Base price rules',
    type: [PricingRuleDto],
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PricingRuleDto)
  basePriceRules: BasePriceRule[];

  @ApiProperty({
    description: 'Membership price rules',
    type: [PricingRuleDto],
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PricingRuleDto)
  membershipPriceRules: MembershipPriceRule[];

  @ApiProperty({
    description: 'Tiered price rules',
    type: [PricingRuleDto],
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PricingRuleDto)
  tieredPriceRules: TieredPriceRule[];
}

// Zod validation을 위한 헬퍼 타입
export type ValidatedPricingRulesSet = PricingRulesSetInput;
