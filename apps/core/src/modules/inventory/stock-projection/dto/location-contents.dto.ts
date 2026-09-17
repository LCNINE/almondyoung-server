import { ApiProperty } from '@nestjs/swagger';

export class LocationContentItemDto {
  @ApiProperty()
  skuId: string;

  @ApiProperty()
  skuCode: string;

  @ApiProperty()
  skuName: string;

  @ApiProperty({ description: 'ON_HAND | DEFECTIVE | IN_TRANSFER' })
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
