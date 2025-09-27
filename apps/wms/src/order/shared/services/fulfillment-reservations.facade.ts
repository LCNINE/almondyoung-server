import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { DbService } from '@app/db';
import { wmsTables, wmsSchema, DbTx } from '../../../../database/schemas/wms-schema';
import { eq, and } from 'drizzle-orm';
import { UnifiedReservationService } from '../../../shared/services/unified-reservation.service';

@Injectable()
export class FulfillmentReservationsFacade {
  private readonly logger = new Logger(FulfillmentReservationsFacade.name);

  constructor(
    private readonly db: DbService<typeof wmsSchema>,
    private readonly unified: UnifiedReservationService,
  ) {}

  private async inTx<T>(fn: (tx: DbTx) => Promise<T>, tx?: DbTx) {
    return tx ? fn(tx) : this.db.db.transaction(fn);
  }

  /**
   * FOL 기준 예약 생성 (통합 예약으로 위임)
   * dto: { fulfillmentOrderLineId: string; quantity: number }
   */
  async reserve(dto: { fulfillmentOrderLineId: string; quantity: number }, tx?: DbTx) {
    return this.inTx(async (trx) => {
      const fol = await trx.query.fulfillmentOrderLines.findFirst({
        where: eq(wmsTables.fulfillmentOrderLines.id, dto.fulfillmentOrderLineId),
      });
      if (!fol) {
        throw new BadRequestException(`FOL ${dto.fulfillmentOrderLineId} not found`);
      }

      const fo = await trx.query.fulfillmentOrders.findFirst({
        where: eq(wmsTables.fulfillmentOrders.id, fol.fulfillmentOrderId),
      });
      if (!fo) {
        throw new BadRequestException(`FO ${fol.fulfillmentOrderId} not found`);
      }
      if (!fo.warehouseId) {
        throw new BadRequestException(`FO ${fo.id} has no warehouseId`);
      }

      const reservation = await this.unified.reserveStock({
        targetType: 'FULFILLMENT_ORDER',
        targetId: fo.id,
        skuId: fol.skuId,
        warehouseId: fo.warehouseId,
        quantity: dto.quantity,
        // FOL과 FOI 스키마 차이를 고려해 연결은 생략(null). 필요시 추후 매핑 보강
        reason: 'Fulfillment order line reservation',
      }, trx);

      // 호환성: FOL 예약 수량 업데이트
      await trx
        .update(wmsTables.fulfillmentOrderLines)
        .set({ reservedQty: (fol.reservedQty || 0) + dto.quantity, updatedAt: new Date() })
        .where(eq(wmsTables.fulfillmentOrderLines.id, fol.id));

      // FO 집계 예약 수량 업데이트
      await trx
        .update(wmsTables.fulfillmentOrders)
        .set({ totalReservedQty: (fo.totalReservedQty || 0) + dto.quantity, updatedAt: new Date() })
        .where(eq(wmsTables.fulfillmentOrders.id, fo.id));

      this.logger.log(`Reserved ${dto.quantity} of SKU ${fol.skuId} for FO ${fo.id} (FOL ${fol.id})`);
      return reservation;
    }, tx);
  }

