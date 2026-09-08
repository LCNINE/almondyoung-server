# 재고 보충 제안 재설계 — B 단계 (정책 층) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** C 의 자리표시 규칙(안전재고 = 재주문점 = 목표수준 = `skus.safety_stock`)을 **A 가 쌓은 수요 · 리드타임 프로필과 사람이 소유하는 규칙(전역 · 등급 · 공급사 · 경로 · SKU 예외)으로 계산한 (s, S) 정책**으로 교체한다. 규칙 CRUD 13라우트와 규칙 화면 · 프로필 드로어를 붙이고, `skus.safety_stock` 을 코드가 더 이상 읽지 않게 한다(column drop 1단계).

**Architecture:** 순수 층 셋 — `policy/distributions.ts`(Φ⁻¹ · 감마 분위수) · `policy/replenishment-policy.ts`(§5 공식) · `rules/effective-parameters.ts`(§6 우선순위). `rules/` 의 Reader/Manager/Service/Controller 가 규칙 표 4개를 소유한다. `ReplenishmentSuggestionReader` 는 C 의 오케스트레이션(재료 5회 조회 → 순수 조립) 안에 프로필 · 규칙 · 리드타임 조회와 정책 호출을 끼우고, 조립기는 `levelsFor` 만 교체한다(축 판정은 그대로). C 가 남긴 TODO 둘(draft 합의 출발 창고 좁힘 · 판매 창고에서 나가는 draft 제외)을 여기서 닫는다. 테이블 4개 · 마이그레이션 1건 · 시드 3행.

**Tech Stack:** NestJS 11 + drizzle-orm · Jest(단위 · `describeIfDb` 통합) · Next.js admin-web(TanStack Query · shadcn ui · sonner · `useState` 폼)

**Spec:** `docs/superpowers/specs/2026-09-08-replenishment-suggestion-design.md` — §5(공식) · §6(규칙 · 우선순위 · 초기값 · `skus.safety_stock` 거취) · §7.3(응답, B 확장) · §7.4(B 라우트) · §7.6(C 의 TODO 거취) · §8.1(B 표 4개) · §8.2(B 표시 파일) · §8.4(드로어 · 규칙 화면 · SKU 폼) · §9 **B 행** · §9.2 · §10. **A 단계 플랜(`2026-09-08-replenishment-stage-a-statistics.md`)이 머지돼 있어야 한다** — 표 5개 · `ReplenishmentSettingsReader` · `classification.ts` · `demand/calendar.ts` 를 전제한다.

## Global Constraints

- 브랜치 `feat/743-replenishment-stage-b` (A 머지 후 develop 에서 분기). 모든 태스크는 이 브랜치에 커밋한다.
- 커밋 메시지는 한국어, 본문 마지막 줄에 `Claude-Session: https://claude.ai/code/session_01Y5Bthz8rSpjhTgrZTzGBED`.
- **마이그레이션 1건, additive 만.** `schema.ts` + 생성 SQL + `drizzle/meta/` 를 한 커밋에. 배포는 expand 순서 **`db:migrate → db:seed:ref → sst deploy`**, A 가 먼저 배포돼 있어야 한다(프로필이 비면 전 SKU 가 `insufficient`).
- 실수 열은 `doublePrecision`, 달력 날짜는 `date({ mode: 'string' })`. `updated_by` 는 열만 두고 채우지 않는다(스펙 §8.1 — actor 배관 없음).
- 순수 층(`policy/*` · `rules/effective-parameters.ts` · `suggestion.assembler.ts` · `suggestion.types.ts`)은 `@nestjs/*` · `drizzle-orm` · `@app/db` 를 import 하지 않는다. `policy/` 는 경계 스펙이 자동으로 잡고, `effective-parameters.ts` 는 Task 8 에서 이름으로 등록한다.
- `replenishment/` ↔ `procurement/` import 0. 실행(카트 · 이동 지시서)은 화면이 기존 API 를 부른다.
- 레이어 규칙(CLAUDE.md): Controller 는 try/catch 로 상태코드를 매핑하지 않는다. Service 는 2~3줄 위임. 검증 · 쓰기는 Manager, 조회는 Reader. 도메인 예외는 `@app/shared` 의 `NotFoundError` · `BadRequestError` · `ConflictError`.
- Inventory 질의 규칙: `db.query.*` · `with` 관계 · `any` 금지. `as` 캐스트는 스펙의 mock 주입에만. DB 주입은 `@InjectTypedDb<typeof wmsSchema>()`, 트랜잭션은 `this.dbService.run(fn, tx)`, 공개 메서드는 `tx?: DbTx` 마지막 인자.
- 중첩 DTO 는 전부 별도 클래스, `@ApiProperty({ type: 'object' })` 금지. PUT 본문은 class-validator 로 검증(전역 파이프 `whitelist: true, transform: true` — 숫자 쿼리엔 `@Type(() => Number)`).
- 새 라우트 13개는 전부 `@RequireScopes(INVENTORY_SCOPE.MANAGE)` + `@UseGuards(ScopeGuard)`, `platform/auth/inventory-scope-coverage.spec.ts` 표에 등록(개수 59 → 72).
- 검증 게이트: `npm run type-check` 에러 0 · `npx jest --maxWorkers=2` 실패 0 · `cd apps/admin-web && npx tsc --noEmit` 에러 0 · `npm run test:admin-web` 실패 0. 통합 스펙은 `COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- <파일명>`. 스펙 안 `dotenv.config()` 금지. `describeIfDb` 는 스펙마다 `const describeIfDb = process.env.DATABASE_URL ? describe : describe.skip;`.
- 통합 스펙은 `inRollbackTx` 안에서 돌고 DELETE 로 청소하지 않는다. 판매 창고를 하나로 만드는 `trx.update(wmsTables.warehouses).set({ isSellable: false })` 는 롤백되므로 허용.
- admin-web 은 컴포넌트 테스트가 없다 — 판정 · 정렬 · 표시 변환 · 폼 직렬화는 `.ts` 순수 함수로 빼 `npm run test:admin-web` 으로 검증한다. `lib/services/**` 의 mutation 훅은 toast 를 부르지 않는다(호출처가 부른다). axios 4xx 는 `CustomError`(`statusCode`) 로 던져진다 — `error.response.status` 가 아니다.
- `skus.safety_stock` **컬럼 자체는 이 단계에서 지우지 않는다** (schema.ts 에 남는다). 코드의 명시적 읽기 · 쓰기 · DTO 노출만 지운다. DROP 은 배포 한 번 뒤의 contract PR.

---

## File Structure

| 경로 | 책임 | 태스크 |
|---|---|---|
| `apps/core/src/modules/inventory/schema/inventory.schema.ts` · `enum-values.ts` (수정) · `apps/core/drizzle/<ts>_add-replenishment-rule-tables.sql` + `meta/` (생성) · `schema/replenishment-rules-schema.integration.spec.ts` (신설) | 규칙 표 4개 + enum 1 | 1 |
| `scripts/seeding/steps/replenishment.seed-step.ts` + `.spec.ts` (수정) | 등급 규칙 3행 시드 | 1 |
| `.../replenishment/policy/distributions.ts` + `.spec.ts` (신설) | Φ⁻¹ · 감마 분위수 (순수) | 2 |
| `.../replenishment/policy/replenishment-policy.ts` + `.spec.ts` (신설) | §5 공식 · 리드타임 합성 (순수) | 3 |
| `.../replenishment/rules/effective-parameters.ts` + `.spec.ts` (신설) | §6 우선순위 · 제외 판정 (순수) | 4 |
| `.../replenishment/rules/replenishment-rules.reader.ts` · `.manager.ts` · `.service.ts` · `.../dto/replenishment-rules.dto.ts` · `.../controllers/replenishment-rules.controller.ts` (+`.spec.ts`) · `rules/replenishment-rules.integration.spec.ts` (신설) · `replenishment.module.ts` · `platform/auth/inventory-scope-coverage.spec.ts` (수정) | 규칙 CRUD 13라우트 | 5 |
| `.../warehouse-transfer/services/warehouse-transfer.reader.ts` + `.integration.spec.ts` (수정) | draft 합을 비판매 출발 창고별로 | 6 |
| `.../replenishment/demand/demand-profile.reader.ts` (신설) · `.../suggestion/suggestion.types.ts` · `suggestion.assembler.ts` (+`.spec.ts`) · `replenishment-stock.reader.ts` (+`.integration.spec.ts`) · `replenishment-suggestion.reader.ts` · `replenishment-suggestion.service.ts` (+`.integration.spec.ts`) · `.../dto/replenishment-suggestion.dto.ts` (수정) | 제안 교체 · 상세 응답 확장 | 6 |
| `.../sku-catalog/dto/create-sku.dto.ts` · `sku-response.dto.ts` · `advanced-filters.dto.ts` · `services/sku-catalog.reader.ts` · `.../sku-group/services/sku-group.reader.ts` · `dto/sku-group-response.dto.ts` (수정) | `skus.safety_stock` 읽기 중단 (core) | 7 |
| `apps/admin-web/src/lib/types/dto/inventory.ts` · `features/inventory/skus/components/sku-form-dialog/index.tsx` · `hooks/table/columns/use-skus-table-columns.tsx` (수정) | `safetyStock` 제거 (admin-web) | 7 |
| `apps/core/src/modules/inventory/replenishment-boundary.arch.spec.ts` (수정) | 순수 파일 등록 | 8 |
| `apps/admin-web/src/lib/types/dto/inventory.ts` · `lib/api/domains/inventory/replenishment.client.ts` · `lib/services/inventory/query-keys.ts` · `queries.ts` · `mutations.ts` · `features/inventory/replenishment/suggestion-model.ts` (+`.spec.ts`) (수정) | 타입 · 클라이언트 · 훅 · 상태코드 판독 수정 | 9 |
| `apps/admin-web/src/features/inventory/replenishment/rules-model.ts` + `.spec.ts` · `features/inventory/replenishment/rules/template/index.tsx` · `rules/components/{settings-tab,grades-tab,suppliers-tab,routes-tab,sku-overrides-tab}/index.tsx` · `app/(admin)/inventory/replenishment/rules/page.tsx` (신설) · `lib/utils/menu.ts` (+`.spec.ts`) · `components/common/breadcrumb-items.ts` (+`.spec.ts`) (수정) | 규칙 화면 | 10 |
| `apps/admin-web/src/features/inventory/replenishment/components/sku-drawer/index.tsx` · `components/table/index.tsx` · `template/index.tsx` · `features/inventory/skus/components/sku-form-dialog/index.tsx` (수정) | 프로필 드로어 · 표 · SKU 폼 링크 | 11 |

---

### Task 0: 브랜치

- [ ] **Step 1: A 머지 확인 후 develop 에서 분기**

```bash
git checkout develop && git pull --ff-only
git log --oneline -20 | grep -i "743 A" || echo "A 단계가 아직 develop 에 없다 — 먼저 머지"
test -f apps/core/src/modules/inventory/replenishment/demand/replenishment-settings.reader.ts || echo "A 파일 없음"
git checkout -b feat/743-replenishment-stage-b
```

---

### Task 1: 스키마 — 규칙 표 4개 · enum 1 · 마이그레이션 · 등급 시드 3행

**Files:**
- Modify: `apps/core/src/modules/inventory/schema/inventory.schema.ts` (ENUM 블록 · A 의 `REPLENISHMENT` 섹션 뒤 · `wmsTables` · 타입 블록)
- Modify: `apps/core/src/modules/inventory/schema/enum-values.ts`
- Create: `apps/core/drizzle/<timestamp>_add-replenishment-rule-tables.sql` (생성) + `meta/`
- Test: `apps/core/src/modules/inventory/schema/replenishment-rules-schema.integration.spec.ts`
- Modify: `scripts/seeding/steps/replenishment.seed-step.ts` + `.spec.ts`

**Interfaces:**
- Produces: drizzle 표 `replenishmentGradeRules` · `replenishmentSupplierRules` · `replenishmentRouteRules` · `replenishmentSkuOverrides`, enum `replenishmentOverrideModeEnum` (`'auto' | 'excluded'`), 타입 `ReplenishmentGradeRule` · `ReplenishmentSupplierRule` · `ReplenishmentRouteRule` · `ReplenishmentSkuOverride`, `enum-values.ts` 의 `replenishmentOverrideModeValues` · `ReplenishmentOverrideModeEnum`, 시드 상수 `REPLENISHMENT_GRADE_RULE_SEEDS` (A 0.02 · B 0.05 · C 0.10).

- [ ] **Step 1: 실패하는 통합 스펙**

```ts
// apps/core/src/modules/inventory/schema/replenishment-rules-schema.integration.spec.ts
import * as postgres from 'postgres';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { sql, eq } from 'drizzle-orm';
import { wmsSchema, wmsTables, DbTx } from './inventory.schema';
import { makeDb, inRollbackTx, seedHolder, seedSku, seedWarehouseWithZone } from '../../fulfillment/services/__support__';

/**
 * B 단계 규칙 표 4개(스펙 §8.1). 실행: COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- replenishment-rules-schema.integration
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

/**
 * drizzle-orm 0.44.x 는 모든 쿼리 에러를 DrizzleQueryError 로 감싼다 — 최상위 `.message` 는
 * "Failed query: ...\nparams: ..." 뿐이고 실제 Postgres 메시지는 `.cause` 에만 남는다. jest 의
 * `toThrow(regex)` 는 최상위 `.message` 만 보므로 그걸로는 절대 매치되지 않는다 — A 단계
 * (`replenishment-schema.integration.spec.ts`)가 이미 이 문제를 겪었고 같은 헬퍼로 풀었다.
 * cause 체인을 직접 걸어서 합친 문자열로 검사한다.
 */
function causeChainMessage(error: unknown, depth = 5): string {
  const parts: string[] = [];
  let current: (Error & { cause?: unknown }) | undefined = error instanceof Error ? error : undefined;
  for (let i = 0; current && i < depth; i += 1) {
    parts.push(current.message);
    current = current.cause instanceof Error ? current.cause : undefined;
  }
  return parts.join(' ');
}

describeIfDb('replenishment rule schema (B)', () => {
  jest.setTimeout(60_000);
  let client: postgres.Sql;
  let db: PostgresJsDatabase<typeof wmsSchema>;

  beforeAll(() => {
    ({ sql: client, db } = makeDb(DATABASE_URL as string));
  });
  afterAll(async () => {
    await client.end();
  });

  it('표 4개가 존재한다', async () => {
    for (const name of ['replenishment_grade_rules', 'replenishment_supplier_rules', 'replenishment_route_rules', 'replenishment_sku_overrides']) {
      const rows = await db.execute(sql`SELECT to_regclass(${'public.' + name})::text AS name`);
      // execute() 원시 결과 타이핑 — ledger-reconciliation.service.ts:120 과 같은 문서화된 캐스트.
      const [row] = rows as unknown as Array<{ name: string | null }>;
      expect(row.name).toBe(name);
    }
  });

  it('SKU 예외는 mode 기본 auto, alpha 는 (0,1), safety_stock ≥ 0, SKU 삭제에 cascade', async () => {
    await inRollbackTx(db, async (trx: DbTx) => {
      const { holderId } = await seedHolder(trx);
      const { skuId } = await seedSku(trx, holderId);
      const [row] = await trx.insert(wmsTables.replenishmentSkuOverrides).values({ skuId }).returning();
      expect(row.mode).toBe('auto');
      expect(row.excludedUntil).toBeNull();
      let caught: unknown;
      try {
        await trx.update(wmsTables.replenishmentSkuOverrides).set({ alpha: 1 }).where(eq(wmsTables.replenishmentSkuOverrides.skuId, skuId));
      } catch (error) {
        caught = error;
      }
      expect(causeChainMessage(caught)).toMatch(/ck_replenishment_sku_overrides_alpha/);
    });
    await inRollbackTx(db, async (trx: DbTx) => {
      const { holderId } = await seedHolder(trx);
      const { skuId } = await seedSku(trx, holderId);
      let caught: unknown;
      try {
        await trx.insert(wmsTables.replenishmentSkuOverrides).values({ skuId, safetyStock: -1 });
      } catch (error) {
        caught = error;
      }
      expect(causeChainMessage(caught)).toMatch(/ck_replenishment_sku_overrides_safety_stock/);
    });
    await inRollbackTx(db, async (trx: DbTx) => {
      const { holderId } = await seedHolder(trx);
      const { skuId } = await seedSku(trx, holderId);
      await trx.insert(wmsTables.replenishmentSkuOverrides).values({ skuId, mode: 'excluded', excludedUntil: '2026-12-31' });
      await trx.delete(wmsTables.skus).where(eq(wmsTables.skus.id, skuId));
      expect(await trx.select().from(wmsTables.replenishmentSkuOverrides).where(eq(wmsTables.replenishmentSkuOverrides.skuId, skuId))).toEqual([]);
    });
  });

  it('공급사 규칙은 공급사 삭제를 막는다(restrict), 경로 규칙은 from ≠ to', async () => {
    await inRollbackTx(db, async (trx: DbTx) => {
      const { warehouseId } = await seedWarehouseWithZone(trx);
      const [supplier] = await trx.insert(wmsTables.suppliers).values({ name: 'it-sup', defaultWarehouseId: warehouseId }).returning({ id: wmsTables.suppliers.id });
      await trx.insert(wmsTables.replenishmentSupplierRules).values({ supplierId: supplier.id, leadTimeDays: 30, coverDays: 30 });
      let caught: unknown;
      try {
        await trx.delete(wmsTables.suppliers).where(eq(wmsTables.suppliers.id, supplier.id));
      } catch (error) {
        caught = error;
      }
      expect(causeChainMessage(caught)).toMatch(/foreign key/);
    });
    await inRollbackTx(db, async (trx: DbTx) => {
      const { warehouseId } = await seedWarehouseWithZone(trx);
      let caught: unknown;
      try {
        await trx.insert(wmsTables.replenishmentRouteRules).values({ fromWarehouseId: warehouseId, toWarehouseId: warehouseId, leadTimeDays: 14, coverDays: 14 });
      } catch (error) {
        caught = error;
      }
      expect(causeChainMessage(caught)).toMatch(/ck_replenishment_route_rules_distinct/);
    });
  });

  it('등급 규칙은 grade 가 PK 다', async () => {
    await inRollbackTx(db, async (trx: DbTx) => {
      await trx.delete(wmsTables.replenishmentGradeRules);
      await trx.insert(wmsTables.replenishmentGradeRules).values({ grade: 'A', alpha: 0.02 });
      let caught: unknown;
      try {
        await trx.insert(wmsTables.replenishmentGradeRules).values({ grade: 'A', alpha: 0.03 });
      } catch (error) {
        caught = error;
      }
      expect(causeChainMessage(caught)).toMatch(/duplicate key/);
    });
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- replenishment-rules-schema.integration`
Expected: FAIL — `Property 'replenishmentSkuOverrides' does not exist`.

- [ ] **Step 3: ENUM 블록의 A enum 3개 뒤에**

```ts
export const replenishmentOverrideModeEnum = pgEnum('replenishment_override_mode', ['auto', 'excluded']);
```

- [ ] **Step 4: A 의 `routeLeadTimeProfiles` 표 바로 뒤에 표 4개**

```ts
/*───────────────────────────
 * REPLENISHMENT — 규칙 층 (#743 B, 스펙 §6). 사람이 소유하는 입력. 마스터 표에 컬럼을 얹지 않는다(D6).
 *──────────────────────────*/

/** 등급별 목표 예측 실패율 α. 3행(A · B · C)은 시드가 채운다 — 등급은 모든 SKU 에 있어 α 가 빠지지 않는다. */
export const replenishmentGradeRules = pgTable('replenishment_grade_rules', {
  grade: demandGradeEnum('grade').primaryKey(),
  alpha: doublePrecision('alpha').notNull(),
  updatedBy: uuid('updated_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/** 공급사 L1 규칙. 관측(n ≥ min_lead_time_observations) 이 있으면 관측이 이긴다(§6 우선순위). */
export const replenishmentSupplierRules = pgTable('replenishment_supplier_rules', {
  supplierId: uuid('supplier_id')
    .primaryKey()
    .references(() => suppliers.id, { onDelete: 'restrict' }),
  leadTimeDays: doublePrecision('lead_time_days').notNull(),
  leadTimeStdDays: doublePrecision('lead_time_std_days'),
  coverDays: integer('cover_days').notNull(),
  updatedBy: uuid('updated_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/** 창고 쌍 L2 규칙. */
export const replenishmentRouteRules = pgTable(
  'replenishment_route_rules',
  {
    fromWarehouseId: uuid('from_warehouse_id')
      .references(() => warehouses.id, { onDelete: 'restrict' })
      .notNull(),
    toWarehouseId: uuid('to_warehouse_id')
      .references(() => warehouses.id, { onDelete: 'restrict' })
      .notNull(),
    leadTimeDays: doublePrecision('lead_time_days').notNull(),
    leadTimeStdDays: doublePrecision('lead_time_std_days'),
    coverDays: integer('cover_days').notNull(),
    updatedBy: uuid('updated_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey(t.fromWarehouseId, t.toWarehouseId),
    ckDistinct: check('ck_replenishment_route_rules_distinct', sql`${t.fromWarehouseId} <> ${t.toWarehouseId}`),
  }),
);

/** SKU 예외. excluded 는 제안에서 빠진다(excluded_until 이 오늘보다 앞이면 auto). safety_stock 은 계산을 대체. */
export const replenishmentSkuOverrides = pgTable(
  'replenishment_sku_overrides',
  {
    skuId: uuid('sku_id')
      .primaryKey()
      .references(() => skus.id, { onDelete: 'cascade' }),
    mode: replenishmentOverrideModeEnum('mode').notNull().default('auto'),
    excludedUntil: date('excluded_until', { mode: 'string' }),
    safetyStock: integer('safety_stock'),
    alpha: doublePrecision('alpha'),
    memo: varchar('memo', { length: 255 }),
    updatedBy: uuid('updated_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    idxReplenishmentSkuOverridesMode: index('idx_replenishment_sku_overrides_mode').on(t.mode),
    ckAlpha: check('ck_replenishment_sku_overrides_alpha', sql`${t.alpha} IS NULL OR (${t.alpha} > 0 AND ${t.alpha} < 1)`),
    ckSafetyStock: check('ck_replenishment_sku_overrides_safety_stock', sql`${t.safetyStock} IS NULL OR ${t.safetyStock} >= 0`),
  }),
);
```

- [ ] **Step 5: `wmsTables` 의 A 항목 뒤에 등록 · 타입 · enum-values**

```ts
  routeLeadTimeProfiles,

  // 재고 보충 규칙 층 (#743 B)
  replenishmentGradeRules,
  replenishmentSupplierRules,
  replenishmentRouteRules,
  replenishmentSkuOverrides,
} as const;
```

타입 블록(A 의 `RouteLeadTimeProfile` 뒤):

```ts
export type ReplenishmentGradeRule = InferSelectModel<typeof replenishmentGradeRules>;
export type ReplenishmentSupplierRule = InferSelectModel<typeof replenishmentSupplierRules>;
export type ReplenishmentRouteRule = InferSelectModel<typeof replenishmentRouteRules>;
export type ReplenishmentSkuOverride = InferSelectModel<typeof replenishmentSkuOverrides>;
export type NewReplenishmentSkuOverride = InferInsertModel<typeof replenishmentSkuOverrides>;
```

`enum-values.ts` import 에 `replenishmentOverrideModeEnum` 추가, 끝에:

```ts
export const replenishmentOverrideModeValues = replenishmentOverrideModeEnum.enumValues;
export type ReplenishmentOverrideModeEnum = (typeof replenishmentOverrideModeValues)[number];
```

- [ ] **Step 6: 마이그레이션 생성 · 검토 · 통합 스펙 통과**

```bash
npm run db:generate:core -- --name add-replenishment-rule-tables
```

SQL 에 `CREATE TYPE "public"."replenishment_override_mode"` 1, `CREATE TABLE` 4, FK 5(공급사 1 · 경로 2 · SKU 1 … `demand_grade` 는 enum 이라 FK 없음), `CHECK` 3, `CREATE INDEX` 1. `DROP` · `ALTER COLUMN` 이 있으면 되돌리고 schema 를 고친다.

Run: `COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- replenishment-rules-schema.integration`
Expected: PASS 4 tests. `npm run type-check` 에러 0.

- [ ] **Step 7: 등급 시드 3행 — 스펙 먼저**

`scripts/seeding/steps/replenishment.seed-step.spec.ts` 에 추가:

```ts
import { REPLENISHMENT_GRADE_RULE_SEEDS } from './replenishment.seed-step';

  it('등급 규칙 시드는 A 0.02 · B 0.05 · C 0.10 (스펙 §6 초기값)', () => {
    expect(REPLENISHMENT_GRADE_RULE_SEEDS).toEqual([
      { grade: 'A', alpha: 0.02 },
      { grade: 'B', alpha: 0.05 },
      { grade: 'C', alpha: 0.1 },
    ]);
  });
```

Run: `npx jest scripts/seeding/steps/replenishment.seed-step.spec.ts` → FAIL (`REPLENISHMENT_GRADE_RULE_SEEDS` 없음).

- [ ] **Step 8: 시드 스텝 확장**

`scripts/seeding/steps/replenishment.seed-step.ts`:

```ts
export const REPLENISHMENT_GRADE_RULE_SEEDS = [
  { grade: 'A', alpha: 0.02 },
  { grade: 'B', alpha: 0.05 },
  { grade: 'C', alpha: 0.1 },
] as const;
```

`check()` 의 `items` 에 항목 추가:

```ts
    const existingGrades = await this.findExistingKeys(
      'replenishment_grade_rules',
      REPLENISHMENT_GRADE_RULE_SEEDS.map((g) => g.grade),
      'grade',
    );
    const missingGrades = REPLENISHMENT_GRADE_RULE_SEEDS.filter((g) => !existingGrades.has(g.grade));
    // items 배열에:
      {
        entity: 'replenishment_grade_rules',
        expected: REPLENISHMENT_GRADE_RULE_SEEDS.length,
        existing: REPLENISHMENT_GRADE_RULE_SEEDS.length - missingGrades.length,
        missing: missingGrades.length,
        missingDetails: missingGrades.map((g) => g.grade),
      },
```

`isFullySeeded` 는 `items.every((i) => i.missing === 0)` 로 바꾸고 `summary` 의 missing 합도 `items.reduce`. `apply()` 에 2단계 추가 (`this.logger.step(2, 2, 'Inserting grade rules')`):

```ts
      for (const g of REPLENISHMENT_GRADE_RULE_SEEDS) {
        await this.db.execute(sql`
          INSERT INTO replenishment_grade_rules (grade, alpha) VALUES (${g.grade}, ${g.alpha})
          ON CONFLICT (grade) DO NOTHING
        `);
      }
```

`itemsApplied` 는 `1 + REPLENISHMENT_GRADE_RULE_SEEDS.length`, 1단계 로그는 `step(1, 2, …)` 로.

Run: `npx jest scripts/seeding/steps/replenishment.seed-step.spec.ts` → PASS 3 tests. A 의 Task 2 Step 5 와 같은 `npx tsx -e` 한 줄로 로컬 DB 에 apply → check 가 `isFullySeeded: true`.

- [ ] **Step 9: 커밋 (schema + SQL + meta + 시드 를 한 커밋)**

```bash
git add apps/core/src/modules/inventory/schema apps/core/drizzle scripts/seeding/steps/replenishment.seed-step.ts scripts/seeding/steps/replenishment.seed-step.spec.ts
git commit -m "feat(core): 재고 보충 규칙 표 4개 — 등급 · 공급사 · 경로 · SKU 예외, 등급 시드 3행 (#743 B)

Claude-Session: https://claude.ai/code/session_01Y5Bthz8rSpjhTgrZTzGBED"
```

---
### Task 2: `policy/distributions.ts` — Φ⁻¹ · 감마 분위수 (순수)

**Files:**
- Create: `apps/core/src/modules/inventory/replenishment/policy/distributions.ts`
- Test: `apps/core/src/modules/inventory/replenishment/policy/distributions.spec.ts`

**Interfaces:**
- Produces:
  ```ts
  export function normalCdf(x: number): number
  export function normalQuantile(p: number): number            // p ∈ (0, 1) 아니면 throw
  export function lnGamma(x: number): number                   // x > 0
  export function regularizedGammaP(shape: number, x: number): number
  export function gammaQuantile(p: number, shape: number, scale: number): number   // shape > 0 · scale > 0
  ```
  참조값은 **카이제곱 표**다 — Γ(k, θ=2) = χ²(2k) 이고 χ²(2, p) = −2·ln(1−p) 는 닫힌 식이라 외부 라이브러리 없이 검증된다. 정규 분위수는 표준 표 값.

- [ ] **Step 1: 실패하는 테스트**

```ts
// apps/core/src/modules/inventory/replenishment/policy/distributions.spec.ts
import { gammaQuantile, lnGamma, normalCdf, normalQuantile, regularizedGammaP } from './distributions';

describe('normal', () => {
  it('Φ⁻¹ 표준 표 값', () => {
    expect(normalQuantile(0.5)).toBeCloseTo(0, 6);
    expect(normalQuantile(0.9)).toBeCloseTo(1.28155, 4);
    expect(normalQuantile(0.95)).toBeCloseTo(1.64485, 4);
    expect(normalQuantile(0.975)).toBeCloseTo(1.95996, 4);
    expect(normalQuantile(0.98)).toBeCloseTo(2.05375, 4);
    expect(normalQuantile(0.99)).toBeCloseTo(2.32635, 4);
    expect(normalQuantile(0.05)).toBeCloseTo(-1.64485, 4);
  });
  it('Φ 와 역함수가 맞물린다', () => {
    expect(normalCdf(1.95996)).toBeCloseTo(0.975, 5);
    expect(normalCdf(0)).toBeCloseTo(0.5, 9);
    expect(normalCdf(normalQuantile(0.8))).toBeCloseTo(0.8, 6);
  });
  it('p 가 (0,1) 밖이면 던진다', () => {
    expect(() => normalQuantile(0)).toThrow();
    expect(() => normalQuantile(1)).toThrow();
  });
});

describe('gamma', () => {
  it('lnΓ: Γ(1)=1 · Γ(5)=24 · Γ(½)=√π', () => {
    expect(lnGamma(1)).toBeCloseTo(0, 9);
    expect(lnGamma(5)).toBeCloseTo(Math.log(24), 9);
    expect(lnGamma(0.5)).toBeCloseTo(Math.log(Math.sqrt(Math.PI)), 9);
  });
  it('정규화 불완전감마 P: P(1,x)=1−e^−x · P(½,1)=erf(1)', () => {
    expect(regularizedGammaP(1, 1)).toBeCloseTo(1 - Math.exp(-1), 8);
    expect(regularizedGammaP(1, 3)).toBeCloseTo(1 - Math.exp(-3), 8);
    expect(regularizedGammaP(0.5, 1)).toBeCloseTo(0.8427008, 6);
    expect(regularizedGammaP(5, 0)).toBe(0);
  });

  // Γ(k, θ=2) = χ²(2k). 카이제곱 임계표(df = 1 · 2 · 4 · 10 · 40, p = 0.90 · 0.95 · 0.99).
  const CHI2: Array<[df: number, p: number, value: number]> = [
    [1, 0.9, 2.7055], [1, 0.95, 3.8415], [1, 0.99, 6.6349],
    [2, 0.9, 4.6052], [2, 0.95, 5.9915], [2, 0.99, 9.2103],
    [4, 0.9, 7.7794], [4, 0.95, 9.4877], [4, 0.99, 13.2767],
    [10, 0.9, 15.9872], [10, 0.95, 18.307], [10, 0.99, 23.2093],
    [40, 0.9, 51.8051], [40, 0.95, 55.7585], [40, 0.99, 63.6907],
  ];
  it.each(CHI2)('χ²(df=%i, p=%f) = %f', (df, p, value) => {
    expect(gammaQuantile(p, df / 2, 2)).toBeCloseTo(value, 2);
  });
  it('χ²(2, p) = −2·ln(1−p) 닫힌 식과 일치', () => {
    for (const p of [0.5, 0.8, 0.9, 0.95, 0.98, 0.99, 0.999]) {
      expect(gammaQuantile(p, 1, 2)).toBeCloseTo(-2 * Math.log(1 - p), 6);
    }
  });
  it('척도는 선형이다', () => {
    expect(gammaQuantile(0.95, 1, 10)).toBeCloseTo(10 * -Math.log(0.05), 6);
  });
  it('CV → 0 이면 정규로 수렴한다 — μ 100 · σ 5 (k = 400) 의 95% 분위수는 100 + 1.645·5 근처', () => {
    const mu = 100;
    const sigma = 5;
    const shape = (mu * mu) / (sigma * sigma);
    const scale = (sigma * sigma) / mu;
    expect(gammaQuantile(0.95, shape, scale)).toBeCloseTo(mu + 1.64485 * sigma, 0);
  });
  it('shape · scale 이 0 이하거나 p 가 (0,1) 밖이면 던진다', () => {
    expect(() => gammaQuantile(0.95, 0, 1)).toThrow();
    expect(() => gammaQuantile(0.95, 1, 0)).toThrow();
    expect(() => gammaQuantile(1, 1, 1)).toThrow();
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx jest apps/core/src/modules/inventory/replenishment/policy/distributions.spec.ts`
Expected: FAIL — `Cannot find module './distributions'`

- [ ] **Step 3: 구현**

