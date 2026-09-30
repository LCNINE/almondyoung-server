import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsInt, IsNotEmpty, IsString, IsUUID, Matches, MaxLength, Min } from 'class-validator';

const PHYSICAL_CART_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export class StartPickingV2Dto {
  @IsUUID()
  batchId: string;
}

export class ScanPickingV2Dto {
  @IsUUID()
  batchId: string;
  @IsUUID()
  sessionId: string;
  @IsUUID()
  workItemId: string;
  @IsUUID()
  shipmentId: string;
  @IsUUID()
  shipmentLineId: string;
  @IsUUID()
  skuId: string;
  @IsUUID()
  sourceLocationId: string;
  @IsInt()
  @Min(1)
  quantity: number;
  @IsInt()
  @Min(0)
  expectedLeaseVersion: number;
}

export class HandoffPickingV2Dto {
  @IsUUID()
  batchId: string;
  @IsUUID()
  sessionId: string;
  @IsUUID()
  workItemId: string;
  @IsUUID()
  shipmentId: string;
  @IsUUID()
  targetWorkerId: string;
  @IsInt()
  @Min(0)
  expectedLeaseVersion: number;
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason: string;
}

export class CompletePickingV2Dto {
  @IsUUID()
  batchId: string;
  @IsUUID()
  sessionId: string;
  @IsUUID()
  workItemId: string;
  @IsUUID()
  shipmentId: string;
  @IsInt()
  @Min(0)
  expectedLeaseVersion: number;
}

export class AggregateBulkCartScanDto {
  @IsUUID()
  batchId: string;

  @IsUUID()
  sessionId: string;

  @IsUUID()
  skuId: string;

  @IsUUID()
  sourceLocationId: string;

  @IsString()
  @Matches(PHYSICAL_CART_ID)
  cartId: string;

  @IsInt()
  @Min(1)
  quantity: number;
}

export class AggregateSortScanDto {
  @IsUUID()
  batchId: string;

  @IsUUID()
  sessionId: string;

  @IsUUID()
  workItemId: string;

  @IsUUID()
  shipmentId: string;

  @IsUUID()
  shipmentLineId: string;

  @IsUUID()
  skuId: string;

  @IsString()
  @Matches(PHYSICAL_CART_ID)
  cartId: string;

  @IsInt()
  @Min(1)
  quantity: number;

  @IsInt()
  @Min(0)
  expectedLeaseVersion: number;

  @ApiProperty({ enum: ['SORTING', 'PACKING'] })
  @IsIn(['SORTING', 'PACKING'])
  destinationCustody: 'SORTING' | 'PACKING';
}

export class AggregateCartHandoffDto {
  @IsUUID()
  batchId: string;

  @IsUUID()
  sessionId: string;

  @IsUUID()
  expectedOwnerId: string;

  @IsUUID()
  targetWorkerId: string;

  @IsString()
  @Matches(PHYSICAL_CART_ID)
  cartId: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason: string;
}

export class AggregateCartSurplusReturnDto {
  @IsUUID()
  batchId: string;

  @IsUUID()
  sessionId: string;

  @IsString()
  @Matches(PHYSICAL_CART_ID)
  cartId: string;

  @IsUUID()
  skuId: string;

  @IsUUID()
  sourceLocationId: string;

  @IsInt()
  @Min(1)
  quantity: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  returnBinBarcode: string;
}
