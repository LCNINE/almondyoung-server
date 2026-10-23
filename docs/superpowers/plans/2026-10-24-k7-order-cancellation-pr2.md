# K7 PR 2 — 와우프레스 순서를 커널로: 통보는 받아들인 뒤 멈추고, 붙잡기는 와우프레스 모듈의 문으로 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 통보 세 문(채널 수량 감소·채널 취소·무통장 승인)의 와우프레스 처리를 «받아들이고 → 트랜잭션 안에서 안 보낸 인쇄를 붙잡고 → 커밋 뒤 record» 한 규칙으로 커널이 소유하게 한다. 호출자는 커널을 **한 번** 부르고, 판매주문 코드에서 `print_orders` 직접 UPDATE 가 사라진다(스펙 §5.3, D6·D7).

**Architecture:** PR 1 의 `notice(intent, tx?)` + `afterCommit(followUp)` 를 소스별 메서드 셋으로 나눈다 — `noticeChannelDecrease(intent, tx)`(수신 트랜잭션 안), `receiveChannelCancellation(receive)`(커널이 트랜잭션을 열고 컨슈머의 중복 기록을 콜백으로 받는다 → 커밋 뒤 record 를 호출자가 잊을 수 없다), `noticeWalletRefundApproval(intent)`(커널이 트랜잭션을 가진다). 채널 수량 감소의 붙잡기는 와우프레스 모듈에 새 문 `holdForDecrease` 로 옮긴다. 요청(고객·운영자) 쪽 순서는 PR 1 에서 이미 스펙대로라 바꾸지 않는다.

**Tech Stack:** NestJS(core), Drizzle, Jest(unit + `REQUIRE_*_DB` 통합 — 스크래치 DB `k6_it`).

**Spec:** `docs/superpowers/specs/2026-10-24-k7-order-cancellation-design.md` (§5.3·§6 D6·D7·§7-2). PR 1 결정은 `docs/adr/0049-order-cancellation-one-kernel-owns-the-sequence.md`.

## 이름 붙은 결정 (⛔ 사용자 확인)

- **N7. `notice` 를 소스별 메서드 셋으로 나누고 `afterCommit` 을 없앤다 (N2 해소).** 컨슈머는 커널을 한 번 부른다: `receiveChannelCancellation(async (tx) => …)`. 이벤트 중복 기록(`order_events`)은 컨슈머의 일이라 콜백 안에 남고, 콜백이 «새 통보 / 재수신 / 할 일 없음» 중 하나를 돌려준다. 재수신의 `redeliveredSince` 를 담은 후속 작업도 커널이 만든다(PR 1 메모). 소스별 반환 타입이 생겨 무통장 문의 «결과에 view 가 없으면 던진다» 같은 방어 코드가 사라진다. «tx 를 넘기면/안 넘기면 던진다» 런타임 검사도 타입으로 옮겨져 지워진다.
- **N8. 무통장 승인 순서(D6): 트랜잭션[전체취소 확정 + 안 보낸 인쇄 붙잡기(전 줄)] → 커밋 뒤 record.** 스펙 §5.3 의 조건(«커밋이 실패하든 와우프레스가 실패하든 운영자가 볼 곳에 남는다») 판단 근거:
  - admin-web 승인 흐름(`apps/admin-web/src/lib/services/wallet/mutations.ts:78` `useApproveRefundRequest`)은 **승인 전에** `print-gate-by-intent` 로 살아 있는 인쇄 줄이 하나라도 있으면 409 로 멈춘다. 그래서 이 문에 닿을 때 살아 있는 인쇄는 보통 0 이고, record 는 경합 대비다.
  - 커밋이 실패하면 인쇄는 건드려지지 않았고(붙잡기도 롤백), 승인 결과 화면에 취소 실패가 뜬다(`cancel.error`, 지금과 같다).
  - record 가 거절되면 `cancel_refused` 로 보드에 남는다. record 가 커밋 뒤 **던지면**(DB 오류 등) 취소는 남고 500 → 승인 결과에 실패가 뜬다. 다시 눌러도 `already_cancelled` 로 끝나 record 가 다시 돌지 않는다 — 이 경우 붙잡힌 미발주 행은 `pending`·`next_attempt_at=9999` 로 남는다. 살아 있는 인쇄가 0 인 전제에서 붙잡히는 행도 0 이라 받아들인다(Review Focus 4).
