# K1 피킹 작업 항목 명령 커널 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 작업 항목을 전진시키는 피킹 명령 7개가 한 문(커널)을 지나게 하고(K1a), `completePick`·`unpickShipment`·`handoff` 본문을 세 전략이 한 벌로 공유하게 한다(K1b).

**Architecture:** 커널은 Nest provider 가 아니라 **함수 모듈**이다. 전략은 이미 주입받는 `commands`·`workflowGate`·`labels`(K1b 에서 `sessions`·`batches` 추가)를 deps 객체로 넘긴다. 그래서 전략 생성자와 spec fixture 의 생성자 인자는 바뀌지 않는다. K1b 에서 전략은 본문 대신 `PickingCustodyPolicy` 값(소유자 조회 함수 하나와 후처리 하나를 포함)을 넘기고, 판정은 순수 함수 파일 하나에 모은다.

**Tech Stack:** NestJS 11, Drizzle ORM(postgres.js), Jest(ts-jest, isolatedModules), 실제 DB 통합 spec 은 rollback 트랜잭션(`inRollbackTx`).

**Spec:** `docs/superpowers/specs/2026-10-19-k1-picking-work-item-command-kernel-design.md` (이하 «설계»). 실행자는 이 계획과 설계를 둘 다 읽는다.

## Global Constraints

- **`commandType`·`workflowGate` 이름·`canonicalRequest`·명령 멱등 키·내부 `moveCustody` 멱등 키 접두사·에러 `code`·에러 `message` 를 한 글자도 바꾸지 않는다.** 예외는 설계 §5.4 의 D1·D2·D3 셋뿐이다. 내부 키 접두사는 전략마다 불규칙하다. 예: tote 는 `pick-to-tote-complete:` 인데 `pick_to_tote-unpick:`·`pick_to_tote-handoff-claim:` 이다. 지금 코드에서 그대로 복사한다.
- 커널이 고정하는 전진 순서(설계 §4.2): `assertV2MutationAllowed(commandType)` → `commands.execute` → 선행 advisory 락 → `lockAndAssertPickerClaim` → `labels.assertCurrent` → `assertActiveBatchSession` → 본문.
- 커널은 `lockAndAssertPickerClaim` 을 **부르기만** 한다. 다시 구현하지 않는다. 계약 spec 이 이 함수를 mock 한다.
- 선행 advisory 락 SQL 은 지금과 같아야 한다: `` sql`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))` ``. aggregate `sortScan` 의 키는 `aggregate-cart:${cartId}`.
- **클래스 필드 초기화식에서 생성자 parameter property 를 읽지 말 것.** `tsconfig.json` 이 `"target": "ES2023"` 이라 `useDefineForClassFields` 가 켜져 있다. 그래서 `private x = f(this.commands)` 는 `undefined` 를 읽는다. deps·policy 는 메서드 안에서 만든다.
- 마이그레이션 없음. API 응답 모양 불변.
- 레이어·트랜잭션 규칙은 CLAUDE.md 그대로다: `DbTx` 를 `inventory.schema` 에서 import 하고, `any`·`as` 캐스팅을 금지하며, 공개 함수는 마지막 인자로 `tx?: DbTx` 를 받는다.
- 게이트: `npm run type-check` 0, `npx jest` 실패 0. 메모리 부족으로 jest 가 죽으면 `npx jest --maxWorkers=2`.
- 통합 spec 실행은 `npm run test:core:integration:local -- <패턴>` 이다. 워크트리에서는 앞에 `COMPOSE_PROJECT_NAME=almondyoung-server` 를 붙인다. 패턴이 안 걸리면 `npx jest --runTestsByPath <파일>`(DB env 는 러너가 주입).
- 커밋 메시지 끝에 `Claude-Session: https://claude.ai/code/session_01MVGdJ2AhJEns6zfDmBtMbD`.

## Review Focus

- **멱등 재시도:** 같은 `idempotencyKey` 로 다시 보낸 `completePick`·`unpickShipment` 은 저장된 응답을 그대로 돌려줘야 하고, custody 를 두 번 옮기면 안 된다. → Task 7 에 unpick 재시도 단언을 둔다(완료 재시도는 `commands.execute` 공통 경로라 unpick 하나로 대표한다).
- **tote 락 순서:** tote 의 소유자 조회(`loadActiveShipmentToteRefs`)는 토트 advisory 락과 배정 행 `FOR UPDATE` 를 잡는다. `completePick` 에서는 배정 로드 직후·루프 전에 한 번, `unpickShipment` 에서는 grain 검사 뒤 `picking` 일 때만, `handoff` 에서는 `batches.handoff` 전·후에 한 번씩 불려야 한다. → Task 10 의 단위 spec 이 호출 횟수·조건을 단언한다.
- **aggregate 부분 PACKING:** `sortScan` 이 일부를 바로 `PACKING` 으로 보낸 뒤의 `completePick` 은 성공해야 하고, `SORTING` 몫만 옮겨야 한다. → Task 9 판정 spec 과 Task 13 에 둔다.
- **관리자의 ready_to_pack 되돌림:** 이전 피커가 아닌 `logistics_manager`·`master` 는 되돌릴 수 있고, 그 밖의 작업자는 `PICKING_UNPICK_FORBIDDEN` 을 받는다. → Task 7 에 둔다.
- **인계 뒤 리스:** 인계 응답의 `leaseVersion` 은 `batches.handoff` 가 올린 값이어야 한다. 그 값으로 새 피커가 `completePick` 을 할 수 있어야 한다. → Task 8 에 둔다.

---

## 파일 구조

