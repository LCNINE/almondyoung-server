import { Injectable, BadRequestException, ConflictException, Logger } from '@nestjs/common';
import { DbService, TypedDatabase } from '@app/db';
import { wmsTables, wmsSchema } from '../../../../database/schemas/wms-schema';
import { eq, and } from 'drizzle-orm';
import { AvailabilityService } from './availability.service';
import { MetricsService } from '../../../shared/services/metrics.service';
import { UnifiedReservationService, ReserveStockDto } from '../../../shared/services/unified-reservation.service';

type DbTx = Parameters<Parameters<TypedDatabase<typeof wmsSchema>['transaction']>[0]>[0];

interface ReserveFulfilmentOrderLineDto {
  fulfillmentOrderItemId: string;
  skuId: string;
  warehouseId: string;
  quantity: number;
}

@Injectable()
export class ReservationsService {
  private readonly logger = new Logger(ReservationsService.name);

  constructor(
    private readonly db: DbService<typeof wmsSchema>,
    private readonly availability: AvailabilityService,
    private readonly unifiedReservation: UnifiedReservationService,
  ) {}

  private async inTx<T>(fn: (tx: DbTx) => Promise<T>, tx?: DbTx) {
    return tx ? fn(tx) : this.db.db.transaction(fn);
  }

  private async sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * FO 예약 - 통합 예약 시스템 사용
   * 기존 호환성을 위해 메서드 유지
   */
  async reserveWithOptimisticLocking(dto: ReserveFulfilmentOrderLineDto, tx?: DbTx) {
    return this.inTx(async (trx) => {
      // 1. FO 정보 조회 (Core Query)
      const foiRows = await trx
        .select({
          fulfillmentOrderId: wmsTables.fulfillmentOrderItems.fulfillmentOrderId,
        })
        .from(wmsTables.fulfillmentOrderItems)
        .where(eq(wmsTables.fulfillmentOrderItems.id, dto.fulfillmentOrderItemId))
        .limit(1);

      const fulfillmentOrderItem = foiRows[0];
      if (!fulfillmentOrderItem) {
        throw new BadRequestException(`Fulfillment order item ${dto.fulfillmentOrderItemId} not found`);
      }

      // 2. 통합 예약 시스템 사용
      const reservation = await this.unifiedReservation.reserveStock({
        targetType: 'FULFILLMENT_ORDER',
        targetId: fulfillmentOrderItem.fulfillmentOrderId,
        skuId: dto.skuId,
        warehouseId: dto.warehouseId,
        quantity: dto.quantity,
        fulfillmentOrderItemId: dto.fulfillmentOrderItemId,
        reason: 'Fulfillment order reservation'
      }, trx);

      // 3. FO Line 예약 수량 업데이트 (기존 호환성)
      await trx
        .update(wmsTables.fulfillmentOrderLines)
        .set({
          reservedQty: dto.quantity,
          updatedAt: new Date()
        })
        .where(eq(wmsTables.fulfillmentOrderLines.id, dto.fulfillmentOrderItemId));

      this.logger.log(`Reserved ${dto.quantity} units for FO item ${dto.fulfillmentOrderItemId}`);

      return {
        reservationId: reservation.id,
        quantity: reservation.quantity
      };
    }, tx);
  }

  /**
   * 예약 해제 - 통합 예약 시스템 사용
   */
  async unreserve(fulfillmentOrderItemId: string, tx?: DbTx) {
    return this.inTx(async (trx) => {
      // 1. 예약 정보 조회
      const reservation = await trx.query.stockReservations.findFirst({
        where: and(
          eq(wmsTables.stockReservations.fulfillmentOrderItemId, fulfillmentOrderItemId),
          eq(wmsTables.stockReservations.status, 'confirmed')
        )
      });

      if (!reservation) {
        throw new BadRequestException(`No active reservation found for FOI ${fulfillmentOrderItemId}`);
      }

      // 2. 통합 예약 시스템으로 해제
      await this.unifiedReservation.releaseReservation(reservation.id, trx);

      // 3. FO Line 예약 수량 업데이트 (기존 호환성)
      await trx
        .update(wmsTables.fulfillmentOrderLines)
        .set({
          reservedQty: 0,
          updatedAt: new Date()
        })
        .where(eq(wmsTables.fulfillmentOrderLines.id, fulfillmentOrderItemId));

      this.logger.log(`Unreserved FOI ${fulfillmentOrderItemId}`);
    }, tx);
  }