- **N9. 채널 수량 감소의 «대기로 정하기»(전 라인 제거 `ALL_LINES_REMOVED`·셀메이트 출고 표시 `MARKED_SHIPPED_DETAIL`)는 채널 변경 규칙이라 `ChannelOrderChangeManager` 에 남는다.** 그 갈래도 붙잡기는 해야 하므로 manager 는 감소마다 커널을 부르고, 대기로 정한 경우 `attempt: false` 를 넘긴다 — 커널은 붙잡기만 하고 시도하지 않는다. 붙잡기는 커널 한 곳, 대기 판정은 manager 한 곳.
- **N10. 이 PR 의 동작 변경은 D6 의 순서 하나다.** D7 은 같은 UPDATE 를 와우프레스 모듈로 옮길 뿐이다(같은 행·같은 `last_error` 문구). 커널 읽기의 `db.db` 직접 사용은 Reader + `DbService.run` 으로 옮긴다(PR 1 최종 리뷰 메모, Task 4) — 동작 그대로.

## Global Constraints

- 거절·안내 문구는 글자 그대로 둔다. `PRINT_HELD_FOR_DECREASE` 문구(`'channel decreased quantity before the print was ordered — confirm quantity, then proceed'`)도 그대로 옮긴다.
- 와우프레스 `cancelForOrder` 는 트랜잭션 **밖**에서 부른다(외부 HTTP). `holdUnsent`·`holdForDecrease` 는 트랜잭션 **안**에서.
- 커널은 `WalletRefundClient` 를 import 하지 않는다(G4). 채널 이름 리터럴은 능력 표 파일에만(PR 1 가드).
- 가드 허용 목록은 줄어드는 방향으로만 바꾼다. 이 PR 이 줄이는 것: `print_orders` 직접 UPDATE 허용 목록 → 빈 목록.
- 통합 테스트는 스크래치 DB `k6_it`: `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/k6_it npx jest --runInBand --runTestsByPath <파일…>`. 꺼져 있으면 `docker start almondyoung-server-postgres-1`. 마이그 없음. 워크트리엔 `node_modules` 심링크(이미 걸려 있다).
- 기준선: 시작 때 `k6_it` 에서 `apps/core/src/modules/sales-order/**/*.integration.spec.ts` 와 `apps/core/src/modules/print-order/**/*.integration.spec.ts` 를 한 번 돌려 실패 목록을 scratchpad 에 둔다. 🔴 `channel-cancel-request.integration.spec.ts` 단발 실패는 공유 DB 동시 실행 의심 — 재실행으로 판정.
- 검증 게이트: `npm run type-check` 에러 0(로컬 환경 에러 — web-push·tauri 미설치 — 은 기준선), `npx jest apps/core/src/modules/sales-order apps/core/src/modules/print-order scripts/security` 실패 0, 통합(`k6_it`) 기준선 외 실패 0. 🔴 `store-sales-orders.service.ts` 의 줄이 움직이면 `scripts/security/idor-reviewed.spec.ts` 줄 좌표가 빨개진다 — `npx jest scripts/security` 로 확인하고 좌표를 옮긴다.

## Review Focus

