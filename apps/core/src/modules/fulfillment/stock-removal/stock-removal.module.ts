import { Module } from '@nestjs/common';
import { SharedModule } from '../../inventory/shared/shared.module';
import { InboundReservationRelease } from '../../inventory/inbound/kernel/inbound-reservation-release.port';
import { InboundArrivalReservations } from '../../inventory/inbound/kernel/inbound-arrival-reservations.port';
import { FulfillmentInvariantService } from '../services/fulfillment-invariant.service';
import { FulfillmentProgressService } from '../services/fulfillment-progress.service';
import { FulfillmentWorkflowGate } from '../services/fulfillment-workflow-gate.service';
import { ShipmentReservationService } from '../services/shipment-reservation.service';
import { StockRemovalReservations } from './stock-removal-reservations';
import { ArrivalReservationRetry } from './arrival-reservation-retry';

// 입고(InboundModule)가 재고를 뺄 때·입고 직후 예약을 다시 잡을 때 쓰는 출고 쪽 구현만 내보낸다. 재고 모듈은 FulfillmentModule 을 물 수 없어
// 예약 서비스를 여기서 세운다(ExchangeShipmentModule 과 같은 꼴).
@Module({
  imports: [SharedModule],
  providers: [
    ShipmentReservationService,
    FulfillmentProgressService,
    FulfillmentInvariantService,
    // 설정만 읽는 상태 없는 서비스 — FulfillmentModule 의 것과 따로 세워도 같은 스위치를 본다
    FulfillmentWorkflowGate,
    { provide: InboundReservationRelease, useClass: StockRemovalReservations },
    { provide: InboundArrivalReservations, useClass: ArrivalReservationRetry },
  ],
  exports: [InboundReservationRelease, InboundArrivalReservations],
})
export class StockRemovalModule {}
