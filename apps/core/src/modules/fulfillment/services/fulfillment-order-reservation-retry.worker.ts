import { BadRequestException, ConflictException, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DbService } from '@app/db';
import { InjectTypedDb } from '@app/db/decorators';
import { and, asc, eq, gt, isNotNull, isNull, ne, or } from 'drizzle-orm';
import { DbTx, wmsSchema, wmsTables } from '../../inventory/schema/inventory.schema';
import { FulfillmentReservationsFacade } from './fulfillment-reservations.facade';

/**
 * unfulfillable FO 자동 재예약 워커.
 *
 * FO 생성 시 자동 예약이 실패하면 status='unfulfillable'(RESERVATION_FAILED)로 남고
 * 이후 재고가 늘어나도 스스로 복구되지 않는다. 이 워커가 주기적으로
 * "부족 FOI의 SKU에 가용재고가 생긴 unfulfillable FO"를 골라 예약을 재시도한다.
 *
 * 가용재고 판단을 stock_summary_view로 하므로 입고뿐 아니라 조정(ADJUST_UP),
 * 타 FO의 예약 해제 등 어떤 경로로 재고가 풀려도 동작한다.
 * 예약/상태 전환/READY outbox는 전부 FulfillmentReservationsFacade.reserve()에
 * 위임한다 — 잠금 컨벤션(FO→FOI)과 over-reserve 불변식도 그쪽이 방어선.
 *
 * status='created'(운영자가 의도적으로 예약 해제한 상태 포함)는 건드리지 않는다.
 */
@Injectable()
export class FulfillmentOrderReservationRetryWorker {
  private readonly logger = new Logger(FulfillmentOrderReservationRetryWorker.name);
  private isProcessing = false;

  constructor(
    @InjectTypedDb<typeof wmsSchema>()
    private readonly dbService: DbService<typeof wmsSchema>,
    private readonly reservations: FulfillmentReservationsFacade,
  ) {}

  private get db() {
    return this.dbService.db;
  }

  private exec(tx?: DbTx) {
    return tx ?? this.db;
  }

  @Cron(CronExpression.EVERY_10_SECONDS)
  async retryUnfulfillable() {
    if (this.isProcessing) {
      this.logger.debug('Previous reservation retry run is still active, skipping');
      return;
    }

    this.isProcessing = true;
    try {
      const candidates = await this.findCandidates(20);
      for (const candidate of candidates) {
        try {
          await this.retryOne(candidate.id);
        } catch (error) {
          this.logger.error(`Failed to retry reservation for FO ${candidate.id}`, error);
        }
      }
    } catch (error) {
      this.logger.error('Failed to process reservation retry batch', error);
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * 후보: unfulfillable + warehouse 보유 + drop_ship 아님 +
   * 부족 FOI(qty > reservedQty) 중 최소 하나의 SKU에 가용재고가 있는 FO.
   * 오래된 주문부터 재고를 가져가도록 createdAt asc.
   */
  async findCandidates(limit: number, tx?: DbTx): Promise<Array<{ id: string }>> {
    const fo = wmsTables.fulfillmentOrders;
    const foi = wmsTables.fulfillmentOrderItems;
    const summary = wmsSchema.stockSummary;

    return this.exec(tx)
      .selectDistinct({ id: fo.id, createdAt: fo.createdAt })
      .from(fo)
      .innerJoin(foi, and(eq(foi.fulfillmentOrderId, fo.id), gt(foi.qty, foi.reservedQty)))
      .innerJoin(
        summary,
        and(eq(summary.skuId, foi.skuId), eq(summary.warehouseId, fo.warehouseId), gt(summary.availableQty, 0)),
      )
      .where(
        and(
          eq(fo.status, 'unfulfillable'),
          isNotNull(fo.warehouseId),
          // fulfillmentMode != 'drop_ship' 은 NULL(수동 FO)을 제외시키므로 isNull을 함께 허용
          or(isNull(fo.fulfillmentMode), ne(fo.fulfillmentMode, 'drop_ship')),
        ),
      )
      .orderBy(asc(fo.createdAt), asc(fo.id))
      .limit(limit);
  }

  /**
   * FO 하나의 부족 FOI들을 id asc 순서로 예약 재시도.
   * facade.reserve가 FOI 단위 전량(부족분) 예약이며, 재고 부족(Conflict)·
   * 상태 변경 경합(terminal 전환 등)은 다음 주기로 미루고 넘어간다.
   * 전 FOI가 채워지면 facade 내부 refreshReservationStatus가
   * ready 전환 + 실패사유 초기화를 처리한다. (FulfillmentReady 이벤트는 구독 서비스가 없어 발행하지 않는다.)
   */
  async retryOne(fulfillmentOrderId: string, tx?: DbTx) {
    const foi = wmsTables.fulfillmentOrderItems;
    const items = await this.exec(tx)
      .select({ id: foi.id, qty: foi.qty, reservedQty: foi.reservedQty })
      .from(foi)
      .where(eq(foi.fulfillmentOrderId, fulfillmentOrderId))
      .orderBy(asc(foi.id));

    let reservedCount = 0;
    for (const item of items) {
      const shortage = item.qty - (item.reservedQty || 0);
      if (shortage <= 0) continue;

      try {
        await this.reservations.reserve(
          fulfillmentOrderId,
          { fulfillmentOrderItemId: item.id, quantity: shortage },
          tx,
        );
        reservedCount += 1;
      } catch (error) {
        if (error instanceof ConflictException || error instanceof BadRequestException) {
          continue;
        }
        throw error;
      }
    }

    if (reservedCount > 0) {
      this.logger.log(`Reservation retry reserved ${reservedCount} item(s) for unfulfillable FO ${fulfillmentOrderId}`);
    }
  }
}
