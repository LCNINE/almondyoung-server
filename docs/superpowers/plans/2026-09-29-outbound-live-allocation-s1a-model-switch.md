# 살아 있는 배정 S1-A — 계획을 작업 항목에 흡수 (모델 전환) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `picking_plans`·`picking_plan_members` 를 코드에서 걷어내고, 배정을 작업 항목(`outbound_batch_work_items`)에 매단다. 현장 동작(단순출고·위치별 출고·결품·발송)은 **바꾸지 않는다**.

**Architecture:** 「계획 초안 → 시작」 두 단계를 「배치 시작」 한 번으로 합친다. 배치 시작은 대기 작업 항목 전부를 한 트랜잭션에서 배정(`picking_source_allocations.work_item_id`)하고 재고 세션에 인계한다(`HAND_IN`). 세션·전략·발송·결품·복구가 «세션의 계획 id» 대신 «세션의 배치 id + 작업 항목 id»로 신원을 확인한다. S1-B(합류·이탈·내용 변경)는 이 모양 위에서 따로 계획한다.

**Tech Stack:** NestJS 11, Drizzle ORM(postgres.js), Jest(ts-jest, `isolatedModules`), admin-web Next.js.

**Spec:** `docs/superpowers/specs/2026-09-29-outbound-live-allocation-design.md` — 이 계획은 §4.1·§4.2 의 «계획 흡수» 부분과 §11 PR 1/PR 2 의 계획 테이블 부분만 구현한다. 합류·이탈·내용 변경·되돌림 바구니·송장 자동 재발급·결품 재배정은 S1-B/S1-C 계획의 일이다.

## Global Constraints

- 레이어: Controller → Service → Reader/Manager → Repository. 서비스는 `HttpException` 대신 `@app/shared` 도메인 예외. 단, 이 모듈의 기존 코드는 `ConflictException({ code, message })`·`conflict()` 헬퍼를 쓰므로 **주변 코드의 관례를 따른다**
- 트랜잭션: `this.dbService.run(async (trx) => …, tx)`. 공개 메서드는 마지막 인자 `tx?: DbTx`. 로컬 `type Tx = …` 재선언·클래스별 `inTx` 헬퍼 금지(ADR-0025)
- inventory 쿼리 규칙: `db.query.*`·`with` 관계 조회 금지, `any`/`as` 캐스팅 금지(근거 주석 없는 한), `trx.select().from().innerJoin().where().orderBy()` 형태
- DTO 에 `@ApiProperty({ type: 'object' })` 새로 쓰지 말 것 — 중첩 DTO 는 별도 클래스
- 스키마 변경은 `schema.ts` 수정 → `npm run db:generate:core -- --name <kebab>` → 생성 SQL 검토 → `schema.ts`·SQL·`drizzle/meta/` **한 커밋**. 생성된 마이그 손편집 금지
- 🔴 **`db:generate:core` 는 서브에이전트가 돌리지 않는다**(대화형 프롬프트·환경 의존으로 실패한 전례). 해당 스텝은 메인 세션이나 사람이 실행한다
- 통합 스펙은 `describeIfDb`/`REQUIRE_*_DB` 가드 컨벤션. 스펙 안에서 `dotenv.config()` 금지
- 검증 게이트: `npm run type-check` 에러 0, `npx jest` 실패 0(OOM 이면 `--maxWorkers=2`)
- 통합 실행: `npm run test:core:integration:local -- '<경로 정규식>'`(로컬 5432, `--runInBand` 고정). 워크트리에서는 `COMPOSE_PROJECT_NAME=almondyoung-server` 를 붙인다. 로컬 core DB 에 다른 브랜치 마이그 잔재가 있으면 `drizzle-kit migrate` 가 조용히 exit 1 — 임시 DB 로 우회
- admin-web 은 루트 type-check 에서 빠진다: `cd apps/admin-web && npx tsc --noEmit` 을 따로 돌린다. CI 도 admin-web tsc 를 돌리지 않는다
- 현장 앱(warehouse-app) 계약은 **바꾸지 않는다**: 준비 차단 응답 `code: 'SIMPLE_OUTBOUND_PLAN_INVALIDATED'`·`reasonCode` 값 집합·`invalidatedPlanId` 필드는 그대로 두고, `invalidatedPlanId` 는 항상 `null` 을 싣는다
- 커밋 메시지 끝에 `Claude-Session: https://claude.ai/code/session_0129KYz3jPdmFE2JPa8wXDTS`

### 실행 중 빨간 창

Task 3 에서 `PickingProcessService.start` 가 새 배치 시작으로 바뀌는 순간부터 Task 9 가 끝날 때까지 **fulfillment DB 통합 스펙은 빨갛다**(아직 계획을 가정하는 소비자가 남아 있다). 각 Task 는 `npm run type-check` 와 기본 `npx jest`(DB 없는 스펙)를 초록으로 유지하고, 자기가 고친 서비스의 통합 스펙은 Task 9 에서 한꺼번에 초록으로 만든다. 서브에이전트 리뷰어는 이 창을 결함으로 보고하지 않는다.

## Review Focus

1. **같은 배치의 첫 스캔 두 개가 동시에 들어온다** — 세션은 하나만 생기고, 늦은 쪽은 먼저 생긴 세션으로 claim 한다(`HAND_IN` 중복 0). → Task 9 동시성 스펙
2. **대기 박스 중 하나의 위치 재고가 모자란다** — 배치 시작 전체가 실패하고 배정 행이 **한 줄도** 남지 않으며, 앱은 기존 `SOURCE_INSUFFICIENT` 차단을 받는다. → Task 2 단위 + Task 9 통합
3. **시작된 배치에 박스를 넣는다** — 지금은 조용히 «집을 수 없는 대기 항목»이 생기는데, 명시적으로 `OUTBOUND_BATCH_ALREADY_STARTED` 로 거절한다(S1-B 가 합류로 대체). → Task 7
4. **배치 시작 명령을 같은 키로 다시 보낸다 / 다른 키로 다시 보낸다** — 둘 다 같은 세션을 돌려주고 `HAND_IN` 이 늘지 않는다. → Task 2·9
5. **복구가 새 `HAND_IN` payload 로 시작된 세션을 검사한다** — 정상 세션은 통과하고, `workItemId` 가 배정과 다른 이벤트는 문제로 잡힌다. → Task 8

---

## File Structure

| 파일 | 책임 | 변경 |
| --- | --- | --- |
| `apps/core/src/modules/inventory/schema/inventory.schema.ts` | 스키마 | `picking_source_allocations.work_item_id` 추가, `plan_id` NULL 허용, 새 유니크·인덱스·관계 |
| `apps/core/drizzle/<ts>_picking-allocations-by-work-item.sql` | 마이그 | 생성 |
| `apps/core/src/modules/fulfillment/picking/plan/` → **`picking/allocation/`** | 배정 층 | `git mv`. `picking-plan.*` → `allocation.*`. `planPicking`·`startPicking`·`invalidateDraftPlan`·`planStalenessReason`·`plan-invalidation.ts` 삭제. 새 `allocate-lines.ts`(순수)·`batch-start.ts` |
| `fulfillment/services/batch-inventory-session.service.ts` | 세션 | `startSession` 새 서명, 계획 신원 제거, 배치 신원으로 재키 |
| `fulfillment/services/picking-process.service.ts` | 전략 진입 | `plan()` 삭제, `start()` = 배치 시작, 래퍼에서 `planId` 제거 |
| `fulfillment/picking/*.strategy.ts`, `picking-strategy.interface.ts` | custody 층 | `planId` 제거, 작업 항목 기준 배정 조회 |
| `fulfillment/controllers/picking-v2.controller.ts`, `tote.controller.ts`, `dto/picking-v2.dto.ts`, `dto/tote.dto.ts` | HTTP | `POST picking/v2/plans` 삭제, `planId` 필드 삭제 |
| `fulfillment/services/outbound-preparation.locks.ts`, `simple-outbound.service.ts`, `location-outbound.service.ts`, `outbound-preparation-result.ts`, `outbound-preparation-policy.ts` | 준비·현장 | 계획 없는 준비. 재계획 분기·정책 삭제 |
| `fulfillment/services/shipment-dispatch.service.ts` | 발송 | 계획 잠금·구성원 스냅샷 제거, 작업 항목 배정 |
| `fulfillment/services/shipment-short-pick.service.ts`, `dto/shipment-short-pick.dto.ts` | 결품 | `planId`·`expectedPlanVersion` 제거, 구성원 은퇴 제거 |
| `fulfillment/services/shipment-planning.service.ts` | 계획·취소 | `retirePickingPlanMemberForShortPick`·`assertNoActivePickingPlan`·구성원 조건 삭제 |
| `fulfillment/services/consolidation.service.ts` | 합포장 | `ACTIVE_PICKING_PLAN` 차단 조건 삭제 |
| `fulfillment/services/outbound-batch-orchestrator.service.ts`, `dto/outbound-batch-v2.dto.ts` | 배치 | 시작된 배치 추가 거절, 제외·재개의 계획 조건 → 배정 조건, 조회 응답 `pickingPlan` → `picking` |
| `fulfillment/services/batch-session-recovery.service.ts` | 복구 | 계획 신원 → 배치·작업 항목 신원 |
| `fulfillment/services/__support__/outbound-preparation-cleanup.ts` | 테스트 지원 | 작업 항목 기준 정리 |
| `fulfillment/picking/allocation/no-picking-plan-references.spec.ts` | 가드 | 계획 테이블 참조 0건 |
| `apps/admin-web/src/...` (Task 10 목록) | 어드민 | 계획 개념 제거 |
| `docs/adr/0041-picking-plan-absorbed-into-work-item-allocations.md` | ADR | 신규 |

---

### Task 0: 착수 전 확인 (사람)

**Files:** 없음(읽기 전용)

- [ ] **Step 1: 라이브 행 수 실측**

라이브 core DB 에서(`sst shell` 경유, `AWS_PROFILE` 을 export 하지 않는다):

```sql
SELECT 'outbound_batches' t, count(*) FROM outbound_batches
UNION ALL SELECT 'picking_plans', count(*) FROM picking_plans
UNION ALL SELECT 'picking_plan_members', count(*) FROM picking_plan_members
UNION ALL SELECT 'picking_source_allocations', count(*) FROM picking_source_allocations
UNION ALL SELECT 'batch_inventory_sessions', count(*) FROM batch_inventory_sessions
UNION ALL SELECT 'active_sessions', count(*) FROM batch_inventory_sessions WHERE status IN ('active','recovery_required');
```

Expected: `active_sessions = 0`. **0 이 아니면 멈추고 사용자에게 보고한다** — 진행 중 배치를 닫는 절차가 먼저다. 행 수 자체(0 이 아닌 과거 행)는 PR 1 을 막지 않는다(`plan_id` 는 남고 새 코드가 읽지 않을 뿐이다).

- [ ] **Step 2: 결과를 PR 본문 초안에 기록** (수치와 실측 시각)

---

### Task 1: 스키마 확장 — 배정을 작업 항목에 매단다

**Files:**
- Modify: `apps/core/src/modules/inventory/schema/inventory.schema.ts` (`pickingSourceAllocations` 정의, `pickingSourceAllocationsRelations`)
- Create: `apps/core/drizzle/<timestamp>_picking-allocations-by-work-item.sql` (생성물)
- Modify: `apps/core/src/modules/inventory/schema/outbound-v2-schema.integration.spec.ts`

**Interfaces:**
- Produces: `wmsTables.pickingSourceAllocations.workItemId`(uuid, nullable in PR 1), 유니크 `uq_picking_source_allocations_work_item_grain (work_item_id, shipment_line_id, source_location_id)`, 인덱스 `idx_picking_source_allocations_work_item`

- [ ] **Step 1: 스키마 수정**

`pickingSourceAllocations` 를 다음으로 바꾼다(기존 `uq_picking_source_allocations_grain` 은 PR 2 까지 둔다 — `plan_id` NULL 행끼리는 NULLS DISTINCT 라 충돌하지 않는다):

```ts
export const pickingSourceAllocations = pgTable(
  'picking_source_allocations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // PR 2(contract)에서 컬럼째 삭제한다. 새 코드는 읽지도 쓰지도 않는다(ADR-0041).
    planId: uuid('plan_id').references(() => pickingPlans.id, { onDelete: 'restrict' }),
    // PR 2 에서 NOT NULL. 배정은 «이 박스가 이 배치에 있는 한 번의 기간»(작업 항목)에 매달린다.
    workItemId: uuid('work_item_id').references(() => outboundBatchWorkItems.id, { onDelete: 'restrict' }),
    shipmentLineId: uuid('shipment_line_id')
      .references(() => shipmentLines.id, { onDelete: 'restrict' })
      .notNull(),
    sourceLocationId: uuid('source_location_id')
      .references(() => locations.id, { onDelete: 'restrict' })
      .notNull(),
    qty: integer('qty').notNull(),
    sourceStockVersion: integer('source_stock_version').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uqPickingSourceGrain: unique('uq_picking_source_allocations_grain').on(
      t.planId,
      t.shipmentLineId,
      t.sourceLocationId,
    ),
    uqPickingSourceWorkItemGrain: unique('uq_picking_source_allocations_work_item_grain').on(
      t.workItemId,
      t.shipmentLineId,
      t.sourceLocationId,
    ),
    idxPickingAllocationWorkItem: index('idx_picking_source_allocations_work_item').on(t.workItemId),
    idxPickingAllocationLine: index('idx_picking_source_allocations_line').on(t.shipmentLineId),
    ckPickingAllocationQty: check('ck_picking_source_allocations_qty_positive', sql`${t.qty} > 0`),
    ckPickingAllocationStockVersion: check(
      'ck_picking_source_allocations_stock_version',
      sql`${t.sourceStockVersion} > 0`,
    ),
  }),
);
```

`pickingSourceAllocationsRelations`(파일 하단 `relations(pickingSourceAllocations, …)`)에 작업 항목 관계를 더한다:

```ts
  workItem: one(outboundBatchWorkItems, {
    fields: [pickingSourceAllocations.workItemId],
    references: [outboundBatchWorkItems.id],
  }),
```

- [ ] **Step 2: 타입 체크**

Run: `npm run type-check`
Expected: 에러 0. (`planId` 가 nullable 이 되어 `planId: plan.id` 를 넣는 기존 insert 는 그대로 컴파일된다. 읽는 쪽에서 `string | null` 이 문제 되면 그 지점은 어차피 이후 Task 에서 삭제되므로, 지금은 `?? ''` 대신 **그 줄을 건드리지 말고** 에러 위치를 기록해 메인 세션에 알린다.)

- [ ] **Step 3: 마이그 생성 (메인 세션/사람)**

Run: `npm run db:generate:core -- --name picking-allocations-by-work-item`
Expected SQL(순서는 달라도 됨), 이 외의 문장이 있으면 멈춘다:

```sql
ALTER TABLE "picking_source_allocations" ALTER COLUMN "plan_id" DROP NOT NULL;
ALTER TABLE "picking_source_allocations" ADD COLUMN "work_item_id" uuid;
ALTER TABLE "picking_source_allocations" ADD CONSTRAINT "picking_source_allocations_work_item_id_outbound_batch_work_items_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "public"."outbound_batch_work_items"("id") ON DELETE restrict ON UPDATE no action;
CREATE INDEX "idx_picking_source_allocations_work_item" ON "picking_source_allocations" USING btree ("work_item_id");
ALTER TABLE "picking_source_allocations" ADD CONSTRAINT "uq_picking_source_allocations_work_item_grain" UNIQUE("work_item_id","shipment_line_id","source_location_id");
```

- [ ] **Step 4: 스키마 통합 스펙의 제약 목록 갱신**

`outbound-v2-schema.integration.spec.ts` 에서 `picking_source_allocations` 의 제약·인덱스 이름을 나열하는 곳(`grep -n "picking_source_allocations" apps/core/src/modules/inventory/schema/outbound-v2-schema.integration.spec.ts`)에 `uq_picking_source_allocations_work_item_grain`·`idx_picking_source_allocations_work_item` 을 더한다. `plan_id` 가 NOT NULL 임을 단언하는 줄이 있으면 nullable 로 바꾼다.

- [ ] **Step 5: 로컬 적용·스키마 스펙**

Run: `npm run test:core:integration:local -- 'inventory/schema/outbound-v2-schema.integration'`
Expected: PASS

- [ ] **Step 6: Commit** (`schema.ts` + SQL + `drizzle/meta/` + 스펙 한 커밋)

```bash
git add apps/core/src/modules/inventory/schema/inventory.schema.ts apps/core/drizzle apps/core/src/modules/inventory/schema/outbound-v2-schema.integration.spec.ts
git commit -m "feat(core): 피킹 배정에 작업 항목 키를 더한다(expand)"
```

---

### Task 2: 배정 층 — 모듈 이름 변경, 순수 배정 함수, 배치 시작

**Files:**
- Move: `apps/core/src/modules/fulfillment/picking/plan/*` → `apps/core/src/modules/fulfillment/picking/allocation/*`
  - `picking-plan.errors.ts` → `allocation.errors.ts`
  - `picking-plan.locks.ts` → `allocation.locks.ts`
  - `picking-plan.queries.ts` → `allocation.queries.ts`
  - `picking-plan.types.ts` → `allocation.types.ts`
  - `picking-plan.ts` → 이 Task 에서는 `legacy-plan.ts` 로 옮겨 두고 Task 3 에서 삭제
  - `picking-plan.spec.ts` → 이 Task 에서는 `legacy-plan.spec.ts`, Task 3 에서 삭제
  - `plan-invalidation.ts` → 그대로 옮기고 Task 3 에서 삭제
- Create: `picking/allocation/allocate-lines.ts`, `picking/allocation/allocate-lines.spec.ts`
- Create: `picking/allocation/batch-start.ts`, `picking/allocation/batch-start.spec.ts`
- Modify: 옮긴 파일을 import 하는 모든 곳(도출: `grep -rln "picking/plan/" apps/core/src --include=*.ts`)

