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

export class InboundShipmentLineDifferenceDto {
  @ApiProperty({
    enum: ['pending', 'not_arrived', 'match', 'short', 'over'],
    description:
      'pending = 진행 중(덮는 입고 상자 중 열린 것이 있거나 예정 수량이 없다), not_arrived = 사람이 닫은 선적에서 열린 상자가 남은 줄',
  })
  state: 'pending' | 'not_arrived' | 'match' | 'short' | 'over';
  @ApiProperty({ description: '유효 집계 합' }) counted: number;
  @ApiPropertyOptional({ nullable: true, description: 'pending·not_arrived 일 때만 null 일 수 있다' }) expected:
    | number
    | null;
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
  @ApiProperty({
    type: InboundShipmentLineDifferenceDto,
    description: '예정·실제 차이 — 덮는 상자가 전부 확정돼야 판정',
  })
  difference: InboundShipmentLineDifferenceDto;
}

export class InboundShipmentDifferenceSummaryDto {
  @ApiProperty({ description: '확정된 상자 수' }) boxesReceived: number;
  @ApiProperty({ description: '입고용 상자 수(리스트·추가 상자 합)' }) boxesTotalStock: number;
  @ApiProperty({ description: '전달용 상자 수' }) forwardBoxes: number;
  @ApiProperty({ description: '리스트에 없던 상자 수' }) addedBoxes: number;
  @ApiProperty({ description: '모자란 줄 수' }) shortLines: number;
  @ApiProperty({ description: '남는 줄 수' }) overLines: number;
  @ApiProperty({ description: '사람이 닫은 선적에서 열린 상자가 남은(안 온) 줄 수' }) notArrivedLines: number;
  @ApiProperty({ description: '리스트에 없던 물건의 유효 집계 행 수' }) unplannedCounts: number;
}

export class InboundShipmentDetailViewDto extends InboundShipmentSummaryDto {
  @ApiPropertyOptional({ nullable: true }) sourceFileName: string | null;
  @ApiPropertyOptional({ nullable: true }) memo: string | null;
  @ApiProperty({ type: [InboundShipmentBoxViewDto] }) boxes: InboundShipmentBoxViewDto[];
  @ApiProperty({ type: [InboundShipmentLineViewDto] }) lines: InboundShipmentLineViewDto[];
  @ApiProperty({ type: InboundShipmentDifferenceSummaryDto }) summary: InboundShipmentDifferenceSummaryDto;
}

export type InboundShipmentDetailView = InboundShipmentDetailViewDto;
