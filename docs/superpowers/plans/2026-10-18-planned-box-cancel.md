# 계획된 상자의 취소 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 시작된 배치 밖 상자(draft·planned, 시작 전 배치 안 포함)의 취소를 그 자리에서 끝내고, 남은 대기는 리컨실러가 재개하며, 고객 셀프취소 버튼과 서버 거절을 한 판정으로 묶는다(#1016 30·33번).

**Architecture:** `ShipmentPlanningService` 의 `requiresDurableReplan` 을 «취소 준비도»(`cancelReadiness`) 하나로 바꾸고, 준비됐으면 시작 전 배치 빼기·`registered` 송장 무효화·planned→draft 를 한 트랜잭션에서 한 뒤 기존 draft 취소로 끝낸다. 같은 준비도·손질을 `resumePendingCancellation` 도 쓴다. 시작 전 배치 빼기·송장 무효화의 저수준 동작은 이미 두 서비스가 공유하는 `BoxWithdrawalService` 로 모은다. 셀프취소는 순수 판정 함수 하나를 view·request 가 같이 부른다.

**Tech Stack:** NestJS, Drizzle(postgres.js), Jest(core 통합 스펙은 `describeIfDb` + rollback tx).

**Spec:** `docs/superpowers/specs/2026-10-18-planned-box-cancel-design.md` (develop `cab8909f5`)

## Global Constraints

- 마이그레이션 0. 새 enum·칸을 만들지 않는다. 규칙 상태는 기존 `shipment_reconcile_state`.
- 계약(`packages/event-contracts`)·스토어프론트·admin-web 은 바꾸지 않는다. 셀프취소 새 거절은 기존 사유 `already_processing`.
- 셀프취소 새 거절 문구(정확히): `처리 중인 주문이라 직접 취소할 수 없습니다. 고객센터로 문의해 주세요.`
- 송장 로컬 무효화는 `WaybillService.void` 만 쓴다(carrier HTTP 없음). 무효화 사유 `canceled`, 멱등 키 `cancel-exit:<operationId>:<shipmentId>`.
- 무효화 가능 = 활성 송장이 없거나 `registered`(`isVoidableOnExit`, `services/exit-waybill.ts`). 그 밖은 막힘.
- 시작된 배치(작업 항목의 배치 `startedAt` 있음)의 취소 동작은 바꾸지 않는다 — E10 이탈·일부 취소 대기 그대로.
- planned 되돌림·시작 전 배치 빼기·송장 무효화 중 하나라도 하면 `SHIPMENT_REOPEN` 스코프를 요구한다(`requireScope`, master 통과). 아무 손질 없는 draft 즉시 취소는 지금처럼 스코프 검사 없음.
- 새 규칙은 `mode: 'observe'` 로 들어간다.
- 레이어 규칙(CLAUDE.md): `as`·`any` 금지, 트랜잭션은 `dbService.run(fn, tx)`, private 헬퍼는 `tx: DbTx` 필수.
- 게이트: `npm run type-check` 에러 0, `npx jest` 실패 0. 통합 스펙은 `COMPOSE_PROJECT_NAME=almondyoung-server npx dotenv -e apps/core/.env -- npx jest --runInBand --runTestsByPath <파일>` 또는 `COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- <패턴>`.
- **구현 전 기준선:** 아래 «바뀌는 기존 스펙» 네 파일 + `batch-cancel-withdraw.integration.spec.ts` + `outbound-batch-orchestrator.integration.spec.ts` 를 develop 그대로 한 번 돌려 실패 목록을 적어 둔다. `shipment-planning.integration` 은 2026-08-25 에 기존 RED 였다 — 지금도 빨갛면 어느 케이스가 빨간지 적고, 이 작업이 새로 빨갛게 만든 것만 고친다.

## Review Focus

1. **배치 시작과 취소의 경합** — 시작 전 배치 상자를 취소하는 사이 배치가 시작되면, 둘 중 하나만 이겨야 한다. 준비도는 작업 항목을 `FOR UPDATE` 로 잡은 뒤 배치 `startedAt` 을 읽는다(`withdrawalTarget` 과 같은 순서). 시작이 이기면 취소는 «시작된 배치» 갈래로 간다. → Task 3 에 «작업 항목을 잡은 뒤 startedAt 을 읽는다» 단언을 코드 리뷰 항목으로 둔다(동시성 통합 테스트는 만들지 않는다).
2. **같은 키 재전송** — 즉시 취소가 끝난 뒤 같은 멱등 키로 다시 부르면 같은 응답이 오고 송장 무효화가 두 번 일어나지 않는다. → Task 3 테스트 `replays an immediate planned cancellation without voiding twice`.
3. **시작 전 배치 상자의 일부 취소** — 상자는 배치에서 빠지고 draft 로 돌아간다(남은 몫은 다시 계획·배치해야 한다). 배치의 다른 상자는 그대로 시작된다. → Task 3 테스트 `partial cancel of an unstarted-batch box leaves it draft and outside the batch`.
4. **draft 상자에 `registered` 송장** — 지금은 대기로 가지만 이제 무효화하고 즉시 끝난다. → Task 3 테스트 `voids a registered waybill on a draft box and cancels immediately`.
5. **다른 오퍼레이션을 기다리는 작업 항목** — 합포장 대기 등으로 작업 항목이 다른 오퍼레이션을 가리키면 지금처럼 `CANCELLATION_WORK_ITEM_ALREADY_WAITING` 로 거절·롤백된다. → 기존 테스트 `rejects replacing a work item waiting operation and rolls the new cancellation back` 가 그대로 초록이어야 한다(Task 3 검증 단계).

