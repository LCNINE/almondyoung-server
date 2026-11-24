import { Injectable, Logger } from '@nestjs/common';
import { DbService } from '@app/db';
import { InjectTypedDb } from '@app/db/decorators';
import { DbTx, wmsSchema } from '../../inventory/schema/inventory.schema';
import { InboundArrivalReservations } from '../../inventory/inbound/kernel/inbound-arrival-reservations.port';
import { FulfillmentWorkflowGate } from '../services/fulfillment-workflow-gate.service';
import { findReservationRetryCandidates } from '../services/reservation-retry-candidates';
import { ShipmentReservationService } from '../services/shipment-reservation.service';

/** 입고 한 번에 다시 잡는 줄 상한 — 인기 상품 입고가 응답을 몇 초씩 늘리지 않게. 남은 줄은 크론이 잇는다 */
export const ARRIVAL_RETRY_LIMIT = 50;

/**
 * 입고 직후 그 상품의 예약 재시도. 크론(`FulfillmentOrderReservationRetryWorker`)과 같은 후보·순서·스위치를 쓰고,
 * 창고·상품만 좁힌다. 후보는 가용재고가 있는 줄만이고, 줄마다 `reservePartial` 이 잠금 아래에서 부족분을 다시
 * 계산하므로 크론과 겹쳐도 같은 재고를 두 번 잡지 않는다.
 */
@Injectable()
export class ArrivalReservationRetry extends InboundArrivalReservations {
  private readonly logger = new Logger(ArrivalReservationRetry.name);

  constructor(
    @InjectTypedDb<typeof wmsSchema>()
    private readonly dbService: DbService<typeof wmsSchema>,
    private readonly workflowGate: FulfillmentWorkflowGate,
    private readonly shipmentReservations: ShipmentReservationService,
  ) {
    super();
  }

  async retryForSkus(warehouseId: string, skuIds: readonly string[], tx?: DbTx): Promise<void> {
    if (!this.workflowGate.shouldRunReservationRetry() || skuIds.length === 0) return;
    const candidates = await findReservationRetryCandidates(tx ?? this.dbService.db, ARRIVAL_RETRY_LIMIT, {
      warehouseId,
      skuIds,
    });
    for (const candidate of candidates) {
      try {
        await this.shipmentReservations.reservePartial(candidate.id, candidate.qty, tx);
      } catch (error) {
        // 크론과 같은 처리 — 그 줄만 건너뛴다
        this.logger.error(`Failed to retry reservation after arrival for shipment line ${candidate.id}`, error);
      }
    }
  }
}
