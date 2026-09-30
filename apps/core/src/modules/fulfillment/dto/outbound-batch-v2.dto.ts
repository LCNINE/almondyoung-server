import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDate, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';
import { pickingMethodValues, type PickingMethodEnum } from '../../inventory/schema/enum-values';

export type OutboundBatchActor = {
  id: string;
  roles: string[];
};

export class CreateOutboundBatchV2Dto {
  @IsUUID()
  warehouseId: string;

  @ApiProperty({ enum: pickingMethodValues })
  @IsIn(pickingMethodValues)
  pickingMethod: PickingMethodEnum;

  /** multi_order 전용 — 카트 바구니 수 = 이 배치에 담을 수 있는 송장 수 상한. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(2147483647)
  cartCapacity?: number;

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
  waybillId: string;
  trackingNo: string;
}

export class BatchPickingAllocationDto {
  id: string;
  workItemId: string;
  shipmentLineId: string;
  skuId: string;
  sourceLocationId: string;
  qty: number;
  sourceStockVersion: number;
  createdAt: Date;
}

export class BatchPickingSnapshotDto {
  @ApiProperty({ enum: ['discrete', 'aggregate_then_sort', 'pick_to_tote'] })
  strategy: 'discrete' | 'aggregate_then_sort' | 'pick_to_tote';
  startedAt: Date;
  @ApiProperty({ type: [BatchPickingAllocationDto] })
  allocations: BatchPickingAllocationDto[];
}

export class OutboundBatchV2DetailDto {
  id: string;
  batchNumber: string;
  name: string;
  warehouseId: string;
  @ApiProperty({ enum: pickingMethodValues })
  pickingMethod: PickingMethodEnum;
  @ApiPropertyOptional({ type: Number, nullable: true })
  cartCapacity: number | null;
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

  @ApiProperty({ type: Object })
  warehouse: {
    id: string;
    name: string;
    supportedPickingStrategies: Array<'discrete' | 'aggregate_then_sort' | 'pick_to_tote'>;
  };

  @ApiProperty({ type: BatchPickingSnapshotDto, nullable: true })
  picking: BatchPickingSnapshotDto | null;

  @ApiProperty({ type: Object, nullable: true })
  inventorySession: {
    id: string;
    status: string;
    version: number;
    handedInQty: number;
    handedBackQty: number;
    settledQty: number;
    returnedQty: number;
    shortageQty: number;
    recoveryReason: string | null;
    balances: Array<Record<string, unknown>>;
  } | null;

  @ApiProperty({ type: [Object] })
  toteAssignments: Array<{
    id: string;
    shipmentId: string;
    toteId: string;
    toteBarcode: string;
    toteStatus: string;
    assignedBy: string;
    assignedAt: Date;
    releasedAt: Date | null;
  }>;
}

export class OutboundBatchV2ListItemDto {
  id: string;
  batchNumber: string;
  name: string;
  warehouseId: string;
  status: string;
  @ApiProperty({ enum: pickingMethodValues })
  pickingMethod: PickingMethodEnum;
  @ApiPropertyOptional({ type: Number, nullable: true })
  cartCapacity: number | null;
  totalItems: number;
  totalQty: number;
  scheduledPickingAt: Date | null;
  @ApiPropertyOptional({
    type: Date,
    nullable: true,
    description: '「작업 시작」 시각. null 이면 시작 전 — 송장 인쇄를 켜지 않는다',
  })
  startedAt: Date | null;
  createdAt: Date;
}
