# K8 PR 4 — 원장 «반품» 상태(`RETURNED`)와 전이 셋, 뷰·상태 목록 반영 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** core 원장에 «반품» 상태를 더하고(`stock_state = 'RETURNED'`), 반품 입고·합격·불합격 세 전이를 `InventoryCommandService` 의 메서드 셋이 고정하며, 재고 뷰·읽기·화면 라벨이 새 상태를 안다. 판매가능수량은 바뀌지 않는다 — 호출자 0, 휴면 expand.

**Architecture:** ① 스키마 enum 둘에 값 추가 + `stock_summary_view` 에 `returned_qty` 칸 → 생성 마이그레이션 하나. ② `InventoryCommandService.returnReceive/returnAccept/returnReject` — 위치는 그 창고의 `return_default` 시스템 위치로 메서드가 정하고, 쓰기는 `StockEventStore.createEvent` 만 한다. ③ 상태를 박아 둔 읽기(물리 재고 합계·재고 금액·창고 요약)와 계약 타입·admin-web 라벨·warehouse-app 주석을 맞춘다.

**Tech Stack:** NestJS + Drizzle(core, postgres 16), drizzle-kit generate/migrate, Jest(core unit·`describeIfDb` 통합), admin-web(Next.js, tsc).

**Spec:** `docs/superpowers/specs/2026-10-26-k8-returns-on-medusa-design.md` — §4.6(원장 «반품» 상태), §7(배포 순서 — expand, `migrate → deploy`), §8 PR 4. 결정 D2. PR 5·6 이 이 메서드를 부른다(검수 → `RETURN_ACCEPT`/`RETURN_REJECT`, 환불 보류도 `RETURN_REJECT`).

## 코드에서 확인한 것 (develop `5bb87163e`)

- enum: `stockStateEnum` 3값(`ON_HAND`·`DEFECTIVE`·`IN_TRANSFER`), `transitionTypeEnum` 9값(`inventory.schema.ts:36-55`). DB CHECK 는 `ck_events_states_diff`·`ck_events_side_present` 등 모양만 보고 상태 값은 안 본다 — 같은 위치 안 상태 전이가 이미 허용된다.
- `StockEventStore.createEvent`(`stock-event.store.ts:91`)는 from/to 를 그대로 원장에 반영하고 판매가능수량을 다시 계산한다. ON_HAND 감소 가드(`hasOnHandSourceDecrement`)는 `fromState === 'ON_HAND'` 일 때만 — 세 전이는 해당 없다. `RETURN_ACCEPT` 는 ON_HAND 를 늘리므로 그 순간 판매가능수량에 잡힌다(판매성은 창고 단위). 합격분을 적치 위치로 옮기는 건 그다음의 평범한 `MOVE` 다(§4.6).
- **`getReversalType`(`stock-event.store.ts:977`)이 `Record<TransitionType, TransitionType>`** 이라 enum 을 늘리면 `type-check` 가 막힌다. 역분개는 from/to 를 뒤집어 같은 원장 반영을 하고, ON_HAND 를 줄이는 역분개는 예약 불변식 가드를 탄다(`reversalOnHandDecrement`) — `RETURN_ACCEPT` 역분개(ON_HAND → RETURNED)가 여기 걸린다. 호출자: 관리자 역분개(`stock-projection.manager.ts:10`), 입고 취소(`inbound-receipt.kernel.ts:238`).
- 상태 전이를 담는 `MOVE` 선례: `transferShip` 이 `MOVE` 로 ON_HAND → IN_TRANSFER 를 쓴다(`inventory-command.service.ts:355`).
- `stock_summary_view` 를 읽어 «실재고»를 `onHandQty + defectiveQty + inTransferQty` 로 손으로 더하는 곳이 다섯(`stock-projection.reader.ts:134,164,206,271,278`), 0 아닌 행 필터 하나(`:80`). 가용(`available_qty`)은 ON_HAND − 예약이라 새 상태와 무관하다.
- 상태를 ON_HAND·IN_TRANSFER 로 거르는 읽기(가용 모듈·대사·실사·이동·보충·입고 파이프라인)는 그대로 둔다 — RETURNED 는 저절로 빠진다.
- `warehouse.reader.ts:89-110` `getStockSummary` 의 `totalAvailable` 이 전 상태 합이다(admin-web `warehouses.client.ts:55` 가 부른다). RETURNED 가 생기면 검수 전 물건이 «가용»에 더해진다.
- `stock-valuation.reader.ts:22,101` 이 상태 셋을 박아 두었고 DTO(`stock-valuation.dto.ts:9-10`)·admin-web(`stock-valuation.client.ts:9`, 통계 `inventory.tsx:16-20` 라벨)가 같다. 맵에 없는 상태의 행은 집계에서 **조용히 빠진다.**
- `return_default` 위치: `LocationService.getSystemLocationByRole(warehouseId, 'return_default', tx)` — 없으면 `NotFoundException`. `ensureSystemLocations` 가 멱등으로 만든다. 라이브 창고 넷 모두 있다(설계 §4.3).
- 계약 `packages/event-contracts/streams/inventory.stream.ts:12` 의 `StockState` 는 **타입만** 있고 zod 스키마·사용처가 없다 — 소비자 선배포 제약이 생기지 않는다.