1. **전 라인 제거(`ALL_LINES_REMOVED`) 감소에 안 보낸 인쇄가 있을 때** — 대기로 남고, 인쇄는 `cancel_refused`·`PRINT_HELD_FOR_DECREASE` 로 붙잡힌다(지금 동작). manager 가 커널을 `attempt: false` 로 부르지 않으면 붙잡기가 조용히 사라진다. Task 1 통합 테스트.
2. **셀메이트 출고 표시 주문의 감소** — `CANCEL_NOT_IMMEDIATE`·`'sales order marked shipped'` 대기, 인쇄 붙잡힘, 취소 시도 없음. Task 1 커널 unit(`attempt: false`).
3. **채널 취소 재수신 / 줄 해석 0건** — 재수신이면 취소를 다시 하지 않고 record 에 처음 기록 시각을 넘긴다. 콜백이 `null` 이면 record 도 없다. 기존 `order-events.consumer.spec.ts:478-520` 단언이 그대로 통과해야 한다. Task 2.
4. **무통장 승인의 확정 실패** — 확정이 던지면(예: 동시 승인 뒤 `'이미 취소된 주문입니다.'`) record 를 부르지 않고 그대로 던진다(붙잡기는 함께 롤백). Task 3 커널 unit.
5. **커밋 뒤 record 가 던질 때** — 채널 취소는 그대로 던져 컨슈머 재시도(→ 재수신 경로)로 간다. 무통장은 그대로 던져 승인 결과에 실패가 뜬다(N8). 두 경우 모두 커널이 삼키지 않는다. Task 2·3 커널 unit.

---

## 배포

- 배포 단위: **Core 만.** 마이그 없음. `npm run deploy:preflight -- --stage live`.
- 롤백: 이 PR 이전 Core 로 되돌려도 안전하다(쓰는 행의 모양이 같다 — 붙잡기 UPDATE 와 record 가 같은 행을 같은 값으로 쓴다).

---

### Task 1: 채널 수량 감소 — 붙잡기는 와우프레스 모듈의 문, 부르는 건 커널 (D7)

**Files:**
- Modify: `apps/core/src/modules/print-order/services/print-order.repository.ts` (새 `holdUnsentForDecrease`, 상수 `PRINT_HELD_FOR_DECREASE` 이사 — `PRINT_HELD_FOR_CANCEL_UNTIL` 옆)
- Modify: `apps/core/src/modules/print-order/services/print-order-cancellation.manager.ts` (새 `holdForDecrease`, `holdUnsent` 옆)
- Modify: `apps/core/src/modules/sales-order/order-cancellation/order-cancellation.types.ts`, `order-cancellation.ts`
- Modify: `apps/core/src/modules/sales-order/channel-order-change/channel-order-change.manager.ts:35-36,113-127,173-198,201-223`
- Test: `print-order/services/print-order-cancellation.manager.spec.ts`, `sales-order/order-cancellation/order-cancellation.spec.ts`(«채널 수량 감소» describe), `channel-order-change/channel-order-change.integration.spec.ts`, `order-cancellation/order-cancellation.guard.spec.ts`

**Interfaces:**
- Consumes: PR 1 의 `OrderCancellationReader.hasActivePrintOrder`·`cancellationNeedsFollowUp`, `CancelLine`
- Produces:
  ```ts
  // print-order.repository.ts
  export const PRINT_HELD_FOR_DECREASE: string; // 문구 그대로
  holdUnsentForDecrease(salesOrderLineId: string, tx: DbTx): Promise<void>; // manager holdUnsentPrint 본문 그대로
  // print-order-cancellation.manager.ts
  holdForDecrease(salesOrderLineId: string, tx: DbTx): Promise<void>;
  // order-cancellation.types.ts
  export type ChannelDecreaseNotice = {
    salesOrderId: string; line: CancelLine; reasonCode: string; occurredAt: string; sourceEventId: string;
    /** false = 채널 변경 규칙이 이미 대기로 정했다 — 인쇄만 붙잡고 시도하지 않는다 */
    attempt: boolean;
  };
  export type DecreaseOutcome = { applied: true } | { applied: false; refusal: string };
  // order-cancellation.ts
  noticeChannelDecrease(intent: ChannelDecreaseNotice, tx: DbTx): Promise<DecreaseOutcome>;
  ```
  `CancellationNotice` 합집합에서 `channel_decrease` 갈래를 지운다(나머지 둘은 Task 2·3 이 지운다).

