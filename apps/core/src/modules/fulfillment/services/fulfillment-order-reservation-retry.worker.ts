import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DbService } from '@app/db';
import { InjectTypedDb } from '@app/db/decorators';
import { eq, sql } from 'drizzle-orm';
import { DbTx, wmsSchema, wmsTables } from '../../inventory/schema/inventory.schema';
import { FulfillmentWorkflowGate } from './fulfillment-workflow-gate.service';
import { ShipmentReservationService } from './shipment-reservation.service';

/**
 * Reservation retry worker.
 *
 * 부분예약이 실패하거나 short-pick 으로 예약이 풀린 draft shipment line 은
 * 이후 재고가 늘어나도 스스로 복구되지 않는다. 이 워커가 주기적으로
 * "미예약 수량이 남았고 SKU 에 가용재고가 생긴 draft shipment line"을 골라
 * ShipmentReservationService.reservePartial 로 재시도한다.
 *
 * 가용재고 판단을 stock_summary_view 로 하므로 입고뿐 아니라 조정(ADJUST_UP),
 * 타 shipment 의 예약 해제 등 어떤 경로로 재고가 풀려도 동작한다.
 * 후보 정렬은 원 요청 시각(requested_at) 기준 — 오래 기다린 라인부터 재고를 가져간다.
 * (V1 FO 기반 후보 선정과 facade.reserve 위임 경로는 V1 출고 경로와 함께 Task 25 에서 제거됐다.)
 */
@Injectable()
export class FulfillmentOrderReservationRetryWorker {
  private readonly logger = new Logger(FulfillmentOrderReservationRetryWorker.name);
  private isProcessing = false;

  constructor(
    @InjectTypedDb<typeof wmsSchema>()
    private readonly dbService: DbService<typeof wmsSchema>,
    private readonly workflowGate: FulfillmentWorkflowGate,
    private readonly shipmentReservations: ShipmentReservationService,
  ) {}

  private get db() {
    return this.dbService.db;
  }

  private exec(tx?: DbTx) {
    return tx ?? this.db;
  }

  @Cron(CronExpression.EVERY_10_SECONDS)
  async retryUnfulfillable() {
    if (!this.workflowGate.shouldRunReservationRetry()) {
      return;
    }

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
          this.logger.error(`Failed to retry reservation for shipment line ${candidate.id}`, error);
        }
      }
    } catch (error) {
      this.logger.error('Failed to process reservation retry batch', error);
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * 후보: 미예약 수량이 남은 active draft shipment line 중 SKU 에 가용재고가 있는 것.
   * 원 요청 시각(requested_at, short-pick 해제 이력 포함) asc — 오래된 요청부터.
   */
  async findCandidates(limit: number, tx?: DbTx): Promise<Array<{ id: string }>> {
    if (!this.workflowGate.shouldRunReservationRetry()) {
      return [];
    }

    const rows = await this.exec(tx).execute<{ id: string }>(sql`
      SELECT sl.id
        FROM shipment_lines sl
        JOIN shipments shipment ON shipment.id = sl.shipment_id
        JOIN stock_summary_view summary
          ON summary.sku_id = sl.sku_id
         AND summary.warehouse_id = shipment.warehouse_id
       WHERE shipment.status = 'draft'
         AND summary.available_qty > 0
         AND sl.qty > COALESCE((
           SELECT SUM(reservation.quantity)
             FROM stock_reservations reservation
            WHERE reservation.target_type = 'SHIPMENT_LINE'
              AND reservation.shipment_line_id = sl.id
              AND reservation.status = 'confirmed'
         ), 0)
       ORDER BY COALESCE((
         SELECT MIN(COALESCE(reservation.requested_at, reservation.created_at))
           FROM stock_reservations reservation
          WHERE reservation.target_type = 'SHIPMENT_LINE'
            AND reservation.shipment_line_id = sl.id
            AND (
              reservation.status = 'confirmed'
              OR (
                reservation.status = 'released'
                AND reservation.state_reason LIKE 'short-pick:%'
              )
            )
       ), sl.created_at), sl.id
       LIMIT ${limit}
    `);
    return rows as unknown as Array<{ id: string }>;
  }

  /**
   * shipment line 하나의 부족분 예약 재시도. 부분 성공 허용 —
   * 재고 부족은 reservePartial 이 mutated=false 로 알려주고 다음 주기로 미룬다.
   */
  async retryOne(shipmentLineId: string, tx?: DbTx) {
    if (!this.workflowGate.shouldRunReservationRetry()) {
      return;
    }

    const [line] = await this.exec(tx)
      .select({ qty: wmsTables.shipmentLines.qty })
      .from(wmsTables.shipmentLines)
      .where(eq(wmsTables.shipmentLines.id, shipmentLineId))
      .limit(1);
    if (!line) return;
    const result = await this.shipmentReservations.reservePartial(shipmentLineId, line.qty, tx);
    if (result.mutated) {
      this.logger.log(`V2 reservation retry added ${result.reservedQty} unit(s) to shipment line ${shipmentLineId}`);
    }
  }
}