| 파일 | 책임 | 단계 |
|---|---|---|
| `apps/core/src/modules/fulfillment/picking/work-item-command.ts` (신규) | 전진 문 `runForwardWorkItemCommand`, 그리고 K1b 의 `completeWorkItemPick`·`unpickWorkItemShipment`·`handoffWorkItemPicker` | K1a·K1b-2 |
| `.../picking/work-item-command.spec.ts` (신규) | 커널 호출 순서·정책 호출 위치 단위 spec | K1a·K1b-2 |
| `.../picking/work-item-custody-judgement.ts` (신규) | 순수 판정 `judgeCompleteAllocation`·`judgeHeldCustody`·`judgeUnpickCustody` | K1b-2 |
| `.../picking/work-item-custody-judgement.spec.ts` (신규) | 판정 spec, D3 순서 포함 | K1b-2 |
| `.../picking/work-item-command.guard.spec.ts` (신규) | 우회 금지 가드. 옛 `label-currency-gate.guard.spec.ts` 를 대체한다 | K1a·K1b-2 |
| `.../picking/label-currency-gate.guard.spec.ts` | 삭제 | K1a |
| `.../picking/{discrete-picking,pick-to-tote,aggregate-then-sort}.strategy.ts` | 커널 사용으로 전환 | K1a·K1b-2 |
| `.../services/__support__/outbound-v2-warehouse-harness.ts` (신규) | 시나리오 spec 의 하네스를 그대로 옮긴 것 | K1b-1 |
| `.../services/outbound-v2-warehouse-scenarios.integration.spec.ts` | 하네스 import 로 전환(동작 불변) | K1b-1 |
| `.../picking/picking-rollback.characterization.integration.spec.ts` (신규) | unpick·handoff 특성 테스트, 세 전략 | K1b-1 (K1b-2 에서 D1·D3 기대값만 수정) |
| `docs/adr/0045-picking-custody-commands-share-one-kernel.md` (신규) | ADR-0030 custody 조항 부분 대체 | K1b-2 |
| `docs/adr/0030-*.md` | 대체 사실 한 줄 | K1b-2 |

PR 셋: **K1a = Task 1~5**, **K1b-1 = Task 6~8**, **K1b-2 = Task 9~15**. 브랜치는 PR 마다 develop 에서 딴다.

---

## K1a — 전진 명령의 문 (동작 불변)

### Task 1: 전진 문 함수

**Files:**
- Create: `apps/core/src/modules/fulfillment/picking/work-item-command.ts`
- Test: `apps/core/src/modules/fulfillment/picking/work-item-command.spec.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface WorkItemCommandDeps {
    commands: FulfillmentCommandService;
    workflowGate: FulfillmentWorkflowGate;
    labels: Pick<LabelCurrencyGuard, 'assertCurrent'>;
  }
  /** 7개 전진 입력이 모두 가진 필드. */
  export interface WorkItemCommandTarget {
    batchId: string; sessionId: string; workItemId: string; shipmentId: string;
    actor: PickingActor; expectedLeaseVersion: number; idempotencyKey: string;
  }
  export interface ForwardWorkItemCommand {
    strategy: PickingStrategyName;
    commandType: string;          // workflowGate 이름과 같다
    canonicalRequest: unknown;    // 전략이 지금 만드는 객체 그대로
    target: WorkItemCommandTarget;
    locksBefore?: readonly string[]; // advisory 락 키, 순서대로
  }
  export function runForwardWorkItemCommand<T>(
    deps: WorkItemCommandDeps,
    command: ForwardWorkItemCommand,
    body: (trx: DbTx, commandRequestId: string) => Promise<FulfillmentCommandResult<T>>,
    tx?: DbTx,
  ): Promise<T>;
  ```
  `labels` 를 `Pick<…, 'assertCurrent'>` 로 받는 이유: 기존 unit fixture 가 `{ assertCurrent: jest.fn() }` 를 넘기므로 캐스팅 없이 맞는다.

- [ ] **Step 1: 실패하는 spec 작성.** `jest.mock('./allocation/allocation.queries', …)` 로 `lockAndAssertPickerClaim`·`assertActiveBatchSession` 을 jest.fn 으로 둔다. `commands.execute` 는 `(input, handler, tx) => handler(fakeTrx, 'cmd-1', 'hash')` 로 흉내 낸다. `fakeTrx.execute` 도 jest.fn 으로 둔다. 테스트 셋:
  - `it('runs gate → execute → locksBefore → claim → label gate → session → body in that order')`: 공유 `calls: string[]` 배열에 각 mock 이 이름을 push 한다. 기대값은 `['workflowGate:picking.x.y', 'execute', 'lock', 'claim', 'label', 'session', 'body']`.
  - `it('passes commandType, trimmed-as-given idempotencyKey and canonicalRequest to commands.execute unchanged')`: `execute` 첫 인자 `toEqual({ commandType, idempotencyKey: target.idempotencyKey, canonicalRequest })`.
  - `it('calls lockAndAssertPickerClaim with (trx, workItemId, batchId, shipmentId, actor.id, expectedLeaseVersion)')`, `assertActiveBatchSession` 은 `(trx, sessionId, batchId, strategy)`, `labels.assertCurrent` 는 `(workItemId, trx)`.
  - `it('takes no advisory lock when locksBefore is omitted')`: `fakeTrx.execute` 호출 0.
- [ ] **Step 2: 실행해 실패 확인.** `npx jest apps/core/src/modules/fulfillment/picking/work-item-command.spec.ts` → FAIL(모듈 없음).
- [ ] **Step 3: `runForwardWorkItemCommand` 구현.** 순서는 Global Constraints 대로. `locksBefore` 는 `for … of` 로 하나씩 `await trx.execute(sql\`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))\`)`.
- [ ] **Step 4: 실행해 통과 확인.** 같은 명령 → PASS.
- [ ] **Step 5: 커밋.** `refactor(fulfillment): 피킹 전진 명령의 문 — runForwardWorkItemCommand (K1a)`

### Task 2: discrete 의 `scan`·`completePick` 이 문을 지난다

