# 재고 보충 제안 재설계 — A 단계 (통계 층) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 수요 시계열(`sku_demand_daily`) · SKU 수요 프로필(`sku_demand_profiles`) · 리드타임 프로필 두 표를 **야간 배치가 물질화**하고, 같은 일을 `POST /replenishment/profiles/recompute` 로 지금 돌릴 수 있게 하며, 셀메이트 주문 이력을 시계열에 시드하는 스크립트를 만든다. **제안 API 는 손대지 않는다** — 배포해도 제안은 C 그대로(`legacy_only`)이고, 이 단계는 B 가 읽을 통계만 쌓는다.

**Architecture:** `inventory/replenishment/demand/` 에 writer(core 판매주문 → 시계열) · calculator(순수 통계) · refresher 둘(프로필 · 리드타임) · job(크론 + recompute 오케스트레이션) · settings reader 를 둔다. 분류(ADI·CV² → 패턴)는 `policy/classification.ts` 순수 함수. 전역 설정 표 `replenishment_settings` 는 이 단계가 만들고 `db:seed:ref` 가 1행을 채운다(쓰기 API 는 B). 테이블 5개 · 마이그레이션 1건.

**Tech Stack:** NestJS 11 + drizzle-orm(`postgres.js`) · `@nestjs/schedule`(전역 `SCHEDULE_ROOT`) · Jest(루트 `npx jest`, 통합은 `describeIfDb` + 롤백 트랜잭션) · `scripts/seeding`(참조 시드) · `scripts/sellmate`(`npx tsx`)

**Spec:** `docs/superpowers/specs/2026-09-08-replenishment-suggestion-design.md` — §4(시계열 · 시드 스크립트 · 프로필 · 리드타임) · §6 의 `replenishment_settings` 열 · §8.1(A 표 5개) · §8.2(A 표시 파일) · §8.3(야간 배치) · §9 **A 행** · §9.1 · §10. 이 플랜은 §9 의 A 행만 구현한다.

## Global Constraints