## 이름 붙은 결정

- **N1. 뷰는 새 enum 값을 `stock_state::text = 'RETURNED'` 로 비교한다.** drizzle migrate 는 대기 중인 마이그레이션 **전부를 한 트랜잭션**으로 돌린다(`drizzle-orm/pg-core/dialect.js:60`). 그 안에서 `ALTER TYPE … ADD VALUE` 한 값을 `= 'RETURNED'` 로 쓰면 PG 가 `unsafe use of new value "RETURNED"` 로 거절한다 — 마이그레이션 파일을 나눠도 같은 실행에 실리면 소용없다(빈 DB 부트스트랩은 늘 그렇다). `::text` 비교는 enum 입력 변환을 안 거쳐 통과한다(2026-10-26 postgres 16 실측). 설계 §7 의 «값 추가와 사용을 다른 마이그레이션으로»는 이 처방으로 고친다(Task 4).
- **N2. 세 메서드는 위치를 받지 않는다.** 언제나 그 창고의 `return_default` 다(§4.6). RETURNED 를 옮기는 경로가 없으므로(`moveInternal` 은 ON_HAND 고정) 합격·불합격도 같은 위치에서 상태만 바꾼다. 호출자가 엉뚱한 위치를 줄 길을 없앤다.
- **N3. `idempotencyKey` 는 필수.** 호출자(PR 6)는 Kafka 명령·재시도로 들어온다. `createEvent` 의 unique dedupe 가 같은 키의 두 번째 호출을 기존 이벤트로 돌려준다.
- **N4. 역분개 타입: `RETURN_RECEIVE → ADJUST_DOWN`, `RETURN_ACCEPT → MOVE`, `RETURN_REJECT → MOVE`.** `RECEIVE → ADJUST_DOWN` 과 같고, 같은 위치 상태 전이는 `MOVE` 가 이미 담는다(`transferShip` 선례). 새 «되돌림» 타입을 만들지 않는다. 맵은 `reversalTransitionType(t)` 로 꺼내 export 해 단위 테스트로 고정한다.
- **N5. «실재고»(물리 합계)는 RETURNED 를 포함하고, 가용은 포함하지 않는다.** 창고 안에 있는 물건이라서다. 다섯 군데 손 덧셈은 `physicalQuantity(row)` 하나로 모은다. 창고 요약 `totalAvailable` 은 ON_HAND 합으로 고친다(이름은 API 호환 때문에 둔다).

## Global Constraints

