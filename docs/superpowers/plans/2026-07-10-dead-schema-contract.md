# 죽은 스키마 자산 제거 (작업 8a) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 런타임 참조 0 인 `outbound_task` 4테이블과 orphan `event_type` enum 을 스키마에서 제거하고 DROP 마이그레이션을 생성한다 (P3-5 잔여 + P3-4 orphan enum, WS-B 작업 8a).

**Architecture:** `inventory.schema.ts` + `enum-values.ts` 에서 죽은 자산의 pgTable/pgEnum 정의·relations·타입 export 를 제거 → `drizzle-kit generate`(오프라인, DB 미연결) 로 `DROP TABLE … CASCADE` ×4 + `DROP TYPE event_type` 마이그레이션 생성. 두 자산 모두 런타임 참조 0 이라 expand-contract multi-phase 없이 단일 PR. 마이그레이션 **적용(db:migrate)은 dev DB 부재로 ⏸**(작업 1~3 과 동일) — 생성·커밋까지만.

**Tech Stack:** Drizzle ORM · drizzle-kit generate(offline) · NestJS(core) · TypeScript · PostgreSQL(적용 ⏸)

## Global Constraints

- **단일 커밋 규칙(CLAUDE.md)**: `inventory.schema.ts` + `enum-values.ts` + `drizzle/<ts>_*.sql` + `drizzle/meta/` 갱신을 **한 커밋**에. 분리 시 타인 체크아웃 desync → Task 1·2 는 편집만(커밋 없음), Task 3 이 마이그레이션과 함께 일괄 커밋.
- **`sku_location_movements` 불가침** — 작업4 에서 재고이동 재도입 위해 존치. 편집 대상 아님.
- **마이그레이션 적용 ⏸** — `db:migrate` 는 dev DB 필요. 본 작업은 `db:generate`(오프라인)까지만. 적용은 dev DB 복구 시 작업1~3 미적용분과 일괄.
- **SQL 리뷰 게이트**: 생성된 마이그레이션은 **정확히 `DROP TABLE` ×4 + `DROP TYPE "public"."event_type"`**. 그 외 statement(ALTER/CREATE/다른 DROP) 있으면 **중단·조사**(미커밋 drift 신호).
- 검증 스코프: `nest build core`(tsc) · 삭제 심볼 저장소 전역 grep 0 · eslint 변경 파일 신규 error 0. 적용/통합은 ⏸.
- 대상 파일(둘 다 `apps/core/src/modules/inventory/schema/`): `inventory.schema.ts`, `enum-values.ts`.
- 커밋 트레일러:
  ```
  Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01FAeYiGWW6ALHsdTDc6Hg7n
  ```

---

### Task 1: orphan `event_type` enum 제거 (편집만, 커밋 없음)

**Files:**
- Modify: `apps/core/src/modules/inventory/schema/inventory.schema.ts:55-84` (enum 정의)
- Modify: `apps/core/src/modules/inventory/schema/enum-values.ts:7, 61-62` (import + 재수출 + 타입)

**Interfaces:**
- Consumes: 없음.
- Produces: `eventTypeEnum`·`eventTypeValues`·`EventTypeEnum` 심볼 소멸. drizzle 스키마에서 orphan 'event_type' enum 제거 → Task 3 generate 가 `DROP TYPE` 산출.

- [ ] **Step 1: 착수 전 워킹트리 clean 확인**

Run: `git status --short`
Expected: 출력 없음(clean). 미커밋 스키마 변경이 섞이면 Task 3 SQL 리뷰가 오염되므로 clean 에서 시작.

- [ ] **Step 2: `eventTypeEnum` 정의 삭제**

`inventory.schema.ts` 의 `:55-84` 블록 전체 삭제:

```ts
export const eventTypeEnum = pgEnum('event_type', [
  // 입고 관련
  'IN', // 일반 입고
  ...
  'RESERVE',
  'CONFIRM',
  'RELEASE',
  'CANCEL',
]);
```

(`export const eventTypeEnum = pgEnum('event_type', [` 부터 닫는 `]);` 까지. 이 enum 은 어느 컬럼에도 미부착·집계 export 미포함이라 이 정의가 유일 지점.)

- [ ] **Step 3: `enum-values.ts` 재수출 삭제**

