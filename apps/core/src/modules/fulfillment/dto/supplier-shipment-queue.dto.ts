import { ApiProperty } from '@nestjs/swagger';

export class SupplierQueueSummaryDto {
  @ApiProperty() supplierId!: string;
  @ApiProperty({ nullable: true, type: String }) supplierCode!: string | null;
  @ApiProperty() supplierName!: string;
  @ApiProperty({ description: '아직 입점사에게 안 넘긴 열린 상자 수' }) pendingShipments!: number;
  @ApiProperty({ description: '넘겼지만 발송 전인 열린 상자 수' }) forwardedShipments!: number;
  @ApiProperty({ description: '열린 상자에서 입점사가 «못 보냄»으로 알린 라인 수' }) unfulfillableLines!: number;
}

export class SupplierQueueLineDto {
  @ApiProperty() shipmentLineId!: string;
  @ApiProperty() skuId!: string;
  @ApiProperty() skuName!: string;
  @ApiProperty({ nullable: true, type: String, description: '그 입점사와의 sku_suppliers.supplier_sku' })
  supplierSku!: string | null;
  @ApiProperty() qty!: number;
  @ApiProperty({ nullable: true, type: String }) unfulfillableReason!: string | null;
  @ApiProperty({ nullable: true, type: Date }) unfulfillableReportedAt!: Date | null;
}

export class SupplierQueueShipmentDto {
  @ApiProperty() shipmentId!: string;
  @ApiProperty({ enum: ['pending', 'forwarded'] }) stage!: 'pending' | 'forwarded';
  @ApiProperty() salesOrderId!: string;
  @ApiProperty() orderNo!: string;
  @ApiProperty() openedAt!: Date;
  @ApiProperty({ nullable: true, type: String }) handoffId!: string | null;
  @ApiProperty({ nullable: true, type: Date }) handoffAt!: Date | null;
  @ApiProperty({ type: [SupplierQueueLineDto] }) lines!: SupplierQueueLineDto[];
}