- 사는 곳: `apps/core`(스키마·마이그레이션·inventory), `packages/event-contracts`(타입 한 줄), `apps/admin-web`(타입·라벨), `native/warehouse-app`(주석 한 줄), 설계 문서. **channel-adapter·medusa 변경 없음.**
- 배포: **expand, `migrate → deploy`.** 새 코드가 새 enum 값·뷰 칸을 읽으므로 마이그레이션이 먼저다. 옛 코드는 `returned_qty` 를 안 읽고 RETURNED 행이 0이라 마이그레이션 뒤 옛 task 도 안전하다. 배치 배포(`npm run deploy:preflight -- --stage live`)를 따른다.
- 휴면: 세 메서드의 호출자는 0 이다(PR 6 이 부른다). 라이브 원장에 RETURNED 행이 생기지 않는다.
- 마이그레이션은 `npm run db:generate:core -- --name add-returned-stock-state` 로 **생성**한다. 손으로 고칠 수 있는 건 없다 — N1 의 `::text` 는 `schema.ts` 의 뷰 SQL 에 쓴다.
- 레이어·트랜잭션: `dbService.run(fn, tx)`(ADR-0025), 원장 쓰기는 `StockEventStore.createEvent` 만(`inventory-write-boundary.arch.spec.ts`). `MARK_DEFECT`·`REWORK_GOOD` 는 건드리지 않는다(§4.6).
- 게이트: `npm run type-check`, `npx jest apps/core/src/modules/inventory`, core 통합은 **빈 scratch DB**로(Task 1 Step 4 — 로컬 `core` DB 는 마이그 이력이 어긋나 있을 수 있다), `(cd apps/admin-web && npx tsc --noEmit)`, `npm run test:admin-web`.

## Review Focus

1. **빈 DB 부트스트랩** — 전체 마이그레이션을 한 번에 적용해도 성공한다(N1 의 회귀가 여기서만 드러난다). Task 1 Step 4.
2. **검수 전 물건이 팔린다** — `returnReceive` 뒤 `stock_summary_view.available_qty` 와 가용 모듈(`readWarehouseAvailability`)이 그대로, `returned_qty` 만 오른다. Task 2 통합 + Task 3 뷰 파리티.
3. **들어온 것보다 많이 검수** — RETURNED 3개에 `returnAccept` 4개는 거절되고 원장·이벤트가 그대로다(`createEvent` 의 조건부 감소). Task 2 통합.
4. **같은 검수 명령이 두 번** — 같은 `idempotencyKey` 로 `returnAccept` 두 번이면 이벤트 1개, ON_HAND 한 번만 오른다. Task 2 통합.
5. **합격 되돌리기가 예약을 깬다** — 합격으로 늘어난 ON_HAND 에 confirmed 예약이 걸린 뒤 그 `RETURN_ACCEPT` 를 역분개하면 예약 불변식 가드가 거절한다. Task 2 통합.

---

### Task 1: 스키마 enum·뷰 칸·마이그레이션, 역분개 맵

**Files:**
- Modify: `apps/core/src/modules/inventory/schema/inventory.schema.ts:36-55`(enum 둘), `:1213-1290`(뷰 칸·SQL)
- Create(생성): `apps/core/drizzle/<timestamp>_add-returned-stock-state.sql`, `apps/core/drizzle/meta/*`
- Modify: `apps/core/src/modules/inventory/core/repositories/stock-event.store.ts:977-994`
- Test: `apps/core/src/modules/inventory/core/repositories/stock-event.store.reversal-direction.spec.ts`(케이스 추가)

**Interfaces:**
- Produces:
  - `stockStateEnum` 끝에 `'RETURNED'`(주석 «반품 — 검수 대기, 판매 불가»). `transitionTypeEnum` 끝에 `'RETURN_RECEIVE'`(null → RETURNED), `'RETURN_ACCEPT'`(RETURNED → ON_HAND), `'RETURN_REJECT'`(RETURNED → DEFECTIVE).
  - 뷰 칸 `returnedQty: integer('returned_qty').notNull().default(0)` — `inTransferQty` 다음. SQL 은 `COALESCE(returned.qty, 0) as returned_qty` + `LEFT JOIN (… WHERE stock_state::text = 'RETURNED' …) returned`. 그 JOIN 위에 N1 이유를 두 줄 주석으로.
  - `export function reversalTransitionType(t: TransitionType): TransitionType` — 지금 private 맵을 옮긴 것 + N4 의 세 줄. `getReversalType` 은 지우고 호출부(`:667`)가 이걸 부른다.

