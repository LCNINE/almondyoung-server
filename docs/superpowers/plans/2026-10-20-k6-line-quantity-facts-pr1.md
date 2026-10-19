# K6 PR 1 — 취소 기록 확장(expand): 취소 라인 테이블 + 쓰기 문 하나 + 백필 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 판매주문 취소를 라인 단위 정식 테이블 `sales_order_cancellation_lines`(출고 전/후 갈래 포함)에도 기록하고, 취소 기록 쓰기를 한 함수로 모으고, 옛 취소를 백필하는 스크립트를 낸다. 읽는 쪽은 아직 바꾸지 않는다.

**Architecture:** 순수 함수 `deriveCancellationLines` 가 «이 취소가 라인별로 몇 개를, 출고 전/후 어느 쪽으로 취소했나»를 취소 행의 `scope`·`metadata.cancelledLines`·`effects` 에서 도출한다. 쓰기 문 `recordSalesOrderCancellation(trx, values)` 가 취소 행과 라인 행을 같은 트랜잭션에 넣고, 판매주문 취소의 세 INSERT 지점이 모두 이 문을 지난다. 백필 스크립트는 같은 순수 함수로 옛 취소를 주문별 시간순으로 재생한다.

**Tech Stack:** NestJS, Drizzle ORM(postgres.js), drizzle-kit 마이그레이션, Jest(유닛 + `describeIfDb` 통합), `typescript` AST 가드 spec, SST `Resource` 기반 ops 스크립트.

**Spec:** `docs/superpowers/specs/2026-10-20-k6-line-quantity-facts-design.md` (§6.1 `canceledBeforeShipment`/`canceledAfterShipment`, §6.2 취소 행, §9 1단계, §11 배포)

**이 PR 의 범위 조정(스펙 §9 는 «빌더가 계획에서 확정»):** 스펙 §9 1단계에 같이 적힌 «교환 항목 소포 칸»·«반품 요청의 관리자 입력 금액 칸»은 PR 3(청구)으로 옮긴다. 둘 다 nullable 추가 칼럼이고 그것을 읽고 쓰는 코드가 PR 3 에 있어서, 코드와 같은 PR 이 CLAUDE.md 의 «새 추가는 코드와 같이 1 PR» 규칙에 맞고 이 PR 을 취소 한 사실에 집중시킨다.

## Global Constraints

- 테이블 `sales_order_cancellation_lines`, 갈래 칸 `shipment_phase` 값은 정확히 `'before_shipment' | 'after_shipment'`.
- 출고 후 갈래 규칙(스펙 §6.1, 내 판단으로 확정): **구성품 하나라도 이미 나간 판매 단위는 «출고 후»**. 라인의 출고 후 수량 = SKU 별 `ceil(그 SKU 의 출고분 취소 수량 ÷ 판매 단위당 SKU 수량)` 의 최댓값.
- 이 PR 은 **읽는 쪽을 바꾸지 않는다.** `metadata.cancelledLines` 는 그대로 계속 쓴다(이중 기록). 옛 파서(`loadPriorPartialCancellationContext`, `cancelledQuantitySql`, `sumCancelledByLine`)는 손대지 않는다.
- 트랜잭션: 쓰기 문은 호출자의 `trx: DbTx` 안에서만 돈다(ADR-0025). 새 `inTx` 헬퍼 금지.
- 마이그레이션은 `npm run db:generate:core -- --name add-sales-order-cancellation-lines` 로 만들고, `schema.ts`·SQL·`drizzle/meta` 를 한 커밋에.
- 배포는 `migrate → deploy`(expand). 백필은 배포 뒤 한 번, 기본 조회만, `--apply` 로 적용.
- 금지: `any`, 근거 없는 `as`, 스펙 안 `dotenv.config()`, 통합 스펙 가드 없이 DB 접속.
- 커밋 메시지 끝: `Claude-Session: https://claude.ai/code/session_017iWMz8e9sogk1k9sXdYvAz`

