import { ApiProperty, ApiPropertyOptional, OmitType } from '@nestjs/swagger';
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

export class ConsolidationBoardQueryDto {
  @IsUUID()
  warehouseId: string;
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

  @IsString()
  @IsOptional()
  reasonCode?: string;

  @IsString()
  @IsOptional()
  requestChannel?: string;

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

export class ShipmentSplitShareDto {
  @ApiProperty({ description: '이 상자에 담긴 수량' })
  boxQty: number;
  @ApiProperty({ description: '나누기로 이어진 상자들(이미 나간 상자 포함)의 수량 합' })
  orderQty: number;
  @ApiProperty({ description: '묶음 안에서 만든 순서로 매긴 이 상자의 번호(1부터)' })
  boxNo: number;
  @ApiProperty({ description: '묶음의 살아 있는 상자 수' })
  boxCount: number;
}

export class ConsolidationItemDto {
  skuId: string;
  name: string;
  @ApiProperty({ description: '이 상자에 담긴 이 상품의 수량(같은 상품 줄을 합친 값)' })
  qty: number;
}

export class ConsolidationOptionShipmentDto {
  shipmentId: string;
  status: string;
  @ApiProperty({ type: [String], description: '고객이 아는 주문번호. 없으면 채널 주문 ID' })
  salesOrderNos: string[];
  @ApiProperty({ description: '첫 상품명 외 N건' })
  itemSummary: string;
  totalQty: number;
  @ApiProperty({ type: [ConsolidationItemDto], description: '담긴 상품별 수량' })
  items: ConsolidationItemDto[];
  @ApiProperty({ type: ConsolidationRecipientSnapshotDto, description: '상자의 수령인 스냅샷. 비어 있으면 빈 객체' })
  recipientSnapshot: ConsolidationRecipientSnapshotDto;
  @ApiProperty({ type: String, nullable: true, description: '끝나지 않은 배치 작업 항목의 배치' })
  batchId: string | null;
  @ApiProperty({ type: String, nullable: true, description: '종료되지 않은 송장의 번호' })
  waybillTrackingNo: string | null;
  manifestVersion: number;
  reservationVersion: number;
  createdAt: Date;
  @ApiProperty({
    type: ShipmentSplitShareDto,
    nullable: true,
    description: '나누기로 다른 상자와 이어져 있으면 그 몫. 아니면 null',
  })
  split: ShipmentSplitShareDto | null;
}

export class ConsolidationBoardShipmentDto extends OmitType(ConsolidationOptionShipmentDto, [
  'recipientSnapshot',
] as const) {
  @ApiProperty({ type: Date, nullable: true, description: '담긴 판매주문 중 가장 이른 주문 시각' })
  orderedAt: Date | null;
  @ApiProperty({ type: [String], description: '담긴 판매주문의 판매채널' })
  salesChannels: string[];
}

export class ConsolidationBoardGroupDto {
  @ApiProperty({ description: '묶음을 가리키는 불투명한 값' })
  key: string;
  @ApiProperty({
    type: ConsolidationRecipientSnapshotDto,
    description: '묶음의 수령인 스냅샷. 상자별 수령인은 응답에 담지 않는다',
  })
  recipientSnapshot: ConsolidationRecipientSnapshotDto;
  @ApiProperty({ description: '상자들의 배송 메모가 서로 다르면 true' })
  memoDiffers: boolean;
  @ApiProperty({ description: '전부 draft 이고 배치와 송장이 없어 지금 합칠 수 있으면 true' })
  canMergeNow: boolean;
  @ApiProperty({ type: [ConsolidationBoardShipmentDto] })
  shipments: ConsolidationBoardShipmentDto[];
}

export class ConsolidationBoardResponseDto {
  @ApiProperty({ type: [ConsolidationBoardGroupDto] })
  groups: ConsolidationBoardGroupDto[];
}

export class PlannedShipmentDto {
  @ApiProperty()
  shipmentId: string;

  @ApiProperty({ type: [String] })
  orderNos: string[];

  @ApiProperty()
  totalQty: number;
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
  @ApiProperty({ type: String, nullable: true, description: '이 상자에 담긴 주문의 번호' })
  orderNo: string | null;
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