**Interfaces:**
- Produces:
  - `allocateLines(lines: AllocatableLine[], capacities: SourceCapacity[]): AllocationDraft[]` — `PICKING_SOURCE_INSUFFICIENT` 409 를 던진다
  - `interface AllocatableLine { id: string; skuId: string; qty: number; workItemId: string }`
  - `interface AllocationDraft { workItemId: string; shipmentLineId: string; sourceLocationId: string; qty: number; sourceStockVersion: number }`
  - `startBatchPicking(deps: BatchStartDeps, strategyName: PickingStrategyName, input: StartBatchPickingInput, tx?: DbTx): Promise<PickingStartResult>`
  - `interface StartBatchPickingInput { batchId: string; actorId: string; idempotencyKey: string }`
  - `type BatchStartDeps = PickingPlanDeps` 의 새 이름(필드 동일: `commands, workflowGate, sessions, invariant, controlledStock, waybills`)
  - `assertStartEligibility(trx, waybills, aggregate, queuedShipmentIds)` — 옛 `assertPlanningEligibility` 에서 «계획 구성원 = 작업 항목» 비교를 «queued 작업 항목 = 요청 집합 + 진행 중 작업 항목 0»으로 바꾼 것
- Consumes (Task 3 에서 구현): `sessions.startSession({ batchId, actorId, allocations }, trx)`. 이 Task 에서는 `BatchStartDeps.sessions` 의 타입을 아래 포트로 좁혀 두고 단위 테스트는 가짜로 채운다:

```ts
export interface BatchStartSessionPort {
  startSession(
    input: { batchId: string; actorId: string; allocations: SessionStartAllocation[] },
    tx: DbTx,
  ): Promise<{ id: string; status: string }>;
}
export interface SessionStartAllocation {
  id: string;
  workItemId: string;
  shipmentLineId: string;
  skuId: string;
  sourceLocationId: string;
  quantity: number;
  sourceStockVersion: number;
}
```

`SessionStartAllocation` 은 `allocation.types.ts` 에 두고 Task 3 의 세션 서비스가 import 한다.

- [ ] **Step 1: 파일 이동**

```bash
cd apps/core/src/modules/fulfillment/picking
git mv plan allocation
cd allocation
git mv picking-plan.errors.ts allocation.errors.ts
git mv picking-plan.locks.ts allocation.locks.ts
git mv picking-plan.queries.ts allocation.queries.ts
git mv picking-plan.types.ts allocation.types.ts
git mv picking-plan.ts legacy-plan.ts
git mv picking-plan.spec.ts legacy-plan.spec.ts
```

그리고 import 경로를 일괄 교체한다:

```bash
cd /home/pauseb/workspace/almondyoung-server
grep -rl "picking/plan/\|'\./picking-plan\|'\./plan-invalidation" apps/core/src --include=*.ts | xargs sed -i \
  -e "s#picking/plan/picking-plan\.errors#picking/allocation/allocation.errors#g" \
  -e "s#picking/plan/picking-plan\.locks#picking/allocation/allocation.locks#g" \
  -e "s#picking/plan/picking-plan\.queries#picking/allocation/allocation.queries#g" \
  -e "s#picking/plan/picking-plan\.types#picking/allocation/allocation.types#g" \
  -e "s#picking/plan/picking-plan'#picking/allocation/legacy-plan'#g" \
  -e "s#picking/plan/plan-invalidation#picking/allocation/plan-invalidation#g" \
  -e "s#'\./picking-plan\.errors'#'./allocation.errors'#g" \
  -e "s#'\./picking-plan\.locks'#'./allocation.locks'#g" \
  -e "s#'\./picking-plan\.queries'#'./allocation.queries'#g" \
  -e "s#'\./picking-plan\.types'#'./allocation.types'#g" \
  -e "s#'\./picking-plan'#'./legacy-plan'#g"
npm run type-check
```

Expected: 에러 0. 남은 `picking/plan/` 참조가 있으면 `grep -rn "picking/plan/" apps/core/src` 로 찾아 같은 규칙으로 고친다.

- [ ] **Step 2: `allocate-lines` 실패 테스트**

`picking/allocation/allocate-lines.spec.ts`:

```ts
import { ConflictException } from '@nestjs/common';
import { allocateLines } from './allocate-lines';
import { SourceCapacity } from './allocation.types';

const cap = (skuId: string, sourceLocationId: string, remainingQty: number, stockVersion = 1): SourceCapacity => ({
  skuId,
  sourceLocationId,
  remainingQty,
  stockVersion,
});

describe('allocateLines', () => {
  it('줄 id 순, 위치 id 순으로 선착 배정하고 작업 항목 id 를 싣는다', () => {
    const drafts = allocateLines(
      [
        { id: 'line-b', skuId: 'sku-1', qty: 3, workItemId: 'wi-2' },
        { id: 'line-a', skuId: 'sku-1', qty: 2, workItemId: 'wi-1' },
      ],
      [cap('sku-1', 'loc-2', 10, 7), cap('sku-1', 'loc-1', 3, 5)],
    );
    expect(drafts).toEqual([
      { workItemId: 'wi-1', shipmentLineId: 'line-a', sourceLocationId: 'loc-1', qty: 2, sourceStockVersion: 5 },
      { workItemId: 'wi-2', shipmentLineId: 'line-b', sourceLocationId: 'loc-1', qty: 1, sourceStockVersion: 5 },
      { workItemId: 'wi-2', shipmentLineId: 'line-b', sourceLocationId: 'loc-2', qty: 2, sourceStockVersion: 7 },
    ]);
  });

  it('다른 SKU 의 용량은 쓰지 않는다', () => {
    expect(() =>
      allocateLines([{ id: 'line-a', skuId: 'sku-1', qty: 1, workItemId: 'wi-1' }], [cap('sku-2', 'loc-1', 5)]),
    ).toThrow(ConflictException);
  });

  it('모자라면 PICKING_SOURCE_INSUFFICIENT 를 던지고 부분 결과를 돌려주지 않는다', () => {
    let error: unknown;
    try {
      allocateLines(
        [
          { id: 'line-a', skuId: 'sku-1', qty: 2, workItemId: 'wi-1' },
          { id: 'line-b', skuId: 'sku-1', qty: 2, workItemId: 'wi-2' },
        ],
        [cap('sku-1', 'loc-1', 3)],
      );
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(ConflictException);
    expect((error as ConflictException).getResponse()).toMatchObject({ code: 'PICKING_SOURCE_INSUFFICIENT' });
  });

  it('입력 용량 배열을 변경하지 않는다', () => {
    const capacities = [cap('sku-1', 'loc-1', 5)];
    allocateLines([{ id: 'line-a', skuId: 'sku-1', qty: 2, workItemId: 'wi-1' }], capacities);
    expect(capacities[0].remainingQty).toBe(5);
  });
});
```

- [ ] **Step 3: 실패 확인**

Run: `npx jest apps/core/src/modules/fulfillment/picking/allocation/allocate-lines.spec.ts`
Expected: FAIL — `Cannot find module './allocate-lines'`

- [ ] **Step 4: 구현**

먼저 `allocation.errors.ts` 의 `conflict` 가 `ConflictException({ code, message })` 를 만드는지 확인한다(`sed -n 1,32p apps/core/src/modules/fulfillment/picking/allocation/allocation.errors.ts`). 그 헬퍼를 쓴다.

`picking/allocation/allocate-lines.ts`:

```ts
import { conflict } from './allocation.errors';
import { SourceCapacity } from './allocation.types';

export interface AllocatableLine {
  id: string;
  skuId: string;
  qty: number;
  workItemId: string;
}

export interface AllocationDraft {
  workItemId: string;
  shipmentLineId: string;
  sourceLocationId: string;
  qty: number;
  sourceStockVersion: number;
}

/**
 * 줄 id 순으로, 같은 SKU 의 위치를 위치 id 순으로 선착 배정한다(옛 planPicking 의 루프 그대로).
 * 모자라면 아무것도 돌려주지 않고 던진다 — 호출자는 한 트랜잭션에서 전량이 아니면 배정하지 않는다.
 * 입력 용량은 복사해서 깎는다: 호출자가 같은 용량 목록을 다시 쓰는 일이 있다.
 */
export function allocateLines(lines: readonly AllocatableLine[], capacities: readonly SourceCapacity[]): AllocationDraft[] {
  const remaining = capacities.map((capacity) => ({ ...capacity }));
  const drafts: AllocationDraft[] = [];
  for (const line of [...lines].sort((left, right) => left.id.localeCompare(right.id))) {
    let needed = line.qty;
    const sources = remaining
      .filter((source) => source.skuId === line.skuId && source.remainingQty > 0)
      .sort((left, right) => left.sourceLocationId.localeCompare(right.sourceLocationId));
    for (const source of sources) {
      if (needed === 0) break;
      const quantity = Math.min(needed, source.remainingQty);
      drafts.push({
        workItemId: line.workItemId,
        shipmentLineId: line.id,
        sourceLocationId: source.sourceLocationId,
        qty: quantity,
        sourceStockVersion: source.stockVersion,
      });
      source.remainingQty -= quantity;
      needed -= quantity;
    }
    if (needed > 0) {
      throw conflict(
        'PICKING_SOURCE_INSUFFICIENT',
        `Generally available source stock is short by ${needed} for shipment line ${line.id}`,
      );
    }
  }
  return drafts;
}
```

- [ ] **Step 5: 통과 확인**

Run: `npx jest apps/core/src/modules/fulfillment/picking/allocation/allocate-lines.spec.ts`
Expected: PASS (4)

- [ ] **Step 6: `assertStartEligibility` 로 바꾸기**

`allocation.locks.ts` 의 `assertPlanningEligibility` 를 `assertStartEligibility` 로 이름을 바꾸고, 첫 검사 블록(`const requested = …` 부터 `PICKING_WORK_ITEM_MEMBERSHIP_MISMATCH` throw 까지)을 다음으로 교체한다. 나머지 검사(창고·프로필·수령인·예약·송장)는 그대로 둔다.

```ts
  const requested = requestedShipmentIds.join(',');
  const queued = aggregate.workItems.filter((item) => item.status === 'queued');
  if (uniqueSorted(queued.map((item) => item.shipmentId)).join(',') !== requested) {
    throw conflict('PICKING_COMPONENT_CHANGED_RETRY', 'Queued batch work items changed while starting');
  }
  if (aggregate.workItems.some((item) => item.status !== 'queued')) {
    // 시작 전 배치의 작업 항목은 전부 queued 여야 한다. 다른 상태는 계획 흡수 전의 흔적이거나 손상이다.
    throw conflict('PICKING_BATCH_STATE_CORRUPT', 'An unstarted batch has work items beyond queued');
  }
```

`legacy-plan.ts` 는 `assertPlanningEligibility` 를 import 하므로, 이 Task 동안만 `allocation.locks.ts` 에 다음 별칭을 둔다(Task 3 에서 legacy-plan 과 함께 삭제):

```ts
/** @deprecated legacy-plan.ts 전용. Task 3 에서 삭제한다. */
export const assertPlanningEligibility = assertStartEligibility;
```

`ACTIVE_WORK_ITEM_STATUSES` 상수는 `legacy-plan.ts` 외 사용처를 `grep -rn "ACTIVE_WORK_ITEM_STATUSES" apps/core/src` 로 확인하고, 사용처가 남아 있으면 그대로 둔다.

- [ ] **Step 7: `batch-start` 실패 테스트**

`picking/allocation/batch-start.spec.ts` — 가짜 `trx` 로 진입점을 몬다. 잠금·자격·용량 단계는 `jest.mock` 으로 갈아 끼운다(모듈 분리 이유가 이것이다, `allocation.locks.ts` 머리 주석).

```ts
import { ConflictException } from '@nestjs/common';
import { startBatchPicking } from './batch-start';
import * as locks from './allocation.locks';
import { BatchStartDeps } from './allocation.types';

jest.mock('./allocation.locks');
const mockedLocks = locks as jest.Mocked<typeof locks>;

type Row = Record<string, unknown>;

/** select 체인이 호출 순서대로 rows 를 돌려주는 가짜 trx. insert/update 는 기록만 한다. */
function fakeTrx(selectResults: Row[][]) {
  const inserted: Row[][] = [];
  const updated: Row[] = [];
  const queue = [...selectResults];
  const chain = (rows: Row[]) => {
    const promise = Promise.resolve(rows);
    const self: Record<string, unknown> = {
      from: () => self,
      where: () => self,
      orderBy: () => self,
      limit: () => self,
      for: () => promise,
      then: promise.then.bind(promise),
    };
    return self;
  };
  const trx = {
    select: () => chain(queue.shift() ?? []),
    insert: () => ({
      values: (values: Row[]) => {
        inserted.push(values);
        return { returning: async () => values.map((value, index) => ({ id: `alloc-${index + 1}`, ...value })) };
      },
    }),
    update: () => ({
      set: (value: Row) => ({
        where: () => ({
          returning: async () => {
            updated.push(value);
            return [{ id: 'batch-1' }];
          },
        }),
      }),
    }),
  };
  return { trx, inserted, updated };
}

function deps(startSession = jest.fn(async () => ({ id: 'session-1', status: 'active' }))) {
  return {
    commands: {
      execute: jest.fn(async (_request, handler) => (await handler(trxHolder.trx, 'cmd-1', 'hash')).response),
    },
    workflowGate: { assertV2MutationAllowed: jest.fn() },
    sessions: { startSession },
    invariant: {},
    controlledStock: {},
    waybills: {},
  } as unknown as BatchStartDeps & { sessions: { startSession: jest.Mock } };
}

const trxHolder: { trx: unknown } = { trx: undefined };

const aggregate = {
  batch: { id: 'batch-1', warehouseId: 'wh-1', startedAt: null },
  shipments: [],
  lines: [
    { id: 'line-1', shipmentId: 'shp-1', skuId: 'sku-1', qty: 2 },
    { id: 'line-2', shipmentId: 'shp-2', skuId: 'sku-1', qty: 1 },
  ],
  workItems: [
    { id: 'wi-1', shipmentId: 'shp-1', status: 'queued' },
    { id: 'wi-2', shipmentId: 'shp-2', status: 'queued' },
  ],
};

beforeEach(() => {
  jest.resetAllMocks();
  mockedLocks.lockAggregate.mockResolvedValue(aggregate as never);
  mockedLocks.assertStartEligibility.mockResolvedValue(undefined);
  mockedLocks.lockSourceCapacities.mockResolvedValue([
    { skuId: 'sku-1', sourceLocationId: 'loc-1', stockVersion: 4, remainingQty: 10 },
  ]);
});

describe('startBatchPicking', () => {
  it('queued 작업 항목 전부를 배정하고 그 배정으로 세션을 시작한 뒤 배치 시작 시각을 적는다', async () => {
    const fake = fakeTrx([
      [{ id: 'batch-1', startedAt: null }], // 배치 조회
      [{ shipmentId: 'shp-1' }, { shipmentId: 'shp-2' }], // queued 작업 항목
    ]);
    trxHolder.trx = fake.trx;
    const d = deps();
    const result = await startBatchPicking(d, 'discrete', { batchId: 'batch-1', actorId: 'actor-1', idempotencyKey: 'k' });

    expect(result).toEqual({ state: 'started', operationId: 'cmd-1', batchId: 'batch-1', sessionId: 'session-1', status: 'active' });
    expect(fake.inserted[0]).toEqual([
      { workItemId: 'wi-1', shipmentLineId: 'line-1', sourceLocationId: 'loc-1', qty: 2, sourceStockVersion: 4 },
      { workItemId: 'wi-2', shipmentLineId: 'line-2', sourceLocationId: 'loc-1', qty: 1, sourceStockVersion: 4 },
    ]);
    expect(d.sessions.startSession).toHaveBeenCalledWith(
      {
        batchId: 'batch-1',
        actorId: 'actor-1',
        allocations: [
          { id: 'alloc-1', workItemId: 'wi-1', shipmentLineId: 'line-1', skuId: 'sku-1', sourceLocationId: 'loc-1', quantity: 2, sourceStockVersion: 4 },
          { id: 'alloc-2', workItemId: 'wi-2', shipmentLineId: 'line-2', skuId: 'sku-1', sourceLocationId: 'loc-1', quantity: 1, sourceStockVersion: 4 },
        ],
      },
      fake.trx,
    );
    expect(fake.updated).toHaveLength(1);
  });

  it('이미 시작된 배치는 활성 세션을 그대로 돌려주고 배정·인계를 하지 않는다', async () => {
    const fake = fakeTrx([
      [{ id: 'batch-1', startedAt: new Date() }],
      [{ id: 'session-9', status: 'active' }], // 활성 세션
    ]);
    trxHolder.trx = fake.trx;
    const d = deps();
    const result = await startBatchPicking(d, 'discrete', { batchId: 'batch-1', actorId: 'a', idempotencyKey: 'k2' });
    expect(result).toMatchObject({ state: 'started', sessionId: 'session-9' });
    expect(fake.inserted).toHaveLength(0);
    expect(d.sessions.startSession).not.toHaveBeenCalled();
  });

  it('queued 작업 항목이 없으면 PICKING_BATCH_EMPTY', async () => {
    trxHolder.trx = fakeTrx([[{ id: 'batch-1', startedAt: null }], []]).trx;
    await expect(
      startBatchPicking(deps(), 'discrete', { batchId: 'batch-1', actorId: 'a', idempotencyKey: 'k' }),
    ).rejects.toMatchObject({ response: { code: 'PICKING_BATCH_EMPTY' } });
  });

  it('위치 재고가 모자라면 배정 행을 하나도 넣지 않는다', async () => {
    mockedLocks.lockSourceCapacities.mockResolvedValue([
      { skuId: 'sku-1', sourceLocationId: 'loc-1', stockVersion: 4, remainingQty: 2 },
    ]);
    const fake = fakeTrx([[{ id: 'batch-1', startedAt: null }], [{ shipmentId: 'shp-1' }, { shipmentId: 'shp-2' }]]);
    trxHolder.trx = fake.trx;
    await expect(
      startBatchPicking(deps(), 'discrete', { batchId: 'batch-1', actorId: 'a', idempotencyKey: 'k' }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(fake.inserted).toHaveLength(0);
  });
});
```

