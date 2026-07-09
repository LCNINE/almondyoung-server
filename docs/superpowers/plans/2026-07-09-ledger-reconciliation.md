# 원장 대사(Ledger Reconciliation) 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `stock_events`(진실) ↔ `stock_ledgers`(파생) 를 대사해 drift grain 을 탐지·리포트하는 탐지 전용 안전망을 신설한다 (P2-14 / WS-A).

**Architecture:** 단일 `sql` 스냅샷 대사 쿼리로 이벤트를 grain 단위 unpivot → GROUP BY → `stock_ledgers` 와 FULL OUTER JOIN 해 불일치 행만 뽑는다. 순수 `reconcile()` 메서드를 야간 `@Cron` 과 관리자 `GET` 엔드포인트 두 진입점이 공유한다. drift 는 로그 + Prometheus 게이지로 관측되고, 수리·영속·마이그레이션은 없다.

**Tech Stack:** NestJS, Drizzle ORM(postgres.js), `@nestjs/schedule`, `prom-client`, Jest.

## Global Constraints

- **탐지 전용.** 원장을 수정하는 코드 금지(자동/수동 수리는 별도 PR, 본 작업 비목표).
- **무상태.** 새 테이블/마이그레이션 없음. drift 이력은 Prometheus 게이지 시계열.
- **원장 쓰기 경계 불가침.** `stock_events`/`stock_ledgers` 에 대한 `.insert`/`.update` 는 `stock-event.store.ts` 에서만. 본 작업은 **읽기 전용** — `inventory-write-boundary.arch.spec.ts` 를 깨지 않는다.
- **DB 주입:** `@InjectTypedDb<typeof wmsSchema>()`, 절대 `@Inject('DB')` 아님. tx 전파는 ADR-0025 `dbService.run(fn, tx)` — per-class `inTx` 헬퍼 금지.
- **타입 안전:** raw `sql` 결과의 `as unknown as Row[]` 캐스트는 선례(`purchase-order.service.ts:842`) 있는 문서화된 예외로만 허용. 그 외 `any`/`as` 금지. 응답 DTO 는 중첩 클래스로 정의(`@ApiProperty({ type:'object' })` 금지).
- **severity 정의(확정):** `derivedQty < 0` → `'CRITICAL'`(이벤트 원장 구조 위반 — `ck_ledgers_non_negative` 상 원장은 음수 불가), 그 외 모든 불일치 → `'MISMATCH'`.
- **커밋 접두사:** `[core]`.

---

### Task 1: MetricsService 에 원장 drift 게이지 추가

**Files:**
- Modify: `apps/core/src/modules/inventory/shared/services/metrics.service.ts`
- Test: `apps/core/src/modules/inventory/shared/services/ledger-drift-metric.spec.ts`

**Interfaces:**
- Consumes: 없음.
- Produces: `MetricsService.setLedgerDrift(counts: { mismatch: number; critical: number }): void` — 매 대사 실행 후 두 severity 라벨을 **항상** set(정상 실행 시 0 기록 → 이전 라벨 값 잔존 방지).

- [ ] **Step 1: 실패하는 테스트 작성**