- [ ] **Step 1: 실패하는 테스트**
  - print manager spec: `it('holdForDecrease 는 그 줄의 안 보낸 인쇄를 저장소에서 붙잡는다')` — `repository.holdUnsentForDecrease` 가 `('line-1', tx)` 로 한 번 불린다.
  - 커널 spec «채널 수량 감소»: 기존 케이스들을 `k.noticeChannelDecrease({ ...base, attempt: true }, tx)` 로 바꾸고 `'tx 없이 부르면 던진다'` 는 지운다(타입이 막는다). 새로:
    - `it('시도 전에 savepoint 밖에서 그 줄의 인쇄를 붙잡는다')` — `holdForDecrease` 의 `mock.invocationCallOrder[0]` 이 `tx.transaction` 의 것보다 작고, 인자는 `('line-1', tx)`(savepoint 가 아니라 바깥 tx). `makeKernel` 의 인쇄 목에 `holdForDecrease: jest.fn().mockResolvedValue(undefined)` 를 더한다.
    - `it('attempt: false 면 붙잡기만 하고 시도하지 않는다')` — `holdForDecrease` 1회, `tx.transaction`·`salesOrders.cancel` 0회, 결과 `{ applied: false }` 꼴(`refusal` 은 문자열).
    - `it('인쇄 줄 거절이어도 붙잡기는 이미 끝났다')` — `activePrint: true` → `{ applied: false, refusal: 'print order on this line — decide on WowPress' }`, `holdForDecrease` 1회.
  - 통합 `channel-order-change.integration.spec.ts`: `PRINT_HELD_FOR_DECREASE` import 를 `../../print-order/services/print-order.repository` 로. 새 `it('전 라인 0 이어도 안 보낸 인쇄는 붙잡는다 — ALL_LINES_REMOVED 대기')` — `:500` 케이스처럼 전 라인을 0 으로 내리되 첫 줄에 `status: 'pending'` 인쇄 행을 심고, 그 줄 델타의 blockers 가 `[{ code: 'ALL_LINES_REMOVED' }]`, 인쇄 행이 `{ status: 'cancel_refused', lastError: PRINT_HELD_FOR_DECREASE }`, `readLineQuantities` 의 canceled 가 전부 0.
  - 가드: `'판매주문 코드의 print_orders 직접 UPDATE'` 기대값을 `[]` 로.

- [ ] **Step 2: 실패 확인** — `npx jest apps/core/src/modules/print-order/services/print-order-cancellation.manager.spec.ts apps/core/src/modules/sales-order/order-cancellation` → FAIL(메서드 없음, 가드 1건).

- [ ] **Step 3: 구현**
  - repository: manager 의 `holdUnsentPrint` 본문과 상수를 그대로 옮긴다(상태 목록 `['pending','submitting','failed','unsupported']`, `orderAttemptedAt`·`vendorOrderNumber` IS NULL, `cancel_resolved_*` 비우기). manager 의 `holdUnsent` 주석처럼 «왜 트랜잭션 안인가» 한 줄.
  - 커널 `noticeChannelDecrease`: ① `this.printCancellation.holdForDecrease(intent.line.salesOrderLineId, tx)`(savepoint **밖** — 거절이 되돌려도 남는다) ② `attempt` 가 false 면 시도하지 않고 거절을 돌려준다 ③ 지금 `noticeChannelDecrease` 의 savepoint 본문 그대로.
  - manager `settle` 의 감소 갈래: `holdUnsentPrint` 호출과 메서드를 지우고, 대기 사유를 먼저 정한다 — `allRemoved` → `{ code: 'ALL_LINES_REMOVED' }`, `markedShipped` → `{ code: 'CANCEL_NOT_IMMEDIATE', detail: MARKED_SHIPPED_DETAIL }`, 아니면 없음. `tryDecrease(order, delta, ctx, deferral, tx)` 가 커널을 `attempt: deferral === undefined` 로 부르고, 대기 사유가 있으면 그것으로, 없으면 지금처럼 거절을 `CANCEL_NOT_IMMEDIATE` 로 옮긴다. 블로커 우선순위는 지금과 같다(전 라인 제거 → 출고 표시 → 시도). manager 에서 안 쓰게 된 `and`·`inArray`·`isNull` import 를 정리한다.