**Files:**
- Modify: `apps/core/src/modules/fulfillment/picking/discrete-picking.strategy.ts` (`scan` :53-171, `completePick` :275-402)

**Interfaces:**
- Consumes: Task 1 의 `runForwardWorkItemCommand`, `WorkItemCommandDeps`.

- [ ] **Step 1: 기존 spec 이 초록인지 기준선 확인.** `npx jest apps/core/src/modules/fulfillment/picking` → PASS 기록.
- [ ] **Step 2: 두 메서드 전환.** `commands.execute` 이전의 입력 검증(`scan` 의 strategy 검사, `assertPositiveQuantity`)은 문 밖에 그대로 둔다. `assertV2MutationAllowed`·`commands.execute`·`lockAndAssertPickerClaim`·`labels.assertCurrent`·`assertActiveBatchSession` 다섯 호출과 `// 낡은 송장으로는…` 주석을 지운다. 본문은 그 다음 줄부터 그대로 `body` 로 옮긴다. deps 는 `private forwardDeps(): WorkItemCommandDeps { return { commands: this.commands, workflowGate: this.workflowGate, labels: this.labels }; }`(필드 아님 — Global Constraints).
- [ ] **Step 3: 검증.** `npx jest apps/core/src/modules/fulfillment/picking` → Step 1 과 같은 결과. `npm run type-check` → 0. 기대값을 고친 spec 이 있으면 안 된다.
- [ ] **Step 4: 커밋.** `refactor(fulfillment): discrete 전진 명령이 커널 문을 지난다 (K1a)`

### Task 3: pick-to-tote 의 `assignTote`·`toteScan`·`completePick`

**Files:**
- Modify: `apps/core/src/modules/fulfillment/picking/pick-to-tote.strategy.ts` (`assignTote` :110, `toteScan` :205, `completePick` :601)

Task 2 와 같은 절차다. `scan`(:198)은 `toteScan` 으로 위임만 하므로 손대지 않는다.

- [ ] **Step 1: 세 메서드 전환**(Task 2 Step 2 와 같은 규칙).
- [ ] **Step 2: 검증.** `npx jest apps/core/src/modules/fulfillment/picking` PASS, `npm run type-check` 0.
- [ ] **Step 3: 커밋.** `refactor(fulfillment): pick-to-tote 전진 명령이 커널 문을 지난다 (K1a)`

### Task 4: aggregate 의 `sortScan`·`completePick`

**Files:**
- Modify: `apps/core/src/modules/fulfillment/picking/aggregate-then-sort.strategy.ts` (`sortScan` :294, `completePick` :647)

- [ ] **Step 1: 두 메서드 전환.** `sortScan` 은 `locksBefore: [\`aggregate-cart:${cartId}\`]` 를 넘기고, 본문 첫 줄 `await this.acquireCartLock(cartId, trx)` 를 지운다. `acquireCartLock` 자체는 다른 메서드(`bulkCartScan`·`cartHandoff` 등)가 계속 쓰므로 남긴다. `cartId`·`cartRef` 계산과 `destinationCustody` 검사는 문 밖에 그대로 둔다.
- [ ] **Step 2: 검증.** `npx jest apps/core/src/modules/fulfillment/picking` PASS, `npm run type-check` 0. 통합: `npm run test:core:integration:local -- outbound-v2-warehouse-scenarios` → 시나리오 07·08·09 PASS(08 이 `sortScan` 경로).
- [ ] **Step 3: 커밋.** `refactor(fulfillment): aggregate 전진 명령이 커널 문을 지난다 — 카트 락은 선행 락 키로 (K1a)`

### Task 5: 가드 교체

**Files:**
- Create: `apps/core/src/modules/fulfillment/picking/work-item-command.guard.spec.ts`
- Delete: `apps/core/src/modules/fulfillment/picking/label-currency-gate.guard.spec.ts`

본은 `picking/allocation/batch-start-entry.guard.spec.ts`(`apps/core/src` 를 걸어 비-spec `.ts` 중 패턴에 맞는 파일 목록을 `toEqual`)이다.

- [ ] **Step 1: 가드 spec 작성.**
  - `it('lockAndAssertPickerClaim 을 부르는 비-spec 파일은 커널과 정의 파일뿐이다')`: `/\blockAndAssertPickerClaim\(/` 매칭 목록 `toEqual(['apps/core/src/modules/fulfillment/picking/allocation/allocation.queries.ts', 'apps/core/src/modules/fulfillment/picking/work-item-command.ts'])`.
  - `it('labels.assertCurrent 를 부르는 비-spec 파일은 커널과 검수·발송 잠금뿐이다')`: `/\.assertCurrent\(/` 매칭 목록 `toEqual([…/services/shipment-dispatch.service.ts, …/picking/work-item-command.ts])`.
  - `it('커널 문은 작업 항목 잠금 다음에 게이트를 부른다')`: `work-item-command.ts` 의 `runForwardWorkItemCommand` 본문에서 `lockAndAssertPickerClaim(` 위치 < `assertCurrent(` 위치.
  - 옛 가드의 `it('검수·발송 공통 잠금(lockAggregate)이 작업 항목 잠금 뒤에 게이트를 부른다')` 는 그대로 옮긴다(`shipment-dispatch.service.ts` 대상).
- [ ] **Step 2: 실행.** `npx jest apps/core/src/modules/fulfillment/picking/work-item-command.guard.spec.ts` → PASS. 일부러 전략 한 곳에 `lockAndAssertPickerClaim(` 호출을 넣어 FAIL 하는지 확인한 뒤 되돌린다.
- [ ] **Step 3: 옛 가드 삭제 후 전체 게이트.** `npm run type-check` 0, `npx jest` 실패 0.
- [ ] **Step 4: 커밋.** `test(fulfillment): 게이트 복사본 가드를 «커널 밖 호출 금지» 가드로 교체 (K1a)`
- [ ] **Step 5: K1a PR.** `mattpocock-skills:pr` 로 본문을 쓴다. 본문에 «동작 불변, 기존 spec 기대값 수정 0» 과 설계 링크를 적는다.