## 바뀌는 기존 스펙 (옛 동작을 박아 둔 것)

| 파일·테스트 | 지금 단언 | 바뀐 뒤 |
|---|---|---|
| `shipment-planning.integration.spec.ts` `stores a durable cancellation intent when a Planned shipment must reopen` (:346) | 시작 전 배치 작업 항목 + 일부 취소 → `pending` | 배치를 **시작된** 상태(`startedAt: new Date()`)로 시드해 «시작된 배치 일부 취소 = 대기»를 지키는 테스트로 바꾼다. 단언은 그대로 |
| `shipment-planning.integration.spec.ts` `rejects replacing a work item waiting operation…` (:398) | `CANCELLATION_WORK_ITEM_ALREADY_WAITING` | 그대로(손대지 않는다) |
| `consolidation.integration.spec.ts` `cancels one source order's consolidated line and replans the surviving target` (:180) | 합포장 대상 취소 → `pending` → `resumePendingCancellation` → `completed` | `cancelOutstanding` 이 바로 `completed`. `resumePendingCancellation` 두 줄을 지우고, 같은 키 재전송이 같은 응답인 단언은 남긴다. 나머지(남은 줄·비석 상자) 단언 그대로 |
| `outbound-v2-scenarios.integration.spec.ts` `04. cancels one consolidated source SO then voids, replans and reissues the survivor` (:872) | `pending` → 수동 `waybills.void` → `resumePendingCancellation` | `cancelOutstanding` 이 바로 `completed` 이고 송장이 이미 `voided`. 수동 void·resume 을 지우고 재계획·재발급 단계와 `['registered','voided']` 단언은 남긴다 |

---

### Task 1: 셀프취소 판정 하나 (#1016 33번)

**Files:**
- Create: `apps/core/src/modules/sales-order/services/self-cancel-block.ts`
- Create: `apps/core/src/modules/sales-order/services/self-cancel-block.spec.ts`
- Modify: `apps/core/src/modules/sales-order/services/store-sales-orders.service.ts` (`buildActionsView` :817-877, `processCancelRequest` :928-946)
- Test: `apps/core/src/modules/sales-order/services/store-sales-orders.service.spec.ts` (`buildActionsView fulfillmentStatus (V2)` 블록, `cancelRequestByChannelOrder` 블록)

**Interfaces:**
- Produces:
  ```ts
  export interface SelfCancelFacts {
    orderStatus: string;            // sales_orders.status
    salesChannel: string;           // 'medusa' 만 셀프취소
    hasShippedEvidence: boolean;
    pickingStarted: boolean;        // isPickingStarted(foRows)
    hasRecoveryBox: boolean;        // phaseInput.activeShipmentStatuses.includes('recovery_required')
  }
  export interface SelfCancelBlock { reason: StoreCancelUnavailableReason; message: string }
  export async function selfCancelBlock(
    facts: SelfCancelFacts,
    digitalDownloaded: () => Promise<boolean>,
  ): Promise<SelfCancelBlock | null>;
  ```
  순서와 문구(정확히): `cancelled` → `already_cancelled` «이미 취소된 주문입니다.» / 출고 증거 → `already_shipped` «이미 출고된 주문은 취소할 수 없습니다. 고객센터로 문의해 주세요.» / `salesChannel !== 'medusa'` → `channel_order` «`${salesChannel}` 채널 주문은 해당 채널에서 직접 취소해 주세요.» / 피킹 시작 → `already_processing` «피킹이 시작된 주문은 직접 취소할 수 없습니다. 고객센터로 문의해 주세요.» / 복구 중 상자 → `already_processing` «처리 중인 주문이라 직접 취소할 수 없습니다. 고객센터로 문의해 주세요.» / `digitalDownloaded()` → `digital_downloaded` «이미 다운로드한 디지털 상품이 포함된 주문입니다. 직접 취소가 불가하니 고객센터로 문의해 주세요.» `digitalDownloaded` 는 앞 다섯이 다 통과했을 때만 부른다.