- [ ] **Step 4: 통과 확인** — Step 2 명령 PASS. 통합(`k6_it`): `channel-order-change.integration.spec.ts`, `print-order/**/*.integration.spec.ts` PASS. `npm run type-check` 기준선.

- [ ] **Step 5: 커밋** — `git commit -m "refactor(core): 채널 수량 감소의 인쇄 붙잡기를 와우프레스 모듈의 문으로 — 판매주문 코드의 print_orders 직접 UPDATE 0 (K7 PR2, D7)"`

---

### Task 2: 채널 취소 수신 — 컨슈머는 커널을 한 번 부른다 (N7)

**Files:**
- Modify: `apps/core/src/modules/sales-order/order-cancellation/order-cancellation.types.ts`, `order-cancellation.ts`
- Modify: `apps/core/src/modules/sales-order/consumers/order-events.consumer.ts:205-273`
- Test: `order-cancellation/order-cancellation.spec.ts`(«notice / afterCommit» describe 의 채널 취소 케이스), `consumers/order-events.consumer.spec.ts`

**Interfaces:**
- Consumes: Task 1 의 커널 생성자(그대로)
- Produces:
  ```ts
  // order-cancellation.types.ts
  export type ChannelCancelledNotice = {
    salesOrderId: string; lines: CancelLine[] | undefined; reasonCode?: string; reasonDetail?: string;
    cancelledBy?: string; occurredAt?: string; metadata: Record<string, unknown>;
  };
  /** 컨슈머가 수신 트랜잭션에서 판정한 것. 재수신이면 since = 그 이벤트를 처음 기록한 시각 */
  export type ChannelCancellationReceipt =
    | { notice: ChannelCancelledNotice }
    | { redelivered: { salesOrderId: string; lines: CancelLine[] | undefined; since: Date | undefined } };
  // order-cancellation.ts
  receiveChannelCancellation(receive: (tx: DbTx) => Promise<ChannelCancellationReceipt | null>): Promise<void>;
  ```
  공개 `afterCommit` 과 export `NoticeFollowUp` 을 지운다(후속 작업 모양은 커널 안 private 타입). `CancellationNotice` 에서 `channel_cancelled` 갈래를 지운다.

- [ ] **Step 1: 실패하는 테스트** — 커널 spec 의 `makeKernel` db 목에 `run: jest.fn((fn) => fn(tx))` 를 더한다(`tx` 는 `makeTx()` 의 것). 채널 취소 케이스를 바꾼다:
  - `it('새 전체취소 — 한 트랜잭션에서 cancel → holdUnsent → settle, 커밋 뒤 record')` — `callOrder` `['cancel','holdUnsent','settleCancelled','record']`, `printCancel` 이 `('so','record',undefined,{ redeliveredSince: undefined })`.
  - `it('새 부분취소는 정산을 닫지 않고 그 줄만 record')` — `settleCancelled` 0회, `printCancel` `('so','record',lines,{ redeliveredSince: undefined })`.
  - `it('재수신은 취소하지 않고 record 에 처음 기록 시각을 넘긴다')` — `{ redelivered: { salesOrderId: 'so', lines, since: t } }` → `salesOrders.cancel`·`holdUnsent` 0회, `printCancel` `('so','record',lines,{ redeliveredSince: t })`.
  - `it('receive 가 null 이면 record 도 없다')`.
  - `it('커밋 뒤 record 가 던지면 그대로 던진다 — 컨슈머 재시도가 재수신 경로로 다시 정리한다')` — `printCancel` reject → `rejects.toThrow`, `salesOrders.cancel` 1회.
  - 지울 것: `'채널 취소 통보는 tx 없이 부르면 던진다'`, `'afterCommit 은 record 로 재수신 시각을 넘긴다'`.
  - 컨슈머 spec 은 단언을 바꾸지 않는다 — 커널 첫 인자가 이미 `mocks.dbService` 라 그 `run` 이 수신 트랜잭션이 된다.

