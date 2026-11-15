import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export const INBOUND_SHIPMENT_STATUSES = ['draft', 'expected', 'receiving', 'closed', 'canceled'] as const;
export type InboundShipmentStatusValue = (typeof INBOUND_SHIPMENT_STATUSES)[number];

export class InboundShipmentSummaryDto {
  @ApiProperty() id: string;
  @ApiProperty() warehouseId: string;
  @ApiProperty({ enum: INBOUND_SHIPMENT_STATUSES }) status: InboundShipmentStatusValue;
  @ApiProperty() name: string;
  @ApiPropertyOptional({ nullable: true }) expectedArrival: string | null;
  @ApiProperty() boxCount: number;
  @ApiProperty() lineCount: number;
  @ApiProperty() createdAt: Date;
}

export class InboundShipmentBoxViewDto {
  @ApiProperty() id: string;
  @ApiProperty() label: string;
  @ApiProperty() sortKey: number;
  @ApiProperty({ enum: ['list', 'added'] }) origin: 'list' | 'added';
  @ApiProperty({ enum: ['stock', 'forward'] }) disposition: 'stock' | 'forward';
  @ApiPropertyOptional({ nullable: true }) forwardNote: string | null;
  @ApiProperty({ enum: ['open', 'received'] }) status: 'open' | 'received';
  @ApiProperty({ description: '취소되지 않은 센 수량 합' }) countedQty: number;
}

export class InboundShipmentAiCandidateDto {
  @ApiProperty() skuId: string;
  @ApiProperty() reason: string;
}

export class InboundShipmentBarcodeCandidateDto {
  @ApiProperty() skuId: string;
  @ApiProperty() code: string;
  @ApiProperty() name: string;
}

export class InboundShipmentLineViewDto {
  @ApiProperty() id: string;
  @ApiProperty() rowNumber: number;
  @ApiProperty({ enum: ['sku', 'free', 'unresolved'] }) kind: 'sku' | 'free' | 'unresolved';
  @ApiPropertyOptional({ nullable: true }) skuId: string | null;
  @ApiPropertyOptional({ nullable: true }) expectedQty: number | null;
  @ApiPropertyOptional({ enum: ['barcode', 'manual'], nullable: true }) resolution: 'barcode' | 'manual' | null;
  @ApiProperty({ type: [String] }) issues: string[];
  @ApiProperty({ type: [String] }) coversBoxLabels: string[];
  @ApiPropertyOptional({ type: [InboundShipmentAiCandidateDto], nullable: true })
  aiCandidates: InboundShipmentAiCandidateDto[] | null;
  @ApiProperty({ type: [InboundShipmentBarcodeCandidateDto], description: '미확정 줄의 바코드가 가리키는 SKU 후보' })
  barcodeCandidates: InboundShipmentBarcodeCandidateDto[];
  @ApiProperty({ description: '업로드 원문 셀(키별 {text,value,formula?})' }) raw: Record<string, unknown>;
  @ApiProperty({ description: '취소되지 않은 센 수량 합' }) countedQty: number;
  @ApiPropertyOptional({ nullable: true, description: '차이 계산은 이후 단계가 채운다' }) difference: number | null;
}

export class InboundShipmentDetailViewDto extends InboundShipmentSummaryDto {
  @ApiPropertyOptional({ nullable: true }) sourceFileName: string | null;
  @ApiPropertyOptional({ nullable: true }) memo: string | null;
  @ApiProperty({ type: [InboundShipmentBoxViewDto] }) boxes: InboundShipmentBoxViewDto[];
  @ApiProperty({ type: [InboundShipmentLineViewDto] }) lines: InboundShipmentLineViewDto[];
}

export type InboundShipmentDetailView = InboundShipmentDetailViewDto;