- [ ] **Step 8: 실패 확인**

Run: `npx jest apps/core/src/modules/fulfillment/picking/allocation/batch-start.spec.ts`
Expected: FAIL — `Cannot find module './batch-start'`

- [ ] **Step 9: 구현**

`allocation.types.ts` 에서 `PickingPlanDeps` 를 `BatchStartDeps` 로 이름을 바꾸고 `sessions` 타입을 `BatchStartSessionPort` 로 좁힌다(위 Interfaces 의 포트·`SessionStartAllocation` 정의를 이 파일에 둔다). `legacy-plan.ts` 는 `PickingPlanDeps` 를 쓰므로 이 Task 동안만 `export type PickingPlanDeps = BatchStartDeps & { sessions: BatchInventorySessionService };` 별칭을 둔다(Task 3 에서 삭제).

`allocation.types.ts` 맨 위의 `import { BatchInventorySessionService } …` 는 `PickingPlanDeps` 별칭 한 곳만 쓰게 되므로 `import type` 으로 바꾼다(Task 3 에서 별칭과 함께 삭제).

`picking-strategy.interface.ts` 의 `PickingStartResult` 는 Task 3 에서 정리한다. 이 Task 에서는 `'started'` 변형에 `planId` 가 있으면 **새 타입을 따로** 둔다:

```ts
// allocation.types.ts
export interface BatchStartResult {
  state: 'started';
  operationId: string;
  batchId: string;
  sessionId: string;
  status: string;
}
```

`picking/allocation/batch-start.ts`:

```ts
import { NotFoundException } from '@nestjs/common';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { DbTx, wmsTables } from '../../../inventory/schema/inventory.schema';
import { PickingStrategyName } from '../picking-strategy.interface';
import { allocateLines } from './allocate-lines';
import { conflict } from './allocation.errors';
import { assertStartEligibility, lockAggregate, lockSourceCapacities } from './allocation.locks';
import { BatchStartDeps, BatchStartResult, SessionStartAllocation, uniqueSorted } from './allocation.types';

export interface StartBatchPickingInput {
  batchId: string;
  actorId: string;
  idempotencyKey: string;
}

/**
 * 배치 시작 = 대기 작업 항목 전부를 한 트랜잭션에서 배정하고 재고 세션에 인계한다(ADR-0041).
 * 옛 «계획 초안 → 시작» 두 단계를 합친 것이다. 배정과 인계가 한 트랜잭션이라 초안이 낡을 틈이 없다.
 *
 * 이미 시작된 배치는 활성 세션을 그대로 돌려준다 — 단순출고는 박스마다 이 명령을 다른 키로 부른다.
 */
export async function startBatchPicking(
  deps: BatchStartDeps,
  strategyName: PickingStrategyName,
  input: StartBatchPickingInput,
  tx?: DbTx,
): Promise<BatchStartResult> {
  const commandType = `picking.${strategyName}.start`;
  deps.workflowGate.assertV2MutationAllowed(commandType);
  return deps.commands.execute<BatchStartResult>(
    {
      commandType,
      idempotencyKey: input.idempotencyKey,
      canonicalRequest: { strategy: strategyName, batchId: input.batchId, actorId: input.actorId },
    },
    async (trx, commandRequestId) => {
      const [batch] = await trx
        .select({ id: wmsTables.outboundBatches.id, startedAt: wmsTables.outboundBatches.startedAt })
        .from(wmsTables.outboundBatches)
        .where(eq(wmsTables.outboundBatches.id, input.batchId))
        .limit(1);
      if (!batch) throw new NotFoundException(`Outbound batch ${input.batchId} not found`);
      if (batch.startedAt) {
        const response = await existingStart(trx, input.batchId, commandRequestId);
        return { response, resourceType: 'batch_inventory_session', resourceId: response.sessionId };
      }

      const queued = await trx
        .select({ shipmentId: wmsTables.outboundBatchWorkItems.shipmentId })
        .from(wmsTables.outboundBatchWorkItems)
        .where(
          and(
            eq(wmsTables.outboundBatchWorkItems.batchId, input.batchId),
            eq(wmsTables.outboundBatchWorkItems.status, 'queued'),
          ),
        )
        .orderBy(asc(wmsTables.outboundBatchWorkItems.shipmentId));
      const shipmentIds = uniqueSorted(queued.map((row) => row.shipmentId));
      if (!shipmentIds.length) throw conflict('PICKING_BATCH_EMPTY', `Batch ${input.batchId} has no queued work`);

      const aggregate = await lockAggregate(trx, deps.invariant, input.batchId, shipmentIds);
      if (aggregate.batch.startedAt) {
        // 잠금을 기다리는 사이 다른 스캔이 시작했다 — 그 세션으로 합류한다.
        const response = await existingStart(trx, input.batchId, commandRequestId);
        return { response, resourceType: 'batch_inventory_session', resourceId: response.sessionId };
      }
      await assertStartEligibility(trx, deps.waybills, aggregate, shipmentIds);

      const workItemByShipment = new Map(aggregate.workItems.map((item) => [item.shipmentId, item.id]));
      const capacities = await lockSourceCapacities(trx, deps.controlledStock, aggregate);
      const drafts = allocateLines(
        aggregate.lines.map((line) => ({
          id: line.id,
          skuId: line.skuId,
          qty: line.qty,
          workItemId: workItemByShipment.get(line.shipmentId)!,
        })),
        capacities,
      );
      const inserted = await trx.insert(wmsTables.pickingSourceAllocations).values(drafts).returning();
      const skuByLine = new Map(aggregate.lines.map((line) => [line.id, line.skuId]));
      const allocations: SessionStartAllocation[] = inserted.map((row) => ({
        id: row.id,
        workItemId: row.workItemId!,
        shipmentLineId: row.shipmentLineId,
        skuId: skuByLine.get(row.shipmentLineId)!,
        sourceLocationId: row.sourceLocationId,
        quantity: row.qty,
        sourceStockVersion: row.sourceStockVersion,
      }));
      const session = await deps.sessions.startSession(
        { batchId: input.batchId, actorId: input.actorId, allocations },
        trx,
      );
      const [marked] = await trx
        .update(wmsTables.outboundBatches)
        .set({ startedAt: sql`now()` })
        .where(and(eq(wmsTables.outboundBatches.id, input.batchId), isNull(wmsTables.outboundBatches.startedAt)))
        .returning({ id: wmsTables.outboundBatches.id });
      if (!marked) throw conflict('PICKING_BATCH_STALE', `Batch ${input.batchId} started concurrently`);
      const response: BatchStartResult = {
        state: 'started',
        operationId: commandRequestId,
        batchId: input.batchId,
        sessionId: session.id,
        status: session.status,
      };
      return { response, resourceType: 'batch_inventory_session', resourceId: session.id };
    },
    tx,
  );
}

async function existingStart(trx: DbTx, batchId: string, operationId: string): Promise<BatchStartResult> {
  const [session] = await trx
    .select({ id: wmsTables.batchInventorySessions.id, status: wmsTables.batchInventorySessions.status })
    .from(wmsTables.batchInventorySessions)
    .where(
      and(
        eq(wmsTables.batchInventorySessions.batchId, batchId),
        inArray(wmsTables.batchInventorySessions.status, ['active', 'recovery_required']),
      ),
    )
    .limit(1);
  if (!session) throw conflict('PICKING_BATCH_ALREADY_FINISHED', `Batch ${batchId} has no open inventory session`);
  return { state: 'started', operationId, batchId, sessionId: session.id, status: session.status };
}
```

`commands.execute` 의 콜백 반환 형태(`{ response, resourceType, resourceId }`)는 기존 `legacy-plan.ts` 의 `startPicking` 과 같은지 확인한다.

- [ ] **Step 10: 통과 확인**

Run: `npx jest apps/core/src/modules/fulfillment/picking/allocation/`
Expected: PASS(`allocate-lines`·`batch-start`·`legacy-plan`). `legacy-plan.spec.ts` 가 `assertPlanningEligibility` mock 을 쓰다 실패하면 mock 대상 이름을 `assertStartEligibility` 로 바꾼다 — 이 파일은 Task 3 에서 삭제되므로 최소 수정만.

- [ ] **Step 11: 게이트·커밋**

Run: `npm run type-check && npx jest apps/core/src/modules/fulfillment`
Expected: 에러 0, 실패 0

```bash
git add -A apps/core/src/modules/fulfillment
git commit -m "refactor(fulfillment): 피킹 계획 층을 배정 층으로 옮기고 배치 시작을 더한다"
```

---

### Task 3: 재고 세션을 배치 신원으로 재키하고 배치 시작으로 갈아 끼운다

**Files:**
- Modify: `apps/core/src/modules/fulfillment/services/batch-inventory-session.service.ts`
- Modify: `apps/core/src/modules/fulfillment/services/picking-process.service.ts`
- Delete: `picking/allocation/legacy-plan.ts`, `picking/allocation/legacy-plan.spec.ts`, `picking/allocation/plan-invalidation.ts`
- Modify: `picking/allocation/allocation.queries.ts`(`invalidateDraftPlan` 삭제), `allocation.locks.ts`(`planStalenessReason`·`assertPlanningEligibility` 별칭 삭제), `allocation.types.ts`(`PickingPlanDeps` 별칭 삭제)
- Modify: `apps/core/src/modules/fulfillment/services/batch-inventory-session.service.spec.ts`(단위)
- Test: `batch-inventory-session.integration.spec.ts` 는 Task 9

**Interfaces:**
- Consumes: `SessionStartAllocation`, `BatchStartSessionPort`(Task 2)
- Produces:
  - `BatchInventorySessionService.startSession(input: { batchId: string; actorId: string; allocations: SessionStartAllocation[] }, tx: DbTx): Promise<SessionRow>`
  - `export function handInRequestHash(batchId: string, allocation: SessionStartAllocation): string` — Task 8 복구가 쓴다
  - `ShortPickOperationIntentProof` 에 `workItemId: string` 추가(`shortPickOperationIntentOf` 가 파싱)
  - `PickingProcessService.start(input: StartBatchPickingInput, tx?: DbTx): Promise<BatchStartResult>`; `plan()` 삭제
  - 새 HAND_IN payload: `{ sequence, batchId, workItemId, allocationId, shipmentLineId, sourceStockVersion, requestHash }`, 멱등 키 `start:${batchId}:${allocationId}`

- [ ] **Step 1: `handInRequestHash` 실패 테스트**

`batch-inventory-session.service.spec.ts` 에 추가:

```ts
import { canonicalBatchSessionRequestHash, handInRequestHash } from './batch-inventory-session.service';

describe('handInRequestHash', () => {
  it('배치·작업 항목·배정 신원을 묶어 해시한다(계획 id 없음)', () => {
    const allocation = {
      id: 'alloc-1',
      workItemId: 'wi-1',
      shipmentLineId: 'line-1',
      skuId: 'sku-1',
      sourceLocationId: 'loc-1',
      quantity: 2,
      sourceStockVersion: 3,
    };
    expect(handInRequestHash('batch-1', allocation)).toBe(
      canonicalBatchSessionRequestHash({
        eventType: 'HAND_IN',
        batchId: 'batch-1',
        workItemId: 'wi-1',
        allocationId: 'alloc-1',
        skuId: 'sku-1',
        sourceLocationId: 'loc-1',
        shipmentLineId: 'line-1',
        quantity: 2,
        sourceStockVersion: 3,
      }),
    );
    expect(handInRequestHash('batch-1', { ...allocation, workItemId: 'wi-2' })).not.toBe(
      handInRequestHash('batch-1', allocation),
    );
  });
});

describe('shortPickOperationIntentOf', () => {
  it('workItemId 가 없는 intent 는 거절한다', () => {
    const base = {
      kind: 'short_pick',
      operationId: 'op',
      shipmentId: 's',
      workItemId: 'wi-1',
      sessionId: 'se',
      actorId: 'a',
      reason: 'r',
      lines: [{ shipmentLineId: 'l', sourceLocationId: 'loc', shortQty: 1, allocationQty: 2 }],
    };
    expect(shortPickOperationIntentOf({ intent: base })?.workItemId).toBe('wi-1');
    const { workItemId: _omit, ...withoutWorkItem } = base;
    expect(shortPickOperationIntentOf({ intent: withoutWorkItem })).toBeNull();
  });
});
```

(`shortPickOperationIntentOf` import 를 같은 줄에 더한다.)

- [ ] **Step 2: 실패 확인**

Run: `npx jest apps/core/src/modules/fulfillment/services/batch-inventory-session.service.spec.ts -t "handInRequestHash|shortPickOperationIntentOf"`
Expected: FAIL — `handInRequestHash is not a function` 등

- [ ] **Step 3: 세션 서비스 수정**

1. `ShortPickOperationIntentProof` 에 `workItemId: string;` 을 더하고, `shortPickOperationIntentOf` 의 거절 조건에 `typeof intent.workItemId !== 'string' ||` 를 더하고 반환 객체에 `workItemId: intent.workItemId,` 를 넣는다.
2. `import type { SessionStartAllocation } from '../picking/allocation/allocation.types';` 를 더하고(**`import type`** — `allocation.types.ts` 가 세션 서비스를 값으로 import 하던 옛 줄은 Task 2 에서 포트로 바꿔 끊었다. 값 import 로 되살리면 순환이 생긴다), 클래스 밖에 `handInRequestHash` 를 추가한다:

```ts
export function handInRequestHash(batchId: string, allocation: SessionStartAllocation): string {
  return canonicalBatchSessionRequestHash({
    eventType: 'HAND_IN',
    batchId,
    workItemId: allocation.workItemId,
    allocationId: allocation.id,
    skuId: allocation.skuId,
    sourceLocationId: allocation.sourceLocationId,
    shipmentLineId: allocation.shipmentLineId,
    quantity: allocation.quantity,
    sourceStockVersion: allocation.sourceStockVersion,
  });
}
```

3. `startSession` 전체를 다음으로 교체한다. 옛 본문의 계획·구성원·예약 재검증은 호출자(`startBatchPicking`)가 같은 트랜잭션에서 잠금 아래 끝냈다.

```ts
  async startSession(
    input: { batchId: string; actorId: string; allocations: SessionStartAllocation[] },
    tx: DbTx,
  ): Promise<SessionRow> {
    if (!tx) throw new Error('startSession requires the caller batch-start transaction');
    if (input.allocations.length === 0) {
      throw this.conflict('PICKING_BATCH_EMPTY', `Batch ${input.batchId} has no allocations to hand in`);
    }
    const [existing] = await tx
      .select({ id: wmsTables.batchInventorySessions.id })
      .from(wmsTables.batchInventorySessions)
      .where(
        and(
          eq(wmsTables.batchInventorySessions.batchId, input.batchId),
          inArray(wmsTables.batchInventorySessions.status, ['active', 'recovery_required']),
        ),
      )
      .limit(1)
      .for('update');
    if (existing) throw this.conflict('SESSION_ALREADY_STARTED', `Batch ${input.batchId} already has a session`);

    const [session] = await tx.insert(wmsTables.batchInventorySessions).values({ batchId: input.batchId }).returning();
    let sequence = session.version;
    const ordered = [...input.allocations].sort(
      (left, right) =>
        left.sourceLocationId.localeCompare(right.sourceLocationId) ||
        left.shipmentLineId.localeCompare(right.shipmentLineId) ||
        left.id.localeCompare(right.id),
    );
    for (const allocation of ordered) {
      await tx.insert(wmsTables.batchInventorySessionEvents).values({
        sessionId: session.id,
        idempotencyKey: `start:${input.batchId}:${allocation.id}`,
        eventType: 'HAND_IN',
        skuId: allocation.skuId,
        quantity: allocation.quantity,
        toCustodyType: 'AT_SOURCE',
        toSourceLocationId: allocation.sourceLocationId,
        payload: {
          sequence,
          batchId: input.batchId,
          workItemId: allocation.workItemId,
          allocationId: allocation.id,
          shipmentLineId: allocation.shipmentLineId,
          sourceStockVersion: allocation.sourceStockVersion,
          requestHash: handInRequestHash(input.batchId, allocation),
        },
      });
      await tx
        .insert(wmsTables.batchInventorySessionBalances)
        .values({
          sessionId: session.id,
          skuId: allocation.skuId,
          sourceLocationId: allocation.sourceLocationId,
          custodyType: 'AT_SOURCE',
          qty: allocation.quantity,
        })
        .onConflictDoUpdate({
          target: [
            wmsTables.batchInventorySessionBalances.sessionId,
            wmsTables.batchInventorySessionBalances.skuId,
            wmsTables.batchInventorySessionBalances.sourceLocationId,
            wmsTables.batchInventorySessionBalances.custodyType,
            wmsTables.batchInventorySessionBalances.custodyRef,
            wmsTables.batchInventorySessionBalances.shipmentLineId,
          ],
          set: {
            qty: sql`${wmsTables.batchInventorySessionBalances.qty} + ${allocation.quantity}`,
            version: sql`${wmsTables.batchInventorySessionBalances.version} + 1`,
            updatedAt: sql`now()`,
          },
        });
      sequence += 1;
    }
    const handedInQty = ordered.reduce((total, allocation) => total + allocation.quantity, 0);
    const [started] = await tx
      .update(wmsTables.batchInventorySessions)
      .set({ handedInQty, version: sequence, updatedAt: sql`now()` })
      .where(
        and(
          eq(wmsTables.batchInventorySessions.id, session.id),
          eq(wmsTables.batchInventorySessions.version, session.version),
        ),
      )
      .returning();
    if (!started) throw this.conflict('SESSION_STALE_VERSION', `Session ${session.id} changed while starting`);
    await this.assertConservation(started, tx);
    await this.audit.logUserActionRequired(
      'batch_inventory_session.start',
      'fulfillment',
      `Started inventory session ${session.id}`,
      { userId: input.actorId },
      { batchId: input.batchId, handedInQty, allocationIds: ordered.map((allocation) => allocation.id) },
      tx,
    );
    return started;
  }
```

