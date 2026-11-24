import { Module } from '@nestjs/common';
import { SharedModule } from '../../inventory/shared/shared.module';
import { InboundReservationRelease } from '../../inventory/inbound/kernel/inbound-reservation-release.port';
import { FulfillmentInvariantService } from '../services/fulfillment-invariant.service';
import { FulfillmentProgressService } from '../services/fulfillment-progress.service';
import { ShipmentReservationService } from '../services/shipment-reservation.service';
import { StockRemovalReservations } from './stock-removal-reservations';

// 입고(InboundModule)가 재고를 뺄 때 쓰는 출고 쪽 구현만 내보낸다. 재고 모듈은 FulfillmentModule 을 물 수 없어
// 예약 서비스를 여기서 세운다(ExchangeShipmentModule 과 같은 꼴).
@Module({
  imports: [SharedModule],
  providers: [
    ShipmentReservationService,
    FulfillmentProgressService,
    FulfillmentInvariantService,
    { provide: InboundReservationRelease, useClass: StockRemovalReservations },
  ],
  exports: [InboundReservationRelease],
})
export class StockRemovalModule {}
