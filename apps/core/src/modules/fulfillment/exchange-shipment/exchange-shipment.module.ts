import { Module } from '@nestjs/common';
import { SharedModule } from '../../inventory/shared/shared.module';
import { ShipmentReservationService } from '../services/shipment-reservation.service';
import { FulfillmentProgressService } from '../services/fulfillment-progress.service';
import { FulfillmentInvariantService } from '../services/fulfillment-invariant.service';
import { ExchangeShipmentOpener } from './exchange-shipment-opener';

// 교환 상자 열기의 출고 쪽 쓰기(K8 PR11)만 내보내는 소형 모듈. FulfillmentModule 이 SalesOrderModule 을 import 하므로
// SalesOrderModule 은 FulfillmentModule 을 물 수 없다 — 이 모듈만 문다(UnboxedDemandModule·FulfillmentCommandModule 꼴).
// 의존 = 전역 DbService + SharedModule 의 UnifiedReservationService. 진행·불변식 서비스는 상태 없는 순수 서비스다.
@Module({
  imports: [SharedModule],
  providers: [
    ShipmentReservationService,
    FulfillmentProgressService,
    FulfillmentInvariantService,
    ExchangeShipmentOpener,
  ],
  exports: [ExchangeShipmentOpener],
})
export class ExchangeShipmentModule {}
