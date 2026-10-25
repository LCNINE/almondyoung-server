import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { carrierEnum } from '../../inventory/schema/inventory.schema';
import type { CarrierCode } from '../waybill/carrier/carrier-gateway.interface';
import type { SupplierRowErrorCode, SupplierRowVerdictKind } from '../supplier-shipment/supplier-sheet.judge';

// 판정 종류·오류 코드의 Swagger enum — 객체 키로 적어 유니언과 컴파일 때 맞물린다(하나라도 빠지거나 남으면 타입 오류)
const VERDICT_KINDS: Record<SupplierRowVerdictKind, true> = {
  ship: true,
  merge: true,
  unfulfillable: true,
  waiting: true,
  correct: true,
  unchanged: true,
  error: true,
};
const ROW_ERROR_CODES: Record<SupplierRowErrorCode, true> = {
  UNKNOWN_ROW_KEY: true,
  OTHER_SUPPLIER: true,
  CANCELED: true,
  NOT_HANDED_OFF: true,
  IN_RECOVERY: true,
  ROW_MISMATCH: true,
  QTY_MISMATCH: true,
  DUPLICATE_ROW: true,
  UNKNOWN_CARRIER: true,
  CARRIER_WITHOUT_TRACKING: true,
  TRACKING_WITHOUT_CARRIER: true,
  TRACKING_AND_REASON: true,
  TRACKING_IN_USE: true,
  MERGE_RECIPIENT_MISMATCH: true,
  CORRECTION_PARTIAL: true,
  REASON_ON_SHIPPED: true,
  GROUP_HAS_ERROR: true,
};

export class SupplierSheetColumnDto {
  @ApiProperty() key!: string;
  @ApiProperty() header!: string;
}

export class SupplierSheetRowDto {
  @ApiProperty({ description: '행 키 = 발주 항목(FOI) id. 입점사가 지우면 안 된다' }) rowKey!: string;
  @ApiProperty() orderNo!: string;
  @ApiProperty() productName!: string;
  @ApiProperty({ description: '그 입점사와의 sku_suppliers.supplier_sku (없으면 빈 문자열)' }) supplierSku!: string;
  @ApiProperty() qty!: number;
  @ApiProperty() recipientName!: string;
  @ApiProperty() recipientPhone!: string;
  @ApiProperty() address!: string;
  @ApiProperty() entrancePassword!: string;
  @ApiProperty() deliveryMemo!: string;
  @ApiProperty({ description: '입점사가 채우는 칸 — 내려받을 때는 빈 문자열' }) carrier!: string;
  @ApiProperty({ description: '입점사가 채우는 칸 — 내려받을 때는 빈 문자열' }) trackingNo!: string;
  @ApiProperty({ description: '이미 알린 «못 보냄» 사유(없으면 빈 문자열)' }) unfulfillableReason!: string;
  @ApiProperty({ description: '개인정보 접속기록의 대상 식별자 — 시트 열이 아니다' }) salesOrderId!: string;
}

export class SupplierSheetSkippedShipmentDto {
  @ApiProperty() shipmentId!: string;
  @ApiProperty({ enum: ['RECIPIENT_INCOMPLETE'] }) reason!: 'RECIPIENT_INCOMPLETE';
}

export class SupplierSheetDto {
  @ApiProperty() handoffId!: string;
  @ApiProperty() supplierId!: string;
  @ApiProperty() fileName!: string;
  @ApiProperty({ type: [SupplierSheetColumnDto] }) columns!: SupplierSheetColumnDto[];
  @ApiProperty({ type: [SupplierSheetRowDto] }) rows!: SupplierSheetRowDto[];
  @ApiProperty({ type: [SupplierSheetSkippedShipmentDto], description: '수령인 정보가 불완전해 싣지 못한 상자' })
  skippedShipments!: SupplierSheetSkippedShipmentDto[];
}

/** 올린 시트 한 줄의 판정 — 개인정보 없음 */
export class SupplierRowVerdictDto {
  @ApiProperty({ description: '엑셀의 실제 행 번호(머리글이 1행)' }) rowNumber!: number;
  @ApiProperty({ description: '올린 행 키 그대로' }) rowKey!: string;
  @ApiProperty() orderNo!: string;
  @ApiProperty({ enum: Object.keys(VERDICT_KINDS) }) verdict!: SupplierRowVerdictKind;
  @ApiPropertyOptional({ enum: Object.keys(ROW_ERROR_CODES), description: 'verdict 가 error 일 때만' })
  code?: SupplierRowErrorCode;
  @ApiPropertyOptional({ enum: carrierEnum.enumValues, description: '칸에서 읽어 낸 택배사(있을 때만)' })
  carrier?: CarrierCode;
  @ApiPropertyOptional({ description: '정규화한 송장번호(있을 때만)' }) trackingNo?: string;
}

/** 판정 종류마다 줄 수 — 0 인 종류도 싣는다 */
export class SupplierSheetVerdictCountsDto implements Record<SupplierRowVerdictKind, number> {
  @ApiProperty() ship!: number;
  @ApiProperty() merge!: number;
  @ApiProperty() unfulfillable!: number;
  @ApiProperty() waiting!: number;
  @ApiProperty() correct!: number;
  @ApiProperty() unchanged!: number;
  @ApiProperty() error!: number;
}

export class SupplierSheetPreviewDto {
  @ApiProperty({ type: [SupplierRowVerdictDto] }) rows!: SupplierRowVerdictDto[];
  @ApiProperty({ type: SupplierSheetVerdictCountsDto }) counts!: SupplierSheetVerdictCountsDto;
  @ApiProperty({ description: '적용할 때 같은 파일과 함께 폼 칸 previewToken 으로 돌려준다' }) token!: string;
}

export class SupplierSheetApplyResultDto {
  @ApiProperty({ type: SupplierSheetVerdictCountsDto, description: '적용 시점(잠근 뒤) 판정 — 미리보기와 같다' })
  counts!: SupplierSheetVerdictCountsDto;
  @ApiProperty({ type: [String], description: '이번에 발송한 상자(나누기·합포장 뒤의 최종 상자)' })
  shippedShipmentIds!: string[];
}