`apps/core/src/modules/inventory/shared/services/ledger-drift-metric.spec.ts`:
```ts
import { register } from 'prom-client';
import { MetricsService } from './metrics.service';

describe('MetricsService.setLedgerDrift', () => {
  let metrics: MetricsService;

  beforeEach(() => {
    // 전역 레지스트리를 비워 다른 스펙과의 중복 등록 충돌을 막는다.
    register.clear();
    metrics = new MetricsService();
  });

  it('두 severity 라벨을 모두 게이지에 기록한다', async () => {
    metrics.setLedgerDrift({ mismatch: 2, critical: 1 });
    const out = await metrics.getMetrics();
    expect(out).toContain('wms_ledger_drift_grains{severity="MISMATCH"} 2');
    expect(out).toContain('wms_ledger_drift_grains{severity="CRITICAL"} 1');
  });

  it('정상(0 drift) 실행도 0 을 명시적으로 기록한다', async () => {
    metrics.setLedgerDrift({ mismatch: 0, critical: 0 });
    const out = await metrics.getMetrics();
    expect(out).toContain('wms_ledger_drift_grains{severity="MISMATCH"} 0');
    expect(out).toContain('wms_ledger_drift_grains{severity="CRITICAL"} 0');
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `npx jest --testPathPattern=ledger-drift-metric`
Expected: FAIL — `metrics.setLedgerDrift is not a function`

- [ ] **Step 3: 게이지 + 메서드 구현**

`metrics.service.ts` — 기존 `healthResponseTime` 게이지 선언 바로 뒤(약 96행, `onModuleInit()` 앞)에 게이지 필드 추가:
```ts
  // 원장 대사 메트릭 — stock_ledgers 와 이벤트 파생 수량의 불일치 grain 수.
  // setLedgerDrift 가 매 대사 실행 후 두 severity 라벨을 항상 set 한다(정상 시 0).
  private readonly ledgerDriftGauge = new Gauge({
    name: 'wms_ledger_drift_grains',
    help: 'Number of stock ledger grains whose qty disagrees with the event-derived quantity',
    labelNames: ['severity'],
    registers: [register],
  });
```

그리고 `recordHealthCheck(...)` 메서드 바로 뒤에 setter 추가:
```ts
  /**
   * 원장 대사 결과 기록 — 정상 실행도 0 을 써서 이전 값 잔존을 막는다.
   */
  setLedgerDrift(counts: { mismatch: number; critical: number }) {
    this.ledgerDriftGauge.set({ severity: 'MISMATCH' }, counts.mismatch);
    this.ledgerDriftGauge.set({ severity: 'CRITICAL' }, counts.critical);
  }
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx jest --testPathPattern=ledger-drift-metric`
Expected: PASS (2 tests)

- [ ] **Step 5: 커밋**

```bash
git add apps/core/src/modules/inventory/shared/services/metrics.service.ts \
        apps/core/src/modules/inventory/shared/services/ledger-drift-metric.spec.ts
git commit -m "[core] 원장 대사 drift 게이지 메트릭 추가 (P2-14)"
```

---

### Task 2: LedgerReconciliationService — 타입 + 대사 쿼리

**Files:**
- Create: `apps/core/src/modules/inventory/core/services/ledger-reconciliation.service.ts`
- Test (unit, 항상 실행): `apps/core/src/modules/inventory/core/services/ledger-reconciliation-severity.spec.ts`
- Test (integration, DB 게이트): `apps/core/src/modules/inventory/core/services/ledger-reconciliation.integration.spec.ts`

**Interfaces:**
- Consumes: `DbService<typeof wmsSchema>`, `DbTx`, `wmsSchema` (`../../schema/inventory.schema`); `StockStateEnum` (`../../schema/enum-values`); `MetricsService` (`../../shared/services/metrics.service`).
- Produces (later tasks 의존):
  - `type LedgerDriftSeverity = 'CRITICAL' | 'MISMATCH'`
  - `interface LedgerDriftRow { skuId: string; warehouseId: string; locationId: string; stockState: StockStateEnum; derivedQty: number; ledgerQty: number; delta: number; severity: LedgerDriftSeverity }`
  - `interface LedgerReconciliationReport { checkedAt: Date; totalDriftGrains: number; criticalCount: number; drifts: LedgerDriftRow[] }`
  - `function classifyDriftSeverity(derivedQty: number): LedgerDriftSeverity` (export, 순수)
  - `class LedgerReconciliationService` with `reconcile(filter?: { warehouseId?: string; skuId?: string }, tx?: DbTx): Promise<LedgerReconciliationReport>`

- [ ] **Step 1: 순수 severity 헬퍼의 실패 테스트 작성**

`ledger-reconciliation-severity.spec.ts`:
```ts
import { classifyDriftSeverity } from './ledger-reconciliation.service';