- [ ] **Step 1: 판정 함수 유닛 테스트를 쓴다** — `self-cancel-block.spec.ts`

  ```ts
  const open: SelfCancelFacts = { orderStatus: 'pending', salesChannel: 'medusa', hasShippedEvidence: false, pickingStarted: false, hasRecoveryBox: false };
  it('아무것도 안 걸리면 null', async () => expect(await selfCancelBlock(open, async () => false)).toBeNull());
  it.each([
    [{ orderStatus: 'cancelled' }, 'already_cancelled'],
    [{ hasShippedEvidence: true }, 'already_shipped'],
    [{ salesChannel: 'naver' }, 'channel_order'],
    [{ pickingStarted: true }, 'already_processing'],
    [{ hasRecoveryBox: true }, 'already_processing'],
  ])('%o → %s', async (patch, reason) =>
    expect((await selfCancelBlock({ ...open, ...patch }, async () => false))?.reason).toBe(reason));
  it('복구 중 상자의 문구', async () =>
    expect((await selfCancelBlock({ ...open, hasRecoveryBox: true }, async () => false))?.message)
      .toBe('처리 중인 주문이라 직접 취소할 수 없습니다. 고객센터로 문의해 주세요.'));
  it('출고 증거가 채널보다 먼저', async () =>
    expect((await selfCancelBlock({ ...open, salesChannel: 'naver', hasShippedEvidence: true }, async () => false))?.reason).toBe('already_shipped'));
  it('디지털은 앞이 다 통과했을 때만 묻는다', async () => {
    const digital = jest.fn(async () => true);
    expect((await selfCancelBlock({ ...open, pickingStarted: true }, digital))?.reason).toBe('already_processing');
    expect(digital).not.toHaveBeenCalled();
    expect((await selfCancelBlock(open, digital))?.reason).toBe('digital_downloaded');
  });
  ```

- [ ] **Step 2: 실패 확인** — `npx jest apps/core/src/modules/sales-order/services/self-cancel-block.spec.ts` → 모듈 없음으로 FAIL

- [ ] **Step 3: `selfCancelBlock` 구현** — 위 순서·문구 그대로. `StoreCancelUnavailableReason` 은 `../dto/store-order-actions.dto` 에서.

- [ ] **Step 4: 통과 확인** — 같은 명령 PASS

- [ ] **Step 5: 서비스 테스트를 더한다** — `store-sales-orders.service.spec.ts`, 기존 `buildActionsView fulfillmentStatus (V2)` 의 픽스처 꼴(FO 행·상자 상태 목)을 따른다.
  - `FO recovery_required + 상자 recovery_required → availableActions 에 cancel 없음, cancelUnavailableReason 'already_processing'`
  - `cancelRequestByChannelOrder: 복구 중 상자가 있으면 BadRequestException(위 새 문구), cancelRequests.request 는 안 불림`
  - 기존 `FO processing → … already_processing` · `와우프레스 취소 거절(cancel_refused) 행만 있으면 already_processing` 은 그대로 초록이어야 한다

- [ ] **Step 6: 실패 확인** — `npx jest apps/core/src/modules/sales-order/services/store-sales-orders.service.spec.ts -t "복구 중"` → FAIL

- [ ] **Step 7: 두 곳을 판정 함수로 바꾼다**
  - `buildActionsView`: `timeout` → 그대로 아무 액션 없음. `cancelled` → `receipt`. 출고 증거 → 지금 갈래 그대로(`track`·`receipt`·반품·교환). 그 밖은 `block = await selfCancelBlock(facts, () => this.hasExercisedDigitalAsset(so.id))` 를 부르고, `block` 이 없더라도 지금의 인쇄 조건(`printStatuses` 에 `cancel_refused` 이고 인쇄 아닌 줄 없음)이면 `already_processing` 으로 둔다. 막혔으면 `receipt` 만 + `cancelUnavailableReason = block.reason`, 아니면 `cancel`·`receipt`. 출고 증거·취소 갈래의 `cancelUnavailableReason` 도 함수 결과로 채운다(값은 지금과 같다).
  - `processCancelRequest`: 재전송 확인·`timeout` 거절은 그대로 두고, `cancelled`·채널·출고 증거·피킹·디지털 다섯 검사를 `selfCancelBlock` 한 번으로 바꾼다 → 막혔으면 `throw new BadRequestException(block.message)`. 인쇄 단계(`printCancellation`)는 그대로.
  - `facts.hasRecoveryBox` 는 `phaseInput.activeShipmentStatuses.includes('recovery_required')` — 상자가 복구 중이면 예약 재계산이 FO 를 `recovery_required` 로 투영해서(`shipment-reservation.service.ts:1109`) `loadFulfillmentPhaseInput` 이 상자 상태를 읽는다.