```ts
// apps/core/src/modules/inventory/replenishment/policy/distributions.ts
/**
 * 정규 · 감마 분포의 CDF 와 분위수 (스펙 §5.1). 외부 라이브러리 없이, 순수 함수 — Nest · drizzle 을 모른다.
 *
 * - Φ: Abramowitz–Stegun 7.1.26 erf 근사(|ε| < 1.5e-7). 분위수는 이분법.
 * - lnΓ: Lanczos(g=7, n=9). P(k, x): 급수(x < k+1) / 연분수(그 외) — Numerical Recipes gser · gcf.
 * - 감마 분위수: P(k, x/θ) 를 이분법으로 역산. 상한은 평균 + 10σ 에서 시작해 부족하면 두 배씩.
 */
const SQRT_2PI = Math.sqrt(2 * Math.PI);
const LANCZOS = [
  0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
  12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
];

function assertProbability(p: number): void {
  if (!(p > 0 && p < 1)) throw new Error(`확률은 (0, 1) 안이어야 한다: ${p}`);
}

/** 단조 f 에서 f(x) = target 인 x 를 [lo, hi] 이분법으로. */
function bisect(f: (x: number) => number, target: number, lo: number, hi: number): number {
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (f(mid) < target) lo = mid;
    else hi = mid;
    if (hi - lo < 1e-12 * Math.max(1, Math.abs(hi))) break;
  }
  return (lo + hi) / 2;
}

export function normalCdf(x: number): number {
  const z = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * z);
  const poly = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  const erf = 1 - poly * Math.exp(-z * z);
  return 0.5 * (1 + (x < 0 ? -erf : erf));
}

export function normalQuantile(p: number): number {
  assertProbability(p);
  return bisect(normalCdf, p, -40, 40);
}

export function lnGamma(x: number): number {
  if (!(x > 0)) throw new Error(`lnGamma 는 양수만: ${x}`);
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - lnGamma(1 - x);
  const y = x - 1;
  let a = LANCZOS[0];
  const t = y + 7.5;
  for (let i = 1; i < LANCZOS.length; i++) a += LANCZOS[i] / (y + i);
  return Math.log(SQRT_2PI) + (y + 0.5) * Math.log(t) - t + Math.log(a);
}

/** 정규화 하부 불완전감마 P(k, x) = γ(k, x) / Γ(k). */
export function regularizedGammaP(shape: number, x: number): number {
  if (!(shape > 0)) throw new Error(`shape 는 양수만: ${shape}`);
  if (x <= 0) return 0;
  const logPrefix = -x + shape * Math.log(x) - lnGamma(shape);
  if (x < shape + 1) {
    let ap = shape;
    let sum = 1 / shape;
    let del = sum;
    for (let n = 0; n < 1000; n++) {
      ap += 1;
      del *= x / ap;
      sum += del;
      if (Math.abs(del) < Math.abs(sum) * 1e-15) break;
    }
    return Math.min(1, sum * Math.exp(logPrefix));
  }
  const FPMIN = 1e-300;
  let b = x + 1 - shape;
  let c = 1 / FPMIN;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i < 1000; i++) {
    const an = -i * (i - shape);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = b + an / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-15) break;
  }
  return Math.max(0, 1 - Math.exp(logPrefix) * h);
}

export function gammaQuantile(p: number, shape: number, scale: number): number {
  assertProbability(p);
  if (!(shape > 0) || !(scale > 0)) throw new Error(`shape · scale 은 양수만: ${shape}, ${scale}`);
  const mean = shape * scale;
  const std = Math.sqrt(shape) * scale;
  let hi = mean + 10 * std;
  while (regularizedGammaP(shape, hi / scale) < p) hi *= 2;
  return bisect((x) => regularizedGammaP(shape, x / scale), p, 0, hi);
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx jest apps/core/src/modules/inventory/replenishment/policy/distributions.spec.ts`
Expected: PASS 24 cases (`it.each` 15건 포함).

Run: `npx jest apps/core/src/modules/inventory/replenishment-boundary.arch.spec.ts` → PASS (`policy/` 자동 포함).

- [ ] **Step 5: 커밋**

```bash
git add apps/core/src/modules/inventory/replenishment/policy/distributions.ts apps/core/src/modules/inventory/replenishment/policy/distributions.spec.ts
git commit -m "feat(core): 정규 · 감마 분위수 순수 함수 — 카이제곱 표로 고정 (#743 B)

Claude-Session: https://claude.ai/code/session_01Y5Bthz8rSpjhTgrZTzGBED"
```

---

### Task 3: `policy/replenishment-policy.ts` — §5 공식 (순수)

**Files:**
- Create: `apps/core/src/modules/inventory/replenishment/policy/replenishment-policy.ts`
- Test: `apps/core/src/modules/inventory/replenishment/policy/replenishment-policy.spec.ts`

**Interfaces:**
- Consumes: `normalQuantile` · `gammaQuantile` (Task 2), `DemandPattern` (A `policy/classification.ts`).
- Produces:
  ```ts
  export interface LeadTimeSegment { meanDays: number; stdDays: number }
  export function composeLeadTime(segments: LeadTimeSegment[], bufferDays: number): LeadTimeSegment   // μ 합 + 버퍼, σ = √Σσ²
  export interface PolicyInput {
    pattern: DemandPattern; dailyMean: number; dailyStd: number; dailyMean90: number;
    leadTime: LeadTimeSegment; alpha: number; coverDays: number; overrideSafetyStock: number | null;
  }
  export interface PolicyOutput {
    safetyStock: number; reorderPoint: number; targetLevel: number; leadTimeDays: number;
    distribution: 'normal' | 'gamma' | 'none'; confidence: 'normal' | 'low'; legacyReorderPoint: number;
  }
  export function computePolicy(input: PolicyInput): PolicyOutput
  ```
  규칙: `μ_LTD = μ_D·μ_L`, `σ²_LTD = μ_L·σ_D² + μ_D²·σ_L²`. `smooth` · `insufficient` 는 정규, `erratic` · `intermittent` · `lumpy` 는 감마(k = μ²/σ², θ = σ²/μ), `none` 은 전부 0. `σ_LTD = 0` 이면 ROP = μ_LTD. SS = max(0, ROP − μ_LTD), S = μ_D·(μ_L + cover) + SS. 오버라이드가 있으면 SS = 그 값, ROP = μ_LTD + SS, 분포 `none`. `confidence = low` ⇔ `insufficient`. `legacyReorderPoint = μ_D(90)·μ_L` 은 항상. 출력은 소수 둘째 자리 반올림.

- [ ] **Step 1: 실패하는 테스트**

```ts
// apps/core/src/modules/inventory/replenishment/policy/replenishment-policy.spec.ts
import { composeLeadTime, computePolicy, PolicyInput } from './replenishment-policy';
import { normalQuantile } from './distributions';

function input(overrides: Partial<PolicyInput> = {}): PolicyInput {
  return {
    pattern: 'smooth',
    dailyMean: 10,
    dailyStd: 3,
    dailyMean90: 10,
    leadTime: { meanDays: 20, stdDays: 5 },
    alpha: 0.05,
    coverDays: 30,
    overrideSafetyStock: null,
    ...overrides,
  };
}

describe('composeLeadTime', () => {
  it('μ 는 합 + 버퍼, σ 는 제곱합의 제곱근', () => {
    expect(composeLeadTime([{ meanDays: 10, stdDays: 2 }, { meanDays: 5, stdDays: 1 }], 7)).toEqual({
      meanDays: 22,
      stdDays: Math.sqrt(5),
    });
    expect(composeLeadTime([{ meanDays: 10, stdDays: 2 }], 0)).toEqual({ meanDays: 10, stdDays: 2 });
  });
});

describe('computePolicy — smooth (정규)', () => {
  it('5변수 공식과 수치가 같다 — μ_LTD 200 · σ_LTD √2680 · z(0.95)', () => {
    const out = computePolicy(input());
    const sigma = Math.sqrt(20 * 9 + 100 * 25);
    const ss = normalQuantile(0.95) * sigma;
    expect(out.distribution).toBe('normal');
    expect(out.safetyStock).toBeCloseTo(ss, 1); // 85.15
    expect(out.reorderPoint).toBeCloseTo(200 + ss, 1); // 285.15
    expect(out.targetLevel).toBeCloseTo(10 * 50 + ss, 1); // 585.15
    expect(out.leadTimeDays).toBe(20);
    expect(out.confidence).toBe('normal');
    expect(out.legacyReorderPoint).toBe(200);
  });
  it('σ_LTD = 0 이면 ROP = μ_LTD, SS = 0', () => {
    const out = computePolicy(input({ dailyStd: 0, leadTime: { meanDays: 20, stdDays: 0 } }));
    expect(out).toMatchObject({ safetyStock: 0, reorderPoint: 200, targetLevel: 500 });
  });
  it('α 가 작을수록 SS 가 크다', () => {
    expect(computePolicy(input({ alpha: 0.02 })).safetyStock).toBeGreaterThan(computePolicy(input({ alpha: 0.1 })).safetyStock);
  });
});

describe('computePolicy — 감마 패턴', () => {
  it('erratic 은 감마이고 같은 μ·σ 에서 정규보다 SS 가 크다(오른쪽 꼬리)', () => {
    const gamma = computePolicy(input({ pattern: 'erratic', dailyStd: 12 }));
    const normal = computePolicy(input({ pattern: 'smooth', dailyStd: 12 }));
    expect(gamma.distribution).toBe('gamma');
    expect(gamma.safetyStock).toBeGreaterThan(normal.safetyStock);
    expect(gamma.reorderPoint).toBeCloseTo(gamma.safetyStock + 200, 6);
  });
  it('CV → 0 이면 감마가 정규로 수렴한다', () => {
    const gamma = computePolicy(input({ pattern: 'lumpy', dailyMean: 100, dailyStd: 1, leadTime: { meanDays: 1, stdDays: 0 } }));
    const normal = computePolicy(input({ pattern: 'smooth', dailyMean: 100, dailyStd: 1, leadTime: { meanDays: 1, stdDays: 0 } }));
    expect(gamma.reorderPoint).toBeCloseTo(normal.reorderPoint, 1);
  });
  it('intermittent · lumpy 도 감마', () => {
    expect(computePolicy(input({ pattern: 'intermittent' })).distribution).toBe('gamma');
    expect(computePolicy(input({ pattern: 'lumpy' })).distribution).toBe('gamma');
  });
  it('μ_LTD = 0 (수요 0) 이면 감마 패턴이어도 전부 0', () => {
    expect(computePolicy(input({ pattern: 'lumpy', dailyMean: 0, dailyStd: 0 }))).toMatchObject({ safetyStock: 0, reorderPoint: 0, targetLevel: 0 });
  });
});

describe('computePolicy — insufficient · none · 오버라이드', () => {
  it('insufficient 는 정규로 계산하되 confidence low', () => {
    const out = computePolicy(input({ pattern: 'insufficient' }));
    expect(out.distribution).toBe('normal');
    expect(out.confidence).toBe('low');
    expect(out.safetyStock).toBeGreaterThan(0);
  });
  it('none 은 SS = ROP = S = 0, 분포 none, 레거시 값도 0', () => {
    expect(computePolicy(input({ pattern: 'none', dailyMean: 0, dailyStd: 0, dailyMean90: 0 }))).toEqual({
      safetyStock: 0,
      reorderPoint: 0,
      targetLevel: 0,
      leadTimeDays: 20,
      distribution: 'none',
      confidence: 'normal',
      legacyReorderPoint: 0,
    });
  });
  it('오버라이드 SS 는 계산을 대체한다 — ROP = μ_LTD + SS, S = μ_D(μ_L + cover) + SS', () => {
    const out = computePolicy(input({ overrideSafetyStock: 40 }));
    expect(out).toMatchObject({ safetyStock: 40, reorderPoint: 240, targetLevel: 540, distribution: 'none' });
  });
  it('오버라이드는 none 패턴에도 적용된다 (사람이 준 숫자)', () => {
    const out = computePolicy(input({ pattern: 'none', dailyMean: 0, dailyStd: 0, dailyMean90: 0, overrideSafetyStock: 100 }));
    expect(out).toMatchObject({ safetyStock: 100, reorderPoint: 100, targetLevel: 100 });
  });
  it('레거시 재주문점은 μ_D(90)·μ_L — 파라미터 창이 365 인 패턴에서도', () => {
    const out = computePolicy(input({ pattern: 'lumpy', dailyMean: 0.5, dailyMean90: 0.8, leadTime: { meanDays: 25, stdDays: 0 } }));
    expect(out.legacyReorderPoint).toBe(20);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx jest apps/core/src/modules/inventory/replenishment/policy/replenishment-policy.spec.ts`
Expected: FAIL — `Cannot find module './replenishment-policy'`

- [ ] **Step 3: 구현**

```ts
// apps/core/src/modules/inventory/replenishment/policy/replenishment-policy.ts
import { DemandPattern } from './classification';
import { gammaQuantile, normalQuantile } from './distributions';

/**
 * 연속검토 (s, S) 정책 (스펙 §5). 순수 함수 — DB · Nest · drizzle 을 모른다.
 *
 *   μ_LTD = μ_D·μ_L,  σ²_LTD = μ_L·σ_D² + μ_D²·σ_L²
 *   ROP   = Q(1 − α; 분포, μ_LTD, σ_LTD),  SS = ROP − μ_LTD,  S = μ_D·(μ_L + cover) + SS
 *
 * smooth · insufficient → 정규, erratic · intermittent · lumpy → 감마(모멘트 일치), none → 0.
 * 오버라이드 SS 가 있으면 분포 계산을 건너뛴다. 레거시 값(μ_D(90)·μ_L)은 열람용으로 항상 낸다.
 */
export interface LeadTimeSegment {
  meanDays: number;
  stdDays: number;
}

export function composeLeadTime(segments: LeadTimeSegment[], bufferDays: number): LeadTimeSegment {
  const meanDays = segments.reduce((s, x) => s + x.meanDays, 0) + bufferDays;
  const variance = segments.reduce((s, x) => s + x.stdDays * x.stdDays, 0);
  return { meanDays, stdDays: Math.sqrt(variance) };
}

export interface PolicyInput {
  pattern: DemandPattern;
  dailyMean: number;
  dailyStd: number;
  dailyMean90: number;
  leadTime: LeadTimeSegment;
  alpha: number;
  coverDays: number;
  overrideSafetyStock: number | null;
}

export interface PolicyOutput {
  safetyStock: number;
  reorderPoint: number;
  targetLevel: number;
  leadTimeDays: number;
  distribution: 'normal' | 'gamma' | 'none';
  confidence: 'normal' | 'low';
  legacyReorderPoint: number;
}

const GAMMA_PATTERNS: ReadonlySet<DemandPattern> = new Set(['erratic', 'intermittent', 'lumpy']);

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

export function computePolicy(input: PolicyInput): PolicyOutput {
  const { dailyMean, dailyStd, leadTime, alpha, coverDays } = input;
  const muLtd = dailyMean * leadTime.meanDays;
  const sigmaLtd = Math.sqrt(leadTime.meanDays * dailyStd * dailyStd + dailyMean * dailyMean * leadTime.stdDays * leadTime.stdDays);
  const confidence: PolicyOutput['confidence'] = input.pattern === 'insufficient' ? 'low' : 'normal';
  const legacyReorderPoint = round2(input.dailyMean90 * leadTime.meanDays);
  const leadTimeDays = round2(leadTime.meanDays);

  if (input.overrideSafetyStock !== null) {
    const ss = input.overrideSafetyStock;
    return {
      safetyStock: round2(ss),
      reorderPoint: round2(muLtd + ss),
      targetLevel: round2(dailyMean * (leadTime.meanDays + coverDays) + ss),
      leadTimeDays,
      distribution: 'none',
      confidence,
      legacyReorderPoint,
    };
  }

  if (input.pattern === 'none' || muLtd <= 0) {
    return { safetyStock: 0, reorderPoint: 0, targetLevel: 0, leadTimeDays, distribution: 'none', confidence, legacyReorderPoint };
  }

  const useGamma = GAMMA_PATTERNS.has(input.pattern);
  let reorderPoint: number;
  if (sigmaLtd <= 0) {
    reorderPoint = muLtd;
  } else if (useGamma) {
    const shape = (muLtd * muLtd) / (sigmaLtd * sigmaLtd);
    const scale = (sigmaLtd * sigmaLtd) / muLtd;
    reorderPoint = gammaQuantile(1 - alpha, shape, scale);
  } else {
    reorderPoint = muLtd + normalQuantile(1 - alpha) * sigmaLtd;
  }
  const safetyStock = Math.max(0, reorderPoint - muLtd);

  return {
    safetyStock: round2(safetyStock),
    reorderPoint: round2(muLtd + safetyStock),
    targetLevel: round2(dailyMean * (leadTime.meanDays + coverDays) + safetyStock),
    leadTimeDays,
    distribution: useGamma ? 'gamma' : 'normal',
    confidence,
    legacyReorderPoint,
  };
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx jest apps/core/src/modules/inventory/replenishment/policy/replenishment-policy.spec.ts`
Expected: PASS 13 tests.

- [ ] **Step 5: 커밋**

```bash
git add apps/core/src/modules/inventory/replenishment/policy/replenishment-policy.ts apps/core/src/modules/inventory/replenishment/policy/replenishment-policy.spec.ts
git commit -m "feat(core): (s, S) 정책 순수 함수 — 정규/감마 재주문점 · 리드타임 합성 · 오버라이드 (#743 B)

Claude-Session: https://claude.ai/code/session_01Y5Bthz8rSpjhTgrZTzGBED"
```

---
### Task 4: `rules/effective-parameters.ts` — §6 우선순위 (순수)

**Files:**
- Create: `apps/core/src/modules/inventory/replenishment/rules/effective-parameters.ts`
- Test: `apps/core/src/modules/inventory/replenishment/rules/effective-parameters.spec.ts`

**Interfaces:**
- Consumes: `DemandGrade` (A `demand/demand-profile.calculator.ts` — 순수).
- Produces:
  ```ts
  export type ParameterSource = 'override' | 'grade' | 'observation' | 'supplier_rule' | 'route_rule' | 'global_default';
  export interface LeadTimeObservation { observations: number; meanDays: number; stdDays: number | null }
  export interface LeadTimeRule { leadTimeDays: number; leadTimeStdDays: number | null; coverDays: number }
  export interface SkuOverrideInput { mode: 'auto' | 'excluded'; excludedUntil: string | null; safetyStock: number | null; alpha: number | null }
  export interface ParameterSettings {
    minLeadTimeObservations: number; defaultLeadTimeDays: number; defaultLeadTimeStdDays: number | null;
    defaultTransferLeadTimeDays: number; defaultTransferLeadTimeStdDays: number | null; defaultLeadTimeCv: number;
    defaultCoverDays: number; defaultTransferCoverDays: number;
  }
  export interface EffectiveParametersInput {
    today: string; settings: ParameterSettings; gradeAlpha: Record<DemandGrade, number>; grade: DemandGrade;
    override: SkuOverrideInput | null;
    supplierRule: LeadTimeRule | null; supplierObservation: LeadTimeObservation | null;
    hasRoute: boolean; routeRule: LeadTimeRule | null; routeObservation: LeadTimeObservation | null;
  }
  export interface ResolvedSegment { meanDays: number; stdDays: number; source: ParameterSource }
  export interface EffectiveParameters {
    excluded: boolean;
    alpha: { value: number; source: 'override' | 'grade' };
    l1: ResolvedSegment;
    l2: ResolvedSegment | null;             // hasRoute 가 false 면 null (출발 창고 = 판매 창고, L2 = 0)
    coverDays: { value: number; source: 'supplier_rule' | 'global_default' };
    transferCoverDays: { value: number; source: 'route_rule' | 'global_default' };
    overrideSafetyStock: number | null;
    usesDefaultLeadTime: boolean;           // l1 또는 l2 가 global_default
  }
  export function resolveEffectiveParameters(input: EffectiveParametersInput): EffectiveParameters
  ```
  우선순위(스펙 §6): α = 예외 > 등급. L1 = 관측(n ≥ min) > 공급사 규칙 > 전역. L2 = 관측 > 경로 규칙 > 전역. 커버 = 공급사 규칙 > 전역, 이동 커버 = 경로 규칙 > 전역. **σ 가 비면 σ = default_lead_time_cv · μ**. `excluded` ⇔ mode excluded 이고 (until 없음 또는 until ≥ today).

- [ ] **Step 1: 실패하는 테스트**

```ts
// apps/core/src/modules/inventory/replenishment/rules/effective-parameters.spec.ts
import { EffectiveParametersInput, resolveEffectiveParameters } from './effective-parameters';

function input(overrides: Partial<EffectiveParametersInput> = {}): EffectiveParametersInput {
  return {
    today: '2026-09-08',
    settings: {
      minLeadTimeObservations: 5,
      defaultLeadTimeDays: 30,
      defaultLeadTimeStdDays: null,
      defaultTransferLeadTimeDays: 14,
      defaultTransferLeadTimeStdDays: null,
      defaultLeadTimeCv: 0.25,
      defaultCoverDays: 30,
      defaultTransferCoverDays: 14,
    },
    gradeAlpha: { A: 0.02, B: 0.05, C: 0.1 },
    grade: 'B',
    override: null,
    supplierRule: null,
    supplierObservation: null,
    hasRoute: true,
    routeRule: null,
    routeObservation: null,
    ...overrides,
  };
}

describe('resolveEffectiveParameters — α', () => {
  it('등급 α 가 기본, SKU 예외 α 가 있으면 그것', () => {
    expect(resolveEffectiveParameters(input()).alpha).toEqual({ value: 0.05, source: 'grade' });
    expect(resolveEffectiveParameters(input({ override: { mode: 'auto', excludedUntil: null, safetyStock: null, alpha: 0.01 } })).alpha).toEqual({ value: 0.01, source: 'override' });
  });
});

describe('resolveEffectiveParameters — L1', () => {
  it('관측 n ≥ min 이면 관측', () => {
    const p = resolveEffectiveParameters(input({ supplierObservation: { observations: 5, meanDays: 12, stdDays: 3 }, supplierRule: { leadTimeDays: 30, leadTimeStdDays: 4, coverDays: 45 } }));
    expect(p.l1).toEqual({ meanDays: 12, stdDays: 3, source: 'observation' });
    expect(p.usesDefaultLeadTime).toBe(false);
  });
  it('관측 n < min 이면 공급사 규칙, 규칙도 없으면 전역 기본 + default_lead_time 표시', () => {
    const rule = resolveEffectiveParameters(input({ supplierObservation: { observations: 4, meanDays: 12, stdDays: 3 }, supplierRule: { leadTimeDays: 30, leadTimeStdDays: 4, coverDays: 45 } }));
    expect(rule.l1).toEqual({ meanDays: 30, stdDays: 4, source: 'supplier_rule' });
    const global = resolveEffectiveParameters(input({ supplierObservation: { observations: 4, meanDays: 12, stdDays: 3 } }));
    expect(global.l1).toEqual({ meanDays: 30, stdDays: 7.5, source: 'global_default' });
    expect(global.usesDefaultLeadTime).toBe(true);
  });
  it('σ 가 비어 있으면 cv · μ (규칙 · 관측 · 전역 모두)', () => {
    expect(resolveEffectiveParameters(input({ supplierRule: { leadTimeDays: 20, leadTimeStdDays: null, coverDays: 30 } })).l1.stdDays).toBe(5);
    expect(resolveEffectiveParameters(input({ supplierObservation: { observations: 9, meanDays: 8, stdDays: null } })).l1.stdDays).toBe(2);
    expect(resolveEffectiveParameters(input({ settings: { ...input().settings, defaultLeadTimeStdDays: 6 } })).l1.stdDays).toBe(6);
  });
});

describe('resolveEffectiveParameters — L2 · 커버', () => {
  it('hasRoute 가 false 면 l2 는 null 이고 경로 규칙 · 관측을 보지 않는다', () => {
    const p = resolveEffectiveParameters(input({ hasRoute: false, routeRule: { leadTimeDays: 9, leadTimeStdDays: 1, coverDays: 5 } }));
    expect(p.l2).toBeNull();
    expect(p.usesDefaultLeadTime).toBe(true); // l1 이 전역 기본
  });
  it('L2 우선순위: 관측 > 경로 규칙 > 전역 이동 기본', () => {
    expect(resolveEffectiveParameters(input({ routeObservation: { observations: 6, meanDays: 7, stdDays: 2 }, routeRule: { leadTimeDays: 9, leadTimeStdDays: 1, coverDays: 5 } })).l2).toEqual({ meanDays: 7, stdDays: 2, source: 'observation' });
    expect(resolveEffectiveParameters(input({ routeRule: { leadTimeDays: 9, leadTimeStdDays: null, coverDays: 5 } })).l2).toEqual({ meanDays: 9, stdDays: 2.25, source: 'route_rule' });
    expect(resolveEffectiveParameters(input()).l2).toEqual({ meanDays: 14, stdDays: 3.5, source: 'global_default' });
  });
  it('커버는 공급사 규칙 > 전역, 이동 커버는 경로 규칙 > 전역', () => {
    const p = resolveEffectiveParameters(input({ supplierRule: { leadTimeDays: 30, leadTimeStdDays: null, coverDays: 45 }, routeRule: { leadTimeDays: 9, leadTimeStdDays: 1, coverDays: 10 } }));
    expect(p.coverDays).toEqual({ value: 45, source: 'supplier_rule' });
    expect(p.transferCoverDays).toEqual({ value: 10, source: 'route_rule' });
    expect(resolveEffectiveParameters(input()).coverDays).toEqual({ value: 30, source: 'global_default' });
    expect(resolveEffectiveParameters(input()).transferCoverDays).toEqual({ value: 14, source: 'global_default' });
  });
});

describe('resolveEffectiveParameters — 예외', () => {
  const excluded = (excludedUntil: string | null) => ({ mode: 'excluded' as const, excludedUntil, safetyStock: null, alpha: null });
  it('excluded 는 until 이 없거나 오늘 이후면 제외, 오늘보다 앞이면 auto', () => {
    expect(resolveEffectiveParameters(input({ override: excluded(null) })).excluded).toBe(true);
    expect(resolveEffectiveParameters(input({ override: excluded('2026-09-08') })).excluded).toBe(true);
    expect(resolveEffectiveParameters(input({ override: excluded('2026-12-31') })).excluded).toBe(true);
    expect(resolveEffectiveParameters(input({ override: excluded('2026-09-07') })).excluded).toBe(false);
    expect(resolveEffectiveParameters(input({ override: { mode: 'auto', excludedUntil: '2026-12-31', safetyStock: null, alpha: null } })).excluded).toBe(false);
    expect(resolveEffectiveParameters(input()).excluded).toBe(false);
  });
  it('안전재고 오버라이드는 그대로 넘긴다', () => {
    expect(resolveEffectiveParameters(input({ override: { mode: 'auto', excludedUntil: null, safetyStock: 40, alpha: null } })).overrideSafetyStock).toBe(40);
    expect(resolveEffectiveParameters(input()).overrideSafetyStock).toBeNull();
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx jest apps/core/src/modules/inventory/replenishment/rules/effective-parameters.spec.ts`
Expected: FAIL — `Cannot find module './effective-parameters'`

- [ ] **Step 3: 구현**

```ts
// apps/core/src/modules/inventory/replenishment/rules/effective-parameters.ts
import { DemandGrade } from '../demand/demand-profile.calculator';

/**
 * 규칙 우선순위 (스펙 §6). 순수 함수 — DB · Nest · drizzle 을 모른다.
 *   α       : SKU 예외 > 등급
 *   L1(μ,σ) : 관측(n ≥ min_lead_time_observations) > 공급사 규칙 > 전역 default_lead_time_*
 *   L2(μ,σ) : 관측 > 경로 규칙 > 전역 default_transfer_lead_time_*   (출발 창고 = 판매 창고면 L2 없음)
 *   커버    : 공급사 규칙 > 전역. 이동 커버는 경로 규칙 > 전역
 *   σ 가 비면 σ = default_lead_time_cv · μ — 0 으로 두면 리드타임 변동이 조용히 사라진다(§5.2).
 */
export type ParameterSource = 'override' | 'grade' | 'observation' | 'supplier_rule' | 'route_rule' | 'global_default';

export interface LeadTimeObservation {
  observations: number;
  meanDays: number;
  stdDays: number | null;
}

export interface LeadTimeRule {
  leadTimeDays: number;
  leadTimeStdDays: number | null;
  coverDays: number;
}

export interface SkuOverrideInput {
  mode: 'auto' | 'excluded';
  excludedUntil: string | null;
  safetyStock: number | null;
  alpha: number | null;
}

export interface ParameterSettings {
  minLeadTimeObservations: number;
  defaultLeadTimeDays: number;
  defaultLeadTimeStdDays: number | null;
  defaultTransferLeadTimeDays: number;
  defaultTransferLeadTimeStdDays: number | null;
  defaultLeadTimeCv: number;
  defaultCoverDays: number;
  defaultTransferCoverDays: number;
}

export interface EffectiveParametersInput {
  today: string;
  settings: ParameterSettings;
  gradeAlpha: Record<DemandGrade, number>;
  grade: DemandGrade;
  override: SkuOverrideInput | null;
  supplierRule: LeadTimeRule | null;
  supplierObservation: LeadTimeObservation | null;
  hasRoute: boolean;
  routeRule: LeadTimeRule | null;
  routeObservation: LeadTimeObservation | null;
}

export interface ResolvedSegment {
  meanDays: number;
  stdDays: number;
  source: ParameterSource;
}

export interface EffectiveParameters {
  excluded: boolean;
  alpha: { value: number; source: 'override' | 'grade' };
  l1: ResolvedSegment;
  l2: ResolvedSegment | null;
  coverDays: { value: number; source: 'supplier_rule' | 'global_default' };
  transferCoverDays: { value: number; source: 'route_rule' | 'global_default' };
  overrideSafetyStock: number | null;
  usesDefaultLeadTime: boolean;
}

function segment(meanDays: number, stdDays: number | null, cv: number, source: ParameterSource): ResolvedSegment {
  return { meanDays, stdDays: stdDays ?? cv * meanDays, source };
}

function resolveSegment(
  observation: LeadTimeObservation | null,
  rule: LeadTimeRule | null,
  fallback: { meanDays: number; stdDays: number | null; ruleSource: 'supplier_rule' | 'route_rule' },
  settings: ParameterSettings,
): ResolvedSegment {
  const cv = settings.defaultLeadTimeCv;
  if (observation && observation.observations >= settings.minLeadTimeObservations) {
    return segment(observation.meanDays, observation.stdDays, cv, 'observation');
  }
  if (rule) return segment(rule.leadTimeDays, rule.leadTimeStdDays, cv, fallback.ruleSource);
  return segment(fallback.meanDays, fallback.stdDays, cv, 'global_default');
}

export function resolveEffectiveParameters(input: EffectiveParametersInput): EffectiveParameters {
  const { settings, override } = input;

  const excluded =
    override !== null &&
    override.mode === 'excluded' &&
    (override.excludedUntil === null || override.excludedUntil >= input.today);

  const alpha =
    override !== null && override.alpha !== null
      ? { value: override.alpha, source: 'override' as const }
      : { value: input.gradeAlpha[input.grade], source: 'grade' as const };

  const l1 = resolveSegment(
    input.supplierObservation,
    input.supplierRule,
    { meanDays: settings.defaultLeadTimeDays, stdDays: settings.defaultLeadTimeStdDays, ruleSource: 'supplier_rule' },
    settings,
  );
  const l2 = input.hasRoute
    ? resolveSegment(
        input.routeObservation,
        input.routeRule,
        { meanDays: settings.defaultTransferLeadTimeDays, stdDays: settings.defaultTransferLeadTimeStdDays, ruleSource: 'route_rule' },
        settings,
      )
    : null;

  const coverDays = input.supplierRule
    ? { value: input.supplierRule.coverDays, source: 'supplier_rule' as const }
    : { value: settings.defaultCoverDays, source: 'global_default' as const };
  const transferCoverDays = input.routeRule
    ? { value: input.routeRule.coverDays, source: 'route_rule' as const }
    : { value: settings.defaultTransferCoverDays, source: 'global_default' as const };

  return {
    excluded,
    alpha,
    l1,
    l2,
    coverDays,
    transferCoverDays,
    overrideSafetyStock: override?.safetyStock ?? null,
    usesDefaultLeadTime: l1.source === 'global_default' || (l2 !== null && l2.source === 'global_default'),
  };
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx jest apps/core/src/modules/inventory/replenishment/rules/effective-parameters.spec.ts`
Expected: PASS 9 tests.

- [ ] **Step 5: 커밋**

```bash
git add apps/core/src/modules/inventory/replenishment/rules/
git commit -m "feat(core): 보충 규칙 우선순위 순수 함수 — α · L1 · L2 · 커버 · 예외 (#743 B)

Claude-Session: https://claude.ai/code/session_01Y5Bthz8rSpjhTgrZTzGBED"
```

---

### Task 5: 규칙 CRUD — Reader · Manager · Service · DTO · Controller 13라우트

**Files:**
- Create: `apps/core/src/modules/inventory/replenishment/dto/replenishment-rules.dto.ts`
- Create: `apps/core/src/modules/inventory/replenishment/rules/replenishment-rules.reader.ts`
- Create: `apps/core/src/modules/inventory/replenishment/rules/replenishment-rules.manager.ts`
- Create: `apps/core/src/modules/inventory/replenishment/rules/replenishment-rules.service.ts`
- Create: `apps/core/src/modules/inventory/replenishment/controllers/replenishment-rules.controller.ts` + `.spec.ts`
- Test: `apps/core/src/modules/inventory/replenishment/rules/replenishment-rules.integration.spec.ts`
- Modify: `apps/core/src/modules/inventory/replenishment/replenishment.module.ts` · `apps/core/src/platform/auth/inventory-scope-coverage.spec.ts`
- Modify (A 의 파일 — Step 8 「설정 단일 읽기」): `apps/core/src/modules/inventory/replenishment/demand/replenishment-refresh.job.ts` + `.spec.ts` · `demand/demand-profile.refresher.ts` + `.spec.ts` · `demand/lead-time-profile.refresher.ts` + `.spec.ts`