## Review Focus

1. **묶음 라인에서 구성품 하나만 나간 뒤의 부분취소** — A 는 출고, B 는 미출고인 1세트 취소는 «출고 후 1»이어야 한다(«출고 전 1»로 적으면 PR 2 의 커널이 이 세트를 다시 반품 가능으로 연다). Task 2 의 `bundle with one shipped component` 테스트가 고정한다.
2. **같은 라인을 여러 번 부분취소, 앞서 출고분 취소가 있었던 경우** — 이번 취소의 효과만으로 갈래를 나누고, 라인 합계가 `quantity` 를 넘으면 쓰기 문이 거절한다. Task 2 `repeated partial`, Task 3 `rejects over-cancellation` 이 고정한다.
3. **취소 도중 뒤 단계가 throw 해 트랜잭션이 롤백** — 라인 행도 같이 사라져야 한다(고아 라인 0). Task 3 `rolls back lines with the cancellation` 이 고정한다.
4. **V2 전체취소에 인쇄 외주·디지털 라인이 섞인 주문** — 인쇄 라인은 `cancelledLines` 에 이미 있고(남은 수량), 디지털 라인은 `cancelledLines` 에 없지만 소유권이 회수되므로 남은 수량을 «출고 전»으로 적는다. Task 2 `v2 full adds digital remainder`, Task 3 통합이 고정한다.
5. **백필 재실행·배포 직후 새 취소와 겹침** — 이미 라인 행이 있는 취소는 건너뛰고(멱등), 숫자가 아닌 옛 `metadata` 는 모호로 보고만 한다. Task 5 `skips cancellations that already have lines`, `reports malformed metadata as ambiguous` 가 고정한다.

---

## File Structure

| 파일 | 책임 |
|---|---|
| `apps/core/src/modules/inventory/schema/inventory.schema.ts` (수정) | `salesOrderCancellationLines` 테이블, `wmsTables` 에 등록 |
| `apps/core/drizzle/<timestamp>_add-sales-order-cancellation-lines.sql` + `drizzle/meta/*` (생성) | 마이그레이션 |
| `apps/core/src/modules/sales-order/cancellation-record/cancellation-lines.ts` (생성) | 순수 도출 `deriveCancellationLines`, 타입 `CancellationEffect`(sales-orders.service.ts 에서 옮겨 옴), `CancellationLineDraft` |
| `apps/core/src/modules/sales-order/cancellation-record/record-cancellation.ts` (생성) | 쓰기 문 `recordSalesOrderCancellation` |
| `apps/core/src/modules/sales-order/cancellation-record/cancellation-write.guard.spec.ts` (생성) | 두 테이블 INSERT 는 쓰기 문 밖에서 금지 |
| `apps/core/src/modules/sales-order/services/sales-orders.service.ts` (수정) | INSERT 세 곳(`:675`, `:1575`, `:1896` 부근)을 쓰기 문으로 |
| `scripts/ops/k6-cancellation-lines-backfill.ts` (생성) | 순수 재생 `planOrderBackfill` |
| `scripts/ops/k6-backfill-cancellation-lines.ts` (생성) | 실행기(조회만/`--apply`) |
| `docs/adr/0047-line-quantity-facts-one-record-one-reader.md` (생성) | ADR |

---

### Task 1: 취소 라인 테이블과 마이그레이션

**Files:**
- Modify: `apps/core/src/modules/inventory/schema/inventory.schema.ts` (`salesOrderCancellations` 정의 바로 아래, `wmsTables` 객체)
- Create: `apps/core/drizzle/<timestamp>_add-sales-order-cancellation-lines.sql`, `apps/core/drizzle/meta/*` 갱신