4. `mutate` 에서 계획 신원을 걷어낸다:
   - `const planId = await this.sessionPlanId(…)` 부터 `await this.assertExistingSessionPlan(…)` 까지(계획 잠금 포함)를 `const session = await this.lockSession(input.sessionId, trx);` 한 줄로 바꾼다. 주석은 «short-pick 작업 → 세션 순서로 잠근다»로 고친다
   - `assertShortageAllocation(input, planId, …)` 두 호출에서 `planId` 인자를 지운다
   - `assertLineAssignment(input.sessionId, …)` → `assertLineAssignment(session.batchId, …)`
   - `assertAttributedQuantity(input.sessionId, input.to, trx)` → `assertAttributedQuantity(session, input.to, trx)`
   - `if (isTerminal) { … pickingPlans … }` 블록을 지운다(세션 종료는 세션 상태가 말한다)
5. `assertShortageAllocation` 에서 `planId` 매개변수를 지우고, 배정 조회 조건 `eq(wmsTables.pickingSourceAllocations.planId, planId)` 를 `eq(wmsTables.pickingSourceAllocations.workItemId, intent.workItemId)` 로 바꾼다. 이 조회보다 앞에서 `intent` 가 null 이면 이미 던졌으므로 `intent!` 없이 좁혀진다 — 좁혀지지 않으면 `const workItemId = intent.workItemId;` 를 intent 검사 직후에 둔다.
6. `assertLineAssignment` 를 배치 기준으로:

```ts
  private async assertLineAssignment(
    batchId: string,
    skuId: string,
    bucket: SessionEventSide,
    tx: DbTx,
  ): Promise<void> {
    if (!bucket.shipmentLineId) return;
    const [allocation] = await tx
      .select({ id: wmsTables.pickingSourceAllocations.id })
      .from(wmsTables.pickingSourceAllocations)
      .innerJoin(
        wmsTables.outboundBatchWorkItems,
        eq(wmsTables.outboundBatchWorkItems.id, wmsTables.pickingSourceAllocations.workItemId),
      )
      .innerJoin(
        wmsTables.shipmentLines,
        eq(wmsTables.shipmentLines.id, wmsTables.pickingSourceAllocations.shipmentLineId),
      )
      .where(
        and(
          eq(wmsTables.outboundBatchWorkItems.batchId, batchId),
          eq(wmsTables.pickingSourceAllocations.shipmentLineId, bucket.shipmentLineId),
          eq(wmsTables.pickingSourceAllocations.sourceLocationId, bucket.sourceLocationId),
          eq(wmsTables.shipmentLines.skuId, skuId),
        ),
      )
      .limit(1);
    if (!allocation) {
      throw this.conflict('SESSION_LINE_NOT_ALLOCATED', 'Custody shipment line is not allocated in the session batch');
    }
  }
```

7. `assertAttributedQuantity` 를 배치 기준으로 — 첫 조회를 다음으로 바꾸고 시그니처를 `(session: SessionRow, bucket, tx)` 로, 두 번째 조회의 `sessionId` 는 `session.id`:

```ts
    const [allocated] = await tx
      .select({ qty: sql<number>`coalesce(sum(${wmsTables.pickingSourceAllocations.qty}), 0)::int` })
      .from(wmsTables.pickingSourceAllocations)
      .innerJoin(
        wmsTables.outboundBatchWorkItems,
        eq(wmsTables.outboundBatchWorkItems.id, wmsTables.pickingSourceAllocations.workItemId),
      )
      .where(
        and(
          eq(wmsTables.outboundBatchWorkItems.batchId, session.batchId),
          eq(wmsTables.pickingSourceAllocations.shipmentLineId, bucket.shipmentLineId!),
          eq(wmsTables.pickingSourceAllocations.sourceLocationId, bucket.sourceLocationId),
        ),
      );
```

8. `sessionPlanId`·`assertExistingSessionPlan` 메서드를 지운다. 남은 참조가 없어야 한다: `grep -n "sessionPlanId\|assertExistingSessionPlan\|pickingPlans\|planId" apps/core/src/modules/fulfillment/services/batch-inventory-session.service.ts` 결과 0 줄.

- [ ] **Step 4: `PickingProcessService` 를 배치 시작으로**

- `plan()` 메서드와 `planPicking`/`startPicking` import 를 지운다
- `start()` 를 다음으로 교체한다:

```ts
  async start(input: StartBatchPickingInput, tx?: DbTx): Promise<BatchStartResult> {
    return this.dbService.run(async (trx) => {
      const identity = await this.loadBatchIdentity(input.batchId, trx);
      await this.requiredRegistry().resolveForWarehouse(identity.strategy, identity.warehouseId, trx);
      return startBatchPicking(this.startDeps, identity.strategy, input, trx);
    }, tx);
  }

  private async loadBatchIdentity(batchId: string, tx: DbTx) {
    const [batch] = await tx
      .select({
        warehouseId: wmsTables.outboundBatches.warehouseId,
        pickingMethod: wmsTables.outboundBatches.pickingMethod,
      })
      .from(wmsTables.outboundBatches)
      .where(eq(wmsTables.outboundBatches.id, batchId))
      .limit(1);
    if (!batch) throw new NotFoundException(`Outbound batch ${batchId} not found`);
    return { warehouseId: batch.warehouseId, strategy: STRATEGY_BY_PICKING_METHOD[batch.pickingMethod] };
  }
```

- `planDeps` getter 를 `startDeps: BatchStartDeps` 로 이름을 바꾼다
- `loadPlanIdentity` 는 Task 4 에서 래퍼를 바꿀 때 지운다(아직 `withPlanStrategy` 가 쓴다)

- [ ] **Step 5: 옛 계획 코드 삭제**

```bash
cd apps/core/src/modules/fulfillment/picking/allocation
git rm legacy-plan.ts legacy-plan.spec.ts plan-invalidation.ts
```

- `allocation.queries.ts`: `invalidateDraftPlan` 삭제(과 그 import)
- `allocation.locks.ts`: `planStalenessReason`·`assertPlanningEligibility` 별칭 삭제
- `allocation.types.ts`: `PickingPlanDeps` 별칭 삭제
- `outbound-preparation-result.ts`: `import type { PlanInvalidationCode }` 를 지우고 `PreparationBlockReason` 을 문자열 리터럴로 편다(와이어 계약 유지 — 값 집합 그대로):

```ts
export type PreparationBlockReason =
  | 'SOURCE_STOCK_CHANGED'
  | 'PLAN_IDENTITY_CHANGED'
  | 'PLAN_NOT_DRAFT'
  | 'SHIPMENT_SNAPSHOT_CHANGED'
  | 'ALLOCATION_INVALID'
  | 'ELIGIBILITY_CHANGED'
  | 'SOURCE_INSUFFICIENT'
  | 'ACTIVE_WORK_REQUIRES_REVIEW'
  | 'REPLAN_LIMIT_REACHED';
```

`picking-strategy.interface.ts` 가 `PlanInvalidationCode` 를 import 하면 그 import 와 `PickingPlanResult`·`PlanPickingInput` 을 지우고, `PickingStartResult` 를 `export type PickingStartResult = BatchStartResult;` 로 바꾸고, `StartPickingInput` 을 `export type StartPickingInput = StartBatchPickingInput;` 로 바꾼다(재수출).

- [ ] **Step 6: 타입 체크로 남은 소비자 찾기**

Run: `npm run type-check`
Expected: 에러는 **소비자 쪽**(`simple-outbound.service.ts` 의 `ensurePlan`·`picking.plan`·`started.planId`, 컨트롤러의 `POST plans` 등)에서만 난다. 이 Task 에서는 컴파일만 살리는 최소 수정을 한다:
  - `picking-v2.controller.ts` 의 `POST plans` 핸들러와 `CreatePickingPlanV2Dto`(이름은 `grep -n "class .*Plan" apps/core/src/modules/fulfillment/dto/picking-v2.dto.ts`)를 지운다. `POST starts` 는 `this.picking.start({ batchId: dto.batchId, actorId: actor.id, idempotencyKey })` 로. `StartPickingV2Dto` 에서 `planId` 필드 삭제
  - `simple-outbound.service.ts`·`location-outbound.service.ts` 는 Task 5 의 본 수정을 **이 Task 에서 미리 하지 말고**, 컴파일 에러 지점마다 Task 5 의 코드를 그대로 가져와 적용한다(Task 5 Step 3~5). 즉 Task 5 의 prepare 재작성은 여기서 끝나고, Task 5 는 나머지(위치별 출고·정리 헬퍼·정책 삭제)를 맡는다
- 다시 `npm run type-check` → 에러 0

- [ ] **Step 7: 단위 스펙**

Run: `npx jest apps/core/src/modules/fulfillment --maxWorkers=2`
Expected: 실패는 계획을 mock 하던 단위 스펙에서만 난다. 각 실패를 다음 규칙으로 고친다:
  - `startSession(batchId, planId, …)` 호출 기대 → 새 입력 객체 기대로
  - `pickingPlans` 를 흉내 내던 가짜 select 응답 → 삭제
  - `picking.plan` mock → 삭제, `picking.start` 반환값에서 `planId` 삭제
  - 계획 무효화·재계획을 검증하던 `it` → 삭제(행동 자체가 사라졌다). 삭제한 테스트 이름을 커밋 본문에 나열한다

- [ ] **Step 8: 게이트·커밋**

Run: `npm run type-check && npx jest --maxWorkers=2`
Expected: 에러 0, 실패 0 (DB 통합 스펙은 기본 게이트에서 skip)

```bash
git add -A apps/core/src/modules/fulfillment
git commit -m "refactor(fulfillment): 재고 세션을 배치 신원으로 재키하고 피킹 시작을 배치 시작으로 바꾼다"
```

---

### Task 4: 전략 3종·조회 헬퍼·HTTP 에서 계획을 걷어낸다

**Files:**
- Modify: `picking/allocation/allocation.queries.ts`
- Modify: `picking/discrete-picking.strategy.ts`, `picking/pick-to-tote.strategy.ts`, `picking/aggregate-then-sort.strategy.ts`
- Modify: `picking/picking-strategy.interface.ts`
- Modify: `services/picking-process.service.ts`
- Modify: `controllers/picking-v2.controller.ts`, `controllers/tote.controller.ts`, `dto/picking-v2.dto.ts`, `dto/tote.dto.ts`
- Modify: 스펙 `picking/*.strategy.spec.ts`, `picking/picking-strategy.contract.spec.ts`, `controllers/picking-v2.controller.spec.ts`, `controllers/tote.controller.spec.ts`

**Interfaces:**
- Produces:
  - `assertActiveBatchSession(trx: DbTx, sessionId: string, batchId: string, strategyName: PickingStrategyName): Promise<void>` — 배치가 시작됐고 그 피킹 방식이 `strategyName` 이며 세션이 그 배치의 `active` 세션
  - `assertBatchSessionLifecycle(trx, sessionId, batchId, strategyName, allowedSessionStatuses: readonly ('active' | 'settled')[]): Promise<void>` — 바구니 반납 전용(`releaseTote` 는 완료 후에도 허용)
  - `loadWorkItemAllocations(trx: DbTx, workItemId: string): Promise<ShipmentAllocation[]>` — 없으면 `PICKING_WORK_ITEM_NOT_ALLOCATED`
  - 모든 전략 입력·결과 타입에서 `planId` 삭제

- [ ] **Step 1: 조회 헬퍼 실패 테스트**

`picking/allocation/allocation.queries.spec.ts`(없으면 생성):

```ts
import { assertActiveBatchSession } from './allocation.queries';

function trxReturning(...results: Array<Array<Record<string, unknown>>>) {
  const queue = [...results];
  const chain = () => {
    const rows = queue.shift() ?? [];
    const promise = Promise.resolve(rows);
    const self: Record<string, unknown> = {
      from: () => self,
      where: () => self,
      limit: () => self,
      for: () => promise,
      then: promise.then.bind(promise),
    };
    return self;
  };
  return { select: chain } as never;
}

describe('assertActiveBatchSession', () => {
  it('시작 안 된 배치는 PICKING_BATCH_NOT_STARTED', async () => {
    const trx = trxReturning([{ pickingMethod: 'individual', startedAt: null }]);
    await expect(assertActiveBatchSession(trx, 's', 'b', 'discrete')).rejects.toMatchObject({
      response: { code: 'PICKING_BATCH_NOT_STARTED' },
    });
  });

  it('피킹 방식이 다르면 PICKING_BATCH_NOT_STARTED', async () => {
    const trx = trxReturning([{ pickingMethod: 'total_picking', startedAt: new Date() }]);
    await expect(assertActiveBatchSession(trx, 's', 'b', 'discrete')).rejects.toMatchObject({
      response: { code: 'PICKING_BATCH_NOT_STARTED' },
    });
  });

  it('다른 배치의 세션이면 PICKING_SESSION_NOT_ACTIVE', async () => {
    const trx = trxReturning(
      [{ pickingMethod: 'individual', startedAt: new Date() }],
      [{ batchId: 'other', status: 'active' }],
    );
    await expect(assertActiveBatchSession(trx, 's', 'b', 'discrete')).rejects.toMatchObject({
      response: { code: 'PICKING_SESSION_NOT_ACTIVE' },
    });
  });

  it('시작된 같은 방식 배치의 활성 세션이면 통과', async () => {
    const trx = trxReturning(
      [{ pickingMethod: 'individual', startedAt: new Date() }],
      [{ batchId: 'b', status: 'active' }],
    );
    await expect(assertActiveBatchSession(trx, 's', 'b', 'discrete')).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx jest apps/core/src/modules/fulfillment/picking/allocation/allocation.queries.spec.ts`
Expected: FAIL — `assertActiveBatchSession is not a function`

- [ ] **Step 3: 헬퍼 구현**

`allocation.queries.ts` 에서 `assertPlanMembers`·`assertActivePlanSession`·`loadShipmentAllocations` 를 지우고 다음을 넣는다. `STRATEGY_BY_PICKING_METHOD` 는 `../picking-method.contract` 에서 import 한다.

```ts
/**
 * 배치 행은 잠그지 않는다: `startedAt` 은 한 번만 쓰이고 `pickingMethod` 는 불변이다.
 * 여기서 배치를 잠그면 작업 항목 → 배치 순서가 되어, 배치 → 작업 항목 순서로 잠그는
 * 배치 시작·박스 추가와 교착한다.
 */
export async function assertActiveBatchSession(
  trx: DbTx,
  sessionId: string,
  batchId: string,
  strategyName: PickingStrategyName,
): Promise<void> {
  await assertBatchSessionLifecycle(trx, sessionId, batchId, strategyName, ['active']);
}

export async function assertBatchSessionLifecycle(
  trx: DbTx,
  sessionId: string,
  batchId: string,
  strategyName: PickingStrategyName,
  allowedSessionStatuses: readonly ('active' | 'settled')[],
): Promise<void> {
  const [batch] = await trx
    .select({
      pickingMethod: wmsTables.outboundBatches.pickingMethod,
      startedAt: wmsTables.outboundBatches.startedAt,
    })
    .from(wmsTables.outboundBatches)
    .where(eq(wmsTables.outboundBatches.id, batchId))
    .limit(1);
  if (!batch || !batch.startedAt || STRATEGY_BY_PICKING_METHOD[batch.pickingMethod] !== strategyName) {
    throw conflict('PICKING_BATCH_NOT_STARTED', `Batch ${batchId} is not a started ${strategyName} batch`);
  }
  const [session] = await trx
    .select({ batchId: wmsTables.batchInventorySessions.batchId, status: wmsTables.batchInventorySessions.status })
    .from(wmsTables.batchInventorySessions)
    .where(eq(wmsTables.batchInventorySessions.id, sessionId))
    .limit(1)
    .for('update');
  if (
    !session ||
    session.batchId !== batchId ||
    !(allowedSessionStatuses as readonly string[]).includes(session.status)
  ) {
    throw conflict('PICKING_SESSION_NOT_ACTIVE', `Inventory session ${sessionId} is not active for the batch`);
  }
}

export async function loadWorkItemAllocations(trx: DbTx, workItemId: string): Promise<ShipmentAllocation[]> {
  const allocations = await trx
    .select({
      id: wmsTables.pickingSourceAllocations.id,
      shipmentLineId: wmsTables.pickingSourceAllocations.shipmentLineId,
      skuId: wmsTables.shipmentLines.skuId,
      sourceLocationId: wmsTables.pickingSourceAllocations.sourceLocationId,
      qty: wmsTables.pickingSourceAllocations.qty,
    })
    .from(wmsTables.pickingSourceAllocations)
    .innerJoin(
      wmsTables.shipmentLines,
      eq(wmsTables.shipmentLines.id, wmsTables.pickingSourceAllocations.shipmentLineId),
    )
    .where(eq(wmsTables.pickingSourceAllocations.workItemId, workItemId))
    .orderBy(
      asc(wmsTables.pickingSourceAllocations.shipmentLineId),
      asc(wmsTables.pickingSourceAllocations.sourceLocationId),
      asc(wmsTables.pickingSourceAllocations.id),
    );
  if (!allocations.length) {
    throw conflict('PICKING_WORK_ITEM_NOT_ALLOCATED', `Work item ${workItemId} has no picking allocation`);
  }
  return allocations;
}
```

Run: `npx jest apps/core/src/modules/fulfillment/picking/allocation/allocation.queries.spec.ts` → PASS

- [ ] **Step 4: 인터페이스에서 `planId` 제거**