**Interfaces:**
- Consumes: 표 4개 (Task 1) + A 의 `replenishmentSettings` · `supplierLeadTimeProfiles` · `routeLeadTimeProfiles`, `ReplenishmentSettingsReader`(A).
- Produces (Task 6 이 쓰는 것):
  ```ts
  export class ReplenishmentRulesReader {
    readGradeAlphas(tx?: DbTx): Promise<Record<DemandGrade, number>>;              // 3행 없으면 Error(시드)
    readSupplierRules(tx: DbTx, supplierIds: string[]): Promise<Map<string, ReplenishmentSupplierRule>>;
    readRouteRules(tx: DbTx): Promise<Map<string, ReplenishmentRouteRule>>;           // key `${from}:${to}`
    readSkuOverrides(tx: DbTx, skuIds: string[]): Promise<Map<string, ReplenishmentSkuOverride>>;
    listGradeRules(tx?): Promise<ReplenishmentGradeRule[]>;
    listSupplierRows(tx?): Promise<SupplierRuleRow[]>;
    listRouteRows(tx?): Promise<RouteRuleRow[]>;
    searchSkuOverrides(tx: DbTx, q: string | undefined, limit: number): Promise<SkuOverrideRow[]>;
  }
  export function routeKey(from: string, to: string): string   // `${from}:${to}`
  ```
  HTTP: `GET/PUT /replenishment/rules/settings` · `GET/PUT /replenishment/rules/grades` · `GET /replenishment/rules/suppliers` · `PUT/DELETE /replenishment/rules/suppliers/:supplierId` · `GET /replenishment/rules/routes` · `PUT/DELETE /replenishment/rules/routes/:fromWarehouseId/:toWarehouseId` · `GET /replenishment/rules/skus?q=&limit=` · `PUT/DELETE /replenishment/rules/skus/:skuId`. 404 = 대상 공급사 · 창고 · SKU · 규칙 없음, 400 = from=to · 등급 셋이 아님 · A컷 ≥ B컷.

- [ ] **Step 1: DTO**

```ts
// apps/core/src/modules/inventory/replenishment/dto/replenishment-rules.dto.ts
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
export const DEMAND_GRADES = ['A', 'B', 'C'] as const;
export const OVERRIDE_MODES = ['auto', 'excluded'] as const;

// ── 전역 ──
export class ReplenishmentSettingsDto {
  @ApiProperty() key: string;
  @ApiProperty() adiThreshold: number;
  @ApiProperty() cv2Threshold: number;
  @ApiProperty() classificationWindowDays: number;
  @ApiProperty() paramWindowDaysFrequent: number;
  @ApiProperty() paramWindowDaysSparse: number;
  @ApiProperty() minDemandEvents: number;
  @ApiProperty() minLeadTimeObservations: number;
  @ApiProperty() leadTimeWindowDays: number;
  @ApiProperty() gradeACut: number;
  @ApiProperty() gradeBCut: number;
  @ApiPropertyOptional({ nullable: true }) demandCoreSince: string | null;
  @ApiProperty() demandRecomputeDays: number;
  @ApiProperty() consolidationBufferDays: number;
  @ApiProperty() defaultLeadTimeDays: number;
  @ApiPropertyOptional({ nullable: true }) defaultLeadTimeStdDays: number | null;
  @ApiProperty() defaultTransferLeadTimeDays: number;
  @ApiPropertyOptional({ nullable: true }) defaultTransferLeadTimeStdDays: number | null;
  @ApiProperty() defaultLeadTimeCv: number;
  @ApiProperty() defaultCoverDays: number;
  @ApiProperty() defaultTransferCoverDays: number;
  @ApiProperty() updatedAt: string;
}

export class UpdateReplenishmentSettingsDto {
  @ApiPropertyOptional() @IsOptional() @IsNumber() @IsPositive() adiThreshold?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @IsPositive() cv2Threshold?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(30) @Max(1095) classificationWindowDays?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(7) @Max(1095) paramWindowDaysFrequent?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(7) @Max(1095) paramWindowDaysSparse?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) minDemandEvents?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) minLeadTimeObservations?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(30) @Max(1095) leadTimeWindowDays?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) @Max(1) gradeACut?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) @Max(1) gradeBCut?: number;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @ValidateIf((o) => o.demandCoreSince !== null) @Matches(ISO_DATE) demandCoreSince?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(365) demandRecomputeDays?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) consolidationBufferDays?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) defaultLeadTimeDays?: number;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @ValidateIf((o) => o.defaultLeadTimeStdDays !== null) @IsNumber() @Min(0) defaultLeadTimeStdDays?: number | null;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) defaultTransferLeadTimeDays?: number;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @ValidateIf((o) => o.defaultTransferLeadTimeStdDays !== null) @IsNumber() @Min(0) defaultTransferLeadTimeStdDays?: number | null;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) @Max(2) defaultLeadTimeCv?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) defaultCoverDays?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) defaultTransferCoverDays?: number;
}

// ── 등급 ──
export class GradeRuleDto {
  @ApiProperty({ enum: DEMAND_GRADES }) @IsIn(DEMAND_GRADES) grade: (typeof DEMAND_GRADES)[number];
  @ApiProperty({ description: '목표 예측 실패율 (0, 1)' }) @IsNumber() @IsPositive() @Max(0.999) alpha: number;
}
export class GradeRulesDto {
  @ApiProperty({ type: [GradeRuleDto] }) items: GradeRuleDto[];
}
export class UpdateGradeRulesDto {
  @ApiProperty({ type: [GradeRuleDto], description: 'A · B · C 세 행 전부' })
  @IsArray()
  @ArrayMinSize(3)
  @ArrayMaxSize(3)
  @ValidateNested({ each: true })
  @Type(() => GradeRuleDto)
  items: GradeRuleDto[];
}

// ── 공급사 · 경로 공통 ──
export class LeadTimeObservationDto {
  @ApiProperty() observations: number;
  @ApiProperty() meanDays: number;
  @ApiPropertyOptional({ nullable: true }) stdDays: number | null;
  @ApiProperty() windowFrom: string;
  @ApiProperty() windowTo: string;
}
export class LeadTimeRuleDto {
  @ApiProperty() leadTimeDays: number;
  @ApiPropertyOptional({ nullable: true }) leadTimeStdDays: number | null;
  @ApiProperty() coverDays: number;
  @ApiProperty() updatedAt: string;
}
export class UpsertLeadTimeRuleDto {
  @ApiProperty() @IsNumber() @Min(0) leadTimeDays: number;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @ValidateIf((o) => o.leadTimeStdDays !== null) @IsNumber() @Min(0) leadTimeStdDays?: number | null;
  @ApiProperty() @IsInt() @Min(0) coverDays: number;
}

export class SupplierRuleRowDto {
  @ApiProperty() supplierId: string;
  @ApiProperty() supplierName: string;
  @ApiPropertyOptional({ nullable: true }) defaultWarehouseId: string | null;
  @ApiPropertyOptional({ type: LeadTimeRuleDto, nullable: true }) rule: LeadTimeRuleDto | null;
  @ApiPropertyOptional({ type: LeadTimeObservationDto, nullable: true }) observation: LeadTimeObservationDto | null;
}
export class SupplierRulesListDto {
  @ApiProperty({ type: [SupplierRuleRowDto] }) items: SupplierRuleRowDto[];
}

export class RouteRuleRowDto {
  @ApiProperty() fromWarehouseId: string;
  @ApiProperty() fromWarehouseName: string;
  @ApiProperty() toWarehouseId: string;
  @ApiProperty() toWarehouseName: string;
  @ApiPropertyOptional({ type: LeadTimeRuleDto, nullable: true }) rule: LeadTimeRuleDto | null;
  @ApiPropertyOptional({ type: LeadTimeObservationDto, nullable: true }) observation: LeadTimeObservationDto | null;
}
export class RouteRulesListDto {
  @ApiProperty({ type: [RouteRuleRowDto] }) items: RouteRuleRowDto[];
}

// ── SKU 예외 ──
export class ListSkuOverridesQueryDto {
  @ApiPropertyOptional({ description: 'SKU 코드 · 이름 부분 일치' }) @IsOptional() @IsString() @MaxLength(100) q?: string;
  @ApiPropertyOptional({ default: 100, minimum: 1, maximum: 500 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(500) limit?: number;
}
export class SkuOverrideRowDto {
  @ApiProperty() skuId: string;
  @ApiProperty() skuCode: string;
  @ApiProperty() skuName: string;
  @ApiProperty({ enum: OVERRIDE_MODES }) mode: (typeof OVERRIDE_MODES)[number];
  @ApiPropertyOptional({ nullable: true }) excludedUntil: string | null;
  @ApiPropertyOptional({ nullable: true }) safetyStock: number | null;
  @ApiPropertyOptional({ nullable: true }) alpha: number | null;
  @ApiPropertyOptional({ nullable: true }) memo: string | null;
  @ApiProperty() updatedAt: string;
}
export class SkuOverridesListDto {
  @ApiProperty({ type: [SkuOverrideRowDto] }) items: SkuOverrideRowDto[];
}
export class UpsertSkuOverrideDto {
  @ApiProperty({ enum: OVERRIDE_MODES }) @IsIn(OVERRIDE_MODES) mode: (typeof OVERRIDE_MODES)[number];
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @ValidateIf((o) => o.excludedUntil !== null) @Matches(ISO_DATE) excludedUntil?: string | null;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @ValidateIf((o) => o.safetyStock !== null) @IsInt() @Min(0) safetyStock?: number | null;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @ValidateIf((o) => o.alpha !== null) @IsNumber() @IsPositive() @Max(0.999) alpha?: number | null;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @ValidateIf((o) => o.memo !== null) @IsString() @MaxLength(255) memo?: string | null;
}
```

- [ ] **Step 2: 실패하는 통합 스펙 (Reader + Manager)**

```ts
// apps/core/src/modules/inventory/replenishment/rules/replenishment-rules.integration.spec.ts
import { randomUUID } from 'crypto';
import * as postgres from 'postgres';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import { DbService } from '@app/db';
import { wmsSchema, wmsTables, DbTx } from '../../schema/inventory.schema';
import { makeDb, inRollbackTx, seedHolder, seedSku, seedWarehouseWithZone } from '../../../fulfillment/services/__support__';
import { SETTINGS_KEY } from '../demand/replenishment-settings.reader';
import { ReplenishmentRulesReader, routeKey } from './replenishment-rules.reader';
import { ReplenishmentRulesManager } from './replenishment-rules.manager';

/**
 * 실행: COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- replenishment-rules.integration
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('ReplenishmentRulesReader / Manager (DB integration)', () => {
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

  async function seedRules(trx: DbTx) {
    await trx.delete(wmsTables.replenishmentSettings).where(eq(wmsTables.replenishmentSettings.key, SETTINGS_KEY));
    await trx.insert(wmsTables.replenishmentSettings).values({ key: SETTINGS_KEY });
    await trx.delete(wmsTables.replenishmentGradeRules);
    await trx.insert(wmsTables.replenishmentGradeRules).values([
      { grade: 'A', alpha: 0.02 },
      { grade: 'B', alpha: 0.05 },
      { grade: 'C', alpha: 0.1 },
    ]);
  }

  function build(trx: DbTx) {
    const dbService = boundDbService(trx);
    return { reader: new ReplenishmentRulesReader(dbService), manager: new ReplenishmentRulesManager(dbService) };
  }

  it('등급 α 는 Record 로, 3행이 없으면 시드 미실행 Error', async () => {
    await inRollbackTx(db, async (trx) => {
      await seedRules(trx);
      const { reader } = build(trx);
      expect(await reader.readGradeAlphas(trx)).toEqual({ A: 0.02, B: 0.05, C: 0.1 });
      await trx.delete(wmsTables.replenishmentGradeRules).where(eq(wmsTables.replenishmentGradeRules.grade, 'B'));
      await expect(reader.readGradeAlphas(trx)).rejects.toThrow(/db:seed:ref/);
    });
  });

  it('공급사 행: 전 공급사를 규칙 · 관측과 left join, 이름순', async () => {
    await inRollbackTx(db, async (trx) => {
      await seedRules(trx);
      const { warehouseId } = await seedWarehouseWithZone(trx);
      const tag = randomUUID().slice(0, 6);
      const [a] = await trx.insert(wmsTables.suppliers).values({ name: `it-${tag}-a`, defaultWarehouseId: warehouseId }).returning({ id: wmsTables.suppliers.id });
      const [b] = await trx.insert(wmsTables.suppliers).values({ name: `it-${tag}-b` }).returning({ id: wmsTables.suppliers.id });
      const { reader, manager } = build(trx);
      await manager.upsertSupplierRule(a.id, { leadTimeDays: 25, leadTimeStdDays: null, coverDays: 40 }, trx);
      await trx.insert(wmsTables.supplierLeadTimeProfiles).values({ supplierId: b.id, observations: 3, meanDays: 11.5, stdDays: 2, windowFrom: '2025-09-08', windowTo: '2026-09-08', computedAt: new Date() });

      const rows = (await reader.listSupplierRows(trx)).filter((r) => r.supplierName.startsWith(`it-${tag}`));
      expect(rows.map((r) => r.supplierName)).toEqual([`it-${tag}-a`, `it-${tag}-b`]);
      expect(rows[0]).toMatchObject({ defaultWarehouseId: warehouseId, rule: { leadTimeDays: 25, leadTimeStdDays: null, coverDays: 40 }, observation: null });
      expect(rows[1]).toMatchObject({ defaultWarehouseId: null, rule: null, observation: { observations: 3, meanDays: 11.5, stdDays: 2 } });

      const rules = await reader.readSupplierRules(trx, [a.id, b.id]);
      expect(rules.get(a.id)?.coverDays).toBe(40);
      expect(rules.has(b.id)).toBe(false);
    });
  });

  it('공급사 규칙 upsert 는 두 번째가 갱신, delete 는 없으면 404, 없는 공급사는 404', async () => {
    await inRollbackTx(db, async (trx) => {
      await seedRules(trx);
      const [s] = await trx.insert(wmsTables.suppliers).values({ name: 'it-sup' }).returning({ id: wmsTables.suppliers.id });
      const { manager, reader } = build(trx);
      await manager.upsertSupplierRule(s.id, { leadTimeDays: 25, leadTimeStdDays: 3, coverDays: 40 }, trx);
      const updated = await manager.upsertSupplierRule(s.id, { leadTimeDays: 20, leadTimeStdDays: null, coverDays: 30 }, trx);
      expect(updated).toMatchObject({ supplierId: s.id, leadTimeDays: 20, leadTimeStdDays: null, coverDays: 30 });
      expect((await reader.readSupplierRules(trx, [s.id])).size).toBe(1);
      await manager.deleteSupplierRule(s.id, trx);
      expect((await reader.readSupplierRules(trx, [s.id])).size).toBe(0);
      await expect(manager.deleteSupplierRule(s.id, trx)).rejects.toThrow(/규칙/);
      await expect(manager.upsertSupplierRule(randomUUID(), { leadTimeDays: 1, leadTimeStdDays: null, coverDays: 1 }, trx)).rejects.toThrow(/공급사/);
    });
  });

  it('경로 행: 규칙 ∪ 관측을 창고명과 함께, from = to 는 400', async () => {
    await inRollbackTx(db, async (trx) => {
      await seedRules(trx);
      const a = await seedWarehouseWithZone(trx);
      const b = await seedWarehouseWithZone(trx);
      const c = await seedWarehouseWithZone(trx);
      const { reader, manager } = build(trx);
      await manager.upsertRouteRule(a.warehouseId, b.warehouseId, { leadTimeDays: 9, leadTimeStdDays: 1, coverDays: 10 }, trx);
      await trx.insert(wmsTables.routeLeadTimeProfiles).values({ fromWarehouseId: a.warehouseId, toWarehouseId: c.warehouseId, observations: 6, meanDays: 7, stdDays: 2, windowFrom: '2025-09-08', windowTo: '2026-09-08', computedAt: new Date() });

      const rows = await reader.listRouteRows(trx);
      const ab = rows.find((r) => r.fromWarehouseId === a.warehouseId && r.toWarehouseId === b.warehouseId);
      const ac = rows.find((r) => r.fromWarehouseId === a.warehouseId && r.toWarehouseId === c.warehouseId);
      expect(ab).toMatchObject({ rule: { leadTimeDays: 9, coverDays: 10 }, observation: null });
      expect(ab?.fromWarehouseName).toBeTruthy();
      expect(ac).toMatchObject({ rule: null, observation: { observations: 6, meanDays: 7 } });
      expect((await reader.readRouteRules(trx)).get(routeKey(a.warehouseId, b.warehouseId))?.coverDays).toBe(10);

      await expect(manager.upsertRouteRule(a.warehouseId, a.warehouseId, { leadTimeDays: 1, leadTimeStdDays: null, coverDays: 1 }, trx)).rejects.toThrow(/같은 창고/);
      await expect(manager.upsertRouteRule(a.warehouseId, randomUUID(), { leadTimeDays: 1, leadTimeStdDays: null, coverDays: 1 }, trx)).rejects.toThrow(/창고/);
      await manager.deleteRouteRule(a.warehouseId, b.warehouseId, trx);
      expect((await reader.readRouteRules(trx)).has(routeKey(a.warehouseId, b.warehouseId))).toBe(false);
    });
  });

  it('SKU 예외: upsert · 코드/이름 검색 · delete · 없는 SKU 404', async () => {
    await inRollbackTx(db, async (trx) => {
      await seedRules(trx);
      const { holderId } = await seedHolder(trx);
      const { skuId, skuCode } = await seedSku(trx, holderId);
      const { reader, manager } = build(trx);
      const row = await manager.upsertSkuOverride(skuId, { mode: 'excluded', excludedUntil: '2026-12-31', safetyStock: null, alpha: null, memo: '시즌오프' }, trx);
      expect(row).toMatchObject({ skuId, mode: 'excluded', excludedUntil: '2026-12-31', memo: '시즌오프' });

      const found = await reader.searchSkuOverrides(trx, skuCode.slice(3, 12).toLowerCase(), 50);
      expect(found.map((r) => r.skuId)).toEqual([skuId]);
      expect(found[0]).toMatchObject({ skuCode, skuName: 'it-sku', mode: 'excluded' });
      expect((await reader.readSkuOverrides(trx, [skuId])).get(skuId)?.mode).toBe('excluded');

      await manager.upsertSkuOverride(skuId, { mode: 'auto', excludedUntil: null, safetyStock: 40, alpha: 0.01, memo: null }, trx);
      expect((await reader.readSkuOverrides(trx, [skuId])).get(skuId)).toMatchObject({ mode: 'auto', safetyStock: 40, alpha: 0.01, excludedUntil: null });

      await manager.deleteSkuOverride(skuId, trx);
      expect((await reader.readSkuOverrides(trx, [skuId])).size).toBe(0);
      await expect(manager.deleteSkuOverride(skuId, trx)).rejects.toThrow(/예외/);
      await expect(manager.upsertSkuOverride(randomUUID(), { mode: 'auto' }, trx)).rejects.toThrow(/SKU/);
    });
  });

  it('전역 설정 PUT: 부분 갱신, A컷 ≥ B컷 은 400', async () => {
    await inRollbackTx(db, async (trx) => {
      await seedRules(trx);
      const { manager } = build(trx);
      const updated = await manager.updateSettings({ demandRecomputeDays: 21, defaultLeadTimeStdDays: 4 }, trx);
      expect(updated).toMatchObject({ demandRecomputeDays: 21, defaultLeadTimeStdDays: 4, classificationWindowDays: 365 });
      await expect(manager.updateSettings({ gradeACut: 0.9, gradeBCut: 0.8 }, trx)).rejects.toThrow(/등급 컷/);
      await expect(manager.updateSettings({ gradeACut: 0.96 }, trx)).rejects.toThrow(/등급 컷/); // 기존 B컷 0.95 와 비교
    });
  });

  it('등급 PUT: A · B · C 셋이 아니면 400, 맞으면 3행 갱신', async () => {
    await inRollbackTx(db, async (trx) => {
      await seedRules(trx);
      const { manager, reader } = build(trx);
      await expect(manager.replaceGradeRules([{ grade: 'A', alpha: 0.01 }, { grade: 'A', alpha: 0.02 }, { grade: 'B', alpha: 0.05 }], trx)).rejects.toThrow(/A · B · C/);
      await manager.replaceGradeRules([{ grade: 'C', alpha: 0.2 }, { grade: 'A', alpha: 0.01 }, { grade: 'B', alpha: 0.05 }], trx);
      expect(await reader.readGradeAlphas(trx)).toEqual({ A: 0.01, B: 0.05, C: 0.2 });
    });
  });
});
```

- [ ] **Step 3: 실패 확인**

Run: `COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- replenishment-rules.integration`
Expected: FAIL — `Cannot find module './replenishment-rules.reader'`

- [ ] **Step 4: Reader**

```ts
// apps/core/src/modules/inventory/replenishment/rules/replenishment-rules.reader.ts
import { Injectable } from '@nestjs/common';
import { asc, eq, ilike, inArray, or } from 'drizzle-orm';
import { InjectTypedDb, DbService } from '@app/db';
import {
  wmsSchema,
  wmsTables,
  DbTx,
  ReplenishmentGradeRule,
  ReplenishmentRouteRule,
  ReplenishmentSkuOverride,
  ReplenishmentSupplierRule,
} from '../../schema/inventory.schema';
import { DemandGrade } from '../demand/demand-profile.calculator';

export function routeKey(fromWarehouseId: string, toWarehouseId: string): string {
  return `${fromWarehouseId}:${toWarehouseId}`;
}

export interface LeadTimeObservationRow {
  observations: number;
  meanDays: number;
  stdDays: number | null;
  windowFrom: string;
  windowTo: string;
}
export interface LeadTimeRuleRow {
  leadTimeDays: number;
  leadTimeStdDays: number | null;
  coverDays: number;
  updatedAt: Date;
}
export interface SupplierRuleRow {
  supplierId: string;
  supplierName: string;
  defaultWarehouseId: string | null;
  rule: LeadTimeRuleRow | null;
  observation: LeadTimeObservationRow | null;
}
export interface RouteRuleRow {
  fromWarehouseId: string;
  fromWarehouseName: string;
  toWarehouseId: string;
  toWarehouseName: string;
  rule: LeadTimeRuleRow | null;
  observation: LeadTimeObservationRow | null;
}
export interface SkuOverrideRow extends ReplenishmentSkuOverride {
  skuCode: string;
  skuName: string;
}

const GRADES: DemandGrade[] = ['A', 'B', 'C'];

/** 규칙 4표 + 리드타임 프로필 2표 읽기 (스펙 §6). 쓰기는 Manager. */
@Injectable()
export class ReplenishmentRulesReader {
  constructor(@InjectTypedDb<typeof wmsSchema>() private readonly dbService: DbService<typeof wmsSchema>) {}

  async readGradeAlphas(tx?: DbTx): Promise<Record<DemandGrade, number>> {
    return this.dbService.run(async (trx) => {
      const rows = await trx.select().from(wmsTables.replenishmentGradeRules);
      const byGrade = new Map(rows.map((r) => [r.grade, r.alpha]));
      const missing = GRADES.filter((g) => !byGrade.has(g));
      if (missing.length) throw new Error(`replenishment_grade_rules 에 ${missing.join(', ')} 가 없다 — db:seed:ref 를 먼저 돌릴 것`);
      return { A: byGrade.get('A') ?? 0, B: byGrade.get('B') ?? 0, C: byGrade.get('C') ?? 0 };
    }, tx);
  }

  listGradeRules(tx?: DbTx): Promise<ReplenishmentGradeRule[]> {
    return this.dbService.run(
      (trx) => trx.select().from(wmsTables.replenishmentGradeRules).orderBy(asc(wmsTables.replenishmentGradeRules.grade)),
      tx,
    );
  }

  async readSupplierRules(tx: DbTx, supplierIds: string[]): Promise<Map<string, ReplenishmentSupplierRule>> {
    const unique = [...new Set(supplierIds)];
    if (unique.length === 0) return new Map();
    return this.dbService.run(async (trx) => {
      const rows = await trx
        .select()
        .from(wmsTables.replenishmentSupplierRules)
        .where(inArray(wmsTables.replenishmentSupplierRules.supplierId, unique));
      return new Map(rows.map((r) => [r.supplierId, r]));
    }, tx);
  }

  async readRouteRules(tx: DbTx): Promise<Map<string, ReplenishmentRouteRule>> {
    return this.dbService.run(async (trx) => {
      const rows = await trx.select().from(wmsTables.replenishmentRouteRules);
      return new Map(rows.map((r) => [routeKey(r.fromWarehouseId, r.toWarehouseId), r]));
    }, tx);
  }

  async readSkuOverrides(tx: DbTx, skuIds: string[]): Promise<Map<string, ReplenishmentSkuOverride>> {
    const unique = [...new Set(skuIds)];
    if (unique.length === 0) return new Map();
    return this.dbService.run(async (trx) => {
      const rows = await trx
        .select()
        .from(wmsTables.replenishmentSkuOverrides)
        .where(inArray(wmsTables.replenishmentSkuOverrides.skuId, unique));
      return new Map(rows.map((r) => [r.skuId, r]));
    }, tx);
  }

  /** 전 공급사 ← 규칙 ← 관측 프로필 left join, 이름순. */
  async listSupplierRows(tx?: DbTx): Promise<SupplierRuleRow[]> {
    return this.dbService.run(async (trx) => {
      const s = wmsTables.suppliers;
      const r = wmsTables.replenishmentSupplierRules;
      const p = wmsTables.supplierLeadTimeProfiles;
      const rows = await trx
        .select({
          supplierId: s.id,
          supplierName: s.name,
          defaultWarehouseId: s.defaultWarehouseId,
          ruleLeadTimeDays: r.leadTimeDays,
          ruleLeadTimeStdDays: r.leadTimeStdDays,
          ruleCoverDays: r.coverDays,
          ruleUpdatedAt: r.updatedAt,
          obsObservations: p.observations,
          obsMeanDays: p.meanDays,
          obsStdDays: p.stdDays,
          obsWindowFrom: p.windowFrom,
          obsWindowTo: p.windowTo,
        })
        .from(s)
        .leftJoin(r, eq(r.supplierId, s.id))
        .leftJoin(p, eq(p.supplierId, s.id))
        .orderBy(asc(s.name));
      return rows.map((row) => ({
        supplierId: row.supplierId,
        supplierName: row.supplierName,
        defaultWarehouseId: row.defaultWarehouseId,
        rule:
          row.ruleLeadTimeDays === null || row.ruleCoverDays === null || row.ruleUpdatedAt === null
            ? null
            : { leadTimeDays: row.ruleLeadTimeDays, leadTimeStdDays: row.ruleLeadTimeStdDays, coverDays: row.ruleCoverDays, updatedAt: row.ruleUpdatedAt },
        observation:
          row.obsObservations === null || row.obsMeanDays === null || row.obsWindowFrom === null || row.obsWindowTo === null
            ? null
            : { observations: row.obsObservations, meanDays: row.obsMeanDays, stdDays: row.obsStdDays, windowFrom: row.obsWindowFrom, windowTo: row.obsWindowTo },
      }));
    }, tx);
  }

  /** 규칙 ∪ 관측 경로. 창고명은 메모리에서 붙인다. */
  async listRouteRows(tx?: DbTx): Promise<RouteRuleRow[]> {
    return this.dbService.run(async (trx) => {
      const rules = await trx.select().from(wmsTables.replenishmentRouteRules);
      const profiles = await trx.select().from(wmsTables.routeLeadTimeProfiles);
      const warehouses = await trx.select({ id: wmsTables.warehouses.id, name: wmsTables.warehouses.name }).from(wmsTables.warehouses);
      const nameOf = new Map(warehouses.map((w) => [w.id, w.name]));

      const merged = new Map<string, RouteRuleRow>();
      const ensure = (from: string, to: string): RouteRuleRow => {
        const key = routeKey(from, to);
        const existing = merged.get(key);
        if (existing) return existing;
        const row: RouteRuleRow = {
          fromWarehouseId: from,
          fromWarehouseName: nameOf.get(from) ?? from,
          toWarehouseId: to,
          toWarehouseName: nameOf.get(to) ?? to,
          rule: null,
          observation: null,
        };
        merged.set(key, row);
        return row;
      };
      for (const r of rules) {
        ensure(r.fromWarehouseId, r.toWarehouseId).rule = {
          leadTimeDays: r.leadTimeDays,
          leadTimeStdDays: r.leadTimeStdDays,
          coverDays: r.coverDays,
          updatedAt: r.updatedAt,
        };
      }
      for (const p of profiles) {
        ensure(p.fromWarehouseId, p.toWarehouseId).observation = {
          observations: p.observations,
          meanDays: p.meanDays,
          stdDays: p.stdDays,
          windowFrom: p.windowFrom,
          windowTo: p.windowTo,
        };
      }
      return [...merged.values()].sort((a, b) =>
        a.fromWarehouseName.localeCompare(b.fromWarehouseName) || a.toWarehouseName.localeCompare(b.toWarehouseName),
      );
    }, tx);
  }

  async searchSkuOverrides(tx: DbTx, q: string | undefined, limit: number): Promise<SkuOverrideRow[]> {
    return this.dbService.run(async (trx) => {
      const o = wmsTables.replenishmentSkuOverrides;
      const s = wmsTables.skus;
      const pattern = q && q.trim() ? `%${q.trim()}%` : null;
      const rows = await trx
        .select({ override: o, skuCode: s.code, skuName: s.name })
        .from(o)
        .innerJoin(s, eq(s.id, o.skuId))
        .where(pattern ? or(ilike(s.code, pattern), ilike(s.name, pattern)) : undefined)
        .orderBy(asc(s.code))
        .limit(limit);
      return rows.map((row) => ({ ...row.override, skuCode: row.skuCode, skuName: row.skuName }));
    }, tx);
  }
}
```

- [ ] **Step 5: Manager**

```ts
// apps/core/src/modules/inventory/replenishment/rules/replenishment-rules.manager.ts
import { Injectable } from '@nestjs/common';
import { and, eq, or } from 'drizzle-orm';
import { InjectTypedDb, DbService } from '@app/db';
import { BadRequestError, NotFoundError } from '@app/shared';
import {
  wmsSchema,
  wmsTables,
  DbTx,
  ReplenishmentGradeRule,
  ReplenishmentRouteRule,
  ReplenishmentSettings,
  ReplenishmentSkuOverride,
  ReplenishmentSupplierRule,
} from '../../schema/inventory.schema';
import { SETTINGS_KEY } from '../demand/replenishment-settings.reader';
import { UpdateReplenishmentSettingsDto, UpsertLeadTimeRuleDto, UpsertSkuOverrideDto, GradeRuleDto } from '../dto/replenishment-rules.dto';

/** 규칙 쓰기 + 검증 (스펙 §6). 대상 마스터(공급사 · 창고 · SKU)가 없으면 404, 모순 입력은 400. */
@Injectable()
export class ReplenishmentRulesManager {
  constructor(@InjectTypedDb<typeof wmsSchema>() private readonly dbService: DbService<typeof wmsSchema>) {}

  async updateSettings(dto: UpdateReplenishmentSettingsDto, tx?: DbTx): Promise<ReplenishmentSettings> {
    return this.dbService.run(async (trx) => {
      const t = wmsTables.replenishmentSettings;
      const [current] = await trx.select().from(t).where(eq(t.key, SETTINGS_KEY));
      if (!current) throw new Error('replenishment_settings 가 비어 있다 — db:seed:ref 를 먼저 돌릴 것');
      const aCut = dto.gradeACut ?? current.gradeACut;
      const bCut = dto.gradeBCut ?? current.gradeBCut;
      if (aCut >= bCut) throw new BadRequestError(`등급 컷은 A(${aCut}) < B(${bCut}) 여야 한다`);
      const [updated] = await trx
        .update(t)
        .set({ ...dto, updatedAt: new Date() })
        .where(eq(t.key, SETTINGS_KEY))
        .returning();
      return updated;
    }, tx);
  }

  async replaceGradeRules(items: GradeRuleDto[], tx?: DbTx): Promise<ReplenishmentGradeRule[]> {
    const grades = [...items.map((i) => i.grade)].sort().join('');
    if (grades !== 'ABC') throw new BadRequestError('등급 규칙은 A · B · C 세 행을 전부 보내야 한다');
    return this.dbService.run(async (trx) => {
      const t = wmsTables.replenishmentGradeRules;
      const now = new Date();
      for (const item of items) {
        await trx
          .insert(t)
          .values({ grade: item.grade, alpha: item.alpha })
          .onConflictDoUpdate({ target: t.grade, set: { alpha: item.alpha, updatedAt: now } });
      }
      return trx.select().from(t);
    }, tx);
  }

  async upsertSupplierRule(supplierId: string, dto: UpsertLeadTimeRuleDto, tx?: DbTx): Promise<ReplenishmentSupplierRule> {
    return this.dbService.run(async (trx) => {
      const [supplier] = await trx.select({ id: wmsTables.suppliers.id }).from(wmsTables.suppliers).where(eq(wmsTables.suppliers.id, supplierId));
      if (!supplier) throw new NotFoundError(`공급사 없음: ${supplierId}`);
      const t = wmsTables.replenishmentSupplierRules;
      const values = { supplierId, leadTimeDays: dto.leadTimeDays, leadTimeStdDays: dto.leadTimeStdDays ?? null, coverDays: dto.coverDays };
      const [row] = await trx
        .insert(t)
        .values(values)
        .onConflictDoUpdate({ target: t.supplierId, set: { ...values, updatedAt: new Date() } })
        .returning();
      return row;
    }, tx);
  }

  async deleteSupplierRule(supplierId: string, tx?: DbTx): Promise<void> {
    return this.dbService.run(async (trx) => {
      const t = wmsTables.replenishmentSupplierRules;
      const deleted = await trx.delete(t).where(eq(t.supplierId, supplierId)).returning({ id: t.supplierId });
      if (deleted.length === 0) throw new NotFoundError(`공급사 규칙 없음: ${supplierId}`);
    }, tx);
  }

  async upsertRouteRule(fromWarehouseId: string, toWarehouseId: string, dto: UpsertLeadTimeRuleDto, tx?: DbTx): Promise<ReplenishmentRouteRule> {
    if (fromWarehouseId === toWarehouseId) throw new BadRequestError('경로 규칙의 출발과 도착이 같은 창고일 수 없다');
    return this.dbService.run(async (trx) => {
      const w = wmsTables.warehouses;
      const found = await trx.select({ id: w.id }).from(w).where(or(eq(w.id, fromWarehouseId), eq(w.id, toWarehouseId)));
      if (found.length !== 2) throw new NotFoundError(`창고 없음: ${fromWarehouseId} 또는 ${toWarehouseId}`);
      const t = wmsTables.replenishmentRouteRules;
      const values = { fromWarehouseId, toWarehouseId, leadTimeDays: dto.leadTimeDays, leadTimeStdDays: dto.leadTimeStdDays ?? null, coverDays: dto.coverDays };
      const [row] = await trx
        .insert(t)
        .values(values)
        .onConflictDoUpdate({ target: [t.fromWarehouseId, t.toWarehouseId], set: { ...values, updatedAt: new Date() } })
        .returning();
      return row;
    }, tx);
  }

  async deleteRouteRule(fromWarehouseId: string, toWarehouseId: string, tx?: DbTx): Promise<void> {
    return this.dbService.run(async (trx) => {
      const t = wmsTables.replenishmentRouteRules;
      const deleted = await trx
        .delete(t)
        .where(and(eq(t.fromWarehouseId, fromWarehouseId), eq(t.toWarehouseId, toWarehouseId)))
        .returning({ id: t.fromWarehouseId });
      if (deleted.length === 0) throw new NotFoundError(`경로 규칙 없음: ${fromWarehouseId} → ${toWarehouseId}`);
    }, tx);
  }

  async upsertSkuOverride(skuId: string, dto: UpsertSkuOverrideDto, tx?: DbTx): Promise<ReplenishmentSkuOverride> {
    return this.dbService.run(async (trx) => {
      const [sku] = await trx
        .select({ id: wmsTables.skus.id })
        .from(wmsTables.skus)
        .where(and(eq(wmsTables.skus.id, skuId), eq(wmsTables.skus.isDeleted, false)));
      if (!sku) throw new NotFoundError(`SKU 없음: ${skuId}`);
      const t = wmsTables.replenishmentSkuOverrides;
      const values = {
        skuId,
        mode: dto.mode,
        excludedUntil: dto.excludedUntil ?? null,
        safetyStock: dto.safetyStock ?? null,
        alpha: dto.alpha ?? null,
        memo: dto.memo ?? null,
      };
      const [row] = await trx
        .insert(t)
        .values(values)
        .onConflictDoUpdate({ target: t.skuId, set: { ...values, updatedAt: new Date() } })
        .returning();
      return row;
    }, tx);
  }

  async deleteSkuOverride(skuId: string, tx?: DbTx): Promise<void> {
    return this.dbService.run(async (trx) => {
      const t = wmsTables.replenishmentSkuOverrides;
      const deleted = await trx.delete(t).where(eq(t.skuId, skuId)).returning({ id: t.skuId });
      if (deleted.length === 0) throw new NotFoundError(`SKU 예외 없음: ${skuId}`);
    }, tx);
  }
}
```

