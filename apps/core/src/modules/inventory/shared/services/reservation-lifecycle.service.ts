import { Injectable, Logger } from '@nestjs/common';
import { DbService } from '@app/db';
import { wmsTables, wmsSchema, DbTx } from '../../schema/inventory.schema';
import { eq, and, asc, sql } from 'drizzle-orm';
import { UnifiedReservationService } from './unified-reservation.service';
import { ProductSellableQuantityService } from '../../product-sellable-quantity/services/product-sellable-quantity.service';

@Injectable()
export class ReservationLifecycleService {
  private readonly logger = new Logger(ReservationLifecycleService.name);

  constructor(
    private readonly db: DbService<typeof wmsSchema>,
    private readonly unifiedReservation: UnifiedReservationService,
    private readonly productSellableQuantity: ProductSellableQuantityService,
  ) {}

  private async recalculateSellableQuantityForReservationSku(reservation: { skuId: string }, tx: DbTx): Promise<void> {
    await this.productSellableQuantity.recalculateAndPublishForSku(reservation.skuId, tx);
  }

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

        case 'completed':
        case 'shipped':
          await this.releaseFulfillmentOrderReservations(fulfillmentOrderId, `FO ${newStatus}`, trx);
          break;

        case 'partially_shipped':
          // 부분 출고시 출고된 만큼만 예약 해제
          await this.handlePartialShipment(fulfillmentOrderId, trx);
          break;
      }

      this.logger.log(`Handled FO ${fulfillmentOrderId} status change: ${oldStatus} → ${newStatus}`);
    }, tx);
  }

  /**
   * Movement Task 상태 변경시 예약 처리
   */
  async handleMovementTaskStatusChange(
    movementTaskId: string,
    oldStatus: string,
    newStatus: string,
    tx?: DbTx,
  ): Promise<void> {
    return this.db.run(async (trx) => {
      switch (newStatus) {
        case 'canceled':
          await this.releaseMovementTaskReservations(movementTaskId, 'Movement task canceled', trx);
          break;

        case 'completed':
          await this.releaseMovementTaskReservations(movementTaskId, 'Movement task completed', trx);
          break;
      }

      this.logger.log(`Handled Movement task ${movementTaskId} status change: ${oldStatus} → ${newStatus}`);
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

  private async releaseFulfillmentOrderReservations(
    fulfillmentOrderId: string,
    reason: string,
    tx: DbTx,
  ): Promise<void> {
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
  }

  /**
   * Movement Task 예약 일괄 해제
   */
  private async releaseMovementTaskReservations(movementTaskId: string, reason: string, tx: DbTx): Promise<void> {
    // 1. Movement Task의 모든 예약 조회
    const reservations = await this.unifiedReservation.getReservationsByTarget('MOVEMENT_TASK', movementTaskId, tx);

    // 2. 각 예약 해제
    for (const reservation of reservations) {
      await this.unifiedReservation.releaseReservation(reservation.id, tx);
    }

    this.logger.log(`Released ${reservations.length} Movement task reservations. Reason: ${reason}`);
  }

  /**
   * 부분 출고 처리 - 출고된 수량만큼 예약 해제
   */
  private async handlePartialShipment(fulfillmentOrderId: string, tx: DbTx): Promise<void> {
    // FO 아이템별 출고 현황 조회
    const items = await tx
      .select()
      .from(wmsTables.fulfillmentOrderItems)
      .where(eq(wmsTables.fulfillmentOrderItems.fulfillmentOrderId, fulfillmentOrderId));

    for (const item of items) {
      const shippedQty = item.shippedQty || 0;

      if (shippedQty > 0) {
        // 해당 아이템의 예약 조회
        const reservations = await tx
          .select()
          .from(wmsTables.stockReservations)
          .where(
            and(
              eq(wmsTables.stockReservations.fulfillmentOrderItemId, item.id),
              eq(wmsTables.stockReservations.status, 'confirmed'),
            ),
          );

        // 출고된 수량만큼 예약 해제 (FIFO 방식)
        let remainingToRelease = shippedQty;

        for (const reservation of reservations) {
          if (remainingToRelease <= 0) break;

          const releaseQuantity = Math.min(reservation.quantity, remainingToRelease);

          if (releaseQuantity === reservation.quantity) {
            // 전체 예약 해제
            await this.unifiedReservation.releaseReservation(reservation.id, tx);
          } else {
            // 부분 예약 해제 - 수량 조정
            await tx
              .update(wmsTables.stockReservations)
              .set({
                quantity: reservation.quantity - releaseQuantity,
                updatedAt: new Date(),
              })
              .where(eq(wmsTables.stockReservations.id, reservation.id));

            await this.recalculateSellableQuantityForReservationSku(reservation, tx);
          }

          remainingToRelease -= releaseQuantity;
        }

        // FO 아이템 예약 수량 업데이트
        const remainingReserved = Math.max(0, item.reservedQty - shippedQty);
        await tx
          .update(wmsTables.fulfillmentOrderItems)
          .set({ reservedQty: remainingReserved, updatedAt: new Date() })
          .where(eq(wmsTables.fulfillmentOrderItems.id, item.id));
      }
    }

    this.logger.log(`Handled partial shipment for FO ${fulfillmentOrderId}`);
  }

  /**
   * 예약 만료 배치 처리
   */
  async processExpiredReservations(tx?: DbTx): Promise<number> {
    return this.db.run(async (trx) => {
      const expiredReservations = await trx.query.stockReservations.findMany({
        where: and(
          eq(wmsTables.stockReservations.status, 'confirmed'),
          // timeoutAt < now()
        ),
      });

      let releasedCount = 0;

      for (const reservation of expiredReservations) {
        try {
          await this.unifiedReservation.releaseReservation(reservation.id, trx);
          releasedCount++;
        } catch (error) {
          this.logger.warn(
            `Failed to release expired reservation ${reservation.id}: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
      }

      this.logger.log(`Processed ${releasedCount} expired reservations`);
      return releasedCount;
    }, tx);
  }

  /**
   * FO 아이템 수량 변경시 예약 조정
   */
  async adjustReservationOnQuantityChange(
    fulfillmentOrderItemId: string,
    oldQuantity: number,
    newQuantity: number,
    tx?: DbTx,
  ): Promise<void> {
    return this.db.run(async (trx) => {
      const quantityDiff = newQuantity - oldQuantity;

      if (quantityDiff === 0) return;

      const reservations = await trx.query.stockReservations.findMany({
        where: and(
          eq(wmsTables.stockReservations.fulfillmentOrderItemId, fulfillmentOrderItemId),
          eq(wmsTables.stockReservations.status, 'confirmed'),
        ),
      });

      if (quantityDiff > 0) {
        // 수량 증가: 추가 예약 필요
        if (reservations.length > 0) {
          const firstReservation = reservations[0];
          await this.unifiedReservation.reserveStock(
            {
              targetType: 'FULFILLMENT_ORDER',
              targetId: firstReservation.targetId,
              skuId: firstReservation.skuId,
              warehouseId: firstReservation.warehouseId,
              quantity: quantityDiff,
              fulfillmentOrderItemId: fulfillmentOrderItemId,
              reason: 'Quantity increased',
            },
            trx,
          );
        }
      } else {
        // 수량 감소: 예약 해제 필요
        let remainingToRelease = Math.abs(quantityDiff);

        for (const reservation of reservations) {
          if (remainingToRelease <= 0) break;

          const releaseQuantity = Math.min(reservation.quantity, remainingToRelease);

          if (releaseQuantity === reservation.quantity) {
            await this.unifiedReservation.releaseReservation(reservation.id, trx);
          } else {
            await trx
              .update(wmsTables.stockReservations)
              .set({
                quantity: reservation.quantity - releaseQuantity,
                updatedAt: new Date(),
              })
              .where(eq(wmsTables.stockReservations.id, reservation.id));

            await this.recalculateSellableQuantityForReservationSku(reservation, trx);
          }

          remainingToRelease -= releaseQuantity;
        }
      }

      // FO 아이템 예약 수량 업데이트
      await trx
        .update(wmsTables.fulfillmentOrderItems)
        .set({ reservedQty: newQuantity })
        .where(eq(wmsTables.fulfillmentOrderItems.id, fulfillmentOrderItemId));

      this.logger.log(
        `Adjusted reservations for FOI ${fulfillmentOrderItemId}: ${oldQuantity} → ${newQuantity} (${quantityDiff > 0 ? '+' : ''}${quantityDiff})`,
      );
    }, tx);
  }
}