- [ ] **Step 8: 통과 확인** — `npx jest apps/core/src/modules/sales-order` PASS, `npm run type-check` 0

- [ ] **Step 9: 커밋**
  ```bash
  git add apps/core/src/modules/sales-order/services/self-cancel-block.ts apps/core/src/modules/sales-order/services/self-cancel-block.spec.ts apps/core/src/modules/sales-order/services/store-sales-orders.service.ts apps/core/src/modules/sales-order/services/store-sales-orders.service.spec.ts
  git commit -m "fix(core): 셀프취소 버튼과 서버 거절을 한 판정으로 — 복구 중 상자는 «처리 중» (#1016 33번)"
  ```

### Task 2: 시작 전 배치 빼기·송장 무효화를 `BoxWithdrawalService` 로 모은다

동작 변화 없는 이동이다. 오케스트레이터의 시작 전 `excludeShipment` 와 다음 태스크의 취소가 같은 코드를 쓰게 한다.

**Files:**
- Modify: `apps/core/src/modules/fulfillment/services/box-withdrawal.service.ts`
- Modify: `apps/core/src/modules/fulfillment/services/outbound-batch-orchestrator.service.ts` (`excludeShipment` :374-395, `assertExcludable` :1336-1392, `liveAllocation` :1395-1411, `resumeWaitingOperation` :1432-1450)
- Test: `apps/core/src/modules/fulfillment/services/outbound-batch-orchestrator.integration.spec.ts`, `batch-withdraw.integration.spec.ts` (기존 그대로 초록)

**Interfaces:**
- Produces (`BoxWithdrawalService`, 모두 public):
  ```ts
  /** 시작 전 배치에서 빼는 걸 막는 사유. 없으면 null. 코드·문구는 지금 assertExcludable 그대로:
   *  WORK_ITEM_DISPATCH_EXISTS · WORK_ITEM_UNPICK_REQUIRED · WORK_ITEM_TOTE_RELEASE_REQUIRED · WORK_ITEM_ALLOCATED */
  unstartedExitBlocker(
    input: { shipmentId: string; shipmentStatus: string; lines: ReadonlyArray<{ id: string; inspectedQty: number }> },
    trx: DbTx,
  ): Promise<{ code: string; message: string } | null>;
  /** 완료·제외 아닌 작업 항목에 남은 배정이 있는가 (지금 orchestrator.liveAllocation) */
  hasLiveAllocation(shipmentId: string, trx: DbTx): Promise<boolean>;
  /** 시작 전 배치의 작업 항목을 excluded 로(지금 excludeShipment :375-395 의 CAS 그대로). 지면 409 WORK_ITEM_STALE_LEASE_VERSION */
  excludeUnstarted(workItem: WorkItemRow, reason: string, trx: DbTx): Promise<WorkItemRow>;
  /** 활성 송장이 없으면 아무것도 안 함, registered 면 로컬 무효화, 그 밖이면 409 WITHDRAWAL_WAYBILL_NOT_VOIDABLE */
  voidWaybillForCancel(shipmentId: string, ctx: { actorId: string; idempotencyKey: string; reason: string }, trx: DbTx): Promise<void>;
  ```
  기존 private `voidWaybillForCanceledExit` 는 `voidWaybillForCancel(shipmentId, { actorId, idempotencyKey: \`withdrawal-exit:${operationId}:${shipmentId}\`, reason: 'withdrawn:canceled' }, trx)` 를 부르게 바꾼다(키·사유 그대로).

- [ ] **Step 1: 기준선** — `outbound-batch-orchestrator.integration.spec.ts`·`batch-withdraw.integration.spec.ts`·`batch-cancel-withdraw.integration.spec.ts` 를 돌려 결과를 적는다

- [ ] **Step 2: 네 메서드를 `BoxWithdrawalService` 로 옮기고 오케스트레이터가 부르게 한다** — `assertExcludable` 은 `unstartedExitBlocker` 결과가 있으면 `this.conflict(code, message)` 를 던지는 얇은 래퍼, `resumeWaitingOperation` 의 배정 검사는 `hasLiveAllocation`, `excludeShipment` 시작 전 갈래의 update 는 `excludeUnstarted`. `databaseNow` 는 이미 `box-withdrawal.service.ts` 가 import 한다.

- [ ] **Step 3: 같은 결과 확인** — Step 1 의 세 스펙 결과가 같다. `npm run type-check` 0. `npx jest apps/core/src/modules/fulfillment` 유닛 PASS