---

## K1b-1 — 특성 테스트 (지금 코드에서 초록)

### Task 6: 시나리오 하네스 추출 (순수 이동)

**Files:**
- Create: `apps/core/src/modules/fulfillment/services/__support__/outbound-v2-warehouse-harness.ts`
- Modify: `apps/core/src/modules/fulfillment/services/outbound-v2-warehouse-scenarios.integration.spec.ts` (:114-830 의 하네스 함수)

**Interfaces:**
- Produces(이름은 지금 spec 의 것 그대로, `db` 클로저를 첫 인자로 끌어올림):
  `ambientDbService(db, tx)`, `makeServices(db, tx)`, `seedWorld(tx, quantities, strategies?)`, `seedRegisteredWaybills(tx, world)`, `createBatchWithShipments(services, world, actor, pickingMethod?, cartCapacity?)`, `discretePickAfterHandoff(…)`, `aggregatePick(…)`, `totePick(…)`, 그리고 `WarehouseWorld`·`Actor` 타입. 기존 spec 이 쓰는 `expect*` 헬퍼는 그 spec 에 남겨도 된다.
- 기존 `__support__/simple-outbound-wiring.ts` 가 같은 폴더의 선례다. `__support__` 는 `batch-start-entry.guard.spec.ts` 의 탐색에서 제외된다.

- [ ] **Step 1: 옮기기.** 함수 본문은 바꾸지 않는다. `expect(...)` 를 쓰는 하네스 함수(`discretePickAfterHandoff` 등의 `expect(started.state)`)는 `@jest/globals` 의 `expect` 를 import 해 그대로 둔다.
- [ ] **Step 2: 검증.** `npm run test:core:integration:local -- outbound-v2-warehouse-scenarios` → 06~10 과 전략 설정 테스트 전부 PASS. `npm run type-check` 0.
- [ ] **Step 3: 커밋.** `test(fulfillment): 출고 시나리오 하네스를 __support__ 로 옮긴다 (K1b-1 준비)`

### Task 7: `unpickShipment` 특성 테스트

**Files:**
- Create: `apps/core/src/modules/fulfillment/picking/picking-rollback.characterization.integration.spec.ts`

**Interfaces:**
- Consumes: Task 6 의 하네스.

구조: `describeIfDb` 아래에 `describe.each([['discrete'], ['pick_to_tote'], ['aggregate_then_sort']])`. 각 `it` 은 `inRollbackTx(db, …)` 안에서 돈다. 공통 준비 헬퍼 `toPicking(strategy)` 와 `toReadyToPack(strategy)` 를 이 파일에 둔다.
- `toPicking`: 배정 몫을 전부 스캔한 상태(`completePick` 직전)다. discrete 는 `scan`, tote 는 `assignTote` + `toteScan`, aggregate 는 `bulkCartScan` + `sortScan(destinationCustody: 'SORTING')`.
- `toReadyToPack`: `toPicking` + `completePick`.

깨진 상태는 같은 tx 에서 `batch_inventory_session_balances` 의 `custody_ref` 를 직접 UPDATE 해서 만든다. 수량과 grain 은 그대로 둔다. DB 트리거·체크가 막으면 그 케이스만 `it.todo` 로 두고 PR 본문에 사유를 적는다.

- [ ] **Step 1: 테스트 작성.** 아래 이름과 단언으로 작성한다. 에러는 `ConflictException` 의 `getResponse()` 를 `toMatchObject({ code })` 로 비교한다. 메시지는 지금 코드의 문자열을 그대로 `toMatchObject({ code, message })` 로 고정한다.
  - `unpick in picking by the active picker returns every held unit to AT_SOURCE and requeues`: 응답 `{ status: 'queued', returnedToSourceQty: <스캔 수량> }`. 작업 항목 `status='queued'`, `leaseVersion` +1, `leaseExpiresAt` null. 그 박스 라인의 잔량 중 `custody_type <> 'AT_SOURCE'` 이고 qty>0 인 행 0. pick_to_tote 는 배정 행 `released_at` not null, 토트 `status='available'`.
  - `unpick in ready_to_pack by the previous picker succeeds the same way`
  - `unpick in ready_to_pack by a logistics_manager who did not pick succeeds`
  - `unpick in ready_to_pack by another non-manager worker is PICKING_UNPICK_FORBIDDEN`
  - `unpick in picking with custody moved to another holder is PICKING_CUSTODY_OWNER_MISMATCH`: discrete 는 WORKER ref 를 다른 작업자 id 로, tote 는 TOTE ref 를 배정 안 된 `tote:<uuid>` 로, aggregate 는 SORTING ref 를 `sorting:<workItemId>:other` 로 바꾼다.
  - `unpick in ready_to_pack with packing custody under another work item`: PACKING ref 를 `work-item:<다른 uuid>` 로 바꾼다. **기대(지금 코드):** discrete·pick_to_tote → `PICKING_PACKING_CUSTODY_INCOMPLETE`, aggregate_then_sort → `PICKING_CUSTODY_OWNER_MISMATCH`(설계 D3 — K1b-2 에서 이 행만 바꾼다). `it.each` 로 전략별 기대 코드를 표로 둔다.
  - `unpick replayed with the same idempotency key returns the stored response and moves nothing twice`: 같은 키로 두 번 부른다 → 두 응답의 `operationId` 가 같고, AT_SOURCE 잔량이 한 번분만 늘었다.