- [ ] **Step 2: 실패 확인** — `npx jest apps/core/src/modules/sales-order/order-cancellation/order-cancellation.spec.ts` → FAIL.

- [ ] **Step 3: 구현**
  - 커널: `this.db.run(async (tx) => { … })` 안에서 `receive(tx)` → `null` 이면 끝, `redelivered` 면 그 값으로 후속 작업, `notice` 면 지금 `noticeChannelCancelled` 본문(cancel → holdUnsent → 전체면 settleCancelled) 뒤 후속 작업. `run` 이 끝난 **뒤** `cancelForOrder(salesOrderId, 'record', lines, { redeliveredSince })`. record 의 예외는 삼키지 않는다.
  - 컨슈머: `this.dbService.run(…)` + `afterCommit` 을 `this.cancellation.receiveChannelCancellation(async (tx) => …)` 하나로. 콜백 안 순서(판매주문 해석 → `checkAndRecordEvent` → 줄 해석 → `null`/재수신/새 통보)는 그대로이고, 재수신이면 `order_events.created_at` 을 읽어 `{ redelivered: { salesOrderId, lines, since: first?.createdAt } }` 를 돌려준다. 로그 문구 그대로. 커널 주석의 «커밋 뒤 할 일은 커널이 안다» 같은 PR 1 문구를 새 모양에 맞게 고친다.

- [ ] **Step 4: 통과 확인** — `npx jest apps/core/src/modules/sales-order/order-cancellation apps/core/src/modules/sales-order/consumers` PASS(컨슈머 spec 의 `redeliveredSince`·`holdUnsent`·`no-op` 단언 그대로). 통합(`k6_it`): `consumers/**/*.integration.spec.ts` 가 있으면 PASS. `npm run type-check` 기준선.

- [ ] **Step 5: 커밋** — `git commit -m "refactor(core): 채널 취소 컨슈머는 커널을 한 번 부른다 — 커밋 뒤 와우프레스 정리를 호출자가 잊을 수 없다 (K7 PR2)"`

---

### Task 3: 무통장 승인 — 받아들이고, 붙잡고, 커밋 뒤 멈춘다 (D6, N8)

**Files:**
- Modify: `apps/core/src/modules/sales-order/channel-cancel-request/channel-cancel-request.service.ts:24-26` (`request` 에 `tx?: DbTx`)
- Modify: `apps/core/src/modules/sales-order/order-cancellation/order-cancellation.types.ts`, `order-cancellation.ts`
- Modify: `apps/core/src/modules/sales-order/services/store-sales-orders.service.ts:337-350`
- Test: `order-cancellation/order-cancellation.spec.ts`(무통장 케이스), `services/store-sales-orders.service.spec.ts:1596-1660`, `scripts/security/idor-reviewed.spec.ts`(좌표)

**Interfaces:**
- Consumes: Task 2 의 db 목 `run`
- Produces:
  ```ts
  // channel-cancel-request.service.ts
  request(input: CancelRequestInput, tx?: DbTx): Promise<CancelRequestView>; // manager.request(input, tx)
  // order-cancellation.types.ts
  export type WalletApprovalNotice = { salesOrderId: string; intentId: string; reasonCode: string };
  // order-cancellation.ts
  noticeWalletRefundApproval(intent: WalletApprovalNotice): Promise<CancelRequestView>;
  ```
  `notice` 메서드, `CancellationNotice`, `NoticeOutcome` 을 지운다(소스가 모두 자기 메서드로 갔다).

