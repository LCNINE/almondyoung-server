import { ApiProperty } from '@nestjs/swagger';
import { IsUUID, IsNotEmpty, IsOptional, IsArray, IsNumber, Min, ValidateNested, IsIn } from 'class-validator';
import { Type } from 'class-transformer';
import { AddressDto } from './address.dto';

export class CreateFulfillmentOrderItemDto {
  @ApiProperty({ description: 'SKU ID' })
  @IsUUID()
  @IsNotEmpty()
  skuId: string;

  @ApiProperty({ description: 'Quantity', minimum: 1 })
  @IsNumber()
  @Min(1)
  quantity: number;

  @ApiProperty({ description: 'Variant ID (PIM)', required: false })
  @IsUUID()
  @IsOptional()
  variantId?: string;

  @ApiProperty({
    description: 'Not accepted for explicit item creation. Sales-order fulfillments derive items from matching.',
    required: false,
  })
  @IsUUID()
  @IsOptional()
  salesOrderLineId?: string;

  @ApiProperty({
    description: 'Not accepted for explicit item creation. Use top-level salesOrderId without items.',
    required: false,
  })
  @IsUUID()
  @IsOptional()
  salesOrderId?: string;
}

/** @deprecated Use CreateFulfillmentOrderItemDto instead */
export class CreateFulfillmentOrderLineDto {
  @ApiProperty({ description: 'SKU ID' })
  @IsUUID()
  @IsNotEmpty()
  skuId: string;

  @ApiProperty({ description: 'Quantity', minimum: 1 })
  @IsNumber()
  @Min(1)
  quantity: number;
}

export class CreateFulfillmentOrderDto {
  @ApiProperty({ description: 'Sales Order ID — 필수. 없으면 400 FULFILLMENT_REQUIRES_SALES_ORDER (K6 PR4)', required: false })
  @IsUUID()
  @IsOptional()
  salesOrderId?: string;

  @ApiProperty({ description: 'Warehouse ID', required: false })
  @IsUUID()
  @IsOptional()
  warehouseId?: string;

  @ApiProperty({ description: 'Owner ID (for 3PL)', required: false })
  @IsUUID()
  @IsOptional()
  ownerId?: string;

  @ApiProperty({
    description:
      'Fulfillment Mode — 기본 in_house. drop_ship 은 받지 않는다(400): 직배분은 FO 모드가 아니라 입점사 상자로 나뉜다(ADR-0050 §2)',
    enum: ['in_house', '3pl'],
    required: false,
  })
  @IsIn(['in_house', '3pl'])
  @IsOptional()
  fulfillmentMode?: 'in_house' | '3pl';

  @ApiProperty({ description: 'Priority', enum: ['normal', 'high', 'urgent'], required: false })
  @IsIn(['normal', 'high', 'urgent'])
  @IsOptional()
  priority?: 'normal' | 'high' | 'urgent';

  @ApiProperty({ description: 'Shipping address', type: AddressDto, required: false })
  @ValidateNested()
  @Type(() => AddressDto)
  @IsOptional()
  shippingAddress?: AddressDto;

  @ApiProperty({
    description: 'Not accepted (400). Fulfillment orders are created only from salesOrderId; items derive from product-SKU matching (K6 PR4).',
    type: [CreateFulfillmentOrderItemDto],
    required: false,
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateFulfillmentOrderItemDto)
  @IsOptional()
  items?: CreateFulfillmentOrderItemDto[];

  /** @deprecated Use items instead */
  @ApiProperty({
    description: 'Not accepted (400). Fulfillment orders are created only from salesOrderId (K6 PR4).',
    type: [CreateFulfillmentOrderLineDto],
    required: false,
    deprecated: true,
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateFulfillmentOrderLineDto)
  @IsOptional()
  lines?: CreateFulfillmentOrderLineDto[];
}