  /**
   * FOL 기준 예약 해제 (통합 예약에서 해당 FO+SKU 예약을 찾아 해제)
   * dto: { fulfillmentOrderLineId: string; quantity: number }
   */
  async unreserve(dto: { fulfillmentOrderLineId: string; quantity: number }, tx?: DbTx) {
    return this.inTx(async (trx) => {
      const fol = await trx.query.fulfillmentOrderLines.findFirst({
        where: eq(wmsTables.fulfillmentOrderLines.id, dto.fulfillmentOrderLineId),
      });
      if (!fol) {
        throw new BadRequestException(`FOL ${dto.fulfillmentOrderLineId} not found`);
      }
      const fo = await trx.query.fulfillmentOrders.findFirst({
        where: eq(wmsTables.fulfillmentOrders.id, fol.fulfillmentOrderId),
      });
      if (!fo) {
        throw new BadRequestException(`FO ${fol.fulfillmentOrderId} not found`);
      }

      // 해당 FO의 예약 중 동일 SKU만 필터
      const reservations = await this.unified.getReservationsByTarget('FULFILLMENT_ORDER', fo.id, trx);
      let remaining = dto.quantity;
      for (const r of reservations) {
        if (remaining <= 0) break;
        if (r.skuId !== fol.skuId) continue;
        // 통째로 해제 또는 부분 조정
        if (r.quantity <= remaining) {
          await this.unified.releaseReservation(r.id, trx);
          remaining -= r.quantity;
        } else {
          // 부분 해제: 수량 감소 처리
          await trx
            .update(wmsTables.stockReservations)
            .set({ quantity: r.quantity - remaining, updatedAt: new Date() })
            .where(and(eq(wmsTables.stockReservations.id, r.id), eq(wmsTables.stockReservations.status, 'confirmed') as any));
          remaining = 0;
        }
      }

      const released = dto.quantity - Math.max(0, remaining);

      // 호환성: FOL/FO 예약 수량 감소
      await trx
        .update(wmsTables.fulfillmentOrderLines)
        .set({ reservedQty: Math.max(0, (fol.reservedQty || 0) - released), updatedAt: new Date() })
        .where(eq(wmsTables.fulfillmentOrderLines.id, fol.id));

      await trx
        .update(wmsTables.fulfillmentOrders)
        .set({ totalReservedQty: Math.max(0, (fo.totalReservedQty || 0) - released), updatedAt: new Date() })
        .where(eq(wmsTables.fulfillmentOrders.id, fo.id));

      this.logger.log(`Unreserved ${released}/${dto.quantity} of SKU ${fol.skuId} for FO ${fo.id} (FOL ${fol.id})`);
    }, tx);
  }

  /**
   * 예약 이전: FOL 간 quantity 이동
   * dto: { fromFulfillmentOrderLineId: string; toFulfillmentOrderLineId: string; quantity: number }
   */
  async transferReservation(dto: { fromFulfillmentOrderLineId: string; toFulfillmentOrderLineId: string; quantity: number }, tx?: DbTx) {
    return this.inTx(async (trx) => {
      const from = await trx.query.fulfillmentOrderLines.findFirst({
        where: eq(wmsTables.fulfillmentOrderLines.id, dto.fromFulfillmentOrderLineId),
      });
      const to = await trx.query.fulfillmentOrderLines.findFirst({
        where: eq(wmsTables.fulfillmentOrderLines.id, dto.toFulfillmentOrderLineId),
      });
      if (!from || !to) {
        throw new BadRequestException('Invalid FOL id(s)');
      }
      const fromFo = await trx.query.fulfillmentOrders.findFirst({ where: eq(wmsTables.fulfillmentOrders.id, from.fulfillmentOrderId) });
      const toFo = await trx.query.fulfillmentOrders.findFirst({ where: eq(wmsTables.fulfillmentOrders.id, to.fulfillmentOrderId) });
      if (!fromFo || !toFo || !toFo.warehouseId) {
        throw new BadRequestException('Invalid FO(s) or target FO has no warehouse');
      }
      if (from.skuId !== to.skuId) {
        throw new BadRequestException('SKU mismatch between from/to FOL');
      }

      // 1) 타겟에 예약 생성 (가용성 체크 포함)
      await this.unified.reserveStock({
        targetType: 'FULFILLMENT_ORDER',
        targetId: toFo.id,
        skuId: to.skuId,
        warehouseId: toFo.warehouseId,
        quantity: dto.quantity,
        reason: `Transfer from FOL ${from.id} to ${to.id}`,
      }, trx);

      // 2) 소스에서 동일 SKU 예약 해제 (수량만큼)
      await this.unreserve({ fulfillmentOrderLineId: from.id, quantity: dto.quantity }, trx);

      // 3) 호환성: FOL/FO 예약 수량 갱신
      await trx
        .update(wmsTables.fulfillmentOrderLines)
        .set({ reservedQty: (to.reservedQty || 0) + dto.quantity, updatedAt: new Date() })
        .where(eq(wmsTables.fulfillmentOrderLines.id, to.id));

      await trx
        .update(wmsTables.fulfillmentOrders)
        .set({ totalReservedQty: (toFo.totalReservedQty || 0) + dto.quantity, updatedAt: new Date() })
        .where(eq(wmsTables.fulfillmentOrders.id, toFo.id));

      this.logger.log(`Transferred ${dto.quantity} from FOL ${from.id} to FOL ${to.id}`);
    }, tx);
  }
}


