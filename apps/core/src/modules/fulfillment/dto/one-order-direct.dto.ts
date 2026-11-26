import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength, Min, ValidateIf } from 'class-validator';
import { carrierEnum } from '../../inventory/schema/inventory.schema';
import type { CarrierCode } from '../waybill/carrier/carrier-gateway.interface';
import { ShipmentCommandReasonDto } from './shipment-planning.dto';

const CARRIERS = carrierEnum.enumValues;

/** 송장 칸 — 둘 다 넣거나 둘 다 비운다. */
export class DirectDeliveryTrackingDto {
  @ApiProperty({ enum: CARRIERS })
  @IsIn(CARRIERS)
  carrier: CarrierCode;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  trackingNo: string;
}

/** 송장 입력 — 창을 열 때 본 상자 구성 버전을 함께 보낸다. */
export class DirectDeliveryDispatchDto extends DirectDeliveryTrackingDto {
  @ApiProperty({ description: '창을 열 때 본 상자 구성 버전' })
  @IsInt()
  @Min(1)
  expectedManifestVersion: number;
}

export class DirectDeliveryTakeoverDto extends ShipmentCommandReasonDto {
  @ApiProperty()
  @IsUUID()
  supplierId: string;

  @ApiProperty({ description: '창을 열 때 본 상자 구성 버전' })
  @IsInt()
  @Min(1)
  expectedManifestVersion: number;

  @ApiPropertyOptional({ enum: CARRIERS })
  @ValidateIf((dto: DirectDeliveryTakeoverDto) => dto.trackingNo !== undefined)
  @IsIn(CARRIERS)
  carrier?: CarrierCode;

  @ApiPropertyOptional()
  @ValidateIf((dto: DirectDeliveryTakeoverDto) => dto.carrier !== undefined)
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  trackingNo?: string;
}

export class DirectDeliveryReturnDto extends ShipmentCommandReasonDto {
  @ApiProperty({ description: '창을 열 때 본 상자 구성 버전' })
  @IsInt()
  @Min(1)
  expectedManifestVersion: number;
}

export class DirectDeliveryTakeoverResultDto {
  @ApiProperty({ description: '공급처가 보낼 새 상자' })
  shipmentId: string;

  @ApiProperty({ description: '넘기기 전 창고 상자(이제 대체됨)' })
  previousShipmentId: string;

  @ApiProperty()
  releasedQty: number;

  @ApiProperty()
  dispatched: boolean;

  @ApiProperty()
  operationId: string;
}

export class DirectDeliveryDispatchResultDto {
  @ApiProperty()
  shipmentId: string;

  @ApiProperty()
  waybillId: string;

  @ApiProperty({ description: '이번에 넘김 기록을 새로 남겼는가(대기 상자)' })
  handedOffNow: boolean;
}

export class DirectDeliveryReturnResultDto {
  @ApiProperty({ description: '창고가 보낼 새 상자' })
  shipmentId: string;

  @ApiProperty()
  previousShipmentId: string;

  @ApiProperty({ description: '공급처에 이미 넘긴 상자였는가 — 그렇다면 공급처에 보내지 말라고 알려야 한다' })
  wasHandedOff: boolean;

  @ApiProperty()
  operationId: string;
}

export class DirectDeliveryLineDto {
  @ApiProperty()
  lineId: string;
  @ApiProperty()
  skuId: string;
  @ApiProperty()
  skuName: string;
  @ApiProperty()
  qty: number;
  @ApiProperty({ description: '지금 잡은 재고 — 넘기면 풀린다' })
  reservedQty: number;
  @ApiProperty({ type: String, nullable: true, description: '상품에 연결된 공급처' })
  linkedSupplierId: string | null;
}

export class DirectDeliverySupplierOptionDto {
  @ApiProperty()
  id: string;
  @ApiProperty()
  name: string;
}

export class DirectDeliveryRecipientDto {
  @ApiProperty()
  name: string;
  @ApiProperty()
  phone: string;
  @ApiProperty()
  address: string;
  @ApiProperty()
  memo: string;
  @ApiProperty()
  entrancePassword: string;
}

export class DirectDeliveryBlockerDto {
  @ApiProperty({
    enum: [
      'not_draft',
      'recovery',
      'active_waybill',
      'active_work',
      'drop_shipped',
      'sellmate_handed_over',
      'recipient_incomplete',
      'no_warehouse',
    ],
  })
  code: string;

  @ApiPropertyOptional({ type: String, nullable: true, description: '상자가 든 배치(있으면)' })
  batchId?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  batchNo?: string | null;
}

export class DirectDeliveryPreviewDto {
  @ApiProperty()
  shipmentId: string;
  @ApiProperty({ enum: ['warehouse', 'supplier'] })
  owner: 'warehouse' | 'supplier';
  @ApiProperty()
  status: string;
  @ApiProperty()
  manifestVersion: number;
  @ApiProperty({ type: String, nullable: true })
  supplierId: string | null;
  @ApiProperty({ description: '공급처에 넘긴 기록이 있는가' })
  handedOff: boolean;
  @ApiProperty()
  salesOrderId: string;
  @ApiProperty({ description: '상자 상세 주소에 쓰는 출고주문' })
  fulfillmentOrderId: string;
  @ApiProperty({ type: String, nullable: true })
  orderNo: string | null;
  @ApiProperty({ type: [DirectDeliveryLineDto] })
  lines: DirectDeliveryLineDto[];
  @ApiProperty({ type: String, nullable: true, description: '줄마다 연결된 공급처가 모두 같을 때 그 공급처' })
  suggestedSupplierId: string | null;
  @ApiProperty({ type: [DirectDeliverySupplierOptionDto] })
  suppliers: DirectDeliverySupplierOptionDto[];
  @ApiProperty({ type: DirectDeliveryRecipientDto, nullable: true })
  recipient: DirectDeliveryRecipientDto | null;
  @ApiProperty({
    type: [DirectDeliveryBlockerDto],
    description: '맡기기(창고 상자) 또는 되돌리기(공급처 상자)를 막는 것',
  })
  blockers: DirectDeliveryBlockerDto[];
  @ApiProperty({
    type: [DirectDeliveryBlockerDto],
    description: '송장 입력을 막는 것(공급처 상자만, 창고 상자는 빈 목록)',
  })
  dispatchBlockers: DirectDeliveryBlockerDto[];
}

export class DirectDeliveryAwaitingItemDto {
  @ApiProperty()
  shipmentId: string;
  @ApiProperty()
  manifestVersion: number;
  @ApiProperty()
  salesOrderId: string;
  @ApiProperty()
  fulfillmentOrderId: string;
  @ApiProperty({ type: String, nullable: true })
  orderNo: string | null;
  @ApiProperty()
  supplierId: string;
  @ApiProperty()
  supplierName: string;
  @ApiProperty({ description: '넘긴 시각' })
  handedOffAt: string;
  @ApiProperty({ type: String, nullable: true })
  handedOffBy: string | null;
  @ApiProperty({ description: '대표 상품 이름' })
  firstSkuName: string;
  @ApiProperty()
  lineCount: number;
  @ApiProperty()
  totalQty: number;
}

export class DirectDeliveryAwaitingDto {
  @ApiProperty({ type: [DirectDeliveryAwaitingItemDto], description: '오래 기다린 것부터' })
  items: DirectDeliveryAwaitingItemDto[];
}