- [ ] **Step 1: 실패하는 테스트**
  - 커널 spec: `'무통장 승인 통보는 record 먼저, 확정 나중 (N4)'`·`'… tx 를 받지 않는다'` 를 지우고:
    - `it('확정과 안 보낸 인쇄 붙잡기를 한 트랜잭션에서, 커밋 뒤 record (D6)')` — `callOrder` `['request','holdUnsent','record']`; `cancelRequests.request` 가 `(expect.objectContaining({ sourceKey: 'wallet-refund-approval:i', requester: { kind: 'wallet-refund-approval', intentId: 'i' }, reasonCode: 'CUSTOMER_REFUND_REQUEST' }), tx)`; `holdUnsent` 가 `('so', undefined, tx)` — 같은 `tx`; `printCancel` 이 `('so','record')` 꼴(줄 없음); 반환값 `VIEW`.
    - `it('확정이 실패하면 record 하지 않고 던진다')` — `request` 가 `new BadRequestError('이미 취소된 주문입니다.')` 로 reject → 같은 에러로 reject, `printCancel` 0회.
    - `it('커밋 뒤 record 가 던지면 그대로 던진다 (N8)')`.
  - store spec `cancelByWalletIntentAfterRefund`: `:1611` 을 `it('환불이 이미 나갔으므로 취소를 확정하고 같은 트랜잭션에서 안 보낸 인쇄를 붙잡은 뒤, 커밋 뒤 record 로 멈춘다')` 로 — 순서 `['request', 'print:hold', 'print:record']`. `printCancelMock` 의 `holdUnsent` 가 `order` 에 `'print:hold'` 를 남기게 하고(없으면 더한다), 이 spec 의 `dbMock` 에 `run: jest.fn((fn) => fn(dbMock.db))` 를 더한다. 결과 `{ status: VIEW.status, requestId: VIEW.id }` 단언은 그대로.

- [ ] **Step 2: 실패 확인** — `npx jest apps/core/src/modules/sales-order/order-cancellation/order-cancellation.spec.ts apps/core/src/modules/sales-order/services/store-sales-orders.service.spec.ts` → FAIL.

- [ ] **Step 3: 구현**
  - 서비스 `request(input, tx?)` 는 manager 에 그대로 넘긴다(manager 는 이미 `tx?` 를 받는다).
  - 커널 `noticeWalletRefundApproval`: `this.db.run(async (tx) => { const view = await this.cancelRequests.request({ …지금 인자 그대로 }, tx); await this.printCancellation.holdUnsent(intent.salesOrderId, undefined, tx); return view; })` 뒤 `cancelForOrder(intent.salesOrderId, 'record')`. 주석은 N8 근거를 한 줄로(«돈은 이미 나갔다 — 승인 전 인쇄 gate 가 살아 있는 인쇄를 막았으니 record 는 경합 대비, 거절은 보드로»). 31번 전환을 하지 않는다는 지금 주석은 남긴다.
  - store `cancelByWalletIntentAfterRefund`: `const view = await this.cancellation.noticeWalletRefundApproval({ … })`, «returned no cancel request» throw 를 지운다. 로그·반환 그대로.
  - `npx jest scripts/security` 가 빨가면 `idor-reviewed.spec.ts` 의 store 줄 좌표를 옮긴다.

- [ ] **Step 4: 통과 확인** — Step 2 명령 + `npx jest scripts/security apps/core/src/modules/sales-order/channel-cancel-request` PASS. 통합(`k6_it`): `channel-cancel-request.integration.spec.ts`, `request-vs-gate.integration.spec.ts` PASS. `npm run type-check` 기준선.

