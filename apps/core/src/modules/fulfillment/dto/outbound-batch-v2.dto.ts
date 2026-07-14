import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDate, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, IsUUID, Min } from 'class-validator';

export type OutboundBatchActor = {
  id: string;
  roles: string[];
};

export class CreateOutboundBatchV2Dto {
  @IsUUID()
  warehouseId: string;

  @ApiProperty({ enum: ['individual'] })
  @IsIn(['individual'])
  pickingMethod: 'individual';

  @IsString()
  @IsNotEmpty()
  @IsOptional()
  name?: string;

  @Type(() => Date)
  @IsDate()
  @IsOptional()
  scheduledPickingAt?: Date;
}

export class ExcludeShipmentFromBatchDto {
  @IsString()
  @IsNotEmpty()
  reason: string;
}

export class ClaimBatchWorkItemDto {
  @IsInt()
  @Min(0)
  expectedLeaseVersion: number;
}

export class HandoffBatchWorkItemDto extends ClaimBatchWorkItemDto {
  @ApiProperty({ enum: ['picker', 'packer'] })
  @IsIn(['picker', 'packer'])
  claimType: 'picker' | 'packer';

  @IsUUID()
  targetWorkerId: string;

  @IsString()
  @IsNotEmpty()
  reason: string;
}

export class BatchClaimStateDto {
  @ApiProperty({ enum: ['unclaimed', 'active', 'expired', 'released'] })
  state: 'unclaimed' | 'active' | 'expired' | 'released';

  @ApiProperty({ nullable: true })
  workerId: string | null;

  @ApiProperty({ nullable: true })
  claimedAt: Date | null;

  @ApiProperty({ nullable: true })
  releasedAt: Date | null;

  @ApiProperty({ nullable: true })
  leaseExpiresAt: Date | null;
}

export class OutboundBatchWorkItemResponseDto {
  id: string;
  batchId: string;
  shipmentId: string;
  status: string;
  leaseVersion: number;
  pickerId: string | null;
  pickerClaimedAt: Date | null;
  pickerReleasedAt: Date | null;
  packerId: string | null;
  packerClaimedAt: Date | null;
  packerReleasedAt: Date | null;
  handedOffAt: Date | null;
  completedAt: Date | null;
  leaseExpiresAt: Date | null;
  exclusionReason: string | null;
  recoveryReason: string | null;
  waitingOperationId: string | null;
  pickerClaim: BatchClaimStateDto;
  packerClaim: BatchClaimStateDto;
}

export class OutboundBatchCommandResponseDto {
  @IsUUID()
  operationId: string;

  @ApiProperty({ type: OutboundBatchWorkItemResponseDto })
  workItem: OutboundBatchWorkItemResponseDto;
}

export class CreateOutboundBatchV2ResponseDto {
  operationId: string;
  batchId: string;
}

export class EligibleShipmentResponseDto {
  shipmentId: string;
  warehouseId: string;
  shippingProfileId: string;
  manifestVersion: number;
  reservationVersion: number;
  recipientHash: string;
  totalItems: number;
  totalQty: number;
  invoiceId: string;
  trackingNo: string;
}

export class OutboundBatchV2DetailDto {
  id: string;
  batchNumber: string;
  name: string;
  warehouseId: string;
  pickingMethod: string;
  status: 'created' | 'picking' | 'completed' | 'canceled';
  totalItems: number;
  totalQty: number;
  @ApiPropertyOptional()
  scheduledPickingAt?: Date;
  @ApiPropertyOptional()
  startedAt?: Date;
  @ApiPropertyOptional()
  completedAt?: Date;
  @ApiProperty({ type: [OutboundBatchWorkItemResponseDto] })
  workItems: OutboundBatchWorkItemResponseDto[];
}