`picking-strategy.interface.ts` 에서 다음 타입의 `planId: string;` 줄을 지운다: `DiscreteScanPickingInput`, `AggregateSourceScanInput`, `AggregateSortScanInput`, `AggregateCartHandoffInput`, `ToteAssignmentInput`(상속: `ToteScanPickingInput`·`ToteReleaseInput`·`ToteHandoffInput`), `HandoffPickingInput`, `CompletePickInput`, `UnpickShipmentInput`, `PickingScanResult`, `AggregateSourceScanResult`, `AggregateSortScanResult`. 확인: `grep -n "planId" apps/core/src/modules/fulfillment/picking/picking-strategy.interface.ts` → 0 줄.

- [ ] **Step 5: 개별 피킹 전략**

`discrete-picking.strategy.ts`, 각 메서드에서:
- `canonicalRequest` 의 `planId: input.planId,` 삭제(65·182·280·409 부근)
- `assertActivePlanSession(trx, input.planId, input.sessionId, input.batchId, <name>)` → `assertActiveBatchSession(trx, input.sessionId, input.batchId, <name>)`
- `assertPlanMembers(trx, input.planId, [input.shipmentId])` 삭제 — 그 앞의 `lockAndAssertPickerClaim`/`loadWorkItem`+`assertWorkItemIdentity` 가 «이 배치의 이 박스 작업 항목»을 이미 잠그고 확인했다. `handoff` 는 그 뒤에 작업 항목 상태가 `completed|excluded` 가 아님을 확인한다:

```ts
if (item.status === 'completed' || item.status === 'excluded') {
  throw conflict('PICKING_WORK_ITEM_CLOSED', `Work item ${item.id} is ${item.status}`);
}
```

- `scan` 의 배정 확인 조건 `eq(wmsTables.pickingSourceAllocations.planId, input.planId)` → `eq(wmsTables.pickingSourceAllocations.workItemId, input.workItemId)`
- `loadShipmentAllocations(trx, input.planId, input.shipmentId)` → `loadWorkItemAllocations(trx, input.workItemId)`
- 응답의 `planId` 필드 삭제
- `PICKING_CUSTODY_GRAIN_MISMATCH` 메시지의 «plan allocation» → «work item allocation»

- [ ] **Step 6: 바구니 피킹 전략**

`pick-to-tote.strategy.ts` 에 Step 5 규칙을 적용하고(117·214·346·435·544·609·748 의 `canonicalRequest`, 135·237·582·626·760 의 단언, 254 의 배정 조건, 317 의 응답), 추가로:
- `toteHandoff` 의 `assertPlanMembers(trx, input.planId, [input.shipmentId, input.targetShipmentId])` 는 삭제 — 두 작업 항목 모두 `assertActiveWorkItemLease` 로 이미 확인됐다
- `releaseTote`: `this.assertReleasePlanSession(input.planId, input.sessionId, input.batchId, trx)` 와 이어지는 `assertPlanMembers` 를 다음으로:

```ts
await assertBatchSessionLifecycle(trx, input.sessionId, input.batchId, this.capabilities.name, ['active', 'settled']);
const item = await loadWorkItem(trx, input.workItemId);
assertWorkItemIdentity(item, input.batchId, input.shipmentId);
// 완료 뒤 반납도 허용한다(옛 «계획 completed + 세션 settled» 규칙과 같다) — 상태는 따지지 않는다.
```

- `assertReleasePlanSession` private 메서드 삭제

- [ ] **Step 7: 토탈피킹 전략**

`aggregate-then-sort.strategy.ts` 에 Step 5 규칙을 적용하고(89·184·344·428·531·652 의 `canonicalRequest`, 100·207·359·466·548·664 의 단언, 304 의 응답), 추가로:
- `bulkCartScan` 의 배정 합계 쿼리(103-127)를 계획 구성원 조인에서 작업 항목 조인으로:

```ts
      .from(wmsTables.pickingSourceAllocations)
      .innerJoin(
        wmsTables.outboundBatchWorkItems,
        eq(wmsTables.outboundBatchWorkItems.id, wmsTables.pickingSourceAllocations.workItemId),
      )
      .innerJoin(
        wmsTables.shipmentLines,
        eq(wmsTables.shipmentLines.id, wmsTables.pickingSourceAllocations.shipmentLineId),
      )
      .where(
        and(
          eq(wmsTables.outboundBatchWorkItems.batchId, input.batchId),
          notInArray(wmsTables.outboundBatchWorkItems.status, ['completed', 'excluded']),
          eq(wmsTables.pickingSourceAllocations.sourceLocationId, input.sourceLocationId),
          eq(wmsTables.shipmentLines.skuId, input.skuId),
        ),
      )
```

- `loadLineAllocations(planId, shipmentLineId, tx)` → `loadLineAllocations(workItemId, shipmentLineId, tx)`, 조건 `eq(wmsTables.pickingSourceAllocations.workItemId, workItemId)`, 에러 코드 `PICKING_SHIPMENT_LINE_NOT_IN_PLAN` → `PICKING_SHIPMENT_LINE_NOT_ALLOCATED`. `sortScan` 호출부는 `input.workItemId` 를 넘긴다
- `cartHandoff`·`handoff` 는 배치/세션 단언만

- [ ] **Step 8: 진입 서비스 래퍼**

`picking-process.service.ts`:
- `withPlanStrategy(batchId, planId, …)` → `withBatchStrategy(batchId, …)`: `loadBatchIdentity(batchId)` 로 전략을 얻어 `registry.resolveForWarehouse` 로 객체를 꺼낸다
- `withAggregateThenSortStrategy`·`withPickToToteStrategy` 에서 `planId` 매개변수 삭제, 내부의 `loadPlanIdentity` → `loadBatchIdentity`. 에러 코드 `PICKING_PLAN_STRATEGY_MISMATCH` → `PICKING_BATCH_STRATEGY_MISMATCH`
- `loadPlanIdentity` 삭제
- 확인: `grep -n "planId\|pickingPlans" apps/core/src/modules/fulfillment/services/picking-process.service.ts` → 0 줄

- [ ] **Step 9: HTTP DTO·컨트롤러**

- `dto/picking-v2.dto.ts`: `planId` 필드 전부 삭제(32·39·64·86·103·128·167 부근)
- `dto/tote.dto.ts`: `AssignToteDto.planId`(19) 삭제
- 컨트롤러는 DTO 를 펼쳐 넘기므로 코드 변경 없음을 확인한다: `grep -n "planId" apps/core/src/modules/fulfillment/controllers/*.ts` → 0 줄

- [ ] **Step 10: 스펙 정리**

`npx jest apps/core/src/modules/fulfillment/picking apps/core/src/modules/fulfillment/controllers --maxWorkers=2` 의 실패를 다음 규칙으로 고친다:
- 입력 fixture 의 `planId` 삭제
- `pickingPlans`/`pickingPlanMembers` 를 흉내 내던 가짜 응답 → 배치 행(`{ pickingMethod, startedAt }`)과 세션 행으로
- `PICKING_PLAN_NOT_ACTIVE`·`PICKING_SHIPMENT_NOT_IN_PLAN` 기대 → `PICKING_BATCH_NOT_STARTED`·`PICKING_WORK_ITEM_NOT_ALLOCATED`
- `picking-strategy.contract.spec.ts` 에서 «세 전략이 같은 계획 절차를 쓴다»류 테스트가 남아 있으면 삭제(ADR-0030 이 이미 «검증 대상이 사라진다»고 적었다)
- `POST picking/v2/plans` 컨트롤러 테스트 삭제

- [ ] **Step 11: 게이트·커밋**

Run: `npm run type-check && npx jest --maxWorkers=2`
Expected: 에러 0, 실패 0

```bash
git add -A apps/core/src/modules/fulfillment
git commit -m "refactor(fulfillment): 피킹 전략과 HTTP 에서 계획 신원을 걷어낸다"
```

---

### Task 5: 준비·단순출고·위치별 출고

**Files:**
- Modify: `services/outbound-preparation.locks.ts`
- Modify: `services/simple-outbound.service.ts`
- Modify: `services/location-outbound.service.ts`
- Delete: `services/outbound-preparation-policy.ts`, `services/outbound-preparation-policy.spec.ts`
- Modify: `services/__support__/outbound-preparation-cleanup.ts`

**Interfaces:**
- Produces:
  - `isBatchStarted(batchId: string, tx: DbTx): Promise<boolean>` (`outbound-preparation.locks.ts`)
  - `activePreparationSession(batchId: string, tx: DbTx): Promise<string | null>`
  - `SimpleOutboundContext` 에서 `planId` 삭제: `{ batchId, workItemId, shipmentId, sessionId, leaseVersion }`
- Consumes: `PickingProcessService.start`(Task 3), `loadWorkItemAllocations` 의 조건 형태(Task 4)

- [ ] **Step 1: 준비 잠금 헬퍼**

`outbound-preparation.locks.ts`:
- `preparationShipmentIds` 의 계획 구성원 조회(`stored`)를 지우고 작업 항목만 반환한다:

```ts
async function preparationShipmentIds(batchId: string, tx: DbTx): Promise<string[]> {
  const items = await tx
    .select({ shipmentId: wmsTables.outboundBatchWorkItems.shipmentId })
    .from(wmsTables.outboundBatchWorkItems)
    .where(
      and(
        eq(wmsTables.outboundBatchWorkItems.batchId, batchId),
        inArray(wmsTables.outboundBatchWorkItems.status, [
          'queued',
          'picking',
          'ready_to_pack',
          'packing',
          'short_pick_recovery',
        ]),
      ),
    );
  return [...new Set(items.map((row) => row.shipmentId))].sort();
}
```

- `readPreparationPlan` 을 다음으로 교체:

```ts
/** 잠금 없는 읽기. 시작은 한 번만 일어나므로(`startedAt` 단조) 읽은 값이 뒤집히지 않는다. */
export async function isBatchStarted(batchId: string, tx: DbTx): Promise<boolean> {
  const [batch] = await tx
    .select({ startedAt: wmsTables.outboundBatches.startedAt })
    .from(wmsTables.outboundBatches)
    .where(eq(wmsTables.outboundBatches.id, batchId))
    .limit(1);
  return Boolean(batch?.startedAt);
}
```

- `activePreparationSession(batchId, planId, tx)` → `activePreparationSession(batchId, tx)`: 세션이 정확히 하나이고 `active` 이면 그 id, 아니면 null. HAND_IN `planId` 검사 블록 삭제
- `isNull`·`pickingPlans` import 가 남지 않게 정리

- [ ] **Step 2: 단순출고 `prepare` 재작성** (Task 3 Step 6 에서 이미 했다면 이 Step 은 확인만)

`simple-outbound.service.ts` 의 `prepare` 를 다음으로 교체한다. 재계획 분기(`started.state === 'invalidated'`)와 `canReplaceDraft`·`PreparationAttemptBlocked`·`preparationExecutionFacts` 호출이 사라진다 — 초안 계획이 없어서 대체할 대상도 없다.

```ts
  async prepare(
    shipmentId: string,
    actor: SimpleOutboundActor,
    idempotencyKey: OutboundCommandKey,
    tx: DbTx,
  ): Promise<OutboundPreparationResult> {
    this.workflowGate.assertV2MutationAllowed('shipment.simple_outbound.prepare');
    if (!actor?.id) throw new UnauthorizedException('Authenticated actor is required');
    const initial = await this.loadWorkItem(shipmentId, tx);
    await this.assertBatchMethodSupported(initial.batchId, tx);
    if (await isBatchStarted(initial.batchId, tx)) {
      // 시작된 배치: 작업 항목 → 세션 순서를 지킨다. 구성 요소 잠금은 시작 전에만 잡는다.
      const [workItem] = await tx
        .select()
        .from(wmsTables.outboundBatchWorkItems)
        .where(eq(wmsTables.outboundBatchWorkItems.id, initial.id))
        .for('update');
      if (
        !workItem ||
        workItem.batchId !== initial.batchId ||
        !(PICKABLE_WORK_ITEM_STATUSES as readonly string[]).includes(workItem.status)
      )
        throw this.conflict('PICKING_COMPONENT_CHANGED_RETRY', 'Active preparation changed while acquiring work item');
      const sessionId = await activePreparationSession(workItem.batchId, tx);
      if (!sessionId) return preparationBlocked(workItem.batchId, null, 'ACTIVE_WORK_REQUIRES_REVIEW');
      return this.claimPrepared(workItem, sessionId, actor, idempotencyKey, tx);
    }
    try {
      await lockPreparation(initial.batchId, this.invariant, tx);
    } catch (error) {
      const blocked = this.preparationFailure(error, initial.batchId);
      if (blocked) return blocked;
      throw error;
    }
    const workItem = await this.loadWorkItem(shipmentId, tx);
    await this.assertBatchMethodSupported(workItem.batchId, tx);
    if (workItem.batchId !== initial.batchId)
      throw this.conflict('PICKING_COMPONENT_CHANGED_RETRY', 'Shipment batch changed');
    let started: PickingStartResult;
    try {
      // 시작이 실패하면 중첩 명령의 pending 행까지 되돌린다.
      started = await tx.transaction((trx) =>
        this.picking.start(
          {
            batchId: workItem.batchId,
            actorId: actor.id,
            idempotencyKey: nestedCommandKey(idempotencyKey, 'start'),
          },
          trx,
        ),
      );
    } catch (error) {
      const blocked = this.preparationFailure(error, workItem.batchId);
      if (blocked) return blocked;
      throw error;
    }
    if (started.status !== 'active') return preparationBlocked(workItem.batchId, null, 'ACTIVE_WORK_REQUIRES_REVIEW');
    const current = await this.loadWorkItem(shipmentId, tx);
    return this.claimPrepared(current, started.sessionId, actor, idempotencyKey, tx);
  }
```

- `claimPrepared(workItem, planId, sessionId, …)` → `claimPrepared(workItem, sessionId, …)`, 반환 context 에서 `planId` 삭제
- `preparationFailure(error, batchId, planId)` → `preparationFailure(error, batchId)`, 안에서 `preparationBlocked(batchId, null, …)`
- `ensurePlan` 메서드·`PLAN_MEMBER_WORK_ITEM_STATUSES` 상수·`PreparationAttemptBlocked` 클래스·`canReplaceDraft` import 삭제
- `preparationExecutionFacts` 는 다른 사용처를 `grep -rn "preparationExecutionFacts" apps/core/src` 로 보고, 없으면 `outbound-preparation.locks.ts` 에서도 삭제

- [ ] **Step 3: 단순출고의 나머지 `planId`**

- `pickScanned` 배정 조회: `eq(wmsTables.pickingSourceAllocations.planId, context.planId)` → `eq(wmsTables.pickingSourceAllocations.workItemId, context.workItemId)`. `eq(wmsTables.shipmentLines.shipmentId, …)` 조건은 남긴다
- `forcePickRemaining` 배정 조회: 같은 규칙
- `picking.scan`·`picking.completePick` 호출 인자의 `planId: context.planId` 삭제(`completeAndForceDispatch`·`forcePickRemaining`·`pickScanned`·`settleIfFullyPicked`)
- 확인: `grep -n "planId\|pickingPlans" apps/core/src/modules/fulfillment/services/simple-outbound.service.ts` → 0 줄

- [ ] **Step 4: 위치별 출고**

`location-outbound.service.ts`:
- `ReadContext` 에서 `planId` 를 지우고 `started: boolean` 을 더한다
- `getState` 의 계획 조회(120-131)를 `const started = await isBatchStarted(workItem.batchId, trx);` 로 바꾸고 context 에 `started` 를 싣는다
- `loadState` 의 배정 조회 조건 `context.planId` 분기를 `context.started && context.workItemId` 로, 조건 `eq(wmsTables.pickingSourceAllocations.planId, context.planId)` → `eq(wmsTables.pickingSourceAllocations.workItemId, context.workItemId)`
- 확인: `grep -n "planId\|pickingPlans" apps/core/src/modules/fulfillment/services/location-outbound.service.ts` → 0 줄

- [ ] **Step 5: 정책 파일 삭제·정리 헬퍼**

```bash
git rm apps/core/src/modules/fulfillment/services/outbound-preparation-policy.ts apps/core/src/modules/fulfillment/services/outbound-preparation-policy.spec.ts
```

`__support__/outbound-preparation-cleanup.ts`:
- 계획 조회(19)·`resourceIds` 에 계획 id 추가(30)를 지운다
- 배정 삭제(71-85)를 작업 항목 기준으로 바꾸고 계획·구성원 삭제는 지운다:

```ts
  const workItemIds = (
    await tx
      .select({ id: wmsTables.outboundBatchWorkItems.id })
      .from(wmsTables.outboundBatchWorkItems)
      .where(eq(wmsTables.outboundBatchWorkItems.batchId, batchId))
  ).map((row) => row.id);
  if (workItemIds.length) {
    await tx
      .delete(wmsTables.pickingSourceAllocations)
      .where(inArray(wmsTables.pickingSourceAllocations.workItemId, workItemIds));
  }
```

이 삭제는 작업 항목 삭제보다 **앞**에 와야 한다(FK restrict). 파일 안의 삭제 순서를 확인한다.

- [ ] **Step 6: 게이트·커밋**

Run: `npm run type-check && npx jest apps/core/src/modules/fulfillment --maxWorkers=2`
Expected: 에러 0, 실패 0

```bash
git add -A apps/core/src/modules/fulfillment
git commit -m "refactor(fulfillment): 출고 준비를 계획 없이 배치 시작으로 돌린다"
```

---

### Task 6: 발송

**Files:**
- Modify: `services/shipment-dispatch.service.ts`
- Modify: `services/shipment-dispatch.service.spec.ts`

**Interfaces:**
- Produces: `LockedDispatchAggregate` 에서 `planId` 삭제. 배정은 `aggregate.workItem.id` 로 읽는다

- [ ] **Step 1: `lockAggregate` 에서 계획 신원 제거**

