import { Injectable, BadRequestException, ConflictException, Logger } from '@nestjs/common';
import { DbService, TypedDatabase } from '@app/db';
import { wmsTables } from '../../../../database/schemas/wms-schema';
import { eq, and } from 'drizzle-orm';
import { AvailabilityService } from './availability.service';
import { MetricsService } from '../../../shared/services/metrics.service';

type DbTx = Parameters<Parameters<TypedDatabase<typeof wmsTables>['transaction']>[0]>[0];

@Injectable()
export class ReservationsService {
  private readonly logger = new Logger(ReservationsService.name);
  private readonly MAX_RETRY_ATTEMPTS = 3;
  private readonly RETRY_DELAY_MS = 100;

  constructor(
    private readonly db: DbService<typeof wmsTables>,
    private readonly availability: AvailabilityService,
    private readonly metrics?: MetricsService,
  ) {}

  private async inTx<T>(fn: (tx: DbTx) => Promise<T>, tx?: DbTx) {
    return tx ? fn(tx) : this.db.db.transaction(fn);
  }

  private async sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * 낙관적 잠금을 사용한 안전한 예약
   */
  async reserveWithOptimisticLocking(
    dto: { fulfillmentOrderLineId: string; quantity: number },
    tx?: DbTx
  ) {
    const timer = this.metrics?.startStockReservationTimer();

    return this.inTx(async (trx) => {
      const fol = await trx.query.fulfillmentOrderLines.findFirst({
        where: (l, { eq }) => eq(l.id, dto.fulfillmentOrderLineId)
      });

      if (!fol) throw new BadRequestException('FOL not found');

      const fo = await trx.query.fulfillmentOrders.findFirst({
        where: (f, { eq }) => eq(f.id, fol.fulfillmentOrderId),
      });

      if (!fo?.warehouseId) throw new BadRequestException('FO warehouse missing');

      // Drop-ship 체크 (기존 로직)
      if (fo.salesOrderId) {
        const soLines = await trx.query.salesOrderLines.findMany({
          where: (l, { eq }) => eq(l.salesOrderId, fo.salesOrderId!)
        });
        const modes = new Set<string>();
        for (const sl of soLines) {
          const p = await this.db.db.query.salesVariantPolicies.findFirst({
            where: (pp, { eq }) => eq(pp.variantId, sl.variantId)
          });
          if (p?.fulfillmentMode) modes.add(p.fulfillmentMode);
        }
        if (modes.has('drop_ship')) {
          throw new BadRequestException('RESERVATION_NOT_ALLOWED_FOR_DROP_SHIP');
        }
      }

      let attempt = 0;
      while (attempt < this.MAX_RETRY_ATTEMPTS) {
        try {
          attempt++;

          // 1. 현재 stockSummary와 version 조회
          const stockSummary = await trx.query.stockSummary.findFirst({
            where: and(
              eq(wmsTables.stockSummary.skuId, fol.skuId),
              eq(wmsTables.stockSummary.warehouseId, fo.warehouseId)
            )
          });

          if (!stockSummary) {
            throw new BadRequestException(`No stock summary found for SKU ${fol.skuId} in warehouse ${fo.warehouseId}`);
          }

          // 2. 가용 재고 검증
          const availableQty = stockSummary.availableQuantity;
          if (availableQty < dto.quantity) {
            throw new BadRequestException(`Insufficient available quantity. Available: ${availableQty}, Requested: ${dto.quantity}`);
          }

          // 3. 낙관적 잠금으로 stockSummary 업데이트 시도
          const updateResult = await trx
            .update(wmsTables.stockSummary)
            .set({
              availableQuantity: stockSummary.availableQuantity - dto.quantity,
              reservedQuantity: stockSummary.reservedQuantity + dto.quantity,
              version: stockSummary.version + 1,
              lastUpdated: new Date()
            })
            .where(and(
              eq(wmsTables.stockSummary.id, stockSummary.id),
              eq(wmsTables.stockSummary.version, stockSummary.version) // 낙관적 잠금
            ))
            .returning();

          if (updateResult.length === 0) {
            // 버전이 변경되어 업데이트 실패 - 재시도
            this.logger.warn(`Optimistic lock failed for stock summary ${stockSummary.id}, attempt ${attempt}`);
            this.metrics?.incrementOptimisticLockRetries('stock_reservation');
            if (attempt < this.MAX_RETRY_ATTEMPTS) {
              await this.sleep(this.RETRY_DELAY_MS * attempt);
              continue;
            } else {
              timer?.(); // 실패 시 타이머 종료
              this.metrics?.incrementStockReservationCounter('failure', fo.warehouseId);
              throw new ConflictException('Failed to reserve stock due to concurrent modifications. Please retry.');
            }
          }

          // 4. 예약 레코드 생성
          await trx.insert(wmsTables.stockReservations).values({
            fulfillmentOrderItemId: fol.id,
            skuId: fol.skuId,
            quantity: dto.quantity,
            status: 'confirmed',
            timeoutAt: null, // TODO: 향후 타임아웃 구현
          });

          // 5. FOL의 reservedQty 업데이트
          await trx
            .update(wmsTables.fulfillmentOrderLines)
            .set({ reservedQty: fol.reservedQty + dto.quantity })
            .where(eq(wmsTables.fulfillmentOrderLines.id, fol.id));

          this.logger.log(`Successfully reserved ${dto.quantity} units for FOL ${fol.id} (attempt ${attempt})`);

          // 성공 메트릭 기록
          timer?.(); // 성공 시 타이머 종료
          this.metrics?.incrementStockReservationCounter('success', fo.warehouseId);

          return { ok: true, reservedQuantity: dto.quantity };

        } catch (error) {
          if (error instanceof ConflictException || error instanceof BadRequestException) {
            throw error;
          }

          this.logger.error(`Reservation attempt ${attempt} failed:`, error);
          if (attempt >= this.MAX_RETRY_ATTEMPTS) {
            throw error;
          }
          await this.sleep(this.RETRY_DELAY_MS * attempt);
        }
      }

      throw new ConflictException('Failed to reserve stock after maximum retry attempts');
    }, tx);
  }

