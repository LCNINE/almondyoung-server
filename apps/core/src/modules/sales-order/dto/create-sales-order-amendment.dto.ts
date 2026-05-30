import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';

export type SalesOrderAmendmentKind = 'commercial' | 'fulfillment_only';
export type SalesOrderAmendmentDecision = 'approved' | 'rejected' | 'pending';
export type SalesOrderAmendmentDeltaType =
  | 'add_product'
  | 'replace_product'
  | 'quantity_correction'
  | 'amount_correction'
  | 'fulfillment_only_correction';

export class SalesOrderAmendmentDeltaDto {
  @ApiProperty({
    description: 'Delta type',
    enum: ['add_product', 'replace_product', 'quantity_correction', 'amount_correction', 'fulfillment_only_correction'],
  })
  @IsIn(['add_product', 'replace_product', 'quantity_correction', 'amount_correction', 'fulfillment_only_correction'])
  type: SalesOrderAmendmentDeltaType;

  @ApiProperty({ description: 'Original SalesOrder line ID when the delta targets an accepted line', required: false })
  @IsUUID()
  @IsOptional()
  salesOrderLineId?: string;

  @ApiProperty({ description: 'Replacement source line ID for replace_product deltas', required: false })
  @IsUUID()
  @IsOptional()
  replacementForLineId?: string;

  @ApiProperty({ description: 'PIM variant ID for add_product or replace_product deltas', required: false })
  @IsUUID()
  @IsOptional()
  variantId?: string;

  @ApiProperty({ description: 'Operator-facing product name snapshot', required: false })
  @IsString()
  @IsOptional()
  productName?: string;

  @ApiProperty({ description: 'Requested quantity for product deltas', required: false, minimum: 1 })
  @IsInt()
  @Min(1)
  @IsOptional()
  quantity?: number;

  @ApiProperty({ description: 'Signed quantity delta for corrections', required: false })
  @IsInt()
  @IsOptional()
  quantityDelta?: number;

  @ApiProperty({ description: 'Corrected final quantity for corrections', required: false })
  @IsInt()
  @Min(0)
  @IsOptional()
  correctedQuantity?: number;

  @ApiProperty({ description: 'Unit price snapshot for added or replacement products', required: false })
  @IsInt()
  @Min(0)
  @IsOptional()
  unitPrice?: number;

  @ApiProperty({ description: 'Total price snapshot for added or replacement products', required: false })
  @IsInt()
  @Min(0)
  @IsOptional()
  totalPrice?: number;

  @ApiProperty({ description: 'Signed amount delta for amount corrections', required: false })
  @IsInt()
  @IsOptional()
  amountDelta?: number;

  @ApiProperty({ description: 'Corrected final amount for amount corrections', required: false })
  @IsInt()
  @Min(0)
  @IsOptional()
  correctedAmount?: number;

  @ApiProperty({ description: 'Fulfillment instruction for fulfillment-only corrections', required: false })
  @IsString()
  @IsOptional()
  fulfillmentInstruction?: string;

  @ApiProperty({ description: 'Delta reason', required: false })
  @IsString()
  @IsOptional()
  reason?: string;

  @ApiProperty({ description: 'Delta metadata', required: false })
  @IsObject()
  @IsOptional()
  metadata?: Record<string, unknown>;
}

export class CreateSalesOrderAmendmentDto {
  @ApiProperty({ description: 'Accepted SalesOrder ID' })
  @IsUUID()
  salesOrderId: string;

  @ApiProperty({ description: 'Commercial impact classification', enum: ['commercial', 'fulfillment_only'] })
  @IsIn(['commercial', 'fulfillment_only'])
  amendmentKind: SalesOrderAmendmentKind;

  @ApiProperty({ description: 'Operator decision', enum: ['approved', 'rejected', 'pending'], required: false })
  @IsIn(['approved', 'rejected', 'pending'])
  @IsOptional()
  decision?: SalesOrderAmendmentDecision;

  @ApiProperty({ description: 'Reason code', required: false })
  @IsString()
  @IsOptional()
  reasonCode?: string;

  @ApiProperty({ description: 'Operator note', required: false })
  @IsString()
  @IsOptional()
  note?: string;

  @ApiProperty({ description: 'Typed amendment deltas', type: [SalesOrderAmendmentDeltaDto], minItems: 1 })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => SalesOrderAmendmentDeltaDto)
  deltas: SalesOrderAmendmentDeltaDto[];

  @ApiProperty({ description: 'Business event time', required: false, type: String, format: 'date-time' })
  @IsDateString()
  @IsOptional()
  occurredAt?: string;

  @ApiProperty({ description: 'Amendment metadata', required: false })
  @IsObject()
  @IsOptional()
  metadata?: Record<string, unknown>;
}
