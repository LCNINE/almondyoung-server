import { ApiExtraModels, ApiProperty, ApiPropertyOptional, getSchemaPath } from '@nestjs/swagger';

export class ExpectedArrivalSupplierDto {
  @ApiProperty({ description: '공급처 ID' })
  id: string;

  @ApiProperty({ description: '공급처 이름' })
  name: string;
}

export class ExpectedArrivalLineDto {
  @ApiProperty({ description: 'SKU ID' })
  skuId: string;

  @ApiProperty({ description: 'SKU 이름' })
  skuName: string;

  @ApiProperty({ description: 'SKU 코드' })
  skuCode: string;

  @ApiProperty({ description: '실발주 수량' })
  orderedQty: number;

  @ApiProperty({ description: '수령 누계' })
  receivedQty: number;

  @ApiProperty({ description: '남은 수량' })
  outstandingQty: number;

  @ApiPropertyOptional({ description: '라인 도착 예정일', nullable: true, type: String, example: '2026-09-15' })
  expectedArrival: string | null;
}

export class PurchaseOrderExpectedArrivalDto {
  @ApiProperty({ enum: ['purchase_order'] })
  source: 'purchase_order';

  @ApiProperty({ description: '발주 ID' })
  documentId: string;

  @ApiProperty({ enum: ['domestic', 'foreign'] })
  type: 'domestic' | 'foreign';

  @ApiPropertyOptional({ type: ExpectedArrivalSupplierDto, nullable: true })
  supplier: ExpectedArrivalSupplierDto | null;

  @ApiPropertyOptional({ description: '남은 라인의 가장 이른 도착 예정일', nullable: true, type: String })
  expectedDate: string | null;

  @ApiProperty({ description: '문서의 총 남은 수량' })
  totalOutstandingQuantity: number;

  @ApiProperty({ type: [ExpectedArrivalLineDto] })
  lines: ExpectedArrivalLineDto[];
}

export class InboundShipmentExpectedArrivalDto {
  @ApiProperty({ enum: ['inbound_shipment'] })
  source: 'inbound_shipment';

  @ApiProperty({ description: '선적 ID' })
  documentId: string;

  @ApiProperty({ description: '선적 이름' })
  name: string;

  @ApiPropertyOptional({ description: '도착 예정일', nullable: true, type: String, example: '2026-09-15' })
  expectedDate: string | null;

  @ApiProperty({ description: '오는 중 수량 합' })
  totalOutstandingQuantity: number;

  @ApiProperty({ description: '입고용 상자 중 입고 확정된 수' })
  receivedBoxes: number;

  @ApiProperty({ description: '입고용 상자 수' })
  stockBoxes: number;
}

/** `source` 로 갈리는 유니언. 선적은 `include=inbound_shipment` 를 줄 때만 나온다. */
export type ExpectedArrivalDto = PurchaseOrderExpectedArrivalDto | InboundShipmentExpectedArrivalDto;

@ApiExtraModels(PurchaseOrderExpectedArrivalDto, InboundShipmentExpectedArrivalDto)
export class ExpectedArrivalsResponseDto {
  @ApiProperty({ description: '직접 입고될 창고 ID' })
  warehouseId: string;

  @ApiProperty({ description: '입고 대기 문서 수' })
  totalDocuments: number;

  @ApiProperty({ description: '전체 남은 수량' })
  totalOutstandingQuantity: number;

  @ApiProperty({
    type: 'array',
    items: {
      oneOf: [
        { $ref: getSchemaPath(PurchaseOrderExpectedArrivalDto) },
        { $ref: getSchemaPath(InboundShipmentExpectedArrivalDto) },
      ],
      discriminator: {
        propertyName: 'source',
        mapping: {
          purchase_order: getSchemaPath(PurchaseOrderExpectedArrivalDto),
          inbound_shipment: getSchemaPath(InboundShipmentExpectedArrivalDto),
        },
      },
    },
  })
  arrivals: ExpectedArrivalDto[];
}