  /**
   * 예약 (기존 메소드 - 하위 호환성을 위해 유지하지만 새로운 안전한 메소드로 위임)
   */
  async reserve(dto: { fulfillmentOrderLineId: string; quantity: number }, tx?: DbTx) {
    this.logger.warn('Using legacy reserve method. Consider using reserveWithOptimisticLocking for better concurrency control.');
    return this.reserveWithOptimisticLocking(dto, tx);
  }

  async unreserve(dto: { fulfillmentOrderLineId: string; quantity: number }, tx?: DbTx) {
    return this.inTx(async (trx) => {
      // Drop-ship인 경우 로컬 예약 금지(no-op 허용)
      const fol = await trx.query.fulfillmentOrderLines.findFirst({ where: (l, { eq }) => eq(l.id, dto.fulfillmentOrderLineId) });
      if (!fol) throw new BadRequestException('FOL not found');
      const foHeader = await trx.query.fulfillmentOrders.findFirst({ where: (f, { eq }) => eq(f.id, fol.fulfillmentOrderId) });
      if (foHeader?.salesOrderId) {
        const soLines = await trx.query.salesOrderLines.findMany({ where: (l, { eq }) => eq(l.salesOrderId, foHeader.salesOrderId!) });
        const modes = new Set<string>();
        for (const sl of soLines) {
          const p = await this.db.db.query.salesVariantPolicies.findFirst({ where: (pp, { eq }) => eq(pp.variantId, sl.variantId) });
          if (p?.fulfillmentMode) modes.add(p.fulfillmentMode);
        }
        if (modes.has('drop_ship')) {
          return { ok: true };
        }
      }
      const line = fol;
      const toRelease = Math.min(dto.quantity, line.reservedQty);
      if (toRelease <= 0) return { ok: true };

      // 단순 전략: 최신 confirmed 하나를 감소(실무는 다건 순회 필요)
      const existing = await trx.query.stockReservations.findFirst({
        where: (r, { and, eq }) => and(eq(r.fulfillmentOrderLineId, line.id), eq(r.status, 'confirmed')),
        orderBy: (r, { desc }) => [desc(r.createdAt as any)],
      } as any);

      if (existing) {
        if (existing.quantity > toRelease) {
          await trx
            .update(wmsTables.stockReservations)
            .set({ quantity: existing.quantity - toRelease })
            .where(eq(wmsTables.stockReservations.reservationId, existing.reservationId));
        } else {
          await trx
            .update(wmsTables.stockReservations)
            .set({ status: 'released' })
            .where(eq(wmsTables.stockReservations.reservationId, existing.reservationId));
        }
      }

      await trx
        .update(wmsTables.fulfillmentOrderLines)
        .set({ reservedQty: line.reservedQty - toRelease })
        .where(eq(wmsTables.fulfillmentOrderLines.id, line.id));

      return { ok: true };
    }, tx);
  }

  async transferReservation(
    dto: { fromFulfillmentOrderLineId: string; toFulfillmentOrderLineId: string; quantity: number },
    tx?: DbTx,
  ) {
    return this.inTx(async (trx) => {
      const src = await trx.query.fulfillmentOrderLines.findFirst({
        where: (l, { eq }) => eq(l.id, dto.fromFulfillmentOrderLineId),
      });
      const dst = await trx.query.fulfillmentOrderLines.findFirst({
        where: (l, { eq }) => eq(l.id, dto.toFulfillmentOrderLineId),
      });
      if (!src || !dst) throw new BadRequestException('FOL not found');
      if (src.skuId !== dst.skuId) throw new BadRequestException('SKU mismatch');
      const moveQty = Math.min(dto.quantity, src.reservedQty);
      if (moveQty <= 0) return { ok: true };

      // 소스 예약 감소/해제
      const srcRes = await trx.query.stockReservations.findFirst({
        where: (r, { and, eq }) => and(eq(r.fulfillmentOrderLineId, src.id), eq(r.status, 'confirmed')),
      } as any);
      if (!srcRes || srcRes.quantity < moveQty) throw new BadRequestException('Insufficient reserved');

      if (srcRes.quantity === moveQty) {
        await trx
          .update(wmsTables.stockReservations)
          .set({ status: 'released' })
          .where(eq(wmsTables.stockReservations.reservationId, srcRes.reservationId));
      } else {
        await trx
          .update(wmsTables.stockReservations)
          .set({ quantity: srcRes.quantity - moveQty })
          .where(eq(wmsTables.stockReservations.reservationId, srcRes.reservationId));
      }

      await trx
        .update(wmsTables.fulfillmentOrderLines)
        .set({ reservedQty: src.reservedQty - moveQty })
        .where(eq(wmsTables.fulfillmentOrderLines.id, src.id));

      // 대상 예약 생성/증가
      await trx.insert(wmsTables.stockReservations).values({
        fulfillmentOrderItemId: dst.id,
        skuId: dst.skuId,
        quantity: moveQty,
        status: 'confirmed',
        timeoutAt: null,
      });

      await trx
        .update(wmsTables.fulfillmentOrderLines)
        .set({ reservedQty: dst.reservedQty + moveQty })
        .where(eq(wmsTables.fulfillmentOrderLines.id, dst.id));

      return { ok: true };
    }, tx);
  }
}