describe('classifyDriftSeverity', () => {
  it('파생 수량이 음수면 CRITICAL (이벤트 원장 구조 위반)', () => {
    expect(classifyDriftSeverity(-1)).toBe('CRITICAL');
  });
  it('파생 수량이 0 이상이면 MISMATCH', () => {
    expect(classifyDriftSeverity(0)).toBe('MISMATCH');
    expect(classifyDriftSeverity(5)).toBe('MISMATCH');
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx jest --testPathPattern=ledger-reconciliation-severity`
Expected: FAIL — Cannot find module './ledger-reconciliation.service' (또는 export 없음)

- [ ] **Step 3: 서비스 파일 구현**

`ledger-reconciliation.service.ts`:
```ts
import { Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { InjectTypedDb } from '@app/db/decorators';
import { DbService } from '@app/db';
import { wmsSchema, DbTx } from '../../schema/inventory.schema';
import { StockStateEnum } from '../../schema/enum-values';

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
  ) {}

  /**
   * stock_events(진실) ↔ stock_ledgers(파생) 대사. 불일치 grain 만 반환.
   *
   * 단일 sql 문 = 단일 스냅샷 → 집계 도중 이벤트 커밋으로 인한 read-skew 오탐 차단.
   * 읽기 전용이라 원장 쓰기 경계(arch test) 무저촉.
   */
  async reconcile(
    filter?: { warehouseId?: string; skuId?: string },
    tx?: DbTx,
  ): Promise<LedgerReconciliationReport> {
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
}
```

- [ ] **Step 4: 순수 테스트 통과 확인**

Run: `npx jest --testPathPattern=ledger-reconciliation-severity`
Expected: PASS (2 tests)

- [ ] **Step 5: 통합 테스트 작성 (DB 게이트)**

`ledger-reconciliation.integration.spec.ts` — stocktaking 통합 스펙과 동일한 rollback-only 하네스:
```ts
import { eq, and } from 'drizzle-orm';
import * as postgres from 'postgres';
import { drizzle, PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { randomUUID } from 'crypto';
import { DbService } from '@app/db';
import { wmsTables, wmsSchema, DbTx } from '../../schema/inventory.schema';
import { StockEventStore } from '../repositories/stock-event.store';
import { InventoryCommandService } from './inventory-command.service';
import { LocationService } from './location.service';
import { OutboxService } from '../../shared/outbox/outbox.service';
import { ProductSellableQuantityService } from '../../product-sellable-quantity/services/product-sellable-quantity.service';
import { LedgerReconciliationService } from './ledger-reconciliation.service';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;
class Rollback extends Error {}

describeIfDb('ledger reconciliation (DB integration, rollback-only)', () => {
  jest.setTimeout(120_000);
  let sql: postgres.Sql;
  let db: PostgresJsDatabase<typeof wmsSchema>;
  let command: InventoryCommandService;
  let recon: LedgerReconciliationService;

  beforeAll(() => {
    sql = postgres(DATABASE_URL as string, { max: 1 });
    db = drizzle(sql, { schema: wmsSchema });
    const dbService = {
      db,
      run: async (fn: (t: DbTx) => Promise<unknown>, t?: DbTx) => (t ? fn(t) : db.transaction(fn)),
    } as unknown as DbService<typeof wmsSchema>;
    const outbox = new OutboxService(dbService);
    const sellable = new ProductSellableQuantityService(dbService as never, outbox);
    const eventStore = new StockEventStore(dbService, sellable);
    const location = new LocationService(dbService);
    command = new InventoryCommandService(dbService, eventStore, outbox, location);
    recon = new LedgerReconciliationService(dbService);
  });
  afterAll(async () => {
    await sql.end();
  });

  async function inRollbackTx(fn: (tx: DbTx) => Promise<void>) {
    await expect(
      db.transaction(async (tx) => {
        await fn(tx);
        throw new Rollback();
      }),
    ).rejects.toThrow(Rollback);
  }

  // 시드: adjustUp 으로 이벤트+원장 정상 생성, 해결된 locationId 되읽어 반환
  async function seed(tx: DbTx, qty: number) {
    const [wh] = await tx
      .insert(wmsTables.warehouses)
      .values({ name: `it-wh-${randomUUID().slice(0, 8)}` })
      .returning();
    const [h] = await tx
      .insert(wmsTables.holders)
      .values({ name: `it-h-${randomUUID().slice(0, 8)}` })
      .returning();
    const [sku] = await tx
      .insert(wmsTables.skus)
      .values({ name: 'it-sku', code: `IT-${randomUUID()}`, holderId: h.id })
      .returning();
    const { eventId } = await command.adjustUp(
      { skuId: sku.id, warehouseId: wh.id, quantity: qty, reason: 'SEED' },
      tx,
    );
    const [ev] = await tx
      .select({ loc: wmsTables.stockEvents.toLocationId })
      .from(wmsTables.stockEvents)
      .where(eq(wmsTables.stockEvents.id, eventId));
    return { wh, sku, locationId: ev.loc as string };
  }

  function grainWhere(s: { sku: { id: string }; wh: { id: string }; locationId: string }) {
    return and(
      eq(wmsTables.stockLedgers.skuId, s.sku.id),
      eq(wmsTables.stockLedgers.warehouseId, s.wh.id),
      eq(wmsTables.stockLedgers.locationId, s.locationId),
      eq(wmsTables.stockLedgers.stockState, 'ON_HAND'),
    );
  }

  it('정상 시드는 drift 0', async () => {
    await inRollbackTx(async (tx) => {
      const s = await seed(tx, 10);
      const report = await recon.reconcile({ warehouseId: s.wh.id }, tx);
      expect(report.totalDriftGrains).toBe(0);
      expect(report.drifts).toEqual([]);
    });
  });

  it('원장을 우회 UPDATE 로 어긋내면 그 grain 을 정확한 delta 로 탐지 (MISMATCH)', async () => {
    await inRollbackTx(async (tx) => {
      const s = await seed(tx, 10);
      // 스토어 우회: 원장 qty 를 10 → 13 으로 조작(이벤트 파생은 여전히 10)
      await tx.update(wmsTables.stockLedgers).set({ qty: 13 }).where(grainWhere(s));
      const report = await recon.reconcile({ warehouseId: s.wh.id }, tx);
      expect(report.totalDriftGrains).toBe(1);
      expect(report.drifts[0]).toMatchObject({
        skuId: s.sku.id,
        warehouseId: s.wh.id,
        locationId: s.locationId,
        derivedQty: 10,
        ledgerQty: 13,
        delta: 3,
        severity: 'MISMATCH',
      });
    });
  });

  it('원장 행이 삭제돼도 이벤트 파생값으로 drift 탐지 (ledgerQty=0)', async () => {
    await inRollbackTx(async (tx) => {
      const s = await seed(tx, 8);
      await tx.delete(wmsTables.stockLedgers).where(grainWhere(s));
      const report = await recon.reconcile({ warehouseId: s.wh.id }, tx);
      expect(report.totalDriftGrains).toBe(1);
      expect(report.drifts[0]).toMatchObject({
        skuId: s.sku.id,
        derivedQty: 8,
        ledgerQty: 0,
        delta: -8,
        severity: 'MISMATCH',
      });
    });
  });

  it('warehouseId 필터가 다른 창고의 drift 를 제외한다', async () => {
    await inRollbackTx(async (tx) => {
      const a = await seed(tx, 10);
      const b = await seed(tx, 10);
      await tx.update(wmsTables.stockLedgers).set({ qty: 99 }).where(grainWhere(b));
      const report = await recon.reconcile({ warehouseId: a.wh.id }, tx);
      expect(report.totalDriftGrains).toBe(0); // b 의 drift 는 필터로 제외
    });
  });
});
```

- [ ] **Step 6: 테스트 실행 (DB 있으면 통합까지, 없으면 순수만)**

Run: `npx jest --testPathPattern=ledger-reconciliation`
Expected: DB 없으면 통합 스펙 skip(초록) + severity 스펙 PASS. DB 있으면 통합 4건 PASS.
Also run: `npx tsc -p apps/core/tsconfig.app.json --noEmit` → 타입 에러 0.

- [ ] **Step 7: 커밋**

```bash
git add apps/core/src/modules/inventory/core/services/ledger-reconciliation.service.ts \
        apps/core/src/modules/inventory/core/services/ledger-reconciliation-severity.spec.ts \
        apps/core/src/modules/inventory/core/services/ledger-reconciliation.integration.spec.ts
git commit -m "[core] 원장 대사 서비스 reconcile() + 대사 쿼리 (P2-14)"
```

---

### Task 3: 야간 크론 + 모듈 등록

**Files:**
- Modify: `apps/core/src/modules/inventory/core/services/ledger-reconciliation.service.ts` (크론 메서드 + MetricsService 주입 추가)
- Modify: `apps/core/src/modules/inventory/core/inventory.module.ts` (providers 등록)
- Test: `apps/core/src/modules/inventory/core/services/ledger-reconciliation-cron.spec.ts`

**Interfaces:**
- Consumes: `LedgerReconciliationService.reconcile()` (Task 2), `MetricsService.setLedgerDrift()` (Task 1).
- Produces: `LedgerReconciliationService.scheduledReconcile(): Promise<void>` — `@Cron` 진입점.

- [ ] **Step 1: 크론 동작 실패 테스트 작성**

`ledger-reconciliation-cron.spec.ts` (DB 불필요 — `reconcile` 를 스텁):
```ts
import { LedgerReconciliationService, LedgerReconciliationReport } from './ledger-reconciliation.service';

function makeReport(over: Partial<LedgerReconciliationReport>): LedgerReconciliationReport {
  return { checkedAt: new Date(), totalDriftGrains: 0, criticalCount: 0, drifts: [], ...over };
}

describe('LedgerReconciliationService.scheduledReconcile', () => {
  function build() {
    const setLedgerDrift = jest.fn();
    const metrics = { setLedgerDrift } as never;
    const svc = new LedgerReconciliationService({} as never, metrics);
    return { svc, setLedgerDrift };
  }

  it('drift 발견 시 severity 별 카운트를 메트릭에 기록한다', async () => {
    const { svc, setLedgerDrift } = build();
    jest.spyOn(svc, 'reconcile').mockResolvedValue(
      makeReport({
        totalDriftGrains: 3,
        criticalCount: 1,
        drifts: [
          { skuId: 's', warehouseId: 'w', locationId: 'l', stockState: 'ON_HAND', derivedQty: -1, ledgerQty: 0, delta: 1, severity: 'CRITICAL' },
          { skuId: 's', warehouseId: 'w', locationId: 'l', stockState: 'ON_HAND', derivedQty: 5, ledgerQty: 7, delta: 2, severity: 'MISMATCH' },
          { skuId: 's', warehouseId: 'w', locationId: 'l', stockState: 'ON_HAND', derivedQty: 5, ledgerQty: 8, delta: 3, severity: 'MISMATCH' },
        ],
      }),
    );
    await svc.scheduledReconcile();
    expect(setLedgerDrift).toHaveBeenCalledWith({ mismatch: 2, critical: 1 });
  });

  it('drift 0 이면 0 을 기록한다', async () => {
    const { svc, setLedgerDrift } = build();
    jest.spyOn(svc, 'reconcile').mockResolvedValue(makeReport({}));
    await svc.scheduledReconcile();
    expect(setLedgerDrift).toHaveBeenCalledWith({ mismatch: 0, critical: 0 });
  });

  it('reconcile 예외가 크론 밖으로 전파되지 않는다', async () => {
    const { svc, setLedgerDrift } = build();
    jest.spyOn(svc, 'reconcile').mockRejectedValue(new Error('boom'));
    await expect(svc.scheduledReconcile()).resolves.toBeUndefined();
    expect(setLedgerDrift).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx jest --testPathPattern=ledger-reconciliation-cron`
Expected: FAIL — `scheduledReconcile is not a function` / 생성자 인자 수 불일치

- [ ] **Step 3: 크론 + MetricsService 주입 구현**

`ledger-reconciliation.service.ts` 수정 — import 에 `Cron` 과 `MetricsService` 추가:
```ts
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { sql } from 'drizzle-orm';
import { InjectTypedDb } from '@app/db/decorators';
import { DbService } from '@app/db';
import { wmsSchema, DbTx } from '../../schema/inventory.schema';
import { StockStateEnum } from '../../schema/enum-values';
import { MetricsService } from '../../shared/services/metrics.service';
```

생성자에 `MetricsService` 주입:
```ts
  constructor(
    @InjectTypedDb<typeof wmsSchema>() private readonly dbService: DbService<typeof wmsSchema>,
    private readonly metrics: MetricsService,
  ) {}
```

`reconcile(...)` 메서드 바로 뒤에 크론 래퍼 추가:
```ts
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
```

- [ ] **Step 4: providers 등록**

`inventory.module.ts` — import 추가(다른 service import 부근):
```ts
import { LedgerReconciliationService } from './services/ledger-reconciliation.service';
```
`providers` 배열에 `ReservationCronService,` 뒤에 추가:
```ts
    LedgerReconciliationService,
```

- [ ] **Step 5: 테스트 + 빌드 확인**

Run: `npx jest --testPathPattern=ledger-reconciliation-cron`
Expected: PASS (3 tests)
Run: `npx tsc -p apps/core/tsconfig.app.json --noEmit`
Expected: 타입 에러 0 (Task 2 통합 스펙의 `new LedgerReconciliationService(dbService)` 가 이제 인자 2개 필요 → 다음 스텝에서 수정)

- [ ] **Step 6: 통합 스펙 생성자 인자 갱신**

Task 2 의 `ledger-reconciliation.integration.spec.ts` 에서 `recon` 생성부를 수정 — 스텁 메트릭 주입:
```ts
    const metricsStub = { setLedgerDrift: () => undefined } as unknown as import('../../shared/services/metrics.service').MetricsService;
    recon = new LedgerReconciliationService(dbService, metricsStub);
```
Run: `npx tsc -p apps/core/tsconfig.app.json --noEmit`
Expected: 타입 에러 0

- [ ] **Step 7: 커밋**

```bash
git add apps/core/src/modules/inventory/core/services/ledger-reconciliation.service.ts \
        apps/core/src/modules/inventory/core/services/ledger-reconciliation-cron.spec.ts \
        apps/core/src/modules/inventory/core/services/ledger-reconciliation.integration.spec.ts \
        apps/core/src/modules/inventory/core/inventory.module.ts
git commit -m "[core] 원장 대사 야간 크론 + 모듈 등록 (P2-14)"
```

---

### Task 4: 관리자 조회 엔드포인트 + 응답 DTO

**Files:**
- Create: `apps/core/src/modules/inventory/core/dto/ledger-reconciliation.dto.ts`
- Create: `apps/core/src/modules/inventory/core/controllers/ledger-reconciliation.controller.ts`
- Modify: `apps/core/src/modules/inventory/core/inventory.module.ts` (controllers 등록)
- Test: `apps/core/src/modules/inventory/core/controllers/ledger-reconciliation.controller.spec.ts`

**Interfaces:**
- Consumes: `LedgerReconciliationService.reconcile()` (Task 2), 타입 `LedgerDriftSeverity` (Task 2).
- Produces: `GET /inventory/ledger-reconciliation?warehouseId=&skuId=` → `LedgerReconciliationReportDto`.

- [ ] **Step 1: 응답 DTO 작성**

`ledger-reconciliation.dto.ts`:
```ts
import { ApiProperty } from '@nestjs/swagger';
import { LedgerDriftSeverity } from '../services/ledger-reconciliation.service';

export class LedgerDriftRowDto {
  @ApiProperty({ description: 'SKU ID' })
  skuId: string;

  @ApiProperty({ description: '창고 ID' })
  warehouseId: string;

  @ApiProperty({ description: '로케이션 ID' })
  locationId: string;

  @ApiProperty({ description: '재고 상태', example: 'ON_HAND' })
  stockState: string;

  @ApiProperty({ description: '이벤트 파생 수량(진실)' })
  derivedQty: number;

  @ApiProperty({ description: '원장 저장 수량' })
  ledgerQty: number;

  @ApiProperty({ description: 'ledgerQty - derivedQty' })
  delta: number;

  @ApiProperty({ description: '심각도', enum: ['CRITICAL', 'MISMATCH'] })
  severity: LedgerDriftSeverity;
}

export class LedgerReconciliationReportDto {
  @ApiProperty({ description: '대사 실행 시각', type: String, format: 'date-time' })
  checkedAt: Date;

  @ApiProperty({ description: '불일치 grain 총 수' })
  totalDriftGrains: number;

  @ApiProperty({ description: 'CRITICAL 등급 수' })
  criticalCount: number;

  @ApiProperty({ description: '불일치 grain 목록', type: [LedgerDriftRowDto] })
  drifts: LedgerDriftRowDto[];
}
```

- [ ] **Step 2: 컨트롤러 위임 실패 테스트 작성**

`ledger-reconciliation.controller.spec.ts`:
```ts
import { LedgerReconciliationController } from './ledger-reconciliation.controller';
import { LedgerReconciliationService, LedgerReconciliationReport } from '../services/ledger-reconciliation.service';

describe('LedgerReconciliationController', () => {
  it('쿼리 필터를 서비스에 전달하고 리포트를 반환한다', async () => {
    const report: LedgerReconciliationReport = {
      checkedAt: new Date(),
      totalDriftGrains: 0,
      criticalCount: 0,
      drifts: [],
    };
    const reconcile = jest.fn().mockResolvedValue(report);
    const service = { reconcile } as unknown as LedgerReconciliationService;
    const controller = new LedgerReconciliationController(service);

    const result = await controller.getReconciliation('wh-1', 'sku-1');

    expect(reconcile).toHaveBeenCalledWith({ warehouseId: 'wh-1', skuId: 'sku-1' });
    expect(result).toBe(report);
  });

  it('필터 없이도 동작한다', async () => {
    const report: LedgerReconciliationReport = { checkedAt: new Date(), totalDriftGrains: 0, criticalCount: 0, drifts: [] };
    const reconcile = jest.fn().mockResolvedValue(report);
    const controller = new LedgerReconciliationController({ reconcile } as unknown as LedgerReconciliationService);
    await controller.getReconciliation(undefined, undefined);
    expect(reconcile).toHaveBeenCalledWith({ warehouseId: undefined, skuId: undefined });
  });
});
```

- [ ] **Step 3: 실패 확인**

Run: `npx jest --testPathPattern=ledger-reconciliation.controller`
Expected: FAIL — Cannot find module './ledger-reconciliation.controller'

- [ ] **Step 4: 컨트롤러 구현**

`ledger-reconciliation.controller.ts`:
```ts
import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery } from '@nestjs/swagger';
import { LedgerReconciliationService } from '../services/ledger-reconciliation.service';
import { LedgerReconciliationReportDto } from '../dto/ledger-reconciliation.dto';

@ApiTags('Inventory - Ledger Reconciliation')
@Controller('inventory/ledger-reconciliation')
export class LedgerReconciliationController {
  constructor(private readonly reconciliationService: LedgerReconciliationService) {}

  @Get()
  @ApiOperation({
    summary: '원장 대사 (탐지 전용)',
    description: 'stock_events(진실) 와 stock_ledgers(파생) 의 불일치 grain 을 조회합니다. 원장을 수정하지 않습니다.',
  })
  @ApiQuery({ name: 'warehouseId', required: false, description: '창고 ID 로 대상 grain 을 좁힘' })
  @ApiQuery({ name: 'skuId', required: false, description: 'SKU ID 로 대상 grain 을 좁힘' })
  @ApiResponse({ status: 200, description: '대사 리포트', type: LedgerReconciliationReportDto })
  async getReconciliation(
    @Query('warehouseId') warehouseId?: string,
    @Query('skuId') skuId?: string,
  ): Promise<LedgerReconciliationReportDto> {
    return this.reconciliationService.reconcile({ warehouseId, skuId });
  }
}
```

- [ ] **Step 5: controllers 등록**

`inventory.module.ts` — import 추가:
```ts
import { LedgerReconciliationController } from './controllers/ledger-reconciliation.controller';
```
`controllers` 배열 끝에 추가:
```ts
    LedgerReconciliationController,
```

- [ ] **Step 6: 테스트 + 빌드 확인**

Run: `npx jest --testPathPattern=ledger-reconciliation.controller`
Expected: PASS (2 tests)
Run: `npx tsc -p apps/core/tsconfig.app.json --noEmit`
Expected: 타입 에러 0

- [ ] **Step 7: 커밋**

```bash
git add apps/core/src/modules/inventory/core/dto/ledger-reconciliation.dto.ts \
        apps/core/src/modules/inventory/core/controllers/ledger-reconciliation.controller.ts \
        apps/core/src/modules/inventory/core/controllers/ledger-reconciliation.controller.spec.ts \
        apps/core/src/modules/inventory/core/inventory.module.ts
git commit -m "[core] 원장 대사 조회 엔드포인트 + 응답 DTO (P2-14)"
```

---

### Task 5: 전체 검증 + 상황판 갱신

**Files:**
- Modify: `docs/logistics-backend-hardening-2026-07.md` (P2-14 상태 🟩)

- [ ] **Step 1: 전체 게이트 실행**

```bash
npx jest --testPathPattern=ledger-reconciliation   # DB 없으면 통합 skip, 나머지 PASS
npx jest --testPathPattern=ledger-drift-metric      # PASS
npx jest --testPathPattern=inventory-write-boundary  # arch 경계 여전히 초록(회귀 없음)
npx tsc -p apps/core/tsconfig.app.json --noEmit      # 타입 0
npm run lint -- apps/core/src/modules/inventory/core/services/ledger-reconciliation.service.ts
```
Expected: 모두 통과. arch 스펙 초록 = 읽기 전용 원칙 유지 확인.

- [ ] **Step 2: 상황판 P2-14 상태 갱신**

`docs/logistics-backend-hardening-2026-07.md` 의 P2-14 행 상태를 `⬜` → `🟩` 로, WS-A 잔여 목록(작업 1 완료 블록의 "WS-A 잔여(미착수)")에서 P2-14 를 제거하고 한 줄 완료 메모 추가. 예:
```
> - **P2-14 완료(2026-07-09)**: events↔ledgers 대사 잡 신설(탐지 전용·무상태). 단일 sql 스냅샷 대사 쿼리 + 야간 크론(`03:00 KST`) + `GET /inventory/ledger-reconciliation` + `wms_ledger_drift_grains` 게이지. 브랜치 `feat/ledger-reconciliation`.
> - **WS-A 잔여(미착수)**: P0-4, P2-2, P2-4.
```

- [ ] **Step 3: 커밋**

```bash
git add docs/logistics-backend-hardening-2026-07.md
git commit -m "[docs] 하드닝 상황판 — P2-14(원장 대사) 완료 반영"
```

- [ ] **Step 4: (DB 복구 시) 통합 스펙 실행**

DB 가 있는 환경에서:
```bash
DATABASE_URL=<core-db-url> npx jest --testPathPattern=ledger-reconciliation.integration
```
Expected: 통합 4건 PASS. (선행 stocktaking 작업의 ⏸ 항목과 동일 — dev DB 부재 시 후속.)

---

## 미해결 항목 / 착수 시 확인 (spec §10)

1. **엔드포인트 route 접두사** — `inventory/ledger-reconciliation` 로 확정(다른 컨트롤러 `inventory/transfers`, `inventory/...` 관례와 일치).
2. **게이지 리셋 시맨틱** — Task 1 에서 두 severity 라벨을 매 실행 set 하여 해소(정상 시 0 명시).
3. **크론 시각** — `03:00 KST` (기존 `auto-confirm-purchase-orders` 는 `00:00` — 충돌 없음).
