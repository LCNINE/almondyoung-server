import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { sql } from 'drizzle-orm';
import { InjectTypedDb } from '@app/db/decorators';
import { DbService } from '@app/db';
import { wmsSchema, DbTx } from '../../schema/inventory.schema';
import { ReservationLifecycleService } from '../../shared/services/reservation-lifecycle.service';
import { MetricsService } from '../../shared/services/metrics.service';

/** terminal FO(shipped/completed/canceled) 인데 confirmed 로 남은 예약 한 행. */
export interface ZombieReservationRow {
  reservationId: string;
  foId: string;
  foStatus: string;
  skuId: string;
  warehouseId: string;
  quantity: number;
}

export interface ZombieReservationReport {
  checkedAt: Date;
  totalZombieReservations: number;
  totalZombieFos: number;
  rows: ZombieReservationRow[];
}

export interface ZombieReconcileResult {
  checkedAt: Date;
  healedFos: number;
  healedReservations: number;
  report: ZombieReservationReport;
}

// raw sql 결과 원시 행(snake_case 별칭)
interface ZombieQueryRow {
  reservation_id: string;
  fo_id: string;
  fo_status: string;
  sku_id: string;
  warehouse_id: string;
  quantity: number | string;
}

const TERMINAL_FO_STATUSES = ['shipped', 'completed', 'canceled'] as const;

@Injectable()
export class FulfillmentReservationReconciliationService {
  private readonly logger = new Logger(FulfillmentReservationReconciliationService.name);

  constructor(
    @InjectTypedDb<typeof wmsSchema>() private readonly dbService: DbService<typeof wmsSchema>,
    private readonly reservationLifecycle: ReservationLifecycleService,
    private readonly metrics: MetricsService,
  ) {}

  /**
   * terminal FO 에 붙은 confirmed 예약(좀비) 탐지 — 탐지 전용, 단일 스냅샷.
   * FO 상태(진실) 를 기준으로 예약 수명을 판정한다(timeoutAt 아님).
   */
  async detectZombieReservations(
    filter?: { warehouseId?: string; skuId?: string },
    tx?: DbTx,
  ): Promise<ZombieReservationReport> {
    const warehouseId = filter?.warehouseId;
    const skuId = filter?.skuId;
    const query = sql`
      SELECT r.id           AS reservation_id,
             r.target_id    AS fo_id,
             fo.status      AS fo_status,
             r.sku_id       AS sku_id,
             r.warehouse_id AS warehouse_id,
             r.quantity     AS quantity
        FROM stock_reservations r
        JOIN fulfillment_orders fo ON fo.id = r.target_id
       WHERE r.status = 'confirmed'
         AND r.target_type = 'FULFILLMENT_ORDER'
         AND fo.status IN (${sql.join(
           TERMINAL_FO_STATUSES.map((status) => sql`${status}`),
           sql`, `,
         )})
         AND ${skuId ? sql`r.sku_id = ${skuId}` : sql`true`}
         AND ${warehouseId ? sql`r.warehouse_id = ${warehouseId}` : sql`true`}
    `;
    const result = await this.dbService.run(async (trx) => trx.execute(query), tx);
    // execute() 원시 결과 타이핑 — ledger-reconciliation.service.ts 와 동일한 문서화된 캐스트.
    const rawRows = result as unknown as ZombieQueryRow[];
    const rows: ZombieReservationRow[] = rawRows.map((r) => ({
      reservationId: r.reservation_id,
      foId: r.fo_id,
      foStatus: r.fo_status,
      skuId: r.sku_id,
      warehouseId: r.warehouse_id,
      quantity: Number(r.quantity),
    }));
    const uniqueFos = new Set(rows.map((r) => r.foId));
    return {
      checkedAt: new Date(),
      totalZombieReservations: rows.length,
      totalZombieFos: uniqueFos.size,
      rows,
    };
  }

  /**
   * 좀비 탐지 → FO 단위로 heal(release). FO 마다 독립 tx 로 격리(한 FO 실패가 나머지 미차단).
   * heal = release 만 — on_hand 무터치, 멱등(재실행 시 confirmed 0건).
   */
  async reconcileAndHeal(filter?: { warehouseId?: string; skuId?: string }, tx?: DbTx): Promise<ZombieReconcileResult> {
    const report = await this.detectZombieReservations(filter, tx);
    const foIds = [...new Set(report.rows.map((r) => r.foId))];

    let healedFos = 0;
    let healedReservations = 0;
    // heal 은 매칭된 FO 하나당 releaseLeftoverReservations 로 그 FO 의 confirmed 예약을 전량 release 한다
    // (terminal FO 위의 confirmed 예약은 전부 좀비이므로 전량 release 가 맞다).
    // 따라서 warehouseId/skuId filter 를 주면 filter 로 좁혀진 totalZombieReservations 보다
    // healedReservations 가 더 클 수 있다(같은 FO 에 filter 밖 SKU/창고 예약이 섞여 있는 경우).
    // 운영 cron/엔드포인트는 filter 없이 호출하므로 프로덕션에서는 발생하지 않는다.
    for (const foId of foIds) {
      try {
        const released = await this.dbService.run(
          (trx) => this.reservationLifecycle.releaseLeftoverReservations(foId, 'reconcile: terminal FO leftover', trx),
          tx,
        );
        if (released > 0) {
          healedFos += 1;
          healedReservations += released;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(`Zombie heal failed for FO ${foId}: ${message}`);
      }
    }

    return { checkedAt: report.checkedAt, healedFos, healedReservations, report };
  }

  /**
   * 야간 대사 — Task 10 원장 대사(03:00) 뒤 staggered. drift 를 게이지로 표면화하고 heal.
   * 잡 예외가 스케줄러를 죽이지 않도록 try/catch.
   */
  @Cron('5 3 * * *', { name: 'zombie-reservation-reconciliation', timeZone: 'Asia/Seoul' })
  async scheduledReconcile(): Promise<void> {
    try {
      const result = await this.reconcileAndHeal();
      this.metrics.setZombieReservations(result.report.totalZombieReservations);
      this.metrics.incZombieReservationsHealed(result.healedReservations);

      if (result.report.totalZombieReservations === 0) {
        this.logger.log('✅ Zombie reservation reconciliation clean — no terminal-FO leftovers');
      } else {
        this.logger.warn(
          `Zombie reservations healed: ${result.healedReservations} across ${result.healedFos} FOs ` +
            `(detected ${result.report.totalZombieReservations} in ${result.report.totalZombieFos} FOs). ` +
            `First 20: ` +
            JSON.stringify(result.report.rows.slice(0, 20)),
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const stack = error instanceof Error ? error.stack : undefined;
      this.logger.error(`Zombie reservation reconciliation job failed: ${message}`, stack);
    }
  }
}
