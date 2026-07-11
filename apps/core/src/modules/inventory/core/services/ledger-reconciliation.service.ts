import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { sql } from 'drizzle-orm';
import { InjectTypedDb } from '@app/db/decorators';
import { DbService } from '@app/db';
import { wmsSchema, DbTx } from '../../schema/inventory.schema';
import { StockStateEnum } from '../../schema/enum-values';
import { MetricsService } from '../../shared/services/metrics.service';

export type LedgerDriftSeverity = 'CRITICAL' | 'MISMATCH';

export interface LedgerDriftRow {
  skuId: string;
  warehouseId: string;
  locationId: string;
  stockState: StockStateEnum;
  derivedQty: number; // 이벤트 파생값(진실)
  ledgerQty: number; // 원장 저장값
  delta: number; // ledgerQty - derivedQty
  severity: LedgerDriftSeverity;
}

export interface LedgerReconciliationReport {
  checkedAt: Date;
  totalDriftGrains: number;
  criticalCount: number;
  drifts: LedgerDriftRow[];
}

// raw sql 결과의 원시 행 형태(snake_case 컬럼 별칭 그대로)
interface LedgerDriftQueryRow {
  sku_id: string;
  warehouse_id: string;
  location_id: string;
  stock_state: StockStateEnum;
  derived_qty: number | string; // SUM(...)::int — postgres.js 가 string 으로 줄 수 있어 Number() 로 정규화
  ledger_qty: number | string;
}

export function classifyDriftSeverity(derivedQty: number): LedgerDriftSeverity {
  return derivedQty < 0 ? 'CRITICAL' : 'MISMATCH';
}

export interface ReservationDriftRow {
  skuId: string;
  warehouseId: string;
  onHandQty: number;
  reservedQty: number;
  shortfall: number; // reservedQty - onHandQty (>0)
}

export interface ReservationDriftReport {
  checkedAt: Date;
  totalDriftGrains: number;
  drifts: ReservationDriftRow[];
}

/** (sku,warehouse) 원장 ON_HAND 합 < confirmed 예약 합 이면 drift. 뷰 미사용(raw 합). */
export function isReservationOverReserved(onHandSum: number, reservedSum: number): boolean {
  return reservedSum > onHandSum;
}

interface ReservationDriftQueryRow {
  sku_id: string;
  warehouse_id: string;
  on_hand_qty: number | string;
  reserved_qty: number | string;
}

@Injectable()
export class LedgerReconciliationService {
  private readonly logger = new Logger(LedgerReconciliationService.name);

  constructor(
    @InjectTypedDb<typeof wmsSchema>() private readonly dbService: DbService<typeof wmsSchema>,
    private readonly metrics: MetricsService,
  ) {}

  /**
   * stock_events(진실) ↔ stock_ledgers(파생) 대사. 불일치 grain 만 반환.
   *
   * 단일 sql 문 = 단일 스냅샷 → 집계 도중 이벤트 커밋으로 인한 read-skew 오탐 차단.
   * 읽기 전용이라 원장 쓰기 경계(arch test) 무저촉.
   */
  async reconcile(filter?: { warehouseId?: string; skuId?: string }, tx?: DbTx): Promise<LedgerReconciliationReport> {
    const warehouseId = filter?.warehouseId;
    const skuId = filter?.skuId;

    // 참고: warehouseId/skuId 필터는 FULL OUTER JOIN 이후 coalesce 결과에 걸려
    // 출력 행만 좁힌다 — derived CTE 의 이벤트 집계는 전 카탈로그를 스캔한다.
    const query = sql`
      WITH derived AS (
        SELECT sku_id, wh, loc, state, SUM(q)::int AS derived_qty FROM (
          SELECT sku_id, to_warehouse_id AS wh, to_location_id AS loc, to_state AS state, quantity AS q
            FROM stock_events
           WHERE event_status = 'POSTED' AND voided_by_event_id IS NULL AND to_state IS NOT NULL
          UNION ALL
          SELECT sku_id, from_warehouse_id, from_location_id, from_state, -quantity
            FROM stock_events
           WHERE event_status = 'POSTED' AND voided_by_event_id IS NULL AND from_state IS NOT NULL
        ) g
        GROUP BY sku_id, wh, loc, state
      )
      SELECT
        coalesce(d.sku_id, l.sku_id)       AS sku_id,
        coalesce(d.wh, l.warehouse_id)     AS warehouse_id,
        coalesce(d.loc, l.location_id)     AS location_id,
        coalesce(d.state, l.stock_state)   AS stock_state,
        coalesce(d.derived_qty, 0)         AS derived_qty,
        coalesce(l.qty, 0)                 AS ledger_qty
      FROM derived d
      FULL OUTER JOIN stock_ledgers l
        ON  d.sku_id = l.sku_id AND d.wh = l.warehouse_id
        AND d.loc = l.location_id AND d.state = l.stock_state
      WHERE coalesce(d.derived_qty, 0) <> coalesce(l.qty, 0)
        AND ${skuId ? sql`coalesce(d.sku_id, l.sku_id) = ${skuId}` : sql`true`}
        AND ${warehouseId ? sql`coalesce(d.wh, l.warehouse_id) = ${warehouseId}` : sql`true`}
    `;

    // execute() 원시 결과 타이핑 — 선례 purchase-order.service.ts:842 와 동일한 문서화된 캐스트.
    const result = await this.dbService.run(async (trx) => trx.execute(query), tx);
    const rawRows = result as unknown as LedgerDriftQueryRow[];

    const drifts: LedgerDriftRow[] = rawRows.map((r) => {
      const derivedQty = Number(r.derived_qty);
      const ledgerQty = Number(r.ledger_qty);
      return {
        skuId: r.sku_id,
        warehouseId: r.warehouse_id,
        locationId: r.location_id,
        stockState: r.stock_state,
        derivedQty,
        ledgerQty,
        delta: ledgerQty - derivedQty,
        severity: classifyDriftSeverity(derivedQty),
      };
    });

    const criticalCount = drifts.filter((d) => d.severity === 'CRITICAL').length;

    return {
      checkedAt: new Date(),
      totalDriftGrains: drifts.length,
      criticalCount,
      drifts,
    };
  }

