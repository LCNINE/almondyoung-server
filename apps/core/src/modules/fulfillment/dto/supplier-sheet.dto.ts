import { ApiProperty } from '@nestjs/swagger';

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

export class SupplierSheetDto {
  @ApiProperty() handoffId!: string;
  @ApiProperty() supplierId!: string;
  @ApiProperty() fileName!: string;
  @ApiProperty({ type: [SupplierSheetColumnDto] }) columns!: SupplierSheetColumnDto[];
  @ApiProperty({ type: [SupplierSheetRowDto] }) rows!: SupplierSheetRowDto[];
}
