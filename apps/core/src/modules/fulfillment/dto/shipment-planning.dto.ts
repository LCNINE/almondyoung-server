import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMinSize,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';
import { AddressDto } from './address.dto';

export class ShipmentCommandReasonDto {
  @IsString()
  @IsNotEmpty()
  reason: string;

  @IsUUID()
  @IsOptional()
  csCaseId?: string;

  @IsString()
  @IsOptional()
  note?: string;
}

export class ShipmentSplitMoveDto {
  @IsUUID()
  shipmentLineId: string;

  @IsInt()
  @Min(1)
  expectedLineVersion: number;

  @IsInt()
  @Min(1)
  qty: number;

  @IsInt()
  @Min(0)
  @IsOptional()
  targetReservedQty?: number;
}

export class SplitShipmentDto extends ShipmentCommandReasonDto {
  @IsInt()
  @Min(1)
  expectedManifestVersion: number;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ShipmentSplitMoveDto)
  moves: ShipmentSplitMoveDto[];
}

export class ReviseShipmentRecipientDto extends ShipmentCommandReasonDto {
  @IsInt()
  @Min(1)
  expectedManifestVersion: number;

  @ValidateNested()
  @Type(() => AddressDto)
  recipientSnapshot: AddressDto;
}

export class PlanShipmentDto {
  @IsUUID()
  shippingProfileId: string;

  @IsInt()
  @Min(1)
  expectedManifestVersion: number;

  @IsInt()
  @Min(1)
  expectedReservationVersion: number;
}

export class CancelShipmentLineDto {
  @IsUUID()
  shipmentLineId: string;

  @IsInt()
  @Min(1)
  expectedLineVersion: number;

  @IsInt()
  @Min(1)
  qty: number;
}

export class CancelShipmentOutstandingDto extends ShipmentCommandReasonDto {
  @IsInt()
  @Min(1)
  expectedManifestVersion: number;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CancelShipmentLineDto)
  lines: CancelShipmentLineDto[];
}

export type ShipmentPlanningActor = {
  id: string;
  roles: string[];
};

export class ShipmentLineOriginResponseDto {
  @ApiProperty()
  salesOrderLineId: string;

  @ApiProperty()
  salesOrderId: string;

  @ApiProperty()
  salesChannel: string;

  @ApiProperty()
  channelOrderId: string;

  @ApiProperty({ nullable: true })
  channelOrderItemId: string | null;

  @ApiProperty({ nullable: true })
  channelProductId: string | null;
}

export class ShipmentLineReservationResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ nullable: true })
  shipmentLineId: string | null;

  @ApiProperty()
  quantity: number;

  @ApiProperty()
  status: string;
}

export class ShipmentLineDetailResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  fulfillmentOrderId: string;

  @ApiProperty()
  fulfillmentOrderItemId: string;

  @ApiProperty()
  skuId: string;

  @ApiProperty()
  qty: number;

  @ApiProperty()
  reservedQty: number;

  @ApiProperty()
  inspectedQty: number;

  @ApiProperty()
  lineVersion: number;

  @ApiProperty({ type: ShipmentLineOriginResponseDto, nullable: true })
  origin: ShipmentLineOriginResponseDto | null;

  @ApiProperty({ type: [ShipmentLineReservationResponseDto] })
  reservations: ShipmentLineReservationResponseDto[];
}

export class ShipmentInvoiceHistoryResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  status: string;

  @ApiProperty()
  trackingNo: string;

  @ApiProperty({ nullable: true })
  carrier: string | null;

  @ApiProperty({ nullable: true })
  manifestVersion: number | null;

  @ApiProperty()
  issuedAt: Date;

  @ApiProperty({ nullable: true })
  voidedAt: Date | null;
}

export class ShipmentWorkItemHistoryResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  status: string;
}

export class ShipmentDispatchAttemptHistoryResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  attemptNo: number;

  @ApiProperty()
  status: string;

  @ApiProperty({ nullable: true })
  invoiceId: string | null;

  @ApiProperty({ nullable: true })
  dispatchedAt: Date | null;

  @ApiProperty({ nullable: true })
  recalledAt: Date | null;

  @ApiProperty({ nullable: true })
  recoveryCode: string | null;

  @ApiProperty({ type: [Object] })
  sources: Array<{
    id: string;
    shipmentLineId: string;
    sourceLocationId: string;
    quantity: number;
    stockEventId: string | null;
  }>;

  @ApiProperty({ type: [Object] })
  trackingEvents: Array<{
    id: string;
    status: string;
    location: string | null;
    timestamp: Date;
    providerEventId: string | null;
  }>;
}

export class ShipmentOperationHistoryResponseDto {
  @ApiProperty()
  operationId: string;

  @ApiProperty()
  type: string;

  @ApiProperty()
  status: string;

  @ApiProperty({ nullable: true })
  lastError: string | null;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty({ nullable: true })
  completedAt: Date | null;
}

export class ShipmentSummaryResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  status: string;

  @ApiProperty()
  warehouseId: string;

  @ApiProperty()
  manifestVersion: number;

  @ApiProperty()
  reservationVersion: number;

  @ApiProperty()
  totalQty: number;

  @ApiProperty()
  reservedQty: number;

  @ApiProperty()
  inspectedQty: number;

  @ApiProperty({ nullable: true })
  recoveryCode: string | null;
}

export class ShipmentDetailResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  status: string;

  @ApiProperty()
  warehouseId: string;

  @ApiProperty()
  manifestVersion: number;

  @ApiProperty()
  reservationVersion: number;

  @ApiProperty({ nullable: true })
  recipientSnapshot: unknown;

  @ApiProperty({ type: [ShipmentLineDetailResponseDto] })
  lines: ShipmentLineDetailResponseDto[];

  @ApiProperty({ type: [ShipmentInvoiceHistoryResponseDto] })
  invoices: ShipmentInvoiceHistoryResponseDto[];

  @ApiProperty({ type: [ShipmentWorkItemHistoryResponseDto] })
  workItems: ShipmentWorkItemHistoryResponseDto[];

  @ApiProperty({ type: [ShipmentDispatchAttemptHistoryResponseDto] })
  dispatchAttempts: ShipmentDispatchAttemptHistoryResponseDto[];

  @ApiProperty({ type: [ShipmentOperationHistoryResponseDto] })
  operations: ShipmentOperationHistoryResponseDto[];
}

export class FulfillmentOperationResponseDto {
  @ApiProperty()
  operationId: string;

  @ApiProperty()
  type: string;

  @ApiProperty()
  status: string;

  @ApiProperty({ nullable: true })
  resourceType: string | null;

  @ApiProperty({ nullable: true })
  resourceId: string | null;

  @ApiProperty({ nullable: true })
  lastError: string | null;

  @ApiProperty({ nullable: true })
  responseSnapshot: unknown;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty({ nullable: true })
  completedAt: Date | null;
}