- [ ] **Step 6: Service · Controller**

```ts
// apps/core/src/modules/inventory/replenishment/rules/replenishment-rules.service.ts
import { Injectable } from '@nestjs/common';
import { InjectTypedDb, DbService } from '@app/db';
import { wmsSchema, DbTx, ReplenishmentSettings, ReplenishmentSkuOverride } from '../../schema/inventory.schema';
import { ReplenishmentSettingsReader } from '../demand/replenishment-settings.reader';
import { ReplenishmentRulesReader, SupplierRuleRow, RouteRuleRow, SkuOverrideRow, LeadTimeRuleRow } from './replenishment-rules.reader';
import { ReplenishmentRulesManager } from './replenishment-rules.manager';
import {
  GradeRuleDto,
  GradeRulesDto,
  LeadTimeRuleDto,
  ReplenishmentSettingsDto,
  RouteRulesListDto,
  SkuOverrideRowDto,
  SkuOverridesListDto,
  SupplierRulesListDto,
  UpdateReplenishmentSettingsDto,
  UpsertLeadTimeRuleDto,
  UpsertSkuOverrideDto,
} from '../dto/replenishment-rules.dto';

/** 트랜잭션 경계 + DTO 매핑. 검증 · 쓰기는 Manager, 조회는 Reader. */
@Injectable()
export class ReplenishmentRulesService {
  constructor(
    @InjectTypedDb<typeof wmsSchema>() private readonly dbService: DbService<typeof wmsSchema>,
    private readonly settingsReader: ReplenishmentSettingsReader,
    private readonly reader: ReplenishmentRulesReader,
    private readonly manager: ReplenishmentRulesManager,
  ) {}

  async getSettings(tx?: DbTx): Promise<ReplenishmentSettingsDto> {
    return toSettingsDto(await this.settingsReader.read(tx));
  }
  async updateSettings(dto: UpdateReplenishmentSettingsDto, tx?: DbTx): Promise<ReplenishmentSettingsDto> {
    return toSettingsDto(await this.manager.updateSettings(dto, tx));
  }

  async getGrades(tx?: DbTx): Promise<GradeRulesDto> {
    return { items: (await this.reader.listGradeRules(tx)).map((r) => ({ grade: r.grade, alpha: r.alpha })) };
  }
  async updateGrades(items: GradeRuleDto[], tx?: DbTx): Promise<GradeRulesDto> {
    return { items: (await this.manager.replaceGradeRules(items, tx)).map((r) => ({ grade: r.grade, alpha: r.alpha })) };
  }

  async listSuppliers(tx?: DbTx): Promise<SupplierRulesListDto> {
    return { items: (await this.reader.listSupplierRows(tx)).map(toSupplierRowDto) };
  }
  async upsertSupplier(supplierId: string, dto: UpsertLeadTimeRuleDto, tx?: DbTx): Promise<LeadTimeRuleDto> {
    return toRuleDto(await this.manager.upsertSupplierRule(supplierId, dto, tx));
  }
  deleteSupplier(supplierId: string, tx?: DbTx): Promise<void> {
    return this.manager.deleteSupplierRule(supplierId, tx);
  }

  async listRoutes(tx?: DbTx): Promise<RouteRulesListDto> {
    return { items: (await this.reader.listRouteRows(tx)).map(toRouteRowDto) };
  }
  async upsertRoute(from: string, to: string, dto: UpsertLeadTimeRuleDto, tx?: DbTx): Promise<LeadTimeRuleDto> {
    return toRuleDto(await this.manager.upsertRouteRule(from, to, dto, tx));
  }
  deleteRoute(from: string, to: string, tx?: DbTx): Promise<void> {
    return this.manager.deleteRouteRule(from, to, tx);
  }

  listSkuOverrides(q: string | undefined, limit: number, tx?: DbTx): Promise<SkuOverridesListDto> {
    return this.dbService.run(async (trx) => ({ items: (await this.reader.searchSkuOverrides(trx, q, limit)).map(toOverrideRowDto) }), tx);
  }
  async upsertSkuOverride(skuId: string, dto: UpsertSkuOverrideDto, tx?: DbTx): Promise<SkuOverrideRowDto> {
    return this.dbService.run(async (trx) => {
      await this.manager.upsertSkuOverride(skuId, dto, trx);
      const [row] = await this.reader.searchSkuOverridesById(trx, skuId);
      return toOverrideRowDto(row);
    }, tx);
  }
  deleteSkuOverride(skuId: string, tx?: DbTx): Promise<void> {
    return this.manager.deleteSkuOverride(skuId, tx);
  }
}

function toSettingsDto(s: ReplenishmentSettings): ReplenishmentSettingsDto {
  return {
    key: s.key,
    adiThreshold: s.adiThreshold,
    cv2Threshold: s.cv2Threshold,
    classificationWindowDays: s.classificationWindowDays,
    paramWindowDaysFrequent: s.paramWindowDaysFrequent,
    paramWindowDaysSparse: s.paramWindowDaysSparse,
    minDemandEvents: s.minDemandEvents,
    minLeadTimeObservations: s.minLeadTimeObservations,
    leadTimeWindowDays: s.leadTimeWindowDays,
    gradeACut: s.gradeACut,
    gradeBCut: s.gradeBCut,
    demandCoreSince: s.demandCoreSince,
    demandRecomputeDays: s.demandRecomputeDays,
    consolidationBufferDays: s.consolidationBufferDays,
    defaultLeadTimeDays: s.defaultLeadTimeDays,
    defaultLeadTimeStdDays: s.defaultLeadTimeStdDays,
    defaultTransferLeadTimeDays: s.defaultTransferLeadTimeDays,
    defaultTransferLeadTimeStdDays: s.defaultTransferLeadTimeStdDays,
    defaultLeadTimeCv: s.defaultLeadTimeCv,
    defaultCoverDays: s.defaultCoverDays,
    defaultTransferCoverDays: s.defaultTransferCoverDays,
    updatedAt: s.updatedAt.toISOString(),
  };
}
function toRuleDto(r: LeadTimeRuleRow | { leadTimeDays: number; leadTimeStdDays: number | null; coverDays: number; updatedAt: Date }): LeadTimeRuleDto {
  return { leadTimeDays: r.leadTimeDays, leadTimeStdDays: r.leadTimeStdDays, coverDays: r.coverDays, updatedAt: r.updatedAt.toISOString() };
}
function toSupplierRowDto(r: SupplierRuleRow) {
  return {
    supplierId: r.supplierId,
    supplierName: r.supplierName,
    defaultWarehouseId: r.defaultWarehouseId,
    rule: r.rule ? toRuleDto(r.rule) : null,
    observation: r.observation,
  };
}
function toRouteRowDto(r: RouteRuleRow) {
  return {
    fromWarehouseId: r.fromWarehouseId,
    fromWarehouseName: r.fromWarehouseName,
    toWarehouseId: r.toWarehouseId,
    toWarehouseName: r.toWarehouseName,
    rule: r.rule ? toRuleDto(r.rule) : null,
    observation: r.observation,
  };
}
function toOverrideRowDto(r: SkuOverrideRow): SkuOverrideRowDto {
  return {
    skuId: r.skuId,
    skuCode: r.skuCode,
    skuName: r.skuName,
    mode: r.mode,
    excludedUntil: r.excludedUntil,
    safetyStock: r.safetyStock,
    alpha: r.alpha,
    memo: r.memo,
    updatedAt: r.updatedAt.toISOString(),
  };
}
```

Reader 에 한 메서드를 더한다(서비스가 upsert 직후 코드 · 이름을 붙여 돌려주기 위해):

```ts
  async searchSkuOverridesById(tx: DbTx, skuId: string): Promise<SkuOverrideRow[]> {
    return this.dbService.run(async (trx) => {
      const o = wmsTables.replenishmentSkuOverrides;
      const s = wmsTables.skus;
      const rows = await trx
        .select({ override: o, skuCode: s.code, skuName: s.name })
        .from(o)
        .innerJoin(s, eq(s.id, o.skuId))
        .where(eq(o.skuId, skuId));
      return rows.map((row) => ({ ...row.override, skuCode: row.skuCode, skuName: row.skuName }));
    }, tx);
  }
```

`ReplenishmentSkuOverride` import 은 서비스에서 쓰지 않으면 지운다.

```ts
// apps/core/src/modules/inventory/replenishment/controllers/replenishment-rules.controller.ts
import { Body, Controller, Delete, Get, HttpCode, Param, Put, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { RequireScopes, ScopeGuard } from '@app/authorization';
import { INVENTORY_SCOPE } from '../../../../platform/auth/inventory-scopes';
import { ReplenishmentRulesService } from '../rules/replenishment-rules.service';
import {
  GradeRulesDto,
  LeadTimeRuleDto,
  ListSkuOverridesQueryDto,
  ReplenishmentSettingsDto,
  RouteRulesListDto,
  SkuOverrideRowDto,
  SkuOverridesListDto,
  SupplierRulesListDto,
  UpdateGradeRulesDto,
  UpdateReplenishmentSettingsDto,
  UpsertLeadTimeRuleDto,
  UpsertSkuOverrideDto,
} from '../dto/replenishment-rules.dto';

/**
 * 재고관리 규칙 CRUD (#743 B, 스펙 §6 · §7.4). 전부 inventory.manage.
 * α · 리드타임 · 커버 · 예외는 저장 즉시 제안에 반영되고, 창 길이 · 임계 · 등급 컷 · D0 · 재계산 일수는
 * 다음 야간 배치 또는 POST /replenishment/profiles/recompute 에서 반영된다 — 화면이 항목마다 알린다.
 */
@ApiTags('Inventory - Replenishment')
@Controller('replenishment/rules')
@UseGuards(ScopeGuard)
export class ReplenishmentRulesController {
  constructor(private readonly service: ReplenishmentRulesService) {}

  @Get('settings')
  @RequireScopes(INVENTORY_SCOPE.MANAGE)
  @ApiOperation({ summary: '전역 설정' })
  @ApiResponse({ status: 200, type: ReplenishmentSettingsDto })
  getSettings(): Promise<ReplenishmentSettingsDto> {
    return this.service.getSettings();
  }

  @Put('settings')
  @RequireScopes(INVENTORY_SCOPE.MANAGE)
  @ApiOperation({ summary: '전역 설정 부분 갱신' })
  @ApiResponse({ status: 200, type: ReplenishmentSettingsDto })
  @ApiResponse({ status: 400, description: '등급 컷 순서 등 모순' })
  updateSettings(@Body() dto: UpdateReplenishmentSettingsDto): Promise<ReplenishmentSettingsDto> {
    return this.service.updateSettings(dto);
  }

  @Get('grades')
  @RequireScopes(INVENTORY_SCOPE.MANAGE)
  @ApiOperation({ summary: '등급별 α' })
  @ApiResponse({ status: 200, type: GradeRulesDto })
  getGrades(): Promise<GradeRulesDto> {
    return this.service.getGrades();
  }

  @Put('grades')
  @RequireScopes(INVENTORY_SCOPE.MANAGE)
  @ApiOperation({ summary: '등급별 α 3행 일괄' })
  @ApiResponse({ status: 200, type: GradeRulesDto })
  updateGrades(@Body() dto: UpdateGradeRulesDto): Promise<GradeRulesDto> {
    return this.service.updateGrades(dto.items);
  }

  @Get('suppliers')
  @RequireScopes(INVENTORY_SCOPE.MANAGE)
  @ApiOperation({ summary: '공급사 목록 + 규칙 + 관측 프로필' })
  @ApiResponse({ status: 200, type: SupplierRulesListDto })
  listSuppliers(): Promise<SupplierRulesListDto> {
    return this.service.listSuppliers();
  }

  @Put('suppliers/:supplierId')
  @RequireScopes(INVENTORY_SCOPE.MANAGE)
  @ApiOperation({ summary: '공급사 규칙 upsert' })
  @ApiParam({ name: 'supplierId' })
  @ApiResponse({ status: 200, type: LeadTimeRuleDto })
  @ApiResponse({ status: 404, description: '공급사 없음' })
  upsertSupplier(@Param('supplierId') supplierId: string, @Body() dto: UpsertLeadTimeRuleDto): Promise<LeadTimeRuleDto> {
    return this.service.upsertSupplier(supplierId, dto);
  }

  @Delete('suppliers/:supplierId')
  @HttpCode(204)
  @RequireScopes(INVENTORY_SCOPE.MANAGE)
  @ApiOperation({ summary: '공급사 규칙 삭제 — 전역 기본으로 되돌린다' })
  @ApiParam({ name: 'supplierId' })
  @ApiResponse({ status: 404, description: '규칙 없음' })
  deleteSupplier(@Param('supplierId') supplierId: string): Promise<void> {
    return this.service.deleteSupplier(supplierId);
  }

  @Get('routes')
  @RequireScopes(INVENTORY_SCOPE.MANAGE)
  @ApiOperation({ summary: '경로 규칙 ∪ 관측 경로' })
  @ApiResponse({ status: 200, type: RouteRulesListDto })
  listRoutes(): Promise<RouteRulesListDto> {
    return this.service.listRoutes();
  }

  @Put('routes/:fromWarehouseId/:toWarehouseId')
  @RequireScopes(INVENTORY_SCOPE.MANAGE)
  @ApiOperation({ summary: '경로 규칙 upsert' })
  @ApiParam({ name: 'fromWarehouseId' })
  @ApiParam({ name: 'toWarehouseId' })
  @ApiResponse({ status: 200, type: LeadTimeRuleDto })
  @ApiResponse({ status: 400, description: '출발 = 도착' })
  @ApiResponse({ status: 404, description: '창고 없음' })
  upsertRoute(
    @Param('fromWarehouseId') from: string,
    @Param('toWarehouseId') to: string,
    @Body() dto: UpsertLeadTimeRuleDto,
  ): Promise<LeadTimeRuleDto> {
    return this.service.upsertRoute(from, to, dto);
  }

  @Delete('routes/:fromWarehouseId/:toWarehouseId')
  @HttpCode(204)
  @RequireScopes(INVENTORY_SCOPE.MANAGE)
  @ApiOperation({ summary: '경로 규칙 삭제' })
  @ApiParam({ name: 'fromWarehouseId' })
  @ApiParam({ name: 'toWarehouseId' })
  deleteRoute(@Param('fromWarehouseId') from: string, @Param('toWarehouseId') to: string): Promise<void> {
    return this.service.deleteRoute(from, to);
  }

  @Get('skus')
  @RequireScopes(INVENTORY_SCOPE.MANAGE)
  @ApiOperation({ summary: 'SKU 예외 목록 — 코드 · 이름 검색' })
  @ApiResponse({ status: 200, type: SkuOverridesListDto })
  listSkuOverrides(@Query() query: ListSkuOverridesQueryDto): Promise<SkuOverridesListDto> {
    return this.service.listSkuOverrides(query.q, query.limit ?? 100);
  }

  @Put('skus/:skuId')
  @RequireScopes(INVENTORY_SCOPE.MANAGE)
  @ApiOperation({ summary: 'SKU 예외 upsert' })
  @ApiParam({ name: 'skuId' })
  @ApiResponse({ status: 200, type: SkuOverrideRowDto })
  @ApiResponse({ status: 404, description: 'SKU 없음' })
  upsertSkuOverride(@Param('skuId') skuId: string, @Body() dto: UpsertSkuOverrideDto): Promise<SkuOverrideRowDto> {
    return this.service.upsertSkuOverride(skuId, dto);
  }

  @Delete('skus/:skuId')
  @HttpCode(204)
  @RequireScopes(INVENTORY_SCOPE.MANAGE)
  @ApiOperation({ summary: 'SKU 예외 삭제 — auto 로 되돌린다' })
  @ApiParam({ name: 'skuId' })
  deleteSkuOverride(@Param('skuId') skuId: string): Promise<void> {
    return this.service.deleteSkuOverride(skuId);
  }
}
```

컨트롤러 스펙:

```ts
// apps/core/src/modules/inventory/replenishment/controllers/replenishment-rules.controller.spec.ts
import { ReplenishmentRulesController } from './replenishment-rules.controller';
import { ReplenishmentRulesService } from '../rules/replenishment-rules.service';

describe('ReplenishmentRulesController', () => {
  const service = {
    updateGrades: jest.fn().mockResolvedValue({ items: [] }),
    listSkuOverrides: jest.fn().mockResolvedValue({ items: [] }),
    upsertRoute: jest.fn().mockResolvedValue({}),
  } as unknown as ReplenishmentRulesService;
  const controller = new ReplenishmentRulesController(service);

  it('등급 PUT 은 items 배열을 넘긴다', async () => {
    await controller.updateGrades({ items: [{ grade: 'A', alpha: 0.02 }, { grade: 'B', alpha: 0.05 }, { grade: 'C', alpha: 0.1 }] });
    expect(service.updateGrades).toHaveBeenCalledWith([{ grade: 'A', alpha: 0.02 }, { grade: 'B', alpha: 0.05 }, { grade: 'C', alpha: 0.1 }]);
  });
  it('SKU 예외 목록 limit 기본 100', async () => {
    await controller.listSkuOverrides({});
    expect(service.listSkuOverrides).toHaveBeenCalledWith(undefined, 100);
    await controller.listSkuOverrides({ q: 'abc', limit: 5 });
    expect(service.listSkuOverrides).toHaveBeenCalledWith('abc', 5);
  });
  it('경로 PUT 은 (from, to, dto)', async () => {
    await controller.upsertRoute('w1', 'w2', { leadTimeDays: 9, coverDays: 10 });
    expect(service.upsertRoute).toHaveBeenCalledWith('w1', 'w2', { leadTimeDays: 9, coverDays: 10 });
  });
});
```

- [ ] **Step 7: 모듈 배선 · 스코프 표**

`replenishment.module.ts`: import 4개 추가(`ReplenishmentRulesController` · `ReplenishmentRulesReader` · `ReplenishmentRulesManager` · `ReplenishmentRulesService`), `controllers` 에 컨트롤러, `providers` 에 셋, `exports` 에 `ReplenishmentRulesReader`.

`inventory-scope-coverage.spec.ts`: 배너 숫자 **59 → 72**, `'POST /replenishment/profiles/recompute'` 줄 앞뒤로 경로 알파벳순에 맞춰 13줄:

```ts
  'DELETE /replenishment/rules/routes/:fromWarehouseId/:toWarehouseId': S.MANAGE,
  'DELETE /replenishment/rules/skus/:skuId':                   S.MANAGE,
  'DELETE /replenishment/rules/suppliers/:supplierId':         S.MANAGE,
  'GET /replenishment/rules/grades':                           S.MANAGE,
  'GET /replenishment/rules/routes':                           S.MANAGE,
  'GET /replenishment/rules/settings':                         S.MANAGE,
  'GET /replenishment/rules/skus':                             S.MANAGE,
  'GET /replenishment/rules/suppliers':                        S.MANAGE,
  'PUT /replenishment/rules/grades':                           S.MANAGE,
  'PUT /replenishment/rules/routes/:fromWarehouseId/:toWarehouseId': S.MANAGE,
  'PUT /replenishment/rules/settings':                         S.MANAGE,
  'PUT /replenishment/rules/skus/:skuId':                      S.MANAGE,
  'PUT /replenishment/rules/suppliers/:supplierId':            S.MANAGE,
```

(표의 정확한 정렬 규칙은 기존 이웃 행을 따른다 — 스펙 2번 테스트는 집합 동등만 본다.)

- [ ] **Step 8: 설정 단일 읽기 — refresh job 이 한 번 읽어 세 단계에 넘긴다**

지금(A)까지는 `replenishment_settings` 가 읽기 전용이라 무해했지만, 이 태스크가 위에서
`PUT /replenishment/rules/settings` 를 연 순간부터는 아니다. `ReplenishmentRefreshJob.run()`
· `DemandProfileRefresher.refreshAll()` · `LeadTimeProfileRefresher.refreshAll()` 이 각자
제 트랜잭션에서 `settingsReader.read()` 를 따로 부른다 — 세 번. 한 야간 배치가 도는 몇 초~몇십 초
사이에 운영자가 저장을 누르면, 단계마다 다른 창 길이 · 다른 등급 컷을 보게 되고 그 결과가 한
런 안에서 섞인 프로필로 남는다. A 는 이미 `today` 를 `run()` 초입에서 한 번만 계산해 세 단계에
그대로 넘기는 방식으로 이 문제를 피해뒀다(`kstDateOf(now)` 한 번 → `{ today }` 로 전파) — 그
패턴을 `settings` 에도 그대로 적용한다: `run()` 이 한 번 읽고, 두 refresher 는 더 이상
`ReplenishmentSettingsReader` 를 직접 부르지 않는다.

- `replenishment-refresh.job.ts`: `run()` 초입에서 `const settings = await this.settingsReader.read();` 를
  유지(이미 있음) 하되, 아래로 넘기지 않던 `profileRefresher.refreshAll({ today })` ·
  `leadTimeRefresher.refreshAll({ today })` 호출에 `settings` 를 추가한다 — `{ today, settings }`.
- `demand-profile.refresher.ts`: `refreshAll(input: { today: string }, tx?)` 를
  `refreshAll(input: { today: string; settings: ReplenishmentSettings }, tx?)` 로 바꾸고, 본문의
  `const settings = await this.settingsReader.read(trx);` 줄을 지우고 `input.settings` 를 쓴다.
  생성자에서 이제 안 쓰는 `settingsReader: ReplenishmentSettingsReader` 의존을 제거한다(다른 데서
  안 쓰면 — 이 클래스 안에서만 쓰였는지 먼저 grep 으로 확인).
- `lead-time-profile.refresher.ts`: 위와 같은 변경(`refreshAll` 시그니처 · 내부 읽기 제거 ·
  생성자 의존 제거).
- 세 스펙 파일의 mock 도 맞춰 고친다 — `settingsReader.read` 를 스텁하던 자리 대신 테스트가
  `refreshAll({ today, settings: fixtureSettings })` 로 직접 넘긴다. `replenishment-refresh.job.spec.ts`
  는 `settingsReader.read` 가 정확히 1번만 불렸는지(세 번이 아니라) 검증하는 케이스를 추가한다.
- `replenishment.module.ts` 의 providers 배열은 안 건드린다 — `ReplenishmentSettingsReader` 는
  이 태스크의 규칙 Reader/Manager 가 여전히 쓴다.

Run: `npx jest apps/core/src/modules/inventory/replenishment/demand`
Expected: 세 스펙 전부 PASS, `settingsReader.read` 호출 횟수 검증 케이스 포함.

- [ ] **Step 9: 통과 확인**

```bash
COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- replenishment-rules.integration
npx jest apps/core/src/modules/inventory/replenishment/controllers/replenishment-rules.controller.spec.ts apps/core/src/platform/auth/inventory-scope-coverage.spec.ts apps/core/src/platform/auth/scope-guard-binding.spec.ts apps/core/src/modules/inventory/replenishment-boundary.arch.spec.ts apps/core/src/modules/inventory/replenishment/demand
npm run type-check
```

Expected: 통합 7 PASS · 컨트롤러 3 PASS · 스코프 표 · 가드 바인딩 · 경계 · demand 스펙 전부 PASS · type-check 0.

- [ ] **Step 10: 커밋**

```bash
git add apps/core/src/modules/inventory/replenishment apps/core/src/platform/auth/inventory-scope-coverage.spec.ts
git commit -m "feat(core): 재고 보충 규칙 CRUD 13라우트 — 전역 · 등급 · 공급사 · 경로 · SKU 예외 (#743 B)

설정 PUT 이 생겨 런 도중 편집이 가능해지므로, 야간 배치 세 단계가 각자 읽던 설정을
run() 초입 한 번으로 합쳐 today 와 같은 방식으로 전파한다.

Claude-Session: https://claude.ai/code/session_01Y5Bthz8rSpjhTgrZTzGBED"
```

---
### Task 6: 제안 교체 — 프로필 · 규칙 · 정책으로 `levelsFor` 를 바꾸고 C 의 TODO 둘을 닫는다

**Files:**
- Modify: `apps/core/src/modules/inventory/warehouse-transfer/services/warehouse-transfer.reader.ts` + `.integration.spec.ts`
- Create: `apps/core/src/modules/inventory/replenishment/demand/demand-profile.reader.ts`
- Modify: `apps/core/src/modules/inventory/replenishment/suggestion/suggestion.types.ts`
- Modify: `apps/core/src/modules/inventory/replenishment/suggestion/suggestion.assembler.ts` + `.spec.ts`
- Modify: `apps/core/src/modules/inventory/replenishment/suggestion/replenishment-stock.reader.ts` + `.integration.spec.ts`
- Modify: `apps/core/src/modules/inventory/replenishment/suggestion/replenishment-suggestion.reader.ts`
- Modify: `apps/core/src/modules/inventory/replenishment/suggestion/replenishment-suggestion.service.ts` + `.integration.spec.ts`
- Modify: `apps/core/src/modules/inventory/replenishment/dto/replenishment-suggestion.dto.ts`
- Modify: `apps/core/src/modules/inventory/replenishment/controllers/replenishment-suggestion.controller.ts`
- Modify: `apps/core/src/modules/inventory/replenishment/replenishment.module.ts`

**Interfaces:**
- Consumes: Task 3 `computePolicy` · `composeLeadTime`, Task 4 `resolveEffectiveParameters`, Task 5 `ReplenishmentRulesReader` · `routeKey`, A 의 `ReplenishmentSettingsReader` · `kstDateOf` · `SkuDemandProfile`.
- Produces:
  ```ts
  // warehouse-transfer.reader.ts
  findDraftPlannedBySku(tx: DbTx, skuIds: string[]): Promise<Map<string, Array<{ fromWarehouseId: string; qty: number }>>>  // 비판매 출발 창고만
  // demand/demand-profile.reader.ts
  export class DemandProfileReader {
    readProfiles(tx: DbTx, skuIds: string[]): Promise<Map<string, SkuDemandProfile>>;
    readSupplierLeadTimes(tx: DbTx): Promise<Map<string, LeadTimeObservation>>;
    readRouteLeadTimes(tx: DbTx): Promise<Map<string, LeadTimeObservation>>;   // routeKey
  }
  // suggestion.types.ts
  export type SuggestionFlag = 'default_lead_time' | 'supplier_unknown' | 'low_confidence';   // legacy_only 삭제
  export interface AxisLevels { safetyStock: number; reorderPoint: number; targetLevel: number; leadTimeDays: number }
  export interface SkuStockInput { …C 의 재고 필드…, sourceWarehouseId: string | null; pattern: DemandPattern; grade: DemandGrade; confidence: 'normal' | 'low';
    demand: { dailyMean: number; dailyStd: number }; legacyReorderPoint: number; levels: { company: AxisLevels; sellable: AxisLevels };
    parameterFlags: SuggestionFlag[]; draftTransferPlanned: Array<{ fromWarehouseId: string; qty: number }> }   // safetyStock 삭제
  // replenishment-suggestion.reader.ts
  export interface AssembledSku { row: SuggestionRow; profile: SkuDemandProfile | null; parameters: EffectiveParameters }
  findDetail(trx: DbTx, skuId: string): Promise<AssembledSku>   // excluded 여도 행을 준다 (드로어용)
  // dto
  export class ReplenishmentSkuDetailDto extends ReplenishmentSuggestionRowDto { profile: SkuDemandProfileDto | null; parameters: EffectiveParametersDto }
  ```
  응답 변화: `legacy_only` 플래그 사라짐, `daysOfCover` = IP_판매 ÷ μ_D(μ_D = 0 이면 null), 목록 정렬 = `daysOfCover` 오름차순(null 뒤, 동률은 skuCode), `purchase.sourceWarehouseId` = 공급사 `default_warehouse_id`, `GET /replenishment/skus/:skuId` 에 `profile` · `parameters`.

- [ ] **Step 1: `findDraftPlannedBySku` — 스펙부터**

`warehouse-transfer.reader.integration.spec.ts` 의 첫 테스트 끝 두 줄을 바꾸고 테스트 하나를 더한다:

```ts
      const result = await reader.findDraftPlannedBySku(trx, [skuId, otherSkuId]);
      expect(result.get(skuId)).toEqual([{ fromWarehouseId: source.warehouseId, qty: 50 }]);
      expect(result.has(otherSkuId)).toBe(false);
```

```ts
  it('판매 창고에서 나가는 draft(반품 이동)는 세지 않고, 출발 창고별로 나눈다', async () => {
    await inRollbackTx(db, async (trx) => {
      const china = await seedWarehouseWithZone(trx);
      await trx.update(wmsTables.warehouses).set({ isSellable: false }).where(eq(wmsTables.warehouses.id, china.warehouseId));
      const other = await seedWarehouseWithZone(trx);
      await trx.update(wmsTables.warehouses).set({ isSellable: false }).where(eq(wmsTables.warehouses.id, other.warehouseId));
      const bucheon = await seedWarehouseWithZone(trx); // 판매 창고
      const { holderId } = await seedHolder(trx);
      const { skuId } = await seedSku(trx, holderId);
      await receiveStock(w.command, trx, { skuId, warehouseId: china.warehouseId, locationId: china.locationId, quantity: 100 });
      await receiveStock(w.command, trx, { skuId, warehouseId: other.warehouseId, locationId: other.locationId, quantity: 100 });
      await receiveStock(w.command, trx, { skuId, warehouseId: bucheon.warehouseId, locationId: bucheon.locationId, quantity: 100 });

      const dbService = boundDbService(trx);
      const manager = new WarehouseTransferManager(dbService, w.command, w.location, new InventoryIdempotencyService(dbService));
      const reader = new WarehouseTransferReader(dbService);
      await manager.createOrder({ fromWarehouseId: china.warehouseId, toWarehouseId: bucheon.warehouseId, lines: [{ skuId, fromLocationId: china.locationId, quantity: 10 }] }, trx);
      await manager.createOrder({ fromWarehouseId: other.warehouseId, toWarehouseId: bucheon.warehouseId, lines: [{ skuId, fromLocationId: other.locationId, quantity: 7 }] }, trx);
      // 부천 → 중국 반품 이동 초안 — 비판매 이동가능과 무관
      await manager.createOrder({ fromWarehouseId: bucheon.warehouseId, toWarehouseId: china.warehouseId, lines: [{ skuId, fromLocationId: bucheon.locationId, quantity: 99 }] }, trx);

      const result = await reader.findDraftPlannedBySku(trx, [skuId]);
      expect(result.get(skuId)).toEqual(
        expect.arrayContaining([
          { fromWarehouseId: china.warehouseId, qty: 10 },
          { fromWarehouseId: other.warehouseId, qty: 7 },
        ]),
      );
      expect(result.get(skuId)).toHaveLength(2);
    });
  });
```