- [ ] **Step 5: 커밋** — `git commit -m "fix(core): 무통장 승인 취소는 받아들인 뒤 인쇄를 멈춘다 — 확정과 붙잡기를 한 트랜잭션, record 는 커밋 뒤 (K7 PR2, D6)"`

---

### Task 4: 커널 읽기를 Reader 로, ADR·스펙 갱신

**Files:**
- Modify: `apps/core/src/modules/sales-order/order-cancellation/order-cancellation.reader.ts`, `order-cancellation.ts`(`request` 의 판매주문 읽기, `linesWithoutPrint`)
- Modify: `apps/core/src/modules/sales-order/order-cancellation/order-cancellation.guard.spec.ts`
- Modify: `docs/adr/0049-order-cancellation-one-kernel-owns-the-sequence.md` (§2 결정 2번 문장, «현재 상태»), `docs/superpowers/specs/2026-10-24-k7-order-cancellation-design.md` §10
- Test: `order-cancellation/order-cancellation.spec.ts`, `services/store-sales-orders.service.spec.ts`(목만)

**Interfaces:**
- Consumes: Task 1~3 의 커널 메서드
- Produces:
  ```ts
  // OrderCancellationReader — 지금처럼 의존성 없음, 호출자 트랜잭션으로 읽는다
  salesOrder(salesOrderId: string, tx: DbTx): Promise<SalesOrderRow | undefined>; // SalesOrderRow = typeof wmsTables.salesOrders.$inferSelect
  digitalLineIds(salesOrderId: string, tx: DbTx): Promise<Set<string>>; // isDigitalFulfillmentLine 로 거른 줄 id
  ```

- [ ] **Step 1: 실패하는 테스트** — 가드에 `it('커널은 DbService 의 db 를 직접 쓰지 않는다 — 읽기는 Reader, 트랜잭션은 run', () => expect(filesCalling(/\bthis\.db\.db\b/, 'apps/core/src/modules/sales-order/order-cancellation')).toEqual([]))`.

- [ ] **Step 2: 실패 확인** — `npx jest apps/core/src/modules/sales-order/order-cancellation/order-cancellation.guard.spec.ts` → FAIL(`order-cancellation.ts`).

- [ ] **Step 3: 구현** — `request` 의 판매주문 읽기는 `this.db.run((tx) => this.reader.salesOrder(id, tx))`, `linesWithoutPrint` 는 디지털 줄과 `planCancellation` 을 `this.db.run` 한 번 안에서. 커널 spec·store spec 의 db 목은 `run: jest.fn((fn) => fn(<지금 db.db 목>))` 이면 기존 체인 그대로 돈다. 판정·순서는 그대로.
  - ADR-0049: 결정 2번의 «`notice(…, tx)` … `afterCommit(followUp)` 으로 따로 돌려받는다» 를 PR 2 모양(소스별 메서드 셋, `receiveChannelCancellation` 이 트랜잭션을 열고 커밋 뒤 record)으로 고친다. «현재 상태» 에서 N2·N3·N4 를 지우고 «PR 2: 통보 세 문은 받아들인 뒤 트랜잭션 안 붙잡기 → 커밋 뒤 record(D6·D7), 판매주문 코드의 `print_orders` 직접 UPDATE 0» 한 단락. N1 은 남는다.
  - 스펙 §10 에 `- PR 2: 와우프레스 순서 — 통보 세 문의 받아들이기·붙잡기·커밋 뒤 record(D6·D7), 채널 취소 수신을 한 번 부르기.`

- [ ] **Step 4: 통과 확인** — `npx jest apps/core/src/modules/sales-order apps/core/src/modules/print-order scripts/security` 실패 0. 통합(`k6_it`): sales-order·print-order 전체 기준선 외 실패 0. `npm run type-check` 기준선.

- [ ] **Step 5: 커밋** — `git commit -m "refactor(core): 커널 읽기를 Reader 와 DbService.run 으로, ADR-0049 를 PR 2 모양으로 (K7 PR2)"`
