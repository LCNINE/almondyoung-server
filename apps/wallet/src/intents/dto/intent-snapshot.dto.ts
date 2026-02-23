import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

const SNAPSHOT_SCHEMA_VERSIONS = ['INTENT_SNAPSHOT_V1'] as const;
const INTENT_ITEM_TYPES = ['PRODUCT', 'SHIPPING_FEE'] as const;
const INTENT_ITEM_DISCOUNT_KINDS = ['ITEM_PER_UNIT', 'ITEM_FLAT'] as const;
const INTENT_ORDER_DISCOUNT_KINDS = ['ORDER'] as const;

export class IntentItemDiscountDto {
  @ApiPropertyOptional({
    description: 'Discount identifier',
    example: 'discount-item-1',
  })
  @IsString()
  @IsNotEmpty()
  @IsOptional()
  discountId?: string;

  @ApiProperty({
    description: 'Item discount kind',
    enum: INTENT_ITEM_DISCOUNT_KINDS,
    example: 'ITEM_PER_UNIT',
  })
  @IsString()
  @IsIn(INTENT_ITEM_DISCOUNT_KINDS)
  kind!: (typeof INTENT_ITEM_DISCOUNT_KINDS)[number];

  @ApiProperty({
    description: 'Discount amount (minor units)',
    minimum: 1,
    example: 1000,
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  amount!: number;
}

export class IntentOrderDiscountDto {
  @ApiPropertyOptional({
    description: 'Discount identifier',
    example: 'discount-order-1',
  })
  @IsString()
  @IsNotEmpty()
  @IsOptional()
  discountId?: string;

  @ApiProperty({
    description: 'Order discount kind',
    enum: INTENT_ORDER_DISCOUNT_KINDS,
    example: 'ORDER',
  })
  @IsString()
  @IsIn(INTENT_ORDER_DISCOUNT_KINDS)
  kind!: (typeof INTENT_ORDER_DISCOUNT_KINDS)[number];

  @ApiProperty({
    description: 'Discount amount (minor units)',
    minimum: 1,
    example: 3000,
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  amount!: number;
}

export class IntentSnapshotItemDto {
  @ApiProperty({
    description: 'Line identifier unique inside snapshot payload',
    example: 'line-1',
  })
  @IsString()
  @IsNotEmpty()
  lineId!: string;

  @ApiProperty({
    description: 'Display name',
    example: 'Front bumper',
  })
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiProperty({
    description: 'Unit price (minor units)',
    minimum: 1,
    example: 10000,
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  unitPrice!: number;

  @ApiProperty({
    description: 'Quantity',
    minimum: 1,
    example: 1,
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  quantity!: number;

  @ApiPropertyOptional({
    description: 'Item type',
    enum: INTENT_ITEM_TYPES,
    example: 'PRODUCT',
  })
  @IsString()
  @IsIn(INTENT_ITEM_TYPES)
  @IsOptional()
  type?: (typeof INTENT_ITEM_TYPES)[number];

  @ApiPropertyOptional({
    description: 'Optional domain item identifier',
    example: 'sku-123',
  })
  @IsString()
  @IsNotEmpty()
  @IsOptional()
  id?: string;

  @ApiProperty({
    description: 'Discounts applied at item level',
    type: () => [IntentItemDiscountDto],
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => IntentItemDiscountDto)
  discounts!: IntentItemDiscountDto[];
}

export class IntentSnapshotDto {
  @ApiProperty({
    description: 'Snapshot schema version',
    enum: SNAPSHOT_SCHEMA_VERSIONS,
    example: 'INTENT_SNAPSHOT_V1',
  })
  @IsString()
  @IsIn(SNAPSHOT_SCHEMA_VERSIONS)
  schemaVersion!: (typeof SNAPSHOT_SCHEMA_VERSIONS)[number];

  @ApiProperty({
    description: 'Snapshot items',
    type: () => [IntentSnapshotItemDto],
  })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => IntentSnapshotItemDto)
  items!: IntentSnapshotItemDto[];

  @ApiPropertyOptional({
    description: 'Order-level discounts',
    type: () => [IntentOrderDiscountDto],
    default: [],
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => IntentOrderDiscountDto)
  @IsOptional()
  orderDiscounts?: IntentOrderDiscountDto[];
}