Run: `COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- warehouse-transfer.reader.integration` → FAIL (`toBe(50)` 형태와 어긋남).

- [ ] **Step 2: `findDraftPlannedBySku` 구현 교체**

`warehouse-transfer.reader.ts` — import 에 `not` 과 `inSellableWarehouse` 를 더하고 메서드를 바꾼다:

```ts
import { and, eq, gt, inArray, not, sql } from 'drizzle-orm';
import { inSellableWarehouse } from '../../shared/availability/sellable-warehouses';
```

```ts
  /**
   * draft 지시서에 실린 planned 합, SKU × 출발 창고 별. 보충 제안이 이동가능(비판매 ON_HAND)에서 뺀다 —
   * 초안은 원장을 안 움직이므로 원장만 보면 어제 낸 제안이 오늘 또 뜬다(#743 §7.2).
   * 선적된 지시서는 세지 않는다(이미 IN_TRANSFER). 판매 창고에서 나가는 초안(반품 이동)도 세지 않는다 —
   * 비판매 이동가능과 무관하다. 출발 창고별로 나누는 이유는 제안이 한 출발 창고만 고르기 때문이다(§7.2).
   */
  async findDraftPlannedBySku(
    tx: DbTx,
    skuIds: string[],
  ): Promise<Map<string, Array<{ fromWarehouseId: string; qty: number }>>> {
    const unique = [...new Set(skuIds)];
    if (unique.length === 0) return new Map();
    return this.dbService.run(async (trx) => {
      const lines = wmsTables.transferOrderLines;
      const orders = wmsTables.transferOrders;
      const rows = await trx
        .select({
          skuId: lines.skuId,
          fromWarehouseId: orders.fromWarehouseId,
          qty: sql<number>`SUM(${lines.plannedQty})::int`,
        })
        .from(lines)
        .innerJoin(orders, eq(orders.id, lines.transferOrderId))
        .where(and(eq(orders.status, 'draft'), not(inSellableWarehouse(orders.fromWarehouseId)), inArray(lines.skuId, unique)))
        .groupBy(lines.skuId, orders.fromWarehouseId);
      const result = new Map<string, Array<{ fromWarehouseId: string; qty: number }>>();
      for (const row of rows) {
        const list = result.get(row.skuId) ?? [];
        list.push({ fromWarehouseId: row.fromWarehouseId, qty: Number(row.qty) });
        result.set(row.skuId, list);
      }
      return result;
    }, tx);
  }
```

Run 위 통합 스펙 → PASS 3 tests. (`TODO(#743 A+B …)` 주석은 지운다.)

- [ ] **Step 3: `DemandProfileReader`**

```ts
// apps/core/src/modules/inventory/replenishment/demand/demand-profile.reader.ts
import { Injectable } from '@nestjs/common';
import { inArray } from 'drizzle-orm';
import { InjectTypedDb, DbService } from '@app/db';
import { wmsSchema, wmsTables, DbTx, SkuDemandProfile } from '../../schema/inventory.schema';
import { LeadTimeObservation } from '../rules/effective-parameters';
import { routeKey } from '../rules/replenishment-rules.reader';

/** A 가 물질화한 프로필 3표 읽기. 제안 조립이 쓴다. */
@Injectable()
export class DemandProfileReader {
  constructor(@InjectTypedDb<typeof wmsSchema>() private readonly dbService: DbService<typeof wmsSchema>) {}

  async readProfiles(tx: DbTx, skuIds: string[]): Promise<Map<string, SkuDemandProfile>> {
    const unique = [...new Set(skuIds)];
    if (unique.length === 0) return new Map();
    return this.dbService.run(async (trx) => {
      const rows = await trx.select().from(wmsTables.skuDemandProfiles).where(inArray(wmsTables.skuDemandProfiles.skuId, unique));
      return new Map(rows.map((r) => [r.skuId, r]));
    }, tx);
  }

  async readSupplierLeadTimes(tx: DbTx): Promise<Map<string, LeadTimeObservation>> {
    return this.dbService.run(async (trx) => {
      const rows = await trx.select().from(wmsTables.supplierLeadTimeProfiles);
      return new Map(rows.map((r) => [r.supplierId, { observations: r.observations, meanDays: r.meanDays, stdDays: r.stdDays }]));
    }, tx);
  }

  async readRouteLeadTimes(tx: DbTx): Promise<Map<string, LeadTimeObservation>> {
    return this.dbService.run(async (trx) => {
      const rows = await trx.select().from(wmsTables.routeLeadTimeProfiles);
      return new Map(
        rows.map((r) => [routeKey(r.fromWarehouseId, r.toWarehouseId), { observations: r.observations, meanDays: r.meanDays, stdDays: r.stdDays }]),
      );
    }, tx);
  }
}
```

- [ ] **Step 4: `suggestion.types.ts` 교체**

```ts
// apps/core/src/modules/inventory/replenishment/suggestion/suggestion.types.ts
import { DemandPattern } from '../policy/classification';
import { DemandGrade } from '../demand/demand-profile.calculator';

export type SuggestionFlag = 'default_lead_time' | 'supplier_unknown' | 'low_confidence';

export interface AxisLevels {
  safetyStock: number;
  reorderPoint: number;
  targetLevel: number;
  leadTimeDays: number;
}

export interface SkuStockInput {
  skuId: string;
  skuCode: string;
  skuName: string;
  supplier: { id: string; name: string } | null;
  /** 공급사 default_warehouse_id — 발주 제안의 출발 창고 */
  sourceWarehouseId: string | null;
  pattern: DemandPattern;
  grade: DemandGrade;
  confidence: 'normal' | 'low';
  demand: { dailyMean: number; dailyStd: number };
  legacyReorderPoint: number;
  /** 정책 층(B)이 축마다 계산한 수준. 조립기는 계산하지 않고 쓴다 */
  levels: { company: AxisLevels; sellable: AxisLevels };
  /** 파라미터 층이 정한 플래그 (default_lead_time · low_confidence). supplier_unknown 은 조립기가 붙인다 */
  parameterFlags: SuggestionFlag[];
  lot: { moq: number | null; packingUnit: number | null };
  excluded: boolean;
  /** 전 창고 ON_HAND 합 (판매·비판매 모두) */
  onHandTotal: number;
  /** 전 창고 IN_TRANSFER 합 */
  inTransferTotal: number;
  /** 전 창고 확정 예약 합 */
  reservedTotal: number;
  /** 판매 창고 ON_HAND */
  onHandSellable: number;
  /** 판매 창고 확정 예약 */
  reservedSellable: number;
  /** 비판매 창고 ON_HAND 를 (창고, 로케이션) 별로 — 이동 라인 재료 */
  nonSellableOnHand: Array<{ warehouseId: string; locationId: string; qty: number }>;
  /** 파이프라인: 전 창고 발주잔량 / 비판매 창고행 발주잔량 / 판매창고로 이동중 */
  onOrderTotal: number;
  onOrderNonSellable: number;
  inTransitToSellable: number;
  /** draft 이동 지시서에 이미 실린 planned 합 — 비판매 출발 창고별 */
  draftTransferPlanned: Array<{ fromWarehouseId: string; qty: number }>;
}

export interface AssembleContext {
  sellableWarehouseId: string;
}

export interface AxisView extends AxisLevels {
  onHand: number;
  reserved: number;
  position: number;
}

export interface CompanyAxis extends AxisView {
  inTransfer: number;
  onOrder: number;
}

export interface SellableAxis extends AxisView {
  warehouseId: string;
  inTransit: number;
  onOrderDirect: number;
  daysOfCover: number | null;
}

export type SuggestionAction =
  | { type: 'purchase'; qty: number; supplierId: string | null; sourceWarehouseId: string | null }
  | {
      type: 'transfer';
      qty: number;
      fromWarehouseId: string;
      toWarehouseId: string;
      lines: Array<{ fromLocationId: string; quantity: number }>;
    };

export interface SuggestionRow {
  skuId: string;
  skuCode: string;
  skuName: string;
  supplier: { id: string; name: string } | null;
  pattern: DemandPattern;
  grade: DemandGrade;
  confidence: 'normal' | 'low';
  demand: { dailyMean: number; dailyStd: number };
  company: CompanyAxis;
  sellable: SellableAxis;
  actions: SuggestionAction[];
  flags: SuggestionFlag[];
  legacyReorderPoint: number;
}
```

- [ ] **Step 5: 조립기 스펙 갱신 (실패부터)**

`suggestion.assembler.spec.ts` 의 `sku()` 픽스처를 이렇게 바꾼다:

```ts
const L = (v: number) => ({ safetyStock: v, reorderPoint: v, targetLevel: v, leadTimeDays: 0 });

function sku(overrides: Partial<SkuStockInput> = {}): SkuStockInput {
  return {
    skuId: 'sku-1',
    skuCode: 'S1',
    skuName: 'sku one',
    supplier: { id: 'sup-1', name: 'supplier' },
    sourceWarehouseId: null,
    pattern: 'insufficient',
    grade: 'C',
    confidence: 'low',
    demand: { dailyMean: 0, dailyStd: 0 },
    legacyReorderPoint: 100,
    levels: { company: L(100), sellable: L(100) },
    parameterFlags: [],
    lot: { moq: null, packingUnit: null },
    excluded: false,
    onHandTotal: 0,
    inTransferTotal: 0,
    reservedTotal: 0,
    onHandSellable: 0,
    reservedSellable: 0,
    nonSellableOnHand: [],
    onOrderTotal: 0,
    onOrderNonSellable: 0,
    inTransitToSellable: 0,
    draftTransferPlanned: [],
    ...overrides,
  };
}
```

세 테스트를 교체 · 추가한다 — `'draft 지시서에 실린 수량은 이동가능에서 뺀다'` 의 입력을 `draftTransferPlanned: [{ fromWarehouseId: CHINA, qty: 150 }]` 로, `'C 단계 자리표시: …'` 는 삭제하고 아래 셋을, `'판매창고 (위치 − 재주문점) 오름차순 …'` 는 아래 정렬 테스트로:

```ts
  it('다른 비판매 창고의 draft 는 고른 출발 창고의 이동가능을 줄이지 않는다', () => {
    const [row] = assembleSuggestions(
      [
        sku({
          onHandSellable: 0,
          onHandTotal: 260,
          nonSellableOnHand: [
            { warehouseId: CHINA, locationId: LOC_A, qty: 200 },
            { warehouseId: 'wh-other', locationId: 'loc-o', qty: 60 },
          ],
          draftTransferPlanned: [{ fromWarehouseId: 'wh-other', qty: 60 }],
        }),
      ],
      ctx,
    );
    // 출발 창고는 가장 큰 로케이션이 속한 CHINA. wh-other 의 draft 60 은 무관 → 필요 100 전부 CHINA 에서
    expect(row.actions).toEqual([
      { type: 'transfer', qty: 100, fromWarehouseId: CHINA, toWarehouseId: SELL, lines: [{ fromLocationId: LOC_A, quantity: 100 }] },
    ]);
  });

  it('수준은 levels 를 그대로 쓰고, 플래그는 parameterFlags + supplier_unknown', () => {
    const [row] = assembleSuggestions(
      [sku({ levels: { company: { safetyStock: 5, reorderPoint: 30, targetLevel: 80, leadTimeDays: 32 }, sellable: { safetyStock: 2, reorderPoint: 12, targetLevel: 40, leadTimeDays: 5 } }, parameterFlags: ['default_lead_time', 'low_confidence'], supplier: null, sourceWarehouseId: 'wh-china', pattern: 'smooth', grade: 'A', confidence: 'normal', legacyReorderPoint: 320 })],
      ctx,
    );
    expect(row.company).toMatchObject({ safetyStock: 5, reorderPoint: 30, targetLevel: 80, leadTimeDays: 32 });
    expect(row.sellable).toMatchObject({ safetyStock: 2, reorderPoint: 12, targetLevel: 40, leadTimeDays: 5 });
    expect(row.flags).toEqual(['default_lead_time', 'low_confidence', 'supplier_unknown']);
    expect(row.actions).toEqual([{ type: 'purchase', qty: 80, supplierId: null, sourceWarehouseId: 'wh-china' }]);
    expect(row).toMatchObject({ pattern: 'smooth', grade: 'A', confidence: 'normal', legacyReorderPoint: 320 });
  });

  it('daysOfCover = 판매 IP ÷ 일평균 (소수 1자리), 일평균 0 이면 null', () => {
    const [withDemand] = assembleSuggestions([sku({ demand: { dailyMean: 3, dailyStd: 1 }, onHandSellable: 10, onHandTotal: 10 })], ctx);
    expect(withDemand.sellable.daysOfCover).toBe(3.3);
    const [noDemand] = assembleSuggestions([sku({ onHandSellable: 10, onHandTotal: 10 })], ctx);
    expect(noDemand.sellable.daysOfCover).toBeNull();
  });

  it('예상 커버 일수 오름차순, null 은 뒤, 동률은 코드순', () => {
    const rows = assembleSuggestions(
      [
        sku({ skuId: 'a', skuCode: 'A', demand: { dailyMean: 10, dailyStd: 0 }, onHandSellable: 80, onHandTotal: 80 }),
        sku({ skuId: 'b', skuCode: 'B', demand: { dailyMean: 10, dailyStd: 0 }, onHandSellable: 10, onHandTotal: 10 }),
        sku({ skuId: 'c', skuCode: 'C', demand: { dailyMean: 10, dailyStd: 0 }, onHandSellable: 40, onHandTotal: 40 }),
        sku({ skuId: 'd', skuCode: 'D', onHandSellable: 0, onHandTotal: 0 }),
        sku({ skuId: 'e', skuCode: 'E', demand: { dailyMean: 10, dailyStd: 0 }, onHandSellable: 40, onHandTotal: 40 }),
      ],
      ctx,
    );
    expect(rows.map((r) => r.skuId)).toEqual(['b', 'c', 'e', 'a', 'd']);
  });
```

`'공급사 미정이면 supplier_unknown 플래그, supplierId null'` 의 `expect(row.flags).toEqual(expect.arrayContaining(['supplier_unknown', 'legacy_only']))` 는 `toEqual(['supplier_unknown'])` 로.

Run: `npx jest apps/core/src/modules/inventory/replenishment/suggestion/suggestion.assembler.spec.ts` → FAIL (타입 · 값).

- [ ] **Step 6: 조립기 교체**

```ts
// apps/core/src/modules/inventory/replenishment/suggestion/suggestion.assembler.ts
import { roundUpToLot } from '../policy/rounding';
import {
  AssembleContext,
  AxisLevels,
  CompanyAxis,
  SellableAxis,
  SkuStockInput,
  SuggestionAction,
  SuggestionFlag,
  SuggestionRow,
} from './suggestion.types';

/**
 * 두 축 판정 (스펙 §7.2). 순수 함수 — Nest · drizzle 을 모른다.
 * 수준(SS · ROP · S · L)은 정책 층이 축마다 계산해 `levels` 로 넘긴다 — 여기서는 판정만 한다.
 * 정렬은 예상 커버 일수(IP_판매 ÷ μ_D) 오름차순, null(μ_D = 0) 은 뒤, 동률은 SKU 코드순.
 */
export function assembleSuggestions(inputs: SkuStockInput[], ctx: AssembleContext): SuggestionRow[] {
  const rows = inputs.filter((input) => !input.excluded).map((input) => assembleOne(input, ctx));
  rows.sort(byUrgency);
  return rows;
}

function byUrgency(a: SuggestionRow, b: SuggestionRow): number {
  const da = a.sellable.daysOfCover;
  const db = b.sellable.daysOfCover;
  if (da === null && db === null) return a.skuCode.localeCompare(b.skuCode);
  if (da === null) return 1;
  if (db === null) return -1;
  return da - db || a.skuCode.localeCompare(b.skuCode);
}

function daysOfCover(position: number, dailyMean: number): number | null {
  if (!(dailyMean > 0)) return null;
  return Math.round((position / dailyMean) * 10) / 10;
}

function assembleOne(input: SkuStockInput, ctx: AssembleContext): SuggestionRow {
  const companyLevels: AxisLevels = input.levels.company;
  const sellableLevels: AxisLevels = input.levels.sellable;

  const company: CompanyAxis = {
    onHand: input.onHandTotal,
    inTransfer: input.inTransferTotal,
    onOrder: input.onOrderTotal,
    reserved: input.reservedTotal,
    position: input.onHandTotal + input.inTransferTotal + input.onOrderTotal - input.reservedTotal,
    ...companyLevels,
  };

  const onOrderDirect = input.onOrderTotal - input.onOrderNonSellable;
  const sellablePosition = input.onHandSellable - input.reservedSellable + input.inTransitToSellable + onOrderDirect;
  const sellable: SellableAxis = {
    warehouseId: ctx.sellableWarehouseId,
    onHand: input.onHandSellable,
    reserved: input.reservedSellable,
    inTransit: input.inTransitToSellable,
    onOrderDirect,
    position: sellablePosition,
    daysOfCover: daysOfCover(sellablePosition, input.demand.dailyMean),
    ...sellableLevels,
  };

  const actions: SuggestionAction[] = [];

  if (company.position <= company.reorderPoint) {
    const qty = roundUpToLot(company.targetLevel - company.position, input.lot);
    if (qty > 0) {
      actions.push({ type: 'purchase', qty, supplierId: input.supplier?.id ?? null, sourceWarehouseId: input.sourceWarehouseId });
    }
  }

  if (sellable.position <= sellable.reorderPoint) {
    const transfer = planTransfer(input, ctx, Math.ceil(sellable.targetLevel - sellable.position));
    if (transfer) actions.push(transfer);
  }

  const flags: SuggestionFlag[] = [...input.parameterFlags];
  if (!input.supplier) flags.push('supplier_unknown');

  return {
    skuId: input.skuId,
    skuCode: input.skuCode,
    skuName: input.skuName,
    supplier: input.supplier,
    pattern: input.pattern,
    grade: input.grade,
    confidence: input.confidence,
    demand: input.demand,
    company,
    sellable,
    actions,
    flags,
    legacyReorderPoint: input.legacyReorderPoint,
  };
}

/**
 * 출발 창고 = 가장 큰 로케이션이 속한 비판매 창고 하나(이동 지시서는 창고 쌍 문서). 이동가능 = 그 창고의
 * ON_HAND − 그 창고에서 나가는 draft planned. 큰 로케이션부터 채우고, 이동량은 올리지 않는다(있는 만큼만, §5.3).
 */
function planTransfer(input: SkuStockInput, ctx: AssembleContext, need: number): SuggestionAction | null {
  if (need <= 0 || input.nonSellableOnHand.length === 0) return null;
  const sources = [...input.nonSellableOnHand].sort((a, b) => b.qty - a.qty);
  const fromWarehouseId = sources[0].warehouseId;
  const inWarehouse = sources.filter((s) => s.warehouseId === fromWarehouseId);
  const onHand = inWarehouse.reduce((sum, row) => sum + row.qty, 0);
  const drafted = input.draftTransferPlanned.find((d) => d.fromWarehouseId === fromWarehouseId)?.qty ?? 0;
  const qty = Math.min(onHand - drafted, need);
  if (qty <= 0) return null;

  const lines: Array<{ fromLocationId: string; quantity: number }> = [];
  let remaining = qty;
  for (const source of inWarehouse) {
    if (remaining <= 0) break;
    const take = Math.min(source.qty, remaining);
    if (take <= 0) continue;
    lines.push({ fromLocationId: source.locationId, quantity: take });
    remaining -= take;
  }
  return { type: 'transfer', qty, fromWarehouseId, toWarehouseId: ctx.sellableWarehouseId, lines };
}
```

Run: `npx jest apps/core/src/modules/inventory/replenishment/suggestion/suggestion.assembler.spec.ts` → PASS (기존 통과 테스트 + 새 넷).

- [ ] **Step 7: `ReplenishmentStockReader` — `safetyStock` 제거 · 공급사 `defaultWarehouseId`**

`replenishment-stock.reader.ts`:
- `SkuMasterRow`: `safetyStock: number;` 줄 삭제, `supplier: { id: string; name: string; defaultWarehouseId: string | null } | null;`.
- `listSkuMasters` select 에서 `safetyStock: skus.safetyStock,` 삭제, 반환 매핑에서 `safetyStock: row.safetyStock,` 삭제.
- `resolveSuppliers` 의 반환 타입과 두 select 에 `defaultWarehouseId: suppliers.defaultWarehouseId` 를 더하고 `{ id, name, defaultWarehouseId }` 로 담는다.

`replenishment-stock.reader.integration.spec.ts`: `set({ safetyStock: 40, moq: 12 })` → `set({ moq: 12 })`, 기대 객체에서 `safetyStock: 40,` 삭제, `supplier: { id: supB.id, name: 'B' }` → `supplier: { id: supB.id, name: 'B', defaultWarehouseId: null }` (픽스처가 `defaultWarehouseId` 를 넣으면 그 값).

Run: `COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- replenishment-stock.reader.integration` → PASS.

- [ ] **Step 8: DTO 확장**

`replenishment-suggestion.dto.ts`:
- `SUGGESTION_FLAGS = ['default_lead_time', 'supplier_unknown', 'low_confidence'] as const;`
- `SuggestionDemandDto` 의 설명을 `'일평균 수요 (파라미터 창)'` · `'일 수요 표준편차'` 로, `daysOfCover` 설명을 `'예상 커버 일수 = 판매창고 재고위치 ÷ 일평균. 일평균 0 이면 null'` 로, `legacyReorderPoint` 설명을 `'레거시 방식 재주문점 (μ_D(90일)·μ_L 전사)'` 로.
- 파일 끝에 추가:

```ts
export class SkuDemandProfileDto {
  @ApiProperty({ enum: ['smooth', 'intermittent', 'erratic', 'lumpy', 'insufficient', 'none'] }) pattern: string;
  @ApiProperty({ enum: ['A', 'B', 'C'] }) grade: string;
  @ApiPropertyOptional({ nullable: true }) adi: number | null;
  @ApiPropertyOptional({ nullable: true }) cv2: number | null;
  @ApiProperty() dailyMean: number;
  @ApiProperty() dailyStd: number;
  @ApiProperty() dailyMean90: number;
  @ApiPropertyOptional({ nullable: true }) sizeMean: number | null;
  @ApiPropertyOptional({ nullable: true }) sizeStd: number | null;
  @ApiPropertyOptional({ nullable: true }) intervalMean: number | null;
  @ApiProperty() historyDays: number;
  @ApiProperty() demandEvents: number;
  @ApiProperty() classificationFrom: string;
  @ApiProperty() classificationTo: string;
  @ApiProperty() paramFrom: string;
  @ApiProperty() paramTo: string;
  @ApiProperty() computedAt: string;
}

export class SourcedNumberDto {
  @ApiProperty() value: number;
  @ApiProperty({ enum: ['override', 'grade', 'observation', 'supplier_rule', 'route_rule', 'global_default'] }) source: string;
}

export class ResolvedSegmentDto {
  @ApiProperty() meanDays: number;
  @ApiProperty() stdDays: number;
  @ApiProperty({ enum: ['observation', 'supplier_rule', 'route_rule', 'global_default'] }) source: string;
}

export class EffectiveParametersDto {
  @ApiProperty() excluded: boolean;
  @ApiProperty({ type: SourcedNumberDto }) alpha: SourcedNumberDto;
  @ApiProperty({ type: ResolvedSegmentDto }) l1: ResolvedSegmentDto;
  @ApiPropertyOptional({ type: ResolvedSegmentDto, nullable: true }) l2: ResolvedSegmentDto | null;
  @ApiProperty({ type: SourcedNumberDto }) coverDays: SourcedNumberDto;
  @ApiProperty({ type: SourcedNumberDto }) transferCoverDays: SourcedNumberDto;
  @ApiPropertyOptional({ nullable: true }) overrideSafetyStock: number | null;
  @ApiProperty() usesDefaultLeadTime: boolean;
}

export class ReplenishmentSkuDetailDto extends ReplenishmentSuggestionRowDto {
  @ApiPropertyOptional({ type: SkuDemandProfileDto, nullable: true, description: '야간 배치가 아직 안 돌았으면 null' }) profile: SkuDemandProfileDto | null;
  @ApiProperty({ type: EffectiveParametersDto }) parameters: EffectiveParametersDto;
}
```

- [ ] **Step 9: 통합 스펙 갱신 (실패부터)**

`replenishment-suggestion.integration.spec.ts`:

import 에 추가:

```ts
import { ReplenishmentSettingsReader, SETTINGS_KEY } from '../demand/replenishment-settings.reader';
import { DemandProfileReader } from '../demand/demand-profile.reader';
import { ReplenishmentRulesReader } from '../rules/replenishment-rules.reader';
```

`build()` 의 reader 생성을:

```ts
    const reader = new ReplenishmentSuggestionReader(
      new ReplenishmentStockReader(dbService),
      projection,
      transferReader,
      new ReplenishmentSettingsReader(dbService),
      new DemandProfileReader(dbService),
      new ReplenishmentRulesReader(dbService),
    );
```

`seedWorld` 를 규칙 시드 + SKU 예외(안전재고 오버라이드)로 — C 의 자리표시와 같은 수치(SS = ROP = S = 100, 수요 0)가 재현된다:

```ts
  async function seedRules(trx: DbTx) {
    await trx.delete(wmsTables.replenishmentSettings).where(eq(wmsTables.replenishmentSettings.key, SETTINGS_KEY));
    await trx.insert(wmsTables.replenishmentSettings).values({ key: SETTINGS_KEY });
    await trx.delete(wmsTables.replenishmentGradeRules);
    await trx.insert(wmsTables.replenishmentGradeRules).values([
      { grade: 'A', alpha: 0.02 },
      { grade: 'B', alpha: 0.05 },
      { grade: 'C', alpha: 0.1 },
    ]);
  }

  /** 롤백 트랜잭션 안에서 판매 창고를 부천 하나로 만든다. safetyStock 은 SKU 예외 오버라이드 — 수요 0 이면 SS = ROP = S. */
  async function seedWorld(trx: DbTx, safetyStock: number) {
    await seedRules(trx);
    await trx.update(wmsTables.warehouses).set({ isSellable: false });
    const china = await seedWarehouseWithZone(trx);
    await trx.update(wmsTables.warehouses).set({ isSellable: false }).where(eq(wmsTables.warehouses.id, china.warehouseId));
    const bucheon = await seedWarehouseWithZone(trx);
    const { holderId } = await seedHolder(trx);
    const { skuId } = await seedSku(trx, holderId);
    await trx.insert(wmsTables.replenishmentSkuOverrides).values({ skuId, mode: 'auto', safetyStock });
    return { china, bucheon, skuId, holderId };
  }
```

장면 1 · 2 의 플래그 기대를 바꾼다:

```ts
      expect(row?.flags).toEqual(expect.arrayContaining(['default_lead_time', 'low_confidence', 'supplier_unknown']));
```

(장면 2 의 `expect(row?.flags).toEqual(expect.arrayContaining(['legacy_only', 'supplier_unknown']))` 도 같은 줄로.) `limit` 장면의 `trx.update(wmsTables.skus).set({ safetyStock: 50 })…` 을 `await seedRules(trx);` (판매 창고 정리 앞) 와 `await trx.insert(wmsTables.replenishmentSkuOverrides).values([{ skuId: skuA.skuId, mode: 'auto', safetyStock: 50 }, { skuId: skuB.skuId, mode: 'auto', safetyStock: 50 }]);` 로.

장면 셋을 더한다:

```ts
  it('장면 4: 프로필 · 규칙으로 계산한 수준 — smooth · 공급사/경로 규칙 · 통합 버퍼 · 발주 출발 창고', async () => {
    await inRollbackTx(db, async (trx) => {
      const { china, bucheon, skuId } = await seedWorld(trx, 0);
      await trx.delete(wmsTables.replenishmentSkuOverrides).where(eq(wmsTables.replenishmentSkuOverrides.skuId, skuId));
      // 매일 10개 파는 smooth SKU, 등급 A
      await trx.insert(wmsTables.skuDemandProfiles).values({
        skuId, pattern: 'smooth', grade: 'A', adi: 1, cv2: 0, dailyMean: 10, dailyStd: 0, dailyMean90: 10,
        sizeMean: 10, sizeStd: 0, intervalMean: 1, historyDays: 365, demandEvents: 365,
        classificationFrom: '2025-09-08', classificationTo: '2026-09-07', paramFrom: '2026-06-10', paramTo: '2026-09-07', computedAt: new Date(),
      });
      // 공급사(출발 창고 = 중국) + L1 규칙 20일 σ0 커버 30, 경로 규칙 중국→부천 5일 σ0 커버 14
      const [supplier] = await trx.insert(wmsTables.suppliers).values({ name: 'it-sup', defaultWarehouseId: china.warehouseId }).returning({ id: wmsTables.suppliers.id });
      await trx.insert(wmsTables.skuSuppliers).values({ skuId, supplierId: supplier.id });
      await trx.insert(wmsTables.replenishmentSupplierRules).values({ supplierId: supplier.id, leadTimeDays: 20, leadTimeStdDays: 0, coverDays: 30 });
      await trx.insert(wmsTables.replenishmentRouteRules).values({ fromWarehouseId: china.warehouseId, toWarehouseId: bucheon.warehouseId, leadTimeDays: 5, leadTimeStdDays: 0, coverDays: 14 });
      await receiveStock(w.command, trx, { skuId, warehouseId: bucheon.warehouseId, locationId: bucheon.locationId, quantity: 40 });
      await receiveStock(w.command, trx, { skuId, warehouseId: china.warehouseId, locationId: china.locationId, quantity: 100 });

      const { service } = build(trx);
      const row = await service.getSku(skuId, trx);
      // 전사: μ_L = 20 + 5 + 버퍼 7 = 32, σ 0 → ROP = 320, S = 10·(32+30) = 620. IP 140 ≤ 320 → 발주 480, 출발 창고 = 중국
      expect(row.company).toMatchObject({ position: 140, safetyStock: 0, reorderPoint: 320, targetLevel: 620, leadTimeDays: 32 });
      // 판매: μ_L = 5 → ROP 50, S = 10·(5+14) = 190. IP 40 ≤ 50 → 필요 150, 이동가능 100 → 이동 100
      expect(row.sellable).toMatchObject({ position: 40, reorderPoint: 50, targetLevel: 190, leadTimeDays: 5, daysOfCover: 4 });
      expect(row.actions).toEqual([
        { type: 'purchase', qty: 480, supplierId: supplier.id, sourceWarehouseId: china.warehouseId },
        { type: 'transfer', qty: 100, fromWarehouseId: china.warehouseId, toWarehouseId: bucheon.warehouseId, lines: [{ fromLocationId: china.locationId, quantity: 100 }] },
      ]);
      expect(row.flags).toEqual([]);
      expect(row).toMatchObject({ pattern: 'smooth', grade: 'A', confidence: 'normal', legacyReorderPoint: 320, demand: { dailyMean: 10, dailyStd: 0 } });
      expect(row.profile).toMatchObject({ pattern: 'smooth', grade: 'A', dailyMean: 10, historyDays: 365 });
      expect(row.parameters).toMatchObject({
        excluded: false,
        alpha: { value: 0.02, source: 'grade' },
        l1: { meanDays: 20, stdDays: 0, source: 'supplier_rule' },
        l2: { meanDays: 5, stdDays: 0, source: 'route_rule' },
        coverDays: { value: 30, source: 'supplier_rule' },
        transferCoverDays: { value: 14, source: 'route_rule' },
        usesDefaultLeadTime: false,
      });
    });
  });

  it('장면 5: excluded SKU 는 목록에서 빠지지만 getSku 는 행을 준다', async () => {
    await inRollbackTx(db, async (trx) => {
      const { china, bucheon, skuId } = await seedWorld(trx, 100);
      await trx.update(wmsTables.replenishmentSkuOverrides).set({ mode: 'excluded', excludedUntil: null }).where(eq(wmsTables.replenishmentSkuOverrides.skuId, skuId));
      await receiveStock(w.command, trx, { skuId, warehouseId: china.warehouseId, locationId: china.locationId, quantity: 300 });
      const { service } = build(trx);
      const { items } = await service.listSuggestions({ action: 'all' }, trx);
      expect(items.find((r) => r.skuId === skuId)).toBeUndefined();
      const row = await service.getSku(skuId, trx);
      expect(row.parameters.excluded).toBe(true);
      expect(row.sellable.warehouseId).toBe(bucheon.warehouseId);
    });
  });

  it('장면 6: 프로필이 없으면 insufficient · low_confidence 로 흐른다', async () => {
    await inRollbackTx(db, async (trx) => {
      const { skuId } = await seedWorld(trx, 10);
      const { service } = build(trx);
      const row = await service.getSku(skuId, trx);
      expect(row.profile).toBeNull();
      expect(row).toMatchObject({ pattern: 'insufficient', grade: 'C', confidence: 'low' });
      expect(row.flags).toEqual(expect.arrayContaining(['low_confidence']));
    });
  });
```

Run: `COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- replenishment-suggestion.integration` → FAIL (생성자 인자 수).

- [ ] **Step 10: `ReplenishmentSuggestionReader` 오케스트레이션 교체**

