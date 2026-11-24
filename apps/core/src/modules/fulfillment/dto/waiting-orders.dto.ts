import { ApiProperty } from '@nestjs/swagger';

export class WaitingOrdersItemDto {
  skuId: string;
  @ApiProperty({ description: '이 상품을 기다리는 주문 수' })
  orders: number;
  @ApiProperty({ description: '그 주문들이 기다리는 수량' })
  qty: number;
}

export class WaitingOrdersDto {
  @ApiProperty({ type: [WaitingOrdersItemDto], description: '기다리는 주문이 있는 상품만' })
  items: WaitingOrdersItemDto[];
}