- [ ] **Step 4: 커밋**
  ```bash
  git add apps/core/src/modules/fulfillment/services/box-withdrawal.service.ts apps/core/src/modules/fulfillment/services/outbound-batch-orchestrator.service.ts
  git commit -m "refactor(core): 시작 전 배치 빼기·송장 무효화를 BoxWithdrawalService 로 모은다 (#1016 30번 준비)"
  ```

### Task 3: 시작된 배치 밖 상자의 즉시 취소 (#1016 30번)

**Files:**
- Modify: `apps/core/src/modules/fulfillment/services/shipment-planning.service.ts` (`cancelOutstanding` :647-674, `resumePendingCancellation` :777-779, `requiresDurableReplan` :1463-1519 삭제)
- Test: `apps/core/src/modules/fulfillment/services/shipment-planning.integration.spec.ts`, `apps/core/src/modules/fulfillment/services/batch-cancel-withdraw.integration.spec.ts`
- Modify (옛 동작 테스트): `consolidation.integration.spec.ts` :180, `outbound-v2-scenarios.integration.spec.ts` :872 — 위 «바뀌는 기존 스펙» 표

**Interfaces:**
- Consumes: Task 2 의 네 메서드(`this.withdrawals`).
- Produces (private, `shipment-planning.service.ts`):
  ```ts
  type CancelReadiness =
    | { kind: 'ready'; unstartedWorkItem: WorkItemRow | null; voidWaybill: boolean }
    | { kind: 'started_batch' }
    | { kind: 'blocked'; codes: string[] };
  /** ownOperationId: 재개에서 «이 취소를 기다리는» 작업 항목은 막힘이 아니다. 즉시 취소에선 null */
  private cancelReadiness(aggregate: ShipmentAggregate, ownOperationId: string | null, tx: DbTx): Promise<CancelReadiness>;
  /** ready 일 때만: 작업 항목 excludeUnstarted(사유 = ctx.reason) → voidWaybill 이면 voidWaybillForCancel(키 `cancel-exit:${operationId}:${shipmentId}`, 사유 'canceled') → planned 면 draft(plannedAt null). 상태만 바꾸고 줄·manifestVersion 은 안 건드린다 */
  private settleForCancellation(aggregate: ShipmentAggregate, ready: Extract<CancelReadiness, { kind: 'ready' }>, ctx: { actorId: string; operationId: string; reason: string }, tx: DbTx): Promise<void>;
  ```
  `cancelReadiness` 판정(이 순서):
  1. 활성 작업 항목(`ACTIVE_WORK_ITEM_STATUSES`)을 `FOR UPDATE` 로 잡고, 있으면 그 배치 `startedAt` 을 읽는다. 있으면 `started_batch`.
  2. 시작 전 배치 작업 항목의 `waitingOperationId` 가 있고 `ownOperationId` 와 다르면 막힘 `WORK_ITEM_WAITING_OTHER`. 그 작업 항목은 `unstartedExitBlocker` 결과도 막힘 코드에 더한다.
  3. 활성 송장이 `isVoidableOnExit` 가 아니면 막힘 `WAYBILL_NOT_VOIDABLE`. `registered` 면 `voidWaybill: true`.
  4. 검수 수량 > 0 → `INSPECTED_QTY`. 정산 안 된 보관(`batch_inventory_session_balances`, qty>0, `SETTLED` 아님) → `UNSETTLED_CUSTODY`.
  5. 막힘 코드가 없으면 `ready`.
  완료된 합포장의 대상 여부는 보지 않는다(스펙 §4.1).