```ts
// apps/core/src/modules/inventory/replenishment/suggestion/replenishment-suggestion.reader.ts
import { Injectable } from '@nestjs/common';
import { NotFoundError } from '@app/shared';
import { DbTx, ReplenishmentSettings, SkuDemandProfile } from '../../schema/inventory.schema';
import { StockProjectionService } from '../../stock-projection/services/stock-projection.service';
import { WarehouseTransferReader } from '../../warehouse-transfer/services/warehouse-transfer.reader';
import { ReplenishmentStockReader, SkuMasterRow } from './replenishment-stock.reader';
import { assembleSuggestions } from './suggestion.assembler';
import { SkuStockInput, SuggestionFlag, SuggestionRow } from './suggestion.types';
import { SuggestionActionFilter } from '../dto/replenishment-suggestion.dto';
import { ReplenishmentSettingsReader } from '../demand/replenishment-settings.reader';
import { DemandProfileReader } from '../demand/demand-profile.reader';
import { kstDateOf } from '../demand/calendar';
import { ReplenishmentRulesReader, routeKey } from '../rules/replenishment-rules.reader';
import { EffectiveParameters, resolveEffectiveParameters } from '../rules/effective-parameters';
import { composeLeadTime, computePolicy } from '../policy/replenishment-policy';

export interface AssembledSku {
  row: SuggestionRow;
  profile: SkuDemandProfile | null;
  parameters: EffectiveParameters;
}

interface Prepared {
  input: SkuStockInput;
  profile: SkuDemandProfile | null;
  parameters: EffectiveParameters;
}

/**
 * 재료 수집(재고 5회 + 프로필 3회 + 규칙 4회) → SKU 별 순수 계산(우선순위 → 정책 두 축) → 순수 조립 → action 필터.
 * 쓰기 없음. procurement · warehouse-transfer 의 실행 API 를 부르지 않는다(스펙 §8.2).
 */
@Injectable()
export class ReplenishmentSuggestionReader {
  constructor(
    private readonly stockReader: ReplenishmentStockReader,
    private readonly stockProjection: StockProjectionService,
    private readonly transferReader: WarehouseTransferReader,
    private readonly settingsReader: ReplenishmentSettingsReader,
    private readonly profileReader: DemandProfileReader,
    private readonly rulesReader: ReplenishmentRulesReader,
  ) {}

  /**
   * actions 가 하나 이상인 행만. action 필터는 actions 를 좁힌 뒤 빈 행을 버린다.
   * evaluated = 조립한 행 수(excluded 제외). total = 필터 적용 후 전체 행 수 — limit 은 그 뒤에 자른다.
   */
  async list(
    trx: DbTx,
    filter: { action: SuggestionActionFilter; limit?: number },
  ): Promise<{ items: SuggestionRow[]; evaluated: number; total: number }> {
    const rows = (await this.assemble(trx, undefined, false)).map((a) => a.row);
    const wanted = filter.action === 'all' ? null : filter.action;
    const actionable = rows
      .map((row) => (wanted ? { ...row, actions: row.actions.filter((a) => a.type === wanted) } : row))
      .filter((row) => row.actions.length > 0);
    const items = filter.limit != null ? actionable.slice(0, filter.limit) : actionable;
    return { items, evaluated: rows.length, total: actionable.length };
  }

  /** 어떤 SKU 든 한 행 — excluded 여도 준다(드로어가 이유를 보여준다). 없으면 NotFoundError. */
  async findDetail(trx: DbTx, skuId: string): Promise<AssembledSku> {
    const [detail] = await this.assemble(trx, [skuId], true);
    if (!detail) throw new NotFoundError(`SKU not found: ${skuId}`);
    return detail;
  }

  private async assemble(trx: DbTx, skuIds: string[] | undefined, includeExcluded: boolean): Promise<AssembledSku[]> {
    const sellableWarehouseId = await this.stockReader.findSingleSellableWarehouseId(trx);
    const masters = await this.stockReader.listSkuMasters(trx, skuIds);
    if (masters.length === 0) return [];
    const ids = masters.map((m) => m.skuId);
    const supplierIds = [...new Set(masters.flatMap((m) => (m.supplier ? [m.supplier.id] : [])))];

    const ledgers = await this.stockReader.readLedgerAggregates(trx, ids);
    const reservations = await this.stockReader.readConfirmedReservations(trx, ids);
    const pipeline = await this.stockProjection.getInboundPipeline({ skuIds: ids, toWarehouseId: sellableWarehouseId }, trx);
    const pipelineBySku = new Map(pipeline.items.map((item) => [item.skuId, item]));
    const drafts = await this.transferReader.findDraftPlannedBySku(trx, ids);

    const settings = await this.settingsReader.read(trx);
    const gradeAlpha = await this.rulesReader.readGradeAlphas(trx);
    const profiles = await this.profileReader.readProfiles(trx, ids);
    const supplierObservations = await this.profileReader.readSupplierLeadTimes(trx);
    const routeObservations = await this.profileReader.readRouteLeadTimes(trx);
    const supplierRules = await this.rulesReader.readSupplierRules(trx, supplierIds);
    const routeRules = await this.rulesReader.readRouteRules(trx);
    const overrides = await this.rulesReader.readSkuOverrides(trx, ids);
    const today = kstDateOf(new Date());

    const prepared = new Map<string, Prepared>();
    for (const master of masters) {
      const profile = profiles.get(master.skuId) ?? null;
      const supplierId = master.supplier?.id ?? null;
      const sourceWarehouseId = master.supplier?.defaultWarehouseId ?? null;
      const hasRoute = sourceWarehouseId !== null && sourceWarehouseId !== sellableWarehouseId;
      const key = hasRoute && sourceWarehouseId !== null ? routeKey(sourceWarehouseId, sellableWarehouseId) : null;

      const parameters = resolveEffectiveParameters({
        today,
        settings,
        gradeAlpha,
        grade: profile?.grade ?? 'C',
        override: overrides.get(master.skuId) ?? null,
        supplierRule: supplierId ? (supplierRules.get(supplierId) ?? null) : null,
        supplierObservation: supplierId ? (supplierObservations.get(supplierId) ?? null) : null,
        hasRoute,
        routeRule: key ? (routeRules.get(key) ?? null) : null,
        routeObservation: key ? (routeObservations.get(key) ?? null) : null,
      });

      const input = this.toInput(master, {
        ledger: ledgers.get(master.skuId),
        reserved: reservations.get(master.skuId),
        pipe: pipelineBySku.get(master.skuId),
        drafts: drafts.get(master.skuId) ?? [],
        profile,
        parameters,
        settings,
        sourceWarehouseId,
        excluded: includeExcluded ? false : parameters.excluded,
      });
      prepared.set(master.skuId, { input, profile, parameters });
    }

    const rows = assembleSuggestions([...prepared.values()].map((p) => p.input), { sellableWarehouseId });
    const result: AssembledSku[] = [];
    for (const row of rows) {
      const p = prepared.get(row.skuId);
      if (p) result.push({ row, profile: p.profile, parameters: p.parameters });
    }
    return result;
  }

  private toInput(
    master: SkuMasterRow,
    ctx: {
      ledger: { onHandTotal: number; inTransferTotal: number; onHandSellable: number; nonSellableOnHand: SkuStockInput['nonSellableOnHand'] } | undefined;
      reserved: { reservedTotal: number; reservedSellable: number } | undefined;
      pipe: { onOrderTotalQty: number; onOrderQty: number; inTransitQty: number } | undefined;
      drafts: Array<{ fromWarehouseId: string; qty: number }>;
      profile: SkuDemandProfile | null;
      parameters: EffectiveParameters;
      settings: ReplenishmentSettings;
      sourceWarehouseId: string | null;
      excluded: boolean;
    },
  ): SkuStockInput {
    const { profile, parameters, settings } = ctx;
    const pattern = profile?.pattern ?? 'insufficient';
    const base = {
      pattern,
      dailyMean: profile?.dailyMean ?? 0,
      dailyStd: profile?.dailyStd ?? 0,
      dailyMean90: profile?.dailyMean90 ?? 0,
      alpha: parameters.alpha.value,
      overrideSafetyStock: parameters.overrideSafetyStock,
    };
    const companyLead = composeLeadTime(
      parameters.l2 ? [parameters.l1, parameters.l2] : [parameters.l1],
      parameters.l2 ? settings.consolidationBufferDays : 0,
    );
    const sellableLead = parameters.l2 ?? { meanDays: 0, stdDays: 0 };
    const company = computePolicy({ ...base, leadTime: companyLead, coverDays: parameters.coverDays.value });
    const sellable = computePolicy({ ...base, leadTime: sellableLead, coverDays: parameters.transferCoverDays.value });

    const parameterFlags: SuggestionFlag[] = [];
    if (parameters.usesDefaultLeadTime) parameterFlags.push('default_lead_time');
    if (company.confidence === 'low') parameterFlags.push('low_confidence');

    return {
      skuId: master.skuId,
      skuCode: master.skuCode,
      skuName: master.skuName,
      supplier: master.supplier ? { id: master.supplier.id, name: master.supplier.name } : null,
      sourceWarehouseId: ctx.sourceWarehouseId,
      pattern,
      grade: profile?.grade ?? 'C',
      confidence: company.confidence,
      demand: { dailyMean: base.dailyMean, dailyStd: base.dailyStd },
      legacyReorderPoint: company.legacyReorderPoint,
      levels: {
        company: { safetyStock: company.safetyStock, reorderPoint: company.reorderPoint, targetLevel: company.targetLevel, leadTimeDays: company.leadTimeDays },
        sellable: { safetyStock: sellable.safetyStock, reorderPoint: sellable.reorderPoint, targetLevel: sellable.targetLevel, leadTimeDays: sellable.leadTimeDays },
      },
      parameterFlags,
      lot: { moq: master.moq, packingUnit: master.packingUnit },
      excluded: ctx.excluded,
      onHandTotal: ctx.ledger?.onHandTotal ?? 0,
      inTransferTotal: ctx.ledger?.inTransferTotal ?? 0,
      reservedTotal: ctx.reserved?.reservedTotal ?? 0,
      onHandSellable: ctx.ledger?.onHandSellable ?? 0,
      reservedSellable: ctx.reserved?.reservedSellable ?? 0,
      nonSellableOnHand: ctx.ledger?.nonSellableOnHand ?? [],
      onOrderTotal: ctx.pipe?.onOrderTotalQty ?? 0,
      onOrderNonSellable: ctx.pipe?.onOrderQty ?? 0,
      inTransitToSellable: ctx.pipe?.inTransitQty ?? 0,
      draftTransferPlanned: ctx.drafts,
    };
  }
}
```

(`InboundPipelineReader` 의 항목 타입에 `onOrderTotalQty` · `onOrderQty` · `inTransitQty` 가 있다 — C 가 그대로 쓰던 이름. 타입 이름이 export 돼 있으면 `ctx.pipe` 의 인라인 타입 대신 그것을 쓴다.)

- [ ] **Step 11: 서비스 · 컨트롤러**

`replenishment-suggestion.service.ts`:
- import 에 `ReplenishmentSkuDetailDto` 추가, `SkuDemandProfile` · `EffectiveParameters` 타입 import.
- `getSku` 를:

```ts
  getSku(skuId: string, tx?: DbTx): Promise<ReplenishmentSkuDetailDto> {
    return this.dbService.run(async (trx) => {
      const { row, profile, parameters } = await this.reader.findDetail(trx, skuId);
      return { ...toDto(row), profile: profile ? toProfileDto(profile) : null, parameters };
    }, tx);
  }
```

```ts
function toProfileDto(p: SkuDemandProfile): SkuDemandProfileDto {
  return {
    pattern: p.pattern,
    grade: p.grade,
    adi: p.adi,
    cv2: p.cv2,
    dailyMean: p.dailyMean,
    dailyStd: p.dailyStd,
    dailyMean90: p.dailyMean90,
    sizeMean: p.sizeMean,
    sizeStd: p.sizeStd,
    intervalMean: p.intervalMean,
    historyDays: p.historyDays,
    demandEvents: p.demandEvents,
    classificationFrom: p.classificationFrom,
    classificationTo: p.classificationTo,
    paramFrom: p.paramFrom,
    paramTo: p.paramTo,
    computedAt: p.computedAt.toISOString(),
  };
}
```

`toDto` 는 그대로 동작한다(`SuggestionRow` 의 필드명이 같다). `replenishment-suggestion.controller.ts` 의 `getSku` 반환 타입과 `@ApiResponse` type 을 `ReplenishmentSkuDetailDto` 로. 컨트롤러 스펙은 mock 이라 그대로 통과한다.

`replenishment.module.ts` providers 에 `DemandProfileReader` 추가 (`import { DemandProfileReader } from './demand/demand-profile.reader';`).

- [ ] **Step 12: 통과 확인**

```bash
COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- replenishment
npx jest apps/core/src/modules/inventory/replenishment apps/core/src/modules/inventory/replenishment-boundary.arch.spec.ts
npm run type-check
```

Expected: 통합(제안 end-to-end 3 + 새 3 + limit + 404 · stock.reader · rules · schema 둘 · A 의 것들) 전부 PASS · 단위 PASS · type-check 0. `grep -rn "legacy_only\|TODO(#743" apps/core/src` 가 `inbound-pipeline.reader.ts` 의 TODO 한 줄만 남긴다(스펙 §7.6 — 별도 이슈).

- [ ] **Step 13: 커밋**

```bash
git add apps/core/src/modules/inventory/replenishment apps/core/src/modules/inventory/warehouse-transfer/services/warehouse-transfer.reader.ts apps/core/src/modules/inventory/warehouse-transfer/services/warehouse-transfer.reader.integration.spec.ts
git commit -m "feat(core): 보충 제안을 프로필 · 규칙 · (s,S) 정책으로 교체 — legacy_only 제거, 커버 일수 정렬, draft 출발 창고 좁힘, 상세에 profile·parameters (#743 B)

Claude-Session: https://claude.ai/code/session_01Y5Bthz8rSpjhTgrZTzGBED"
```

---
### Task 7: `skus.safety_stock` 읽기 중단 (column drop 1단계) — core + admin-web

**Files:**
- Modify (core): `apps/core/src/modules/inventory/sku-catalog/dto/create-sku.dto.ts` · `sku-catalog/dto/sku-response.dto.ts` · `sku-catalog/dto/advanced-filters.dto.ts` · `sku-catalog/services/sku-catalog.reader.ts` · `sku-group/services/sku-group.reader.ts` · `sku-group/dto/sku-group-response.dto.ts`
- Modify (admin-web): `apps/admin-web/src/lib/types/dto/inventory.ts` · `features/inventory/skus/components/sku-form-dialog/index.tsx` · `hooks/table/columns/use-skus-table-columns.tsx`
- Test: `apps/core/src/modules/inventory/sku-catalog/safety-stock-column-unused.arch.spec.ts` (신설, grep 스펙)

**Interfaces:**
- Produces: core 소스(`schema/` 와 `drizzle/` 제외)에서 `safetyStock` · `safety_stock` 참조 0. `StockDisplayMode.BELOW_SAFETY` 삭제(어드민 호출처 0 — 실측). `sortBy: 'safetyStock'` 삭제. SKU 생성/수정 DTO 에서 `safetyStock` 제거(전역 파이프 `whitelist` 가 옛 클라이언트의 필드를 조용히 버린다). admin-web `CreateSkuDto` · `SkuResponseDto` · `SkuGroupMemberDto` 에서 `safetyStock` 제거, SKU 폼의 안전재고 입력 칸 제거 + 규칙 화면 링크(Task 11 에서 링크 문구), SKU 표의 안전재고 열 제거.

- [ ] **Step 1: 실패하는 아키텍처 스펙 — 컬럼 참조 0 을 고정**

```ts
// apps/core/src/modules/inventory/sku-catalog/safety-stock-column-unused.arch.spec.ts
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, sep } from 'path';

const INVENTORY_ROOT = join(__dirname, '..');

function collectTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === 'schema') continue; // 컬럼 정의 자체는 contract PR 까지 남는다
      out.push(...collectTsFiles(full));
      continue;
    }
    if (!entry.endsWith('.ts') || entry.endsWith('.spec.ts')) continue;
    out.push(full);
  }
  return out;
}

/**
 * #743 B: skus.safety_stock 은 코드가 더 이상 읽지 않는다(스펙 §6 「거취」, column drop 1단계).
 * 이 스펙이 초록인 채 배포 한 번이 지나면 contract PR 이 DROP COLUMN 을 낸다.
 * 보충 제안의 안전재고는 규칙(replenishment_sku_overrides.safety_stock)과 정책 계산이다 — 이름이 같아도 다른 컬럼.
 */
describe('skus.safety_stock 참조 0 (arch)', () => {
  it('inventory/ 소스(schema/ 제외)에 skus.safetyStock · safety_stock 참조가 없다', () => {
    const offenders = collectTsFiles(INVENTORY_ROOT).flatMap((file) => {
      const source = readFileSync(file, 'utf8');
      const hits: string[] = [];
      if (/skus\.safetyStock|skus\.safety_stock|wmsTables\.skus\.safetyStock/.test(source)) hits.push(`${file}: skus.safety_stock 참조`);
      if (file.includes(`${sep}sku-catalog${sep}`) || file.includes(`${sep}sku-group${sep}`)) {
        if (/\bsafetyStock\b/.test(source)) hits.push(`${file}: safetyStock 필드`);
      }
      return hits;
    });
    expect(offenders).toEqual([]);
  });
});
```

Run: `npx jest apps/core/src/modules/inventory/sku-catalog/safety-stock-column-unused.arch.spec.ts` → FAIL (sku-catalog · sku-group 이 걸린다).

- [ ] **Step 2: core 에서 제거**

- `create-sku.dto.ts`: `safetyStock?: number;` 와 그 `@ApiProperty` · `@IsNumber` · `@IsOptional` 데코레이터 블록 삭제.
- `sku-response.dto.ts`: `safetyStock: number;` 와 `@ApiProperty({ description: '안전 재고 …' })` 삭제.
- `advanced-filters.dto.ts`: `StockDisplayMode.BELOW_SAFETY = 'below_safety'` 줄 삭제. `sortBy` 의 enum 배열과 유니온에서 `'safetyStock'` 삭제.
- `sku-catalog.reader.ts`: `case StockDisplayMode.BELOW_SAFETY:` 두 줄(`conditions.push(...)` · `break`) 삭제.
- `sku-group.reader.ts`: 두 select 의 `safetyStock: skus.safetyStock,` 과 두 매핑의 `safetyStock: m.safetyStock,` / `safetyStock: s.safetyStock,` 삭제.
- `sku-group-response.dto.ts`: `SkuGroupMemberDto.safetyStock` 필드와 데코레이터 삭제.

`npm run type-check` 로 남은 참조를 찾는다 — `SkuResponseDto` 를 만드는 곳이 스프레드라면 컴파일이 이미 통과하고, 명시 매핑이면 그 줄을 지운다.

Run: `npx jest apps/core/src/modules/inventory/sku-catalog apps/core/src/modules/inventory/sku-group` → PASS (sku-catalog 의 기존 스펙에 `safetyStock` 픽스처가 있으면 지운다). `npm run type-check` 0.

- [ ] **Step 3: admin-web 에서 제거**

- `apps/admin-web/src/lib/types/dto/inventory.ts`: `CreateSkuDto.safetyStock?: number;` · `SkuResponseDto.safetyStock: number;` · `SkuGroupMemberDto.safetyStock: number;` 삭제. (보충 제안 축 타입의 `safetyStock` 은 다른 것 — 남긴다.)
- `features/inventory/skus/components/sku-form-dialog/index.tsx`: `FormState.safetyStock` · `DEFAULT_FORM.safetyStock` · `formFromSku` 의 `safetyStock: String(sku.safetyStock)` · `payload.safetyStock` · `<FormField label="안전 재고">…</FormField>` 블록 삭제. 그 자리에 안내(Task 11 에서 링크 컴포넌트로 다듬는다):

```tsx
            <p className="text-xs text-muted-foreground">
              안전재고는 더 이상 SKU 에 입력하지 않습니다. 수요 통계로 계산되며, 예외는 재고관리 &gt; 보충 규칙 &gt; SKU 예외에서 둡니다.
            </p>
```

- `hooks/table/columns/use-skus-table-columns.tsx`: `columnHelper.accessor('safetyStock', { … })` 블록 삭제.

```bash
cd apps/admin-web && npx tsc --noEmit
grep -rn "safetyStock" src --include=*.ts --include=*.tsx | grep -v replenishment
```

Expected: tsc 0, grep 은 0줄.

- [ ] **Step 4: 통과 확인 · 커밋**

Run: `npx jest apps/core/src/modules/inventory/sku-catalog/safety-stock-column-unused.arch.spec.ts` → PASS.

```bash
git add apps/core/src/modules/inventory/sku-catalog apps/core/src/modules/inventory/sku-group apps/admin-web/src/lib/types/dto/inventory.ts apps/admin-web/src/features/inventory/skus/components/sku-form-dialog/index.tsx apps/admin-web/src/hooks/table/columns/use-skus-table-columns.tsx
git commit -m "refactor: skus.safety_stock 읽기 중단 — DTO · 필터 · 정렬 · SKU 폼 · 표에서 제거, 컬럼은 contract PR 까지 잔존 (#743 B)

Claude-Session: https://claude.ai/code/session_01Y5Bthz8rSpjhTgrZTzGBED"
```

---

### Task 8: 경계 스펙 — 순수 파일 등록 · 규칙 층 격리

**Files:**
- Modify: `apps/core/src/modules/inventory/replenishment-boundary.arch.spec.ts`

- [ ] **Step 1: 순수 집합에 `effective-parameters.ts` 를 더하고, 개수 하한을 올린다**

세 번째 테스트의 필터에 한 줄, 개수 하한을 8 로:

```ts
        file.endsWith('demand-profile.calculator.ts') ||
        file.endsWith('effective-parameters.ts'),
    );
    expect(pure.length).toBeGreaterThanOrEqual(8);
```

(policy/ 4: rounding · classification · distributions · replenishment-policy, suggestion 2, demand 2, rules 1 = 9.)

- [ ] **Step 2: 통과 확인 · 커밋**

Run: `npx jest apps/core/src/modules/inventory/replenishment-boundary.arch.spec.ts` → PASS 3.

```bash
git add apps/core/src/modules/inventory/replenishment-boundary.arch.spec.ts
git commit -m "test(core): 보충 경계 스펙에 정책 · 규칙 순수 파일 등록 (#743 B)

Claude-Session: https://claude.ai/code/session_01Y5Bthz8rSpjhTgrZTzGBED"
```

---
### Task 9: admin-web — 타입 · 클라이언트 · 훅 · 상태코드 판독 수정

**Files:**
- Modify: `apps/admin-web/src/lib/types/dto/inventory.ts` (보충 절)
- Modify: `apps/admin-web/src/lib/api/domains/inventory/replenishment.client.ts`
- Modify: `apps/admin-web/src/lib/services/inventory/query-keys.ts` · `queries.ts` · `mutations.ts`
- Modify: `apps/admin-web/src/features/inventory/replenishment/suggestion-model.ts` + `.spec.ts`

**Interfaces:**
- Produces (타입): `SuggestionFlag` 에서 `legacy_only` 삭제, `SkuDemandProfileDto` · `SourcedNumberDto` · `ResolvedSegmentDto` · `EffectiveParametersDto` · `ReplenishmentSkuDetailDto`, 규칙 DTO(`ReplenishmentSettingsDto` · `UpdateReplenishmentSettingsDto` · `GradeRuleDto` · `GradeRulesDto` · `LeadTimeRuleDto` · `LeadTimeObservationDto` · `UpsertLeadTimeRuleDto` · `SupplierRuleRowDto` · `SupplierRulesListDto` · `RouteRuleRowDto` · `RouteRulesListDto` · `SkuOverrideRowDto` · `SkuOverridesListDto` · `UpsertSkuOverrideDto`) — core DTO 와 필드가 같다.
- Produces (클라이언트): `replenishmentClient.getSku(): Promise<ReplenishmentSkuDetailDto>`, `replenishmentClient.rules.{getSettings, updateSettings, getGrades, updateGrades, getSuppliers, putSupplier, deleteSupplier, getRoutes, putRoute, deleteRoute, getSkuOverrides(q?), putSkuOverride, deleteSkuOverride}`.
- Produces (훅): `useReplenishmentSku` 는 상세 DTO. `useReplenishmentSettings` · `useReplenishmentGrades` · `useReplenishmentSupplierRules` · `useReplenishmentRouteRules` · `useReplenishmentSkuOverrides(q)` 와 mutation `useUpdateReplenishmentSettings` · `useUpdateReplenishmentGrades` · `useUpsertSupplierRule` · `useDeleteSupplierRule` · `useUpsertRouteRule` · `useDeleteRouteRule` · `useUpsertSkuOverride` · `useDeleteSkuOverride`. 쿼리 키는 별도 루트 `['replenishment-rules', …]`(카트 담기의 `['replenishment']` 무효화에 안 휩쓸리게), 규칙 mutation 은 `['replenishment-rules']` **와** `['replenishment']` 둘 다 무효화한다(규칙은 제안에 즉시 반영).
- `httpStatusOf(error)` 는 `CustomError.statusCode` 를 먼저 본다(axios 인터셉터가 4xx 를 `CustomError` 로 던지므로 C 의 `error.response.status` 판독은 라이브에서 항상 null 이었다). `serverMessageOf` 는 `CustomError.message` 를 본다.

- [ ] **Step 1: 실패하는 모델 스펙 — 상태코드 판독**

`suggestion-model.spec.ts` 에 추가:

```ts
import { CustomError } from '@/lib/api/customError';

describe('httpStatusOf / serverMessageOf — 인터셉터가 던지는 CustomError', () => {
  it('CustomError 의 statusCode · message 를 읽는다', () => {
    const e = new CustomError({ message: '판매 창고가 정확히 하나가 아닙니다', statusCode: 409, response: {} });
    expect(httpStatusOf(e)).toBe(409);
    expect(serverMessageOf(e)).toBe('판매 창고가 정확히 하나가 아닙니다');
  });
  it('response.status 형태(원시 axios 오류)도 여전히 읽는다', () => {
    expect(httpStatusOf({ response: { status: 403, data: { message: 'no' } } })).toBe(403);
    expect(serverMessageOf({ response: { status: 403, data: { message: 'no' } } })).toBe('no');
  });
  it('둘 다 아니면 null', () => {
    expect(httpStatusOf(new Error('x'))).toBeNull();
    expect(serverMessageOf(null)).toBeNull();
  });
});
```

`FLAG_LABELS` 픽스처 · `row()` 의 `flags` 에 `legacy_only` 가 있으면 지운다. `CustomError` 생성자 시그니처는 `apps/admin-web/src/lib/api/customError.ts` 를 열어 맞춘다(`{ message, statusCode, response }` 객체).

Run: `npm run test:admin-web -- suggestion-model` → FAIL (CustomError 에서 null).

- [ ] **Step 2: 타입**

`apps/admin-web/src/lib/types/dto/inventory.ts` 보충 절:
- `SuggestionFlag` 에서 `| 'legacy_only'` 삭제.
- 절 끝에 추가:

```ts
export type DemandPattern = 'smooth' | 'intermittent' | 'erratic' | 'lumpy' | 'insufficient' | 'none';
export type DemandGrade = 'A' | 'B' | 'C';
export type ParameterSource = 'override' | 'grade' | 'observation' | 'supplier_rule' | 'route_rule' | 'global_default';

export interface SkuDemandProfileDto {
  pattern: DemandPattern;
  grade: DemandGrade;
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
  computedAt: string;
}
export interface SourcedNumberDto { value: number; source: ParameterSource }
export interface ResolvedSegmentDto { meanDays: number; stdDays: number; source: ParameterSource }
export interface EffectiveParametersDto {
  excluded: boolean;
  alpha: SourcedNumberDto;
  l1: ResolvedSegmentDto;
  l2: ResolvedSegmentDto | null;
  coverDays: SourcedNumberDto;
  transferCoverDays: SourcedNumberDto;
  overrideSafetyStock: number | null;
  usesDefaultLeadTime: boolean;
}
export interface ReplenishmentSkuDetailDto extends ReplenishmentSuggestionRowDto {
  profile: SkuDemandProfileDto | null;
  parameters: EffectiveParametersDto;
}

// ===== 보충 규칙 (#743 B) =====
export interface ReplenishmentSettingsDto {
  key: string;
  adiThreshold: number;
  cv2Threshold: number;
  classificationWindowDays: number;
  paramWindowDaysFrequent: number;
  paramWindowDaysSparse: number;
  minDemandEvents: number;
  minLeadTimeObservations: number;
  leadTimeWindowDays: number;
  gradeACut: number;
  gradeBCut: number;
  demandCoreSince: string | null;
  demandRecomputeDays: number;
  consolidationBufferDays: number;
  defaultLeadTimeDays: number;
  defaultLeadTimeStdDays: number | null;
  defaultTransferLeadTimeDays: number;
  defaultTransferLeadTimeStdDays: number | null;
  defaultLeadTimeCv: number;
  defaultCoverDays: number;
  defaultTransferCoverDays: number;
  updatedAt: string;
}
export type UpdateReplenishmentSettingsDto = Partial<Omit<ReplenishmentSettingsDto, 'key' | 'updatedAt'>>;
export interface GradeRuleDto { grade: DemandGrade; alpha: number }
export interface GradeRulesDto { items: GradeRuleDto[] }
export interface LeadTimeObservationDto { observations: number; meanDays: number; stdDays: number | null; windowFrom: string; windowTo: string }
export interface LeadTimeRuleDto { leadTimeDays: number; leadTimeStdDays: number | null; coverDays: number; updatedAt: string }
export interface UpsertLeadTimeRuleDto { leadTimeDays: number; leadTimeStdDays: number | null; coverDays: number }
export interface SupplierRuleRowDto {
  supplierId: string;
  supplierName: string;
  defaultWarehouseId: string | null;
  rule: LeadTimeRuleDto | null;
  observation: LeadTimeObservationDto | null;
}
export interface SupplierRulesListDto { items: SupplierRuleRowDto[] }
export interface RouteRuleRowDto {
  fromWarehouseId: string;
  fromWarehouseName: string;
  toWarehouseId: string;
  toWarehouseName: string;
  rule: LeadTimeRuleDto | null;
  observation: LeadTimeObservationDto | null;
}
export interface RouteRulesListDto { items: RouteRuleRowDto[] }
export type OverrideMode = 'auto' | 'excluded';
export interface SkuOverrideRowDto {
  skuId: string;
  skuCode: string;
  skuName: string;
  mode: OverrideMode;
  excludedUntil: string | null;
  safetyStock: number | null;
  alpha: number | null;
  memo: string | null;
  updatedAt: string;
}
export interface SkuOverridesListDto { items: SkuOverrideRowDto[] }
export interface UpsertSkuOverrideDto {
  mode: OverrideMode;
  excludedUntil?: string | null;
  safetyStock?: number | null;
  alpha?: number | null;
  memo?: string | null;
}
```

- [ ] **Step 3: 클라이언트**

```ts
// apps/admin-web/src/lib/api/domains/inventory/replenishment.client.ts
'use client';

import { ALMONDYOUNG_API_BASE_URL } from '@/const';
import { client } from '../../client';
import type {
  GradeRuleDto,
  GradeRulesDto,
  LeadTimeRuleDto,
  ReplenishmentSettingsDto,
  ReplenishmentSkuDetailDto,
  ReplenishmentSuggestionListDto,
  RouteRulesListDto,
  SkuOverrideRowDto,
  SkuOverridesListDto,
  SuggestionActionFilter,
  SupplierRulesListDto,
  UpdateReplenishmentSettingsDto,
  UpsertLeadTimeRuleDto,
  UpsertSkuOverrideDto,
} from '../../../types/dto/inventory';

const BASE = `${ALMONDYOUNG_API_BASE_URL}/replenishment`;
const RULES = `${BASE}/rules`;
const enc = encodeURIComponent;

export const replenishmentClient = {
  list: async (action: SuggestionActionFilter, limit?: number): Promise<ReplenishmentSuggestionListDto> => {
    const query = limit != null ? `&limit=${limit}` : '';
    const response = await client.get<ReplenishmentSuggestionListDto>(`${BASE}/suggestions?action=${action}${query}`);
    return response.data;
  },
  getSku: async (skuId: string): Promise<ReplenishmentSkuDetailDto> => {
    const response = await client.get<ReplenishmentSkuDetailDto>(`${BASE}/skus/${enc(skuId)}`);
    return response.data;
  },
  rules: {
    getSettings: async (): Promise<ReplenishmentSettingsDto> => (await client.get<ReplenishmentSettingsDto>(`${RULES}/settings`)).data,
    updateSettings: async (dto: UpdateReplenishmentSettingsDto): Promise<ReplenishmentSettingsDto> =>
      (await client.put<ReplenishmentSettingsDto>(`${RULES}/settings`, dto)).data,
    getGrades: async (): Promise<GradeRulesDto> => (await client.get<GradeRulesDto>(`${RULES}/grades`)).data,
    updateGrades: async (items: GradeRuleDto[]): Promise<GradeRulesDto> => (await client.put<GradeRulesDto>(`${RULES}/grades`, { items })).data,
    getSuppliers: async (): Promise<SupplierRulesListDto> => (await client.get<SupplierRulesListDto>(`${RULES}/suppliers`)).data,
    putSupplier: async (supplierId: string, dto: UpsertLeadTimeRuleDto): Promise<LeadTimeRuleDto> =>
      (await client.put<LeadTimeRuleDto>(`${RULES}/suppliers/${enc(supplierId)}`, dto)).data,
    deleteSupplier: async (supplierId: string): Promise<void> => {
      await client.delete(`${RULES}/suppliers/${enc(supplierId)}`);
    },
    getRoutes: async (): Promise<RouteRulesListDto> => (await client.get<RouteRulesListDto>(`${RULES}/routes`)).data,
    putRoute: async (from: string, to: string, dto: UpsertLeadTimeRuleDto): Promise<LeadTimeRuleDto> =>
      (await client.put<LeadTimeRuleDto>(`${RULES}/routes/${enc(from)}/${enc(to)}`, dto)).data,
    deleteRoute: async (from: string, to: string): Promise<void> => {
      await client.delete(`${RULES}/routes/${enc(from)}/${enc(to)}`);
    },
    getSkuOverrides: async (q?: string): Promise<SkuOverridesListDto> =>
      (await client.get<SkuOverridesListDto>(`${RULES}/skus${q ? `?q=${enc(q)}` : ''}`)).data,
    putSkuOverride: async (skuId: string, dto: UpsertSkuOverrideDto): Promise<SkuOverrideRowDto> =>
      (await client.put<SkuOverrideRowDto>(`${RULES}/skus/${enc(skuId)}`, dto)).data,
    deleteSkuOverride: async (skuId: string): Promise<void> => {
      await client.delete(`${RULES}/skus/${enc(skuId)}`);
    },
  },
};
```

