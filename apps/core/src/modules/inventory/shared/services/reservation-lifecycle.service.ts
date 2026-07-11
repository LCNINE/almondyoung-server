import { Injectable, Logger } from '@nestjs/common';
import { DbService } from '@app/db';
import { wmsTables, wmsSchema, DbTx } from '../../schema/inventory.schema';
import { eq } from 'drizzle-orm';
import { UnifiedReservationService } from './unified-reservation.service';

@Injectable()
export class ReservationLifecycleService {
  private readonly logger = new Logger(ReservationLifecycleService.name);

  constructor(
    private readonly db: DbService<typeof wmsSchema>,
    private readonly unifiedReservation: UnifiedReservationService,
  ) {}

  /**
   * FO 상태 변경시 예약 처리
   */
  async handleFulfillmentOrderStatusChange(
    fulfillmentOrderId: string,
    oldStatus: string,
    newStatus: string,
    tx?: DbTx,
  ): Promise<void> {
    return this.db.run(async (trx) => {
      switch (newStatus) {
        case 'canceled':
          await this.releaseFulfillmentOrderReservations(fulfillmentOrderId, 'FO canceled', trx);
          break;
      }

      this.logger.log(`Handled FO ${fulfillmentOrderId} status change: ${oldStatus} → ${newStatus}`);
    }, tx);
  }

  /**
   * FO 예약 일괄 해제
   */
  /**
   * 출고 종결(소진)에 따른 FO 예약 닫기.
   *
   * 예약 row 를 닫고 reservedQty 를 0 으로 만드는 메커니즘은 환원(release)과 동일하다.
   * 차이는 **호출자가 이미 SHIP 이벤트를 원장에 append(on_hand 차감)했다는 것** — 즉
   * 가용으로 되돌리는 환원이 아니라 소진(consume)이다 (ADR-0027 결정 5 / RFC 종결 seam).
   * 환원(취소·만료)은 `handleFulfillmentOrderStatusChange('canceled')` 로 간다.
   */
  async consumeFulfillmentOrderReservations(fulfillmentOrderId: string, tx: DbTx): Promise<void> {
    await this.releaseFulfillmentOrderReservations(fulfillmentOrderId, 'FO shipped (consumed)', tx);
  }

  /**
   * 대사·발생원 sweep 용 public 진입 — terminal FO 의 잔존 confirmed 예약을 전량 release.
   * release 는 available 을 되돌릴 뿐 SHIP 원장을 append 하지 않는다(consume 과 동일 메커니즘).
   * @returns release 된 예약 행 수
   */
  async releaseLeftoverReservations(fulfillmentOrderId: string, reason: string, tx: DbTx): Promise<number> {
    return this.releaseFulfillmentOrderReservations(fulfillmentOrderId, reason, tx);
  }

  private async releaseFulfillmentOrderReservations(
    fulfillmentOrderId: string,
    reason: string,
    tx: DbTx,
  ): Promise<number> {
    // 1. FO의 모든 예약 조회
    const reservations = await this.unifiedReservation.getReservationsByTarget(
      'FULFILLMENT_ORDER',
      fulfillmentOrderId,
      tx,
    );

    // 2. 각 예약 해제
    for (const reservation of reservations) {
      await this.unifiedReservation.releaseReservation(reservation.id, tx);
    }

    // 3. FO 예약 수량 초기화 (기존 호환성)
    await tx
      .update(wmsTables.fulfillmentOrderItems)
      .set({ reservedQty: 0 })
      .where(eq(wmsTables.fulfillmentOrderItems.fulfillmentOrderId, fulfillmentOrderId));

    await tx
      .update(wmsTables.fulfillmentOrders)
      .set({ totalReservedQty: 0 })
      .where(eq(wmsTables.fulfillmentOrders.id, fulfillmentOrderId));

    this.logger.log(`Released ${reservations.length} FO reservations. Reason: ${reason}`);
    return reservations.length;
  }
}