- import 목록에서 `eventTypeEnum,`(`:7`) 한 줄 제거.
- `export const eventTypeValues = eventTypeEnum.enumValues;`(`:61`) 제거.
- `export type EventTypeEnum = (typeof eventTypeValues)[number];`(`:62`) 제거.

(주의: `auditEventTypeEnum`·`auditEventTypeValues`·`AuditEventTypeEnum` 은 **별개 라이브 enum** — 건드리지 말 것.)

- [ ] **Step 4: 컴파일 + 참조 0 확인**

Run:
```bash
npx nest build core 2>&1 | tail -3
grep -rnw "eventTypeEnum\|eventTypeValues\|EventTypeEnum" apps --include=*.ts | grep -v "audit" || echo "event_type refs: 0"
```
Expected: `nest build core` exit 0(webpack compiled successfully) · event_type 심볼 참조 0(audit* 제외). 커밋하지 않는다 — Task 3 에서 마이그레이션과 함께.

---

### Task 2: `outbound_task` 4테이블 제거 (편집만, 커밋 없음)

**Files:**
- Modify: `apps/core/src/modules/inventory/schema/inventory.schema.ts` (정의·relations·집계·타입 export 다지점)

**Interfaces:**
- Consumes: 없음(Task 1 과 독립).
- Produces: `outboundTasks`/`outboundTaskOrders`/`outboundTaskItems`/`outboundTaskLines` pgTable·relations·타입 소멸 → Task 3 generate 가 `DROP TABLE ×4` 산출.

- [ ] **Step 1: pgTable 정의 4개 삭제**

각 `export const … = pgTable('…', {…})` 블록 전체 삭제(닫는 `});` 포함):
- `outboundTasks` — `:1390` 시작
- `outboundTaskOrders` — `:1412` 시작
- `outboundTaskItems` — `:1430` 시작
- `outboundTaskLines` — `:1451` 시작

- [ ] **Step 2: schema 집계 export 4줄 삭제**

`:2265-2268` 의 4줄 제거:
```ts
  outboundTasks,
  outboundTaskOrders,
  outboundTaskItems,
  outboundTaskLines,
```

- [ ] **Step 3: sibling relations 의 back-reference 라인만 삭제**

각 relations 블록에서 **해당 `many(...)` 한 줄만** 제거(블록·타 relation 존치):
- `skusRelations`(:2360 블록): `outboundTaskItems: many(outboundTaskItems),` + `outboundTaskLines: many(outboundTaskLines),` (`:2403-2404`)
- `warehousesRelations`(:2486 블록): `outboundTasks: many(outboundTasks),` (`:2493`)
- `locationsRelations`(:2528 블록): `outboundTaskLines: many(outboundTaskLines),` (`:2542`)
- `salesOrdersRelations`(:2639 블록): `outboundTaskOrders: many(outboundTaskOrders),` (`:2645`)
- `mergeGroupsRelations`(:2674 블록): `outboundTasks: many(outboundTasks),` (`:2675`)

- [ ] **Step 4: 전용 relations 4개 삭제**

`:2731-2777` 의 `outboundTasksRelations`·`outboundTaskOrdersRelations`·`outboundTaskItemsRelations`·`outboundTaskLinesRelations` 블록 전체 삭제.

- [ ] **Step 5: relations 집계 export 4줄 삭제**

`:3125-3128`:
```ts
  outboundTasksRelations,
  outboundTaskOrdersRelations,
  outboundTaskItemsRelations,
  outboundTaskLinesRelations,
```

- [ ] **Step 6: 타입 export 삭제**

`:3299-3310` 의 `// Outbound Types` 섹션(주석 포함) 삭제:
```ts
// Outbound Types
export type OutboundTask = InferSelectModel<typeof outboundTasks>;
export type NewOutboundTask = InferInsertModel<typeof outboundTasks>;
export type OutboundTaskOrder = InferSelectModel<typeof outboundTaskOrders>;
export type NewOutboundTaskOrder = InferInsertModel<typeof outboundTaskOrders>;
export type OutboundTaskItem = InferSelectModel<typeof outboundTaskItems>;
export type NewOutboundTaskItem = InferInsertModel<typeof outboundTaskItems>;
export type OutboundTaskLine = InferSelectModel<typeof outboundTaskLines>;
export type NewOutboundTaskLine = InferInsertModel<typeof outboundTaskLines>;
```