- [ ] **Step 1: 실패하는 테스트** — `describe('reversalTransitionType')`: `RETURN_RECEIVE → 'ADJUST_DOWN'`, `RETURN_ACCEPT → 'MOVE'`, `RETURN_REJECT → 'MOVE'`, 그리고 기존 `RECEIVE → 'ADJUST_DOWN'`·`SHIP → 'ADJUST_UP'` 이 그대로.
- [ ] **Step 2:** `npx jest apps/core/src/modules/inventory/core/repositories/stock-event.store.reversal-direction` → FAIL(`reversalTransitionType` 없음).
- [ ] **Step 3: 구현** — enum·뷰(위 Interfaces) + `reversalTransitionType`. 그다음 `npm run db:generate:core -- --name add-returned-stock-state`. 생성 SQL 이 `ALTER TYPE "public"."stock_state" ADD VALUE 'RETURNED'`, `transition_type` 셋, `DROP VIEW` + `CREATE VIEW`(`::text` 포함)만 담는지 본다. 다른 것이 섞이면 `git rm` 하고 스키마를 고쳐 다시 만든다(CLAUDE.md).
- [ ] **Step 4: 빈 DB 부트스트랩** —
  ```bash
  docker compose exec -T postgres psql -U postgres -c 'DROP DATABASE IF EXISTS core_k8pr4' -c 'CREATE DATABASE core_k8pr4'
  DATABASE_URL=postgresql://postgres:postgres@localhost:5432/core_k8pr4 npx drizzle-kit migrate --config apps/core/drizzle.config.ts
  ```
  Expected: 에러 없이 끝남. 이어서 `psql … -d core_k8pr4 -c "\d+ stock_summary_view"` 에 `returned_qty` 가 있다. (같은 DB 를 Task 2·3 통합 테스트가 쓴다.) 뷰 SQL 을 `= 'RETURNED'` 로 바꾸면 여기서 `unsafe use of new value` 로 실패하는 것을 한 번 확인하고 되돌린다.
- [ ] **Step 5:** `npx jest apps/core/src/modules/inventory/core/repositories/stock-event.store.reversal-direction` PASS, `npm run type-check` 에러 0.
- [ ] **Step 6: 커밋** — `schema.ts` + 생성 SQL + `drizzle/meta/` + `stock-event.store.ts` + 스펙을 **한 커밋**(CLAUDE.md «Daily cycle» 5).

### Task 2: `InventoryCommandService` 반품 전이 셋

**Files:**
- Modify: `apps/core/src/modules/inventory/core/services/inventory-command.service.ts`(메서드 셋 + private 위치 헬퍼, `moveInternal` 뒤)
- Test: Create `apps/core/src/modules/inventory/core/services/inventory-command.service.return.integration.spec.ts`

**Interfaces:**
- Consumes: Task 1 의 enum 값.
- Produces (PR 6 이 부른다):
  ```ts
  type ReturnStockInput = {
    skuId: string;
    warehouseId: string;
    quantity: number;
    idempotencyKey: string;
    occurredAt?: Date;
    reason?: string;
  };
  returnReceive(input: ReturnStockInput, tx?: DbTx): Promise<{ eventId: string | null }> // null → RETURNED
  returnAccept(input: ReturnStockInput, tx?: DbTx): Promise<{ eventId: string | null }>  // RETURNED → ON_HAND
  returnReject(input: ReturnStockInput, tx?: DbTx): Promise<{ eventId: string | null }>  // RETURNED → DEFECTIVE
  ```
  셋 다 `quantity <= 0` 이면 `BadRequestException`(파일 관례), 위치는 `locationService.getSystemLocationByRole(warehouseId, 'return_default', trx)`, from/to 창고·위치는 둘 다 그 창고·위치(접수만 to 쪽만). 이벤트를 못 만들면(`createEvent` 가 null) `receive` 처럼 `BadRequestException`. 셋의 몸통이 같으니 `(from, to, transitionType)` 을 받는 private 헬퍼 하나가 쓴다.

