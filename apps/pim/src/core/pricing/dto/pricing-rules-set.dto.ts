import { ApiProperty } from '@nestjs/swagger';
import {
  IsArray,
  ValidateNested,
  IsInt,
  Min,
  IsEnum,
  IsOptional,
  IsString
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  PricingRulesSetInput,
  BasePriceRule,
  MembershipPriceRule,
  TieredPriceRule
} from './pricing-rule.schema';

export class PricingRuleDto {
  @ApiProperty({
    description: 'Layer type',
    enum: ['base_price', 'membership_price', 'tiered_price'],
    required: false
  })
  @IsOptional()
  @IsEnum(['base_price', 'membership_price', 'tiered_price'])
  layer?: 'base_price' | 'membership_price' | 'tiered_price';

  @ApiProperty({ description: 'Rule order within layer', minimum: 1 })
  @IsInt()
  @Min(1)
  order: number;

  @ApiProperty({
    description: 'Scope type',
    enum: ['all_variants', 'with_option', 'variants']
  })
  @IsEnum(['all_variants', 'with_option', 'variants'])
  scopeType: 'all_variants' | 'with_option' | 'variants';

  @ApiProperty({
    description: 'Target IDs (option_value_ids or variant_ids)',
    type: [String],
    required: false
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  scopeTargetIds?: string[];

  @ApiProperty({
    description: 'Operation type',
    enum: ['offset', 'scale', 'override']
  })
  @IsEnum(['offset', 'scale', 'override'])
  operationType: 'offset' | 'scale' | 'override';

  @ApiProperty({
    description: 'Operation value (원 단위, scale은 1000배)'
  })
  @IsInt()
  operationValue: number;

  @ApiProperty({
    description: 'Minimum quantity (tiered_price only)',
    required: false
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  minQuantity?: number;
}

export class ReplacePricingRulesDto {
  @ApiProperty({
    description: 'Base price rules',
    type: [PricingRuleDto]
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PricingRuleDto)
  basePriceRules: BasePriceRule[];

  @ApiProperty({
    description: 'Membership price rules',
    type: [PricingRuleDto]
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PricingRuleDto)
  membershipPriceRules: MembershipPriceRule[];

  @ApiProperty({
    description: 'Tiered price rules',
    type: [PricingRuleDto]
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PricingRuleDto)
  tieredPriceRules: TieredPriceRule[];
}

// Zod validation을 위한 헬퍼 타입
export type ValidatedPricingRulesSet = PricingRulesSetInput;