- [ ] **Step 4: 쿼리 키 · 쿼리 · 뮤테이션**

`query-keys.ts` 의 보충 항목 뒤에:

```ts
  // 보충 규칙(#743 B) — 별도 루트. 카트 담기의 ['replenishment'] 무효화에 휩쓸리지 않게.
  replenishmentRulesRoot: ['replenishment-rules'] as const,
  replenishmentSettings: () => ['replenishment-rules', 'settings'] as const,
  replenishmentGrades: () => ['replenishment-rules', 'grades'] as const,
  replenishmentSupplierRules: () => ['replenishment-rules', 'suppliers'] as const,
  replenishmentRouteRules: () => ['replenishment-rules', 'routes'] as const,
  replenishmentSkuOverrides: (q: string) => ['replenishment-rules', 'skus', q] as const,
```

`queries.ts` (import 에 타입을 더한다):

```ts
export const useReplenishmentSettings = () =>
  useQuery({ queryKey: inventoryQueryKeys.replenishmentSettings(), queryFn: () => replenishmentClient.rules.getSettings() });
export const useReplenishmentGrades = () =>
  useQuery({ queryKey: inventoryQueryKeys.replenishmentGrades(), queryFn: () => replenishmentClient.rules.getGrades() });
export const useReplenishmentSupplierRules = () =>
  useQuery({ queryKey: inventoryQueryKeys.replenishmentSupplierRules(), queryFn: () => replenishmentClient.rules.getSuppliers() });
export const useReplenishmentRouteRules = () =>
  useQuery({ queryKey: inventoryQueryKeys.replenishmentRouteRules(), queryFn: () => replenishmentClient.rules.getRoutes() });
export const useReplenishmentSkuOverrides = (q: string) =>
  useQuery({ queryKey: inventoryQueryKeys.replenishmentSkuOverrides(q), queryFn: () => replenishmentClient.rules.getSkuOverrides(q || undefined), placeholderData: keepPreviousData });
```

`useReplenishmentSku` 의 반환 타입은 클라이언트가 바뀌어 자동으로 상세 DTO 가 된다.

`mutations.ts` — 규칙 mutation 8개. 공통 무효화 헬퍼를 파일 안에 둔다:

```ts
function invalidateReplenishmentRules(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: inventoryQueryKeys.replenishmentRulesRoot });
  // 규칙은 제안에 즉시 반영된다(스펙 §6 「반영 시점」) — 제안 캐시도 버린다.
  queryClient.invalidateQueries({ queryKey: ['replenishment'] });
}

export const useUpdateReplenishmentSettings = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (dto: UpdateReplenishmentSettingsDto) => replenishmentClient.rules.updateSettings(dto),
    onSuccess: () => invalidateReplenishmentRules(queryClient),
  });
};
export const useUpdateReplenishmentGrades = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (items: GradeRuleDto[]) => replenishmentClient.rules.updateGrades(items),
    onSuccess: () => invalidateReplenishmentRules(queryClient),
  });
};
export const useUpsertSupplierRule = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ supplierId, dto }: { supplierId: string; dto: UpsertLeadTimeRuleDto }) => replenishmentClient.rules.putSupplier(supplierId, dto),
    onSuccess: () => invalidateReplenishmentRules(queryClient),
  });
};
export const useDeleteSupplierRule = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (supplierId: string) => replenishmentClient.rules.deleteSupplier(supplierId),
    onSuccess: () => invalidateReplenishmentRules(queryClient),
  });
};
export const useUpsertRouteRule = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ from, to, dto }: { from: string; to: string; dto: UpsertLeadTimeRuleDto }) => replenishmentClient.rules.putRoute(from, to, dto),
    onSuccess: () => invalidateReplenishmentRules(queryClient),
  });
};
export const useDeleteRouteRule = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ from, to }: { from: string; to: string }) => replenishmentClient.rules.deleteRoute(from, to),
    onSuccess: () => invalidateReplenishmentRules(queryClient),
  });
};
export const useUpsertSkuOverride = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ skuId, dto }: { skuId: string; dto: UpsertSkuOverrideDto }) => replenishmentClient.rules.putSkuOverride(skuId, dto),
    onSuccess: () => invalidateReplenishmentRules(queryClient),
  });
};
export const useDeleteSkuOverride = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (skuId: string) => replenishmentClient.rules.deleteSkuOverride(skuId),
    onSuccess: () => invalidateReplenishmentRules(queryClient),
  });
};
```

- [ ] **Step 5: 표시 모델 — 상태코드 판독 · 라벨**

`suggestion-model.ts`:
- `FLAG_LABELS` 에서 `legacy_only` 줄 삭제.
- 추가:

```ts
import { isCustomError } from '@/lib/api/customError';

export const PATTERN_LABELS: Record<DemandPattern, string> = {
  smooth: '안정',
  intermittent: '간헐',
  erratic: '변동',
  lumpy: '불규칙',
  insufficient: '이력 부족',
  none: '수요 없음',
};

export const SOURCE_LABELS: Record<ParameterSource, string> = {
  override: 'SKU 예외',
  grade: '등급 규칙',
  observation: '관측',
  supplier_rule: '공급사 규칙',
  route_rule: '경로 규칙',
  global_default: '전역 기본',
};

/** 예상 커버 일수 표기. null(일평균 0) 은 '—'. */
export function daysOfCoverLabel(row: ReplenishmentSuggestionRowDto): string {
  const d = row.sellable.daysOfCover;
  if (d === null) return '—';
  if (d <= 0) return '소진';
  return `${d}일`;
}
```

- `httpStatusOf` / `serverMessageOf` 의 앞에 `CustomError` 분기를 넣는다:

```ts
export function httpStatusOf(error: unknown): number | null {
  if (isCustomError(error)) return error.statusCode;
  …기존 response.status 판독…
}
export function serverMessageOf(error: unknown): string | null {
  if (isCustomError(error)) return error.message || null;
  …기존 response.data.message 판독…
}
```

- `urgencyLabel` 은 남긴다(표의 「부족/여유」 열이 쓴다).

Run: `npm run test:admin-web -- suggestion-model` → PASS. `cd apps/admin-web && npx tsc --noEmit` → 0 (드로어의 `legacy_only` 참조가 걸리면 Task 11 에서 지우니 여기선 그 줄만 임시 삭제해도 된다 — 아래 Task 11 이 어차피 교체한다).

- [ ] **Step 6: 커밋**

```bash
git add apps/admin-web/src/lib apps/admin-web/src/features/inventory/replenishment/suggestion-model.ts apps/admin-web/src/features/inventory/replenishment/suggestion-model.spec.ts
git commit -m "feat(admin-web): 보충 규칙 API 클라이언트 · 훅 · 상세 타입, CustomError 상태코드 판독 수정 (#743 B)

Claude-Session: https://claude.ai/code/session_01Y5Bthz8rSpjhTgrZTzGBED"
```

---

### Task 10: admin-web — 규칙 화면 `/inventory/replenishment/rules` (탭 5개)

**Files:**
- Create: `apps/admin-web/src/features/inventory/replenishment/rules-model.ts` + `.spec.ts`
- Create: `apps/admin-web/src/features/inventory/replenishment/rules/template/index.tsx`
- Create: `apps/admin-web/src/features/inventory/replenishment/rules/components/settings-tab/index.tsx` · `grades-tab/index.tsx` · `suppliers-tab/index.tsx` · `routes-tab/index.tsx` · `sku-overrides-tab/index.tsx`
- Create: `apps/admin-web/src/app/(admin)/inventory/replenishment/rules/page.tsx`
- Modify: `apps/admin-web/src/lib/utils/menu.ts` + `menu.spec.ts` · `apps/admin-web/src/components/common/breadcrumb-items.ts` + `.spec.ts`

**Interfaces:**
- Produces (순수 모델):
  ```ts
  export type SettingsForm = Record<SettingsField, string>;   // 입력은 전부 문자열
  export const SETTINGS_FIELDS: Array<{ key: SettingsField; label: string; reflection: 'immediate' | 'recompute'; nullable?: boolean; integer?: boolean }>
  export function settingsFormFrom(dto: ReplenishmentSettingsDto): SettingsForm
  export function settingsPayloadFrom(form: SettingsForm, base: ReplenishmentSettingsDto): { payload: UpdateReplenishmentSettingsDto; errors: Partial<Record<SettingsField, string>> }  // 바뀐 필드만, 숫자 검증, A컷 < B컷
  export const REFLECTION_LABELS = { immediate: '저장 즉시 제안에 반영', recompute: '다음 야간 재계산(또는 지금 재계산)에 반영' }
  export function leadTimeRulePayloadFrom(form: { leadTimeDays: string; leadTimeStdDays: string; coverDays: string }): { payload: UpsertLeadTimeRuleDto | null; error: string | null }
  export function skuOverridePayloadFrom(form: { mode: OverrideMode; excludedUntil: string; safetyStock: string; alpha: string; memo: string }): { payload: UpsertSkuOverrideDto | null; error: string | null }
  export function gradeItemsFrom(form: Record<DemandGrade, string>): { items: GradeRuleDto[] | null; error: string | null }
  ```
- 화면: 탭은 URL `?tab=settings|grades|suppliers|routes|skus` (`movement/template` 의 패턴). 항목마다 반영 시점 문구. 저장 성공 시 `toast.success`, 실패 시 `serverMessageOf(e) ?? '저장에 실패했습니다.'`.

- [ ] **Step 1: 실패하는 모델 스펙**

```ts
// apps/admin-web/src/features/inventory/replenishment/rules-model.spec.ts
import type { ReplenishmentSettingsDto } from '@/lib/types/dto/inventory';
import {
  SETTINGS_FIELDS,
  gradeItemsFrom,
  leadTimeRulePayloadFrom,
  settingsFormFrom,
  settingsPayloadFrom,
  skuOverridePayloadFrom,
} from './rules-model';

const base: ReplenishmentSettingsDto = {
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
  demandCoreSince: null,
  demandRecomputeDays: 14,
  consolidationBufferDays: 7,
  defaultLeadTimeDays: 30,
  defaultLeadTimeStdDays: null,
  defaultTransferLeadTimeDays: 14,
  defaultTransferLeadTimeStdDays: null,
  defaultLeadTimeCv: 0.25,
  defaultCoverDays: 30,
  defaultTransferCoverDays: 14,
  updatedAt: '2026-09-08T00:00:00.000Z',
};

describe('settings form ↔ payload', () => {
  it('DTO → 폼은 전부 문자열, null 은 빈 문자열', () => {
    const form = settingsFormFrom(base);
    expect(form.adiThreshold).toBe('1.32');
    expect(form.defaultLeadTimeStdDays).toBe('');
    expect(form.demandCoreSince).toBe('');
  });
  it('바뀐 필드만 payload 에 담고 숫자로 바꾼다. 빈 nullable 은 null', () => {
    const form = { ...settingsFormFrom(base), demandRecomputeDays: '21', defaultLeadTimeStdDays: '4', demandCoreSince: '2026-07-01' };
    const { payload, errors } = settingsPayloadFrom(form, base);
    expect(errors).toEqual({});
    expect(payload).toEqual({ demandRecomputeDays: 21, defaultLeadTimeStdDays: 4, demandCoreSince: '2026-07-01' });
    const cleared = settingsPayloadFrom({ ...settingsFormFrom({ ...base, defaultLeadTimeStdDays: 4 }), defaultLeadTimeStdDays: '' }, { ...base, defaultLeadTimeStdDays: 4 });
    expect(cleared.payload).toEqual({ defaultLeadTimeStdDays: null });
  });
  it('정수 필드에 소수 · 숫자 아닌 값 · A컷 ≥ B컷 은 errors', () => {
    expect(settingsPayloadFrom({ ...settingsFormFrom(base), demandRecomputeDays: '2.5' }, base).errors.demandRecomputeDays).toMatch(/정수/);
    expect(settingsPayloadFrom({ ...settingsFormFrom(base), adiThreshold: 'abc' }, base).errors.adiThreshold).toMatch(/숫자/);
    expect(settingsPayloadFrom({ ...settingsFormFrom(base), gradeACut: '0.96' }, base).errors.gradeACut).toMatch(/B/);
    expect(settingsPayloadFrom({ ...settingsFormFrom(base), demandCoreSince: '2026/07/01' }, base).errors.demandCoreSince).toMatch(/YYYY-MM-DD/);
  });
  it('모든 필드가 반영 시점을 갖는다 — 창 · 임계 · 컷 · D0 · 재계산 일수는 recompute, 나머지는 immediate', () => {
    const byKey = new Map(SETTINGS_FIELDS.map((f) => [f.key, f.reflection]));
    for (const k of ['adiThreshold', 'cv2Threshold', 'classificationWindowDays', 'paramWindowDaysFrequent', 'paramWindowDaysSparse', 'minDemandEvents', 'leadTimeWindowDays', 'gradeACut', 'gradeBCut', 'demandCoreSince', 'demandRecomputeDays']) {
      expect(byKey.get(k as never)).toBe('recompute');
    }
    for (const k of ['minLeadTimeObservations', 'consolidationBufferDays', 'defaultLeadTimeDays', 'defaultLeadTimeStdDays', 'defaultTransferLeadTimeDays', 'defaultTransferLeadTimeStdDays', 'defaultLeadTimeCv', 'defaultCoverDays', 'defaultTransferCoverDays']) {
      expect(byKey.get(k as never)).toBe('immediate');
    }
    expect(SETTINGS_FIELDS).toHaveLength(20);
  });
});

describe('leadTimeRulePayloadFrom', () => {
  it('σ 빈값은 null, 커버는 정수', () => {
    expect(leadTimeRulePayloadFrom({ leadTimeDays: '25', leadTimeStdDays: '', coverDays: '40' })).toEqual({ payload: { leadTimeDays: 25, leadTimeStdDays: null, coverDays: 40 }, error: null });
    expect(leadTimeRulePayloadFrom({ leadTimeDays: '', leadTimeStdDays: '', coverDays: '40' }).error).toMatch(/리드타임/);
    expect(leadTimeRulePayloadFrom({ leadTimeDays: '25', leadTimeStdDays: '', coverDays: '4.5' }).error).toMatch(/정수/);
  });
});

describe('skuOverridePayloadFrom', () => {
  it('auto + 안전재고 · α, excluded + until', () => {
    expect(skuOverridePayloadFrom({ mode: 'auto', excludedUntil: '', safetyStock: '40', alpha: '0.01', memo: '' })).toEqual({
      payload: { mode: 'auto', excludedUntil: null, safetyStock: 40, alpha: 0.01, memo: null },
      error: null,
    });
    expect(skuOverridePayloadFrom({ mode: 'excluded', excludedUntil: '2026-12-31', safetyStock: '', alpha: '', memo: '시즌오프' })).toEqual({
      payload: { mode: 'excluded', excludedUntil: '2026-12-31', safetyStock: null, alpha: null, memo: '시즌오프' },
      error: null,
    });
    expect(skuOverridePayloadFrom({ mode: 'auto', excludedUntil: '', safetyStock: '-1', alpha: '', memo: '' }).error).toMatch(/안전재고/);
    expect(skuOverridePayloadFrom({ mode: 'auto', excludedUntil: '', safetyStock: '', alpha: '1', memo: '' }).error).toMatch(/α/);
  });
});

describe('gradeItemsFrom', () => {
  it('세 등급 전부 (0,1)', () => {
    expect(gradeItemsFrom({ A: '0.02', B: '0.05', C: '0.1' })).toEqual({ items: [{ grade: 'A', alpha: 0.02 }, { grade: 'B', alpha: 0.05 }, { grade: 'C', alpha: 0.1 }], error: null });
    expect(gradeItemsFrom({ A: '0', B: '0.05', C: '0.1' }).error).toMatch(/A/);
  });
});
```

Run: `npm run test:admin-web -- rules-model` → FAIL (모듈 없음).

- [ ] **Step 2: 순수 모델**

```ts
// apps/admin-web/src/features/inventory/replenishment/rules-model.ts
import type {
  DemandGrade,
  GradeRuleDto,
  OverrideMode,
  ReplenishmentSettingsDto,
  UpdateReplenishmentSettingsDto,
  UpsertLeadTimeRuleDto,
  UpsertSkuOverrideDto,
} from '@/lib/types/dto/inventory';

export type SettingsField = keyof Omit<ReplenishmentSettingsDto, 'key' | 'updatedAt'>;
export type SettingsForm = Record<SettingsField, string>;
export type Reflection = 'immediate' | 'recompute';

export const REFLECTION_LABELS: Record<Reflection, string> = {
  immediate: '저장 즉시 제안에 반영',
  recompute: '다음 야간 재계산(또는 지금 재계산)에 반영',
};

/** 순서 = 화면 순서. reflection 은 스펙 §6 「반영 시점」. */
export const SETTINGS_FIELDS: Array<{ key: SettingsField; label: string; reflection: Reflection; nullable?: boolean; integer?: boolean; date?: boolean }> = [
  { key: 'adiThreshold', label: 'ADI 임계 (기본 1.32)', reflection: 'recompute' },
  { key: 'cv2Threshold', label: 'CV² 임계 (기본 0.49)', reflection: 'recompute' },
  { key: 'classificationWindowDays', label: '분류 창 (일)', reflection: 'recompute', integer: true },
  { key: 'paramWindowDaysFrequent', label: '파라미터 창 — smooth·erratic (일)', reflection: 'recompute', integer: true },
  { key: 'paramWindowDaysSparse', label: '파라미터 창 — intermittent·lumpy (일)', reflection: 'recompute', integer: true },
  { key: 'minDemandEvents', label: '최소 수요 발생일', reflection: 'recompute', integer: true },
  { key: 'gradeACut', label: '등급 A 누적 매출 컷', reflection: 'recompute' },
  { key: 'gradeBCut', label: '등급 B 누적 매출 컷', reflection: 'recompute' },
  { key: 'demandCoreSince', label: 'D0 — core 수요 시작일', reflection: 'recompute', nullable: true, date: true },
  { key: 'demandRecomputeDays', label: '야간 재계산 창 (일)', reflection: 'recompute', integer: true },
  { key: 'leadTimeWindowDays', label: '리드타임 관측 창 (일)', reflection: 'recompute', integer: true },
  { key: 'minLeadTimeObservations', label: '관측을 믿는 최소 건수', reflection: 'immediate', integer: true },
  { key: 'consolidationBufferDays', label: '통합 버퍼 (일, 전사 축)', reflection: 'immediate', integer: true },
  { key: 'defaultLeadTimeDays', label: '기본 발주 리드타임 (일)', reflection: 'immediate' },
  { key: 'defaultLeadTimeStdDays', label: '기본 발주 리드타임 σ (일, 비우면 cv·μ)', reflection: 'immediate', nullable: true },
  { key: 'defaultTransferLeadTimeDays', label: '기본 이동 리드타임 (일)', reflection: 'immediate' },
  { key: 'defaultTransferLeadTimeStdDays', label: '기본 이동 리드타임 σ (일)', reflection: 'immediate', nullable: true },
  { key: 'defaultLeadTimeCv', label: 'σ 기본 비율 (cv)', reflection: 'immediate' },
  { key: 'defaultCoverDays', label: '기본 발주 커버 (일)', reflection: 'immediate', integer: true },
  { key: 'defaultTransferCoverDays', label: '기본 이동 커버 (일)', reflection: 'immediate', integer: true },
];

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function settingsFormFrom(dto: ReplenishmentSettingsDto): SettingsForm {
  const form = {} as SettingsForm;
  for (const f of SETTINGS_FIELDS) {
    const v = dto[f.key];
    form[f.key] = v === null || v === undefined ? '' : String(v);
  }
  return form;
}

function parseNumberField(raw: string, integer: boolean): { value: number | null; error: string | null } {
  const s = raw.trim();
  if (s === '') return { value: null, error: null };
  const n = Number(s);
  if (!Number.isFinite(n)) return { value: null, error: '숫자여야 합니다' };
  if (integer && !Number.isInteger(n)) return { value: null, error: '정수여야 합니다' };
  return { value: n, error: null };
}

export function settingsPayloadFrom(
  form: SettingsForm,
  base: ReplenishmentSettingsDto,
): { payload: UpdateReplenishmentSettingsDto; errors: Partial<Record<SettingsField, string>> } {
  const payload: Record<string, number | string | null> = {};
  const errors: Partial<Record<SettingsField, string>> = {};
  for (const f of SETTINGS_FIELDS) {
    const raw = form[f.key].trim();
    const current = base[f.key];
    if (f.date) {
      const next = raw === '' ? null : raw;
      if (next !== null && !ISO_DATE.test(next)) {
        errors[f.key] = 'YYYY-MM-DD 형식';
        continue;
      }
      if (next !== (current ?? null)) payload[f.key] = next;
      continue;
    }
    const { value, error } = parseNumberField(raw, f.integer === true);
    if (error) {
      errors[f.key] = error;
      continue;
    }
    if (value === null && !f.nullable) {
      errors[f.key] = '필수';
      continue;
    }
    if (value !== (current ?? null)) payload[f.key] = value;
  }
  const aCut = 'gradeACut' in payload ? Number(payload.gradeACut) : base.gradeACut;
  const bCut = 'gradeBCut' in payload ? Number(payload.gradeBCut) : base.gradeBCut;
  if (!errors.gradeACut && !errors.gradeBCut && aCut >= bCut) errors.gradeACut = 'A 컷은 B 컷보다 작아야 합니다';
  return { payload: payload as UpdateReplenishmentSettingsDto, errors };
}

export function leadTimeRulePayloadFrom(form: { leadTimeDays: string; leadTimeStdDays: string; coverDays: string }): { payload: UpsertLeadTimeRuleDto | null; error: string | null } {
  const lead = parseNumberField(form.leadTimeDays, false);
  if (lead.error || lead.value === null || lead.value < 0) return { payload: null, error: '리드타임(일)은 0 이상의 숫자여야 합니다' };
  const std = parseNumberField(form.leadTimeStdDays, false);
  if (std.error || (std.value !== null && std.value < 0)) return { payload: null, error: 'σ 는 0 이상의 숫자이거나 비워 둡니다' };
  const cover = parseNumberField(form.coverDays, true);
  if (cover.error || cover.value === null || cover.value < 0) return { payload: null, error: '커버 일수는 0 이상의 정수여야 합니다' };
  return { payload: { leadTimeDays: lead.value, leadTimeStdDays: std.value, coverDays: cover.value }, error: null };
}

export function skuOverridePayloadFrom(form: { mode: OverrideMode; excludedUntil: string; safetyStock: string; alpha: string; memo: string }): { payload: UpsertSkuOverrideDto | null; error: string | null } {
  const until = form.excludedUntil.trim();
  if (until !== '' && !ISO_DATE.test(until)) return { payload: null, error: '제외 종료일은 YYYY-MM-DD' };
  const ss = parseNumberField(form.safetyStock, true);
  if (ss.error || (ss.value !== null && ss.value < 0)) return { payload: null, error: '안전재고는 0 이상의 정수이거나 비워 둡니다' };
  const alpha = parseNumberField(form.alpha, false);
  if (alpha.error || (alpha.value !== null && (alpha.value <= 0 || alpha.value >= 1))) return { payload: null, error: 'α 는 0 과 1 사이이거나 비워 둡니다' };
  const memo = form.memo.trim();
  return {
    payload: { mode: form.mode, excludedUntil: until === '' ? null : until, safetyStock: ss.value, alpha: alpha.value, memo: memo === '' ? null : memo },
    error: null,
  };
}

export function gradeItemsFrom(form: Record<DemandGrade, string>): { items: GradeRuleDto[] | null; error: string | null } {
  const items: GradeRuleDto[] = [];
  for (const grade of ['A', 'B', 'C'] as DemandGrade[]) {
    const { value, error } = parseNumberField(form[grade], false);
    if (error || value === null || value <= 0 || value >= 1) return { items: null, error: `등급 ${grade} 의 α 는 0 과 1 사이여야 합니다` };
    items.push({ grade, alpha: value });
  }
  return { items, error: null };
}
```

Run: `npm run test:admin-web -- rules-model` → PASS 8 tests.

- [ ] **Step 3: 템플릿 · 탭 · 페이지**

```tsx
// apps/admin-web/src/features/inventory/replenishment/rules/template/index.tsx
'use client';

import { useCallback } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Container } from '@/components/admin-ui-experimental/common/container/container';
import { Header } from '@/components/admin-ui-experimental/common/header/header';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { SettingsTab } from '../components/settings-tab';
import { GradesTab } from '../components/grades-tab';
import { SuppliersTab } from '../components/suppliers-tab';
import { RoutesTab } from '../components/routes-tab';
import { SkuOverridesTab } from '../components/sku-overrides-tab';

const TABS = ['settings', 'grades', 'suppliers', 'routes', 'skus'] as const;
type RulesTab = (typeof TABS)[number];

export default function ReplenishmentRulesTemplate() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const raw = searchParams.get('tab');
  const tab: RulesTab = TABS.find((t) => t === raw) ?? 'settings';

  const handleTabChange = useCallback(
    (value: string) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set('tab', value);
      router.replace(`${pathname}?${params.toString()}`);
    },
    [searchParams, router, pathname]
  );

  return (
    <Container>
      <Header
        title="보충 규칙"
        subtitle="안전재고 계산의 입력. α · 리드타임 · 커버 · 예외는 저장 즉시, 창 · 임계 · 등급 컷 · D0 는 다음 재계산에 반영됩니다."
        right={
          <Button asChild variant="outline">
            <Link href="/inventory/replenishment">보충 제안으로</Link>
          </Button>
        }
      />
      <Tabs value={tab} onValueChange={handleTabChange} className="w-full">
        <div className="px-4 pt-2">
          <TabsList>
            <TabsTrigger value="settings">전역</TabsTrigger>
            <TabsTrigger value="grades">등급</TabsTrigger>
            <TabsTrigger value="suppliers">공급사</TabsTrigger>
            <TabsTrigger value="routes">경로</TabsTrigger>
            <TabsTrigger value="skus">SKU 예외</TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="settings"><SettingsTab /></TabsContent>
        <TabsContent value="grades"><GradesTab /></TabsContent>
        <TabsContent value="suppliers"><SuppliersTab /></TabsContent>
        <TabsContent value="routes"><RoutesTab /></TabsContent>
        <TabsContent value="skus"><SkuOverridesTab /></TabsContent>
      </Tabs>
    </Container>
  );
}
```

```tsx
// apps/admin-web/src/features/inventory/replenishment/rules/components/settings-tab/index.tsx
'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { useReplenishmentSettings, useUpdateReplenishmentSettings } from '@/lib/services/inventory';
import { REFLECTION_LABELS, SETTINGS_FIELDS, settingsFormFrom, settingsPayloadFrom, type SettingsForm } from '../../../rules-model';
import { serverMessageOf } from '../../../suggestion-model';

export function SettingsTab() {
  const { data, isLoading } = useReplenishmentSettings();
  const update = useUpdateReplenishmentSettings();
  const [form, setForm] = useState<SettingsForm | null>(null);
  const [errors, setErrors] = useState<Partial<Record<keyof SettingsForm, string>>>({});

  useEffect(() => {
    if (data) setForm(settingsFormFrom(data));
  }, [data]);

  if (isLoading || !data || !form) return <p className="p-4 text-sm text-muted-foreground">로딩 중...</p>;

  const handleSave = async () => {
    const { payload, errors: next } = settingsPayloadFrom(form, data);
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    if (Object.keys(payload).length === 0) {
      toast.info('바뀐 값이 없습니다.');
      return;
    }
    try {
      await update.mutateAsync(payload);
      toast.success('전역 설정을 저장했습니다.');
    } catch (e) {
      toast.error(serverMessageOf(e) ?? '저장에 실패했습니다.');
    }
  };

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {SETTINGS_FIELDS.map((f) => (
          <label key={f.key} className="flex flex-col gap-1 text-sm">
            <span className="flex items-center gap-2">
              {f.label}
              <Badge variant={f.reflection === 'immediate' ? 'secondary' : 'outline'}>{REFLECTION_LABELS[f.reflection]}</Badge>
            </span>
            <Input
              value={form[f.key]}
              placeholder={f.nullable ? '(비움)' : undefined}
              onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
            />
            {errors[f.key] && <span className="text-xs text-destructive">{errors[f.key]}</span>}
          </label>
        ))}
      </div>
      <div className="flex justify-end">
        <Button onClick={() => void handleSave()} disabled={update.isPending}>
          {update.isPending ? '저장 중...' : '저장'}
        </Button>
      </div>
    </div>
  );
}
```

```tsx
// apps/admin-web/src/features/inventory/replenishment/rules/components/grades-tab/index.tsx
'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { DemandGrade } from '@/lib/types/dto/inventory';
import { useReplenishmentGrades, useUpdateReplenishmentGrades } from '@/lib/services/inventory';
import { gradeItemsFrom } from '../../../rules-model';
import { serverMessageOf } from '../../../suggestion-model';

const GRADES: DemandGrade[] = ['A', 'B', 'C'];

export function GradesTab() {
  const { data, isLoading } = useReplenishmentGrades();
  const update = useUpdateReplenishmentGrades();
  const [form, setForm] = useState<Record<DemandGrade, string>>({ A: '', B: '', C: '' });

  useEffect(() => {
    if (!data) return;
    const next = { A: '', B: '', C: '' };
    for (const item of data.items) next[item.grade] = String(item.alpha);
    setForm(next);
  }, [data]);

  if (isLoading || !data) return <p className="p-4 text-sm text-muted-foreground">로딩 중...</p>;

  const handleSave = async () => {
    const { items, error } = gradeItemsFrom(form);
    if (!items) {
      toast.error(error ?? '입력을 확인하세요.');
      return;
    }
    try {
      await update.mutateAsync(items);
      toast.success('등급별 α 를 저장했습니다. 제안에 즉시 반영됩니다.');
    } catch (e) {
      toast.error(serverMessageOf(e) ?? '저장에 실패했습니다.');
    }
  };

  return (
    <div className="flex flex-col gap-4 p-4">
      <p className="text-sm text-muted-foreground">
        α = 목표 예측 실패율(리드타임 안에 수요가 재주문점을 넘을 확률). 작을수록 안전재고가 큽니다. 등급은 분류 창 매출 누적 80% / 95% 로 야간에 매겨집니다.
      </p>
      <div className="grid max-w-md grid-cols-3 gap-3">
        {GRADES.map((g) => (
          <label key={g} className="flex flex-col gap-1 text-sm">
            <span>등급 {g}</span>
            <Input value={form[g]} onChange={(e) => setForm({ ...form, [g]: e.target.value })} />
          </label>
        ))}
      </div>
      <div className="flex justify-end">
        <Button onClick={() => void handleSave()} disabled={update.isPending}>저장</Button>
      </div>
    </div>
  );
}
```

```tsx
// apps/admin-web/src/features/inventory/replenishment/rules/components/suppliers-tab/index.tsx
'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { SupplierRuleRowDto } from '@/lib/types/dto/inventory';
import { useDeleteSupplierRule, useReplenishmentSupplierRules, useUpsertSupplierRule } from '@/lib/services/inventory';
import { leadTimeRulePayloadFrom } from '../../../rules-model';
import { serverMessageOf } from '../../../suggestion-model';

type Draft = { leadTimeDays: string; leadTimeStdDays: string; coverDays: string };

function draftFrom(row: SupplierRuleRowDto): Draft {
  return {
    leadTimeDays: row.rule ? String(row.rule.leadTimeDays) : '',
    leadTimeStdDays: row.rule?.leadTimeStdDays != null ? String(row.rule.leadTimeStdDays) : '',
    coverDays: row.rule ? String(row.rule.coverDays) : '',
  };
}

export function SuppliersTab() {
  const { data, isLoading } = useReplenishmentSupplierRules();
  const upsert = useUpsertSupplierRule();
  const remove = useDeleteSupplierRule();
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});

  if (isLoading || !data) return <p className="p-4 text-sm text-muted-foreground">로딩 중...</p>;

  const draftOf = (row: SupplierRuleRowDto) => drafts[row.supplierId] ?? draftFrom(row);
  const setDraft = (id: string, patch: Partial<Draft>, row: SupplierRuleRowDto) =>
    setDrafts({ ...drafts, [id]: { ...draftOf(row), ...patch } });

  const handleSave = async (row: SupplierRuleRowDto) => {
    const { payload, error } = leadTimeRulePayloadFrom(draftOf(row));
    if (!payload) {
      toast.error(error ?? '입력을 확인하세요.');
      return;
    }
    try {
      await upsert.mutateAsync({ supplierId: row.supplierId, dto: payload });
      toast.success(`${row.supplierName} 규칙을 저장했습니다.`);
    } catch (e) {
      toast.error(serverMessageOf(e) ?? '저장에 실패했습니다.');
    }
  };
  const handleDelete = async (row: SupplierRuleRowDto) => {
    try {
      await remove.mutateAsync(row.supplierId);
      const next = { ...drafts };
      delete next[row.supplierId];
      setDrafts(next);
      toast.success(`${row.supplierName} 규칙을 지웠습니다. 전역 기본으로 돌아갑니다.`);
    } catch (e) {
      toast.error(serverMessageOf(e) ?? '삭제에 실패했습니다.');
    }
  };

  return (
    <div className="p-4">
      <p className="mb-3 text-sm text-muted-foreground">
        L1 = 공급사 → 출발 창고 입고 리드타임. 관측이 최소 건수 이상 쌓이면 관측이 규칙보다 우선합니다. 규칙이 없으면 전역 기본을 쓰고 제안에 「기본 리드타임」 플래그가 붙습니다.
      </p>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>공급사</TableHead>
            <TableHead>관측 (n · 평균 · σ)</TableHead>
            <TableHead>리드타임 (일)</TableHead>
            <TableHead>σ (일)</TableHead>
            <TableHead>커버 (일)</TableHead>
            <TableHead className="text-right">액션</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.items.map((row) => {
            const d = draftOf(row);
            return (
              <TableRow key={row.supplierId}>
                <TableCell>{row.supplierName}</TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {row.observation ? `${row.observation.observations}건 · ${row.observation.meanDays.toFixed(1)} · ${row.observation.stdDays?.toFixed(1) ?? '—'}` : '—'}
                </TableCell>
                <TableCell><Input className="w-24" value={d.leadTimeDays} onChange={(e) => setDraft(row.supplierId, { leadTimeDays: e.target.value }, row)} /></TableCell>
                <TableCell><Input className="w-24" value={d.leadTimeStdDays} placeholder="cv·μ" onChange={(e) => setDraft(row.supplierId, { leadTimeStdDays: e.target.value }, row)} /></TableCell>
                <TableCell><Input className="w-24" value={d.coverDays} onChange={(e) => setDraft(row.supplierId, { coverDays: e.target.value }, row)} /></TableCell>
                <TableCell className="space-x-1 text-right">
                  <Button size="sm" onClick={() => void handleSave(row)} disabled={upsert.isPending}>저장</Button>
                  {row.rule && (
                    <Button size="sm" variant="outline" onClick={() => void handleDelete(row)} disabled={remove.isPending}>지우기</Button>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
```