`shipment-dispatch.service.ts` `lockAggregate`:
- HAND_IN 에서 `planId` 를 읽는 블록(441-452)을 지운다
- 계획 잠금(486-498)과 구성원 조회·버전 비교(499-516)를 지운다. 버전 스냅샷의 몫은 이미 `dispatchLocked` 의 세 검사가 대신한다: 줄별 배정 합 = 줄 수량(`SHIPMENT_DISPATCH_ALLOCATION_MISMATCH`), 송장 `manifestVersion`·`recipientHash` 일치(`assertDispatchable`), 예약 소진. 이 사실을 지운 자리에 주석 한 줄로 남긴다:

```ts
    // 옛 «계획 구성원 버전 스냅샷» 검사는 없다: 배정 합 = 줄 수량(dispatchLocked), 송장 manifestVersion
    // 일치(assertDispatchable), 예약 소진이 박스가 시작 뒤 바뀌지 않았음을 함께 증명한다(ADR-0041).
```

- 잠근 뒤 HAND_IN 계획 id 집합 비교(526-538)를 지운다. 세션 신원은 `session.batchId !== workItem.batchId` 검사(이미 있음)가 맡는다
- 반환에서 `planId` 삭제, `LockedDispatchAggregate.planId` 필드 삭제

- [ ] **Step 2: `dispatchLocked` 배정 조회**

`eq(wmsTables.pickingSourceAllocations.planId, aggregate.planId)` → `eq(wmsTables.pickingSourceAllocations.workItemId, aggregate.workItem.id)`. 감사 메타데이터의 `lineage.planId`(924-925) → `lineage.workItemId: aggregate.workItem.id`.

확인: `grep -n "planId\|pickingPlan" apps/core/src/modules/fulfillment/services/shipment-dispatch.service.ts` → 0 줄

- [ ] **Step 3: 단위 스펙**

`shipment-dispatch.service.spec.ts` 의 `planId`·계획 행 fixture 를 지운다.

Run: `npm run type-check && npx jest apps/core/src/modules/fulfillment/services/shipment-dispatch.service.spec.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add -A apps/core/src/modules/fulfillment/services
git commit -m "refactor(fulfillment): 발송이 작업 항목 배정으로 박스를 확인한다"
```

---

### Task 7: 결품·계획 서비스·합포장·배치 오케스트레이터

**Files:**
- Modify: `services/shipment-short-pick.service.ts`, `dto/shipment-short-pick.dto.ts`
- Modify: `services/shipment-planning.service.ts`
- Modify: `services/consolidation.service.ts`
- Modify: `services/outbound-batch-orchestrator.service.ts`, `dto/outbound-batch-v2.dto.ts`
- Test: `services/shipment-short-pick.service.spec.ts`, `controllers/shipment-short-pick.controller.spec.ts`, `services/outbound-batch-orchestrator.service.spec.ts`

**Interfaces:**
- Produces:
  - `ReportShipmentShortPickDto` 에서 `planId`·`expectedPlanVersion` 삭제
  - 오케스트레이터 에러 `OUTBOUND_BATCH_ALREADY_STARTED`(시작된 배치에 추가), `WORK_ITEM_ALLOCATED`(배정 있는 작업 항목 제외)
  - `OutboundBatchV2DetailDto.picking: BatchPickingSnapshotDto | null` (옛 `pickingPlan` 대체)

```ts
export class BatchPickingAllocationDto {
  id: string;
  workItemId: string;
  shipmentLineId: string;
  sourceLocationId: string;
  qty: number;
  sourceStockVersion: number;
  createdAt: Date;
}

export class BatchPickingSnapshotDto {
  @ApiProperty({ enum: ['discrete', 'aggregate_then_sort', 'pick_to_tote'] })
  strategy: 'discrete' | 'aggregate_then_sort' | 'pick_to_tote';
  startedAt: Date;
  @ApiProperty({ type: [BatchPickingAllocationDto] })
  allocations: BatchPickingAllocationDto[];
}
```

- [ ] **Step 1: (테스트 위치 안내)**

「시작된 배치에 박스 추가 거절」은 `addShipment` 의 잠금 사슬 전체가 필요해 가짜 trx 로는 과하다. 그 테스트는 Task 9 의 `batch-start.integration.spec.ts` 에 있다(`OUTBOUND_BATCH_ALREADY_STARTED`). 이 Task 는 단위 스펙의 기존 기대만 고친다(Step 5).

- [ ] **Step 2: 오케스트레이터 수정**

- `addShipment`: `const batch = await this.lockOpenBatch(batchId, trx);` 바로 뒤에

```ts
        if (batch.startedAt) {
          throw this.conflict(
            'OUTBOUND_BATCH_ALREADY_STARTED',
            `Batch ${batchId} has started picking; joining a running batch arrives with live allocation (S1-B)`,
          );
        }
```

(`this.conflict` 가 없으면 파일의 기존 409 헬퍼 이름을 쓴다: `grep -n "private conflict\|ConflictException(" apps/core/src/modules/fulfillment/services/outbound-batch-orchestrator.service.ts`)

- 클래스에 private 헬퍼를 더한다 — «이 박스의 활성 작업 항목이 배정을 쥐고 있나»:

```ts
  /** 활성 작업 항목(완료·제외 아님)에 남은 배정. 옛 «활성 계획 구성원» 검사의 자리다(ADR-0041). */
  private liveAllocation(shipmentId: string, tx: DbTx) {
    return tx
      .select({ id: wmsTables.pickingSourceAllocations.id })
      .from(wmsTables.pickingSourceAllocations)
      .innerJoin(
        wmsTables.outboundBatchWorkItems,
        eq(wmsTables.outboundBatchWorkItems.id, wmsTables.pickingSourceAllocations.workItemId),
      )
      .where(
        and(
          eq(wmsTables.outboundBatchWorkItems.shipmentId, shipmentId),
          notInArray(wmsTables.outboundBatchWorkItems.status, ['completed', 'excluded']),
          gt(wmsTables.pickingSourceAllocations.qty, 0),
        ),
      )
      .limit(1);
  }
```

- `assertExcludable` 의 `Promise.all` 세 번째 원소(계획 구성원 조회, 1041-1051)를 `this.liveAllocation(aggregate.shipment.id, tx)` 로 바꾸고, 구조분해 이름 `plan` → `allocated`, 그 결과로 던지는 부분(`WORK_ITEM_PICKING_PLAN_ACTIVE`, 1078-1080)을:

```ts
    if (allocated.length) {
      throw this.conflict('WORK_ITEM_ALLOCATED', 'Work item holds picking allocations; use short-pick recovery');
    }
```

  (기존 코드가 `if (plan.length)` 대신 `if (plan[0])` 꼴이면 같은 꼴을 따른다.)

- `resumeWaitingOperationIfReady` 의 cancel 분기 `Promise.all` 첫 원소(계획 구성원 조회, 1103-1114)를 `this.liveAllocation(shipmentId, trx)` 로 바꾸고 이름 `plan` → `allocated`. 뒤따르는 «있으면 조용히 반환» 조건의 변수 이름도 바꾼다

- `getBatch`: 계획 조회와 구성원·배정 조회를 지우고, 배치가 시작됐으면 배치 작업 항목의 배정을 읽는다:

```ts
      const allocations = batch.startedAt
        ? await trx
            .select({ allocation: wmsTables.pickingSourceAllocations })
            .from(wmsTables.pickingSourceAllocations)
            .innerJoin(
              wmsTables.outboundBatchWorkItems,
              eq(wmsTables.outboundBatchWorkItems.id, wmsTables.pickingSourceAllocations.workItemId),
            )
            .where(eq(wmsTables.outboundBatchWorkItems.batchId, batchId))
            .orderBy(
              asc(wmsTables.pickingSourceAllocations.shipmentLineId),
              asc(wmsTables.pickingSourceAllocations.sourceLocationId),
            )
        : [];
```

응답의 `pickingPlan: …` 을

```ts
        picking: batch.startedAt
          ? {
              strategy: STRATEGY_BY_PICKING_METHOD[batch.pickingMethod],
              startedAt: batch.startedAt,
              allocations: allocations.map(({ allocation }) => ({
                id: allocation.id,
                workItemId: allocation.workItemId!,
                shipmentLineId: allocation.shipmentLineId,
                sourceLocationId: allocation.sourceLocationId,
                qty: allocation.qty,
                sourceStockVersion: allocation.sourceStockVersion,
                createdAt: allocation.createdAt,
              })),
            }
          : null,
```

로 바꾸고, `dto/outbound-batch-v2.dto.ts` 의 `pickingPlan` 필드를 위 `BatchPickingSnapshotDto` 두 클래스와 `@ApiProperty({ type: BatchPickingSnapshotDto, nullable: true }) picking: BatchPickingSnapshotDto | null;` 로 교체한다. `workItemId!` 의 `!` 는 PR 1 동안 컬럼이 nullable 이라서이며, 시작된 배치의 배정은 전부 `startBatchPicking` 이 `workItemId` 로 넣었다는 사실이 근거다 — 그 근거를 한 줄 주석으로 단다. PR 2 에서 NOT NULL 이 되면 `!` 를 지운다.

- 확인: `grep -n "pickingPlan\|planId" apps/core/src/modules/fulfillment/services/outbound-batch-orchestrator.service.ts` → 0 줄

- [ ] **Step 3: 계획 서비스·합포장**

`shipment-planning.service.ts`:
- `retirePickingPlanMemberForShortPick` 메서드와 타입 `RetirePickingPlanMemberForShortPickInput`·`RetiredPickingPlanMember` 삭제
- `assertNoActivePickingPlan` 메서드와 두 호출(`plan()` 611 부근, `resumePendingCancellation` 868-870 부근) 삭제 — 같은 자리의 `assertNoCustodyOrActiveWork` 가 활성 작업 항목을 이미 막고, 배정은 활성 작업 항목에만 생긴다
- `requiresDurableReplan` 의 계획 구성원 조건(1650-1660) 삭제 — 바로 위 «활성 작업 항목» 조건이 같은 경우를 덮는다
- 확인: `grep -n "pickingPlan\|planId" apps/core/src/modules/fulfillment/services/shipment-planning.service.ts` → 0 줄

`consolidation.service.ts` `loadBlockers`: 계획 조건(1038-1049)과 `'ACTIVE_PICKING_PLAN'` 푸시(1066) 삭제. `ACTIVE_WORK_ITEM` 조건이 같은 경우를 덮는다. `'ACTIVE_PICKING_PLAN'` 이 타입 유니온에 있으면 그 값도 지운다.

- [ ] **Step 4: 결품**

`dto/shipment-short-pick.dto.ts`: `planId`·`expectedPlanVersion` 필드 삭제.

`shipment-short-pick.service.ts`:
- `ShortPickIntent.planId` 삭제. `report()` 의 `planId: dto.planId,` 삭제
- `ShortPickPlanningPort`·생성자의 `planning` 주입 삭제(모듈 providers 는 그대로 — `ShipmentPlanningService` 는 다른 곳이 쓴다)
- `lockAndValidateShipment` 배정 조건 `eq(wmsTables.pickingSourceAllocations.planId, dto.planId)` → `eq(wmsTables.pickingSourceAllocations.workItemId, dto.workItemId)`
- `lockAndValidatePhysical`: 계획 조회·검사, 구성원 조회, HAND_IN 계획 비교를 지운다. 세션 검사(`session.batchId === workItem.batchId` 등)는 남긴다. 반환 `{ workItem, plan, session }` → `{ workItem, session }`
- 스냅샷의 `plan: context.plan,` 삭제. 감사의 `plan: dto.expectedPlanVersion,` 삭제
- `resumePendingInTransaction`: 계획 잠금(371-377)과 `this.planning.retirePickingPlanMemberForShortPick(…)` 호출(386-389) 삭제. 작업 항목이 `excluded` 가 되는 것이 곧 «이 박스가 배치를 떠났다»다
- 이 파일의 intent 파서(`private intent(snapshot)`)가 `planId` 를 요구하면 그 조건을 지우고 `workItemId` 를 요구한다
- 확인: `grep -n "planId\|pickingPlan\|expectedPlanVersion" apps/core/src/modules/fulfillment/services/shipment-short-pick.service.ts apps/core/src/modules/fulfillment/dto/shipment-short-pick.dto.ts` → 0 줄

- [ ] **Step 5: 단위 스펙**

Run: `npx jest apps/core/src/modules/fulfillment --maxWorkers=2`
실패를 고친다: fixture 의 `planId`·`expectedPlanVersion` 삭제, `retirePickingPlanMemberForShortPick` mock 삭제, `WORK_ITEM_PICKING_PLAN_ACTIVE` 기대 → `WORK_ITEM_ALLOCATED`.

- [ ] **Step 6: 게이트·커밋**

Run: `npm run type-check && npx jest --maxWorkers=2`
Expected: 에러 0, 실패 0

```bash
git add -A apps/core/src/modules/fulfillment
git commit -m "refactor(fulfillment): 결품·취소·합포장·배치에서 계획 구성원을 걷어낸다"
```

---

### Task 8: 세션 복구

**Files:**
- Modify: `services/batch-session-recovery.service.ts`
- Test: `services/batch-session-recovery.service.spec.ts`(있으면), 통합은 Task 9

**Interfaces:**
- Consumes: `handInRequestHash`(Task 3)
- Produces: `ReplayResult` 에서 `planId` 삭제

- [ ] **Step 1: 잠금·재생**

- `lockPlanThenSession` 을 지우고 두 호출을 `this.lockSession(sessionId, trx)` 로. `rebuildFromEvents` 의 순서 주석은 «session → balances → 정렬된 재고 잠금»으로 고친다
- `replay()` 의 HAND_IN 분기를 다음으로:

```ts
      if (event.eventType === 'HAND_IN') {
        if (from || !to || to.custodyType !== 'AT_SOURCE') issues.push(`HAND_IN event ${event.id} has invalid sides`);
        if (
          payload.batchId !== session.batchId ||
          typeof payload.workItemId !== 'string' ||
          typeof payload.allocationId !== 'string'
        ) {
          issues.push(`HAND_IN event ${event.id} has no immutable batch/work item/allocation identity`);
        }
        handedInQty += event.quantity;
      }
```

- `let planId`·`ReplayResult.planId`·반환의 `planId` 삭제
- `rebuildFromEvents` 의 `if (replay.planId) { … pickingPlans … }` 블록 삭제, 감사 메타데이터 `planId: replay.planId` → `batchId: session.batchId`

- [ ] **Step 2: 배정 대조**

`validatePersistedPlan` 을 `validatePersistedAllocations` 로 이름을 바꾸고:
- 앞부분(계획 존재·배치 일치)을 지운다
- 배정 조회를 배치의 작업 항목 기준으로, `workItemId` 를 함께 읽는다:

```ts
    const allocations = await tx
      .select({
        id: wmsTables.pickingSourceAllocations.id,
        workItemId: wmsTables.pickingSourceAllocations.workItemId,
        shipmentLineId: wmsTables.pickingSourceAllocations.shipmentLineId,
        sourceLocationId: wmsTables.pickingSourceAllocations.sourceLocationId,
        quantity: wmsTables.pickingSourceAllocations.qty,
        sourceStockVersion: wmsTables.pickingSourceAllocations.sourceStockVersion,
        skuId: wmsTables.shipmentLines.skuId,
      })
      .from(wmsTables.pickingSourceAllocations)
      .innerJoin(
        wmsTables.outboundBatchWorkItems,
        eq(wmsTables.outboundBatchWorkItems.id, wmsTables.pickingSourceAllocations.workItemId),
      )
      .innerJoin(
        wmsTables.shipmentLines,
        eq(wmsTables.shipmentLines.id, wmsTables.pickingSourceAllocations.shipmentLineId),
      )
      .where(eq(wmsTables.outboundBatchWorkItems.batchId, session.batchId));
```

- HAND_IN 대조 조건에서 `payload.planId !== replay.planId` → `payload.batchId !== session.batchId || payload.workItemId !== allocation.workItemId`
- 해시 재계산:

```ts
        expectedHash = handInRequestHash(session.batchId, {
          id: allocation.id,
          workItemId: allocation.workItemId!,
          shipmentLineId: allocation.shipmentLineId,
          skuId: allocation.skuId,
          sourceLocationId: allocation.sourceLocationId,
          quantity: allocation.quantity,
          sourceStockVersion: allocation.sourceStockVersion,
        });
```

(`!` 근거: 조회가 `workItemId` 로 조인했으므로 NULL 일 수 없다 — 주석 한 줄)

- 결품 이벤트의 배정 찾기(`allocations.find(… shipmentLineId && sourceLocationId)`)는 intent 의 작업 항목까지 맞춘다: 그 블록에서 `intent` 를 파싱한 뒤 `allocation.workItemId === intent.workItemId` 조건을 더한다(순서상 intent 파싱이 뒤에 있으면 find 를 intent 파싱 뒤로 옮긴다)
- 메시지 «outside the session plan» → «outside the session batch allocations», «persisted plan allocations» → «persisted batch allocations»
- 두 호출부의 메서드 이름을 바꾼다
- 확인: `grep -n "planId\|pickingPlan" apps/core/src/modules/fulfillment/services/batch-session-recovery.service.ts` → 0 줄

- [ ] **Step 3: 게이트·커밋**

Run: `npm run type-check && npx jest apps/core/src/modules/fulfillment --maxWorkers=2`
Expected: 에러 0, 실패 0

```bash
git add -A apps/core/src/modules/fulfillment/services
git commit -m "refactor(fulfillment): 세션 복구가 배치·작업 항목 신원으로 이벤트를 대조한다"
```

---

### Task 9: 통합 스펙 이관과 새 통합 스펙