- [ ] **Step 1: 실패하는 테스트** — `adjust.integration.spec.ts` 의 구성(rollback 전용 트랜잭션, 수동 `DbService` 조립)을 따르고, 픽스처는 창고·SKU + `location.ensureSystemLocations(warehouse.id, tx)`. 원장 판독 헬퍼 `ledgerQty(tx, skuId, warehouseId, state)`(`return_default` 위치). 케이스:
  - `returnReceive 3` → RETURNED 3, ON_HAND 0, `readWarehouseAvailability(...).available === 0`, 이벤트 `transitionType 'RETURN_RECEIVE'`·`fromState null`·`toState 'RETURNED'`.
  - 이어서 `returnAccept 2` + `returnReject 1` → RETURNED 0, ON_HAND 2, DEFECTIVE 1, 가용 2.
  - `returnAccept 4`(RETURNED 3) → reject, RETURNED 3 그대로·`RETURN_ACCEPT` 이벤트 0 (Review Focus 3).
  - 같은 `idempotencyKey` 로 `returnAccept 1` 두 번 → 같은 `eventId`, ON_HAND 1 (Review Focus 4).
  - `return_default` 가 없는 창고(`ensureSystemLocations` 안 부름) → `NotFoundException`.
  - 합격 2 뒤 confirmed 예약 2(`adjust.integration.spec.ts:150-163` 처럼 `seedShipmentLineFor` 로 상자 라인을 심고 `stockReservations` 에 `targetType 'SHIPMENT_LINE'`·`status 'confirmed'` 행을 넣는다) → 그 `RETURN_ACCEPT` 이벤트를 `eventStore.reverseEvent` 하면 reject, ON_HAND 2 그대로 (Review Focus 5). 예약이 없으면 역분개가 성공하고 이벤트가 `transitionType 'MOVE'`·ON_HAND → RETURNED.
- [ ] **Step 2:** `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/core_k8pr4 npx jest --testPathPattern 'inventory-command.service.return.integration' --runInBand` → FAIL(메서드 없음).
- [ ] **Step 3: 구현** — 위 Interfaces 대로.
- [ ] **Step 4:** 같은 명령 PASS. `npx jest apps/core/src/modules/inventory/core` PASS(`inventory-write-boundary.arch.spec.ts` 포함).
- [ ] **Step 5: 커밋.**

### Task 3: core 읽기 — 물리 합계·재고 금액·창고 요약·DTO

**Files:**
- Create: `apps/core/src/modules/inventory/stock-projection/services/physical-quantity.ts`
- Modify: `stock-projection/services/stock-projection.reader.ts:40-50,80,134,164,206-212,271,278`, `stock-projection/dto/current-stock.dto.ts`, `stock-projection/dto/location-contents.dto.ts:13`(설명 문자열)
- Modify: `stock-valuation/services/stock-valuation.reader.ts:22,101`, `stock-valuation/dto/stock-valuation.dto.ts:9-10`
- Modify: `warehouse/services/warehouse.reader.ts:89-110`
- Test: Create `stock-projection/services/physical-quantity.spec.ts`, `warehouse/services/warehouse.reader.integration.spec.ts`(케이스 하나 — 기존 `warehouse.reader.spec.ts` 는 목 DB 라 SQL 필터를 못 본다); Modify `shared/availability/view-parity.integration.spec.ts`, `stock-valuation/services/stock-valuation.reader.integration.spec.ts`(케이스 추가)

**Interfaces:**
- Consumes: Task 1 의 `stockSummary.returnedQty`, Task 2 의 `returnReceive`(통합 테스트 픽스처).
- Produces:
  - `export function physicalQuantity(s: { onHandQty: number; defectiveQty: number; inTransferQty: number; returnedQty: number }): number` — 넷의 합. 다섯 군데 손 덧셈이 이걸 부른다.
  - `CurrentStockDto.returnedQty: number`(`@ApiProperty({ description: '반품 검수 대기 (RETURNED)' })`), `getBySkuAndWarehouse` 의 `summary` 객체에 `returnedQuantity`(`defectiveQuantity` 옆, 인라인 타입). 0 아닌 행 필터(`:80`)에 `returnedQty <> 0` 추가.
  - 재고 금액: `StockState` 와 상태 루프·DTO enum 에 `'RETURNED'`.
  - 창고 요약: `totalAvailable` = ON_HAND 행만의 합(`sum(qty) filter (where stock_state = 'ON_HAND')` 를 칸으로 더 뽑거나 같은 뜻의 방법), `totalQuantity` 는 전 상태 합 그대로. 메서드 위에 «RETURNED·DEFECTIVE·IN_TRANSFER 는 가용이 아니다» 한 줄.

