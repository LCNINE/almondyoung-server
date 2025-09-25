import { Injectable, Logger } from '@nestjs/common';
import { DbService } from '@app/db';
import { wmsTables, wmsSchema, DbTx } from '../../../database/schemas/wms-schema';
import { eq, and, inArray } from 'drizzle-orm';
import { UnifiedReservationService } from './unified-reservation.service';

@Injectable()
export class ReservationLifecycleService {
  private readonly logger = new Logger(ReservationLifecycleService.name);

  constructor(
    private readonly db: DbService<typeof wmsSchema>,
    private readonly unifiedReservation: UnifiedReservationService
  ) {}

  private async inTx<T>(fn: (tx: DbTx) => Promise<T>, tx?: DbTx): Promise<T> {
    return tx ? fn(tx) : this.db.db.transaction(fn);
  }

  /**
   * FO 상태 변경시 예약 처리
   */
  async handleFulfillmentOrderStatusChange(
    fulfillmentOrderId: string,
    oldStatus: string,
    newStatus: string,
    tx?: DbTx
  ): Promise<void> {
    return this.inTx(async (trx) => {
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
    tx?: DbTx
  ): Promise<void> {
    return this.inTx(async (trx) => {
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
    tx: DbTx
  ): Promise<void> {
    // 1. FO의 모든 예약 조회
    const reservations = await this.unifiedReservation.getReservationsByTarget(
      'FULFILLMENT_ORDER',
      fulfillmentOrderId,
      tx
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
  private async releaseMovementTaskReservations(
    movementTaskId: string,
    reason: string,
    tx: DbTx
  ): Promise<void> {
    // 1. Movement Task의 모든 예약 조회
    const reservations = await this.unifiedReservation.getReservationsByTarget(
      'MOVEMENT_TASK',
      movementTaskId,
      tx
    );

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
    // 1. FO 아이템별 출고 현황 조회 (Core Query)
    const fulfillmentOrderItems = await tx
      .select()
      .from(wmsTables.fulfillmentOrderItems)
      .where(eq(wmsTables.fulfillmentOrderItems.fulfillmentOrderId, fulfillmentOrderId));

    // 해당 아이템들의 라인들을 한번에 조회해 메모리에서 그룹핑
    const foiIds = fulfillmentOrderItems.map(i => i.id);
    const fulfillmentOrderLines = foiIds.length > 0
      ? await tx
          .select()
          .from(wmsTables.fulfillmentOrderLines)
          .where(inArray(wmsTables.fulfillmentOrderLines.fulfillmentOrderId, [fulfillmentOrderId]))
      : [];

    const linesByFoItemId = new Map<string, { shippedQty: number }[]>();
    for (const l of fulfillmentOrderLines) {
      const arr = linesByFoItemId.get(l.id) || [];
      arr.push({ shippedQty: (l as any).shippedQty || 0 });
      linesByFoItemId.set(l.id, arr);
    }

    for (const item of fulfillmentOrderItems) {
      const relatedLines = linesByFoItemId.get(item.id) || [];
      const totalShipped = relatedLines.reduce((sum, line) => sum + (line.shippedQty || 0), 0);

      if (totalShipped > 0) {
        // 2. 해당 아이템의 예약 조회
        const reservations = await tx
          .select()
          .from(wmsTables.stockReservations)
          .where(and(
            eq(wmsTables.stockReservations.fulfillmentOrderItemId, item.id),
            eq(wmsTables.stockReservations.status, 'confirmed')
          ));

        // 3. 출고된 수량만큼 예약 해제 (FIFO 방식)
        let remainingToRelease = totalShipped;

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
                updatedAt: new Date()
              })
              .where(eq(wmsTables.stockReservations.id, reservation.id));
          }

          remainingToRelease -= releaseQuantity;
        }

        // 4. FO 아이템 예약 수량 업데이트
        const remainingReserved = Math.max(0, item.reservedQty - totalShipped);
        await tx
          .update(wmsTables.fulfillmentOrderItems)
          .set({ reservedQty: remainingReserved })
          .where(eq(wmsTables.fulfillmentOrderItems.id, item.id));
      }
    }

    this.logger.log(`Handled partial shipment for FO ${fulfillmentOrderId}`);
  }

  /**
   * 예약 만료 배치 처리
   */
  async processExpiredReservations(tx?: DbTx): Promise<number> {
    return this.inTx(async (trx) => {
      const expiredReservations = await trx.query.stockReservations.findMany({
        where: and(
          eq(wmsTables.stockReservations.status, 'confirmed'),
          // timeoutAt < now()
        )
      });

      let releasedCount = 0;

      for (const reservation of expiredReservations) {
        try {
          await this.unifiedReservation.releaseReservation(reservation.id, trx);
          releasedCount++;
        } catch (error) {
          this.logger.warn(`Failed to release expired reservation ${reservation.id}: ${error.message}`);
        }
      }

      this.logger.log(`Processed ${releasedCount} expired reservations`);
      return releasedCount;
    }, tx);
  }

  /**
   * FO 분할시 예약 재분배
   */
  async handleFulfillmentOrderSplit(
    originalFoId: string,
    newFoId: string,
    splitItems: Array<{
      fulfillmentOrderLineId: string;
      skuId: string;
      splitQuantity: number;
      originalQuantity: number;
    }>,
    tx?: DbTx
  ): Promise<void> {
    return this.inTx(async (trx) => {
      for (const item of splitItems) {
        // 1. 원본 FO의 예약 조회
        const originalReservations = await trx.query.stockReservations.findMany({
          where: and(
            eq(wmsTables.stockReservations.fulfillmentOrderItemId, item.fulfillmentOrderLineId),
            eq(wmsTables.stockReservations.status, 'confirmed')
          )
        });

        if (originalReservations.length === 0) continue;

        const splitRatio = item.splitQuantity / item.originalQuantity;
        let remainingToSplit = item.splitQuantity;

        for (const reservation of originalReservations) {
          if (remainingToSplit <= 0) break;

          // 2. 분할할 수량 계산 (비례 분배)
          const splitReservationQty = Math.min(
            Math.floor(reservation.quantity * splitRatio),
            remainingToSplit
          );

          if (splitReservationQty > 0) {
            // 3. 새 FO에 대한 예약 생성
            await this.unifiedReservation.reserveStock({
              targetType: 'FULFILLMENT_ORDER',
              targetId: newFoId,
              skuId: item.skuId,
              warehouseId: reservation.warehouseId,
              quantity: splitReservationQty,
              fulfillmentOrderItemId: item.fulfillmentOrderLineId, // 새 FOI ID 필요
              reason: `Split from FO ${originalFoId}`
            }, trx);

            // 4. 원본 예약 수량 차감
            if (splitReservationQty === reservation.quantity) {
              // 전체 예약을 새 FO로 이동
              await this.unifiedReservation.releaseReservation(reservation.id, trx);
            } else {
              // 부분 이동: 원본 예약 수량 감소
              await trx
                .update(wmsTables.stockReservations)
                .set({
                  quantity: reservation.quantity - splitReservationQty,
                  updatedAt: new Date()
                })
                .where(eq(wmsTables.stockReservations.id, reservation.id));
            }

            remainingToSplit -= splitReservationQty;
          }
        }
      }

      this.logger.log(`Split FO ${originalFoId} → ${newFoId} with reservation redistribution`);
    }, tx);
  }

  /**
   * FO 병합시 예약 통합
   */
  async handleFulfillmentOrderMerge(
    sourceFoIds: string[],
    targetFoId: string,
    tx?: DbTx
  ): Promise<void> {
    return this.inTx(async (trx) => {
      for (const sourceFoId of sourceFoIds) {
        // 1. 소스 FO의 모든 예약 조회
        const sourceReservations = await this.unifiedReservation.getReservationsByTarget(
          'FULFILLMENT_ORDER',
          sourceFoId,
          trx
        );

        for (const reservation of sourceReservations) {
          // 2. 타겟 FO에 동일한 예약 생성
          await this.unifiedReservation.reserveStock({
            targetType: 'FULFILLMENT_ORDER',
            targetId: targetFoId,
            skuId: reservation.skuId,
            warehouseId: reservation.warehouseId,
            quantity: reservation.quantity,
            fulfillmentOrderItemId: reservation.fulfillmentOrderItemId || undefined,
            reason: `Merged from FO ${sourceFoId}`
          }, trx);

          // 3. 원본 예약 해제
          await this.unifiedReservation.releaseReservation(reservation.id, trx);
        }

        this.logger.log(`Merged reservations from FO ${sourceFoId} → ${targetFoId}`);
      }
    }, tx);
  }

  /**
   * FO 라인 이동시 예약 이동 (cross-FO transfer)
   */
  async handleFulfillmentOrderLineTransfer(
    fromFoId: string,
    toFoId: string,
    fulfillmentOrderLineId: string,
    transferQuantity: number,
    tx?: DbTx
  ): Promise<void> {
    return this.inTx(async (trx) => {
      // 1. 해당 라인의 예약 조회
      const lineReservations = await trx.query.stockReservations.findMany({
        where: and(
          eq(wmsTables.stockReservations.fulfillmentOrderItemId, fulfillmentOrderLineId),
          eq(wmsTables.stockReservations.status, 'confirmed')
        )
      });

      let remainingToTransfer = transferQuantity;

      for (const reservation of lineReservations) {
        if (remainingToTransfer <= 0) break;

        const transferReservationQty = Math.min(reservation.quantity, remainingToTransfer);

        // 2. 새 FO에 예약 생성
        await this.unifiedReservation.reserveStock({
          targetType: 'FULFILLMENT_ORDER',
          targetId: toFoId,
          skuId: reservation.skuId,
          warehouseId: reservation.warehouseId,
          quantity: transferReservationQty,
          fulfillmentOrderItemId: fulfillmentOrderLineId,
          reason: `Transferred from FO ${fromFoId} to ${toFoId}`
        }, trx);

        // 3. 원본 예약 처리
        if (transferReservationQty === reservation.quantity) {
          await this.unifiedReservation.releaseReservation(reservation.id, trx);
        } else {
          await trx
            .update(wmsTables.stockReservations)
            .set({
              quantity: reservation.quantity - transferReservationQty,
              updatedAt: new Date()
            })
            .where(eq(wmsTables.stockReservations.id, reservation.id));
        }

        remainingToTransfer -= transferReservationQty;
      }

      this.logger.log(
        `Transferred ${transferQuantity} units from FO ${fromFoId} to ${toFoId} (Line: ${fulfillmentOrderLineId})`
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
    tx?: DbTx
  ): Promise<void> {
    return this.inTx(async (trx) => {
      const quantityDiff = newQuantity - oldQuantity;

      if (quantityDiff === 0) return;

      const reservations = await trx.query.stockReservations.findMany({
        where: and(
          eq(wmsTables.stockReservations.fulfillmentOrderItemId, fulfillmentOrderItemId),
          eq(wmsTables.stockReservations.status, 'confirmed')
        )
      });

      if (quantityDiff > 0) {
        // 수량 증가: 추가 예약 필요
        if (reservations.length > 0) {
          const firstReservation = reservations[0];
          await this.unifiedReservation.reserveStock({
            targetType: 'FULFILLMENT_ORDER',
            targetId: firstReservation.targetId,
            skuId: firstReservation.skuId,
            warehouseId: firstReservation.warehouseId,
            quantity: quantityDiff,
            fulfillmentOrderItemId: fulfillmentOrderItemId,
            reason: 'Quantity increased'
          }, trx);
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
                updatedAt: new Date()
              })
              .where(eq(wmsTables.stockReservations.id, reservation.id));
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
        `Adjusted reservations for FOI ${fulfillmentOrderItemId}: ${oldQuantity} → ${newQuantity} (${quantityDiff > 0 ? '+' : ''}${quantityDiff})`
      );
    }, tx);
  }
}