**Interfaces:**
- Produces: `wmsTables.salesOrderCancellationLines` — 칼럼 `id uuid pk defaultRandom`, `cancellationId uuid not null → sales_order_cancellations.id on delete cascade`, `salesOrderId uuid not null → sales_orders.id on delete cascade`, `salesOrderLineId uuid not null → sales_order_lines.id on delete cascade`, `quantity integer not null`, `shipmentPhase varchar(32).$type<CancellationShipmentPhase>() not null`, `createdAt timestamptz not null defaultNow`.
  제약: `ck_sales_order_cancellation_lines_quantity_positive` (`quantity > 0`), `ck_sales_order_cancellation_lines_phase` (`shipment_phase IN ('before_shipment','after_shipment')`), unique `uniq_sales_order_cancellation_lines_cancellation_line_phase` (`cancellation_id, sales_order_line_id, shipment_phase`), index `idx_sales_order_cancellation_lines_line` (`sales_order_line_id`), index `idx_sales_order_cancellation_lines_order` (`sales_order_id`).
- Produces: `export type CancellationShipmentPhase = 'before_shipment' | 'after_shipment'` (schema 파일에 둔다 — 칼럼 `$type` 이 참조).

- [ ] **Step 1:** 스키마에 테이블을 추가하고 `wmsTables` 에 `salesOrderCancellationLines` 를 등록한다.
- [ ] **Step 2:** `npm run db:generate:core -- --name add-sales-order-cancellation-lines`
- [ ] **Step 3:** 생성 SQL 을 읽는다. 기대: `CREATE TABLE "sales_order_cancellation_lines"` 하나, FK 셋, CHECK 둘, unique 하나, index 둘. 그 밖의 DROP/ALTER 가 있으면 스키마를 고치고 `git rm` 후 재생성.
- [ ] **Step 4:** 로컬 적용: `npm run db:setup -- --stage dev --deployment lcnine-services` (인터랙티브). 기대: core 마이그레이션 1건 적용.
- [ ] **Step 5:** `npm run type-check` → 에러 0.
- [ ] **Step 6:** 커밋 (`schema.ts` + SQL + `drizzle/meta` 한 커밋) — `feat(sales-order): 취소 라인 테이블 — 라인·출고 전후 갈래 (K6 PR1)`

### Task 2: 순수 도출 `deriveCancellationLines`

**Files:**
- Create: `apps/core/src/modules/sales-order/cancellation-record/cancellation-lines.ts`
- Test: `apps/core/src/modules/sales-order/cancellation-record/cancellation-lines.spec.ts`
- Modify: `apps/core/src/modules/sales-order/services/sales-orders.service.ts:116-123` (로컬 `type CancellationEffect` 삭제 → 새 파일에서 import)

**Interfaces:**
- Produces:
  ```ts
  export type CancellationEffect = { type: string; targetType?: string; targetId?: string; targetExternalRef?: string; count?: number; metadata?: Record<string, unknown> };
  export type CancellationLineContext = { id: string; quantity: number; isDigital: boolean };
  export type CancellationLineDraft = { salesOrderLineId: string; quantity: number; shipmentPhase: CancellationShipmentPhase };
  export class CancellationLineDerivationError extends Error {}
  export function deriveCancellationLines(input: {
    scope: 'full' | 'partial';
    cancelledLines: Array<{ salesOrderLineId: string; quantity: number }> | null; // 취소 행 metadata.cancelledLines 그대로, 없으면 null
    effects: CancellationEffect[];
    lines: CancellationLineContext[];          // 그 주문의 전체 판매 라인
    priorCancelledByLine: Map<string, number>; // 이 취소 이전의 라인별 취소 합(갈래 무관)
  }): CancellationLineDraft[]; // quantity 0 인 항목은 내지 않는다. 결과는 salesOrderLineId, shipmentPhase 순 정렬
  ```
