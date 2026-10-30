import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
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
import { ConsolidationOptionReason } from '../services/consolidation-options';
import { shipmentOperationStatusEnum } from '../../inventory/schema/inventory.schema';

export type ShipmentOperationStatus = (typeof shipmentOperationStatusEnum.enumValues)[number];

export class ConsolidationCandidateQueryDto {
  @IsUUID()
  warehouseId: string;

  @IsUUID()
  @IsOptional()
  sourceShipmentId?: string;
}

export class ConsolidationOptionsQueryDto {
  @IsUUID()
  shipmentId: string;
}

export class ConsolidationSourceDto {
  @IsUUID()
  shipmentId: string;

  @IsInt()
  @Min(1)
  expectedManifestVersion: number;

  @IsInt()
  @Min(1)
  expectedReservationVersion: number;
}

export class CreateConsolidationDto {
  @IsArray()
  @ArrayMinSize(2)
  @ValidateNested({ each: true })
  @Type(() => ConsolidationSourceDto)
  sources: ConsolidationSourceDto[];

  @IsUUID()
  @IsOptional()
  recipientSourceShipmentId?: string;

  @ValidateNested()
  @Type(() => AddressDto)
  @IsOptional()
  recipientSnapshot?: AddressDto;

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

export type ConsolidationActor = {
  id: string;
  roles: string[];
};

/** 상자에 저장된 수령인 스냅샷. 오래된 상자는 일부 칸이 비거나 통째로 빈 객체일 수 있다 */
export class ConsolidationRecipientSnapshotDto {
  @ApiPropertyOptional({ description: '수령인 이름' })
  recipientName?: string;
  @ApiPropertyOptional({ description: '수령인 연락처' })
  phone?: string;
  @ApiPropertyOptional({ description: '우편번호' })
  postalCode?: string;
  @ApiPropertyOptional({ description: '도로명 주소' })
  roadAddress?: string;
  @ApiPropertyOptional({ description: '상세 주소' })
  detailAddress?: string;
  @ApiPropertyOptional({ description: '배송 메모' })
  deliveryNote?: string;
  @ApiPropertyOptional({ description: '개인통관고유부호' })
  personalCustomsCode?: string;
}

export class ConsolidationOptionShipmentDto {
  shipmentId: string;
  status: string;
  @ApiProperty({ type: [String], description: '고객이 아는 주문번호. 없으면 채널 주문 ID' })
  salesOrderNos: string[];
  @ApiProperty({ description: '첫 상품명 외 N건' })
  itemSummary: string;
  totalQty: number;
  @ApiProperty({ type: ConsolidationRecipientSnapshotDto, description: '상자의 수령인 스냅샷. 비어 있으면 빈 객체' })
  recipientSnapshot: ConsolidationRecipientSnapshotDto;
  @ApiProperty({ type: String, nullable: true, description: '끝나지 않은 배치 작업 항목의 배치' })
  batchId: string | null;
  @ApiProperty({ type: String, nullable: true, description: '종료되지 않은 송장의 번호' })
  waybillTrackingNo: string | null;
  manifestVersion: number;
  reservationVersion: number;
  createdAt: Date;
}

export class ConsolidationOptionDto extends ConsolidationOptionShipmentDto {
  @ApiProperty({ enum: ['ok', 'memo_differs', 'address_differs', 'incomplete_recipient', 'unknown_customer'] })
  reason: ConsolidationOptionReason;
  selectable: boolean;
}

export class ConsolidationOptionsResponseDto {
  @ApiProperty({ type: ConsolidationOptionShipmentDto })
  source: ConsolidationOptionShipmentDto;
  @ApiProperty({ type: [ConsolidationOptionDto] })
  options: ConsolidationOptionDto[];
}

/** 합포장 진행의 원본 하나. 수령인은 담지 않는다 */
export class ConsolidationProgressSourceDto {
  shipmentId: string;
  @ApiProperty({ type: String, nullable: true, description: '종료되지 않은 송장의 번호' })
  trackingNo: string | null;
  @ApiProperty({ type: String, nullable: true, description: '빠지지 않은 배치 작업 항목의 배치' })
  batchId: string | null;
  @ApiProperty({ type: String, nullable: true })
  workItemStatus: string | null;
  @ApiProperty({ type: String, nullable: true, description: '종료되지 않은 송장' })
  waybillId: string | null;
  @ApiProperty({ type: String, nullable: true })
  waybillStatus: string | null;
  @ApiProperty({ type: [String], description: '재개를 막는 사유. 끝난 작업이면 빈 배열' })
  blockers: string[];
  @ApiProperty({ type: String, nullable: true, description: '리컨실러가 자동 재개를 포기한 시각' })
  gaveUpAt: string | null;
  @ApiProperty({ type: String, nullable: true, description: '리컨실러의 다음 재확인 시각' })
  nextCheckAt: string | null;
}

export class ConsolidationProgressResponseDto {
  operationId: string;
  @ApiProperty({ enum: shipmentOperationStatusEnum.enumValues, description: '가장 최근 작업의 실제 상태' })
  status: ShipmentOperationStatus;
  @ApiProperty({ type: String, nullable: true, description: '완료되면 합쳐진 새 상자. 그 밖의 상태는 null' })
  targetShipmentId: string | null;
  @ApiProperty({ type: [ConsolidationProgressSourceDto] })
  sources: ConsolidationProgressSourceDto[];
}
