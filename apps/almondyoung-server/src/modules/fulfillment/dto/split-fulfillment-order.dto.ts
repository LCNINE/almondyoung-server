import { ApiProperty } from '@nestjs/swagger';
import { IsUUID, IsNotEmpty, IsArray, IsNumber, Min, ValidateNested, IsOptional } from 'class-validator';
import { Type } from 'class-transformer';

export class SplitFulfillmentOrderItemDto {
  @ApiProperty({ description: 'Fulfillment Order Item ID' })
  @IsUUID()
  @IsNotEmpty()
  fulfillmentOrderItemId: string;

  @ApiProperty({ description: 'Quantity to split', minimum: 1 })
  @IsNumber()
  @Min(1)
  quantity: number;
}

/** @deprecated Use SplitFulfillmentOrderItemDto instead */
export class SplitFulfillmentOrderLineDto {
  @ApiProperty({ description: 'Fulfillment Order Line ID (deprecated)' })
  @IsUUID()
  @IsNotEmpty()
  fulfillmentOrderLineId: string;

  @ApiProperty({ description: 'Quantity to split', minimum: 1 })
  @IsNumber()
  @Min(1)
  quantity: number;
}

export class SplitFulfillmentOrderDto {
  @ApiProperty({ description: 'Items to split', type: [SplitFulfillmentOrderItemDto], required: false })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SplitFulfillmentOrderItemDto)
  @IsOptional()
  items?: SplitFulfillmentOrderItemDto[];

  /** @deprecated Use items instead */
  @ApiProperty({
    description: 'Lines to split (deprecated, use items instead)',
    type: [SplitFulfillmentOrderLineDto],
    required: false,
    deprecated: true,
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SplitFulfillmentOrderLineDto)
  @IsOptional()
  lines?: SplitFulfillmentOrderLineDto[];
}