- 규칙:
  - `partial`: `cancelledLines` 의 각 항목(수량 > 0). 출고 후 수량 = 이 라인의 `type === 'preserved_shipped_fulfillment_order_item'` 효과를 `metadata.skuId` 별로 모아 `Σ metadata.affectedShippedQuantity` 를 구하고, 같은 효과의 `metadata.requestedFulfillmentQuantity ÷ 항목 수량` 을 판매 단위당 SKU 수량으로 써서 `ceil(합 ÷ 단위당)` 의 SKU 별 최댓값. 출고 전 = 항목 수량 − 출고 후.
  - `full` + `cancelledLines` 있음(V2): 각 항목 수량 > 0 → 출고 전. 그리고 `cancelledLines` 에 없는 디지털 라인 중 `quantity − prior > 0` 이면 그 남은 수량 → 출고 전.
  - `full` + `cancelledLines` 없음(V1): 모든 라인 `quantity − prior > 0` → 출고 전.
  - 다음은 `CancellationLineDerivationError`: 항목 라인이 `lines` 에 없음, `requestedFulfillmentQuantity` 가 항목 수량으로 나누어떨어지지 않음, 출고 후 > 항목 수량, 라인별 `prior + 이번 합 > quantity`.

- [ ] **Step 1: 실패하는 테스트를 쓴다** — 각 `it` 의 기대값:
  - `partial without effects is all before_shipment`: lines `[{id:'L1',quantity:3,isDigital:false}]`, cancelledLines `[{L1,2}]`, effects `[]` → `[{L1, 2, before_shipment}]`
  - `partial with preserved shipped splits by phase`: L1 qty 3, cancel 2, effects `[{type:'preserved_shipped_fulfillment_order_item', metadata:{salesOrderLineId:'L1', skuId:'A', requestedFulfillmentQuantity:2, affectedShippedQuantity:1}}]` → `[{L1,1,after_shipment},{L1,1,before_shipment}]`
  - `bundle with one shipped component counts the unit as after_shipment`: L1 qty 1, cancel 1, 효과 SKU A `requestedFulfillmentQuantity:1, affectedShippedQuantity:1` 만(B 효과 없음) → `[{L1,1,after_shipment}]`
  - `multi-unit sku rounds up`: L1 qty 2, cancel 2, SKU A 단위당 3(`requestedFulfillmentQuantity:6`), `affectedShippedQuantity:4` → after `ceil(4/3)=2` → `[{L1,2,after_shipment}]`
  - `repeated partial respects prior`: L1 qty 3, prior `{L1:2}`, cancel 2 → throws `CancellationLineDerivationError`
  - `v1 full cancels every remainder`: L1 qty 3 prior 1, L2 qty 1 prior 0 → `[{L1,2,before},{L2,1,before}]`
  - `v2 full uses cancelledLines and adds digital remainder`: L1(물리) qty 2, cancelledLines `[{L1,1}]`, D1(디지털) qty 1 → `[{D1,1,before},{L1,1,before}]`
  - `zero-quantity entries are dropped`: cancelledLines `[{L1,0}]`, scope full → `[]`
  - `indivisible requestedFulfillmentQuantity throws`: cancel 2, `requestedFulfillmentQuantity:3` → throws
- [ ] **Step 2:** `npx jest apps/core/src/modules/sales-order/cancellation-record/cancellation-lines.spec.ts` → FAIL(모듈 없음).
- [ ] **Step 3:** `cancellation-lines.ts` 구현, `sales-orders.service.ts` 의 로컬 `CancellationEffect` 를 import 로 바꾼다.
- [ ] **Step 4:** 같은 명령 → PASS. `npm run type-check` → 0.
- [ ] **Step 5:** 커밋 — `feat(sales-order): 취소 라인 도출 — 구성품 하나라도 나간 단위는 출고 후 (K6 PR1)`

### Task 3: 쓰기 문 `recordSalesOrderCancellation` 과 세 INSERT 지점 전환