- [ ] **Step 2: 실행.** `npm run test:core:integration:local -- picking-rollback.characterization` → **전부 PASS 여야 한다**(지금 코드의 기록). 실패하면 테스트 준비를 고친다. 코드가 설계 §5 의 서술과 다르게 동작하면 멈추고 사람에게 보고한다.
- [ ] **Step 3: 커밋.** `test(fulfillment): 피킹 되돌림 특성 테스트 — 세 전략 unpick (K1b-1)`

### Task 8: 전략 `handoff` 특성 테스트

**Files:**
- Modify: `apps/core/src/modules/fulfillment/picking/picking-rollback.characterization.integration.spec.ts`

인계 actor 는 `roles: ['logistics_manager']` 다(`batches.handoff` 가 요구). 대상은 `services.picking.handoff`(전략 인계)이고, `services.batches.handoff` 가 아니다.

- [ ] **Step 1: 테스트 작성.**
  - `handoff in picking to another worker moves the claim and, where custody follows the person, the custody`: 작업 항목 `pickerId` = 대상. 응답 `leaseVersion` = DB 의 값. discrete 는 잔량이 `WORKER`/대상 id 로 옮겨지고 `movedQty` = 스캔 수량. aggregate 는 `SORTING`/`sorting:<workItemId>:<대상>` 으로 옮겨지고 `movedQty` = 스캔 수량. pick_to_tote 는 잔량 불변, `movedQty: 0`.
  - `the new picker can complete with the lease returned by handoff`: 위 응답의 `leaseVersion` 으로 대상 작업자가 `completePick` → 성공.
  - `handoff to the same worker`: **기대(지금 코드):** discrete·pick_to_tote 성공(`movedQty: 0`). aggregate_then_sort 는 `BadRequestException` 이고 메시지는 `Source and target custody must differ`(설계 D1 — 코드 읽기 추론의 확인. K1b-2 에서 이 행만 바꾼다). 추론과 다르게 나오면 그 결과를 기록하고 PR 본문과 설계 D1 에 적는다.
  - `handoff with custody under another holder is PICKING_CUSTODY_OWNER_MISMATCH`(Task 7 과 같은 방식의 UPDATE).
  - `completePick before every allocated unit is held returns the strategy's incomplete code`(설계 §6 마지막 행): 배정 수량 2 인 라인을 1 만 스캔한 뒤 `completePick`. discrete·pick_to_tote → `PICKING_INCOMPLETE`, aggregate_then_sort → `PICKING_UNSORTED_REMAINDER`. 메시지까지 고정한다.
- [ ] **Step 2: 실행.** Task 7 Step 2 와 같은 명령으로 전부 PASS 해야 한다.
- [ ] **Step 3: 전체 게이트.** `npm run type-check` 0, `npx jest` 실패 0.
- [ ] **Step 4: 커밋 + K1b-1 PR.** `test(fulfillment): 피킹 인계 특성 테스트 — 같은 작업자 인계 포함 (K1b-1)`. PR 본문에 D1 추론의 실측 결과를 적는다.

---

## K1b-2 — 공통 본문 한 벌

### Task 9: 순수 판정 함수

**Files:**
- Create: `apps/core/src/modules/fulfillment/picking/work-item-custody-judgement.ts`
- Test: `apps/core/src/modules/fulfillment/picking/work-item-custody-judgement.spec.ts`

**Interfaces:**
- Produces:
  ```ts
  /** 들고 있어도 되는 자리. custodyRef 가 null 이면 그 자리는 무효. */
  export interface HeldSpots { allows(balance: Pick<ShipmentCustodyBalance, 'custodyType' | 'custodyRef'>): boolean }
  export function spotsOf(entries: ReadonlyArray<{ custodyType: string; refs: ReadonlySet<string> }>): HeldSpots;
  export const PACKING_REF_PREFIX = 'work-item:';
  export function packingRefOf(workItemId: string): string;

  export type Judgement = { ok: true } | { ok: false; code: string };

  /** completePick 한 배정 행: 합 = 배정량 이고 모든 잔량이 허용 자리에 있다. */
  export function judgeCompleteAllocation(
    allocationQty: number, balances: readonly Pick<ShipmentCustodyBalance,'custodyType'|'custodyRef'|'qty'>[], held: HeldSpots,
  ): boolean;

  /** 박스의 모든 잔량이 허용 자리에 있다(handoff 전·후, unpick picking). */
  export function judgeHeldCustody(balances: readonly …[], held: HeldSpots): boolean;

  /** unpick 판정. D3 순서: ① 모든 잔량 grain 검사 ② picking → held, ready_to_pack → PACKING ref 정확 일치. */
  export function judgeUnpickCustody(input: {
    status: 'picking' | 'ready_to_pack';
    workItemId: string;
    balances: readonly ShipmentCustodyBalance[];
    allocations: readonly ShipmentAllocation[];
    held: HeldSpots | null; // picking 일 때만 non-null
  }): Judgement;  // code ∈ PICKING_CUSTODY_GRAIN_MISMATCH | PICKING_CUSTODY_OVERATTRIBUTED | PICKING_CUSTODY_OWNER_MISMATCH | PICKING_PACKING_CUSTODY_INCOMPLETE
  ```
  메시지는 판정 함수가 만들지 않는다. 코드를 받은 커널이 전략 정책의 메시지로 `conflict(code, message)` 를 만든다(Task 10). GRAIN·OVERATTRIBUTED·PACKING_INCOMPLETE 메시지는 세 전략이 같으므로 커널 상수다. 정확한 문자열은 지금 코드(`discrete-picking.strategy.ts` :479·:483·:504-505)에서 복사하고, 판정 결과에 그 메시지에 필요한 `balanceId`·`grain` 을 같이 싣는다.