(바로 아래 `OutboundBatch`(`:3312`)는 **별개 라이브 타입** — 존치.)

- [ ] **Step 7: 컴파일 + 참조 0 확인**

Run:
```bash
npx nest build core 2>&1 | tail -3
grep -rn "outboundTasks\|outboundTaskOrders\|outboundTaskItems\|outboundTaskLines\|OutboundTask\b" apps --include=*.ts | grep -v "outboundBatches" || echo "outbound_task refs: 0"
```
Expected: `nest build core` exit 0 · outbound_task 심볼 참조 0(스키마 파일 포함 전역 — 편집 완료 시 정의도 사라졌으므로 0). 커밋하지 않는다.

---

### Task 3: DROP 마이그레이션 생성 + 리뷰 + 단일 커밋

**Files:**
- Create: `apps/core/drizzle/<timestamp>_drop-outbound-task-and-event-type.sql` (drizzle 생성)
- Modify: `apps/core/drizzle/meta/*` (drizzle 스냅샷/저널 갱신)
- Commit: 위 + Task 1·2 의 `inventory.schema.ts` + `enum-values.ts`

**Interfaces:**
- Consumes: Task 1·2 의 스키마 편집(staged, 미커밋).
- Produces: 단일 커밋(schema + enum-values + migration + meta).

- [ ] **Step 1: 마이그레이션 생성 (오프라인)**

Run: `npm run db:generate:core -- --name drop-outbound-task-and-event-type`
Expected: 새 `apps/core/drizzle/<ts>_drop-outbound-task-and-event-type.sql` 생성 + `drizzle/meta/` 갱신. DB 미연결로 진행(config `url || ''` 폴백). **프롬프트가 뜨면(예상외 — 순수 DROP 은 비대화식) 중단·조사**.

- [ ] **Step 2: 생성 SQL 리뷰 (게이트)**

Run: `cat apps/core/drizzle/$(ls -t apps/core/drizzle/*.sql | head -1 | xargs basename)`
Expected: **정확히** 아래만 포함 —
- `DROP TABLE "outbound_tasks" CASCADE;` (또는 `--> statement-breakpoint` 구분)
- `DROP TABLE "outbound_task_orders" CASCADE;`
- `DROP TABLE "outbound_task_items" CASCADE;`
- `DROP TABLE "outbound_task_lines" CASCADE;`
- `DROP TYPE "public"."event_type";`

**그 외 statement(ALTER/CREATE/다른 테이블 DROP/enum recast)가 있으면 STOP** — 미커밋 drift 나 오삭제 신호. 조사 후 재개.

- [ ] **Step 3: 최종 빌드 + arch 경계 회귀**

Run:
```bash
npx nest build core 2>&1 | tail -3
npx jest --testPathPattern=inventory-write-boundary.arch.spec 2>&1 | tail -5
npx eslint apps/core/src/modules/inventory/schema/inventory.schema.ts apps/core/src/modules/inventory/schema/enum-values.ts 2>&1 | grep -E "error" | grep -vE "prettier|no-unsafe|require-await|no-explicit-any" || echo "changed-file new errors: 0"
```
Expected: build exit 0 · arch spec PASS · 변경 2파일 신규 구조 error 0(기존 repo lint debt 무관).

- [ ] **Step 4: 단일 커밋**

```bash
git add apps/core/src/modules/inventory/schema/inventory.schema.ts apps/core/src/modules/inventory/schema/enum-values.ts apps/core/drizzle/
git commit -m "[inventory] outbound_task 4테이블 + orphan event_type enum DROP (P3-5 잔여/P3-4)

- 런타임 참조 0 dead 자산 제거: pgTable 4 + relations + 타입 export + orphan pgEnum
- drizzle DROP 마이그레이션 생성(DROP TABLE ×4 CASCADE + DROP TYPE event_type)
- 적용(db:migrate)은 dev DB 복구 시 ⏸ (작업1~3 미적용분과 일괄)
- sku_location_movements 는 존치(작업4 재도입 예정)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01FAeYiGWW6ALHsdTDc6Hg7n"
```

Run 후: `git status --short` 로 잔여 미추적(meta 등) 없는지 확인. 남으면 `git add` 후 `--amend`.

---