**Files:**
- Create: `apps/core/src/modules/sales-order/cancellation-record/record-cancellation.ts`
- Test: `apps/core/src/modules/sales-order/cancellation-record/record-cancellation.integration.spec.ts`
- Modify: `apps/core/src/modules/sales-order/services/sales-orders.service.ts` — `:675`(V1 전체), `:1575`(V1 부분), `:1896`(V2) 의 `insert(wmsTables.salesOrderCancellations)` 를 쓰기 문 호출로

**Interfaces:**
- Consumes: Task 1 `wmsTables.salesOrderCancellationLines`, Task 2 `deriveCancellationLines`.
- Produces:
  ```ts
  export async function recordSalesOrderCancellation(
    trx: DbTx,
    values: InferInsertModel<typeof wmsTables.salesOrderCancellations>,
  ): Promise<typeof wmsTables.salesOrderCancellations.$inferSelect>;
  ```
  안에서: 주문의 판매 라인을 읽고(`isDigital` 은 `isDigitalFulfillmentLine`), 이 주문의 **기존 취소 라인 행**과 **라인 행이 없는 옛 partial 취소의 `metadata.cancelledLines`**(`sumCancelledByLine`)를 합쳐 `priorCancelledByLine` 을 만들고, 취소 행 INSERT → `deriveCancellationLines` → 라인 행 INSERT. 도출이 throw 하면 그대로 올려 호출자 트랜잭션을 롤백시킨다(`CancellationLineDerivationError` 는 프로그램 불변식 위반이라 도메인 예외로 바꾸지 않는다 — 앞단 검사가 이미 같은 조건을 400 으로 거른다).
  > prior 를 두 출처에서 합치는 이유: 백필 전에는 옛 취소에 라인 행이 없다. 라인 행이 있는 취소는 그 행을, 없는 취소는 metadata 를 쓴다 — 같은 취소를 두 번 세지 않는다.

- [ ] **Step 1: 실패하는 통합 테스트를 쓴다** (`describeIfDb`, `inRollbackTx`·`seedSalesOrder` 등은 `apps/core/src/modules/fulfillment/services/__support__` 의 것을, `SalesOrdersService` 배선은 `sales-orders.v2-cancellation-composition.integration.spec.ts` 의 `wire()` 를 따른다):
  - `v1 partial before FO writes before_shipment lines` — 라인 qty 3, FO 없이 `cancelPartial` 1 → 라인 행 `[{L,1,before_shipment}]`, `metadata.cancelledLines` 도 그대로 `[{L,1}]`
  - `v1 partial after shipment writes after_shipment lines` — 라이브 경로 그대로: FO 생성 뒤 셀메이트 스크립트(`scripts/ops/cellmate-local/mark-core-shipped.js`)처럼 FO `status='shipped'`·`shipped_at`, FOI `shipped_qty=qty` 를 직접 UPDATE 하고 `cancelPartial` 1 → `[{L,1,after_shipment}]`
  - `v1 full writes every remainder` — 라인 qty 2 에 부분취소 1 이후 전체취소 → 전체취소 행의 라인 행 `[{L,1,before_shipment}]`
  - `v2 full writes outstanding lines` — 이 파일의 기존 V2 시나리오(상자 있음)로 전체취소 → 라인 행 합계가 `metadata.cancelledLines` 와 같다
  - `rejects over-cancellation` — `recordSalesOrderCancellation` 을 직접 불러 라인 qty 1 에 partial 2 → throws, 취소 행 0
  - `rolls back lines with the cancellation` — 같은 `trx` 에서 기록 뒤 throw → 트랜잭션 밖에서 두 테이블 모두 0행
- [ ] **Step 2:** `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/core npx jest apps/core/src/modules/sales-order/cancellation-record/record-cancellation.integration.spec.ts` → FAIL.
- [ ] **Step 3:** 쓰기 문 구현, 세 지점을 `const cancellation = await recordSalesOrderCancellation(trx, cancellationValues)` 꼴로 바꾼다(값 구성 코드는 그대로).
- [ ] **Step 4:** 같은 명령 → PASS. 그리고 회귀: `npm run test:core:integration:local -- sales-order` → 전후 실패 수 동일(기준선은 브랜치 시작 때 한 번 재 둔다). `npx jest apps/core/src/modules/sales-order` → 실패 0.
- [ ] **Step 5:** 커밋 — `feat(sales-order): 취소 기록은 한 문으로 — 취소 행과 라인 행을 같은 트랜잭션에 (K6 PR1)`