- [ ] **Step 1: 실패하는 spec 작성.** 최소 케이스:
  - `judgeCompleteAllocation`: discrete 모양(WORKER 1행 = 배정량) true. WORKER 가 배정량보다 적으면 false. 허용 밖 자리가 섞이면 false. aggregate 모양(SORTING 2 + PACKING 1 = 배정량 3, 둘 다 허용) true. tote 모양(TOTE 두 개, 둘 다 활성 배정) true. 토트 하나가 배정 밖이면 false.
  - `judgeUnpickCustody`: picking + 모두 허용 → ok. picking + 허용 밖 → `PICKING_CUSTODY_OWNER_MISMATCH`. ready_to_pack + 다른 작업 항목 PACKING ref → `PICKING_PACKING_CUSTODY_INCOMPLETE`. ready_to_pack + 한 grain 부족 → INCOMPLETE. 배정에 없는 grain 의 잔량 → `PICKING_CUSTODY_GRAIN_MISMATCH`.
  - **D3 순서:** `grain violation wins over owner violation regardless of balance order`. 첫 잔량은 허용 밖 자리, 둘째 잔량은 배정에 없는 grain → `PICKING_CUSTODY_GRAIN_MISMATCH`.
- [ ] **Step 2: 실행해 실패 확인.** `npx jest apps/core/src/modules/fulfillment/picking/work-item-custody-judgement.spec.ts` → FAIL.
- [ ] **Step 3: 구현.** grain 키는 지금 코드와 같은 `` `${shipmentLineId ?? ''}|${sourceLocationId ?? ''}` `` 이고, SKU 불일치도 GRAIN_MISMATCH 다.
- [ ] **Step 4: 실행해 통과 확인.**
- [ ] **Step 5: 커밋.** `feat(fulfillment): 피킹 custody 판정 순수 함수 (K1b-2)`

### Task 10: 커널의 완료·되돌림·인계

**Files:**
- Modify: `apps/core/src/modules/fulfillment/picking/work-item-command.ts`
- Test: `apps/core/src/modules/fulfillment/picking/work-item-command.spec.ts`

**Interfaces:**
- Consumes: Task 1(`runForwardWorkItemCommand`, `WorkItemCommandDeps`), Task 9(판정 함수).
- Produces:
  ```ts
  export interface CustodyCommandDeps extends WorkItemCommandDeps {
    sessions: Pick<BatchInventorySessionService, 'moveCustody'>;
    batches: Pick<OutboundBatchOrchestrator, 'handoff'>;
  }
  export interface PickingCustodyPolicy {
    strategy: PickingStrategyName;               // commandType = `picking.${strategy}.complete|unpick|handoff`
    keys: { complete: string; unpick: string; handoffClaim: string; handoff: string }; // 접두사, ':' 앞까지. 지금 코드에서 복사
    /** 들고 있어도 되는 자리. 판정은 하지 않는다. tote 는 락을 잡으므로 호출 위치를 커널이 고정한다. */
    loadHeldSpots(trx: DbTx, ctx: { workItemId: string; shipmentId: string; pickerId: string }): Promise<HeldSpots>;
    /** completePick 에서 PACKING 으로 옮길 custodyType. 이미 PACKING 인 행은 옮기지 않는다. */
    completeMovesFrom: 'WORKER' | 'TOTE' | 'SORTING';
    /** completePick 에서 허용 자리가 비었을 때(tote 만). */
    emptyHeldOnComplete?: { code: string; message: string };
    /** 인계 때 custody 가 사람을 따라가면 그 자리의 ref 규칙. tote 는 없음. */
    handoffCustody?: { custodyType: 'WORKER' | 'SORTING'; refFor(workItemId: string, workerId: string): string };
    afterUnpick?(trx: DbTx, shipmentId: string): Promise<void>; // tote: releaseEmptyShipmentTotes
    messages: {
      completeIncomplete(a: { shipmentLineId: string; sourceLocationId: string }): { code: string; message: string };
      ownerMismatchWhilePicking(ctx: { balanceId: string; pickerId: string; shipmentId: string }): string; // unpick
      handoffOwnerMismatch(ctx: { pickerId: string; shipmentId: string }): string;
      handoffCorrupt(balanceId: string): string;
    };
  }
  export function completeWorkItemPick(deps: CustodyCommandDeps, policy: PickingCustodyPolicy, input: CompletePickInput, tx?: DbTx): Promise<InspectionReadyOutput>;
  export function unpickWorkItemShipment(deps: CustodyCommandDeps, policy: PickingCustodyPolicy, input: UnpickShipmentInput, tx?: DbTx): Promise<UnpickShipmentResult>;
  export function handoffWorkItemPicker(deps: CustodyCommandDeps, policy: PickingCustodyPolicy, input: HandoffPickingInput, tx?: DbTx): Promise<PickingHandoffResult>;
  ```

본문의 정본은 **discrete 의 지금 메서드**다(`discrete-picking.strategy.ts` `handoff` :173-273, `completePick` :275-402, `unpickShipment` :404-566). 그 위에 아래 차이만 반영한다.
- **`completePick`:** 문은 `runForwardWorkItemCommand`. 배정 로드 직후 `held = await policy.loadHeldSpots(trx, { …, pickerId: input.actor.id })` 를 한 번 부른다. tote 는 `emptyHeldOnComplete` 가 있고 held 가 비면 throw. 배정 행마다 잔량 쿼리는 discrete 의 것(SETTLED 제외, D2)을 쓰고 `judgeCompleteAllocation` 으로 판정한다. 실패하면 `policy.messages.completeIncomplete`. `completeMovesFrom` 타입 행만 `{type, ref: balance.custodyRef}` → `PACKING`/`packingRefOf(workItemId)` 로 옮긴다(키 `${keys.complete}:${commandRequestId}:${balance.id}`). 나머지(ready_to_pack 갱신 CAS, 응답)는 discrete 그대로.
- **`unpickShipment`:** 잔량은 `loadPositiveShipmentCustody`(SETTLED 필터 없음, D2 범위 밖). `status === 'picking'` 일 때만 `loadHeldSpots` 를 grain 검사 뒤 위치에서 부른다(`judgeUnpickCustody` 에 넘기기 직전). 판정은 `judgeUnpickCustody`. 이동 뒤, 재큐잉 UPDATE 전에 `policy.afterUnpick?.(trx, shipmentId)`.
- **`handoff`:** `batches.handoff` 전·후로 `loadHeldSpots(pickerId: oldOwnerId)` + `judgeHeldCustody` 를 두 번 한다. 실패하면 `policy.messages.handoffOwnerMismatch`. 인계 뒤 `PICKING_WORK_ITEM_CLOSED` 검사는 없다(설계 §5.3). `handoffCustody` 가 있고 **`oldOwnerId !== targetWorkerId`** 일 때만 그 타입 행을 옮긴다(설계 D1). CORRUPT 검사는 discrete 의 것(`!sourceLocationId || !custodyRef || !shipmentLineId`).