### Task 4: 현황판 문서화

**Files:**
- Modify: `docs/logistics-backend-hardening-2026-07.md` (P3-5·P3-4 행 + §5 WS-B 작업 8a 블록)

**Interfaces:**
- Consumes: Task 1~3 완료.
- Produces: 현황판이 작업 8a 완료 + 작업 8b 이연 반영.

- [ ] **Step 1: P3-5 행 → 🟩**

`§2 P3` 표 P3-5 행: 상태를 🟨 → 🟩, 말미에 추가:
```
**✅ 작업 8a 완료(2026-07-10)**: `outbound_task` 4테이블 DROP 마이그레이션 생성(적용 ⏸ dev DB). P3-5 종결(코드부 작업5 + 테이블 DROP).
```

- [ ] **Step 2: P3-4 행 부분 갱신 (⬜ → 🟨 부분 진행)**

`§2 P3` 표 P3-4 행: 상태 ⬜ → 🟨(orphan enum 만 완료, column-attached 이연), 말미에 추가:
```
**부분 완료(작업 8a, 2026-07-10)**: orphan `event_type` enum(미부착 vestigial) DROP. column-attached enum 값(fulfillment/reservation/shipment/transition)은 recast+reader정리+live-row-0(dev DB) 필요라 작업 8b 로 이연.
```

- [ ] **Step 3: §5 WS-B 에 작업 8a 완료 블록 추가**

작업 7 완료 블록 뒤에 추가:
```
> **✅ 작업 8a (죽은 스키마 자산 제거, P3-5 잔여·P3-4 orphan enum) 완료 — 2026-07-10:** 런타임 참조 0 인 `outbound_task` 4테이블 + orphan `event_type` enum 을 스키마에서 제거하고 DROP 마이그레이션 생성. 둘 다 참조 0 이라 expand-contract multi-phase 불요(단일 PR).
> - **제거**: `inventory.schema.ts` 의 pgTable 4(+sibling relations·전용 relations·집계·타입 export) + orphan `eventTypeEnum`(+`enum-values.ts` 재수출). 실제 원장은 `transition_type` 소유라 `event_type` 은 vestigial.
> - **마이그레이션**: `drizzle-kit generate`(오프라인) → `DROP TABLE ×4 CASCADE` + `DROP TYPE event_type`. recast 0. **적용 ⏸**(db:migrate=dev DB) — 작업1~3 미적용분과 일괄, DROP 은 데이터 무관 항상 성공이라 방치 리스크 낮음.
> - **존치**: `sku_location_movements`(작업4 재도입 예정).
> - 브랜치 `feat/dead-schema-contract` → develop 스쿼시 머지 예정.
> - 설계 `docs/superpowers/specs/2026-07-10-dead-schema-contract-design.md` · 계획 `docs/superpowers/plans/2026-07-10-dead-schema-contract.md`.
> - 검증: `nest build core` exit 0 · arch 경계 spec PASS · 삭제 심볼 저장소 전역 참조 0 · 생성 SQL 리뷰(DROP 5개만). 적용/통합 ⏸(dev DB).
> - **WS-B 잔여**: 작업 8b(column-attached enum 값 제거, dev DB 복구 후)뿐.
```

`§5 권장 착수 순서` 줄의 "WS-B 잔여 작업 8" → "작업 8b(dev DB 복구 후)"로 갱신.

- [ ] **Step 4: 커밋**

```bash
git add docs/logistics-backend-hardening-2026-07.md
git commit -m "[docs] WS-B 작업 8a(죽은 스키마 자산 제거) 완료 반영

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01FAeYiGWW6ALHsdTDc6Hg7n"
```

---

## 완료 기준 (전 Task 후)

- `inventory.schema.ts`·`enum-values.ts` 에 `outbound_task`·`event_type` 심볼 참조 0(스키마 정의 자체 제거됨).
- 마이그레이션 파일 = `DROP TABLE ×4 CASCADE` + `DROP TYPE event_type` **정확히**.
- `nest build core` exit 0 · arch spec PASS · 변경 파일 신규 eslint error 0.
- `sku_location_movements` 무변경.
- 마이그레이션 적용 ⏸(dev DB) 명기.
- 현황판 P3-5 🟩 · P3-4 부분 완료 · WS-B 잔여 = 작업 8b.