```tsx
// apps/admin-web/src/features/inventory/replenishment/rules/components/routes-tab/index.tsx
'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { RouteRuleRowDto } from '@/lib/types/dto/inventory';
import { useDeleteRouteRule, useReplenishmentRouteRules, useUpsertRouteRule, useWarehouses } from '@/lib/services/inventory';
import { leadTimeRulePayloadFrom } from '../../../rules-model';
import { serverMessageOf } from '../../../suggestion-model';

type Draft = { leadTimeDays: string; leadTimeStdDays: string; coverDays: string };
const key = (from: string, to: string) => `${from}:${to}`;

export function RoutesTab() {
  const { data, isLoading } = useReplenishmentRouteRules();
  const { data: warehouses } = useWarehouses();
  const upsert = useUpsertRouteRule();
  const remove = useDeleteRouteRule();
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [newFrom, setNewFrom] = useState('');
  const [newTo, setNewTo] = useState('');

  if (isLoading || !data) return <p className="p-4 text-sm text-muted-foreground">로딩 중...</p>;

  const draftOf = (row: RouteRuleRowDto): Draft =>
    drafts[key(row.fromWarehouseId, row.toWarehouseId)] ?? {
      leadTimeDays: row.rule ? String(row.rule.leadTimeDays) : '',
      leadTimeStdDays: row.rule?.leadTimeStdDays != null ? String(row.rule.leadTimeStdDays) : '',
      coverDays: row.rule ? String(row.rule.coverDays) : '',
    };

  const save = async (from: string, to: string, draft: Draft, label: string) => {
    const { payload, error } = leadTimeRulePayloadFrom(draft);
    if (!payload) {
      toast.error(error ?? '입력을 확인하세요.');
      return;
    }
    try {
      await upsert.mutateAsync({ from, to, dto: payload });
      toast.success(`${label} 경로 규칙을 저장했습니다.`);
    } catch (e) {
      toast.error(serverMessageOf(e) ?? '저장에 실패했습니다.');
    }
  };

  const handleDelete = async (row: RouteRuleRowDto) => {
    try {
      await remove.mutateAsync({ from: row.fromWarehouseId, to: row.toWarehouseId });
      toast.success('경로 규칙을 지웠습니다. 전역 이동 기본으로 돌아갑니다.');
    } catch (e) {
      toast.error(serverMessageOf(e) ?? '삭제에 실패했습니다.');
    }
  };

  const known = new Set(data.items.map((r) => key(r.fromWarehouseId, r.toWarehouseId)));
  const newDraft = drafts[key(newFrom, newTo)] ?? { leadTimeDays: '', leadTimeStdDays: '', coverDays: '' };

  return (
    <div className="p-4">
      <p className="mb-3 text-sm text-muted-foreground">
        L2 = 출발 창고 → 판매 창고 도착 리드타임. 지시서 선적·수령 관측이 쌓이면 관측이 우선합니다. 목록은 규칙이 있거나 관측이 있는 경로입니다.
      </p>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>경로</TableHead>
            <TableHead>관측 (n · 평균 · σ)</TableHead>
            <TableHead>리드타임 (일)</TableHead>
            <TableHead>σ (일)</TableHead>
            <TableHead>이동 커버 (일)</TableHead>
            <TableHead className="text-right">액션</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.items.map((row) => {
            const k = key(row.fromWarehouseId, row.toWarehouseId);
            const d = draftOf(row);
            const set = (patch: Partial<Draft>) => setDrafts({ ...drafts, [k]: { ...d, ...patch } });
            return (
              <TableRow key={k}>
                <TableCell>{row.fromWarehouseName} → {row.toWarehouseName}</TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {row.observation ? `${row.observation.observations}건 · ${row.observation.meanDays.toFixed(1)} · ${row.observation.stdDays?.toFixed(1) ?? '—'}` : '—'}
                </TableCell>
                <TableCell><Input className="w-24" value={d.leadTimeDays} onChange={(e) => set({ leadTimeDays: e.target.value })} /></TableCell>
                <TableCell><Input className="w-24" value={d.leadTimeStdDays} placeholder="cv·μ" onChange={(e) => set({ leadTimeStdDays: e.target.value })} /></TableCell>
                <TableCell><Input className="w-24" value={d.coverDays} onChange={(e) => set({ coverDays: e.target.value })} /></TableCell>
                <TableCell className="space-x-1 text-right">
                  <Button size="sm" onClick={() => void save(row.fromWarehouseId, row.toWarehouseId, d, `${row.fromWarehouseName} → ${row.toWarehouseName}`)} disabled={upsert.isPending}>저장</Button>
                  {row.rule && <Button size="sm" variant="outline" onClick={() => void handleDelete(row)} disabled={remove.isPending}>지우기</Button>}
                </TableCell>
              </TableRow>
            );
          })}
          <TableRow>
            <TableCell className="space-x-1">
              <Select value={newFrom} onValueChange={setNewFrom}>
                <SelectTrigger className="inline-flex w-40"><SelectValue placeholder="출발 창고" /></SelectTrigger>
                <SelectContent>{(warehouses ?? []).map((w) => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}</SelectContent>
              </Select>
              <span>→</span>
              <Select value={newTo} onValueChange={setNewTo}>
                <SelectTrigger className="inline-flex w-40"><SelectValue placeholder="도착 창고" /></SelectTrigger>
                <SelectContent>{(warehouses ?? []).map((w) => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}</SelectContent>
              </Select>
            </TableCell>
            <TableCell className="text-xs text-muted-foreground">새 경로</TableCell>
            <TableCell><Input className="w-24" value={newDraft.leadTimeDays} onChange={(e) => setDrafts({ ...drafts, [key(newFrom, newTo)]: { ...newDraft, leadTimeDays: e.target.value } })} /></TableCell>
            <TableCell><Input className="w-24" value={newDraft.leadTimeStdDays} onChange={(e) => setDrafts({ ...drafts, [key(newFrom, newTo)]: { ...newDraft, leadTimeStdDays: e.target.value } })} /></TableCell>
            <TableCell><Input className="w-24" value={newDraft.coverDays} onChange={(e) => setDrafts({ ...drafts, [key(newFrom, newTo)]: { ...newDraft, coverDays: e.target.value } })} /></TableCell>
            <TableCell className="text-right">
              <Button
                size="sm"
                disabled={!newFrom || !newTo || newFrom === newTo || known.has(key(newFrom, newTo)) || upsert.isPending}
                onClick={() => void save(newFrom, newTo, newDraft, '새')}
              >
                추가
              </Button>
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>
  );
}
```

```tsx
// apps/admin-web/src/features/inventory/replenishment/rules/components/sku-overrides-tab/index.tsx
'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useDebounced } from '@/hooks/use-debounced';
import type { OverrideMode, SkuOverrideRowDto } from '@/lib/types/dto/inventory';
import { useDeleteSkuOverride, useReplenishmentSkuOverrides, useSkuSearch, useUpsertSkuOverride } from '@/lib/services/inventory';
import { skuOverridePayloadFrom } from '../../../rules-model';
import { serverMessageOf } from '../../../suggestion-model';

type Draft = { mode: OverrideMode; excludedUntil: string; safetyStock: string; alpha: string; memo: string };
const EMPTY: Draft = { mode: 'auto', excludedUntil: '', safetyStock: '', alpha: '', memo: '' };

function draftFrom(row: SkuOverrideRowDto): Draft {
  return {
    mode: row.mode,
    excludedUntil: row.excludedUntil ?? '',
    safetyStock: row.safetyStock != null ? String(row.safetyStock) : '',
    alpha: row.alpha != null ? String(row.alpha) : '',
    memo: row.memo ?? '',
  };
}

export function SkuOverridesTab() {
  const [q, setQ] = useState('');
  const debouncedQ = useDebounced(q, 350);
  const { data, isLoading } = useReplenishmentSkuOverrides(debouncedQ);
  const upsert = useUpsertSkuOverride();
  const remove = useDeleteSkuOverride();
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});

  // 새 예외: SKU 검색 → 선택 → 입력
  const [pick, setPick] = useState('');
  const debouncedPick = useDebounced(pick, 350);
  const { data: candidates } = useSkuSearch(debouncedPick, 1, 20);
  const [picked, setPicked] = useState<{ id: string; label: string } | null>(null);
  const [newDraft, setNewDraft] = useState<Draft>(EMPTY);

  const save = async (skuId: string, draft: Draft, label: string) => {
    const { payload, error } = skuOverridePayloadFrom(draft);
    if (!payload) {
      toast.error(error ?? '입력을 확인하세요.');
      return;
    }
    try {
      await upsert.mutateAsync({ skuId, dto: payload });
      toast.success(`${label} 예외를 저장했습니다. 제안에 즉시 반영됩니다.`);
    } catch (e) {
      toast.error(serverMessageOf(e) ?? '저장에 실패했습니다.');
    }
  };

  const handleDelete = async (row: SkuOverrideRowDto) => {
    try {
      await remove.mutateAsync(row.skuId);
      toast.success(`${row.skuName} 예외를 지웠습니다.`);
    } catch (e) {
      toast.error(serverMessageOf(e) ?? '삭제에 실패했습니다.');
    }
  };

  const ModeSelect = ({ value, onChange }: { value: OverrideMode; onChange: (v: OverrideMode) => void }) => (
    <Select value={value} onValueChange={(v) => onChange(v === 'excluded' ? 'excluded' : 'auto')}>
      <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value="auto">계산</SelectItem>
        <SelectItem value="excluded">제외</SelectItem>
      </SelectContent>
    </Select>
  );

  return (
    <div className="flex flex-col gap-4 p-4">
      <p className="text-sm text-muted-foreground">
        「제외」는 제안 목록에서 빠집니다(종료일이 지나면 자동으로 계산으로 돌아옴). 안전재고를 넣으면 통계 계산 대신 그 값을 씁니다. α 는 등급 α 를 덮습니다.
      </p>

      <div className="rounded border p-3">
        <p className="mb-2 text-sm font-semibold">새 예외</p>
        <div className="flex flex-wrap items-center gap-2">
          <Input className="w-64" placeholder="SKU 코드 · 이름 검색" value={pick} onChange={(e) => { setPick(e.target.value); setPicked(null); }} />
          {!picked && (candidates?.items ?? []).slice(0, 8).map((s) => (
            <Button key={s.id} size="sm" variant="outline" onClick={() => setPicked({ id: s.id, label: `${s.name} (${s.code})` })}>{s.name} ({s.code})</Button>
          ))}
          {picked && <Badge>{picked.label}</Badge>}
        </div>
        {picked && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <ModeSelect value={newDraft.mode} onChange={(mode) => setNewDraft({ ...newDraft, mode })} />
            <Input className="w-36" placeholder="제외 종료일" value={newDraft.excludedUntil} onChange={(e) => setNewDraft({ ...newDraft, excludedUntil: e.target.value })} />
            <Input className="w-28" placeholder="안전재고" value={newDraft.safetyStock} onChange={(e) => setNewDraft({ ...newDraft, safetyStock: e.target.value })} />
            <Input className="w-24" placeholder="α" value={newDraft.alpha} onChange={(e) => setNewDraft({ ...newDraft, alpha: e.target.value })} />
            <Input className="w-48" placeholder="메모" value={newDraft.memo} onChange={(e) => setNewDraft({ ...newDraft, memo: e.target.value })} />
            <Button size="sm" disabled={upsert.isPending} onClick={() => void save(picked.id, newDraft, picked.label).then(() => { setPicked(null); setPick(''); setNewDraft(EMPTY); })}>추가</Button>
          </div>
        )}
      </div>

      <Input className="w-64" placeholder="예외 목록 검색 (코드 · 이름)" value={q} onChange={(e) => setQ(e.target.value)} />
      {isLoading || !data ? (
        <p className="text-sm text-muted-foreground">로딩 중...</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>SKU</TableHead>
              <TableHead>모드</TableHead>
              <TableHead>제외 종료일</TableHead>
              <TableHead>안전재고</TableHead>
              <TableHead>α</TableHead>
              <TableHead>메모</TableHead>
              <TableHead className="text-right">액션</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.items.map((row) => {
              const d = drafts[row.skuId] ?? draftFrom(row);
              const set = (patch: Partial<Draft>) => setDrafts({ ...drafts, [row.skuId]: { ...d, ...patch } });
              return (
                <TableRow key={row.skuId}>
                  <TableCell><div className="font-medium">{row.skuName}</div><div className="text-xs text-muted-foreground">{row.skuCode}</div></TableCell>
                  <TableCell><ModeSelect value={d.mode} onChange={(mode) => set({ mode })} /></TableCell>
                  <TableCell><Input className="w-36" value={d.excludedUntil} placeholder="YYYY-MM-DD" onChange={(e) => set({ excludedUntil: e.target.value })} /></TableCell>
                  <TableCell><Input className="w-24" value={d.safetyStock} onChange={(e) => set({ safetyStock: e.target.value })} /></TableCell>
                  <TableCell><Input className="w-20" value={d.alpha} onChange={(e) => set({ alpha: e.target.value })} /></TableCell>
                  <TableCell><Input className="w-48" value={d.memo} onChange={(e) => set({ memo: e.target.value })} /></TableCell>
                  <TableCell className="space-x-1 text-right">
                    <Button size="sm" onClick={() => void save(row.skuId, d, row.skuName)} disabled={upsert.isPending}>저장</Button>
                    <Button size="sm" variant="outline" onClick={() => void handleDelete(row)} disabled={remove.isPending}>지우기</Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
```

```tsx
// apps/admin-web/src/app/(admin)/inventory/replenishment/rules/page.tsx
import { Suspense } from 'react';
import RouteGuard from '@/components/layout/route-guard';
import ReplenishmentRulesTemplate from '@/features/inventory/replenishment/rules/template';

export default function InventoryReplenishmentRulesPage() {
  return (
    <RouteGuard requireRole={['admin', 'master']}>
      <div className="flex w-full max-w-[1600px] flex-col gap-y-2 p-3">
        <Suspense>
          <ReplenishmentRulesTemplate />
        </Suspense>
      </div>
    </RouteGuard>
  );
}
```

- [ ] **Step 4: 메뉴 · 브레드크럼 (스펙 먼저)**

`menu.spec.ts` 에 추가:

```ts
  it('보충 규칙은 보충 제안 바로 다음이다', () => {
    expect(getActiveMenuAndItem('/inventory/replenishment/rules')).toEqual({ menuId: 'inventory-product', itemId: 'inventory-replenishment-rules' });
    const ids = (getMenuById('inventory-product')?.children ?? []).map((item) => item.id);
    expect(ids.indexOf('inventory-replenishment-rules')).toBe(ids.indexOf('inventory-replenishment') + 1);
  });
```

`breadcrumb-items.spec.ts` 의 inventory 테스트에 추가:

```ts
    expect(getBreadcrumbItems('/inventory/replenishment').map((item) => item.label)).toEqual(['홈', '재고관리', '보충 제안']);
    expect(getBreadcrumbItems('/inventory/replenishment/rules').map((item) => item.label)).toEqual(['홈', '재고관리', '보충 규칙']);
```

Run: `npm run test:admin-web -- menu breadcrumb` → FAIL.

`menu.ts` 의 `inventory-replenishment` 항목 바로 뒤에:

```ts
      {
        id: 'inventory-replenishment-rules',
        title: '보충 규칙',
        path: '/inventory/replenishment/rules',
      },
```

(`getActiveMenuAndItem` 이 prefix 매칭이면 `/inventory/replenishment/rules` 가 `inventory-replenishment` 에 먼저 걸릴 수 있다 — 스펙이 빨간 채면 매칭을 가장 긴 path 우선으로 고친다. `menu.ts` 의 매칭 함수를 열어 확인.)

`breadcrumb-items.ts` inventory 분기에:

```ts
    } else if (pathname.includes('/replenishment/rules')) {
      items.push({ label: '보충 규칙' });
    } else if (pathname.includes('/replenishment')) {
      items.push({ label: '보충 제안' });
```

(`/replenishment/rules` 분기를 `/replenishment` 앞에.)

Run: `npm run test:admin-web -- menu breadcrumb rules-model` → PASS. `cd apps/admin-web && npx tsc --noEmit` → 0.

- [ ] **Step 5: 브라우저 스모크 (로컬 E2E 환경 또는 dev core)**

`npm run start:admin-web:dev` 로 `/inventory/replenishment/rules` 를 열어: 탭 5개 전환(URL `?tab=` 바뀜) · 전역 저장(바꾼 값 하나) · 등급 저장 · 공급사 규칙 저장/지우기 · 경로 추가 · SKU 예외 추가/검색/지우기 → 각 toast 확인. 실패한 항목은 여기서 고친다.

- [ ] **Step 6: 커밋**

```bash
git add apps/admin-web/src/features/inventory/replenishment/rules-model.ts apps/admin-web/src/features/inventory/replenishment/rules-model.spec.ts apps/admin-web/src/features/inventory/replenishment/rules "apps/admin-web/src/app/(admin)/inventory/replenishment/rules" apps/admin-web/src/lib/utils/menu.ts apps/admin-web/src/lib/utils/menu.spec.ts apps/admin-web/src/components/common/breadcrumb-items.ts apps/admin-web/src/components/common/breadcrumb-items.spec.ts
git commit -m "feat(admin-web): 보충 규칙 페이지 — 전역 · 등급 · 공급사 · 경로 · SKU 예외 탭, 반영 시점 표기 (#743 B)

Claude-Session: https://claude.ai/code/session_01Y5Bthz8rSpjhTgrZTzGBED"
```

---

### Task 11: admin-web — 프로필 드로어 · 표 갱신 · SKU 폼 링크

**Files:**
- Modify: `apps/admin-web/src/features/inventory/replenishment/components/sku-drawer/index.tsx`
- Modify: `apps/admin-web/src/features/inventory/replenishment/components/table/index.tsx`
- Modify: `apps/admin-web/src/features/inventory/replenishment/template/index.tsx`
- Modify: `apps/admin-web/src/features/inventory/skus/components/sku-form-dialog/index.tsx`

- [ ] **Step 1: 드로어 — `legacy_only` 분기 제거, 프로필 · 파라미터 블록 추가**

`sku-drawer/index.tsx` 를 이렇게 바꾼다(`Row` · `AxisBlock` 은 그대로):

```tsx
import { PATTERN_LABELS, SOURCE_LABELS, FLAG_LABELS, summarizeActions, daysOfCoverLabel } from '../../suggestion-model';
import type { EffectiveParametersDto, SkuDemandProfileDto } from '@/lib/types/dto/inventory';

function ProfileBlock({ profile }: { profile: SkuDemandProfileDto | null }) {
  if (!profile) {
    return <p className="text-xs text-muted-foreground">수요 프로필이 아직 없습니다 — 야간 재계산(03:40) 뒤 또는 보충 규칙 페이지의 「지금 재계산」 뒤에 채워집니다.</p>;
  }
  const n = (v: number | null, d = 2) => (v === null ? '—' : v.toFixed(d));
  return (
    <div>
      <p className="mb-1 text-sm font-semibold">수요 프로필</p>
      <Row label="패턴 / 등급" value={`${PATTERN_LABELS[profile.pattern]} / ${profile.grade}`} />
      <Row label="ADI · CV²" value={`${n(profile.adi)} · ${n(profile.cv2)}`} />
      <Row label="일평균 · 표준편차" value={`${n(profile.dailyMean)} · ${n(profile.dailyStd)} (${profile.paramFrom}~${profile.paramTo})`} />
      <Row label="발생일 수량 평균 · σ" value={`${n(profile.sizeMean)} · ${n(profile.sizeStd)}`} />
      <Row label="발생 간격 평균 (일)" value={n(profile.intervalMean, 1)} />
      <Row label="이력 · 발생일" value={`${profile.historyDays}일 · ${profile.demandEvents}회 (${profile.classificationFrom}~${profile.classificationTo})`} />
      <Row label="계산 시각" value={new Date(profile.computedAt).toLocaleString('ko-KR')} />
    </div>
  );
}

function ParametersBlock({ p }: { p: EffectiveParametersDto }) {
  const seg = (s: { meanDays: number; stdDays: number; source: EffectiveParametersDto['l1']['source'] } | null) =>
    s ? `${s.meanDays.toFixed(1)}일 ± ${s.stdDays.toFixed(1)} (${SOURCE_LABELS[s.source]})` : '없음 (출발 창고 = 판매 창고)';
  return (
    <div>
      <p className="mb-1 text-sm font-semibold">적용 파라미터</p>
      {p.excluded && <Badge variant="destructive">제안 제외 (SKU 예외)</Badge>}
      <Row label="α" value={`${p.alpha.value} (${SOURCE_LABELS[p.alpha.source]})`} />
      <Row label="L1 공급사→출발" value={seg(p.l1)} />
      <Row label="L2 출발→판매" value={seg(p.l2)} />
      <Row label="발주 커버" value={`${p.coverDays.value}일 (${SOURCE_LABELS[p.coverDays.source]})`} />
      <Row label="이동 커버" value={`${p.transferCoverDays.value}일 (${SOURCE_LABELS[p.transferCoverDays.source]})`} />
      {p.overrideSafetyStock !== null && <Row label="안전재고 오버라이드" value={p.overrideSafetyStock} />}
    </div>
  );
}
```

본문의 `<div className="space-x-1">` 블록에서 `legacy_only` 조건을 지우고 항상 패턴 · 등급 배지를 낸다(`{PATTERN_LABELS[data.pattern]}` · `등급 {data.grade}`), `<Row label="일평균 수요" …>` 뒤에 `<Row label="예상 커버" value={daysOfCoverLabel(data)} />`, 두 `AxisBlock` 뒤에 `<Separator /><ProfileBlock profile={data.profile} /><Separator /><ParametersBlock p={data.parameters} />`. 맨 아래 「이 단계의 안전재고는 …」 문단은 `<p className="text-xs text-muted-foreground">레거시 재주문점 = 90일 일평균 × 전사 리드타임 — 옛 방식과의 비교용입니다.</p>` 로. `useReplenishmentSku` 의 `data` 는 이제 `ReplenishmentSkuDetailDto` 다.

- [ ] **Step 2: 표 — 패턴/등급 · 예상 커버 열, 규칙 페이지 링크**

`components/table/index.tsx`:
- import 에 `PATTERN_LABELS, daysOfCoverLabel` 추가.
- 헤더 `<TableHead>SKU</TableHead>` 뒤에 `<TableHead>패턴 / 등급</TableHead>`, `<TableHead>긴급도</TableHead>` 를 `<TableHead>예상 커버</TableHead>` 로.
- 행: SKU 셀 뒤에 `<TableCell><Badge variant="secondary">{PATTERN_LABELS[row.pattern]}</Badge> <span className="text-xs">{row.grade}</span></TableCell>`, 긴급도 셀을 `<TableCell>{daysOfCoverLabel(row)}<span className="text-xs text-muted-foreground"> · {urgencyLabel(row)}</span></TableCell>` 로.

`template/index.tsx` 의 `Header` 에 `right={<Button asChild variant="outline"><Link href="/inventory/replenishment/rules">보충 규칙</Link></Button>}` (import `Link` from `next/link`, `Button`).

- [ ] **Step 3: SKU 폼 — 링크**

Task 7 의 안내 문단을 링크로:

```tsx
            <p className="text-xs text-muted-foreground">
              안전재고는 수요 통계로 계산됩니다. 예외(제외 · 고정 안전재고 · α)는{' '}
              <Link href="/inventory/replenishment/rules?tab=skus" className="underline">보충 규칙 › SKU 예외</Link>에서 둡니다.
            </p>
```

(`import Link from 'next/link'`.)

- [ ] **Step 4: 게이트 · 스모크 · 커밋**

```bash
cd apps/admin-web && npx tsc --noEmit && cd ../..
npm run test:admin-web
```

브라우저: `/inventory/replenishment` 목록에 패턴/등급 · 예상 커버 열이 보이고 정렬이 커버 일수순인지, 행 클릭 드로어에 프로필 · 파라미터 블록이 뜨는지, 헤더의 「보충 규칙」 링크, SKU 수정 다이얼로그의 링크 클릭 → 규칙 페이지 SKU 예외 탭. 프로필 없는 SKU 의 드로어 문구 확인.

```bash
git add apps/admin-web/src/features/inventory/replenishment apps/admin-web/src/features/inventory/skus/components/sku-form-dialog/index.tsx
git commit -m "feat(admin-web): 보충 제안 프로필 드로어 · 패턴/커버 열 · 규칙 링크, SKU 폼 안내 링크 (#743 B)

Claude-Session: https://claude.ai/code/session_01Y5Bthz8rSpjhTgrZTzGBED"
```

---

### Task 12: 전체 게이트 · 이슈 갱신 · PR

- [ ] **Step 1: 게이트 넷**

```bash
npm run type-check
npx jest --maxWorkers=2
cd apps/admin-web && npx tsc --noEmit && cd ../..
npm run test:admin-web
COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- "replenishment|warehouse-transfer.reader"
```

Expected: 전부 0 에러 · 0 실패.

- [ ] **Step 2: 잔재 확인**

```bash
grep -rn "legacy_only" apps/core/src apps/admin-web/src | wc -l          # 0
grep -rn "TODO(#743" apps/core/src                                       # inbound-pipeline.reader.ts 한 줄만
grep -rn "safetyStock\|safety_stock" apps/core/src --include=*.ts | grep -v "schema/\|replenishment/\|\.spec\.ts" | wc -l   # 0
```

- [ ] **Step 3: PR 본문**

```markdown
## 무엇
이슈 #743 의 B 단계(스펙 §9). **마이그레이션 1 (additive, 표 4개) · 참조 시드 3행.** A 단계 위에서만 동작한다.
- 순수 층: `policy/distributions`(Φ⁻¹ · 감마) · `policy/replenishment-policy`(§5 (s,S)) · `rules/effective-parameters`(§6 우선순위)
- 규칙 CRUD 13라우트 `/replenishment/rules/*` — 전역 · 등급 · 공급사 · 경로 · SKU 예외
- 제안 교체: 안전재고 = 프로필 × 규칙 × 정책. `legacy_only` 제거, 예상 커버 일수 정렬, 발주 출발 창고 = 공급사 기본 창고, `GET /replenishment/skus/:id` 에 `profile` · `parameters`
- C 의 TODO 2곳 닫음: draft 합을 비판매 출발 창고별로(`findDraftPlannedBySku`), 조립기가 고른 출발 창고의 것만 차감
- `skus.safety_stock` 읽기 중단(DTO · 필터 · 정렬 · 폼 · 표). 컬럼은 남는다 — 배포 한 번 뒤 contract PR 에서 DROP
- admin-web: `/inventory/replenishment/rules`(탭 5, 반영 시점 표기) · 프로필 드로어 · 표 열 · SKU 폼 링크. axios `CustomError` 상태코드 판독 수정(C 의 403/409 분기가 라이브에서 안 먹던 것)

## 배포 (expand)
A 배포 확인 → `db:migrate → db:seed:ref → sst deploy`. 그 뒤 사람 작업(스펙 §9.2): 공급사 · 경로 규칙 입력 → 네 패턴 5개씩 상식 점검 → 🔴 확정 예약 허수 청소 전이면 발주 총량 과대.

## 안 한 것
- `inbound_plans.linked_purchase_order_id` 부분 unique — 별도 이슈(스펙 §7.6)
- `updated_by` 채우기 — actor 배관 없음(스펙 §8.1)
- `skus.safety_stock` DROP — contract PR

## 검증
- `npm run type-check` 0 · `npx jest --maxWorkers=2` 0 실패 · admin-web tsc 0 · `npm run test:admin-web` 0 실패
- 통합: rules · suggestion(장면 6 + limit + 404) · stock.reader · warehouse-transfer.reader · 규칙 schema
- 브라우저 스모크: 규칙 탭 5개 저장/삭제 · 제안 표 · 드로어 · SKU 폼 링크 (Task 10 · 11)

설계: `docs/superpowers/specs/2026-09-08-replenishment-suggestion-design.md`

https://claude.ai/code/session_01Y5Bthz8rSpjhTgrZTzGBED
```

- [ ] **Step 4: 푸시 · PR · 이슈 코멘트**

```bash
git push -u origin feat/743-replenishment-stage-b
gh pr create --base develop --title "feat(replenishment): 정책 층 — 규칙 CRUD · (s,S) 정책으로 제안 교체 · 규칙 화면 · 프로필 드로어 (#743 B 단계)" --body-file <(cat <<'EOF'
(위 PR 본문)
EOF
)
gh issue comment 743 --body "B 단계(정책 층) 구현 브랜치 \`feat/743-replenishment-stage-b\` → PR 생성. 표 4개 · 마이그 1 · 시드 3행 · 규칙 CRUD 13라우트 · 제안 교체(legacy_only 제거) · 규칙 화면 · 프로필 드로어 · skus.safety_stock 읽기 중단. 배포 순서 A → \`db:migrate → db:seed:ref → sst deploy\`, 그 뒤 스펙 §9.2. contract PR(DROP COLUMN)은 배포 한 번 뒤."
```

---

## Self-review (작성자가 한 번 훑은 결과)

- **스펙 커버리지**: §5.1 공통 골격 · 분포 표 · 감마 모멘트 일치 · σ_LTD=0 → Task 2 · 3. §5.2 리드타임 합성 · σ 기본 0.25μ → Task 3 (`composeLeadTime`) · Task 4 (`segment`). §5.3 발주량 · 이동량 → C 의 `roundUpToLot` 그대로 + Task 6 조립기. §5.4 입출력 계약 → Task 3 `PolicyInput/Output` (dailyMean90 를 추가한 것이 스펙과 다른 점 — §4.3 `daily_mean_90` 로 스펙에 반영됨). §6 표 4개 · 우선순위 · excluded_until · 반영 시점 · 초기값 · `skus.safety_stock` 거취 → Task 1 · 4 · 5 · 7 · 10. §7.1 draft 창고 쌍 · §7.6 TODO 둘 → Task 6. §7.3 `sourceWarehouseId` · 봉투 · 상세 확장 → Task 6. §7.4 B 라우트 13 → Task 5. §8.2 B 파일 → Task 2~6. §8.4 드로어 · 규칙 화면 · SKU 폼 → Task 10 · 11. §9 B 행 · §9.2 → Task 12. §10 단위(`distributions` · `replenishment-policy` · `effective-parameters` · `suggestion.assembler` · admin-web 순수) · 통합(end-to-end 갱신) · 아키텍처 → Task 2 · 3 · 4 · 6 · 8 · 9 · 10.
- **타입 일관성**: `LeadTimeSegment{meanDays,stdDays}` (Task 3) = `ResolvedSegment` 의 앞 두 필드 (Task 4) → Task 6 이 그대로 넘긴다. `LeadTimeObservation` · `LeadTimeRule` · `SkuOverrideInput` 은 drizzle `InferSelectModel` 타입과 구조적으로 호환(추가 필드 허용). `routeKey` 는 Task 5 에서 정의, Task 6 의 `DemandProfileReader` · 조립 오케스트레이션이 같은 이름을 쓴다. `AxisLevels` (Task 6 types) = `PolicyOutput` 의 네 필드. admin-web DTO 필드명은 core DTO 와 1:1.
- **자리표시 없음**: 모든 코드 스텝에 실제 코드. 스펙 파일의 `sku()` 픽스처 교체와 `seedWorld` 교체는 전체 코드를 실었다. Task 7 의 "남은 참조를 type-check 로 찾는다" 는 실행 절차이지 미정 사항이 아니다.
- **스펙과 달리 결정한 것**: (1) 공급사 · 경로 규칙에 DELETE 를 더해 13라우트(스펙 §7.4 에 반영). (2) `findDetail` 은 excluded SKU 도 행을 준다 — 드로어가 제외 이유를 보여줘야 해서. (3) 오버라이드 안전재고는 `none` 패턴에도 적용(사람이 준 숫자가 통계보다 우선). 셋 다 스펙 본문(§7.4 · §6)에 반영했다.