- [ ] **Step 1: 실패하는 단위 spec 작성**(가짜 deps, `jest.mock` 된 queries). 정책 호출의 위치·횟수만 고정한다. 동작 자체는 Task 7·8 의 통합 spec 이 증명한다.
  - `completePick calls loadHeldSpots once, after allocations load and before the first moveCustody`
  - `unpick calls loadHeldSpots only when the work item is picking`: ready_to_pack 이면 0회.
  - `unpick calls afterUnpick after every moveCustody and before the requeue update`
  - `handoff calls loadHeldSpots before and after batches.handoff with the old owner`
  - `handoff to the same worker moves nothing even when handoffCustody is set`
  - `commandType and moveCustody keys come from policy.strategy and policy.keys`: 예 `picking.pick_to_tote.unpick`, `pick_to_tote-unpick:cmd-1:<balanceId>`.
- [ ] **Step 2: 실패 확인 → Step 3: 구현 → Step 4: 통과 확인.** `npx jest apps/core/src/modules/fulfillment/picking/work-item-command.spec.ts`
- [ ] **Step 5: 커밋.** `feat(fulfillment): 커널이 피킹 완료·되돌림·인계 본문을 한 벌로 가진다 (K1b-2)`

### Task 11: discrete 전환

**Files:**
- Modify: `apps/core/src/modules/fulfillment/picking/discrete-picking.strategy.ts`

- [ ] **Step 1: 정책 작성 + 세 메서드 위임.** `private custodyPolicy(): PickingCustodyPolicy` 와 `private custodyDeps(): CustodyCommandDeps` 를 메서드로 둔다. 정책 값:
  - `strategy: 'discrete'`, `keys: { complete: 'discrete-complete', unpick: 'discrete-unpick', handoffClaim: 'discrete-handoff-claim', handoff: 'discrete-handoff' }`
  - `loadHeldSpots` = `spotsOf([{ custodyType: 'WORKER', refs: new Set([pickerId]) }])`
  - `completeMovesFrom: 'WORKER'`
  - `handoffCustody: { custodyType: 'WORKER', refFor: (_, w) => w }`
  - `messages` 는 지금 문자열 그대로다(:331, :490, :572, :234).
  - `completePick`·`unpickShipment`·`handoff` 는 커널 함수 호출 한 줄씩. `assertExclusiveWorkerCustody`·`PACKING_REF_PREFIX` 상수·안 쓰게 된 import 는 지운다.
- [ ] **Step 2: 검증.** `npx jest apps/core/src/modules/fulfillment/picking` PASS. `npm run test:core:integration:local -- picking-rollback.characterization` 의 discrete 행 **수정 없이** PASS. `outbound-v2` 시나리오 PASS.
- [ ] **Step 3: 커밋.** `refactor(fulfillment): discrete 완료·되돌림·인계를 커널로 (K1b-2)`

### Task 12: pick-to-tote 전환

**Files:**
- Modify: `apps/core/src/modules/fulfillment/picking/pick-to-tote.strategy.ts`

- [ ] **Step 1: 정책 + 위임.**
  - `keys: { complete: 'pick-to-tote-complete', unpick: 'pick_to_tote-unpick', handoffClaim: 'pick_to_tote-handoff-claim', handoff: 'pick_to_tote-handoff' }`. `handoff` 키는 쓰이지 않는다(이동 없음). 그래도 타입을 채운다.
  - `loadHeldSpots` = `spotsOf([{ custodyType: 'TOTE', refs: await this.loadActiveShipmentToteRefs(shipmentId, trx) }])`
  - `completeMovesFrom: 'TOTE'`, `emptyHeldOnComplete: { code: 'TOTE_ASSIGNMENT_REQUIRED', message: 'Shipment has no active tote assignment' }`
  - `handoffCustody` 없음, `afterUnpick: (trx, id) => this.releaseEmptyShipmentTotes(id, trx)`
  - `messages` 는 지금 문자열 그대로. `assertExclusiveToteCustody` 는 다른 메서드(`toteHandoff` 등)가 쓰는지 확인하고, 안 쓰면 지운다.
- [ ] **Step 2: 검증.** Task 11 Step 2 와 같다. pick_to_tote 행이 수정 없이 PASS 해야 한다.
- [ ] **Step 3: 커밋.** `refactor(fulfillment): pick-to-tote 완료·되돌림·인계를 커널로 (K1b-2)`

### Task 13: aggregate 전환 + D1·D3 기대값 변경

**Files:**
- Modify: `apps/core/src/modules/fulfillment/picking/aggregate-then-sort.strategy.ts`
- Modify: `apps/core/src/modules/fulfillment/picking/picking-rollback.characterization.integration.spec.ts` (D1·D3 두 행만)

- [ ] **Step 1: 특성 spec 의 두 행만 기대값 변경.**
  - D1 `handoff to the same worker`: aggregate_then_sort → 성공, `movedQty: 0`, `pickerId` 불변, 응답 `leaseVersion` = 이전 + 1.
  - D3 `unpick in ready_to_pack with packing custody under another work item`: aggregate_then_sort → `PICKING_PACKING_CUSTODY_INCOMPLETE`.
  - 두 행 옆에 `// 설계 D1` / `// 설계 D3` 주석.
