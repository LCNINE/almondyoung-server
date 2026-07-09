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
        return;
      }

      // silent truncation 금지 — 총 건수를 먼저 명시하고 앞 20건만 상세 로그.
      this.logger.error(
        `❌ Ledger drift: ${report.totalDriftGrains} grains (critical=${report.criticalCount}). ` +
          `Showing first 20: ` +
          JSON.stringify(report.drifts.slice(0, 20)),
      );
    } catch (error) {
      this.logger.error(`Ledger reconciliation job failed: ${error.message}`, error.stack);
    }
  }
}
