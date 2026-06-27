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
   * FO 분할시 예약 재분배
   *
   * originalFulfillmentOrderItemId: 예약이 걸려 있는 원본 FOI ID
   * newFulfillmentOrderItemId: 분할 후 생성된 신규 FOI ID (새 예약에 연결)
   */
  async handleFulfillmentOrderSplit(
    originalFoId: string,
    newFoId: string,
    splitItems: Array<{
      originalFulfillmentOrderItemId: string;
      newFulfillmentOrderItemId: string;
      skuId: string;
      splitQuantity: number;
      originalQuantityBeforeSplit: number;
    }>,
    tx?: DbTx,
  ): Promise<void> {
    // 예약 이동은 reserveStock 재호출이 아니라 confirmed row 직접 이전으로 처리한다 —
    // 재고가 전량 예약된 상태(가용재고 0)에서도 분할이 동작해야 하고,
    // SKU 전체 confirmed 합계가 보존되므로 sellable 재계산도 불필요하다.
    // 이동량 = min(splitQuantity, 원본 FOI confirmed 합계). FOI reservedQty와
    // FO totalReservedQty 갱신도 실제 이동량 기준으로 여기서 수행한다.
    // 잠금 컨벤션: FO/FOI는 호출자(split)가 잠그고, reservation row는 여기서 createdAt, id 순으로 잠근다.
    return this.db.run(async (trx) => {
      let totalMoved = 0;

      for (const item of splitItems) {
        const originalReservations = await trx
          .select()
          .from(wmsTables.stockReservations)
          .where(
            and(
              eq(wmsTables.stockReservations.fulfillmentOrderItemId, item.originalFulfillmentOrderItemId),
              eq(wmsTables.stockReservations.status, 'confirmed'),
            ),
          )
          .orderBy(asc(wmsTables.stockReservations.createdAt), asc(wmsTables.stockReservations.id))
          .for('update');

        if (originalReservations.length === 0) continue;

        let remainingToSplit = item.splitQuantity;
        let movedForItem = 0;

        for (const reservation of originalReservations) {
          if (remainingToSplit <= 0) break;

          const moveQty = Math.min(reservation.quantity, remainingToSplit);
          if (moveQty === reservation.quantity) {
            // row 전체 이동: 소유권만 신규 FOI로 변경
            await trx
              .update(wmsTables.stockReservations)
              .set({
                targetId: newFoId,
                fulfillmentOrderItemId: item.newFulfillmentOrderItemId,
                reason: `Split from FO ${originalFoId}`,
                updatedAt: new Date(),
              })
              .where(eq(wmsTables.stockReservations.id, reservation.id));
          } else {
            // 부분 이동: 원본 차감 + 신규 FOI로 새 confirmed row 생성
            await trx
              .update(wmsTables.stockReservations)
              .set({ quantity: reservation.quantity - moveQty, updatedAt: new Date() })
              .where(eq(wmsTables.stockReservations.id, reservation.id));

            await trx.insert(wmsTables.stockReservations).values({
              targetType: 'FULFILLMENT_ORDER',
              targetId: newFoId,
              skuId: reservation.skuId,
              warehouseId: reservation.warehouseId,
              quantity: moveQty,
              fulfillmentOrderItemId: item.newFulfillmentOrderItemId,
              status: 'confirmed',
              reason: `Split from FO ${originalFoId}`,
            });
          }

          remainingToSplit -= moveQty;
          movedForItem += moveQty;
        }

        if (movedForItem > 0) {
          await trx
            .update(wmsTables.fulfillmentOrderItems)
            .set({
              reservedQty: sql`GREATEST(${wmsTables.fulfillmentOrderItems.reservedQty} - ${movedForItem}, 0)`,
              updatedAt: new Date(),
            })
            .where(eq(wmsTables.fulfillmentOrderItems.id, item.originalFulfillmentOrderItemId));

          await trx
            .update(wmsTables.fulfillmentOrderItems)
            .set({
              reservedQty: sql`${wmsTables.fulfillmentOrderItems.reservedQty} + ${movedForItem}`,
              updatedAt: new Date(),
            })
            .where(eq(wmsTables.fulfillmentOrderItems.id, item.newFulfillmentOrderItemId));

          totalMoved += movedForItem;
        }
      }

      if (totalMoved > 0) {
        await trx
          .update(wmsTables.fulfillmentOrders)
          .set({
            totalReservedQty: sql`GREATEST(${wmsTables.fulfillmentOrders.totalReservedQty} - ${totalMoved}, 0)`,
            updatedAt: new Date(),
          })
          .where(eq(wmsTables.fulfillmentOrders.id, originalFoId));

        await trx
          .update(wmsTables.fulfillmentOrders)
          .set({
            totalReservedQty: sql`${wmsTables.fulfillmentOrders.totalReservedQty} + ${totalMoved}`,
            updatedAt: new Date(),
          })
          .where(eq(wmsTables.fulfillmentOrders.id, newFoId));
      }

      this.logger.log(`Split FO ${originalFoId} → ${newFoId}: moved ${totalMoved} reserved units`);
    }, tx);
  }

  /**
   * FO 병합시 예약 통합
   */
  async handleFulfillmentOrderMerge(sourceFoIds: string[], targetFoId: string, tx?: DbTx): Promise<void> {
    return this.db.run(async (trx) => {
      for (const sourceFoId of sourceFoIds) {
        // 1. 소스 FO의 모든 예약 조회
        const sourceReservations = await this.unifiedReservation.getReservationsByTarget(
          'FULFILLMENT_ORDER',
          sourceFoId,
          trx,
        );

        for (const reservation of sourceReservations) {
          // 2. 타겟 FO에 동일한 예약 생성
          await this.unifiedReservation.reserveStock(
            {
              targetType: 'FULFILLMENT_ORDER',
              targetId: targetFoId,
              skuId: reservation.skuId,
              warehouseId: reservation.warehouseId,
              quantity: reservation.quantity,
              fulfillmentOrderItemId: reservation.fulfillmentOrderItemId || undefined,
              reason: `Merged from FO ${sourceFoId}`,
            },
            trx,
          );

          // 3. 원본 예약 해제
          await this.unifiedReservation.releaseReservation(reservation.id, trx);
        }

        this.logger.log(`Merged reservations from FO ${sourceFoId} → ${targetFoId}`);
      }
    }, tx);
  }

  /**
   * FO 아이템 이동시 예약 이동 (cross-FO transfer)
   */
  async handleFulfillmentOrderItemTransfer(
    fromFoId: string,
    toFoId: string,
    fulfillmentOrderItemId: string,
    transferQuantity: number,
    tx?: DbTx,
  ): Promise<void> {
    return this.db.run(async (trx) => {
      // 해당 아이템의 예약 조회
      const itemReservations = await trx.query.stockReservations.findMany({
        where: and(
          eq(wmsTables.stockReservations.fulfillmentOrderItemId, fulfillmentOrderItemId),
          eq(wmsTables.stockReservations.status, 'confirmed'),
        ),
      });

      let remainingToTransfer = transferQuantity;

      for (const reservation of itemReservations) {
        if (remainingToTransfer <= 0) break;

        const transferReservationQty = Math.min(reservation.quantity, remainingToTransfer);

        // 새 FO에 예약 생성
        await this.unifiedReservation.reserveStock(
          {
            targetType: 'FULFILLMENT_ORDER',
            targetId: toFoId,
            skuId: reservation.skuId,
            warehouseId: reservation.warehouseId,
            quantity: transferReservationQty,
            fulfillmentOrderItemId: fulfillmentOrderItemId,
            reason: `Transferred from FO ${fromFoId} to ${toFoId}`,
          },
          trx,
        );

        // 원본 예약 처리
        if (transferReservationQty === reservation.quantity) {
          await this.unifiedReservation.releaseReservation(reservation.id, trx);
        } else {
          await trx
            .update(wmsTables.stockReservations)
            .set({
              quantity: reservation.quantity - transferReservationQty,
              updatedAt: new Date(),
            })
            .where(eq(wmsTables.stockReservations.id, reservation.id));

          await this.recalculateSellableQuantityForReservationSku(reservation, trx);
        }

        remainingToTransfer -= transferReservationQty;
      }

      this.logger.log(
        `Transferred ${transferQuantity} units from FO ${fromFoId} to ${toFoId} (Item: ${fulfillmentOrderItemId})`,
      );
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