**Files:**
- Modify: 계획을 쓰는 통합 스펙 전부(도출: `grep -rlE "planId|\.plan\(|pickingPlans|pickingPlanMembers|expectedPlanVersion" apps/core/src --include=*.integration.spec.ts`)
- Modify: `apps/core/src/modules/fulfillment/services/__support__/simple-outbound-wiring.ts`, `simple-outbound-fixtures.ts`, `outbound-preparation-cleanup.ts`(, `logistics-fixtures.ts` export)
- Create: `apps/core/src/modules/fulfillment/picking/allocation/batch-start.integration.spec.ts`
- Modify: `apps/core/src/modules/fulfillment/services/outbound-preparation.concurrency.integration.spec.ts`

- [ ] **Step 1: 테스트 지원 코드 — 조립기·두 박스 픽스처·정리 확장**

(a) `services/__support__/simple-outbound-wiring.ts` 의 `assembleOutboundWithDb` 반환에 두 개를 더한다(`BatchSessionRecoveryService` import 추가):

```ts
  return {
    simple,
    picking,
    batches,
    sessions,
    recovery: new BatchSessionRecoveryService(dbService, audit, controlled),
    location: new LocationOutboundService(dbService, commands, simple),
  };
```

(b) `services/__support__/simple-outbound-fixtures.ts` 에 두 박스 픽스처를 더한다:

```ts
import { and, eq } from 'drizzle-orm';
import { DbTx, wmsTables } from '../../../inventory/schema/inventory.schema';
import { PickableShipmentFixture, seedPickableShipment, seedShipmentForExistingStock } from './logistics-fixtures';

/**
 * 같은 배치·같은 SKU·같은 위치에 박스 두 개. 두 번째 박스는 첫 박스의 재고 위에 만들고 작업 항목을
 * 첫 배치로 옮긴다(seedShipmentForExistingStock 은 박스마다 배치를 새로 만든다 — 그 빈 배치는 정리 때 지운다).
 */
export async function seedTwoBoxBatch(
  tx: DbTx,
  secondQty = 3,
  stockQty = 5,
): Promise<{ first: PickableShipmentFixture; second: PickableShipmentFixture }> {
  const first = await seedPickableShipment(tx, 2);
  await tx
    .update(wmsTables.stockLedgers)
    .set({ qty: stockQty })
    .where(and(eq(wmsTables.stockLedgers.skuId, first.skuId), eq(wmsTables.stockLedgers.locationId, first.locationId)));
  const [profile] = await tx
    .select({ id: wmsTables.shipments.shippingProfileId })
    .from(wmsTables.shipments)
    .where(eq(wmsTables.shipments.id, first.shipmentId));
  if (!profile?.id) throw new Error('first box has no shipping profile');
  const second = await seedShipmentForExistingStock(
    tx,
    {
      actorId: first.actorId,
      warehouseId: first.warehouseId,
      holderId: first.holderId,
      skuId: first.skuId,
      skuCode: first.skuCode,
      barcode: first.barcode,
      locationId: first.locationId,
      ledgerVersion: first.ledgerVersion,
      deliveryProfileId: profile.id,
    },
    secondQty,
  );
  await tx
    .update(wmsTables.outboundBatchWorkItems)
    .set({ batchId: first.batchId })
    .where(eq(wmsTables.outboundBatchWorkItems.id, second.workItemId));
  return { first, second };
}
```

(`PickableShipmentFixture`·`seedShipmentForExistingStock` 가 `logistics-fixtures.ts` 에서 export 되지 않으면 export 를 더한다.)

(c) `services/__support__/outbound-preparation-cleanup.ts` — 두 박스 픽스처를 정리할 수 있게 `extras` 를 받는다. 시그니처를 `cleanupPreparationFixture(tx, f, extras: PickableShipmentFixture[] = [])` 로 바꾸고:
- `resourceIds` 에 `...extras.flatMap((extra) => [extra.shipmentId, extra.batchId, extra.workItemId])` 를 더한다
- `await tx.delete(wmsTables.outboundBatches).where(eq(wmsTables.outboundBatches.id, f.batchId));` **바로 뒤**에 `for (const extra of extras) await deleteExtraBox(tx, extra);` 를 넣는다(첫 박스의 세션·배정·작업 항목이 이미 지워졌고, SKU·위치·창고는 아직 남은 시점)
- 파일 하단에:

```ts
async function deleteExtraBox(tx: DbTx, extra: PickableShipmentFixture): Promise<void> {
  const [line] = await tx
    .select({ fulfillmentOrderItemId: wmsTables.shipmentLines.fulfillmentOrderItemId })
    .from(wmsTables.shipmentLines)
    .where(eq(wmsTables.shipmentLines.id, extra.shipmentLineId));
  const [item] = line
    ? await tx
        .select()
        .from(wmsTables.fulfillmentOrderItems)
        .where(eq(wmsTables.fulfillmentOrderItems.id, line.fulfillmentOrderItemId))
    : [];
  await tx.delete(wmsTables.outboundBatchWorkItems).where(eq(wmsTables.outboundBatchWorkItems.batchId, extra.batchId));
  await tx.delete(wmsTables.outboundBatches).where(eq(wmsTables.outboundBatches.id, extra.batchId));
  await tx.delete(wmsTables.stockReservations).where(eq(wmsTables.stockReservations.shipmentLineId, extra.shipmentLineId));
  await tx.delete(wmsTables.waybills).where(eq(wmsTables.waybills.shipmentId, extra.shipmentId));
  await tx.delete(wmsTables.shipmentLines).where(eq(wmsTables.shipmentLines.id, extra.shipmentLineId));
  await tx.delete(wmsTables.shipments).where(eq(wmsTables.shipments.id, extra.shipmentId));
  if (item?.salesOrderId && item.salesOrderLineId) {
    await tx.delete(wmsTables.fulfillmentOrderItems).where(eq(wmsTables.fulfillmentOrderItems.id, item.id));
    await tx.delete(wmsTables.fulfillmentOrders).where(eq(wmsTables.fulfillmentOrders.id, item.fulfillmentOrderId));
    await tx.delete(wmsTables.salesOrderLines).where(eq(wmsTables.salesOrderLines.id, item.salesOrderLineId));
    await tx.delete(wmsTables.salesOrders).where(eq(wmsTables.salesOrders.id, item.salesOrderId));
  }
}
```

- 첫 박스의 FOI 조회 `const [item] = … where skuId` 는 같은 SKU 에 FOI 가 둘이면 아무거나 집는다. `where(eq(wmsTables.fulfillmentOrderItems.id, <첫 박스 줄의 fulfillmentOrderItemId>))` 로 좁힌다 — `deleteExtraBox` 의 두 줄 조회와 같은 방식

- [ ] **Step 2: 새 통합 스펙 — 배치 시작**

`apps/core/src/modules/fulfillment/picking/allocation/batch-start.integration.spec.ts`:

```ts
import { randomUUID } from 'crypto';
import { and, eq, sql as rawSql } from 'drizzle-orm';
import { wmsTables } from '../../../inventory/schema/inventory.schema';
import { inRollbackTx, makeDb, seedShipmentForExistingStock } from '../../services/__support__';
import { seedTwoBoxBatch } from '../../services/__support__/simple-outbound-fixtures';
import { assembleOutbound } from '../../services/__support__/simple-outbound-wiring';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('배치 시작 (startBatchPicking)', () => {
  const { sql, db } = makeDb(DATABASE_URL as string);
  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  it('queued 박스 전부를 작업 항목 키로 배정하고 HAND_IN payload 에 배치·작업 항목·배정 신원을 싣는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { first, second } = await seedTwoBoxBatch(tx);
      const { picking } = assembleOutbound(tx);

      const started = await picking.start({ batchId: first.batchId, actorId: first.actorId, idempotencyKey: `s-${randomUUID()}` }, tx);

      const allocations = await tx.select().from(wmsTables.pickingSourceAllocations).where(
        rawSql`${wmsTables.pickingSourceAllocations.workItemId} IN (${first.workItemId}::uuid, ${second.workItemId}::uuid)`,
      );
      expect(allocations.map((row) => [row.workItemId, row.qty]).sort()).toEqual(
        [
          [first.workItemId, 2],
          [second.workItemId, 3],
        ].sort(),
      );
      expect(allocations.every((row) => row.planId === null)).toBe(true);

      const handIns = await tx
        .select()
        .from(wmsTables.batchInventorySessionEvents)
        .where(
          and(
            eq(wmsTables.batchInventorySessionEvents.sessionId, started.sessionId),
            eq(wmsTables.batchInventorySessionEvents.eventType, 'HAND_IN'),
          ),
        );
      expect(handIns).toHaveLength(allocations.length);
      const byAllocation = new Map(allocations.map((row) => [row.id, row]));
      for (const event of handIns) {
        const payload = event.payload as Record<string, unknown>;
        expect(payload.batchId).toBe(first.batchId);
        expect(payload.workItemId).toBe(byAllocation.get(payload.allocationId as string)?.workItemId);
      }
      const [batch] = await tx.select().from(wmsTables.outboundBatches).where(eq(wmsTables.outboundBatches.id, first.batchId));
      expect(batch.startedAt).not.toBeNull();
    });
  });

  it('같은 키·다른 키로 다시 시작해도 같은 세션이고 HAND_IN 이 늘지 않는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { first } = await seedTwoBoxBatch(tx);
      const { picking } = assembleOutbound(tx);
      const key = `s-${randomUUID()}`;

      const a = await picking.start({ batchId: first.batchId, actorId: first.actorId, idempotencyKey: key }, tx);
      const b = await picking.start({ batchId: first.batchId, actorId: first.actorId, idempotencyKey: key }, tx);
      const c = await picking.start({ batchId: first.batchId, actorId: first.actorId, idempotencyKey: `s-${randomUUID()}` }, tx);

      expect(new Set([a.sessionId, b.sessionId, c.sessionId]).size).toBe(1);
      const handIns = await tx
        .select({ id: wmsTables.batchInventorySessionEvents.id })
        .from(wmsTables.batchInventorySessionEvents)
        .where(
          and(
            eq(wmsTables.batchInventorySessionEvents.sessionId, a.sessionId),
            eq(wmsTables.batchInventorySessionEvents.eventType, 'HAND_IN'),
          ),
        );
      expect(handIns).toHaveLength(2);
    });
  });

  it('한 박스의 위치 재고가 모자라면 시작이 실패하고 배정·세션·시작 시각이 남지 않는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { first, second } = await seedTwoBoxBatch(tx, 3, 4); // 2 + 3 > 4
      const { picking } = assembleOutbound(tx);

      await expect(
        tx.transaction((trx) =>
          picking.start({ batchId: first.batchId, actorId: first.actorId, idempotencyKey: `s-${randomUUID()}` }, trx as never),
        ),
      ).rejects.toMatchObject({ response: { code: 'PICKING_SOURCE_INSUFFICIENT' } });

      const allocations = await tx.select().from(wmsTables.pickingSourceAllocations).where(
        rawSql`${wmsTables.pickingSourceAllocations.workItemId} IN (${first.workItemId}::uuid, ${second.workItemId}::uuid)`,
      );
      expect(allocations).toHaveLength(0);
      const sessions = await tx.select().from(wmsTables.batchInventorySessions).where(eq(wmsTables.batchInventorySessions.batchId, first.batchId));
      expect(sessions).toHaveLength(0);
      const [batch] = await tx.select().from(wmsTables.outboundBatches).where(eq(wmsTables.outboundBatches.id, first.batchId));
      expect(batch.startedAt).toBeNull();
    });
  });

  it('시작된 배치에 박스를 추가하면 OUTBOUND_BATCH_ALREADY_STARTED', async () => {
    await inRollbackTx(db, async (tx) => {
      const { first } = await seedTwoBoxBatch(tx, 1, 10);
      const { picking, batches } = assembleOutbound(tx);
      await picking.start({ batchId: first.batchId, actorId: first.actorId, idempotencyKey: `s-${randomUUID()}` }, tx);

      const third = await seedShipmentForExistingStock(
        tx,
        {
          actorId: first.actorId,
          warehouseId: first.warehouseId,
          holderId: first.holderId,
          skuId: first.skuId,
          skuCode: first.skuCode,
          barcode: first.barcode,
          locationId: first.locationId,
          ledgerVersion: first.ledgerVersion,
          deliveryProfileId: (
            await tx
              .select({ id: wmsTables.shipments.shippingProfileId })
              .from(wmsTables.shipments)
              .where(eq(wmsTables.shipments.id, first.shipmentId))
          )[0].id!,
        },
        1,
      );
      await tx.delete(wmsTables.outboundBatchWorkItems).where(eq(wmsTables.outboundBatchWorkItems.id, third.workItemId));

      await expect(
        batches.addShipment(first.batchId, third.shipmentId, `add-${randomUUID()}`, { id: randomUUID(), roles: ['master'] }),
      ).rejects.toMatchObject({ response: { code: 'OUTBOUND_BATCH_ALREADY_STARTED' } });
    });
  });

  it('복구 reconcile 은 새 payload 로 시작된 세션을 건강하다고 판정한다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { first } = await seedTwoBoxBatch(tx);
      const { picking, recovery } = assembleOutbound(tx);
      const started = await picking.start({ batchId: first.batchId, actorId: first.actorId, idempotencyKey: `s-${randomUUID()}` }, tx);

      await expect(recovery.reconcile(started.sessionId, tx)).resolves.toMatchObject({ healthy: true });
    });
  });

  it('HAND_IN payload 의 workItemId 가 배정과 다르면 복구가 문제로 잡는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { first } = await seedTwoBoxBatch(tx);
      const { picking, recovery } = assembleOutbound(tx);
      const started = await picking.start({ batchId: first.batchId, actorId: first.actorId, idempotencyKey: `s-${randomUUID()}` }, tx);
      const [victim] = await tx
        .select({ id: wmsTables.batchInventorySessionEvents.id })
        .from(wmsTables.batchInventorySessionEvents)
        .where(
          and(
            eq(wmsTables.batchInventorySessionEvents.sessionId, started.sessionId),
            eq(wmsTables.batchInventorySessionEvents.eventType, 'HAND_IN'),
          ),
        )
        .limit(1);
      await tx
        .update(wmsTables.batchInventorySessionEvents)
        .set({ payload: rawSql`jsonb_set(payload, '{workItemId}', to_jsonb(${randomUUID()}::text))` })
        .where(eq(wmsTables.batchInventorySessionEvents.id, victim.id));

      const result = await recovery.reconcile(started.sessionId, tx);
      expect(result.healthy).toBe(false);
      expect(result.issues.join('\n')).toContain('differs from persisted allocation');
    });
  });
});
```

`tx.transaction(...)` 로 감싼 이유: 실패한 시작이 바깥 롤백 트랜잭션을 망가뜨리지 않게 세이브포인트 안에서 실패시킨다(`simple-outbound.service.ts` 의 `prepare` 가 같은 이유로 그렇게 한다).

Run: `npm run test:core:integration:local -- 'picking/allocation/batch-start.integration'`
Expected: PASS (6)

- [ ] **Step 3: 동시 시작 테스트**

`outbound-preparation.concurrency.integration.spec.ts` 에 있는 `overlap(first, second)` 헬퍼(A 가 잠금을 쥔 채 B 가 막히는 것을 `pg_blocking_pids` 로 확인하고 A 를 커밋시킨다)를 그대로 쓴다. `seedTwoBoxBatch` 를 import 하고 다음 테스트를 더한다:

```ts
  it('같은 배치의 두 박스 첫 스캔이 겹쳐도 세션은 하나이고 HAND_IN 은 배정 수만큼이다', async () => {
    const { first, second } = await observer.db.transaction((tx) => seedTwoBoxBatch(tx as unknown as DbTx));
    try {
      const result = await overlap(
        (tx) =>
          assembleOutbound(tx).simple.prepare(
            first.shipmentId,
            { id: first.actorId, roles: ['logistics_worker'] },
            `prep-${randomUUID()}`,
            tx,
          ),
        (tx) =>
          assembleOutbound(tx).simple.prepare(
            second.shipmentId,
            { id: randomUUID(), roles: ['logistics_worker'] },
            `prep-${randomUUID()}`,
            tx,
          ),
      );
      if (result.first.outcome !== 'ready') throw new Error('first preparation was not ready');
      if (!result.second.ok) throw result.second.error;
      if (result.second.value.outcome !== 'ready') throw new Error('second preparation was not ready');
      expect(result.second.value.context.sessionId).toBe(result.first.context.sessionId);

      const sessions = await observer.db
        .select()
        .from(wmsTables.batchInventorySessions)
        .where(eq(wmsTables.batchInventorySessions.batchId, first.batchId));
      expect(sessions).toHaveLength(1);
      const handIns = await observer.db
        .select({ id: wmsTables.batchInventorySessionEvents.id })
        .from(wmsTables.batchInventorySessionEvents)
        .where(
          and(
            eq(wmsTables.batchInventorySessionEvents.sessionId, sessions[0].id),
            eq(wmsTables.batchInventorySessionEvents.eventType, 'HAND_IN'),
          ),
        );
      expect(handIns).toHaveLength(2);
    } finally {
      await observer.db.transaction((tx) => cleanupPreparationFixture(tx as unknown as DbTx, first, [second]));
    }
  });
```

`overlap` 은 B 가 A 에 막히는 것을 **단언**한다(`expect(blocked).toBe(true)`). B 가 막히지 않으면 — 즉 B 의 준비가 A 의 잠금과 겹치지 않으면 — 이 테스트는 그 단언에서 실패한다. 그건 잠금 순서가 바뀌었다는 신호이므로 단언을 지우지 말고 원인을 찾는다. `and`·`DbTx` import 가 파일에 없으면 더한다.

Run: `npm run test:core:integration:local -- 'outbound-preparation.concurrency.integration'`
Expected: PASS

- [ ] **Step 4: 기존 통합 스펙 이관 규칙**

각 파일에 다음 치환을 적용한다.

전(before):

```ts
const planned = await picking.plan(
  { batchId, shipmentIds: [shipmentId], actorId, idempotencyKey: 'plan-1' },
  tx,
);
if (planned.state !== 'planned') throw new Error('plan failed');
const started = await picking.start(
  { batchId, planId: planned.planId, actorId, idempotencyKey: 'start-1' },
  tx,
);
```