- [ ] **Step 2: 실행해 그 두 행만 실패하는지 확인.** `npm run test:core:integration:local -- picking-rollback.characterization` → 정확히 aggregate 의 두 행 FAIL.
- [ ] **Step 3: 정책 + 위임.**
  - `keys: { complete: 'aggregate-complete', unpick: 'aggregate-unpick', handoffClaim: 'aggregate-handoff-claim', handoff: 'aggregate-handoff' }`
  - `loadHeldSpots` = `spotsOf([{ custodyType: 'SORTING', refs: new Set([this.sortingRef(workItemId, pickerId)]) }, { custodyType: 'PACKING', refs: new Set([packingRefOf(workItemId)]) }])`
  - `completeMovesFrom: 'SORTING'`, `handoffCustody: { custodyType: 'SORTING', refFor: (wi, w) => this.sortingRef(wi, w) }`
  - `messages`: 완료 미충족은 `{ code: 'PICKING_UNSORTED_REMAINDER', message: \`Allocation ${…} is not fully sorted\` }`. 나머지도 지금 문자열 그대로.
  - `loadPositiveAllocationCustody`·`assertAggregateAssignedCustody`·`ASSIGNED_REF_PREFIX` 가 다른 메서드에서 안 쓰이면 지운다. `packingRef()` 는 `packingRefOf` 로 바꾼다.
- [ ] **Step 4: 검증.** 특성 spec 전부 PASS(세 전략). `npx jest apps/core/src/modules/fulfillment/picking` PASS(aggregate unit spec 이 D1·D3 경로를 옛 기대값으로 단언하고 있으면 그 단언만 고치고 PR 본문에 적는다). `outbound-v2` 시나리오·`aggregate-cart-surplus.integration.spec.ts` PASS.
- [ ] **Step 5: 커밋.** `refactor(fulfillment): aggregate 완료·되돌림·인계를 커널로 — 같은 작업자 인계 성공(D1), 되돌림 판정 순서 통일(D3) (K1b-2)`

### Task 14: 가드 확장

**Files:**
- Modify: `apps/core/src/modules/fulfillment/picking/work-item-command.guard.spec.ts`

- [ ] **Step 1: 항목 추가**(설계 §5.5).
  - `it('picking/ 에서 작업 항목을 ready_to_pack·queued 로 쓰는 비-spec 파일은 커널뿐이다')`: `picking/` 아래 비-spec 파일 중 `update(wmsTables.outboundBatchWorkItems)` 와 `status: 'ready_to_pack'` 또는 `status: 'queued'` 를 함께 가진 파일 = `[work-item-command.ts]`. 전환 전 기준선을 먼저 재서 세 전략 파일 말고 다른 파일(예: `allocation/`)이 있으면 그 파일을 예외 목록에 넣고 이유 주석을 단다.
  - `it('picking/ 에서 PACKING 을 목적지로 moveCustody 하는 곳은 커널과 aggregate sortScan 뿐이다')`: AST 로 `moveCustody` 호출의 `to.custodyType` 이 `'PACKING'` 인 곳을 찾는다. `sortScan` 은 `input.destinationCustody` 라 리터럴이 아니다. 기대 목록은 `[work-item-command.ts]` 이고, 비-리터럴 목적지는 허용 목록 `[aggregate-then-sort.strategy.ts#sortScan]` 으로 고정한다.
  - `it('커널의 되돌림 진입(unpickWorkItemShipment·handoffWorkItemPicker) 본문에는 assertCurrent 가 없다')`: 메서드 단위.
- [ ] **Step 2: 실행.** PASS. 전략 한 곳에 `status: 'queued'` UPDATE 를 넣으면 FAIL 하는지 확인하고 되돌린다.
- [ ] **Step 3: 커밋.** `test(fulfillment): 커널 밖 상태 쓰기·PACKING 이동 금지 가드 (K1b-2)`

### Task 15: ADR + 마무리

**Files:**
- Create: `docs/adr/0045-picking-custody-commands-share-one-kernel.md`
- Modify: `docs/adr/0030-*.md` (파일명은 `ls docs/adr | grep 0030`)

- [ ] **Step 1: ADR-0045 작성.** 담을 것(설계 §5.6): 0030 재검토 조건 충족 측정표(설계 §1)와 재는 명령(감사 문서 §10 스크립트), 커널이 고정하는 것(전진 순서, 소유자 조회 호출 위치)과 전략이 넘기는 것(`PickingCustodyPolicy`), 커널에 넣지 않은 되돌림(`releaseTote`·`toteHandoff`·`cartHandoff`·`returnCartSurplus`)과 이유, D1·D2·D3. 기존 ADR 형식을 따른다(`docs/adr/0044-*.md` 참고).
- [ ] **Step 2: ADR-0030 에 한 줄.** custody 조항 위치에 «custody 층 통합 여부는 ADR-0045 가 대체한다(2026-10-19)».
- [ ] **Step 3: 측정 재실행.** 감사 문서 §10 스크립트를 스크래치에 저장해 돌린다. `completePick`·`unpickShipment`·`handoff` 는 세 전략 파일에서 한 줄짜리 위임이 된다. 결과를 PR 본문에 붙인다.
- [ ] **Step 4: 전체 게이트.** `npm run type-check` 0, `npx jest` 실패 0, `npm run test:core:integration:local` PASS.
- [ ] **Step 5: 커밋 + K1b-2 PR.** `docs(adr): 0045 피킹 custody 명령은 커널 하나를 공유한다 — 0030 custody 조항 대체`. PR 본문에 D1·D2·D3 를 «동작 변경» 절로 따로 적는다.