- [ ] **Step 1: 통합 테스트를 쓴다** — `shipment-planning.integration.spec.ts`. 시드는 기존 `physicalFixture`·`seedActiveWorkItem`, 송장은 `wmsTables.waybills` 에 `status: 'registered'`·`carrier`·`trackingNo`·`manifestVersion`·`recipientHash` 를 직접 넣는다(`outbound-batch-orchestrator.integration.spec.ts` 의 송장 시드 꼴). 각 테스트 이름과 단언:
  - `cancels a planned shipment outside any batch immediately and voids its registered waybill` — 전량 취소 → `operationStatus: 'completed'`, 상자 `canceled`, 송장 `voided`, 그 상자 줄의 `confirmed` 예약 0
  - `partial cancel of a planned shipment returns it to draft` — 3 중 1 → 상자 `draft`·`plannedAt` null, 줄 qty 2, 남은 몫 예약 2
  - **`batch-cancel-withdraw.integration.spec.ts` 에** (그 파일의 `seedTwoBoxBatch(tx, 1, 10)` + `assembleOutbound(tx)` + `cancel(...)` 헬퍼를 쓴다, 배치는 시작하지 않은 채):
    - `시작 전 배치의 상자를 전량 취소하면 배치에서 빼고 끝내고, 남은 상자로 배치가 시작된다` — `cancel(wiring, first, tx)` → `operationStatus: 'completed'`, `first` 의 작업 항목 `excluded`·`exclusionReason: '고객 취소'`, 상자 `canceled`, 송장 `voided` → `wiring.picking.start({ batchId: first.batchId, … })` 가 던지지 않고 `second` 의 작업 항목만 시작 대상이다
    - `시작 전 배치의 상자를 일부 취소하면 배치에서 빠지고 draft 로 돌아간다` — 수량 10 중 1 → 작업 항목 `excluded`, 상자 `draft`·`plannedAt` null, 줄 qty 9, 송장 `voided`
  - `voids a registered waybill on a draft box and cancels immediately` — draft + registered 송장 → `completed`, 송장 `voided`
  - `keeps a planned shipment pending while its waybill is still being issued` — 송장 `pending` → `operationStatus: 'pending'`, 상자 `recovery_required`/`CANCEL_REPLAN_PENDING`, 송장 그대로 `pending`
  - `replays an immediate planned cancellation without voiding twice` — 같은 키로 두 번 → 두 응답 `toEqual`, 그 상자의 `voided` 송장 행 1
  - **`apps/core/src/modules/sales-order/services/sales-orders.v2-cancellation-composition.integration.spec.ts` 에** `판매주문 전체 취소(시스템 actor)가 planned 상자를 대기 없이 취소한다` — 셀프취소·채널 취소가 타는 `SalesOrdersService.cancel` 경로. 판매주문 `cancelled`, 상자 `canceled`, `confirmed` 예약 0, `sales_order_cancellations.effects` 의 `shipment_outstanding_cancellation` 이 `operationStatus: 'completed'`
  - `requires SHIPMENT_REOPEN to cancel a planned shipment immediately` — `getScopesByRoles` 가 빈 Set 인 서비스·`roles: ['logistics_worker']` actor → `ForbiddenException`, 상자 그대로 `planned`
  - 기존 :346 테스트: 시드한 배치에 `startedAt: new Date()` 를 넣는다(단언 그대로)

- [ ] **Step 2: 실패 확인** — `COMPOSE_PROJECT_NAME=almondyoung-server npx dotenv -e apps/core/.env -- npx jest --runInBand --runTestsByPath apps/core/src/modules/fulfillment/services/shipment-planning.integration.spec.ts` → 새 테스트들이 `pending` 을 받아 FAIL

- [ ] **Step 3: `cancelReadiness`·`settleForCancellation` 구현, `cancelOutstanding` 을 바꾼다**
  - E10(`withdrawalTarget`) 갈래 뒤에서 `readiness = await this.cancelReadiness(aggregate, null, tx)`.
  - `readiness.kind !== 'ready'` 이거나 `aggregate.shipment.recoveryCode !== null` 이면 지금의 대기 갈래 그대로(`requireScope` → `markActiveWorkItemWaitingForCancellation` → `recovery_required`/`CANCEL_REPLAN_PENDING` → …).
  - `ready` 면: planned 이거나 `unstartedWorkItem`·`voidWaybill` 중 하나라도 있으면 `requireScope(actor, FULFILLMENT_SCOPE.SHIPMENT_REOPEN)` → `settleForCancellation(aggregate, readiness, { actorId: actor.id, operationId: operation.id, reason: dto.reason }, tx)` → 상자를 다시 읽어(`loadAggregate`) 지금의 `SHIPMENT_NOT_DRAFT` 검사 → `applyDraftCancellation`.
  - 작업 항목을 뺄 때 감사 로그: `auditCommand(tx, actor, 'outbound_batch.shipment.exclude_for_cancel', operation.id, dto.reason, { shipmentId, workItemId, batchId })`.
  - `requiresDurableReplan` 을 지운다.

- [ ] **Step 4: `resumePendingCancellation` 도 같은 손질을 쓴다** — :777-778 의 두 assert 앞에서 `cancelReadiness(aggregate, operationId, trx)` 가 `ready` 면 `settleForCancellation(…, { actorId: operation.operatorId, operationId, reason: pending.reason }, trx)` 를 하고, 그 뒤 기존 두 assert 를 그대로 둔다(남은 막힘은 지금 코드 그대로 `SHIPMENT_ACTIVE_INVOICE`·`SHIPMENT_CUSTODY_EXISTS`·`SHIPMENT_ACTIVE_WORK_ITEM`). `settleForCancellation` 은 대기 상자를 draft 로 되돌리지 않는다 — `applyPendingCancellation` 이 이미 한다(planned 되돌림은 `status === 'planned'` 일 때만).
  - 테스트 하나 더: `resume voids a registered waybill left by a manual unstarted-batch exclusion` — 시작 전 배치 상자를 옛 방식으로 대기시킨다(오퍼레이션·`pendingIntent`·멤버·`recovery_required` 를 직접 시드하거나, 송장 `pending` 으로 대기시킨 뒤 `registered` 로 바꾼다) → 작업 항목을 `excluded` 로 → `resumePendingCancellation` → `completed`, 송장 `voided`.

