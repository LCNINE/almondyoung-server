import { ApiProperty } from '@nestjs/swagger';

export class PricingRuleResponseDto {
  @ApiProperty({ description: 'Rule ID' })
  id: string;

  @ApiProperty({
    description: 'Layer',
    enum: ['base_price', 'membership_price', 'tiered_price'],
  })
  layer: 'base_price' | 'membership_price' | 'tiered_price';

  @ApiProperty({ description: 'Order within layer', minimum: 1 })
  order: number;

  @ApiProperty({
    description: 'Scope type',
    enum: ['all_variants', 'with_option', 'variants'],
  })
  scopeType: 'all_variants' | 'with_option' | 'variants';

  @ApiProperty({
    description: 'Target IDs',
    type: [String],
    required: false,
    nullable: true,
  })
  scopeTargetIds: string[] | null;

  @ApiProperty({
    description: 'Operation type',
    enum: ['offset', 'scale', 'override'],
  })
  operationType: 'offset' | 'scale' | 'override';

  @ApiProperty({ description: 'Operation value' })
  operationValue: number;

  @ApiProperty({
    description: 'Minimum quantity',
    required: false,
    nullable: true,
  })
  minQuantity: number | null;

  @ApiProperty({ description: 'Created at (ISO 8601)', example: '2025-12-05T10:30:00.000Z' })
  createdAt: string;

  @ApiProperty({ description: 'Updated at (ISO 8601)', example: '2025-12-05T10:30:00.000Z' })
  updatedAt: string;
}

export class PricingRulesResponseDto {
  @ApiProperty({
    description: 'Base price rules',
    type: [PricingRuleResponseDto],
  })
  basePriceRules: PricingRuleResponseDto[];

  @ApiProperty({
    description: 'Membership price rules',
    type: [PricingRuleResponseDto],
  })
  membershipPriceRules: PricingRuleResponseDto[];

  @ApiProperty({
    description: 'Tiered price rules',
    type: [PricingRuleResponseDto],
  })
  tieredPriceRules: PricingRuleResponseDto[];
}
