import { Module } from '@nestjs/common';
import { OrderShipmentOperationsReader } from './order-shipment-operations.reader';

// FulfillmentModule 이 SalesOrderModule 을 import 하므로 SalesOrderModule 은 FulfillmentModule 을 물 수 없다.
// 주문 이력 조회(읽기)만 내보내는 소형 모듈이다. 의존은 전역 DbService 뿐이다.
@Module({
  providers: [OrderShipmentOperationsReader],
  exports: [OrderShipmentOperationsReader],
})
export class OrderShipmentOperationsModule {}