  /**
   * 예약 이전 - 통합 예약 시스템 사용
   */
  async transferReservation(
    fromFulfillmentOrderItemId: string,
    toFulfillmentOrderItemId: string,
    quantity?: number,
    tx?: DbTx
  ) {
    return this.inTx(async (trx) => {
      // 1. 기존 예약 정보 조회
      const fromReservation = await trx.query.stockReservations.findFirst({
        where: and(
          eq(wmsTables.stockReservations.fulfillmentOrderItemId, fromFulfillmentOrderItemId),
          eq(wmsTables.stockReservations.status, 'confirmed')
        )
      });

      if (!fromReservation) {
        throw new BadRequestException(`No active reservation found for FOI ${fromFulfillmentOrderItemId}`);
      }

      // 2. 대상 FO 정보 조회
      const toFoRows = await trx
        .select({
          id: wmsTables.fulfillmentOrderItems.id,
          fulfillmentOrderId: wmsTables.fulfillmentOrderItems.fulfillmentOrderId,
        })
        .from(wmsTables.fulfillmentOrderItems)
        .where(eq(wmsTables.fulfillmentOrderItems.id, toFulfillmentOrderItemId))
        .limit(1);
      const toFulfillmentOrderItem = toFoRows[0];

      if (!toFulfillmentOrderItem) {
        throw new BadRequestException(`Target fulfillment order item ${toFulfillmentOrderItemId} not found`);
      }

      // 3. 통합 예약 시스템으로 이전
      const newReservation = await this.unifiedReservation.transferReservation(
        fromReservation.id,
        'FULFILLMENT_ORDER',
        toFulfillmentOrderItem.fulfillmentOrderId,
        trx
      );

      // 4. 새 예약에 FOI 연결
      await trx
        .update(wmsTables.stockReservations)
        .set({
          fulfillmentOrderItemId: toFulfillmentOrderItemId,
          updatedAt: new Date()
        })
        .where(eq(wmsTables.stockReservations.id, newReservation.id));

      // 5. FO Line 예약 수량 업데이트
      const transferQuantity = quantity || fromReservation.quantity;

      await trx
        .update(wmsTables.fulfillmentOrderLines)
        .set({
          reservedQty: 0,
          updatedAt: new Date()
        })
        .where(eq(wmsTables.fulfillmentOrderLines.id, fromFulfillmentOrderItemId));

      await trx
        .update(wmsTables.fulfillmentOrderLines)
        .set({
          reservedQty: transferQuantity,
          updatedAt: new Date()
        })
        .where(eq(wmsTables.fulfillmentOrderLines.id, toFulfillmentOrderItemId));

      this.logger.log(
        `Transferred reservation from FOI ${fromFulfillmentOrderItemId} to ${toFulfillmentOrderItemId}`
      );

      return {
        newReservationId: newReservation.id,
        quantity: transferQuantity
      };
    }, tx);
  }

  // ==============================================
  // 새로운 통합 예약 API 노출
  // ==============================================

  /**
   * Movement Task 예약 생성
   */
  async reserveForMovement(dto: {
    movementTaskId: string;
    skuId: string;
    warehouseId: string;
    quantity: number;
    reason?: string;
  }, tx?: DbTx) {
    return this.unifiedReservation.reserveStock({
      targetType: 'MOVEMENT_TASK',
      targetId: dto.movementTaskId,
      skuId: dto.skuId,
      warehouseId: dto.warehouseId,
      quantity: dto.quantity,
      reason: dto.reason || 'Movement task reservation'
    }, tx);
  }

  /**
   * 특정 대상의 예약 현황 조회
   */
  async getReservationsByTarget(targetType: string, targetId: string, tx?: DbTx) {
    return this.unifiedReservation.getReservationsByTarget(targetType, targetId, tx);
  }

  /**
   * 특정 SKU의 예약 현황 조회
   */
  async getReservationsBySku(skuId: string, warehouseId?: string, tx?: DbTx) {
    return this.unifiedReservation.getReservationsBySku(skuId, warehouseId, tx);
  }

  /**
   * SKU별 총 예약 수량
   */
  async getTotalReservedQuantity(skuId: string, warehouseId: string, tx?: DbTx) {
    return this.unifiedReservation.getTotalReservedQuantity(skuId, warehouseId, tx);
  }

  /**
   * 창고별 예약 통계
   */
  async getReservationSummary(warehouseId: string, tx?: DbTx) {
    return this.unifiedReservation.getReservationSummary(warehouseId, tx);
  }
}