- [ ] **Step 5: 통과 확인** — Step 2 명령 PASS. 기존 `rejects replacing a work item waiting operation…` 초록(Review Focus 5).

- [ ] **Step 6: 옛 동작 테스트를 바꾸고 돌린다** — «바뀌는 기존 스펙» 표의 `consolidation.integration.spec.ts` :180, `outbound-v2-scenarios.integration.spec.ts` :872. `batch-cancel-withdraw.integration.spec.ts` 의 기존 E10·E11 케이스(시작된 배치)는 그대로 초록이어야 한다.
  ```bash
  COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- "fulfillment/services/(shipment-planning|consolidation|outbound-v2-scenarios|batch-cancel-withdraw|outbound-batch-orchestrator).integration"
  ```
  기대: 기준선에서 이미 빨갛던 것 말고 전부 PASS.

- [ ] **Step 7: 게이트** — `npm run type-check` 0, `npx jest apps/core/src/modules/fulfillment` PASS

- [ ] **Step 8: 커밋**
  ```bash
  git add apps/core/src/modules/fulfillment/services/shipment-planning.service.ts apps/core/src/modules/fulfillment/services/shipment-planning.integration.spec.ts apps/core/src/modules/fulfillment/services/batch-cancel-withdraw.integration.spec.ts apps/core/src/modules/sales-order/services/sales-orders.v2-cancellation-composition.integration.spec.ts apps/core/src/modules/fulfillment/services/consolidation.integration.spec.ts apps/core/src/modules/fulfillment/services/outbound-v2-scenarios.integration.spec.ts
  git commit -m "fix(core): 시작된 배치 밖 상자의 취소는 그 자리에서 끝낸다 — 시작 전 배치는 빼고 registered 송장은 무효화 (#1016 30번)"
  ```

### Task 4: 재판정 규칙 — 대기 취소 재개 (#1016 30번)

**Files:**
- Create: `apps/core/src/modules/fulfillment/order-reconcile/rules/resume-pending-cancellation.rule.ts`
- Create: `apps/core/src/modules/fulfillment/order-reconcile/rules/resume-pending-cancellation.rule.spec.ts`
- Create: `apps/core/src/modules/fulfillment/order-reconcile/rules/resume-pending-cancellation.rule.integration.spec.ts`
- Modify: `apps/core/src/modules/fulfillment/order-reconcile/order-reconcile.registry.ts` (한 줄)
- Modify: `apps/core/src/modules/fulfillment/services/shipment-planning.service.ts` (public 셋 추가)

**Interfaces:**
- Consumes: Task 3 의 `cancelReadiness`·`settleForCancellation`.
- Produces (`ShipmentPlanningService`, public):
  ```ts
  /** 이 상자를 원본(role 'source')으로 둔 pending 취소 오퍼레이션(가장 이른 것). 없으면 null */
  findPendingCancellationOperationId(shipmentId: string, tx?: DbTx): Promise<string | null>;
  /** 잠그지 않고 재개 가능 여부를 묻는다. pending 이 아니면 null. blockers 는 cancelReadiness 의 막힘 코드 + 'STARTED_BATCH'(started_batch 일 때) */
  cancellationResumeReadiness(operationId: string, tx?: DbTx): Promise<{ operationId: string; shipmentId: string; blockers: string[] } | null>;
  /** resumePendingCancellation 을 부르되 ConflictException 은 'blocked' 로 접는다 */
  tryResumePendingCancellation(operationId: string, tx?: DbTx): Promise<'completed' | 'blocked' | 'already_completed'>;
  ```
  `cancellationResumeReadiness` 는 `cancelReadiness` 와 같은 판정을 쓰되 `FOR UPDATE` 없이 읽는다 — 판정 함수에 «잠글지» 인자를 두거나 읽기 부분을 나눈다(빌더 판단). 규칙과 도메인이 갈리지 않게 **같은 함수**여야 한다(25번 `resumeReadiness` 와 같은 이유).
