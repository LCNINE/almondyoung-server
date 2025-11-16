import { ApiProperty } from '@nestjs/swagger';

export class AppliedRuleDto {
  @ApiProperty({ description: 'Rule ID' })
  ruleId: string;

  @ApiProperty({ 
    description: 'Layer', 
    enum: ['base_price', 'membership_price', 'tiered_price'] 
  })
  layer: 'base_price' | 'membership_price' | 'tiered_price';

  @ApiProperty({ description: 'Order' })
  order: number;

  @ApiProperty({ 
    description: 'Scope type', 
    enum: ['all_variants', 'with_option', 'variants'] 
  })
  scopeType: 'all_variants' | 'with_option' | 'variants';

  @ApiProperty({ 
    description: 'Operation type', 
    enum: ['offset', 'scale', 'override'] 
  })
  operationType: 'offset' | 'scale' | 'override';

  @ApiProperty({ description: 'Operation value' })
  operationValue: number;

  @ApiProperty({ description: 'Price before applying this rule' })
  priceBeforeRule: number;

  @ApiProperty({ description: 'Price after applying this rule' })
  priceAfterRule: number;
}

export class PriceBreakdownDto {
  @ApiProperty({ description: 'Initial price (0)' })
  initialPrice: number;

  @ApiProperty({ description: 'Price after base_price layer' })
  afterBasePrice: number;

  @ApiProperty({ 
    description: 'Price after membership_price layer', 
    required: false 
  })
  afterMembershipPrice?: number;

  @ApiProperty({ 
    description: 'Price after tiered_price layer', 
    required: false 
  })
  afterTieredPrice?: number;
}

export class CalculatePriceResponseDto {
  @ApiProperty({ description: 'Variant ID' })
  variantId: string;

  @ApiProperty({ description: 'Final unit price' })
  price: number;

  @ApiProperty({ 
    description: 'Total price (price * quantity)', 
    required: false 
  })
  totalPrice?: number;

  @ApiProperty({ 
    description: 'Applied rules', 
    type: [AppliedRuleDto] 
  })
  appliedRules: AppliedRuleDto[];

  @ApiProperty({ 
    description: 'Price breakdown by layer', 
    type: PriceBreakdownDto 
  })
  priceBreakdown: PriceBreakdownDto;
}

