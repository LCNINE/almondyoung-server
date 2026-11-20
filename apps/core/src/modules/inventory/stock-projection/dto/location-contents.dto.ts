import { ApiProperty } from '@nestjs/swagger';

export class LocationContentItemDto {
  @ApiProperty()
  skuId: string;

  @ApiProperty()
  skuCode: string;

  @ApiProperty()
  skuName: string;

  @ApiProperty({ description: 'ON_HAND | DEFECTIVE | IN_TRANSFER | RETURNED' })
  stockState: string;

  @ApiProperty()
  quantity: number;

  @ApiProperty({ description: '이 위치에서 아직 처리하지 않은 입고 수량' })
  inboundPendingQty: number;

  @ApiProperty({ description: '입고 대기와 출고 작업 보관분을 제외한 일반 이동 가능 수량' })
  generallyMovableQty: number;
}

export class LocationContentsDto {
  @ApiProperty()
  locationId: string;

  @ApiProperty()
  locationCode: string;

  @ApiProperty()
  warehouseId: string;

  @ApiProperty({ type: [LocationContentItemDto] })
  items: LocationContentItemDto[];
}

export class ReturnZoneGoodsItemDto {
  @ApiProperty()
  skuId: string;

  @ApiProperty()
  skuCode: string;

  @ApiProperty()
  skuName: string;

  @ApiProperty({ description: '반품 기본존에서 옮길 수 있는 판매 가능 수량' })
  quantity: number;

  @ApiProperty({
    description: '상품의 평소 선반 — 이 창고의 사용 중인 일반 로케이션일 때만',
    nullable: true,
    type: String,
  })
  usualLocationId: string | null;

  @ApiProperty({ nullable: true, type: String })
  usualLocationCode: string | null;
}

export class ReturnZoneGoodsDto {
  @ApiProperty()
  locationId: string;

  @ApiProperty()
  locationCode: string;

  @ApiProperty()
  warehouseId: string;

  @ApiProperty({ type: [ReturnZoneGoodsItemDto] })
  items: ReturnZoneGoodsItemDto[];
}