- Rule (25번 규칙 꼴):
  ```ts
  @Injectable()
  export class ResumePendingCancellationRule implements ShipmentReconcileRule {
    readonly name = 'resume-pending-cancellation';
    readonly row = 30;
    readonly subject = 'shipment' as const;
    readonly mode: ReconcileMode = 'observe';
    readonly situation: ShipmentReconcileSituation = { stage: 'cancel', states: ['CANCEL_REPLAN_PENDING'] };
    fingerprint(shipmentId, tx): `${operationId}|${blockers.sort().join('+')}` · 오퍼레이션 없으면 'none' · pending 아니면 `${operationId}|not_pending`
    check(shipmentId, tx): 정비 모드면 false(workflowGate.allowsOperationalMutations) · 오퍼레이션 없거나 readiness null·blockers 있으면 false · 그 밖 true
    act(shipmentId, tx): tryResumePendingCancellation === 'completed' ? 'acted' : 'noop'
  }
  ```
  틀의 제외 목록은 넓히지 않는다 — 채널 취소 정산 중 주문이 이 규칙의 주 대상이다(스펙 §4.2).

- [ ] **Step 1: 유닛 테스트** — `resume-pending-cancellation.rule.spec.ts`, `resume-pending-consolidation.rule.spec.ts` 의 목 꼴을 따른다
  - `정비 모드면 check false`
  - `대기 오퍼레이션이 없으면 check false, fingerprint 'none'`
  - `막힘이 있으면 check false, fingerprint 에 막힘 코드`
  - `막힘이 없으면 check true`
  - `act: completed → acted, blocked → noop, already_completed → noop`
  - `row 30, mode observe, situation cancel/CANCEL_REPLAN_PENDING`

- [ ] **Step 2: 실패 확인** — `npx jest apps/core/src/modules/fulfillment/order-reconcile/rules/resume-pending-cancellation.rule.spec.ts` FAIL

- [ ] **Step 3: 서비스 public 셋 + 규칙 + 레지스트리 한 줄**(`ResumePendingCancellationRule, // #1016 30번`). `OrderReconcileModule` 이 `FulfillmentModule` 을 이미 import 하므로 `ShipmentPlanningService` 가 그 모듈에서 export 되는지 확인하고, 안 되면 export 를 더한다.

- [ ] **Step 4: 유닛 통과** — Step 2 명령 PASS

- [ ] **Step 5: 통합 테스트** — `resume-pending-cancellation.rule.integration.spec.ts`, 25번 통합 스펙의 시드·러너 꼴을 따른다
  - `송장 발급 중이면 check false·지문에 WAYBILL_NOT_VOIDABLE, 송장이 registered 가 되면 지문이 바뀌고 check true` (대기는 Task 3 의 `pending` 송장 경로로 만든다)
  - `act: 재개해 끝내면 acted — 송장 voided, 상자 canceled, 다시 부르면 noop`
  - `시작된 배치의 일부 취소 대기는 check false(STARTED_BATCH)`
  - `투영 → 러너 → 규칙: 관찰 모드는 would_act 만 남기고 상자·송장 그대로, 실행 모드로 주입하면 한 번만 끝낸다`
  - `셀메이트로 출고된(판매주문 shipped) 주문의 상자는 후보가 아니다`(틀의 D16 제외가 걸리는지)

- [ ] **Step 6: 통합 통과** — `COMPOSE_PROJECT_NAME=almondyoung-server npx dotenv -e apps/core/.env -- npx jest --runInBand --runTestsByPath apps/core/src/modules/fulfillment/order-reconcile/rules/resume-pending-cancellation.rule.integration.spec.ts` PASS. `grep -rln --include='*.rule.ts' "mode: ReconcileMode = 'observe'" apps/core/src/modules/fulfillment/order-reconcile/rules` 에 새 파일이 나온다.

- [ ] **Step 7: 게이트** — `npm run type-check` 0, `npx jest` 실패 0(전체)

- [ ] **Step 8: 커밋**
  ```bash
  git add apps/core/src/modules/fulfillment/order-reconcile apps/core/src/modules/fulfillment/services/shipment-planning.service.ts
  git commit -m "feat(core): 리컨실러 규칙 — 막힘이 풀린 대기 취소를 재개한다, 관찰 모드 (#1016 30번)"
  ```

## 머지 뒤 (코드 밖, 사람·운영)

- PR 본문에: 마이그 0 · 배치 배포 가능 · 새 규칙 관찰 모드 · 라이브엔 planned 상자가 없어 컷오버 전엔 새 갈래가 돌지 않음.
- #1016: 30·33번 «해결» 칸에 머지 커밋 해시. «남은 운영 작업»에 체크박스 `30번 행 실행 모드 전환 — 관찰 기간 `shipment_reconcile_state` 의 `resume-pending-cancellation` would_act 검토 → 거짓 양성 0 → mode act PR. 컷오버 전엔 후보가 0일 수 있다 — 참 양성 0 이면 PR 본문에 그 사실을 적는다` 와 `30번 행 배포 전 — 라이브 `shipments` 의 `recovery_required`+`CANCEL_REPLAN_PENDING` 건수(읽기 전용)`. 고친 뒤 아티팩트 재게시.