후(after):

```ts
const started = await picking.start({ batchId, actorId, idempotencyKey: 'start-1' }, tx);
```

- 전략 입력의 `planId: …` 삭제, 결품 요청의 `planId`·`expectedPlanVersion` 삭제
- `wmsTables.pickingPlans`/`pickingPlanMembers` 를 읽는 단언 → `outboundBatches.startedAt` 이나 `pickingSourceAllocations.workItemId` 단언으로
- 계획 초안·무효화·재계획·구성원 불일치를 검증하는 `it` 은 **삭제**한다. 찾기: `grep -nE "invalidat|MEMBERSHIP_MISMATCH|PLAN_ALREADY_ACTIVE|replan|REPLAN|draft plan|PLAN_NOT_" <파일>`. 삭제한 `it` 이름을 커밋 본문에 파일별로 나열한다
- 계획 행을 직접 insert 하는 픽스처가 있으면 배정 insert 에 `workItemId` 를 넣고 계획 insert 를 지운다

- [ ] **Step 5: 파일별로 돌리며 초록 만들기**

Run (파일마다): `npm run test:core:integration:local -- '<파일 경로 정규식>'`
순서: `batch-start` → `batch-inventory-session` → `simple-outbound` → `location-outbound` → `outbound-preparation` → `outbound-preparation.concurrency` → `shipment-dispatch` → `shipment-short-pick` → `shipment-planning` → `consolidation` → `outbound-batch-orchestrator` → `inbound-origin-planning` → `outbound-v2-*` → `warehouse-demo-workflow-http` → `purchase-order-receiving-*` → `logistics-fixtures` → `waybill.reader`
Expected: 각 PASS

- [ ] **Step 6: 전체 통합**

Run: `npm run test:core:integration:local`
Expected: 이 브랜치 이전 develop 과 같은 결과. develop 부터 빨간 스위트가 있으면(메모리: develop RED 목록) `git stash; npm run test:core:integration:local; git stash pop` 이 아니라 **develop 워크트리에서** 같은 명령을 돌려 비교하고, 새로 빨개진 것만 고친다.

- [ ] **Step 7: Commit**

```bash
git add -A apps/core/src
git commit -m "test(fulfillment): 통합 스펙을 배치 시작 모델로 옮기고 배치 시작 스펙을 더한다"
```

---

### Task 10: admin-web

**Files:**
- Modify: `apps/admin-web/src/lib/types/dto/fulfillment.ts`
- Modify: `apps/admin-web/src/lib/api/domains/orders/picking.client.ts`, `apps/admin-web/src/lib/api/domains/orders/v2-clients.spec.ts`
- Modify: `apps/admin-web/src/lib/services/orders/mutations.ts`, `apps/admin-web/src/lib/services/orders/index.ts`
- Modify: `apps/admin-web/src/features/order/picking-list/components/v2-picking-workspace/index.tsx`
- Modify: `apps/admin-web/src/features/order/picking-list/components/short-pick-dialog/index.tsx`
- Modify: `apps/admin-web/src/features/order/outbound-batches/components/batch-detail-drawer/index.tsx`

- [ ] **Step 1: 타입**

`lib/types/dto/fulfillment.ts`:
- `PickingPlanSnapshot`·`PickingPlanMember`·`PickingPlanAllocation`·`CreatePickingPlanRequest`·`PickingPlanResult` 삭제
- 추가:

```ts
export interface BatchPickingAllocation {
  id: string;
  workItemId: string;
  shipmentLineId: string;
  sourceLocationId: string;
  qty: number;
  sourceStockVersion: number;
  createdAt: string;
}

export interface BatchPickingSnapshot {
  strategy: PickingStrategyName;
  startedAt: string;
  allocations: BatchPickingAllocation[];
}
```

- `OutboundBatchV2Detail.pickingPlan: PickingPlanSnapshot | null` → `picking: BatchPickingSnapshot | null`
- `StartPickingV2Request` 에서 `planId` 삭제. `PickingStartResult` 는 `{ state: 'started'; operationId: string; batchId: string; sessionId: string; status: string }` 하나로
- 모든 요청·결과 타입의 `planId` 삭제(883·1092·1097·1110·1121·1131·1144·1153·1190·1200·1214·1224·1235·1263 부근), `ReportShipmentShortPickRequest.expectedPlanVersion` 삭제
- 확인: `grep -n "planId\|PickingPlan\|expectedPlanVersion" apps/admin-web/src/lib/types/dto/fulfillment.ts | grep -v -i membership` → 0 줄

- [ ] **Step 2: 클라이언트·뮤테이션**

- `picking.client.ts`: `createPlan` 삭제, import 정리
- `v2-clients.spec.ts`: `createPlan` 테스트 삭제
- `mutations.ts`: `useCreatePickingPlan` 삭제. `index.ts` 재수출에서도 삭제

- [ ] **Step 3: 화면**

`v2-picking-workspace/index.tsx`:
- `const plan = batch?.pickingPlan;` → `const picking = batch?.picking;`, `strategy = picking?.strategy`
- 배정 찾기·필터를 `batch?.picking?.allocations` 로. 작업 항목이 골라져 있으면 `workItemId` 로 거른다:

```tsx
  const relevantAllocations = useMemo(() => {
    if (!batch?.picking) return [];
    if (!workItem) return batch.picking.allocations;
    return batch.picking.allocations.filter((item) => item.workItemId === workItem.id);
  }, [batch?.picking, workItem]);
```

- `context` 조건 `plan && session && workItem` → `session && workItem`, 객체에서 `planId` 삭제
- 헤더 배지 `{plan.strategy} · {plan.status} · v{plan.version}` → `{picking.strategy} · 시작 {new Date(picking.startedAt).toLocaleString('ko-KR')}`
- `batch … / plan … / inventory session …` 문구 → `batch … / inventory session …`
- 시작 버튼 조건 `canOperateWarehouse && plan && !session` → `canOperateWarehouse && !session`, payload `{ batchId, planId: plan.id }` → `{ batchId }`
- 346·397 부근 호출 payload 의 `planId: plan.id` 삭제
- 계획 만들기 버튼·`useCreatePickingPlan` 사용처가 있으면 삭제

`short-pick-dialog/index.tsx`: `const plan = batch.pickingPlan;` 와 payload 의 `planId`·`expectedPlanVersion` 삭제. `plan` 이 null 이면 대화상자를 막던 조건은 `batch.picking` 이 null 이면 막는 것으로.

`batch-detail-drawer/index.tsx`: 155-159 의 계획 배지를

```tsx
              {batch.picking && (
                <p>
                  <b>{STRATEGY_LABELS[batch.picking.strategy]}</b> · 시작{' '}
                  {new Date(batch.picking.startedAt).toLocaleString('ko-KR')}
                </p>
              )}
```

(주변 마크업 태그가 다르면 기존 태그를 따른다.)

- [ ] **Step 4: admin-web 게이트**

Run: `cd apps/admin-web && npx tsc --noEmit && cd ../.. && npm run test:admin-web`
Expected: 에러 0, 실패 0. 확인: `grep -rn "pickingPlan\|createPlan\|expectedPlanVersion" apps/admin-web/src | grep -v -i membership` → 0 줄

- [ ] **Step 5: Commit**

```bash
git add -A apps/admin-web/src
git commit -m "refactor(admin-web): 피킹 계획 대신 배치 시작·작업 항목 배정을 보여준다"
```

---

### Task 11: 가드 스펙·ADR·스펙 정정

**Files:**
- Create: `apps/core/src/modules/fulfillment/picking/allocation/no-picking-plan-references.spec.ts`
- Create: `docs/adr/0041-picking-plan-absorbed-into-work-item-allocations.md`
- Modify: `docs/adr/0030-picking-plan-layer-extraction.md`(상단에 부분 대체 표지)
- Modify: `docs/superpowers/specs/2026-09-29-outbound-live-allocation-design.md`

- [ ] **Step 1: 가드 스펙 (실패 먼저)**

```ts
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';

const ROOT = join(__dirname, '../../../../../../..'); // 저장소 루트
const SRC = join(ROOT, 'apps/core/src');
// 스키마 정의와, 스키마 제약을 이름으로 검사하는 스펙만 예외다. PR 2 에서 스키마째 사라진다.
const ALLOWED = new Set([
  'apps/core/src/modules/inventory/schema/inventory.schema.ts',
  'apps/core/src/modules/inventory/schema/outbound-v2-schema.integration.spec.ts',
  'apps/core/src/modules/fulfillment/picking/allocation/no-picking-plan-references.spec.ts',
]);
const PATTERN = /wmsTables\.pickingPlans\b|wmsTables\.pickingPlanMembers\b|pickingSourceAllocations\.planId\b/;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (path.endsWith('.ts')) out.push(path);
  }
  return out;
}

describe('피킹 계획 테이블은 코드에서 사라졌다 (ADR-0041)', () => {
  it('스키마 외에 picking_plans·picking_plan_members·allocations.plan_id 를 참조하는 파일이 없다', () => {
    const offenders = walk(SRC)
      .map((path) => relative(ROOT, path))
      .filter((path) => !ALLOWED.has(path))
      .filter((path) => PATTERN.test(readFileSync(join(ROOT, path), 'utf8')));
    expect(offenders).toEqual([]);
  });
});
```

Run: `npx jest apps/core/src/modules/fulfillment/picking/allocation/no-picking-plan-references.spec.ts`
Expected: PASS(앞선 Task 가 다 걷어냈다면). FAIL 이면 나열된 파일을 앞 Task 의 규칙으로 고친다. `ROOT` 계산이 틀리면(`SRC` 가 없으면) `__dirname` 기준 상대 경로 단계를 고친다.

- [ ] **Step 2: ADR-0041**

`docs/adr/0041-picking-plan-absorbed-into-work-item-allocations.md`:

```markdown
# 피킹 계획을 작업 항목 배정 장부로 흡수한다

ADR-0030 을 부분 대체한다(계획 층의 «존재»를 대체, 3방식 diff ≤ 4 공유 규칙은 새 배정 층에 그대로 적용).
설계: `docs/superpowers/specs/2026-09-29-outbound-live-allocation-design.md`.

## Decision

- `picking_plans`·`picking_plan_members` 를 없앤다. 배정(`picking_source_allocations`)은 `work_item_id` 로
  작업 항목에 매단다. 「이 박스가 이 배치에 있다」는 작업 항목 한 곳에만 적힌다.
- 「계획 초안 → 시작」을 「배치 시작」 한 번으로 합친다(`startBatchPicking`). 배정과 인계가 한 트랜잭션이라
  계획이 낡을 틈이 없고, 초안·무효화·재계획 장치가 통째로 필요 없다.
- 세션 신원은 «세션의 계획 id»가 아니라 «세션의 배치 id»다. HAND_IN payload 는 `batchId`·`workItemId`·`allocationId`.
- 배치의 전략은 컬럼이 아니라 `STRATEGY_BY_PICKING_METHOD[pickingMethod]` 로 도출한다(스펙 §4.2 의 `batches.strategy` 는 두지 않는다).

## Why

계획은 배치의 「고정된 집합」 사진이었고, 같은 사실(박스가 배치에 있다)을 작업 항목과 계획 구성원 두 곳에
적은 뒤 둘의 일치를 강제했다. 그 이중 기록 때문에 시작된 배치에 박스를 넣을 길도, 결품 외에 뺄 길도 없었다.
고정이 지켜 주던 것은 대체된다: 배정은 변경마다 잠금 아래 그 박스 몫만 정하고(지금 배정은 위치 id 순 선착이라
집합 전체를 볼 때만 얻는 최적화가 없다), 복구는 배정마다 이벤트 합과 대조한다.

기각: 계획을 남기고 구성원에 합류·은퇴 수명주기를 주는 안 — 이중 기록이 남아 모든 연산이 둘을 함께
움직여야 하고, 재합류에 «구성원 세대» 장치가 다시 필요하다.

## Consequences

- 발송의 «계획 구성원 버전 스냅샷» 검사가 사라진다. 배정 합 = 줄 수량, 송장 manifestVersion 일치, 예약 소진이
  함께 같은 것을 증명한다.
- 시작된 배치에 박스를 추가하면 `OUTBOUND_BATCH_ALREADY_STARTED`. 합류는 S1-B 가 연다.
- 배포는 expand(`work_item_id` 추가, `plan_id` NULL 허용) → contract(계획 테이블·`plan_id` 삭제) 두 번.
```

- [ ] **Step 3: ADR-0030 표지**

`docs/adr/0030-picking-plan-layer-extraction.md` 제목 바로 아래에 한 줄:

```markdown
> **부분 대체됨:** 계획 층 자체는 [[0041-picking-plan-absorbed-into-work-item-allocations]] 로 작업 항목 배정에 흡수됐다. 아래의 «3방식 diff ≤ 4 만 공유» 규칙은 `picking/allocation/` 에 그대로 적용된다.
```

- [ ] **Step 4: 스펙 정정**

`2026-09-29-outbound-live-allocation-design.md` §4.2 표의 `outbound_batches` 행에서 «`strategy picking_strategy NOT NULL` 추가(계획에서 이사)»를 «전략은 `STRATEGY_BY_PICKING_METHOD[pickingMethod]` 로 도출(컬럼 없음, ADR-0041)»로 고치고, §11 PR 2 의 `batches.strategy NOT NULL` 을 지운다. §9 변경 지점 표의 `fulfillment/picking/plan/ → 배정 층(이름 변경)` 행에 «`picking/allocation/`» 을 적는다.

- [ ] **Step 5: Commit**

```bash
git add apps/core/src/modules/fulfillment/picking/allocation/no-picking-plan-references.spec.ts docs/adr docs/superpowers/specs/2026-09-29-outbound-live-allocation-design.md
git commit -m "docs(fulfillment): ADR-0041 계획을 작업 항목 배정에 흡수 + 계획 참조 가드"
```

---

### Task 12: 최종 게이트

- [ ] **Step 1: 전체 게이트**

Run:
```bash
npm run type-check
npx jest --maxWorkers=2
cd apps/admin-web && npx tsc --noEmit && cd ../..
npm run test:admin-web
npm run test:core:integration:local
```
Expected: 에러 0, 실패 0, 통합은 develop 과 같거나 더 초록

- [ ] **Step 2: 로컬 E2E 사람 스모크(체크리스트를 PR 본문에)**

`npm run bootstrap:e2e:local && npm run start:all:local && npm run preflight:e2e:local` 뒤, 사람이 브라우저·warehouse-app 으로:
1. 배치에 박스 2개 추가 → 단순출고로 첫 송장 스캔 → 상품 스캔 → 자동 발송까지
2. 두 번째 박스도 같은 배치에서 발송
3. admin-web 배치 상세에 «시작 시각»과 배정이 보인다
4. 시작된 배치에 박스 추가 시 «이미 시작된 배치» 거절
5. admin-web V2 피킹 화면에서 결품 신고 → 박스가 초안으로

(에이전트는 브라우저 로그인을 하지 않는다 — 사람이 직접.)

- [ ] **Step 3: PR (expand)**

제목: `refactor(fulfillment): 피킹 계획을 작업 항목 배정에 흡수한다 (S1-A, expand)`. 본문: Task 0 실측치, 삭제한 테스트 목록, 스모크 결과, 배포 순서 `migrate → deploy`, PR 2 예고.

---

### Task 13: PR 2 — contract (PR 1 이 라이브에 배포된 **뒤**에만)

**Files:**
- Modify: `apps/core/src/modules/inventory/schema/inventory.schema.ts`
- Create: `apps/core/drizzle/<ts>_drop-picking-plans.sql`(생성물)
- Modify: `apps/core/src/modules/inventory/schema/outbound-v2-schema.integration.spec.ts`
- Modify: 가드 스펙 `ALLOWED` 에서 스키마 두 줄 제거, `PATTERN` 에 `\bpickingPlans\b|\bpickingPlanMembers\b|picking_plans|picking_plan_members` 추가(스키마에서도 사라졌으므로)
- Modify: `outbound-batch-orchestrator.service.ts`·`batch-start.ts`·`batch-session-recovery.service.ts` 의 `workItemId!` 에서 `!` 제거

- [ ] **Step 1: 라이브 배포 확인** — `aws ecs describe-services` 로 Core 태스크 정의의 `registeredAt` 이 PR 1 머지 뒤인지 확인한다(데이터가 아니라 배포 사실로 판정)
- [ ] **Step 2: 스키마** — `pickingPlans`·`pickingPlanMembers` 테이블 정의와 관계(`pickingPlansRelations`·`pickingPlanMembersRelations`), `pickingPlanStatusEnum`, `wmsTables` 의 두 항목, `pickingSourceAllocations.planId` 와 `uq_picking_source_allocations_grain`, 관계의 `plan:` 을 지우고 `workItemId` 에 `.notNull()`
- [ ] **Step 3: 마이그 생성 (메인 세션/사람)** — `npm run db:generate:core -- --name drop-picking-plans`. 기대 SQL: `DROP TABLE picking_plan_members`, `DROP TABLE picking_plans`, `ALTER TABLE picking_source_allocations DROP CONSTRAINT uq_picking_source_allocations_grain`, `DROP COLUMN plan_id`, `ALTER COLUMN work_item_id SET NOT NULL`, `DROP TYPE picking_plan_status`. 순서 오류(FK 가 남은 채 DROP TABLE)가 있으면 멈춘다. `work_item_id` NULL 행이 라이브에 있으면(Task 0 의 과거 행) `SET NOT NULL` 이 실패한다 — 생성 전에 `SELECT count(*) FROM picking_source_allocations WHERE work_item_id IS NULL` 을 실측하고, 0 이 아니면 **멈추고 사용자에게** 과거 행 처리(삭제 vs 보존)를 묻는다
- [ ] **Step 4: 게이트** — Task 12 Step 1 전부
- [ ] **Step 5: Commit·PR** — 배포 순서 `deploy → migrate`(contract)