  /**
   * (sku,warehouse) 예약 불변식 대사 — ON_HAND 원장 합 < confirmed 예약 합 grain 만 반환.
   * raw 합 직접 집계(뷰 availableQty 의 transit_out 반영 금지 → 거짓 경보 방지).
   */
  async reconcileReservations(
    filter?: { warehouseId?: string; skuId?: string },
    tx?: DbTx,
  ): Promise<ReservationDriftReport> {
    const warehouseId = filter?.warehouseId;
    const skuId = filter?.skuId;
    const query = sql`
      WITH on_hand AS (
        SELECT sku_id, warehouse_id, SUM(qty)::int AS qty
          FROM stock_ledgers WHERE stock_state = 'ON_HAND'
         GROUP BY sku_id, warehouse_id
      ), reserved AS (
        SELECT sku_id, warehouse_id, SUM(quantity)::int AS qty
          FROM stock_reservations WHERE status = 'confirmed'
         GROUP BY sku_id, warehouse_id
      )
      SELECT r.sku_id, r.warehouse_id,
             coalesce(o.qty, 0) AS on_hand_qty,
             r.qty              AS reserved_qty
        FROM reserved r
        LEFT JOIN on_hand o ON o.sku_id = r.sku_id AND o.warehouse_id = r.warehouse_id
       WHERE r.qty > coalesce(o.qty, 0)
         AND ${skuId ? sql`r.sku_id = ${skuId}` : sql`true`}
         AND ${warehouseId ? sql`r.warehouse_id = ${warehouseId}` : sql`true`}
    `;
    const result = await this.dbService.run(async (trx) => trx.execute(query), tx);
    // execute() 원시 결과 타이핑 — reconcile() 과 동일한 문서화된 캐스트.
    const rawRows = result as unknown as ReservationDriftQueryRow[];
    const drifts: ReservationDriftRow[] = rawRows.map((r) => {
      const onHandQty = Number(r.on_hand_qty);
      const reservedQty = Number(r.reserved_qty);
      return {
        skuId: r.sku_id,
        warehouseId: r.warehouse_id,
        onHandQty,
        reservedQty,
        shortfall: reservedQty - onHandQty,
      };
    });
    return { checkedAt: new Date(), totalDriftGrains: drifts.length, drifts };
  }

  /**
   * 야간 전 카탈로그 대사. drift 를 로그 + Prometheus 게이지로 표면화.
   * 잡 자체 예외가 스케줄러를 죽이지 않도록 try/catch 로 감싼다.
   */
  @Cron('0 3 * * *', { name: 'ledger-reconciliation', timeZone: 'Asia/Seoul' })
  async scheduledReconcile(): Promise<void> {
    try {
      const report = await this.reconcile();
      const mismatch = report.totalDriftGrains - report.criticalCount;
      this.metrics.setLedgerDrift({ mismatch, critical: report.criticalCount });

      if (report.totalDriftGrains === 0) {
        this.logger.log('✅ Ledger reconciliation clean — no drift');
      } else {
        // silent truncation 금지 — 총 건수를 먼저 명시하고 앞 20건만 상세 로그.
        this.logger.error(
          `❌ Ledger drift: ${report.totalDriftGrains} grains (critical=${report.criticalCount}). ` +
            `Showing first 20: ` +
            JSON.stringify(report.drifts.slice(0, 20)),
        );
      }

      const resReport = await this.reconcileReservations();
      this.metrics.setReservedOverOnHand(resReport.totalDriftGrains);
      if (resReport.totalDriftGrains > 0) {
        this.logger.error(
          `❌ Reserved-over-onhand: ${resReport.totalDriftGrains} grains. First 20: ` +
            JSON.stringify(resReport.drifts.slice(0, 20)),
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const stack = error instanceof Error ? error.stack : undefined;
      this.logger.error(`Ledger reconciliation job failed: ${message}`, stack);
    }
  }
}