### Task 4: 쓰기 가드 spec

**Files:**
- Create: `apps/core/src/modules/sales-order/cancellation-record/cancellation-write.guard.spec.ts`

**Interfaces:**
- Consumes: Task 3 의 파일 경로 `apps/core/src/modules/sales-order/cancellation-record/record-cancellation.ts`.

- [ ] **Step 1: 테스트를 쓴다** — `work-item-command.guard.spec.ts` 의 `walk`/`filesMatching` 방식으로 `apps/core/src` 의 `.ts`(`.spec.ts`, `__support__`, `__fixtures__` 제외)를 훑는다.
  - `only the recorder inserts cancellations`: 정규식 `/insert\(\s*wmsTables\.salesOrderCancellations\s*\)/` 에 걸리는 파일 목록 `toEqual(['apps/core/src/modules/sales-order/cancellation-record/record-cancellation.ts'])`
  - `only the recorder inserts cancellation lines`: `/salesOrderCancellationLines/` 를 쓰는 비-스키마 파일 중 `insert(` 를 함께 가진 파일 목록이 위와 같다
- [ ] **Step 2:** `npx jest apps/core/src/modules/sales-order/cancellation-record/cancellation-write.guard.spec.ts` → PASS(Task 3 이 이미 옮겼으므로). 가드가 실제로 잡는지: `sales-orders.service.ts` 에 임시로 `trx.insert(wmsTables.salesOrderCancellations)` 한 줄을 넣어 FAIL 을 보고 되돌린다.
- [ ] **Step 3:** 커밋 — `test(sales-order): 취소 기록 쓰기는 한 문 밖에서 금지 (K6 PR1)`

### Task 5: 백필 — 순수 재생 + 실행기

**Files:**
- Create: `scripts/ops/k6-cancellation-lines-backfill.ts`
- Test: `scripts/ops/k6-cancellation-lines-backfill.spec.ts`
- Create: `scripts/ops/k6-backfill-cancellation-lines.ts`

**Interfaces:**
- Consumes: Task 2 `deriveCancellationLines`, `CancellationLineContext`, `CancellationLineDraft`.
- Produces:
  ```ts
  export type BackfillCancellation = { id: string; scope: 'full' | 'partial'; metadata: unknown; effects: unknown; occurredAt: Date; hasLines: boolean };
  export type OrderBackfillPlan =
    | { kind: 'ok'; inserts: Array<CancellationLineDraft & { cancellationId: string }> }
    | { kind: 'ambiguous'; cancellationId: string; reason: string };
  export function planOrderBackfill(lines: CancellationLineContext[], cancellations: BackfillCancellation[]): OrderBackfillPlan;
  ```
  주문 하나의 취소를 `occurredAt`, `id` 순으로 재생한다. `hasLines` 인 취소는 쓰지 않되 그 수량을 prior 에 더한다(배포 뒤 새 취소). `metadata.cancelledLines` 가 배열이 아니거나 항목이 `{salesOrderLineId: string, quantity: number}` 가 아니면, 또는 도출이 throw 하면 그 주문 전체를 `ambiguous` 로 낸다(부분만 쓰지 않는다).