- 브랜치 `feat/743-replenishment-stage-a` (develop 에서 분기). 모든 태스크는 이 브랜치에 커밋한다.
- 커밋 메시지는 한국어, 본문 마지막 줄에 `Claude-Session: https://claude.ai/code/session_01Y5Bthz8rSpjhTgrZTzGBED`.
- **마이그레이션 1건, additive 만.** `schema.ts` 수정 + `npm run db:generate:core -- --name add-replenishment-statistics-tables` 로 생성한 SQL + `drizzle/meta/` 를 **한 커밋**에. 생성된 SQL 을 손으로 고치지 않는다. 배포는 expand 순서 **`db:migrate → db:seed:ref → sst deploy`**.
- 실수 열은 `doublePrecision`, 금액은 `bigint({ mode: 'number' })`, 달력 날짜는 `date({ mode: 'string' })` (스펙 §8.1). Date 객체를 앱 경계에 두지 않는다 — 날짜는 항상 `'YYYY-MM-DD'` 문자열이다.
- **raw SQL 에 Date 객체를 바인딩하지 않는다** (매 호출 TypeError, `notification/metrics.service.ts:54` 의 라이브 버그). 날짜는 `'YYYY-MM-DD'` 문자열로 바인딩하고 SQL 에서 `::date` 로 캐스트한다.
- 달력일은 SQL 에서 `(order_date AT TIME ZONE 'Asia/Seoul')::date` 로 고정한다(스펙 §4.1). 런타임 TZ 에 기대지 않는다 — jest · ECS 는 UTC 다. TS 쪽 날짜 산술은 `Date.UTC` 기반 헬퍼(`demand/calendar.ts`)만 쓴다.
- 레이어 규칙(CLAUDE.md): Controller 는 try/catch 로 상태코드를 매핑하지 않는다. Service 는 2~3줄 위임. DB 접근은 Reader/Writer/Refresher. 도메인 예외는 `@app/shared`.
- Inventory 질의 규칙: `db.query.*` · `with` 관계 · `any` 금지. `as` 캐스트는 **raw `execute()` 결과 타이핑 한 곳**에만 허용하고 `ledger-reconciliation.service.ts:120` 의 선례처럼 주석으로 문서화한다. DB 주입은 `@InjectTypedDb<typeof wmsSchema>()` + `DbService<typeof wmsSchema>`, 트랜잭션은 `this.dbService.run(fn, tx)`. 공개 메서드는 `tx?: DbTx` 를 마지막 인자로.
- 순수 층(`policy/classification.ts` · `demand/calendar.ts` · `demand/demand-profile.calculator.ts`)은 `@nestjs/*` · `drizzle-orm` · `@app/db` 를 import 하지 않는다. `replenishment-boundary.arch.spec.ts` 가 `policy/` 는 자동으로, 나머지 둘은 Task 10 에서 이름으로 등록해 고정한다.
- `replenishment/` 는 `procurement/` 를 import 하지 않는다(경계 스펙이 고정).
- 크론은 `@Cron('40 3 * * *', { name: 'replenishment-profile-refresh', timeZone: 'Asia/Seoul' })` 하나. `ScheduleModule.forRoot()` 를 부르지 않는다(전역 `SCHEDULE_ROOT`, #599).
- 새 라우트 `POST /replenishment/profiles/recompute` 는 `@RequireScopes(INVENTORY_SCOPE.MANAGE)` + 컨트롤러 `@UseGuards(ScopeGuard)`, 그리고 `apps/core/src/platform/auth/inventory-scope-coverage.spec.ts` 의 표에 등록한다(표 그룹 주석의 개수도 +1).
- 검증 게이트: `npm run type-check` 에러 0 · `npx jest --maxWorkers=2` 실패 0. 통합 스펙은 `COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- <파일명>` (워크트리에서 `COMPOSE_PROJECT_NAME` 을 빼면 5432 충돌). 스펙 안에서 `dotenv.config()` 를 부르지 않는다. `describeIfDb` 는 각 스펙이 `const describeIfDb = process.env.DATABASE_URL ? describe : describe.skip;` 로 선언한다(공용 모듈 없음).
- 통합 스펙은 `inRollbackTx(db, async (trx) => …)` 안에서 돌고 DELETE 로 청소하지 않는다. 판매 창고를 하나로 만드는 `trx.update(wmsTables.warehouses).set({ isSellable: false })` 는 롤백되므로 허용.
- `any`/`as unknown as` 는 스펙 파일의 mock 주입(`boundDbService`)에만 쓴다(기존 관례).

---

## File Structure

| 경로 | 책임 | 태스크 |
|---|---|---|
| `apps/core/src/modules/inventory/schema/inventory.schema.ts` (수정) | enum 3 + 표 5 + `wmsTables` 등록 + 타입 | 1 |
| `apps/core/src/modules/inventory/schema/enum-values.ts` (수정) | `demandPatternValues` 등 re-export | 1 |
| `apps/core/drizzle/<ts>_add-replenishment-statistics-tables.sql` + `meta/` (생성) | 마이그레이션 | 1 |
| `apps/core/src/modules/inventory/schema/replenishment-schema.integration.spec.ts` (신설) | 표 5개 존재 · PK · check | 1 |
| `scripts/seeding/steps/replenishment.seed-step.ts` (신설) · `scripts/seeding/phases/03-seed-orchestrator.ts` (수정) · `scripts/seeding/steps/replenishment.seed-step.spec.ts` (신설) | 전역 설정 1행 참조 시드 | 2 |
| `.../replenishment/demand/replenishment-settings.reader.ts` (신설) + `.integration.spec.ts` | 설정 1행 읽기 | 3 |
| `.../replenishment/demand/calendar.ts` (신설) + `.spec.ts` | `'YYYY-MM-DD'` 산술 · KST 오늘 (순수) | 4 |
| `.../replenishment/policy/classification.ts` (신설) + `.spec.ts` | ADI · CV² → 패턴 (순수) | 5 |
| `.../replenishment/demand/demand-profile.calculator.ts` (신설) + `.spec.ts` | 시계열 → §4.3 통계 · 등급 (순수) | 6 |
| `.../replenishment/demand/demand-series.writer.ts` (신설) + `.integration.spec.ts` | core 판매주문 → `sku_demand_daily` 창 재구축 | 7 |
| `.../replenishment/demand/demand-profile.refresher.ts` (신설) + `.integration.spec.ts` | 전 SKU 프로필 upsert | 8 |
| `.../replenishment/demand/lead-time-profile.refresher.ts` (신설) + `.integration.spec.ts` | L1 · L2 관측 → 프로필 | 9 |
| `.../replenishment/demand/replenishment-refresh.job.ts` (신설) + `.spec.ts` | 크론 + 3단계 오케스트레이션 | 10 |
| `.../replenishment/dto/replenishment-profile.dto.ts` · `.../replenishment/demand/replenishment-profile.service.ts` · `.../replenishment/controllers/replenishment-profile.controller.ts` (+`.spec.ts`) (신설) · `replenishment.module.ts` (수정) · `platform/auth/inventory-scope-coverage.spec.ts` (수정) · `inventory/replenishment-boundary.arch.spec.ts` (수정) | recompute 라우트 · 모듈 배선 · 경계 스펙 | 10 |
| `scripts/sellmate/import-demand-history.ts` (신설) + `.spec.ts` · `scripts/sellmate/README.md` (수정) | 셀메이트 주문 이력 시드 | 11 |

---

### Task 0: 브랜치

- [ ] **Step 1: develop 에서 분기**

```bash
git checkout develop && git pull --ff-only
git checkout -b feat/743-replenishment-stage-a
```

---

### Task 1: 스키마 — enum 3 · 표 5 · 마이그레이션 1건

**Files:**
- Modify: `apps/core/src/modules/inventory/schema/inventory.schema.ts` (import 블록 · ENUM 블록 끝 · `SETTINGS & HOLIDAYS` 섹션 뒤 · `wmsTables` · 타입 블록)
- Modify: `apps/core/src/modules/inventory/schema/enum-values.ts`
- Create: `apps/core/drizzle/<timestamp>_add-replenishment-statistics-tables.sql` (생성) + `apps/core/drizzle/meta/` 갱신
- Test: `apps/core/src/modules/inventory/schema/replenishment-schema.integration.spec.ts`

**Interfaces:**
- Produces: drizzle 표 `replenishmentSettings` · `skuDemandDaily` · `skuDemandProfiles` · `supplierLeadTimeProfiles` · `routeLeadTimeProfiles` (전부 `wmsTables` 에 등록), enum `demandSourceEnum` · `demandPatternEnum` · `demandGradeEnum`, 타입 `ReplenishmentSettings` · `SkuDemandProfile` · `NewSkuDemandProfile`, `enum-values.ts` 의 `demandPatternValues` · `DemandPatternEnum` · `demandGradeValues` · `DemandGradeEnum` · `demandSourceValues` · `DemandSourceEnum`.

- [ ] **Step 1: 실패하는 통합 스펙**

```ts
// apps/core/src/modules/inventory/schema/replenishment-schema.integration.spec.ts
import * as postgres from 'postgres';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import { wmsSchema, wmsTables, DbTx } from './inventory.schema';
import { makeDb, inRollbackTx, seedHolder, seedSku } from '../../fulfillment/services/__support__';

/**
 * A 단계 표 5개(스펙 §8.1)가 마이그레이션으로 존재하고 제약이 살아 있는지.
 * 실행: COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- replenishment-schema.integration
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('replenishment statistics schema (A)', () => {
  jest.setTimeout(60_000);
  let client: postgres.Sql;
  let db: PostgresJsDatabase<typeof wmsSchema>;

  beforeAll(() => {
    ({ sql: client, db } = makeDb(DATABASE_URL as string));
  });
  afterAll(async () => {
    await client.end();
  });

  it('표 5개가 존재한다', async () => {
    const names = [
      'replenishment_settings',
      'sku_demand_daily',
      'sku_demand_profiles',
      'supplier_lead_time_profiles',
      'route_lead_time_profiles',
    ];
    for (const name of names) {
      const rows = await db.execute(sql`SELECT to_regclass(${'public.' + name})::text AS name`);
      // execute() 원시 결과 타이핑 — ledger-reconciliation.service.ts:120 과 같은 문서화된 캐스트.
      const [row] = rows as unknown as Array<{ name: string | null }>;
      expect(row.name).toBe(name);
    }
  });

  it('sku_demand_daily 는 (sku_id, demand_date) 가 PK 이고 qty < 0 을 거부한다', async () => {
    await inRollbackTx(db, async (trx: DbTx) => {
      const { holderId } = await seedHolder(trx);
      const { skuId } = await seedSku(trx, holderId);
      await trx
        .insert(wmsTables.skuDemandDaily)
        .values({ skuId, demandDate: '2026-01-01', qty: 3, amount: 3000, source: 'core' });
      await expect(
        trx.insert(wmsTables.skuDemandDaily).values({ skuId, demandDate: '2026-01-01', qty: 1, amount: null, source: 'core' }),
      ).rejects.toThrow(/duplicate key/);
    });
    await inRollbackTx(db, async (trx: DbTx) => {
      const { holderId } = await seedHolder(trx);
      const { skuId } = await seedSku(trx, holderId);
      await expect(
        trx.insert(wmsTables.skuDemandDaily).values({ skuId, demandDate: '2026-01-02', qty: -1, amount: null, source: 'core' }),
      ).rejects.toThrow(/chk_sku_demand_daily_qty/);
    });
  });

  it('replenishment_settings 의 기본값은 스펙 §6 의 값이다', async () => {
    await inRollbackTx(db, async (trx: DbTx) => {
      const [row] = await trx.insert(wmsTables.replenishmentSettings).values({ key: 'it-default' }).returning();
      expect(row.adiThreshold).toBe(1.32);
      expect(row.cv2Threshold).toBe(0.49);
      expect(row.classificationWindowDays).toBe(365);
      expect(row.paramWindowDaysFrequent).toBe(90);
      expect(row.paramWindowDaysSparse).toBe(365);
      expect(row.minDemandEvents).toBe(3);
      expect(row.minLeadTimeObservations).toBe(5);
      expect(row.leadTimeWindowDays).toBe(365);
      expect(row.gradeACut).toBe(0.8);
      expect(row.gradeBCut).toBe(0.95);
      expect(row.demandCoreSince).toBeNull();
      expect(row.demandRecomputeDays).toBe(14);
      expect(row.consolidationBufferDays).toBe(7);
      expect(row.defaultLeadTimeDays).toBe(30);
      expect(row.defaultLeadTimeStdDays).toBeNull();
      expect(row.defaultTransferLeadTimeDays).toBe(14);
      expect(row.defaultTransferLeadTimeStdDays).toBeNull();
      expect(row.defaultLeadTimeCv).toBe(0.25);
      expect(row.defaultCoverDays).toBe(30);
      expect(row.defaultTransferCoverDays).toBe(14);
    });
  });

  it('프로필 표는 SKU 삭제에 cascade 한다', async () => {
    await inRollbackTx(db, async (trx: DbTx) => {
      const { holderId } = await seedHolder(trx);
      const { skuId } = await seedSku(trx, holderId);
      await trx.insert(wmsTables.skuDemandProfiles).values({
        skuId,
        pattern: 'none',
        grade: 'C',
        classificationFrom: '2025-09-08',
        classificationTo: '2026-09-07',
        paramFrom: '2026-06-10',
        paramTo: '2026-09-07',
        computedAt: new Date(),
      });
      await trx.delete(wmsTables.skus).where(sql`${wmsTables.skus.id} = ${skuId}`);
      const rows = await trx.select().from(wmsTables.skuDemandProfiles).where(sql`${wmsTables.skuDemandProfiles.skuId} = ${skuId}`);
      expect(rows).toEqual([]);
    });
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- replenishment-schema.integration`
Expected: FAIL — `Property 'skuDemandDaily' does not exist on type …` (ts-jest 컴파일 에러) 또는 `to_regclass` 가 null.

- [ ] **Step 3: import 블록에 `bigint` · `doublePrecision` 추가**

`apps/core/src/modules/inventory/schema/inventory.schema.ts` 3~24행의 `from 'drizzle-orm/pg-core'` import 에 두 이름을 더한다:

```ts
import {
  pgTable,
  pgView,
  uuid,
  varchar,
  boolean,
  integer,
  bigint,
  doublePrecision,
  timestamp,
  json,
  jsonb,
  text,
  pgEnum,
  primaryKey,
  unique,
  decimal,
  date,
  index,
  uniqueIndex,
  check,
  foreignKey,
  AnyPgColumn,
} from 'drizzle-orm/pg-core';
```

- [ ] **Step 4: ENUM 블록 끝(`waybillStatusEnum` 보다 앞, 324행 근처)에 enum 3개**

```ts
// ── 재고 보충 (#743, 스펙 §4) ──
export const demandSourceEnum = pgEnum('demand_source', ['sellmate', 'core']);
export const demandPatternEnum = pgEnum('demand_pattern', [
  'smooth',
  'intermittent',
  'erratic',
  'lumpy',
  'insufficient',
  'none',
]);
export const demandGradeEnum = pgEnum('demand_grade', ['A', 'B', 'C']);
```

- [ ] **Step 5: `SETTINGS & HOLIDAYS` 섹션(`holidays` 표) 바로 뒤에 표 5개**

```ts
/*───────────────────────────
 * REPLENISHMENT — 통계 층 (#743 A, 스펙 §4 · §6 · §8.1)
 * 실수는 double precision, 금액은 bigint, 달력일은 date(mode:'string').
 *──────────────────────────*/

/** 전역 설정 1행(key='default'). A 는 읽기만, PUT 은 B(스펙 §8.1). 시드가 채운다 — 비어 있으면 db:seed:ref 미실행. */
export const replenishmentSettings = pgTable('replenishment_settings', {
  key: varchar('key', { length: 32 }).primaryKey(),
  adiThreshold: doublePrecision('adi_threshold').notNull().default(1.32),
  cv2Threshold: doublePrecision('cv2_threshold').notNull().default(0.49),
  classificationWindowDays: integer('classification_window_days').notNull().default(365),
  paramWindowDaysFrequent: integer('param_window_days_frequent').notNull().default(90),
  paramWindowDaysSparse: integer('param_window_days_sparse').notNull().default(365),
  minDemandEvents: integer('min_demand_events').notNull().default(3),
  minLeadTimeObservations: integer('min_lead_time_observations').notNull().default(5),
  leadTimeWindowDays: integer('lead_time_window_days').notNull().default(365),
  gradeACut: doublePrecision('grade_a_cut').notNull().default(0.8),
  gradeBCut: doublePrecision('grade_b_cut').notNull().default(0.95),
  /** D0 — 셀메이트 시드는 이 날 이전만, core 는 이 날 이후만(스펙 §4.1). 시드 스크립트가 설정한다. */
  demandCoreSince: date('demand_core_since', { mode: 'string' }),
  demandRecomputeDays: integer('demand_recompute_days').notNull().default(14),
  consolidationBufferDays: integer('consolidation_buffer_days').notNull().default(7),
  defaultLeadTimeDays: doublePrecision('default_lead_time_days').notNull().default(30),
  defaultLeadTimeStdDays: doublePrecision('default_lead_time_std_days'),
  defaultTransferLeadTimeDays: doublePrecision('default_transfer_lead_time_days').notNull().default(14),
  defaultTransferLeadTimeStdDays: doublePrecision('default_transfer_lead_time_std_days'),
  defaultLeadTimeCv: doublePrecision('default_lead_time_cv').notNull().default(0.25),
  defaultCoverDays: integer('default_cover_days').notNull().default(30),
  defaultTransferCoverDays: integer('default_transfer_cover_days').notNull().default(14),
  updatedBy: uuid('updated_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/** SKU × KST 달력일 수요. qty ≥ 0. amount(원)는 등급 산정용, null 허용. */
export const skuDemandDaily = pgTable(
  'sku_demand_daily',
  {
    skuId: uuid('sku_id')
      .references(() => skus.id, { onDelete: 'cascade' })
      .notNull(),
    demandDate: date('demand_date', { mode: 'string' }).notNull(),
    qty: integer('qty').notNull(),
    amount: bigint('amount', { mode: 'number' }),
    source: demandSourceEnum('source').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey(t.skuId, t.demandDate),
    idxSkuDemandDailyDate: index('idx_sku_demand_daily_date').on(t.demandDate),
    chkQty: check('chk_sku_demand_daily_qty', sql`${t.qty} >= 0`),
  }),
);

/** SKU 당 1행. 통계 사실만 — 안전재고 · 재주문점은 저장하지 않는다(D5). */
export const skuDemandProfiles = pgTable(
  'sku_demand_profiles',
  {
    skuId: uuid('sku_id')
      .primaryKey()
      .references(() => skus.id, { onDelete: 'cascade' }),
    pattern: demandPatternEnum('pattern').notNull(),
    grade: demandGradeEnum('grade').notNull(),
    adi: doublePrecision('adi'),
    cv2: doublePrecision('cv2'),
    dailyMean: doublePrecision('daily_mean').notNull().default(0),
    dailyStd: doublePrecision('daily_std').notNull().default(0),
    /** 항상 param_window_days_frequent 창의 일평균 — 레거시 재주문점(μ_D(90)·μ_L) 전용 */
    dailyMean90: doublePrecision('daily_mean_90').notNull().default(0),
    sizeMean: doublePrecision('size_mean'),
    sizeStd: doublePrecision('size_std'),
    intervalMean: doublePrecision('interval_mean'),
    historyDays: integer('history_days').notNull().default(0),
    demandEvents: integer('demand_events').notNull().default(0),
    classificationFrom: date('classification_from', { mode: 'string' }).notNull(),
    classificationTo: date('classification_to', { mode: 'string' }).notNull(),
    paramFrom: date('param_from', { mode: 'string' }).notNull(),
    paramTo: date('param_to', { mode: 'string' }).notNull(),
    computedAt: timestamp('computed_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    idxSkuDemandProfilesPattern: index('idx_sku_demand_profiles_pattern').on(t.pattern),
  }),
);

/** L1 관측: 발주 라인 ordered_at → 첫 입고(스펙 §4.4). n < 2 면 std null. */
export const supplierLeadTimeProfiles = pgTable('supplier_lead_time_profiles', {
  supplierId: uuid('supplier_id')
    .primaryKey()
    .references(() => suppliers.id, { onDelete: 'cascade' }),
  observations: integer('observations').notNull(),
  meanDays: doublePrecision('mean_days').notNull(),
  stdDays: doublePrecision('std_days'),
  windowFrom: date('window_from', { mode: 'string' }).notNull(),
  windowTo: date('window_to', { mode: 'string' }).notNull(),
  computedAt: timestamp('computed_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/** L2 관측: 지시서 shipped_at → 첫 수령. (from, to) 창고 쌍 당 1행. */
export const routeLeadTimeProfiles = pgTable(
  'route_lead_time_profiles',
  {
    fromWarehouseId: uuid('from_warehouse_id')
      .references(() => warehouses.id, { onDelete: 'cascade' })
      .notNull(),
    toWarehouseId: uuid('to_warehouse_id')
      .references(() => warehouses.id, { onDelete: 'cascade' })
      .notNull(),
    observations: integer('observations').notNull(),
    meanDays: doublePrecision('mean_days').notNull(),
    stdDays: doublePrecision('std_days'),
    windowFrom: date('window_from', { mode: 'string' }).notNull(),
    windowTo: date('window_to', { mode: 'string' }).notNull(),
    computedAt: timestamp('computed_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey(t.fromWarehouseId, t.toWarehouseId),
  }),
);
```

- [ ] **Step 6: `wmsTables` 끝(`dispatchAttemptSources,` 뒤)에 등록**

```ts
  dispatchAttemptSources,

  // 재고 보충 통계 층 (#743 A)
  replenishmentSettings,
  skuDemandDaily,
  skuDemandProfiles,
  supplierLeadTimeProfiles,
  routeLeadTimeProfiles,
} as const;
```

- [ ] **Step 7: 타입 블록(`export type Supplier = InferSelectModel<typeof suppliers>;` 근처)에 타입 추가**

```ts
export type ReplenishmentSettings = InferSelectModel<typeof replenishmentSettings>;
export type SkuDemandDaily = InferSelectModel<typeof skuDemandDaily>;
export type NewSkuDemandDaily = InferInsertModel<typeof skuDemandDaily>;
export type SkuDemandProfile = InferSelectModel<typeof skuDemandProfiles>;
export type NewSkuDemandProfile = InferInsertModel<typeof skuDemandProfiles>;
export type SupplierLeadTimeProfile = InferSelectModel<typeof supplierLeadTimeProfiles>;
export type RouteLeadTimeProfile = InferSelectModel<typeof routeLeadTimeProfiles>;
```

- [ ] **Step 8: `enum-values.ts` 에 re-export**

import 목록에 `demandSourceEnum, demandPatternEnum, demandGradeEnum` 을 더하고 파일 끝에:

```ts
export const demandSourceValues = demandSourceEnum.enumValues;
export type DemandSourceEnum = (typeof demandSourceValues)[number];

export const demandPatternValues = demandPatternEnum.enumValues;
export type DemandPatternEnum = (typeof demandPatternValues)[number];

export const demandGradeValues = demandGradeEnum.enumValues;
export type DemandGradeEnum = (typeof demandGradeValues)[number];
```

- [ ] **Step 9: 마이그레이션 생성 · 검토**

```bash
npm run db:generate:core -- --name add-replenishment-statistics-tables
ls apps/core/drizzle | tail -2
```

생성된 SQL 을 열어 확인한다: `CREATE TYPE "public"."demand_source"` · `demand_pattern` · `demand_grade` 3개, `CREATE TABLE` 5개, `ALTER TABLE … ADD CONSTRAINT … FOREIGN KEY` 7개(daily 1 · profiles 1 · supplier 1 · route 2 = 5 … 그리고 daily/profile 의 `ON DELETE cascade`), `CREATE INDEX` 2개, `CHECK` 1개. **`DROP` · `ALTER COLUMN` 이 한 줄이라도 있으면** 스키마 편집이 다른 표를 건드린 것이다 — `git checkout apps/core/drizzle` 로 되돌리고 schema.ts 를 고친 뒤 다시 생성한다. `apps/core/drizzle/meta/_journal.json` 의 마지막 entry 가 이 마이그레이션인지 본다.

- [ ] **Step 10: 로컬 DB 에 적용하고 통합 스펙 통과 확인**

Run: `COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- replenishment-schema.integration`
(러너가 `drizzle-kit migrate` 를 먼저 돌린다.)
Expected: PASS 4 tests.

Run: `npm run type-check`
Expected: 에러 0.

- [ ] **Step 11: 커밋 (schema + SQL + meta 를 한 커밋에)**

```bash
git add apps/core/src/modules/inventory/schema/inventory.schema.ts apps/core/src/modules/inventory/schema/enum-values.ts apps/core/drizzle apps/core/src/modules/inventory/schema/replenishment-schema.integration.spec.ts
git commit -m "feat(core): 재고 보충 통계 층 표 5개 — 설정 · 수요 시계열 · 수요 프로필 · 리드타임 프로필 2종 (#743 A)

Claude-Session: https://claude.ai/code/session_01Y5Bthz8rSpjhTgrZTzGBED"
```

---

### Task 2: 참조 시드 — `replenishment_settings` 1행

**Files:**
- Create: `scripts/seeding/steps/replenishment.seed-step.ts`
- Modify: `scripts/seeding/phases/03-seed-orchestrator.ts` (import + core 블록 `steps.push`)
- Test: `scripts/seeding/steps/replenishment.seed-step.spec.ts`

**Interfaces:**
- Produces: `REPLENISHMENT_SETTINGS_SEED` 상수(`key: 'default'` + 스펙 §6 초기값), `ReplenishmentSeedStep` (group `baseline`, 서비스명 `Replenishment`). B 가 같은 스텝에 등급 규칙 3행을 더한다.

- [ ] **Step 1: 실패하는 스펙 (순수 — 시드 상수의 모양을 고정)**

```ts
// scripts/seeding/steps/replenishment.seed-step.spec.ts
import { REPLENISHMENT_SETTINGS_SEED, ReplenishmentSeedStep } from './replenishment.seed-step';

describe('ReplenishmentSeedStep', () => {
  it('전역 설정 시드는 key=default 한 행이고 스펙 §6 의 보수적 초기값을 갖는다', () => {
    expect(REPLENISHMENT_SETTINGS_SEED.key).toBe('default');
    expect(REPLENISHMENT_SETTINGS_SEED.defaultLeadTimeDays).toBe(30);
    expect(REPLENISHMENT_SETTINGS_SEED.defaultTransferLeadTimeDays).toBe(14);
    expect(REPLENISHMENT_SETTINGS_SEED.defaultCoverDays).toBe(30);
    expect(REPLENISHMENT_SETTINGS_SEED.defaultTransferCoverDays).toBe(14);
    expect(REPLENISHMENT_SETTINGS_SEED.demandCoreSince).toBeNull();
  });

  it('baseline 그룹이다 — db:seed:ref 가 돌린다', () => {
    const step = new ReplenishmentSeedStep('postgres://localhost:5432/unused');
    expect(step.groups).toEqual(['baseline']);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx jest scripts/seeding/steps/replenishment.seed-step.spec.ts`
Expected: FAIL — `Cannot find module './replenishment.seed-step'`

- [ ] **Step 3: 시드 스텝 구현**

```ts
// scripts/seeding/steps/replenishment.seed-step.ts
import { sql } from 'drizzle-orm';
import { SeedStep } from './base-seed-step';
import { SeedCheckResult, SeedApplyResult } from '../lib/types';

/**
 * 재고 보충 전역 설정 1행 (#743 A, 스펙 §6 「초기값」). 운영자가 규칙 화면(B)에서 고친다.
 * ON CONFLICT DO NOTHING — 이미 있으면 운영자가 바꾼 값을 덮지 않는다.
 */
export const REPLENISHMENT_SETTINGS_SEED = {
  key: 'default',
  adiThreshold: 1.32,
  cv2Threshold: 0.49,
  classificationWindowDays: 365,
  paramWindowDaysFrequent: 90,
  paramWindowDaysSparse: 365,
  minDemandEvents: 3,
  minLeadTimeObservations: 5,
  leadTimeWindowDays: 365,
  gradeACut: 0.8,
  gradeBCut: 0.95,
  demandCoreSince: null as string | null,
  demandRecomputeDays: 14,
  consolidationBufferDays: 7,
  defaultLeadTimeDays: 30,
  defaultLeadTimeStdDays: null as number | null,
  defaultTransferLeadTimeDays: 14,
  defaultTransferLeadTimeStdDays: null as number | null,
  defaultLeadTimeCv: 0.25,
  defaultCoverDays: 30,
  defaultTransferCoverDays: 14,
};

export class ReplenishmentSeedStep extends SeedStep {
  readonly groups = ['baseline'] as const;

  constructor(databaseUrl: string) {
    super('Replenishment', databaseUrl);
  }

  async check(): Promise<SeedCheckResult> {
    const existing = await this.findExistingKeys('replenishment_settings', [REPLENISHMENT_SETTINGS_SEED.key], 'key');
    const missing = existing.has(REPLENISHMENT_SETTINGS_SEED.key) ? 0 : 1;
    const items = [
      {
        entity: 'replenishment_settings',
        expected: 1,
        existing: 1 - missing,
        missing,
        missingDetails: missing ? [REPLENISHMENT_SETTINGS_SEED.key] : [],
      },
    ];
    const isFullySeeded = missing === 0;
    return {
      service: 'Replenishment',
      items,
      isFullySeeded,
      summary: isFullySeeded ? 'All Replenishment seed data present' : `${missing} missing record(s)`,
    };
  }

  async apply(): Promise<SeedApplyResult> {
    const start = Date.now();
    const s = REPLENISHMENT_SETTINGS_SEED;
    try {
      this.logger.step(1, 1, 'Inserting replenishment settings');
      await this.db.execute(sql`
        INSERT INTO replenishment_settings (
          key, adi_threshold, cv2_threshold, classification_window_days,
          param_window_days_frequent, param_window_days_sparse, min_demand_events,
          min_lead_time_observations, lead_time_window_days, grade_a_cut, grade_b_cut,
          demand_core_since, demand_recompute_days, consolidation_buffer_days,
          default_lead_time_days, default_lead_time_std_days,
          default_transfer_lead_time_days, default_transfer_lead_time_std_days,
          default_lead_time_cv, default_cover_days, default_transfer_cover_days
        ) VALUES (
          ${s.key}, ${s.adiThreshold}, ${s.cv2Threshold}, ${s.classificationWindowDays},
          ${s.paramWindowDaysFrequent}, ${s.paramWindowDaysSparse}, ${s.minDemandEvents},
          ${s.minLeadTimeObservations}, ${s.leadTimeWindowDays}, ${s.gradeACut}, ${s.gradeBCut},
          ${s.demandCoreSince}, ${s.demandRecomputeDays}, ${s.consolidationBufferDays},
          ${s.defaultLeadTimeDays}, ${s.defaultLeadTimeStdDays},
          ${s.defaultTransferLeadTimeDays}, ${s.defaultTransferLeadTimeStdDays},
          ${s.defaultLeadTimeCv}, ${s.defaultCoverDays}, ${s.defaultTransferCoverDays}
        )
        ON CONFLICT (key) DO NOTHING
      `);
      this.logger.success('Replenishment seeding completed');
      return { service: 'Replenishment', success: true, itemsApplied: 1, duration: Date.now() - start };
    } catch (error: any) {
      this.logger.error('Replenishment seeding failed', error);
      return { service: 'Replenishment', success: false, itemsApplied: 0, duration: Date.now() - start, error: error.message };
    }
  }
}
```

- [ ] **Step 4: 오케스트레이터 등록**

`scripts/seeding/phases/03-seed-orchestrator.ts` — import 블록에:

```ts
import { ReplenishmentSeedStep } from '../steps/replenishment.seed-step';
```

core 블록(`if (coreEntry?.hasSeedStep) {`)의 `steps.push(new ProductMatchingBackfillSeedStep(coreDbUrl));` 뒤에:

```ts
    steps.push(new ReplenishmentSeedStep(coreDbUrl));
```

- [ ] **Step 5: 통과 확인 + 로컬 시드 적용**

Run: `npx jest scripts/seeding/steps/replenishment.seed-step.spec.ts`
Expected: PASS 2 tests.

로컬 DB 에 실제로 넣어 본다(통합 스펙 Task 3 이 이 행을 전제하지 않고 직접 insert 하지만, 시드 SQL 이 컬럼명을 맞게 썼는지는 여기서만 검증된다):

```bash
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/core npx tsx -e "
import { ReplenishmentSeedStep } from './scripts/seeding/steps/replenishment.seed-step';
(async () => { const s = new ReplenishmentSeedStep(process.env.DATABASE_URL!); console.log(await s.apply()); console.log(await s.check()); await s.dispose(); })();
"
```

Expected: `success: true` 이후 `isFullySeeded: true`. 두 번 돌려도 같다.

- [ ] **Step 6: 커밋**

```bash
git add scripts/seeding/steps/replenishment.seed-step.ts scripts/seeding/steps/replenishment.seed-step.spec.ts scripts/seeding/phases/03-seed-orchestrator.ts
git commit -m "feat(seed): 재고 보충 전역 설정 1행 참조 시드 (#743 A)

Claude-Session: https://claude.ai/code/session_01Y5Bthz8rSpjhTgrZTzGBED"
```

---

### Task 3: `ReplenishmentSettingsReader`

**Files:**
- Create: `apps/core/src/modules/inventory/replenishment/demand/replenishment-settings.reader.ts`
- Test: `apps/core/src/modules/inventory/replenishment/demand/replenishment-settings.reader.integration.spec.ts`

**Interfaces:**
- Produces: `ReplenishmentSettingsReader.read(tx?: DbTx): Promise<ReplenishmentSettings>` — `key='default'` 행. 없으면 `throw new Error('replenishment_settings 가 비어 있다 — db:seed:ref 를 먼저 돌릴 것')` (500. 배포 절차 누락이지 클라이언트 오류가 아니다). `SETTINGS_KEY = 'default'` 상수.

- [ ] **Step 1: 실패하는 통합 스펙**

```ts
// apps/core/src/modules/inventory/replenishment/demand/replenishment-settings.reader.integration.spec.ts
import * as postgres from 'postgres';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import { DbService } from '@app/db';
import { wmsSchema, wmsTables, DbTx } from '../../schema/inventory.schema';
import { makeDb, inRollbackTx } from '../../../fulfillment/services/__support__';
import { ReplenishmentSettingsReader, SETTINGS_KEY } from './replenishment-settings.reader';

/**
 * 실행: COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- replenishment-settings.reader.integration
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('ReplenishmentSettingsReader (DB integration)', () => {
  jest.setTimeout(60_000);
  let client: postgres.Sql;
  let db: PostgresJsDatabase<typeof wmsSchema>;

  beforeAll(() => {
    ({ sql: client, db } = makeDb(DATABASE_URL as string));
  });
  afterAll(async () => {
    await client.end();
  });

  function boundDbService(trx: DbTx): DbService<typeof wmsSchema> {
    return {
      db,
      run: <T>(fn: (t: DbTx) => Promise<T>, tx?: DbTx): Promise<T> => fn(tx ?? trx),
    } as unknown as DbService<typeof wmsSchema>;
  }

  it('default 행을 읽는다', async () => {
    await inRollbackTx(db, async (trx) => {
      await trx.delete(wmsTables.replenishmentSettings).where(eq(wmsTables.replenishmentSettings.key, SETTINGS_KEY));
      await trx.insert(wmsTables.replenishmentSettings).values({ key: SETTINGS_KEY, demandRecomputeDays: 21 });
      const reader = new ReplenishmentSettingsReader(boundDbService(trx));
      const settings = await reader.read(trx);
      expect(settings.key).toBe('default');
      expect(settings.demandRecomputeDays).toBe(21);
      expect(settings.adiThreshold).toBe(1.32);
    });
  });

  it('행이 없으면 시드 미실행을 알리는 Error 를 던진다', async () => {
    await inRollbackTx(db, async (trx) => {
      await trx.delete(wmsTables.replenishmentSettings).where(eq(wmsTables.replenishmentSettings.key, SETTINGS_KEY));
      const reader = new ReplenishmentSettingsReader(boundDbService(trx));
      await expect(reader.read(trx)).rejects.toThrow(/db:seed:ref/);
    });
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- replenishment-settings.reader.integration`
Expected: FAIL — `Cannot find module './replenishment-settings.reader'`

- [ ] **Step 3: 구현**

```ts
// apps/core/src/modules/inventory/replenishment/demand/replenishment-settings.reader.ts
import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { InjectTypedDb, DbService } from '@app/db';
import { wmsSchema, wmsTables, DbTx, ReplenishmentSettings } from '../../schema/inventory.schema';

export const SETTINGS_KEY = 'default';

/**
 * 전역 설정 1행 (#743, 스펙 §6). A 는 읽기만 — 쓰기(PUT)는 B 의 규칙 층.
 * 행이 없는 것은 배포 절차(db:seed:ref) 누락이라 도메인 예외가 아니라 Error(500) 다.
 */
@Injectable()
export class ReplenishmentSettingsReader {
  constructor(@InjectTypedDb<typeof wmsSchema>() private readonly dbService: DbService<typeof wmsSchema>) {}

  async read(tx?: DbTx): Promise<ReplenishmentSettings> {
    return this.dbService.run(async (trx) => {
      const [row] = await trx
        .select()
        .from(wmsTables.replenishmentSettings)
        .where(eq(wmsTables.replenishmentSettings.key, SETTINGS_KEY));
      if (!row) throw new Error('replenishment_settings 가 비어 있다 — db:seed:ref 를 먼저 돌릴 것');
      return row;
    }, tx);
  }
}
```

- [ ] **Step 4: 통과 확인**

Run: `COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- replenishment-settings.reader.integration`
Expected: PASS 2 tests.

- [ ] **Step 5: 커밋**

```bash
git add apps/core/src/modules/inventory/replenishment/demand/
git commit -m "feat(core): 재고 보충 전역 설정 리더 (#743 A)

Claude-Session: https://claude.ai/code/session_01Y5Bthz8rSpjhTgrZTzGBED"
```

---
### Task 4: `demand/calendar.ts` — 달력일 산술 (순수)

**Files:**
- Create: `apps/core/src/modules/inventory/replenishment/demand/calendar.ts`
- Test: `apps/core/src/modules/inventory/replenishment/demand/calendar.spec.ts`

**Interfaces:**
- Produces: `addDays(iso: string, days: number): string` · `dayDiff(fromIso: string, toIso: string): number` (to − from, 일) · `kstDateOf(instant: Date): string` (Asia/Seoul 달력일) · `isIsoDate(s: string): boolean`. 입력과 출력은 전부 `'YYYY-MM-DD'`. 내부는 `Date.UTC` 라 런타임 TZ 와 무관.

- [ ] **Step 1: 실패하는 테스트**

```ts
// apps/core/src/modules/inventory/replenishment/demand/calendar.spec.ts
import { addDays, dayDiff, isIsoDate, kstDateOf } from './calendar';

describe('calendar — YYYY-MM-DD 산술', () => {
  it('addDays 는 달 · 해 경계를 넘는다', () => {
    expect(addDays('2026-09-08', -90)).toBe('2026-06-10');
    expect(addDays('2026-09-08', -365)).toBe('2025-09-08');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDays('2025-12-31', 1)).toBe('2026-01-01');
    expect(addDays('2026-09-08', 0)).toBe('2026-09-08');
  });

  it('dayDiff 는 to − from 이고 같은 날은 0', () => {
    expect(dayDiff('2026-06-10', '2026-09-07')).toBe(89);
    expect(dayDiff('2026-09-07', '2026-09-07')).toBe(0);
    expect(dayDiff('2026-09-08', '2026-09-07')).toBe(-1);
  });

  it('kstDateOf 는 UTC 15:00 부터 다음 날이다', () => {
    expect(kstDateOf(new Date('2026-09-08T14:59:59Z'))).toBe('2026-09-08');
    expect(kstDateOf(new Date('2026-09-08T15:00:00Z'))).toBe('2026-09-09');
  });

  it('isIsoDate', () => {
    expect(isIsoDate('2026-09-08')).toBe(true);
    expect(isIsoDate('2026-9-8')).toBe(false);
    expect(isIsoDate('2026-13-01')).toBe(false);
    expect(isIsoDate('2026-02-30')).toBe(false);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx jest apps/core/src/modules/inventory/replenishment/demand/calendar.spec.ts`
Expected: FAIL — `Cannot find module './calendar'`

- [ ] **Step 3: 구현**

```ts
// apps/core/src/modules/inventory/replenishment/demand/calendar.ts
/**
 * 'YYYY-MM-DD' 달력일 산술. Date.UTC 위에서만 계산하므로 런타임 TZ(jest · ECS 는 UTC, 개발 머신은 KST)에
 * 결과가 흔들리지 않는다. 순수 함수 — Nest · drizzle 을 모른다.
 */
const DAY_MS = 24 * 60 * 60 * 1000;
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function toUtcMs(iso: string): number {
  const m = ISO_DATE.exec(iso);
  if (!m) throw new Error(`YYYY-MM-DD 가 아니다: ${iso}`);
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function fromUtcMs(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function isIsoDate(s: string): boolean {
  const m = ISO_DATE.exec(s);
  if (!m) return false;
  return fromUtcMs(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))) === s;
}

export function addDays(iso: string, days: number): string {
  return fromUtcMs(toUtcMs(iso) + days * DAY_MS);
}

/** to − from (일). 같은 날 0. */
export function dayDiff(fromIso: string, toIso: string): number {
  return Math.round((toUtcMs(toIso) - toUtcMs(fromIso)) / DAY_MS);
}

/** 순간 → Asia/Seoul 달력일. DST 가 없는 고정 +09:00. */
export function kstDateOf(instant: Date): string {
  return fromUtcMs(instant.getTime() + KST_OFFSET_MS);
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx jest apps/core/src/modules/inventory/replenishment/demand/calendar.spec.ts`
Expected: PASS 4 tests.

- [ ] **Step 5: 커밋**

```bash
git add apps/core/src/modules/inventory/replenishment/demand/calendar.ts apps/core/src/modules/inventory/replenishment/demand/calendar.spec.ts
git commit -m "feat(core): 보충 통계용 달력일 산술 순수 함수 (#743 A)

Claude-Session: https://claude.ai/code/session_01Y5Bthz8rSpjhTgrZTzGBED"
```

---

### Task 5: `policy/classification.ts` — ADI · CV² → 패턴 (순수)

**Files:**
- Create: `apps/core/src/modules/inventory/replenishment/policy/classification.ts`
- Test: `apps/core/src/modules/inventory/replenishment/policy/classification.spec.ts`

**Interfaces:**
- Produces:
  ```ts
  export type DemandPattern = 'smooth' | 'intermittent' | 'erratic' | 'lumpy' | 'insufficient' | 'none';
  export const MIN_HISTORY_DAYS = 30;
  export interface ClassificationThresholds { adiThreshold: number; cv2Threshold: number; minDemandEvents: number }
  export interface ClassificationStats { adi: number | null; cv2: number | null; demandEvents: number; historyDays: number }
  export function classifyPattern(stats: ClassificationStats, t: ClassificationThresholds): DemandPattern
  ```
  경계는 **≤ 임계 → 낮은 쪽**(=1.32 는 smooth/erratic 쪽, =0.49 는 smooth/intermittent 쪽).

- [ ] **Step 1: 실패하는 테스트**

```ts
// apps/core/src/modules/inventory/replenishment/policy/classification.spec.ts
import { classifyPattern, MIN_HISTORY_DAYS } from './classification';

const t = { adiThreshold: 1.32, cv2Threshold: 0.49, minDemandEvents: 3 };
const enough = { demandEvents: 50, historyDays: 365 };

describe('classifyPattern — ADI·CV² 사분면', () => {
  it('smooth: ADI ≤ 1.32 · CV² ≤ 0.49', () => {
    expect(classifyPattern({ adi: 1.0, cv2: 0.1, ...enough }, t)).toBe('smooth');
  });
  it('erratic: ADI ≤ 1.32 · CV² > 0.49', () => {
    expect(classifyPattern({ adi: 1.0, cv2: 0.8, ...enough }, t)).toBe('erratic');
  });
  it('intermittent: ADI > 1.32 · CV² ≤ 0.49', () => {
    expect(classifyPattern({ adi: 5, cv2: 0.1, ...enough }, t)).toBe('intermittent');
  });
  it('lumpy: ADI > 1.32 · CV² > 0.49', () => {
    expect(classifyPattern({ adi: 5, cv2: 0.8, ...enough }, t)).toBe('lumpy');
  });

  it('임계 경계 — 같으면 낮은 쪽', () => {
    expect(classifyPattern({ adi: 1.32, cv2: 0.49, ...enough }, t)).toBe('smooth');
    expect(classifyPattern({ adi: 1.33, cv2: 0.49, ...enough }, t)).toBe('intermittent');
    expect(classifyPattern({ adi: 1.32, cv2: 0.5, ...enough }, t)).toBe('erratic');
  });

  it('none: 수요 발생일 0', () => {
    expect(classifyPattern({ adi: null, cv2: null, demandEvents: 0, historyDays: 365 }, t)).toBe('none');
    expect(classifyPattern({ adi: null, cv2: null, demandEvents: 0, historyDays: 0 }, t)).toBe('none');
  });

  it('insufficient: 발생일 < min_demand_events 또는 이력 < 30일', () => {
    expect(classifyPattern({ adi: 100, cv2: null, demandEvents: 2, historyDays: 365 }, t)).toBe('insufficient');
    expect(classifyPattern({ adi: 1, cv2: 0, demandEvents: 19, historyDays: MIN_HISTORY_DAYS - 1 }, t)).toBe('insufficient');
    expect(classifyPattern({ adi: 1, cv2: 0, demandEvents: 30, historyDays: MIN_HISTORY_DAYS }, t)).toBe('smooth');
  });

  it('발생일이 충분한데 cv2 가 null 이면(방어) insufficient', () => {
    expect(classifyPattern({ adi: 1, cv2: null, demandEvents: 3, historyDays: 365 }, t)).toBe('insufficient');
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx jest apps/core/src/modules/inventory/replenishment/policy/classification.spec.ts`
Expected: FAIL — `Cannot find module './classification'`

- [ ] **Step 3: 구현**

```ts
// apps/core/src/modules/inventory/replenishment/policy/classification.ts
/**
 * ADI–CV² 사분면 분류 (스펙 §3 · §4.3). 순수 함수 — Nest · drizzle 을 모른다.
 * 임계와 같은 값은 낮은 쪽(smooth 쪽)으로 본다.
 */
export type DemandPattern = 'smooth' | 'intermittent' | 'erratic' | 'lumpy' | 'insufficient' | 'none';

/** 분류 창 안 이력이 이보다 짧으면 통계를 믿지 않는다(스펙 §4.3). 규칙 값이 아니라 상수다. */
export const MIN_HISTORY_DAYS = 30;

export interface ClassificationThresholds {
  adiThreshold: number;
  cv2Threshold: number;
  minDemandEvents: number;
}

export interface ClassificationStats {
  adi: number | null;
  cv2: number | null;
  demandEvents: number;
  historyDays: number;
}

export function classifyPattern(stats: ClassificationStats, t: ClassificationThresholds): DemandPattern {
  if (stats.demandEvents === 0) return 'none';
  if (stats.demandEvents < t.minDemandEvents) return 'insufficient';
  if (stats.historyDays < MIN_HISTORY_DAYS) return 'insufficient';
  if (stats.adi === null || stats.cv2 === null) return 'insufficient';
  const frequent = stats.adi <= t.adiThreshold;
  const stable = stats.cv2 <= t.cv2Threshold;
  if (frequent && stable) return 'smooth';
  if (frequent) return 'erratic';
  if (stable) return 'intermittent';
  return 'lumpy';
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx jest apps/core/src/modules/inventory/replenishment/policy/classification.spec.ts`
Expected: PASS 8 tests.

Run: `npx jest apps/core/src/modules/inventory/replenishment-boundary.arch.spec.ts`
Expected: PASS (새 `policy/` 파일이 자동으로 순수 검사에 들어간다).

- [ ] **Step 5: 커밋**

```bash
git add apps/core/src/modules/inventory/replenishment/policy/classification.ts apps/core/src/modules/inventory/replenishment/policy/classification.spec.ts
git commit -m "feat(core): 수요 패턴 분류 순수 함수 — ADI·CV² 사분면 · insufficient · none (#743 A)

Claude-Session: https://claude.ai/code/session_01Y5Bthz8rSpjhTgrZTzGBED"
```

---

### Task 6: `demand/demand-profile.calculator.ts` — 시계열 → §4.3 통계 (순수)

**Files:**
- Create: `apps/core/src/modules/inventory/replenishment/demand/demand-profile.calculator.ts`
- Test: `apps/core/src/modules/inventory/replenishment/demand/demand-profile.calculator.spec.ts`

**Interfaces:**
- Consumes: `addDays` · `dayDiff` (Task 4), `classifyPattern` · `DemandPattern` · `ClassificationThresholds` (Task 5).
- Produces:
  ```ts
  export interface DemandPoint { date: string; qty: number }
  export interface ProfileWindows { today: string; classificationWindowDays: number; paramWindowDaysFrequent: number; paramWindowDaysSparse: number }
  export interface DemandProfileStats {
    pattern: DemandPattern; adi: number | null; cv2: number | null;
    dailyMean: number; dailyStd: number; dailyMean90: number;
    sizeMean: number | null; sizeStd: number | null; intervalMean: number | null;
    historyDays: number; demandEvents: number;
    classificationFrom: string; classificationTo: string; paramFrom: string; paramTo: string;
  }
  export function computeDemandProfile(points: DemandPoint[], firstDate: string | null, windows: ProfileWindows, thresholds: ClassificationThresholds): DemandProfileStats
  export type DemandGrade = 'A' | 'B' | 'C';
  export function assignGrades(amountBySku: Map<string, number>, cuts: { gradeACut: number; gradeBCut: number }): Map<string, DemandGrade>
  ```
  `firstDate` 는 그 SKU 시계열 **전체**의 최초 날짜(창 밖 포함) — 호출자가 `MIN(demand_date)` 로 준다. `points` 는 창 안 것만 줘도 되고 더 줘도 된다(창 밖은 무시).

- [ ] **Step 1: 실패하는 테스트**

```ts
// apps/core/src/modules/inventory/replenishment/demand/demand-profile.calculator.spec.ts
import { assignGrades, computeDemandProfile, DemandPoint } from './demand-profile.calculator';
import { addDays } from './calendar';

const windows = { today: '2026-09-08', classificationWindowDays: 365, paramWindowDaysFrequent: 90, paramWindowDaysSparse: 365 };
const thresholds = { adiThreshold: 1.32, cv2Threshold: 0.49, minDemandEvents: 3 };

/** from 부터 count 일 연속, i 번째 날 수량 qtyAt(i) */
function daily(from: string, count: number, qtyAt: (i: number) => number): DemandPoint[] {
  return Array.from({ length: count }, (_, i) => ({ date: addDays(from, i), qty: qtyAt(i) }));
}
/** from 부터 every 일 간격으로 count 회 */
function every(from: string, every: number, count: number, qtyAt: (i: number) => number): DemandPoint[] {
  return Array.from({ length: count }, (_, i) => ({ date: addDays(from, i * every), qty: qtyAt(i) }));
}

describe('computeDemandProfile — 창과 분류', () => {
  it('smooth: 6/1 부터 매일 10개 — 최초 날짜 앞은 창에서 제외돼 history 99', () => {
    const p = computeDemandProfile(daily('2026-06-01', 99, () => 10), '2026-06-01', windows, thresholds);
    expect(p.classificationFrom).toBe('2025-09-08');
    expect(p.classificationTo).toBe('2026-09-07');
    expect(p.historyDays).toBe(99);
    expect(p.demandEvents).toBe(99);
    expect(p.adi).toBe(1);
    expect(p.cv2).toBe(0);
    expect(p.pattern).toBe('smooth');
    // 파라미터 창 90 (6/10~9/7), 전부 10 → 평균 10 · 표준편차 0
    expect(p.paramFrom).toBe('2026-06-10');
    expect(p.paramTo).toBe('2026-09-07');
    expect(p.dailyMean).toBe(10);
    expect(p.dailyStd).toBe(0);
    expect(p.dailyMean90).toBe(10);
    expect(p.sizeMean).toBe(10);
    expect(p.sizeStd).toBe(0);
    expect(p.intervalMean).toBe(1);
  });

  it('intermittent: 30일 간격 12회 × 5개 — 파라미터 창은 365, 0인 날 포함 평균', () => {
    const p = computeDemandProfile(every('2025-09-08', 30, 12, () => 5), '2025-09-08', windows, thresholds);
    expect(p.historyDays).toBe(365);
    expect(p.demandEvents).toBe(12);
    expect(p.adi).toBeCloseTo(365 / 12, 6);
    expect(p.cv2).toBe(0);
    expect(p.intervalMean).toBe(30);
    expect(p.pattern).toBe('intermittent');
    expect(p.paramFrom).toBe('2025-09-08');
    expect(p.dailyMean).toBeCloseTo(60 / 365, 6);
    expect(p.dailyStd).toBeCloseTo(0.8928, 3);
    // 90일 창(6/10~9/7)엔 7/5 · 8/4 두 번 → 10/90
    expect(p.dailyMean90).toBeCloseTo(10 / 90, 6);
  });

  it('erratic: 매일 1 · 20 번갈아 100일 — CV² 0.83', () => {
    const p = computeDemandProfile(daily('2026-05-31', 100, (i) => (i % 2 === 0 ? 1 : 20)), '2026-05-31', windows, thresholds);
    expect(p.adi).toBe(1);
    expect(p.sizeMean).toBe(10.5);
    expect(p.cv2).toBeCloseTo(0.8269, 3);
    expect(p.pattern).toBe('erratic');
    expect(p.paramFrom).toBe('2026-06-10');
  });

  it('lumpy: 30일 간격 12회, 1 · 20 번갈아 — CV² 0.89', () => {
    const p = computeDemandProfile(every('2025-09-08', 30, 12, (i) => (i % 2 === 0 ? 1 : 20)), '2025-09-08', windows, thresholds);
    expect(p.adi).toBeCloseTo(365 / 12, 6);
    expect(p.cv2).toBeCloseTo(0.893, 3);
    expect(p.pattern).toBe('lumpy');
    expect(p.paramFrom).toBe('2025-09-08');
  });

  it('insufficient: 발생일 2회', () => {
    const p = computeDemandProfile(
      [{ date: '2026-01-10', qty: 4 }, { date: '2026-05-10', qty: 4 }],
      '2026-01-10',
      windows,
      thresholds,
    );
    expect(p.demandEvents).toBe(2);
    expect(p.pattern).toBe('insufficient');
    expect(p.sizeStd).toBe(0);
    expect(p.paramFrom).toBe('2026-06-10'); // insufficient 는 90 창
    expect(p.dailyMean).toBe(0); // 90 창 안 수요 없음
  });

  it('insufficient: 이력 19일 (신상품)', () => {
    const p = computeDemandProfile(daily('2026-08-20', 19, () => 3), '2026-08-20', windows, thresholds);
    expect(p.historyDays).toBe(19);
    expect(p.demandEvents).toBe(19);
    expect(p.pattern).toBe('insufficient');
    // 파라미터 창도 최초 날짜로 잘린다 — 19일 평균 3
    expect(p.paramFrom).toBe('2026-08-20');
    expect(p.dailyMean).toBe(3);
  });

  it('none: 시계열 없음 → history 0 · 전부 0/null', () => {
    const p = computeDemandProfile([], null, windows, thresholds);
    expect(p).toMatchObject({ pattern: 'none', historyDays: 0, demandEvents: 0, adi: null, cv2: null, dailyMean: 0, dailyStd: 0, dailyMean90: 0, sizeMean: null, sizeStd: null, intervalMean: null });
  });

  it('none: 창 밖(작년 이전)에만 수요가 있던 SKU → history 365 · 발생 0', () => {
    const p = computeDemandProfile([{ date: '2024-01-01', qty: 9 }], '2024-01-01', windows, thresholds);
    expect(p.historyDays).toBe(365);
    expect(p.demandEvents).toBe(0);
    expect(p.pattern).toBe('none');
  });

  it('창 밖 점(오늘 · 창 이전)은 세지 않고, 같은 날 점은 합친다', () => {
    const p = computeDemandProfile(
      [
        ...daily('2026-06-01', 99, () => 10),
        { date: '2026-09-08', qty: 999 }, // 오늘 — 분류 창은 어제까지
        { date: '2025-09-07', qty: 999 }, // 창 이전
        { date: '2026-09-07', qty: 5 }, // 9/7 에 10 + 5
      ],
      '2025-09-07',
      windows,
      thresholds,
    );
    expect(p.historyDays).toBe(365); // 최초 날짜가 창보다 앞이면 창 전체
    expect(p.demandEvents).toBe(99);
    expect(p.sizeMean).toBeCloseTo((98 * 10 + 15) / 99, 9);
  });
});

describe('assignGrades — 매출 누적 80/95', () => {
  it('상위 80% 까지 A, 95% 까지 B, 나머지 C — 경계를 넘는 품목은 앞 등급', () => {
    const grades = assignGrades(new Map([['a', 800], ['b', 150], ['c', 50]]), { gradeACut: 0.8, gradeBCut: 0.95 });
    expect(grades.get('a')).toBe('A');
    expect(grades.get('b')).toBe('B');
    expect(grades.get('c')).toBe('C');
  });
  it('하나가 90% 를 차지해도 그 하나는 A', () => {
    const grades = assignGrades(new Map([['a', 900], ['b', 100]]), { gradeACut: 0.8, gradeBCut: 0.95 });
    expect(grades.get('a')).toBe('A');
    expect(grades.get('b')).toBe('B');
  });
  it('매출 0(또는 전부 0)은 C', () => {
    expect(assignGrades(new Map([['a', 0], ['b', 0]]), { gradeACut: 0.8, gradeBCut: 0.95 })).toEqual(new Map([['a', 'C'], ['b', 'C']]));
    expect(assignGrades(new Map([['a', 10], ['z', 0]]), { gradeACut: 0.8, gradeBCut: 0.95 }).get('z')).toBe('C');
  });
  it('빈 입력', () => {
    expect(assignGrades(new Map(), { gradeACut: 0.8, gradeBCut: 0.95 }).size).toBe(0);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx jest apps/core/src/modules/inventory/replenishment/demand/demand-profile.calculator.spec.ts`
Expected: FAIL — `Cannot find module './demand-profile.calculator'`

- [ ] **Step 3: 구현**

```ts
// apps/core/src/modules/inventory/replenishment/demand/demand-profile.calculator.ts
import { addDays, dayDiff } from './calendar';
import { classifyPattern, ClassificationThresholds, DemandPattern } from '../policy/classification';

/**
 * 시계열 → 프로필 통계 (스펙 §4.3). 순수 함수 — Nest · drizzle 을 모른다.
 *
 * - 분류 창 = 오늘 − classification_window_days ~ 어제. 시계열 최초 날짜보다 앞은 창에서 뺀다.
 * - 파라미터 창은 패턴이 정한다(smooth · erratic · insufficient · none → frequent, intermittent · lumpy → sparse).
 *   같은 최초 날짜 규칙을 적용한다 — 신상품을 "1년 내내 0" 으로 읽지 않기 위해서.
 * - daily_mean_90 은 항상 frequent 창 — 레거시 재주문점(μ_D(90)·μ_L) 전용.
 * - 표준편차는 표본(n−1). n < 2 면 size_std · interval_mean 은 null, daily_std 는 0.
 */
export interface DemandPoint {
  date: string;
  qty: number;
}

export interface ProfileWindows {
  today: string;
  classificationWindowDays: number;
  paramWindowDaysFrequent: number;
  paramWindowDaysSparse: number;
}

export interface DemandProfileStats {
  pattern: DemandPattern;
  adi: number | null;
  cv2: number | null;
  dailyMean: number;
  dailyStd: number;
  dailyMean90: number;
  sizeMean: number | null;
  sizeStd: number | null;
  intervalMean: number | null;
  historyDays: number;
  demandEvents: number;
  classificationFrom: string;
  classificationTo: string;
  paramFrom: string;
  paramTo: string;
}

export type DemandGrade = 'A' | 'B' | 'C';

function mean(xs: number[]): number {
  return xs.reduce((s, x) => s + x, 0) / xs.length;
}

function sampleStd(xs: number[]): number {
  const m = mean(xs);
  const ss = xs.reduce((s, x) => s + (x - m) * (x - m), 0);
  return Math.sqrt(ss / (xs.length - 1));
}

/** [from, to] 창의 모든 날(0 포함) 평균 · 표본 표준편차. from > to 면 0 · 0. */
function windowStats(byDate: Map<string, number>, from: string, to: string): { mean: number; std: number } {
  if (from > to) return { mean: 0, std: 0 };
  const n = dayDiff(from, to) + 1;
  let sum = 0;
  let sumSq = 0;
  for (const [date, qty] of byDate) {
    if (date < from || date > to) continue;
    sum += qty;
    sumSq += qty * qty;
  }
  const avg = sum / n;
  const variance = n >= 2 ? Math.max(0, (sumSq - n * avg * avg) / (n - 1)) : 0;
  return { mean: avg, std: Math.sqrt(variance) };
}

function laterOf(a: string, b: string | null): string {
  return b !== null && b > a ? b : a;
}

export function computeDemandProfile(
  points: DemandPoint[],
  firstDate: string | null,
  windows: ProfileWindows,
  thresholds: ClassificationThresholds,
): DemandProfileStats {
  const classificationTo = addDays(windows.today, -1);
  const classificationFrom = addDays(windows.today, -windows.classificationWindowDays);

  const byDate = new Map<string, number>();
  for (const p of points) byDate.set(p.date, (byDate.get(p.date) ?? 0) + p.qty);

  const effectiveFrom = firstDate === null ? null : laterOf(classificationFrom, firstDate);
  const historyDays =
    effectiveFrom === null || effectiveFrom > classificationTo ? 0 : dayDiff(effectiveFrom, classificationTo) + 1;

  const eventDates = [...byDate.entries()]
    .filter(([date, qty]) => qty > 0 && effectiveFrom !== null && date >= effectiveFrom && date <= classificationTo)
    .map(([date]) => date)
    .sort();
  const sizes = eventDates.map((date) => byDate.get(date) ?? 0);
  const demandEvents = eventDates.length;

  const sizeMean = demandEvents > 0 ? mean(sizes) : null;
  const sizeStd = demandEvents >= 2 ? sampleStd(sizes) : null;
  const cv2 = sizeMean !== null && sizeStd !== null && sizeMean > 0 ? (sizeStd / sizeMean) ** 2 : null;
  const adi = demandEvents > 0 ? historyDays / demandEvents : null;
  const intervalMean =
    demandEvents >= 2 ? dayDiff(eventDates[0], eventDates[demandEvents - 1]) / (demandEvents - 1) : null;

  const pattern = classifyPattern({ adi, cv2, demandEvents, historyDays }, thresholds);

  const paramDays =
    pattern === 'intermittent' || pattern === 'lumpy' ? windows.paramWindowDaysSparse : windows.paramWindowDaysFrequent;
  const paramFrom = laterOf(addDays(windows.today, -paramDays), firstDate);
  const paramTo = classificationTo;
  const param = windowStats(byDate, paramFrom, paramTo);
  const frequentFrom = laterOf(addDays(windows.today, -windows.paramWindowDaysFrequent), firstDate);
  const frequent = windowStats(byDate, frequentFrom, paramTo);

  return {
    pattern,
    adi,
    cv2,
    dailyMean: param.mean,
    dailyStd: param.std,
    dailyMean90: frequent.mean,
    sizeMean,
    sizeStd,
    intervalMean,
    historyDays,
    demandEvents,
    classificationFrom,
    classificationTo,
    paramFrom,
    paramTo,
  };
}

/**
 * 등급 (스펙 §4.3): 매출 내림차순 누적. 품목을 더하기 **전** 누적 비율이 A컷 미만이면 A, B컷 미만이면 B, 아니면 C.
 * 그래서 경계를 넘는 품목은 앞 등급이고, 한 품목이 90% 여도 A 다. 매출 0 은 C.
 */
export function assignGrades(
  amountBySku: Map<string, number>,
  cuts: { gradeACut: number; gradeBCut: number },
): Map<string, DemandGrade> {
  const result = new Map<string, DemandGrade>();
  const sorted = [...amountBySku.entries()].sort((a, b) => b[1] - a[1]);
  const total = sorted.reduce((s, [, amount]) => s + Math.max(0, amount), 0);
  let cumulative = 0;
  for (const [skuId, amount] of sorted) {
    if (amount <= 0 || total <= 0) {
      result.set(skuId, 'C');
      continue;
    }
    const shareBefore = cumulative / total;
    cumulative += amount;
    result.set(skuId, shareBefore < cuts.gradeACut ? 'A' : shareBefore < cuts.gradeBCut ? 'B' : 'C');
  }
  return result;
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx jest apps/core/src/modules/inventory/replenishment/demand/demand-profile.calculator.spec.ts`
Expected: PASS 13 tests. (숫자가 안 맞으면 픽스처의 날짜 수를 먼저 의심한다 — `daily('2026-06-01', 99)` 는 6/1~9/7, `daily('2026-05-31', 100)` 은 5/31~9/7.)

- [ ] **Step 5: 커밋**

```bash
git add apps/core/src/modules/inventory/replenishment/demand/demand-profile.calculator.ts apps/core/src/modules/inventory/replenishment/demand/demand-profile.calculator.spec.ts
git commit -m "feat(core): 수요 프로필 계산기 — 창 · ADI · CV² · 등급 (#743 A)

Claude-Session: https://claude.ai/code/session_01Y5Bthz8rSpjhTgrZTzGBED"
```

---
### Task 7: `DemandSeriesWriter` — core 판매주문 → `sku_demand_daily` 창 재구축

**Files:**
- Create: `apps/core/src/modules/inventory/replenishment/demand/demand-series.writer.ts`
- Test: `apps/core/src/modules/inventory/replenishment/demand/demand-series.writer.integration.spec.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface DemandRebuildResult { from: string | null; to: string; rows: number }
  export class DemandSeriesWriter {
    /** [from, to] 창의 source='core' 행을 지우고 판매주문에서 다시 만든다. coreSince(D0) 가 from 보다 뒤면 from 을 D0 로 자른다. */
    rebuildCoreWindow(input: { from: string; to: string; coreSince: string | null }, tx?: DbTx): Promise<DemandRebuildResult>;
    /** D0(없으면 core 최초 주문일) ~ to 전량. 주문이 하나도 없으면 from=null · rows=0. */
    rebuildCoreFull(input: { to: string; coreSince: string | null }, tx?: DbTx): Promise<DemandRebuildResult>;
  }
  ```
  규칙(스펙 §4.1): 주문 `status ∉ {cancelled, timeout}` · 라인 `status ≠ cancelled` · 물리 라인만(`fulfillment_kind ≠ 'digital'` 이고 `requires_shipping` 이 false 가 아닌 것) · `pending` 포함 · variant → `product_matchings.variant_id` → `product_variant_sku_links`(현재 링크, qty × 링크 quantity) · `amount` = 라인 `total_price` 를 링크 수량 비례 배분 후 반올림 · 달력일은 `(order_date AT TIME ZONE 'Asia/Seoul')::date`. 매칭 없는 variant 는 행이 없다.

- [ ] **Step 1: 실패하는 통합 스펙**

```ts
// apps/core/src/modules/inventory/replenishment/demand/demand-series.writer.integration.spec.ts
import { randomUUID } from 'crypto';
import * as postgres from 'postgres';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { asc, eq, inArray } from 'drizzle-orm';
import { DbService } from '@app/db';
import { wmsSchema, wmsTables, DbTx } from '../../schema/inventory.schema';
import { makeDb, inRollbackTx, seedHolder, seedSku } from '../../../fulfillment/services/__support__';
import { DemandSeriesWriter } from './demand-series.writer';

/**
 * 스펙 §10 「demand-series.writer」: 취소 제외 · 디지털 제외 · 링크 수량 환산 · 창 재계산 멱등 · D0 경계.
 * 실행: COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- demand-series.writer.integration
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('DemandSeriesWriter (DB integration)', () => {
  jest.setTimeout(120_000);
  let client: postgres.Sql;
  let db: PostgresJsDatabase<typeof wmsSchema>;

  beforeAll(() => {
    ({ sql: client, db } = makeDb(DATABASE_URL as string));
  });
  afterAll(async () => {
    await client.end();
  });

  function boundDbService(trx: DbTx): DbService<typeof wmsSchema> {
    return {
      db,
      run: <T>(fn: (t: DbTx) => Promise<T>, tx?: DbTx): Promise<T> => fn(tx ?? trx),
    } as unknown as DbService<typeof wmsSchema>;
  }

  /** variant 하나를 SKU 들에 매칭 (링크 수량 포함) */
  async function seedMatching(trx: DbTx, links: Array<{ skuId: string; quantity: number }>): Promise<string> {
    const variantId = randomUUID();
    const [matching] = await trx
      .insert(wmsTables.productMatchings)
      .values({ variantId, status: 'matched', strategy: 'variant', isResolved: true })
      .returning({ id: wmsTables.productMatchings.id });
    await trx
      .insert(wmsTables.productVariantSkuLinks)
      .values(links.map((l) => ({ productMatchingId: matching.id, skuId: l.skuId, quantity: l.quantity })));
    return variantId;
  }

  async function seedOrder(
    trx: DbTx,
    input: {
      orderedAtUtc: string;
      status?: 'pending' | 'confirmed' | 'cancelled' | 'timeout';
      lines: Array<{
        variantId: string;
        quantity: number;
        totalPrice: number | null;
        status?: 'pending' | 'matched' | 'cancelled';
        fulfillmentKind?: 'physical' | 'digital';
        requiresShipping?: boolean;
      }>;
    },
  ): Promise<string> {
    const [order] = await trx
      .insert(wmsTables.salesOrders)
      .values({
        channelOrderId: `IT-${randomUUID().slice(0, 12)}`,
        salesChannel: 'medusa',
        status: input.status ?? 'confirmed',
        shippingAddress: {},
        orderDate: new Date(input.orderedAtUtc),
      })
      .returning({ id: wmsTables.salesOrders.id });
    await trx.insert(wmsTables.salesOrderLines).values(
      input.lines.map((l) => ({
        salesOrderId: order.id,
        variantId: l.variantId,
        productName: 'IT Product',
        quantity: l.quantity,
        totalPrice: l.totalPrice,
        status: l.status ?? 'pending',
        fulfillmentKind: l.fulfillmentKind ?? null,
        requiresShipping: l.requiresShipping ?? null,
      })),
    );
    return order.id;
  }

  async function readSeries(trx: DbTx, skuIds: string[]) {
    return trx
      .select({
        skuId: wmsTables.skuDemandDaily.skuId,
        demandDate: wmsTables.skuDemandDaily.demandDate,
        qty: wmsTables.skuDemandDaily.qty,
        amount: wmsTables.skuDemandDaily.amount,
        source: wmsTables.skuDemandDaily.source,
      })
      .from(wmsTables.skuDemandDaily)
      .where(inArray(wmsTables.skuDemandDaily.skuId, skuIds))
      .orderBy(asc(wmsTables.skuDemandDaily.skuId), asc(wmsTables.skuDemandDaily.demandDate));
  }

  const WINDOW = { from: '2026-08-25', to: '2026-09-08', coreSince: null };

  it('링크 수량을 곱하고 KST 달력일로 묶는다 — 9/1 12:00 KST 주문 qty 2 × 링크 3 = 6', async () => {
    await inRollbackTx(db, async (trx) => {
      const { holderId } = await seedHolder(trx);
      const { skuId } = await seedSku(trx, holderId);
      const variantId = await seedMatching(trx, [{ skuId, quantity: 3 }]);
      await seedOrder(trx, { orderedAtUtc: '2026-09-01T03:00:00Z', lines: [{ variantId, quantity: 2, totalPrice: 12000 }] });

      const writer = new DemandSeriesWriter(boundDbService(trx));
      const result = await writer.rebuildCoreWindow(WINDOW, trx);
      expect(result).toEqual({ from: '2026-08-25', to: '2026-09-08', rows: 1 });
      expect(await readSeries(trx, [skuId])).toEqual([
        { skuId, demandDate: '2026-09-01', qty: 6, amount: 12000, source: 'core' },
      ]);
    });
  });

  it('UTC 15:30 주문은 KST 다음 날이다', async () => {
    await inRollbackTx(db, async (trx) => {
      const { holderId } = await seedHolder(trx);
      const { skuId } = await seedSku(trx, holderId);
      const variantId = await seedMatching(trx, [{ skuId, quantity: 1 }]);
      await seedOrder(trx, { orderedAtUtc: '2026-09-01T15:30:00Z', lines: [{ variantId, quantity: 1, totalPrice: 1000 }] });
      await new DemandSeriesWriter(boundDbService(trx)).rebuildCoreWindow(WINDOW, trx);
      expect((await readSeries(trx, [skuId])).map((r) => r.demandDate)).toEqual(['2026-09-02']);
    });
  });

  it('취소 주문 · timeout 주문 · 취소 라인 · 디지털 라인은 빠지고 pending 주문은 들어간다', async () => {
    await inRollbackTx(db, async (trx) => {
      const { holderId } = await seedHolder(trx);
      const { skuId } = await seedSku(trx, holderId);
      const variantId = await seedMatching(trx, [{ skuId, quantity: 1 }]);
      await seedOrder(trx, { orderedAtUtc: '2026-09-01T03:00:00Z', status: 'cancelled', lines: [{ variantId, quantity: 100, totalPrice: 1 }] });
      await seedOrder(trx, { orderedAtUtc: '2026-09-01T03:00:00Z', status: 'timeout', lines: [{ variantId, quantity: 100, totalPrice: 1 }] });
      await seedOrder(trx, { orderedAtUtc: '2026-09-01T03:00:00Z', lines: [{ variantId, quantity: 100, totalPrice: 1, status: 'cancelled' }] });
      await seedOrder(trx, { orderedAtUtc: '2026-09-01T03:00:00Z', lines: [{ variantId, quantity: 100, totalPrice: 1, fulfillmentKind: 'digital' }] });
      await seedOrder(trx, { orderedAtUtc: '2026-09-01T03:00:00Z', lines: [{ variantId, quantity: 100, totalPrice: 1, requiresShipping: false }] });
      await seedOrder(trx, { orderedAtUtc: '2026-09-01T03:00:00Z', status: 'pending', lines: [{ variantId, quantity: 4, totalPrice: 4000 }] });
      await new DemandSeriesWriter(boundDbService(trx)).rebuildCoreWindow(WINDOW, trx);
      expect(await readSeries(trx, [skuId])).toEqual([{ skuId, demandDate: '2026-09-01', qty: 4, amount: 4000, source: 'core' }]);
    });
  });

  it('세트 구성은 금액을 링크 수량 비례로 배분한다 — 4000원, 링크 1:3', async () => {
    await inRollbackTx(db, async (trx) => {
      const { holderId } = await seedHolder(trx);
      const a = await seedSku(trx, holderId);
      const b = await seedSku(trx, holderId);
      const variantId = await seedMatching(trx, [
        { skuId: a.skuId, quantity: 1 },
        { skuId: b.skuId, quantity: 3 },
      ]);
      await seedOrder(trx, { orderedAtUtc: '2026-09-01T03:00:00Z', lines: [{ variantId, quantity: 1, totalPrice: 4000 }] });
      await new DemandSeriesWriter(boundDbService(trx)).rebuildCoreWindow(WINDOW, trx);
      const rows = await readSeries(trx, [a.skuId, b.skuId]);
      expect(rows.find((r) => r.skuId === a.skuId)).toMatchObject({ qty: 1, amount: 1000 });
      expect(rows.find((r) => r.skuId === b.skuId)).toMatchObject({ qty: 3, amount: 3000 });
    });
  });

  it('금액이 전부 null 이면 amount 는 null, 하나라도 있으면 있는 것의 합', async () => {
    await inRollbackTx(db, async (trx) => {
      const { holderId } = await seedHolder(trx);
      const { skuId } = await seedSku(trx, holderId);
      const variantId = await seedMatching(trx, [{ skuId, quantity: 1 }]);
      await seedOrder(trx, { orderedAtUtc: '2026-09-01T03:00:00Z', lines: [{ variantId, quantity: 1, totalPrice: null }] });
      await seedOrder(trx, { orderedAtUtc: '2026-09-02T03:00:00Z', lines: [{ variantId, quantity: 1, totalPrice: null }, { variantId, quantity: 1, totalPrice: 700 }] });
      await new DemandSeriesWriter(boundDbService(trx)).rebuildCoreWindow(WINDOW, trx);
      expect(await readSeries(trx, [skuId])).toEqual([
        { skuId, demandDate: '2026-09-01', qty: 1, amount: null, source: 'core' },
        { skuId, demandDate: '2026-09-02', qty: 2, amount: 700, source: 'core' },
      ]);
    });
  });

  it('창 재계산은 멱등이고 늦은 취소를 걷어낸다 — 창 밖 행과 sellmate 행은 건드리지 않는다', async () => {
    await inRollbackTx(db, async (trx) => {
      const { holderId } = await seedHolder(trx);
      const { skuId } = await seedSku(trx, holderId);
      const variantId = await seedMatching(trx, [{ skuId, quantity: 1 }]);
      await trx.insert(wmsTables.skuDemandDaily).values([
        { skuId, demandDate: '2026-08-01', qty: 7, amount: null, source: 'core' }, // 창 밖
        { skuId, demandDate: '2026-08-26', qty: 9, amount: null, source: 'sellmate' }, // 창 안이지만 sellmate
      ]);
      const orderId = await seedOrder(trx, { orderedAtUtc: '2026-09-01T03:00:00Z', lines: [{ variantId, quantity: 2, totalPrice: 2000 }] });
      const writer = new DemandSeriesWriter(boundDbService(trx));

      const first = await writer.rebuildCoreWindow(WINDOW, trx);
      const again = await writer.rebuildCoreWindow(WINDOW, trx);
      expect(first.rows).toBe(1);
      expect(again.rows).toBe(1);
      expect((await readSeries(trx, [skuId])).map((r) => `${r.demandDate}:${r.qty}:${r.source}`)).toEqual([
        '2026-08-01:7:core',
        '2026-08-26:9:sellmate',
        '2026-09-01:2:core',
      ]);

      await trx.update(wmsTables.salesOrders).set({ status: 'cancelled' }).where(eq(wmsTables.salesOrders.id, orderId));
      const afterCancel = await writer.rebuildCoreWindow(WINDOW, trx);
      expect(afterCancel.rows).toBe(0);
      expect((await readSeries(trx, [skuId])).map((r) => r.demandDate)).toEqual(['2026-08-01', '2026-08-26']);
    });
  });

  it('D0 경계 — coreSince 가 from 보다 뒤면 그 이후만 만든다', async () => {
    await inRollbackTx(db, async (trx) => {
      const { holderId } = await seedHolder(trx);
      const { skuId } = await seedSku(trx, holderId);
      const variantId = await seedMatching(trx, [{ skuId, quantity: 1 }]);
      await seedOrder(trx, { orderedAtUtc: '2026-09-01T03:00:00Z', lines: [{ variantId, quantity: 1, totalPrice: 1 }] });
      await seedOrder(trx, { orderedAtUtc: '2026-09-02T03:00:00Z', lines: [{ variantId, quantity: 1, totalPrice: 1 }] });
      const result = await new DemandSeriesWriter(boundDbService(trx)).rebuildCoreWindow({ ...WINDOW, coreSince: '2026-09-02' }, trx);
      expect(result.from).toBe('2026-09-02');
      expect((await readSeries(trx, [skuId])).map((r) => r.demandDate)).toEqual(['2026-09-02']);
    });
  });

  it('매칭 없는 variant 는 행이 없다', async () => {
    await inRollbackTx(db, async (trx) => {
      const { holderId } = await seedHolder(trx);
      const { skuId } = await seedSku(trx, holderId);
      await seedOrder(trx, { orderedAtUtc: '2026-09-01T03:00:00Z', lines: [{ variantId: randomUUID(), quantity: 1, totalPrice: 1 }] });
      await new DemandSeriesWriter(boundDbService(trx)).rebuildCoreWindow(WINDOW, trx);
      expect(await readSeries(trx, [skuId])).toEqual([]);
    });
  });

  it('rebuildCoreFull 은 D0 가 없으면 core 최초 주문일부터', async () => {
    await inRollbackTx(db, async (trx) => {
      const { holderId } = await seedHolder(trx);
      const { skuId } = await seedSku(trx, holderId);
      const variantId = await seedMatching(trx, [{ skuId, quantity: 1 }]);
      await seedOrder(trx, { orderedAtUtc: '2026-03-01T03:00:00Z', lines: [{ variantId, quantity: 1, totalPrice: 1 }] });
      const result = await new DemandSeriesWriter(boundDbService(trx)).rebuildCoreFull({ to: '2026-09-08', coreSince: null }, trx);
      // 로컬 DB 에 더 오래된 주문이 있을 수 있어 from 은 ≤ 2026-03-01 만 확인한다.
      expect(result.from !== null && result.from <= '2026-03-01').toBe(true);
      expect((await readSeries(trx, [skuId])).map((r) => r.demandDate)).toEqual(['2026-03-01']);
    });
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- demand-series.writer.integration`
Expected: FAIL — `Cannot find module './demand-series.writer'`

- [ ] **Step 3: 구현**

```ts
// apps/core/src/modules/inventory/replenishment/demand/demand-series.writer.ts
import { Injectable } from '@nestjs/common';
import { and, eq, gte, lte, sql } from 'drizzle-orm';
import { InjectTypedDb, DbService } from '@app/db';
import { wmsSchema, wmsTables, DbTx, NewSkuDemandDaily } from '../../schema/inventory.schema';

export interface DemandRebuildResult {
  from: string | null;
  to: string;
  rows: number;
}

/** raw sql 결과의 원시 행 (snake_case 별칭 그대로). 집계는 postgres.js 가 string 으로 줄 수 있어 Number() 로 정규화. */
interface DemandAggRow {
  sku_id: string;
  demand_date: string;
  qty: number | string;
  amount: number | string | null;
}

const INSERT_CHUNK = 1000;

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/**
 * core 판매주문 → sku_demand_daily (스펙 §4.1). 창 단위로 source='core' 행을 지우고 다시 만든다 —
 * 늦은 취소(어제 있던 수요가 오늘 0)가 upsert 만으로는 안 걷히기 때문이다. 한 트랜잭션 안이라 원자적.
 *
 * - 달력일은 SQL 에서 (order_date AT TIME ZONE 'Asia/Seoul')::date 로 고정 — 런타임 TZ 무관.
 * - 날짜 바인딩은 'YYYY-MM-DD' 문자열 + ::date 캐스트. Date 객체를 raw sql 에 넣지 않는다(드라이버 TypeError).
 * - variant → SKU 는 현재의 product_matchings + product_variant_sku_links 로 소급한다(스펙 §4.1).
 */
@Injectable()
export class DemandSeriesWriter {
  constructor(@InjectTypedDb<typeof wmsSchema>() private readonly dbService: DbService<typeof wmsSchema>) {}

  async rebuildCoreWindow(
    input: { from: string; to: string; coreSince: string | null },
    tx?: DbTx,
  ): Promise<DemandRebuildResult> {
    const from = input.coreSince !== null && input.coreSince > input.from ? input.coreSince : input.from;
    if (from > input.to) return { from, to: input.to, rows: 0 };
    return this.dbService.run(async (trx) => {
      const rows = await this.aggregate(trx, from, input.to);
      const daily = wmsTables.skuDemandDaily;
      await trx
        .delete(daily)
        .where(and(eq(daily.source, 'core'), gte(daily.demandDate, from), lte(daily.demandDate, input.to)));
      const now = new Date();
      for (const part of chunk(rows, INSERT_CHUNK)) {
        await trx
          .insert(daily)
          .values(part)
          .onConflictDoUpdate({
            target: [daily.skuId, daily.demandDate],
            set: { qty: sql`excluded.qty`, amount: sql`excluded.amount`, source: 'core', updatedAt: now },
          });
      }
      return { from, to: input.to, rows: rows.length };
    }, tx);
  }

  async rebuildCoreFull(input: { to: string; coreSince: string | null }, tx?: DbTx): Promise<DemandRebuildResult> {
    return this.dbService.run(async (trx) => {
      const from = input.coreSince ?? (await this.firstCoreOrderDate(trx));
      if (from === null) return { from: null, to: input.to, rows: 0 };
      return this.rebuildCoreWindow({ from, to: input.to, coreSince: input.coreSince }, trx);
    }, tx);
  }

  private async firstCoreOrderDate(trx: DbTx): Promise<string | null> {
    const [row] = await trx
      .select({ first: sql<string | null>`MIN((${wmsTables.salesOrders.orderDate} AT TIME ZONE 'Asia/Seoul')::date)::text` })
      .from(wmsTables.salesOrders);
    return row?.first ?? null;
  }

  private async aggregate(trx: DbTx, from: string, to: string): Promise<NewSkuDemandDaily[]> {
    const query = sql`
      WITH lines AS (
        SELECT (o.order_date AT TIME ZONE 'Asia/Seoul')::date AS demand_date,
               sol.quantity AS line_qty,
               sol.total_price AS line_amount,
               pm.id AS matching_id
        FROM sales_order_lines sol
        JOIN sales_orders o ON o.id = sol.sales_order_id
        JOIN product_matchings pm ON pm.variant_id = sol.variant_id
        WHERE o.status NOT IN ('cancelled', 'timeout')
          AND sol.status <> 'cancelled'
          AND COALESCE(sol.fulfillment_kind, 'physical') <> 'digital'
          AND COALESCE(sol.requires_shipping, true)
          AND (o.order_date AT TIME ZONE 'Asia/Seoul')::date BETWEEN ${from}::date AND ${to}::date
      ),
      links AS (
        SELECT product_matching_id, sku_id, quantity,
               SUM(quantity) OVER (PARTITION BY product_matching_id) AS total_qty
        FROM product_variant_sku_links
      ),
      exploded AS (
        SELECT k.sku_id, l.demand_date,
               l.line_qty * k.quantity AS qty,
               CASE WHEN l.line_amount IS NULL THEN NULL
                    ELSE l.line_amount::numeric * k.quantity / k.total_qty END AS amount
        FROM lines l
        JOIN links k ON k.product_matching_id = l.matching_id
      )
      SELECT sku_id,
             demand_date::text AS demand_date,
             SUM(qty)::int AS qty,
             CASE WHEN COUNT(amount) = 0 THEN NULL ELSE ROUND(SUM(amount))::bigint END AS amount
      FROM exploded
      GROUP BY sku_id, demand_date
    `;
    const result = await trx.execute(query);
    // execute() 원시 결과 타이핑 — ledger-reconciliation.service.ts:120 과 같은 문서화된 캐스트.
    const raw = result as unknown as DemandAggRow[];
    return raw.map((r) => ({
      skuId: r.sku_id,
      demandDate: r.demand_date,
      qty: Number(r.qty),
      amount: r.amount === null ? null : Number(r.amount),
      source: 'core' as const,
    }));
  }
}
```

- [ ] **Step 4: 통과 확인**

Run: `COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- demand-series.writer.integration`
Expected: PASS 9 tests.

- [ ] **Step 5: 커밋**

```bash
git add apps/core/src/modules/inventory/replenishment/demand/demand-series.writer.ts apps/core/src/modules/inventory/replenishment/demand/demand-series.writer.integration.spec.ts
git commit -m "feat(core): 수요 시계열 writer — core 판매주문을 KST 달력일 · 현재 링크로 환산해 창 재구축 (#743 A)

Claude-Session: https://claude.ai/code/session_01Y5Bthz8rSpjhTgrZTzGBED"
```

---

### Task 8: `DemandProfileRefresher` — 전 SKU 프로필 upsert

**Files:**
- Create: `apps/core/src/modules/inventory/replenishment/demand/demand-profile.refresher.ts`
- Test: `apps/core/src/modules/inventory/replenishment/demand/demand-profile.refresher.integration.spec.ts`

**Interfaces:**
- Consumes: `ReplenishmentSettingsReader.read` (Task 3), `computeDemandProfile` · `assignGrades` (Task 6), `addDays` (Task 4).
- Produces:
  ```ts
  export interface ProfileRefreshResult { skus: number; byPattern: Record<DemandPattern, number> }
  export class DemandProfileRefresher {
    constructor(dbService, settingsReader: ReplenishmentSettingsReader);
    /** is_deleted=false 인 전 SKU 의 프로필을 다시 계산해 upsert. 삭제된 SKU 의 프로필은 지운다. */
    refreshAll(input: { today: string }, tx?: DbTx): Promise<ProfileRefreshResult>;
  }
  ```

- [ ] **Step 1: 실패하는 통합 스펙**

```ts
// apps/core/src/modules/inventory/replenishment/demand/demand-profile.refresher.integration.spec.ts
import * as postgres from 'postgres';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq, inArray } from 'drizzle-orm';
import { DbService } from '@app/db';
import { wmsSchema, wmsTables, DbTx } from '../../schema/inventory.schema';
import { makeDb, inRollbackTx, seedHolder, seedSku } from '../../../fulfillment/services/__support__';
import { ReplenishmentSettingsReader, SETTINGS_KEY } from './replenishment-settings.reader';
import { DemandProfileRefresher } from './demand-profile.refresher';
import { addDays } from './calendar';

/**
 * 실행: COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- demand-profile.refresher.integration
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('DemandProfileRefresher (DB integration)', () => {
  jest.setTimeout(120_000);
  let client: postgres.Sql;
  let db: PostgresJsDatabase<typeof wmsSchema>;

  beforeAll(() => {
    ({ sql: client, db } = makeDb(DATABASE_URL as string));
  });
  afterAll(async () => {
    await client.end();
  });

  function boundDbService(trx: DbTx): DbService<typeof wmsSchema> {
    return {
      db,
      run: <T>(fn: (t: DbTx) => Promise<T>, tx?: DbTx): Promise<T> => fn(tx ?? trx),
    } as unknown as DbService<typeof wmsSchema>;
  }

  const TODAY = '2026-09-08';

  async function ensureSettings(trx: DbTx) {
    await trx.delete(wmsTables.replenishmentSettings).where(eq(wmsTables.replenishmentSettings.key, SETTINGS_KEY));
    await trx.insert(wmsTables.replenishmentSettings).values({ key: SETTINGS_KEY });
  }

  async function seedDaily(trx: DbTx, skuId: string, from: string, count: number, qty: number, amount: number | null) {
    await trx.insert(wmsTables.skuDemandDaily).values(
      Array.from({ length: count }, (_, i) => ({ skuId, demandDate: addDays(from, i), qty, amount, source: 'core' as const })),
    );
  }

  function build(trx: DbTx) {
    const dbService = boundDbService(trx);
    return new DemandProfileRefresher(dbService, new ReplenishmentSettingsReader(dbService));
  }

  async function readProfiles(trx: DbTx, skuIds: string[]) {
    return trx.select().from(wmsTables.skuDemandProfiles).where(inArray(wmsTables.skuDemandProfiles.skuId, skuIds));
  }

  it('매일 파는 SKU 는 smooth · 등급 A, 시계열 없는 SKU 는 none · C', async () => {
    await inRollbackTx(db, async (trx) => {
      await ensureSettings(trx);
      const { holderId } = await seedHolder(trx);
      const steady = await seedSku(trx, holderId);
      const silent = await seedSku(trx, holderId);
      await seedDaily(trx, steady.skuId, '2026-06-01', 99, 10, 10000);

      const result = await build(trx).refreshAll({ today: TODAY }, trx);
      expect(result.skus).toBeGreaterThanOrEqual(2);

      const rows = await readProfiles(trx, [steady.skuId, silent.skuId]);
      const s = rows.find((r) => r.skuId === steady.skuId);
      const q = rows.find((r) => r.skuId === silent.skuId);
      expect(s).toMatchObject({ pattern: 'smooth', grade: 'A', historyDays: 99, demandEvents: 99, dailyMean: 10, dailyStd: 0, dailyMean90: 10, classificationFrom: '2025-09-08', classificationTo: '2026-09-07', paramFrom: '2026-06-10', paramTo: '2026-09-07' });
      expect(q).toMatchObject({ pattern: 'none', grade: 'C', historyDays: 0, demandEvents: 0, dailyMean: 0, adi: null, cv2: null });
    });
  });

  it('두 번 돌려도 같다(upsert) 고 computed_at 은 갱신된다', async () => {
    await inRollbackTx(db, async (trx) => {
      await ensureSettings(trx);
      const { holderId } = await seedHolder(trx);
      const { skuId } = await seedSku(trx, holderId);
      await seedDaily(trx, skuId, '2026-06-01', 99, 10, 10000);
      const refresher = build(trx);
      await refresher.refreshAll({ today: TODAY }, trx);
      const [first] = await readProfiles(trx, [skuId]);
      await new Promise((r) => setTimeout(r, 5));
      await refresher.refreshAll({ today: TODAY }, trx);
      const [second] = await readProfiles(trx, [skuId]);
      expect(second.pattern).toBe(first.pattern);
      expect(second.dailyMean).toBe(first.dailyMean);
      expect(second.computedAt.getTime()).toBeGreaterThan(first.computedAt.getTime());
      const all = await readProfiles(trx, [skuId]);
      expect(all).toHaveLength(1);
    });
  });

  it('등급은 분류 창 매출 누적으로 — 매출이 없는 SKU 는 C', async () => {
    await inRollbackTx(db, async (trx) => {
      await ensureSettings(trx);
      const { holderId } = await seedHolder(trx);
      const rich = await seedSku(trx, holderId);
      const poor = await seedSku(trx, holderId);
      await seedDaily(trx, rich.skuId, '2026-06-01', 99, 10, 1_000_000_000); // 로컬 DB 의 다른 SKU 를 압도
      await seedDaily(trx, poor.skuId, '2026-06-01', 99, 10, null);
      await build(trx).refreshAll({ today: TODAY }, trx);
      const rows = await readProfiles(trx, [rich.skuId, poor.skuId]);
      expect(rows.find((r) => r.skuId === rich.skuId)?.grade).toBe('A');
      expect(rows.find((r) => r.skuId === poor.skuId)?.grade).toBe('C');
    });
  });

  it('삭제된 SKU 의 프로필은 지우고 다시 만들지 않는다', async () => {
    await inRollbackTx(db, async (trx) => {
      await ensureSettings(trx);
      const { holderId } = await seedHolder(trx);
      const { skuId } = await seedSku(trx, holderId);
      const refresher = build(trx);
      await refresher.refreshAll({ today: TODAY }, trx);
      expect(await readProfiles(trx, [skuId])).toHaveLength(1);
      await trx.update(wmsTables.skus).set({ isDeleted: true }).where(eq(wmsTables.skus.id, skuId));
      await refresher.refreshAll({ today: TODAY }, trx);
      expect(await readProfiles(trx, [skuId])).toHaveLength(0);
    });
  });

  it('설정의 창 길이를 따른다 — classification 30일이면 6/1 시작 SKU 의 history 는 30', async () => {
    await inRollbackTx(db, async (trx) => {
      await ensureSettings(trx);
      await trx.update(wmsTables.replenishmentSettings).set({ classificationWindowDays: 30 }).where(eq(wmsTables.replenishmentSettings.key, SETTINGS_KEY));
      const { holderId } = await seedHolder(trx);
      const { skuId } = await seedSku(trx, holderId);
      await seedDaily(trx, skuId, '2026-06-01', 99, 10, 100);
      await build(trx).refreshAll({ today: TODAY }, trx);
      const [row] = await readProfiles(trx, [skuId]);
      expect(row).toMatchObject({ classificationFrom: '2026-08-09', historyDays: 30, demandEvents: 30 });
    });
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- demand-profile.refresher.integration`
Expected: FAIL — `Cannot find module './demand-profile.refresher'`

- [ ] **Step 3: 구현**

```ts
// apps/core/src/modules/inventory/replenishment/demand/demand-profile.refresher.ts
import { Injectable } from '@nestjs/common';
import { and, asc, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import { InjectTypedDb, DbService } from '@app/db';
import { wmsSchema, wmsTables, DbTx, NewSkuDemandProfile } from '../../schema/inventory.schema';
import { ReplenishmentSettingsReader } from './replenishment-settings.reader';
import { assignGrades, computeDemandProfile, DemandPoint } from './demand-profile.calculator';
import { addDays } from './calendar';
import { DemandPattern } from '../policy/classification';

export interface ProfileRefreshResult {
  skus: number;
  byPattern: Record<DemandPattern, number>;
}

const SKU_CHUNK = 500;

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/**
 * 야간 전 SKU 프로필 재계산 (스펙 §4.3). 통계 사실만 저장 — 안전재고 · 재주문점은 B 가 읽는 시점에 계산한다(D5).
 * SKU 500 개씩 시계열을 읽어 메모리를 묶고, 등급은 분류 창 매출 합 한 번으로 전 SKU 에 매긴다.
 */
@Injectable()
export class DemandProfileRefresher {
  constructor(
    @InjectTypedDb<typeof wmsSchema>() private readonly dbService: DbService<typeof wmsSchema>,
    private readonly settingsReader: ReplenishmentSettingsReader,
  ) {}

  async refreshAll(input: { today: string }, tx?: DbTx): Promise<ProfileRefreshResult> {
    return this.dbService.run(async (trx) => {
      const settings = await this.settingsReader.read(trx);
      const windows = {
        today: input.today,
        classificationWindowDays: settings.classificationWindowDays,
        paramWindowDaysFrequent: settings.paramWindowDaysFrequent,
        paramWindowDaysSparse: settings.paramWindowDaysSparse,
      };
      const thresholds = {
        adiThreshold: settings.adiThreshold,
        cv2Threshold: settings.cv2Threshold,
        minDemandEvents: settings.minDemandEvents,
      };
      const classificationTo = addDays(input.today, -1);
      const classificationFrom = addDays(input.today, -settings.classificationWindowDays);
      const readFrom = addDays(input.today, -Math.max(settings.classificationWindowDays, settings.paramWindowDaysSparse));

      const skuIds = (
        await trx.select({ id: wmsTables.skus.id }).from(wmsTables.skus).where(eq(wmsTables.skus.isDeleted, false))
      ).map((r) => r.id);

      const firstDates = await this.readFirstDates(trx);
      const amounts = await this.readWindowAmounts(trx, classificationFrom, classificationTo);
      const amountBySku = new Map(skuIds.map((id) => [id, amounts.get(id) ?? 0]));
      const grades = assignGrades(amountBySku, { gradeACut: settings.gradeACut, gradeBCut: settings.gradeBCut });

      const byPattern: Record<DemandPattern, number> = { smooth: 0, intermittent: 0, erratic: 0, lumpy: 0, insufficient: 0, none: 0 };
      const computedAt = new Date();

      for (const ids of chunk(skuIds, SKU_CHUNK)) {
        const points = await this.readPoints(trx, ids, readFrom, classificationTo);
        const rows: NewSkuDemandProfile[] = ids.map((skuId) => {
          const stats = computeDemandProfile(points.get(skuId) ?? [], firstDates.get(skuId) ?? null, windows, thresholds);
          byPattern[stats.pattern] += 1;
          return {
            skuId,
            pattern: stats.pattern,
            grade: grades.get(skuId) ?? 'C',
            adi: stats.adi,
            cv2: stats.cv2,
            dailyMean: stats.dailyMean,
            dailyStd: stats.dailyStd,
            dailyMean90: stats.dailyMean90,
            sizeMean: stats.sizeMean,
            sizeStd: stats.sizeStd,
            intervalMean: stats.intervalMean,
            historyDays: stats.historyDays,
            demandEvents: stats.demandEvents,
            classificationFrom: stats.classificationFrom,
            classificationTo: stats.classificationTo,
            paramFrom: stats.paramFrom,
            paramTo: stats.paramTo,
            computedAt,
          };
        });
        await this.upsertProfiles(trx, rows, computedAt);
      }

      await trx
        .delete(wmsTables.skuDemandProfiles)
        .where(
          inArray(
            wmsTables.skuDemandProfiles.skuId,
            trx.select({ id: wmsTables.skus.id }).from(wmsTables.skus).where(eq(wmsTables.skus.isDeleted, true)),
          ),
        );

      return { skus: skuIds.length, byPattern };
    }, tx);
  }

  private async readFirstDates(trx: DbTx): Promise<Map<string, string>> {
    const daily = wmsTables.skuDemandDaily;
    const rows = await trx
      .select({ skuId: daily.skuId, first: sql<string>`MIN(${daily.demandDate})::text` })
      .from(daily)
      .groupBy(daily.skuId);
    return new Map(rows.map((r) => [r.skuId, r.first]));
  }

  private async readWindowAmounts(trx: DbTx, from: string, to: string): Promise<Map<string, number>> {
    const daily = wmsTables.skuDemandDaily;
    const rows = await trx
      .select({ skuId: daily.skuId, amount: sql<number | string>`COALESCE(SUM(${daily.amount}), 0)::bigint` })
      .from(daily)
      .where(and(gte(daily.demandDate, from), lte(daily.demandDate, to)))
      .groupBy(daily.skuId);
    return new Map(rows.map((r) => [r.skuId, Number(r.amount)]));
  }

  private async readPoints(trx: DbTx, skuIds: string[], from: string, to: string): Promise<Map<string, DemandPoint[]>> {
    const daily = wmsTables.skuDemandDaily;
    const rows = await trx
      .select({ skuId: daily.skuId, date: daily.demandDate, qty: daily.qty })
      .from(daily)
      .where(and(inArray(daily.skuId, skuIds), gte(daily.demandDate, from), lte(daily.demandDate, to)))
      .orderBy(asc(daily.skuId), asc(daily.demandDate));
    const result = new Map<string, DemandPoint[]>();
    for (const row of rows) {
      const list = result.get(row.skuId) ?? [];
      list.push({ date: row.date, qty: row.qty });
      result.set(row.skuId, list);
    }
    return result;
  }

  private async upsertProfiles(trx: DbTx, rows: NewSkuDemandProfile[], computedAt: Date): Promise<void> {
    if (rows.length === 0) return;
    const p = wmsTables.skuDemandProfiles;
    await trx
      .insert(p)
      .values(rows)
      .onConflictDoUpdate({
        target: p.skuId,
        set: {
          pattern: sql`excluded.pattern`,
          grade: sql`excluded.grade`,
          adi: sql`excluded.adi`,
          cv2: sql`excluded.cv2`,
          dailyMean: sql`excluded.daily_mean`,
          dailyStd: sql`excluded.daily_std`,
          dailyMean90: sql`excluded.daily_mean_90`,
          sizeMean: sql`excluded.size_mean`,
          sizeStd: sql`excluded.size_std`,
          intervalMean: sql`excluded.interval_mean`,
          historyDays: sql`excluded.history_days`,
          demandEvents: sql`excluded.demand_events`,
          classificationFrom: sql`excluded.classification_from`,
          classificationTo: sql`excluded.classification_to`,
          paramFrom: sql`excluded.param_from`,
          paramTo: sql`excluded.param_to`,
          computedAt,
          updatedAt: computedAt,
        },
      });
  }
}
```

- [ ] **Step 4: 통과 확인**

Run: `COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- demand-profile.refresher.integration`
Expected: PASS 5 tests. (등급 A 검증이 흔들리면 로컬 DB 에 `sku_demand_daily` 잔재가 있는지 본다 — 롤백 스펙이라 남지 않아야 정상이다.)

- [ ] **Step 5: 커밋**

```bash
git add apps/core/src/modules/inventory/replenishment/demand/demand-profile.refresher.ts apps/core/src/modules/inventory/replenishment/demand/demand-profile.refresher.integration.spec.ts
git commit -m "feat(core): 수요 프로필 refresher — 전 SKU 통계 upsert · 등급 · 삭제 SKU 정리 (#743 A)

Claude-Session: https://claude.ai/code/session_01Y5Bthz8rSpjhTgrZTzGBED"
```

---
### Task 9: `LeadTimeProfileRefresher` — L1 · L2 관측 → 프로필

**Files:**
- Create: `apps/core/src/modules/inventory/replenishment/demand/lead-time-profile.refresher.ts`
- Test: `apps/core/src/modules/inventory/replenishment/demand/lead-time-profile.refresher.integration.spec.ts`

**Interfaces:**
- Consumes: `ReplenishmentSettingsReader.read` (Task 3), `addDays` (Task 4).
- Produces:
  ```ts
  export interface LeadTimeRefreshResult { suppliers: number; routes: number; windowFrom: string; windowTo: string }
  export class LeadTimeProfileRefresher {
    constructor(dbService, settingsReader: ReplenishmentSettingsReader);
    /** 최근 lead_time_window_days 창의 관측으로 두 프로필 표를 통째로 다시 만든다(delete + insert, 한 트랜잭션). */
    refreshAll(input: { today: string }, tx?: DbTx): Promise<LeadTimeRefreshResult>;
  }
  ```
  관측 정의(스펙 §4.4): L1 = `purchase_order_lines.ordered_at`(status `ordered`) → 같은 PO 의 계획(`inbound_plans.linked_purchase_order_id`) 안 같은 `sku_id` 계획 아이템의 **첫** posted 입고 `occurred_at`. L2 = `transfer_orders.shipped_at` → 그 지시서의 **첫** `transfer_order_receipts.received_at`. 일수는 실수. 음수 관측(시계 역전)은 버린다. n < 2 면 `std_days` null.

- [ ] **Step 1: 실패하는 통합 스펙**

```ts
// apps/core/src/modules/inventory/replenishment/demand/lead-time-profile.refresher.integration.spec.ts
import { randomUUID } from 'crypto';
import * as postgres from 'postgres';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq, and } from 'drizzle-orm';
import { DbService } from '@app/db';
import { wmsSchema, wmsTables, DbTx } from '../../schema/inventory.schema';
import { makeDb, inRollbackTx, seedHolder, seedSku, seedWarehouseWithZone } from '../../../fulfillment/services/__support__';
import { ReplenishmentSettingsReader, SETTINGS_KEY } from './replenishment-settings.reader';
import { LeadTimeProfileRefresher } from './lead-time-profile.refresher';

/**
 * 스펙 §10 「lead-time-profile.refresher」: 발주 라인 → 첫 입고 · 지시서 선적 → 첫 수령 · n<2 면 std null.
 * 실행: COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- lead-time-profile.refresher.integration
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('LeadTimeProfileRefresher (DB integration)', () => {
  jest.setTimeout(120_000);
  let client: postgres.Sql;
  let db: PostgresJsDatabase<typeof wmsSchema>;

  beforeAll(() => {
    ({ sql: client, db } = makeDb(DATABASE_URL as string));
  });
  afterAll(async () => {
    await client.end();
  });

  function boundDbService(trx: DbTx): DbService<typeof wmsSchema> {
    return {
      db,
      run: <T>(fn: (t: DbTx) => Promise<T>, tx?: DbTx): Promise<T> => fn(tx ?? trx),
    } as unknown as DbService<typeof wmsSchema>;
  }

  const TODAY = '2026-09-08';

  async function ensureSettings(trx: DbTx) {
    await trx.delete(wmsTables.replenishmentSettings).where(eq(wmsTables.replenishmentSettings.key, SETTINGS_KEY));
    await trx.insert(wmsTables.replenishmentSettings).values({ key: SETTINGS_KEY });
  }

  async function seedSupplier(trx: DbTx, defaultWarehouseId: string): Promise<string> {
    const [s] = await trx
      .insert(wmsTables.suppliers)
      .values({ name: `it-supplier-${randomUUID().slice(0, 8)}`, defaultWarehouseId })
      .returning({ id: wmsTables.suppliers.id });
    return s.id;
  }

  /** ordered 발주 라인 + 연결 계획 아이템 + posted 입고들. 반환: 없음 (관측 하나) */
  async function seedOrderedAndReceived(
    trx: DbTx,
    input: { supplierId: string; skuId: string; warehouseId: string; locationId: string; orderedAt: string; receivedAts: string[] },
  ) {
    const [po] = await trx
      .insert(wmsTables.purchaseOrders)
      .values({
        type: 'foreign',
        supplierId: input.supplierId,
        status: 'confirmed',
        sourceWarehouseId: input.warehouseId,
        destinationWarehouseId: input.warehouseId,
      })
      .returning({ id: wmsTables.purchaseOrders.id });
    await trx.insert(wmsTables.purchaseOrderLines).values({
      poId: po.id,
      skuId: input.skuId,
      quantity: 10,
      status: 'ordered',
      orderedQty: 10,
      orderedAt: new Date(input.orderedAt),
    });
    const [plan] = await trx
      .insert(wmsTables.inboundPlans)
      .values({
        planType: 'destination',
        status: 'pending',
        warehouseId: input.warehouseId,
        destinationWarehouseId: input.warehouseId,
        linkedPurchaseOrderId: po.id,
      })
      .returning({ id: wmsTables.inboundPlans.id });
    const [item] = await trx
      .insert(wmsTables.inboundPlanItems)
      .values({ planId: plan.id, skuId: input.skuId, expectedQty: 10, receivedQty: 0, status: 'pending' })
      .returning({ id: wmsTables.inboundPlanItems.id });
    for (const at of input.receivedAts) {
      const [receipt] = await trx
        .insert(wmsTables.inboundReceipts)
        .values({ method: 'planned', warehouseId: input.warehouseId, locationId: input.locationId, occurredAt: new Date(at), totalQuantity: 5 })
        .returning({ id: wmsTables.inboundReceipts.id });
      await trx
        .insert(wmsTables.inboundReceiptLines)
        .values({ receiptId: receipt.id, skuId: input.skuId, quantity: 5, planItemId: item.id });
    }
  }

  async function seedShippedAndReceived(
    trx: DbTx,
    input: { fromWarehouseId: string; toWarehouseId: string; shippedAt: string; receivedAts: string[] },
  ) {
    const [order] = await trx
      .insert(wmsTables.transferOrders)
      .values({
        fromWarehouseId: input.fromWarehouseId,
        toWarehouseId: input.toWarehouseId,
        status: 'partially_received',
        shippedAt: new Date(input.shippedAt),
      })
      .returning({ id: wmsTables.transferOrders.id });
    for (const at of input.receivedAts) {
      await trx.insert(wmsTables.transferOrderReceipts).values({ transferOrderId: order.id, receivedAt: new Date(at) });
    }
  }

  function build(trx: DbTx) {
    const dbService = boundDbService(trx);
    return new LeadTimeProfileRefresher(dbService, new ReplenishmentSettingsReader(dbService));
  }

  it('L1: 발주 라인 → 첫 입고. 관측 2건이면 평균 · 표본 표준편차, 1건이면 std null, 창 밖은 제외', async () => {
    await inRollbackTx(db, async (trx) => {
      await ensureSettings(trx);
      const { warehouseId, locationId } = await seedWarehouseWithZone(trx);
      const { holderId } = await seedHolder(trx);
      const { skuId } = await seedSku(trx, holderId);
      const twoObs = await seedSupplier(trx, warehouseId);
      const oneObs = await seedSupplier(trx, warehouseId);
      const stale = await seedSupplier(trx, warehouseId);

      // 10일 (두 번째 입고 8/20 은 첫 입고가 아니라 무시)
      await seedOrderedAndReceived(trx, { supplierId: twoObs, skuId, warehouseId, locationId, orderedAt: '2026-08-01T00:00:00Z', receivedAts: ['2026-08-11T00:00:00Z', '2026-08-20T00:00:00Z'] });
      // 20일
      await seedOrderedAndReceived(trx, { supplierId: twoObs, skuId, warehouseId, locationId, orderedAt: '2026-08-05T00:00:00Z', receivedAts: ['2026-08-25T00:00:00Z'] });
      // 1건
      await seedOrderedAndReceived(trx, { supplierId: oneObs, skuId, warehouseId, locationId, orderedAt: '2026-08-01T00:00:00Z', receivedAts: ['2026-08-13T12:00:00Z'] });
      // 창(365일) 밖
      await seedOrderedAndReceived(trx, { supplierId: stale, skuId, warehouseId, locationId, orderedAt: '2025-01-01T00:00:00Z', receivedAts: ['2025-01-10T00:00:00Z'] });

      const result = await build(trx).refreshAll({ today: TODAY }, trx);
      expect(result.windowFrom).toBe('2025-09-08');
      expect(result.windowTo).toBe(TODAY);
      expect(result.suppliers).toBeGreaterThanOrEqual(2);

      const rows = await trx.select().from(wmsTables.supplierLeadTimeProfiles);
      const two = rows.find((r) => r.supplierId === twoObs);
      const one = rows.find((r) => r.supplierId === oneObs);
      expect(two).toMatchObject({ observations: 2, meanDays: 15, windowFrom: '2025-09-08', windowTo: TODAY });
      expect(two?.stdDays).toBeCloseTo(Math.SQRT2 * 5, 6); // std([10, 20]) = 7.0711
      expect(one).toMatchObject({ observations: 1, meanDays: 12.5, stdDays: null });
      expect(rows.find((r) => r.supplierId === stale)).toBeUndefined();
    });
  });

  it('L2: 지시서 선적 → 첫 수령, (from, to) 쌍별', async () => {
    await inRollbackTx(db, async (trx) => {
      await ensureSettings(trx);
      const a = await seedWarehouseWithZone(trx);
      const b = await seedWarehouseWithZone(trx);
      // 7일 (8/15 수령은 첫 수령이 아님) · 9일
      await seedShippedAndReceived(trx, { fromWarehouseId: a.warehouseId, toWarehouseId: b.warehouseId, shippedAt: '2026-08-01T00:00:00Z', receivedAts: ['2026-08-08T00:00:00Z', '2026-08-15T00:00:00Z'] });
      await seedShippedAndReceived(trx, { fromWarehouseId: a.warehouseId, toWarehouseId: b.warehouseId, shippedAt: '2026-08-10T00:00:00Z', receivedAts: ['2026-08-19T00:00:00Z'] });
      // 반대 방향 1건
      await seedShippedAndReceived(trx, { fromWarehouseId: b.warehouseId, toWarehouseId: a.warehouseId, shippedAt: '2026-08-10T00:00:00Z', receivedAts: ['2026-08-13T00:00:00Z'] });

      await build(trx).refreshAll({ today: TODAY }, trx);
      const rows = await trx
        .select()
        .from(wmsTables.routeLeadTimeProfiles)
        .where(and(eq(wmsTables.routeLeadTimeProfiles.fromWarehouseId, a.warehouseId), eq(wmsTables.routeLeadTimeProfiles.toWarehouseId, b.warehouseId)));
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ observations: 2, meanDays: 8 });
      expect(rows[0].stdDays).toBeCloseTo(Math.SQRT2, 6);
      const reverse = await trx
        .select()
        .from(wmsTables.routeLeadTimeProfiles)
        .where(and(eq(wmsTables.routeLeadTimeProfiles.fromWarehouseId, b.warehouseId), eq(wmsTables.routeLeadTimeProfiles.toWarehouseId, a.warehouseId)));
      expect(reverse[0]).toMatchObject({ observations: 1, meanDays: 3, stdDays: null });
    });
  });

  it('두 번 돌리면 이전 행이 남지 않는다(통째로 다시 만든다)', async () => {
    await inRollbackTx(db, async (trx) => {
      await ensureSettings(trx);
      const { warehouseId, locationId } = await seedWarehouseWithZone(trx);
      const { holderId } = await seedHolder(trx);
      const { skuId } = await seedSku(trx, holderId);
      const supplierId = await seedSupplier(trx, warehouseId);
      await seedOrderedAndReceived(trx, { supplierId, skuId, warehouseId, locationId, orderedAt: '2026-08-01T00:00:00Z', receivedAts: ['2026-08-11T00:00:00Z'] });
      const refresher = build(trx);
      await refresher.refreshAll({ today: TODAY }, trx);
      await refresher.refreshAll({ today: TODAY }, trx);
      const rows = await trx.select().from(wmsTables.supplierLeadTimeProfiles).where(eq(wmsTables.supplierLeadTimeProfiles.supplierId, supplierId));
      expect(rows).toHaveLength(1);
    });
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- lead-time-profile.refresher.integration`
Expected: FAIL — `Cannot find module './lead-time-profile.refresher'`

- [ ] **Step 3: 구현**

```ts
// apps/core/src/modules/inventory/replenishment/demand/lead-time-profile.refresher.ts
import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { InjectTypedDb, DbService } from '@app/db';
import { wmsSchema, wmsTables, DbTx } from '../../schema/inventory.schema';
import { ReplenishmentSettingsReader } from './replenishment-settings.reader';
import { addDays } from './calendar';

export interface LeadTimeRefreshResult {
  suppliers: number;
  routes: number;
  windowFrom: string;
  windowTo: string;
}

/** raw sql 결과의 원시 행. 집계는 postgres.js 가 string 으로 줄 수 있어 Number() 로 정규화. */
interface SupplierObsRow {
  supplier_id: string;
  n: number | string;
  mean_days: number | string;
  std_days: number | string | null;
}
interface RouteObsRow {
  from_warehouse_id: string;
  to_warehouse_id: string;
  n: number | string;
  mean_days: number | string;
  std_days: number | string | null;
}

/**
 * 리드타임 프로필 (스펙 §4.4). 관측 창은 최근 lead_time_window_days. 두 표를 통째로 다시 만든다 —
 * 프로필은 파생값이라 delete + insert 가 upsert 와 같고, 관측이 사라진 공급사 행이 남지 않는다.
 * 날짜 바인딩은 'YYYY-MM-DD' 문자열 + ::date (Date 객체 raw 바인딩 금지).
 */
@Injectable()
export class LeadTimeProfileRefresher {
  constructor(
    @InjectTypedDb<typeof wmsSchema>() private readonly dbService: DbService<typeof wmsSchema>,
    private readonly settingsReader: ReplenishmentSettingsReader,
  ) {}

  async refreshAll(input: { today: string }, tx?: DbTx): Promise<LeadTimeRefreshResult> {
    return this.dbService.run(async (trx) => {
      const settings = await this.settingsReader.read(trx);
      const windowTo = input.today;
      const windowFrom = addDays(input.today, -settings.leadTimeWindowDays);
      const computedAt = new Date();

      const suppliers = await this.observeSuppliers(trx, windowFrom);
      await trx.delete(wmsTables.supplierLeadTimeProfiles);
      if (suppliers.length > 0) {
        await trx.insert(wmsTables.supplierLeadTimeProfiles).values(
          suppliers.map((r) => ({
            supplierId: r.supplier_id,
            observations: Number(r.n),
            meanDays: Number(r.mean_days),
            stdDays: r.std_days === null ? null : Number(r.std_days),
            windowFrom,
            windowTo,
            computedAt,
          })),
        );
      }

      const routes = await this.observeRoutes(trx, windowFrom);
      await trx.delete(wmsTables.routeLeadTimeProfiles);
      if (routes.length > 0) {
        await trx.insert(wmsTables.routeLeadTimeProfiles).values(
          routes.map((r) => ({
            fromWarehouseId: r.from_warehouse_id,
            toWarehouseId: r.to_warehouse_id,
            observations: Number(r.n),
            meanDays: Number(r.mean_days),
            stdDays: r.std_days === null ? null : Number(r.std_days),
            windowFrom,
            windowTo,
            computedAt,
          })),
        );
      }

      return { suppliers: suppliers.length, routes: routes.length, windowFrom, windowTo };
    }, tx);
  }

  /** L1: 발주 라인 ordered_at → 같은 PO 계획의 같은 SKU 아이템에 붙은 첫 posted 입고. */
  private async observeSuppliers(trx: DbTx, windowFrom: string): Promise<SupplierObsRow[]> {
    const result = await trx.execute(sql`
      WITH first_receipt AS (
        SELECT ip.linked_purchase_order_id AS po_id, ipi.sku_id, MIN(ir.occurred_at) AS received_at
        FROM inbound_plans ip
        JOIN inbound_plan_items ipi ON ipi.plan_id = ip.id
        JOIN inbound_receipt_lines irl ON irl.plan_item_id = ipi.id
        JOIN inbound_receipts ir ON ir.id = irl.receipt_id AND ir.status = 'posted'
        GROUP BY ip.linked_purchase_order_id, ipi.sku_id
      ),
      obs AS (
        SELECT po.supplier_id,
               EXTRACT(EPOCH FROM (fr.received_at - pol.ordered_at)) / 86400.0 AS days
        FROM purchase_order_lines pol
        JOIN purchase_orders po ON po.id = pol.po_id
        JOIN first_receipt fr ON fr.po_id = pol.po_id AND fr.sku_id = pol.sku_id
        WHERE pol.status = 'ordered'
          AND pol.ordered_at IS NOT NULL
          AND po.supplier_id IS NOT NULL
          AND pol.ordered_at >= ${windowFrom}::date
          AND fr.received_at >= pol.ordered_at
      )
      SELECT supplier_id,
             COUNT(*)::int AS n,
             AVG(days)::float8 AS mean_days,
             STDDEV_SAMP(days)::float8 AS std_days
      FROM obs
      GROUP BY supplier_id
    `);
    // execute() 원시 결과 타이핑 — ledger-reconciliation.service.ts:120 과 같은 문서화된 캐스트.
    return result as unknown as SupplierObsRow[];
  }

  /** L2: 지시서 shipped_at → 첫 수령. */
  private async observeRoutes(trx: DbTx, windowFrom: string): Promise<RouteObsRow[]> {
    const result = await trx.execute(sql`
      WITH first_receipt AS (
        SELECT transfer_order_id, MIN(received_at) AS received_at
        FROM transfer_order_receipts
        GROUP BY transfer_order_id
      ),
      obs AS (
        SELECT t.from_warehouse_id, t.to_warehouse_id,
               EXTRACT(EPOCH FROM (fr.received_at - t.shipped_at)) / 86400.0 AS days
        FROM transfer_orders t
        JOIN first_receipt fr ON fr.transfer_order_id = t.id
        WHERE t.shipped_at IS NOT NULL
          AND t.shipped_at >= ${windowFrom}::date
          AND fr.received_at >= t.shipped_at
      )
      SELECT from_warehouse_id, to_warehouse_id,
             COUNT(*)::int AS n,
             AVG(days)::float8 AS mean_days,
             STDDEV_SAMP(days)::float8 AS std_days
      FROM obs
      GROUP BY from_warehouse_id, to_warehouse_id
    `);
    // execute() 원시 결과 타이핑 — 위와 같은 문서화된 캐스트.
    return result as unknown as RouteObsRow[];
  }
}
```

- [ ] **Step 4: 통과 확인**

Run: `COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- lead-time-profile.refresher.integration`
Expected: PASS 3 tests.

- [ ] **Step 5: 커밋**

```bash
git add apps/core/src/modules/inventory/replenishment/demand/lead-time-profile.refresher.ts apps/core/src/modules/inventory/replenishment/demand/lead-time-profile.refresher.integration.spec.ts
git commit -m "feat(core): 리드타임 프로필 refresher — 발주→첫 입고(L1) · 선적→첫 수령(L2) (#743 A)

Claude-Session: https://claude.ai/code/session_01Y5Bthz8rSpjhTgrZTzGBED"
```

---

### Task 10: 야간 잡 · recompute 라우트 · 모듈 배선 · 경계 스펙

**Files:**
- Create: `apps/core/src/modules/inventory/replenishment/demand/replenishment-refresh.job.ts` + `.spec.ts`
- Create: `apps/core/src/modules/inventory/replenishment/dto/replenishment-profile.dto.ts`
- Create: `apps/core/src/modules/inventory/replenishment/demand/replenishment-profile.service.ts`
- Create: `apps/core/src/modules/inventory/replenishment/controllers/replenishment-profile.controller.ts` + `.spec.ts`
- Modify: `apps/core/src/modules/inventory/replenishment/replenishment.module.ts`
- Modify: `apps/core/src/platform/auth/inventory-scope-coverage.spec.ts` (표 + 개수)
- Modify: `apps/core/src/modules/inventory/replenishment-boundary.arch.spec.ts` (순수 파일 2개 등록)

**Interfaces:**
- Consumes: Task 3 · 7 · 8 · 9 의 클래스, `kstDateOf` · `addDays` (Task 4).
- Produces:
  ```ts
  export type RefreshSeries = 'window' | 'full';
  export interface RefreshSummary {
    series: RefreshSeries; today: string; startedAt: string; finishedAt: string;
    demandSeries: DemandRebuildResult; profiles: ProfileRefreshResult; leadTimes: LeadTimeRefreshResult;
  }
  export class ReplenishmentRefreshJob {
    nightly(): Promise<void>;                                  // @Cron, 예외를 삼키고 로그
    run(series: RefreshSeries, now?: Date): Promise<RefreshSummary>; // 세 단계, 앞이 실패하면 뒤를 안 돈다
  }
  export class ReplenishmentProfileService { recompute(series: RefreshSeries): Promise<RefreshSummary> }
  ```
  라우트 `POST /replenishment/profiles/recompute?series=window|full` (기본 `window`, HTTP 200, 본문 = `RefreshSummary`).

- [ ] **Step 1: 잡의 실패하는 단위 스펙 (mock 주입, DB 없음)**

```ts
// apps/core/src/modules/inventory/replenishment/demand/replenishment-refresh.job.spec.ts
import { ReplenishmentRefreshJob } from './replenishment-refresh.job';
import { ReplenishmentSettingsReader } from './replenishment-settings.reader';
import { DemandSeriesWriter } from './demand-series.writer';
import { DemandProfileRefresher } from './demand-profile.refresher';
import { LeadTimeProfileRefresher } from './lead-time-profile.refresher';

function build(overrides: { series?: Partial<DemandSeriesWriter>; profiles?: Partial<DemandProfileRefresher> } = {}) {
  const calls: string[] = [];
  const settingsReader = {
    read: jest.fn().mockResolvedValue({ demandRecomputeDays: 14, demandCoreSince: '2026-07-01' }),
  } as unknown as ReplenishmentSettingsReader;
  const seriesWriter = {
    rebuildCoreWindow: jest.fn(async (input) => {
      calls.push('window');
      return { from: input.from, to: input.to, rows: 3 };
    }),
    rebuildCoreFull: jest.fn(async (input) => {
      calls.push('full');
      return { from: '2026-07-01', to: input.to, rows: 30 };
    }),
    ...overrides.series,
  } as unknown as DemandSeriesWriter;
  const profileRefresher = {
    refreshAll: jest.fn(async () => {
      calls.push('profiles');
      return { skus: 2, byPattern: { smooth: 1, intermittent: 0, erratic: 0, lumpy: 0, insufficient: 0, none: 1 } };
    }),
    ...overrides.profiles,
  } as unknown as DemandProfileRefresher;
  const leadTimeRefresher = {
    refreshAll: jest.fn(async () => {
      calls.push('lead-times');
      return { suppliers: 1, routes: 1, windowFrom: '2025-09-08', windowTo: '2026-09-08' };
    }),
  } as unknown as LeadTimeProfileRefresher;
  const job = new ReplenishmentRefreshJob(settingsReader, seriesWriter, profileRefresher, leadTimeRefresher);
  return { job, calls, settingsReader, seriesWriter, profileRefresher, leadTimeRefresher };
}

// 2026-09-08 03:40 KST = 2026-09-07T18:40:00Z
const NOW = new Date('2026-09-07T18:40:00Z');

describe('ReplenishmentRefreshJob', () => {
  it('window: 설정의 재계산 일수 창으로 시계열 → 프로필 → 리드타임 순서', async () => {
    const { job, calls, seriesWriter, profileRefresher, leadTimeRefresher } = build();
    const summary = await job.run('window', NOW);
    expect(calls).toEqual(['window', 'profiles', 'lead-times']);
    expect(seriesWriter.rebuildCoreWindow).toHaveBeenCalledWith({ from: '2026-08-25', to: '2026-09-08', coreSince: '2026-07-01' });
    expect(profileRefresher.refreshAll).toHaveBeenCalledWith({ today: '2026-09-08' });
    expect(leadTimeRefresher.refreshAll).toHaveBeenCalledWith({ today: '2026-09-08' });
    expect(summary).toMatchObject({ series: 'window', today: '2026-09-08', demandSeries: { rows: 3 }, profiles: { skus: 2 }, leadTimes: { suppliers: 1 } });
    expect(summary.startedAt <= summary.finishedAt).toBe(true);
  });

  it('full: 전량 재구축을 부른다', async () => {
    const { job, calls, seriesWriter } = build();
    await job.run('full', NOW);
    expect(calls[0]).toBe('full');
    expect(seriesWriter.rebuildCoreFull).toHaveBeenCalledWith({ to: '2026-09-08', coreSince: '2026-07-01' });
  });

  it('앞 단계가 실패하면 뒤 단계를 돌리지 않고 예외를 올린다', async () => {
    const { job, calls } = build({ series: { rebuildCoreWindow: jest.fn().mockRejectedValue(new Error('boom')) } });
    await expect(job.run('window', NOW)).rejects.toThrow('boom');
    expect(calls).toEqual([]);
  });

  it('nightly 는 예외를 삼키고 로그로 남긴다 — 스케줄러를 죽이지 않는다', async () => {
    const { job } = build({ profiles: { refreshAll: jest.fn().mockRejectedValue(new Error('profile boom')) } });
    const error = jest.spyOn(job['logger'], 'error').mockImplementation(() => undefined);
    await expect(job.nightly()).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledWith(expect.stringContaining('profile boom'), expect.anything());
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx jest apps/core/src/modules/inventory/replenishment/demand/replenishment-refresh.job.spec.ts`
Expected: FAIL — `Cannot find module './replenishment-refresh.job'`

- [ ] **Step 3: 잡 구현**

```ts
// apps/core/src/modules/inventory/replenishment/demand/replenishment-refresh.job.ts
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ReplenishmentSettingsReader } from './replenishment-settings.reader';
import { DemandSeriesWriter, DemandRebuildResult } from './demand-series.writer';
import { DemandProfileRefresher, ProfileRefreshResult } from './demand-profile.refresher';
import { LeadTimeProfileRefresher, LeadTimeRefreshResult } from './lead-time-profile.refresher';
import { addDays, kstDateOf } from './calendar';

export type RefreshSeries = 'window' | 'full';

export interface RefreshSummary {
  series: RefreshSeries;
  today: string;
  startedAt: string;
  finishedAt: string;
  demandSeries: DemandRebuildResult;
  profiles: ProfileRefreshResult;
  leadTimes: LeadTimeRefreshResult;
}

/**
 * 야간 배치 (스펙 §8.3): ① 시계열 창 upsert → ② 프로필 → ③ 리드타임. 각 단계는 제 트랜잭션이라
 * 앞 단계의 커밋은 남고, 실패하면 뒤를 돌리지 않는다(부분 갱신된 프로필 위에 리드타임만 새것이 되는 상태를 피한다).
 * recompute 엔드포인트는 같은 run() 을 동기로 부른다. 크론 리더 선출이 없어 인스턴스가 둘이면 두 번 도는데
 * 결과가 같다. `SCHEDULE_ROOT` 가 전역이라 이 모듈은 ScheduleModule 을 import 하지 않는다(#599).
 */
@Injectable()
export class ReplenishmentRefreshJob {
  private readonly logger = new Logger(ReplenishmentRefreshJob.name);

  constructor(
    private readonly settingsReader: ReplenishmentSettingsReader,
    private readonly seriesWriter: DemandSeriesWriter,
    private readonly profileRefresher: DemandProfileRefresher,
    private readonly leadTimeRefresher: LeadTimeProfileRefresher,
  ) {}

  @Cron('40 3 * * *', { name: 'replenishment-profile-refresh', timeZone: 'Asia/Seoul' })
  async nightly(): Promise<void> {
    try {
      const summary = await this.run('window');
      this.logger.log(
        `✅ replenishment refresh: series ${summary.demandSeries.rows} rows (${summary.demandSeries.from}~${summary.demandSeries.to}), ` +
          `profiles ${summary.profiles.skus} skus ${JSON.stringify(summary.profiles.byPattern)}, ` +
          `lead-times suppliers=${summary.leadTimes.suppliers} routes=${summary.leadTimes.routes}`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const stack = error instanceof Error ? error.stack : undefined;
      this.logger.error(`replenishment refresh job failed: ${message}`, stack);
    }
  }

  async run(series: RefreshSeries, now: Date = new Date()): Promise<RefreshSummary> {
    const startedAt = now.toISOString();
    const today = kstDateOf(now);
    const settings = await this.settingsReader.read();

    const demandSeries =
      series === 'full'
        ? await this.seriesWriter.rebuildCoreFull({ to: today, coreSince: settings.demandCoreSince })
        : await this.seriesWriter.rebuildCoreWindow({
            from: addDays(today, -settings.demandRecomputeDays),
            to: today,
            coreSince: settings.demandCoreSince,
          });
    const profiles = await this.profileRefresher.refreshAll({ today });
    const leadTimes = await this.leadTimeRefresher.refreshAll({ today });

    return { series, today, startedAt, finishedAt: new Date().toISOString(), demandSeries, profiles, leadTimes };
  }
}
```

- [ ] **Step 4: 잡 스펙 통과 확인**

Run: `npx jest apps/core/src/modules/inventory/replenishment/demand/replenishment-refresh.job.spec.ts`
Expected: PASS 4 tests.

- [ ] **Step 5: 컨트롤러의 실패하는 스펙**

```ts
// apps/core/src/modules/inventory/replenishment/controllers/replenishment-profile.controller.spec.ts
import { ReplenishmentProfileController } from './replenishment-profile.controller';
import { ReplenishmentProfileService } from '../demand/replenishment-profile.service';

describe('ReplenishmentProfileController', () => {
  const recompute = jest.fn().mockResolvedValue({ series: 'window' });
  const service = { recompute } as unknown as ReplenishmentProfileService;
  const controller = new ReplenishmentProfileController(service);

  it('series 미지정은 window', async () => {
    await controller.recompute({});
    expect(recompute).toHaveBeenCalledWith('window');
  });

  it('series=full 을 그대로 넘긴다', async () => {
    await controller.recompute({ series: 'full' });
    expect(recompute).toHaveBeenCalledWith('full');
  });
});
```

Run: `npx jest apps/core/src/modules/inventory/replenishment/controllers/replenishment-profile.controller.spec.ts`
Expected: FAIL — `Cannot find module`

- [ ] **Step 6: DTO · 서비스 · 컨트롤러**

```ts
// apps/core/src/modules/inventory/replenishment/dto/replenishment-profile.dto.ts
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';

export const REFRESH_SERIES = ['window', 'full'] as const;

export class RecomputeProfilesQueryDto {
  @ApiPropertyOptional({ enum: REFRESH_SERIES, default: 'window', description: 'window = 최근 demand_recompute_days 창, full = D0 이후 전량' })
  @IsOptional()
  @IsIn(REFRESH_SERIES)
  series?: (typeof REFRESH_SERIES)[number];
}

export class DemandRebuildResultDto {
  @ApiPropertyOptional({ nullable: true }) from: string | null;
  @ApiProperty() to: string;
  @ApiProperty() rows: number;
}

export class PatternCountsDto {
  @ApiProperty() smooth: number;
  @ApiProperty() intermittent: number;
  @ApiProperty() erratic: number;
  @ApiProperty() lumpy: number;
  @ApiProperty() insufficient: number;
  @ApiProperty() none: number;
}

export class ProfileRefreshResultDto {
  @ApiProperty() skus: number;
  @ApiProperty({ type: PatternCountsDto }) byPattern: PatternCountsDto;
}

export class LeadTimeRefreshResultDto {
  @ApiProperty() suppliers: number;
  @ApiProperty() routes: number;
  @ApiProperty() windowFrom: string;
  @ApiProperty() windowTo: string;
}

export class RefreshSummaryDto {
  @ApiProperty({ enum: REFRESH_SERIES }) series: string;
  @ApiProperty() today: string;
  @ApiProperty() startedAt: string;
  @ApiProperty() finishedAt: string;
  @ApiProperty({ type: DemandRebuildResultDto }) demandSeries: DemandRebuildResultDto;
  @ApiProperty({ type: ProfileRefreshResultDto }) profiles: ProfileRefreshResultDto;
  @ApiProperty({ type: LeadTimeRefreshResultDto }) leadTimes: LeadTimeRefreshResultDto;
}
```

```ts
// apps/core/src/modules/inventory/replenishment/demand/replenishment-profile.service.ts
import { Injectable } from '@nestjs/common';
import { RefreshSeries, RefreshSummary, ReplenishmentRefreshJob } from './replenishment-refresh.job';

/** 야간 배치와 같은 세 단계를 지금. 트랜잭션 경계는 단계별로 잡이 갖는다. */
@Injectable()
export class ReplenishmentProfileService {
  constructor(private readonly job: ReplenishmentRefreshJob) {}

  recompute(series: RefreshSeries): Promise<RefreshSummary> {
    return this.job.run(series);
  }
}
```

```ts
// apps/core/src/modules/inventory/replenishment/controllers/replenishment-profile.controller.ts
import { Controller, HttpCode, Post, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { RequireScopes, ScopeGuard } from '@app/authorization';
import { INVENTORY_SCOPE } from '../../../../platform/auth/inventory-scopes';
import { ReplenishmentProfileService } from '../demand/replenishment-profile.service';
import { RecomputeProfilesQueryDto, RefreshSummaryDto } from '../dto/replenishment-profile.dto';

/**
 * 프로필 재계산 (#743 A, 스펙 §7.4). 동기 실행 — 5,800 SKU × 365 일도 수 초 안쪽이다.
 * 상태코드 매핑 try/catch 없음 — GlobalExceptionFilter 가 한다.
 */
@ApiTags('Inventory - Replenishment')
@Controller('replenishment')
@UseGuards(ScopeGuard)
export class ReplenishmentProfileController {
  constructor(private readonly service: ReplenishmentProfileService) {}

  @Post('profiles/recompute')
  @HttpCode(200)
  @RequireScopes(INVENTORY_SCOPE.MANAGE)
  @ApiOperation({
    summary: '수요 시계열 · 프로필 · 리드타임 프로필을 지금 다시 계산한다',
    description: '야간 배치(03:40 KST)와 같은 세 단계. series=window 는 최근 창만, full 은 D0 이후 전량.',
  })
  @ApiResponse({ status: 200, type: RefreshSummaryDto })
  @ApiResponse({ status: 403, description: '재고 마스터데이터 관리 권한이 없습니다.' })
  recompute(@Query() query: RecomputeProfilesQueryDto): Promise<RefreshSummaryDto> {
    return this.service.recompute(query.series ?? 'window');
  }
}
```

- [ ] **Step 7: 모듈 배선**

`apps/core/src/modules/inventory/replenishment/replenishment.module.ts` 전체를 이렇게 바꾼다:

```ts
import { Module } from '@nestjs/common';
import { SharedModule } from '../shared/shared.module';
import { CoreInventoryModule } from '../core/inventory.module';
import { StockProjectionModule } from '../stock-projection/stock-projection.module';
import { WarehouseTransferModule } from '../warehouse-transfer/warehouse-transfer.module';
import { ReplenishmentSuggestionController } from './controllers/replenishment-suggestion.controller';
import { ReplenishmentProfileController } from './controllers/replenishment-profile.controller';
import { ReplenishmentSuggestionService } from './suggestion/replenishment-suggestion.service';
import { ReplenishmentSuggestionReader } from './suggestion/replenishment-suggestion.reader';
import { ReplenishmentStockReader } from './suggestion/replenishment-stock.reader';
import { ReplenishmentSettingsReader } from './demand/replenishment-settings.reader';
import { DemandSeriesWriter } from './demand/demand-series.writer';
import { DemandProfileRefresher } from './demand/demand-profile.refresher';
import { LeadTimeProfileRefresher } from './demand/lead-time-profile.refresher';
import { ReplenishmentRefreshJob } from './demand/replenishment-refresh.job';
import { ReplenishmentProfileService } from './demand/replenishment-profile.service';

/**
 * 재고 보충 제안 (#743, 스펙 2026-09-08). procurement · warehouse-transfer 의 형제.
 *
 * - `ProcurementModule` 을 import 하지 않는다. 제안은 읽기 전용이고 실행(카트·이동 지시서)은
 *   화면이 기존 API 를 부른다. `replenishment-boundary.arch.spec.ts` 가 이 0 을 고정한다.
 * - `WarehouseTransferModule` 은 draft 지시서 planned 합을 Reader 에서 빌리기 위해서다 —
 *   `StockProjectionModule` 이 파이프라인 ③ 때문에 같은 모듈을 빌리는 것과 같은 형태.
 * - A 단계: demand/ 가 야간 크론(`replenishment-profile-refresh`)으로 시계열 · 프로필 · 리드타임을 물질화한다.
 *   `SCHEDULE_ROOT` 는 전역이라 여기서 ScheduleModule 을 import 하지 않는다.
 * - 제안은 아직 C 의 자리표시 규칙(`skus.safety_stock`)이다. B 가 policy/ · rules/ 를 더해 교체한다.
 */
@Module({
  imports: [SharedModule, CoreInventoryModule, StockProjectionModule, WarehouseTransferModule],
  controllers: [ReplenishmentSuggestionController, ReplenishmentProfileController],
  providers: [
    ReplenishmentSuggestionService,
    ReplenishmentSuggestionReader,
    ReplenishmentStockReader,
    ReplenishmentSettingsReader,
    DemandSeriesWriter,
    DemandProfileRefresher,
    LeadTimeProfileRefresher,
    ReplenishmentRefreshJob,
    ReplenishmentProfileService,
  ],
  exports: [ReplenishmentSuggestionService, ReplenishmentSettingsReader],
})
export class ReplenishmentModule {}
```

- [ ] **Step 8: 라우트 스코프 표 등록**

`apps/core/src/platform/auth/inventory-scope-coverage.spec.ts`:
- 배너 `// ── inventory.manage (58) ──…` 의 숫자를 **59** 로.
- `'GET /replenishment/skus/:skuId':` 줄 **바로 위**에 한 줄 추가(경로 알파벳순):

```ts
  'POST /replenishment/profiles/recompute':                    S.MANAGE,
```

- [ ] **Step 9: 경계 스펙에 순수 파일 2개 등록**

`apps/core/src/modules/inventory/replenishment-boundary.arch.spec.ts` 의 세 번째 테스트에서 `pure` 선택 필터를 넓힌다:

```ts
  it('순수 층(policy/ · suggestion.assembler · suggestion.types · demand/calendar · demand-profile.calculator)은 Nest · drizzle 을 모른다', () => {
    const pure = collectTsFiles(REPLENISHMENT_DIR).filter(
      (file) =>
        file.includes(`${sep}policy${sep}`) ||
        file.endsWith('suggestion.assembler.ts') ||
        file.endsWith('suggestion.types.ts') ||
        file.endsWith(`${sep}demand${sep}calendar.ts`) ||
        file.endsWith('demand-profile.calculator.ts'),
    );
    expect(pure.length).toBeGreaterThanOrEqual(5);
```

(나머지 본문은 그대로.)

- [ ] **Step 10: 통과 확인 — 컨트롤러 · 경계 · 스코프 표 · 타입**

```bash
npx jest apps/core/src/modules/inventory/replenishment/controllers/replenishment-profile.controller.spec.ts
npx jest apps/core/src/modules/inventory/replenishment-boundary.arch.spec.ts
npx jest apps/core/src/platform/auth/inventory-scope-coverage.spec.ts apps/core/src/platform/auth/scope-guard-binding.spec.ts
npm run type-check
```

Expected: 전부 PASS, type-check 에러 0.

- [ ] **Step 11: 부팅 스모크 — 크론이 한 번만 등록되는지**

```bash
npm run start:main:dev
```

로그에 `ReplenishmentRefreshJob` 가 뜨고 부팅 에러가 없으면 된다. (`nest start` 는 `ScheduleModule` 이 크론을 등록할 때 이름 중복이면 `Cron job with name 'replenishment-profile-refresh' already exists` 로 죽는다 — 안 죽으면 한 번이다.) 확인 후 종료.

- [ ] **Step 12: 커밋**

```bash
git add apps/core/src/modules/inventory/replenishment apps/core/src/platform/auth/inventory-scope-coverage.spec.ts apps/core/src/modules/inventory/replenishment-boundary.arch.spec.ts
git commit -m "feat(core): 보충 프로필 야간 잡(03:40 KST) · POST /replenishment/profiles/recompute · 모듈 배선 (#743 A)

Claude-Session: https://claude.ai/code/session_01Y5Bthz8rSpjhTgrZTzGBED"
```

---
### Task 11: 셀메이트 주문 이력 시드 스크립트 `import-demand-history.ts`

**Files:**
- Create: `scripts/sellmate/import-demand-history.ts`
- Test: `scripts/sellmate/import-demand-history.spec.ts`
- Modify: `scripts/sellmate/README.md` (사용법 한 절)

**Interfaces:**
- Consumes: `readRows` · `detectColumns` · `chunk` (`scripts/sellmate/parse.ts`), `DATABASE_URL`(러너 `run.sh` 가 주입), 표 `sku_demand_daily` · `replenishment_settings` (Task 1).
- Produces (테스트용 export):
  ```ts
  export const DEMAND_COLUMN_CANDIDATES: { itemCode; orderDate; qty; amount }  // 헤더 별칭
  export interface DemandRow { itemCode: string; date: string; qty: number; amount: number | null }
  export function parseDate(raw: string): string | null
  export function parseNumber(raw: string): number | null
  export function parseDemandRows(rows: string[][], file: string, quiet?: boolean): { rows: DemandRow[]; skipped: Map<string, number> }
  export function aggregateDaily(rows: DemandRow[]): Map<string, Map<string, { qty: number; amount: number | null }>>
  export function resolveCoreSince(arg: string | null, existing: string | null, minCoreOrderDate: string | null): { value: string | null; warning: string | null }
  export function splitByCoreSince<T extends { date: string }>(rows: T[], coreSince: string | null): { before: T[]; onOrAfter: T[] }
  export function unmatchedCsv(items: Array<{ itemCode: string; qty: number; days: number }>): string
  ```
  실행: `bash scripts/sellmate/run.sh live import-demand-history apps/core/tmp/ [--core-since YYYY-MM-DD]`, `DRY_RUN=1` 로 파싱 · 매칭 · 리포트까지만. `require.main === module` 가드로 import 시 실행되지 않는다.

- [ ] **Step 1: 실패하는 스펙 (순수 함수, DB 없음)**

```ts
// scripts/sellmate/import-demand-history.spec.ts
/**
 * 셀메이트 주문 이력 → 수요 시계열 시드의 파싱 · 집계 · D0 규칙 회귀 테스트 (DB 불필요).
 */
import {
  aggregateDaily,
  parseDate,
  parseDemandRows,
  parseNumber,
  resolveCoreSince,
  splitByCoreSince,
  unmatchedCsv,
} from './import-demand-history';

const HEADER = ['옵션정보일련번호', '주문일', '수량', '결제금액'];
type Row = [code: string, date: string, qty: string, amount: string];
const rows = (...rs: Row[]): string[][] => [HEADER, ...rs];

describe('parseDate', () => {
  it('셀메이트 날짜 표기 넷을 YYYY-MM-DD 로', () => {
    expect(parseDate('2026-07-01')).toBe('2026-07-01');
    expect(parseDate('2026.7.1')).toBe('2026-07-01');
    expect(parseDate('2026-07-01 오후 4:21:00')).toBe('2026-07-01');
    expect(parseDate('2026/07/01 16:21')).toBe('2026-07-01');
  });
  it('못 읽으면 null', () => {
    expect(parseDate('')).toBeNull();
    expect(parseDate('7월 1일')).toBeNull();
    expect(parseDate('2026-13-01')).toBeNull();
  });
});

describe('parseNumber', () => {
  it('천 단위 구분자 · 원 표기 · 빈값', () => {
    expect(parseNumber('1,234')).toBe(1234);
    expect(parseNumber('12,000원')).toBe(12000);
    expect(parseNumber('3')).toBe(3);
    expect(parseNumber('')).toBeNull();
    expect(parseNumber('-')).toBeNull();
  });
});

describe('parseDemandRows', () => {
  it('코드 · 날짜 · 수량이 있는 행만, 금액은 없으면 null', () => {
    const { rows: parsed, skipped } = parseDemandRows(
      rows(['I1', '2026-07-01', '2', '5,000'], ['I2', '2026.7.2', '1', ''], ['', '2026-07-01', '1', '1'], ['I3', '', '1', '1'], ['I4', '2026-07-01', '0', '1']),
      'orders.xls',
      true,
    );
    expect(parsed).toEqual([
      { itemCode: 'I1', date: '2026-07-01', qty: 2, amount: 5000 },
      { itemCode: 'I2', date: '2026-07-02', qty: 1, amount: null },
    ]);
    expect(skipped.get('코드 없음')).toBe(1);
    expect(skipped.get('주문일 없음')).toBe(1);
    expect(skipped.get('수량 0 이하')).toBe(1);
  });

  it('필수 열(코드 · 주문일 · 수량)이 없으면 던진다', () => {
    expect(() => parseDemandRows([['상품명', '주문일', '수량'], ['x', '2026-07-01', '1']], 'f.xls', true)).toThrow(/옵션정보일련번호/);
  });

  it('="…" 로 감싼 코드는 parse.ts 가 벗기므로 그대로 온다고 가정한다 — 앞뒤 공백만 제거', () => {
    const { rows: parsed } = parseDemandRows(rows([' I1 ', '2026-07-01', '1', '1']), 'f.xls', true);
    expect(parsed[0].itemCode).toBe('I1');
  });
});

describe('aggregateDaily', () => {
  it('같은 코드 · 같은 날은 합치고, 금액은 하나라도 있으면 있는 것의 합', () => {
    const agg = aggregateDaily([
      { itemCode: 'I1', date: '2026-07-01', qty: 2, amount: 5000 },
      { itemCode: 'I1', date: '2026-07-01', qty: 3, amount: null },
      { itemCode: 'I1', date: '2026-07-02', qty: 1, amount: null },
      { itemCode: 'I2', date: '2026-07-01', qty: 1, amount: 100 },
    ]);
    expect(agg.get('I1')?.get('2026-07-01')).toEqual({ qty: 5, amount: 5000 });
    expect(agg.get('I1')?.get('2026-07-02')).toEqual({ qty: 1, amount: null });
    expect(agg.get('I2')?.get('2026-07-01')).toEqual({ qty: 1, amount: 100 });
  });
});

describe('resolveCoreSince — D0', () => {
  it('설정에 이미 있으면 그 값. 인자가 다르면 경고하고 덮어쓰지 않는다', () => {
    expect(resolveCoreSince('2026-07-10', '2026-07-01', '2026-06-01')).toEqual({ value: '2026-07-01', warning: expect.stringContaining('덮어쓰지') });
    expect(resolveCoreSince(null, '2026-07-01', null)).toEqual({ value: '2026-07-01', warning: null });
  });
  it('없으면 인자, 인자도 없으면 core 최초 주문일', () => {
    expect(resolveCoreSince('2026-07-10', null, '2026-06-01')).toEqual({ value: '2026-07-10', warning: null });
    expect(resolveCoreSince(null, null, '2026-06-01')).toEqual({ value: '2026-06-01', warning: null });
  });
  it('셋 다 없으면 null + 경고 (core 주문이 아직 없다)', () => {
    expect(resolveCoreSince(null, null, null)).toEqual({ value: null, warning: expect.stringContaining('core 주문') });
  });
});

describe('splitByCoreSince', () => {
  it('D0 이전만 시드하고 D0 당일 이후는 뺀다', () => {
    const r = splitByCoreSince([{ date: '2026-06-30' }, { date: '2026-07-01' }, { date: '2026-07-02' }], '2026-07-01');
    expect(r.before.map((x) => x.date)).toEqual(['2026-06-30']);
    expect(r.onOrAfter.map((x) => x.date)).toEqual(['2026-07-01', '2026-07-02']);
  });
  it('D0 가 null 이면 전부 시드', () => {
    expect(splitByCoreSince([{ date: '2026-07-01' }], null).before).toHaveLength(1);
  });
});

describe('unmatchedCsv', () => {
  it('BOM + 헤더 + 따옴표 이스케이프', () => {
    const csv = unmatchedCsv([{ itemCode: 'I"1', qty: 3, days: 2 }]);
    expect(csv.startsWith('\ufeff')).toBe(true);
    expect(csv.split('\n')).toEqual(['\ufeff옵션정보일련번호,수량합,발생일수', '"I""1","3","2"']);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx jest scripts/sellmate/import-demand-history.spec.ts`
Expected: FAIL — `Cannot find module './import-demand-history'`

- [ ] **Step 3: 스크립트 구현**

```ts
// scripts/sellmate/import-demand-history.ts
/**
 * 셀메이트 주문/판매 export → core `sku_demand_daily` (source='sellmate') 시드 (#743 A, 스펙 §4.2)
 *
 * 실행 (live 터널 필요, 런북 docs/runbooks/selmate-stock-pipeline.md 「사전 준비」):
 *   DRY_RUN=1 bash scripts/sellmate/run.sh live import-demand-history apps/core/tmp/        # 파싱 · 매칭 · 리포트만
 *   bash scripts/sellmate/run.sh live import-demand-history apps/core/tmp/ [--core-since 2026-07-01]
 *
 * 규칙:
 *  - 품목 식별은 옵션정보일련번호 = skus.code (import-products.ts 규약). 미매칭은 중단하지 않고
 *    apps/core/tmp/demand-unmatched-<ts>.csv 로 남긴다 — 조용히 사라지지 않게.
 *  - D0(replenishment_settings.demand_core_since) 이전 날짜만 시드한다. D0 는 --core-since > 기존 설정 >
 *    core sales_orders 최소 주문일 순서로 정하고, 기존 설정이 있으면 덮어쓰지 않는다(경고만).
 *  - (sku_id, demand_date) upsert — 같은 파일을 다시 돌려도 결과가 같다.
 *  - 열 이름 별칭은 DEMAND_COLUMN_CANDIDATES, env COL_ITEM_CODE / COL_ORDER_DATE / COL_QTY / COL_AMOUNT 로 덮어쓴다.
 */
import * as fs from 'fs';
import * as path from 'path';
import postgres, { Sql } from 'postgres';
import { readRows, detectColumns, chunk } from './parse';

export const DEMAND_COLUMN_CANDIDATES = {
  itemCode: ['옵션정보일련번호', '옵션코드', '품목코드', '판매처옵션코드'],
  orderDate: ['주문일', '주문일자', '주문일시', '결제일', '결제일시', '판매일', '주문날짜'],
  qty: ['수량', '주문수량', '판매수량', '상품수량'],
  amount: ['금액', '결제금액', '판매금액', '상품금액', '합계금액', '주문금액'],
} as const;

type DemandField = keyof typeof DEMAND_COLUMN_CANDIDATES;

const OVERRIDES: Partial<Record<DemandField, string | undefined>> = {
  itemCode: process.env.COL_ITEM_CODE,
  orderDate: process.env.COL_ORDER_DATE,
  qty: process.env.COL_QTY,
  amount: process.env.COL_AMOUNT,
};

const DRY_RUN = process.env.DRY_RUN === '1' || process.env.DRY_RUN === 'true';
const REPORT_DIR = path.join('apps', 'core', 'tmp');

export interface DemandRow {
  itemCode: string;
  date: string;
  qty: number;
  amount: number | null;
}

/** '2026-07-01' · '2026.7.1' · '2026/07/01 16:21' · '2026-07-01 오후 4:21:00' → 'YYYY-MM-DD'. 달력 유효성까지 본다. */
export function parseDate(raw: string): string | null {
  const m = (raw ?? '').match(/(\d{4})[.\-/]\s*(\d{1,2})[.\-/]\s*(\d{1,2})/);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const iso = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  // Date.UTC 로 왕복해 2026-13-01 · 2026-02-30 을 거른다. 문자열만 만들므로 런타임 TZ 무관.
  return new Date(Date.UTC(y, mo - 1, d)).toISOString().slice(0, 10) === iso ? iso : null;
}

/** '1,234' · '12,000원' → 숫자. 빈값 · 숫자 없음 → null. */
export function parseNumber(raw: string): number | null {
  const digits = (raw ?? '').replace(/[^\d.-]/g, '');
  if (digits === '' || digits === '-' || digits === '.') return null;
  const n = Number(digits);
  return Number.isFinite(n) ? n : null;
}

export function parseDemandRows(
  rows: string[][],
  file: string,
  quiet = false,
): { rows: DemandRow[]; skipped: Map<string, number> } {
  if (rows.length === 0) throw new Error(`${path.basename(file)}: 빈 파일`);
  const header = rows[0];
  const cols = detectColumns(header, DEMAND_COLUMN_CANDIDATES, OVERRIDES);
  if (!quiet) {
    console.log(`\n📄 ${path.basename(file)} — 감지된 열 매핑:`);
    for (const field of Object.keys(DEMAND_COLUMN_CANDIDATES) as DemandField[]) {
      const idx = cols[field];
      console.log(`   ${field.padEnd(10)} → [${idx}] "${idx >= 0 ? header[idx] : '(없음)'}"`);
    }
  }
  const missing = (['itemCode', 'orderDate', 'qty'] as DemandField[]).filter((f) => cols[f] < 0);
  if (missing.length) {
    throw new Error(
      `${path.basename(file)}: 필수 열을 못 찾았습니다 — ${missing
        .map((f) => DEMAND_COLUMN_CANDIDATES[f][0])
        .join(', ')}. COL_ITEM_CODE / COL_ORDER_DATE / COL_QTY 로 헤더를 지정하세요.`,
    );
  }

  const parsed: DemandRow[] = [];
  const skipped = new Map<string, number>();
  const skip = (reason: string) => skipped.set(reason, (skipped.get(reason) ?? 0) + 1);

  for (const r of rows.slice(1)) {
    const itemCode = (r[cols.itemCode] ?? '').trim();
    if (!itemCode) {
      skip('코드 없음');
      continue;
    }
    const date = parseDate(r[cols.orderDate] ?? '');
    if (!date) {
      skip('주문일 없음');
      continue;
    }
    const qty = parseNumber(r[cols.qty] ?? '');
    if (qty === null || qty <= 0) {
      skip('수량 0 이하');
      continue;
    }
    const amount = cols.amount >= 0 ? parseNumber(r[cols.amount] ?? '') : null;
    parsed.push({ itemCode, date, qty: Math.round(qty), amount: amount === null ? null : Math.round(amount) });
  }
  return { rows: parsed, skipped };
}

/** code → date → 합. 금액은 하나라도 있으면 있는 것의 합, 전부 null 이면 null. */
export function aggregateDaily(rows: DemandRow[]): Map<string, Map<string, { qty: number; amount: number | null }>> {
  const result = new Map<string, Map<string, { qty: number; amount: number | null }>>();
  for (const r of rows) {
    const byDate = result.get(r.itemCode) ?? new Map<string, { qty: number; amount: number | null }>();
    const cell = byDate.get(r.date) ?? { qty: 0, amount: null };
    cell.qty += r.qty;
    if (r.amount !== null) cell.amount = (cell.amount ?? 0) + r.amount;
    byDate.set(r.date, cell);
    result.set(r.itemCode, byDate);
  }
  return result;
}

export function resolveCoreSince(
  arg: string | null,
  existing: string | null,
  minCoreOrderDate: string | null,
): { value: string | null; warning: string | null } {
  if (existing !== null) {
    const warning =
      arg !== null && arg !== existing
        ? `--core-since ${arg} 는 기존 D0 ${existing} 와 다릅니다 — 덮어쓰지 않고 기존 값을 씁니다.`
        : null;
    return { value: existing, warning };
  }
  if (arg !== null) return { value: arg, warning: null };
  if (minCoreOrderDate !== null) return { value: minCoreOrderDate, warning: null };
  return { value: null, warning: 'core 주문이 없어 D0 를 정할 수 없습니다 — 시계열은 전부 적재하고 D0 는 비워 둡니다.' };
}

export function splitByCoreSince<T extends { date: string }>(rows: T[], coreSince: string | null): { before: T[]; onOrAfter: T[] } {
  if (coreSince === null) return { before: rows, onOrAfter: [] };
  return { before: rows.filter((r) => r.date < coreSince), onOrAfter: rows.filter((r) => r.date >= coreSince) };
}

export function unmatchedCsv(items: Array<{ itemCode: string; qty: number; days: number }>): string {
  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  return [
    '\ufeff옵션정보일련번호,수량합,발생일수',
    ...items.map((i) => [i.itemCode, i.qty, i.days].map(esc).join(',')),
  ].join('\n');
}

function parseArgs(argv: string[]): { target: string | null; coreSince: string | null } {
  const target = argv.find((a) => !a.startsWith('--')) ?? null;
  const idx = argv.indexOf('--core-since');
  const coreSince = idx >= 0 ? (argv[idx + 1] ?? null) : null;
  if (coreSince !== null && !/^\d{4}-\d{2}-\d{2}$/.test(coreSince)) {
    throw new Error(`--core-since 는 YYYY-MM-DD 여야 합니다: ${coreSince}`);
  }
  return { target, coreSince };
}

async function main() {
  const { target, coreSince: coreSinceArg } = parseArgs(process.argv.slice(2));
  if (!target) {
    console.error('사용법: npx tsx scripts/sellmate/import-demand-history.ts <파일 또는 폴더경로> [--core-since YYYY-MM-DD]');
    process.exit(1);
  }
  const stat = fs.statSync(target);
  const files = stat.isDirectory()
    ? fs
        .readdirSync(target)
        .filter((f) => ['.csv', '.xlsx', '.xls'].includes(path.extname(f).toLowerCase()))
        .sort((a, b) => a.localeCompare(b))
        .map((f) => path.join(target, f))
    : [target];
  if (files.length === 0) {
    console.error(`처리할 xls/csv/xlsx 파일이 없습니다: ${target}`);
    process.exit(1);
  }

  const DATABASE_URL = process.env.DATABASE_URL;
  if (!DATABASE_URL) {
    console.error('DATABASE_URL 환경변수가 필요합니다 (core 논리 DB).');
    process.exit(1);
  }

  console.log(`📂 처리 대상 ${files.length}개:\n   ${files.map((f) => path.basename(f)).join('\n   ')}`);
  const all: DemandRow[] = [];
  const skippedTotal = new Map<string, number>();
  for (const file of files) {
    const { rows, skipped } = parseDemandRows(await readRows(file), file);
    console.log(`   → ${rows.length}행 파싱`);
    all.push(...rows);
    for (const [k, v] of skipped) skippedTotal.set(k, (skippedTotal.get(k) ?? 0) + v);
  }
  for (const [reason, count] of skippedTotal) console.log(`   ⛔ 제외 ${count}행 — ${reason}`);

  const sql = postgres(DATABASE_URL, { max: 4 });
  try {
    const [settings] = await sql<{ d0: string | null }[]>`
      SELECT demand_core_since::text AS d0 FROM replenishment_settings WHERE key = 'default'
    `;
    if (!settings) throw new Error('replenishment_settings 가 비어 있습니다 — db:seed:ref 를 먼저 돌리세요.');
    const [minRow] = await sql<{ d: string | null }[]>`
      SELECT MIN((order_date AT TIME ZONE 'Asia/Seoul')::date)::text AS d FROM sales_orders
    `;
    const { value: coreSince, warning } = resolveCoreSince(coreSinceArg, settings.d0, minRow?.d ?? null);
    if (warning) console.warn(`⚠️  ${warning}`);
    console.log(`📅 D0(demand_core_since) = ${coreSince ?? '(없음)'} — 이 날 이전 행만 시드`);

    const { before, onOrAfter } = splitByCoreSince(all, coreSince);
    if (onOrAfter.length) console.log(`   ⛔ D0 이후 ${onOrAfter.length}행 제외 (core 가 그 구간을 소유)`);
    const agg = aggregateDaily(before);
    const codes = [...agg.keys()];

    const skuByCode = new Map<string, string>();
    for (const part of chunk(codes, 1000)) {
      const found = await sql<{ id: string; code: string }[]>`SELECT id, code FROM skus WHERE code IN ${sql(part)}`;
      for (const r of found) skuByCode.set(r.code, r.id);
    }
    const unmatched = codes.filter((c) => !skuByCode.has(c));
    if (unmatched.length) {
      fs.mkdirSync(REPORT_DIR, { recursive: true });
      const ts = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '');
      const report = path.join(REPORT_DIR, `demand-unmatched-${ts}.csv`);
      fs.writeFileSync(
        report,
        unmatchedCsv(
          unmatched.map((code) => {
            const byDate = agg.get(code)!;
            return { itemCode: code, qty: [...byDate.values()].reduce((s, c) => s + c.qty, 0), days: byDate.size };
          }),
        ),
      );
      console.log(`⚠️  core 에 없는 품목 ${unmatched.length}개 → ${report} (계속 진행)`);
    }

    const values: Array<{ sku_id: string; demand_date: string; qty: number; amount: number | null; source: 'sellmate'; updated_at: Date }> = [];
    const now = new Date();
    for (const [code, byDate] of agg) {
      const skuId = skuByCode.get(code);
      if (!skuId) continue;
      for (const [date, cell] of byDate) {
        values.push({ sku_id: skuId, demand_date: date, qty: cell.qty, amount: cell.amount, source: 'sellmate', updated_at: now });
      }
    }
    console.log(`📊 적재 대상: 품목 ${skuByCode.size}개 · (품목, 날짜) ${values.length}행`);

    if (DRY_RUN) {
      console.log('🧪 DRY_RUN — DB 미반영. 위 수치와 미매칭 리포트를 확인하세요.');
      return;
    }

    await sql.begin(async (txRaw) => {
      const tx = txRaw as unknown as Sql;
      for (const part of chunk(values, 1000)) {
        await tx`
          INSERT INTO sku_demand_daily ${tx(part, 'sku_id', 'demand_date', 'qty', 'amount', 'source', 'updated_at')}
          ON CONFLICT (sku_id, demand_date) DO UPDATE SET
            qty = excluded.qty, amount = excluded.amount, source = 'sellmate', updated_at = excluded.updated_at
        `;
      }
      if (settings.d0 === null && coreSince !== null) {
        await tx`UPDATE replenishment_settings SET demand_core_since = ${coreSince}::date, updated_at = now() WHERE key = 'default' AND demand_core_since IS NULL`;
        console.log(`✔ demand_core_since = ${coreSince} 설정`);
      }
    });
    console.log(`✔ sku_demand_daily: ${values.length}행 upsert`);
  } finally {
    await sql.end();
  }
}

// 테스트에서 import 할 때는 main 을 자동 실행하지 않는다.
if (require.main === module) {
  main().catch((err: unknown) => {
    console.error('\n❌ 실패:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx jest scripts/sellmate/import-demand-history.spec.ts`
Expected: PASS 13 tests.

- [ ] **Step 5: 로컬 DB 로 DRY_RUN 과 실제 적재를 한 번씩**

`apps/core/tmp/` 에 소형 CSV 를 만들어 돌린다(gitignore 대상이라 남지 않는다). 코드는 로컬 DB `skus.code` 에 있는 값 하나와 없는 값 하나를 쓴다:

```bash
mkdir -p apps/core/tmp
CODE=$(psql postgresql://postgres:postgres@localhost:5432/core -tAc "SELECT code FROM skus WHERE is_deleted = false LIMIT 1")
printf '옵션정보일련번호,주문일,수량,결제금액\n%s,2026-01-05,2,5000\n%s,2026-01-05,1,2500\nNOPE-1,2026-01-06,1,100\n' "$CODE" "$CODE" > apps/core/tmp/demand-smoke.csv
DRY_RUN=1 DATABASE_URL=postgresql://postgres:postgres@localhost:5432/core npx tsx scripts/sellmate/import-demand-history.ts apps/core/tmp/demand-smoke.csv --core-since 2026-07-01
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/core npx tsx scripts/sellmate/import-demand-history.ts apps/core/tmp/demand-smoke.csv --core-since 2026-07-01
psql postgresql://postgres:postgres@localhost:5432/core -c "SELECT demand_date, qty, amount, source FROM sku_demand_daily WHERE source = 'sellmate'"
psql postgresql://postgres:postgres@localhost:5432/core -c "SELECT demand_core_since FROM replenishment_settings"
```

Expected: DRY_RUN 은 `적재 대상 … 1행` 과 미매칭 리포트 경로를 찍고 끝난다. 실제 실행 뒤 `2026-01-05 | 3 | 7500 | sellmate` 한 행, `demand_core_since = 2026-07-01`. 같은 명령을 한 번 더 돌려도 행 수가 같다. 확인 뒤 정리:

```bash
psql postgresql://postgres:postgres@localhost:5432/core -c "DELETE FROM sku_demand_daily WHERE source = 'sellmate'; UPDATE replenishment_settings SET demand_core_since = NULL"
rm apps/core/tmp/demand-smoke.csv apps/core/tmp/demand-unmatched-*.csv
```

- [ ] **Step 6: README 한 절**

`scripts/sellmate/README.md` 의 스크립트 목록 뒤에 추가:

````markdown
## 주문 이력 → 수요 시계열 시드 (`import-demand-history.ts`, #743)

셀메이트 주문/판매 export(옵션정보일련번호 · 주문일 · 수량 · 금액)를 core `sku_demand_daily` 에 `source='sellmate'` 로 넣는다.
보충 제안의 수요 프로필이 이걸 읽는다. `replenishment_settings.demand_core_since`(D0) **이전** 날짜만 시드하고,
D0 가 비어 있으면 `--core-since` 또는 core 최초 주문일로 설정한다(이미 있으면 덮어쓰지 않음).

```bash
DRY_RUN=1 bash scripts/sellmate/run.sh live import-demand-history apps/core/tmp/          # 파싱 · 매칭 · 미매칭 리포트만
bash scripts/sellmate/run.sh live import-demand-history apps/core/tmp/ --core-since 2026-07-01
```

- 미매칭 품목은 중단하지 않고 `apps/core/tmp/demand-unmatched-<ts>.csv` 로 남긴다.
- 헤더가 다르면 `COL_ITEM_CODE` / `COL_ORDER_DATE` / `COL_QTY` / `COL_AMOUNT` 로 지정.
- 시드 뒤 `POST /replenishment/profiles/recompute?series=full` 로 프로필을 다시 만든다.
````

- [ ] **Step 7: 커밋**

```bash
git add scripts/sellmate/import-demand-history.ts scripts/sellmate/import-demand-history.spec.ts scripts/sellmate/README.md
git commit -m "feat(sellmate): 주문 이력 → 수요 시계열 시드 스크립트 — D0 규칙 · 미매칭 리포트 · 멱등 upsert (#743 A)

Claude-Session: https://claude.ai/code/session_01Y5Bthz8rSpjhTgrZTzGBED"
```

---

### Task 12: 전체 게이트 · 이슈 갱신 · PR

- [ ] **Step 1: 게이트 셋**

```bash
npm run type-check
npx jest --maxWorkers=2
COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- replenishment
```

Expected: type-check 에러 0 · jest 실패 0 · 통합(`replenishment` 패턴 — schema · settings.reader · demand-series.writer · demand-profile.refresher · lead-time-profile.refresher · 기존 C 의 stock.reader · suggestion) 전부 PASS.

- [ ] **Step 2: 시드 게이트 — 로컬 전체 시드가 여전히 멱등인지**

```bash
npm run db:seed:ref -- --stage local --deployment lcnine-services --yes
```

(로컬 stage 이름은 `scripts/seeding/lib/service-registry.ts` 의 것을 쓴다 — 없으면 `npm run db:setup -- --stage dev --deployment lcnine-services` 의 시드 단계로 대신하고 `Replenishment` 스텝이 `All Replenishment seed data present` 를 찍는지 본다.)

- [ ] **Step 3: 스펙 §9.1 순서로 개통 절차를 PR 본문에 적는다**

PR 본문 골격:

```markdown
## 무엇
이슈 #743 의 A 단계(스펙 §9). **마이그레이션 1 (additive, 표 5개) · 참조 시드 1행.**
- `inventory/replenishment/demand/`: 시계열 writer · 프로필 refresher · 리드타임 refresher · 야간 잡(03:40 KST) · `POST /replenishment/profiles/recompute`
- `policy/classification.ts`(순수) · `demand-profile.calculator.ts`(순수)
- `scripts/sellmate/import-demand-history.ts` — 셀메이트 주문 이력 시드
- 제안 API 는 그대로(`legacy_only`). B 가 교체한다.

## 배포 (expand)
`db:migrate → db:seed:ref → sst deploy`. 그 뒤 사람 작업(스펙 §9.1): 셀메이트 시드 → D0 확인 → `recompute?series=full` → 다음 날 크론 로그.

## 안 한 것
- 정책 층 · 규칙 CRUD · 제안 교체 · 화면 — B 단계.
- `inbound-pipeline.reader.ts` 의 PO 당 계획 1개 불변식(TODO) — 별도 이슈(스펙 §7.6).

## 검증
- `npm run type-check` 0 · `npx jest --maxWorkers=2` 0 실패 · 통합 스펙 5개(compose postgres)
- 시드 스텝 로컬 2회 실행 멱등 · 셀메이트 스크립트 로컬 DRY_RUN + 실적재 1회

설계: `docs/superpowers/specs/2026-09-08-replenishment-suggestion-design.md`

https://claude.ai/code/session_01Y5Bthz8rSpjhTgrZTzGBED
```

- [ ] **Step 4: 푸시 · PR 생성 · 이슈 코멘트**

```bash
git push -u origin feat/743-replenishment-stage-a
gh pr create --base develop --title "feat(replenishment): 수요 시계열 · 프로필 · 리드타임 통계 층 + 야간 잡 + 셀메이트 시드 (#743 A 단계)" --body-file <(cat <<'EOF'
(위 PR 본문)
EOF
)
gh issue comment 743 --body "A 단계(통계 층) 구현 브랜치 \`feat/743-replenishment-stage-a\` → PR 생성. 표 5개 · 마이그 1 · 참조 시드 1행 · 야간 잡 03:40 KST · \`POST /replenishment/profiles/recompute\` · 셀메이트 시드 스크립트. 제안 API 는 C 그대로. 배포 순서 \`db:migrate → db:seed:ref → sst deploy\`, 그 뒤 스펙 §9.1 사람 작업."
```

---

## Self-review (작성자가 한 번 훑은 결과)

- **스펙 커버리지**: §4.1(시계열 · core 적재 규칙 · 14일 창 · 전량 재계산 엔드포인트) → Task 1 · 7 · 10. §4.2(시드 스크립트) → Task 11. §4.3(프로필 · 계산 규칙 · 등급) → Task 1 · 6 · 8. §4.4(리드타임 관측) → Task 1 · 9 (「SKU 의 공급사와 출발 창고」는 C 의 stock.reader 가 이미 갖고, `default_warehouse_id` 사용은 B). §6 의 `replenishment_settings` 표 + 초기값 시드 → Task 1 · 2. §8.2 A 표시 파일 → Task 3~10. §8.3 야간 배치(단계 단위 실패 · 멱등 · 03:40) → Task 10. §9 A 행 배포 순서 → Task 12. §10 단위(`classification` · `demand-profile.calculator`) · 통합(`demand-series.writer` · `lead-time-profile.refresher`) · 아키텍처(순수 파일 등록 · 라우트 표) → Task 5 · 6 · 7 · 9 · 10.
- **스펙에 있지만 A 가 안 하는 것(의도)**: `replenishment_settings` PUT · 등급 규칙 3행 시드 · `insufficient` 플래그가 제안에 붙는 것 — 전부 B.
- **타입 일관성**: `ReplenishmentSettings` (Task 1) 를 Task 3 · 8 · 9 · 10 이 같은 이름으로 쓴다. `DemandRebuildResult` · `ProfileRefreshResult` · `LeadTimeRefreshResult` 의 필드가 Task 10 의 DTO · 잡 스펙과 일치한다. `computeDemandProfile(points, firstDate, windows, thresholds)` 인자 순서가 Task 6 스펙 · Task 8 호출에서 같다. `kstDateOf` · `addDays` 는 Task 4 이름 그대로.
- **자리표시 없음**: 모든 코드 스텝에 실제 코드가 있다. 셀메이트 export 의 실제 헤더는 저장소에 기록이 없어 별칭 배열 + env 오버라이드로 방어했고(Task 11), 실행 시 감지된 매핑을 출력한다.
