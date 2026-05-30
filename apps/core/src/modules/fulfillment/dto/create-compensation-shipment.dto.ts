import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';
import { AddressDto } from './address.dto';

export class CompensationShipmentItemDto {
  @ApiProperty({ description: 'PIM variant ID to ship as compensation' })
  @IsUUID()
  variantId: string;

  @ApiProperty({ description: 'Compensation quantity', minimum: 1 })
  @IsInt()
  @Min(1)
  quantity: number;

  @ApiProperty({ description: 'Original SalesOrder line ID when this compensates an accepted line', required: false })
  @IsUUID()
  @IsOptional()
  salesOrderLineId?: string;
}

export class CreateCompensationShipmentDto {
  @ApiProperty({ description: 'Accepted SalesOrder ID' })
  @IsUUID()
  salesOrderId: string;

  @ApiProperty({ description: 'Existing Fulfillment Order ID to link instead of creating one', required: false })
  @IsUUID()
  @IsOptional()
  fulfillmentOrderId?: string;

  @ApiProperty({
    description: 'Items to create as a compensation Fulfillment Order. Required when fulfillmentOrderId is omitted.',
    type: [CompensationShipmentItemDto],
    required: false,
  })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CompensationShipmentItemDto)
  @IsOptional()
  items?: CompensationShipmentItemDto[];

  @ApiProperty({ description: 'Warehouse ID', required: false })
  @IsUUID()
  @IsOptional()
  warehouseId?: string;

  @ApiProperty({ description: 'Owner ID for 3PL shipments', required: false })
  @IsUUID()
  @IsOptional()
  ownerId?: string;

  @ApiProperty({ description: 'Fulfillment mode', enum: ['in_house', '3pl', 'drop_ship'], required: false })
  @IsIn(['in_house', '3pl', 'drop_ship'])
  @IsOptional()
  fulfillmentMode?: 'in_house' | '3pl' | 'drop_ship';

  @ApiProperty({ description: 'Priority', enum: ['normal', 'high', 'urgent'], required: false })
  @IsIn(['normal', 'high', 'urgent'])
  @IsOptional()
  priority?: 'normal' | 'high' | 'urgent';

  @ApiProperty({ description: 'Shipping address override', type: AddressDto, required: false })
  @ValidateNested()
  @Type(() => AddressDto)
  @IsOptional()
  shippingAddress?: AddressDto;

  @ApiProperty({ description: 'Reason code', required: false })
  @IsString()
  @IsOptional()
  reasonCode?: string;

  @ApiProperty({ description: 'Operator note', required: false })
  @IsString()
  @IsOptional()
  note?: string;

  @ApiProperty({ description: 'Fulfillment instruction shown on the amendment', required: false })
  @IsString()
  @IsOptional()
  fulfillmentInstruction?: string;

  @ApiProperty({ description: 'Business event time', required: false, type: String, format: 'date-time' })
  @IsDateString()
  @IsOptional()
  occurredAt?: string;

  @ApiProperty({ description: 'Workflow metadata', required: false })
  @IsObject()
  @IsOptional()
  metadata?: Record<string, unknown>;
}