- [ ] **Step 1: 실패하는 테스트를 쓴다:**
  - `replays partial then v1 full in order` — L1 qty 3: partial `[{L1,1}]` → full(cancelledLines 없음) → inserts `[{c1,L1,1,before},{c2,L1,2,before}]`
  - `skips cancellations that already have lines` — 위에서 c1 `hasLines:true` → inserts 는 c2 의 `{L1,2,before}` 하나
  - `reports malformed metadata as ambiguous` — partial `metadata: { cancelledLines: [{ salesOrderLineId: 'L1', quantity: '1' }] }` → `{kind:'ambiguous', cancellationId:'c1'}`
  - `post-shipment partial keeps its phase` — Task 2 의 출고 후 효과를 그대로 → `{L1,1,after_shipment}` 포함
- [ ] **Step 2:** `npx jest scripts/ops/k6-cancellation-lines-backfill.spec.ts` → FAIL.
- [ ] **Step 3:** `planOrderBackfill` 구현. 실행기는 `scripts/ops/1016-14-backfill-line-compositions.ts` 와 같은 모양(`Resource.Db`, `postgres`, 기본 조회만, `--apply`)으로: 취소가 있는 주문을 모두 읽어 주문마다 계획 → 조회 모드는 `ok 주문 수 / 넣을 행 수 / ambiguous 목록`을 찍고, `--apply` 는 주문마다 한 트랜잭션에서 `INSERT … ON CONFLICT DO NOTHING`(unique 키). 사용법 주석에 «PR 1 배포(`migrate → deploy`) 뒤 한 번»을 적는다.
- [ ] **Step 4:** 같은 명령 → PASS. 로컬 DB 에 대해 조회 모드가 끝까지 도는지: 실행기에 `DATABASE_URL` 대체 경로가 없다면 로컬 실행은 건너뛰고 그 사실을 PR 본문에 적는다.
- [ ] **Step 5:** 커밋 — `feat(ops): K6 취소 라인 백필 — 주문별 시간순 재생, 모호하면 주문째 보고 (K6 PR1)`

### Task 6: ADR-0047 과 PR 마무리

**Files:**
- Create: `docs/adr/0047-line-quantity-facts-one-record-one-reader.md`

- [ ] **Step 1:** ADR 을 쓴다(0045·0046 형식). 결정: 라인 수량 사실은 기록 위치 하나·읽는 문 하나, 쓰는 함수는 사실을 만드는 모듈에 남는다. 취소 기록은 `sales_order_cancellation_lines`, 갈래 규칙(구성품 하나라도 나간 단위 = 출고 후). 대체하는 것: `metadata.cancelledLines` 파서 세 벌(PR 6 에서 삭제). 결과: 운영자 «미처리 취소»·FO 취소·수동 배송완료 제거(PR 4) 예고. 스펙 경로 링크.
- [ ] **Step 2:** 게이트: `npm run type-check` → 0, `npx jest` → 실패 0, `npm run test:core:integration:local` → 기준선 대비 새 실패 0.
- [ ] **Step 3:** 커밋 — `docs(adr): 0047 라인 수량 사실 — 기록 위치 하나, 읽는 문 하나 (K6)`
- [ ] **Step 4:** PR 을 연다(`mattpocock-skills:pr` 로 본문). 본문에 배포 절차를 적는다:
  1. `npm run deploy:preflight -- --stage live` (배치 배포 방침)
  2. `db:migrate`(live) → `sst deploy` → Core 롤아웃 완료 확인(ECS `describe-services` 의 td·시각)
  3. 백필 조회 모드 → ambiguous 목록 검토 → `--apply`
  4. 게이트 SQL — 라인 행이 없는 취소 0:
     ```sql
     SELECT count(*) FROM sales_order_cancellations c
     WHERE NOT EXISTS (SELECT 1 FROM sales_order_cancellation_lines l WHERE l.cancellation_id = c.id);
     ```
     기대: ambiguous 로 보고된 수와 같다(그 밖 0). 0 이 아닌 나머지가 PR 2 착수의 차단 조건이다.
  5. 대조 SQL — 라인별 `Σ 라인 행 = Σ partial metadata + V1 전체 역산` 이 갈리는 라인 0(빌더가 백필 순수 함수와 같은 규칙으로 SQL 을 쓴다).
