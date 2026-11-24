import { ApiProperty } from '@nestjs/swagger';

export class ReadyShipmentDto {
  shipmentId: string;
  @ApiProperty({ enum: ['draft', 'planned'] })
  status: 'draft' | 'planned';
  @ApiProperty({ type: [String], description: '상자에 담긴 주문 번호' })
  orderNos: string[];
  @ApiProperty({ description: '받는 분 이름 (가림)' })
  recipientMasked: string;
  @ApiProperty({ description: '상자의 상품 종류 수' })
  skuCount: number;
  @ApiProperty({ description: '상자의 총 수량' })
  totalQty: number;
  @ApiProperty({ enum: ['ready', 'putaway_required'], description: '바로 출력 가능 / 적치가 먼저 필요' })
  readiness: 'ready' | 'putaway_required';
}

export class ReadyShipmentsDto {
  @ApiProperty({ type: [ReadyShipmentDto], description: '이번 입고로 다 갖춰진 상자' })
  items: ReadyShipmentDto[];
  @ApiProperty({ description: '다른 상품을 더 기다리는 상자 수' })
  waitingOnOtherSkus: number;
}