- [ ] **Step 1: 실패하는 테스트** —
  - `physicalQuantity({ onHandQty: 1, defectiveQty: 2, inTransferQty: 3, returnedQty: 4 }) === 10`.
  - view-parity: `returnReceive 3`(ON_HAND 5 가 있는 SKU) → 뷰 `returned_qty 3`·`on_hand_qty 5`·`available_qty` 와 가용 모듈 값이 같고 둘 다 5 (Review Focus 2).
  - 재고 금액(`stock-valuation.reader.integration.spec.ts` 의 «상태별·창고별 집계» 옆): RETURNED 행이 있으면 `getSummary()` 상태 집계에 `state: 'RETURNED'` 항목이 있고 수량이 그 합이다.
  - 창고 요약(`warehouse.reader.integration.spec.ts`, rollback 전용·`describeIfDb`): ON_HAND 5 + RETURNED 3 → `totalQuantity 8`, `totalAvailable 5`.
- [ ] **Step 2:** `npx jest apps/core/src/modules/inventory/stock-projection/services/physical-quantity` FAIL, 통합은 `DATABASE_URL=…/core_k8pr4 npx jest --testPathPattern '(view-parity|stock-valuation|warehouse\.reader).*integration' --runInBand` FAIL.
- [ ] **Step 3: 구현.**
- [ ] **Step 4:** 위 두 명령 PASS, `npx jest apps/core/src/modules/inventory` PASS, `npm run type-check` 0.
- [ ] **Step 5: 커밋.**

### Task 4: 계약 타입·admin-web·warehouse-app·설계 문서

**Files:**
- Modify: `packages/event-contracts/streams/inventory.stream.ts:12`
- Modify: `apps/admin-web/src/lib/types/dto/inventory.ts:670-678`, `apps/admin-web/src/features/inventory/status/components/stock-history-drawer/index.tsx:24-33`, `apps/admin-web/src/lib/api/domains/inventory/stock-valuation.client.ts:9`, `apps/admin-web/src/features/statistics/template/inventory.tsx:16-20`
- Modify: `native/warehouse-app/src/domains/movement/types.ts:6`(주석)
- Modify: `docs/superpowers/specs/2026-10-26-k8-returns-on-medusa-design.md` §4.6·§7

**Interfaces:**
- 계약: `StockState = 'ON_HAND' | 'DEFECTIVE' | 'IN_TRANSFER' | 'RETURNED'`.
- admin-web: `StockTransitionType` 에 셋 추가. 전이 라벨 `RETURN_RECEIVE: '반품 입고'`, `RETURN_ACCEPT: '반품 양품'`, `RETURN_REJECT: '반품 불량'`. 상태 라벨 `RETURNED: '반품 검수 대기'`. 재고 금액 `state` 유니언에 `'RETURNED'`.
- 설계 §7 첫 줄의 «값 추가와 사용을 다른 마이그레이션으로»를 N1 로 교체(drizzle 이 대기 마이그 전부를 한 트랜잭션으로 돌리므로 파일 분리는 효과 없음 → 새 값은 `::text` 로 비교, 빈 DB 부트스트랩으로 확인). §4.6 끝에 «PR 4 에서 확정»: 메서드 이름 셋, 위치 고정(N2), 역분개 타입(N4), 물리 합계 포함·창고 요약 `totalAvailable` 교정(N5).

- [ ] **Step 1:** 위 변경.
- [ ] **Step 2:** `(cd apps/admin-web && npx tsc --noEmit)` 에러 0(이 PR 파일), `npm run test:admin-web` PASS, `(cd native/warehouse-app && npx tsc -b)` 0, `npm run type-check` 0.
- [ ] **Step 3: 최종 게이트** — `npx jest` 전체 실패 0, Task 1 Step 4 의 빈 DB 부트스트랩을 DB 를 새로 만들어 한 번 더.
- [ ] **Step 4: 커밋.** scratch DB 는 지운다(`DROP DATABASE core_k8pr4`).
