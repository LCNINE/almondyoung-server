# K7 PR 4 — 환불 방침: 커널은 «환불을 요청할지»만 기록하고, 돈은 결제 쪽이 움직인다 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** core 가 돈을 쥔 주문(`settlesMoney: 'core'`, 지금 `3pl` 하나)의 취소도 커널 문 하나로 돈다. 고객 셀프취소는 같은 트랜잭션에 환불 요청 한 줄을 남기고 커밋 뒤 실행(D1), 관리자 취소는 Wallet 을 부르지 않고 «환불 결정 전»으로 남긴다(D2). 관리자 주문내역의 환불 필터를 그 목록으로 넓히고 «환불 실행 / 환불 안 함» 결정을 붙인다(스펙 §5.5).

**Architecture:** 환불 쪽 코드(Wallet 호출·환불 링크 기록·재시도·수동 완료)를 `StoreSalesOrdersService` 에서 결제 쪽 매니저 `CancellationRefundManager` 로 옮긴다. 커널은 이 매니저에게 «이 방침이면 취소 기록에 무엇을 남기나»를 물어 `SalesOrdersService.cancel` 의 기존 `walletRefund` 효과로 넘긴다 — 환불 링크가 취소와 같은 트랜잭션·같은 취소 id 로 써진다. 커밋 뒤 «즉시» 요청의 실행도 매니저가 한다(와우프레스 record 와 같은 꼴). 커널은 Wallet 클라이언트를 모른다.

**Tech Stack:** NestJS(core), Drizzle, Jest(unit + `REQUIRE_*_DB` 통합 — 스크래치 DB `k6_it`), Next.js(admin-web, 순수함수 spec).

**Spec:** `docs/superpowers/specs/2026-10-24-k7-order-cancellation-design.md` (§5.5·§5.7·§5.9·§6 D1·D2·§9). PR 1~3 결정은 `docs/adr/0049-order-cancellation-one-kernel-owns-the-sequence.md`.

## 계획을 정한 사실 (2026-10-24 develop `aa9d50f7b`)

- **core 가 돈을 쥔 채널은 `3pl` 하나다**(`channel-cancellation-capability.ts:56` — `cancel: 'core'`, `settlesMoney: 'core'`, `customerSelfCancel: false`). 라이브 core 직접 주문 0건(사용자, 스펙 D1·D2).
- **커널 `request` 는 `cancel === 'core'` 면 던진다**(`order-cancellation.ts:66`). 관리자 문은 그 전에 `settlesMoney === 'core'` 를 옛 갈래로 돌린다(N1, `store-sales-orders.service.ts:161~257`) — 전체취소는 커밋 뒤 Wallet 자동 환불(`requestWalletRefundAfterCancel`), 부분취소는 한 트랜잭션에 `manual_pending` 링크 + 추정액(`calculatePartialCancellationRefund`).
- **고객 문은 3pl 에 닿지 않는다.** `selfCancelBlock` 이 `customerSelfCancel: false` 로 `channel_order` 거절을 먼저 낸다(`self-cancel-block.ts:39`). 스펙 §4.1 의 «core 직접 고객 취소는 에러»는 PR 1 의 능력 표 이후 «셀프취소 차단»으로 바뀌었다.
- **환불 요청 한 줄을 남길 자리가 이미 있다.** `cancel()` 의 옵션 `walletRefund`(`CancelSalesOrderWalletRefundDto`)는 세 갈래(상자 전 전체 `:1298`·부분 `:1471`·상자 후 `:1818`) 모두에서 효과 `linked_wallet_refund` 가 되고, 같은 트랜잭션에 business link `cancellation_linked_wallet_refund` 를 `orderCancellationId` 와 함께 쓴다(`:2486`). 지금 이 옵션을 넘기는 운영 코드는 0(HTTP DTO 에도 안 열려 있다 — 컨트롤러가 칸을 골라 넘긴다).
- **환불 링크의 상태 어휘**는 metadata `refundStatus`: `succeeded`·`pending`·`manual_pending`·`failed`(`StoreRefundStatus`). 수동 완료는 새 `succeeded` 링크에 `completedRefundLinkId` 를 달아 `manual_pending` 을 닫는다(`store-sales-orders.service.ts:430`).
- **관리자 «환불 실패/수동처리» 필터는 취소된 주문만 본다** — core 쿼리(`sales-orders.service.ts:786` `status = 'cancelled'`)도 admin-web(`refund-filter.utils.ts:19`)도. 부분취소(주문은 살아 있음)의 `manual_pending` 은 행 배지로는 보이지만 필터에는 안 걸린다.
- **`retryWalletRefund` 는 환불 링크가 있으면 채널 주문이어도 Wallet 을 부른다**(`:474` — 링크가 없을 때만 막는다). 옛 core 경로 시절 Medusa 주문에 남은 링크가 있을 수 있어, admin-web 이 «환불 실행» 버튼을 아무 `manual_pending` 에나 띄우면 Medusa 가 이미 환불한 주문에 Wallet 환불이 한 번 더 나갈 수 있다(N19).
- admin-web 의 환불 상태 도출은 `use-order-rows.ts:274~317` 안의 즉석 함수다 — admin-web 은 컴포넌트 테스트가 없으니 순수함수로 빼서 spec 으로 판정한다.

## 이름 붙은 결정 (⛔ 사용자 확인)

- **N16. 환불 방침은 요청자에서 커널이 정한다 — 의도에 칸을 더하지 않는다.** 고객 요청 = 즉시, 운영자 요청 = 나중에 결정, 무통장 승인 = 이미 함, 채널 통보 = 채널이 함. 넷은 1:1 이라 칸을 두면 늘 같은 값을 적는 칸이 된다. 방침은 `settlesMoney === 'core'` 인 주문에만 효과가 있고, 채널 주문은 요청자와 무관하게 지금처럼 `CancelChannelOrder`(스펙 §5.5).
- **N17. 환불 요청 행 = 기존 환불 링크, 새 상태 `requested`. 마이그 없음.** 커널이 `cancel()` 에 `walletRefund` 효과로 넘겨 취소와 같은 트랜잭션·같은 `orderCancellationId` 로 쓴다. 실행은 커널이 커밋 뒤 `CancellationRefundManager.executeRequested` 를 부른다 — Wallet 멱등 키는 `cancel:<orderCancellationId>:initial`(재시도는 지금처럼 매번 새 키). outbox 이벤트로 하지 않는다: 보장(«커밋되면 요청은 남는다»)은 행이 하고, 실행이 죽어 `requested` 로 남은 건은 관리자 목록에 뜨고 거기서 «환불 실행»한다(스펙 §5.5). 실행이 던지면 커널은 로그만 남긴다 — 취소는 이미 커밋됐다.
- **N18. «나중에 결정» = `manual_pending` 링크 + metadata `awaitingDecision: true`.** 전체취소는 `note: '관리자 환불 결정 대기'`, 부분취소는 지금 추정액 기록 그대로(계산기는 결제 쪽 매니저로 옮길 뿐 바꾸지 않는다 — 금액 규칙은 K8). 고객 **부분**취소(«인쇄 빼고»)의 «즉시»도 금액 규칙이 없어 이 기록으로 떨어진다(스펙 §5.5 설계자 판단). `walletIntentId` 가 없어도 지금처럼 남긴다(`wallet:manual:<so>`).
- **N19. «환불 실행»·«환불 안 함» 버튼은 `awaitingDecision` 링크(와 `requested`)에만 뜬다.** 옛 `manual_pending` 링크(플래그 없음)는 지금 버튼(«수동 환불 완료»)만 그대로. 채널 이름으로 가르지 않고, 옛 Medusa 링크에 Wallet 환불이 다시 나갈 길을 열지 않는다.
- **N20. «환불 안 함»(`waived`)을 새로 둔다.** 스펙은 «기존 동작을 쓴다»고 했지만 기존엔 «외부에서 환불했다(수동 완료)»뿐이라, 환불하지 않기로 한 건이 목록에서 안 빠지거나 거짓 «환불 완료»가 된다. `POST /admin/sales-orders/:id/refund-waive`(`payment.refund.execute`, 본문 `{ adminNote?, refundLinkId? }`) — 대상 `awaitingDecision` 링크를 `completedRefundLinkId` 로 닫는 `waived` 링크를 쓴다. 스토어프론트에는 `waived` 를 `none` 으로 보인다(DTO enum 은 그대로 — storefront parity).
- **N21. 3pl 의 `customerSelfCancel` 은 `false` 그대로.** D1 은 커널에서 성립하고 커널 spec 이 지킨다. 3pl 주문엔 스토어프론트 고객이 없다 — 켜는 건 3pl 고객 화면이 생길 때.
- **N22. 필터를 «환불 결정 전·실패»로 넓힌다 — 주문 상태 조건을 뗀다.** ① 닫히지 않은 `manual_pending`(닫기 = `succeeded` 또는 `waived` 의 `completedRefundLinkId`) ② 최신 링크 `failed` ③ 최신 링크 `requested`. 옛 부분취소 `manual_pending`(주문이 살아 있음)이 처음 필터에 걸린다 — 배포 전 G1 ①로 수를 본다.

## 동작 변경 (스펙 §6 대조)

| | 변경 | 라이브 영향 |
|---|---|---|
| D1 | core 정산 주문의 고객 셀프취소를 커널이 받는다: 전체 = `requested` 링크 → 커밋 뒤 Wallet 환불, 부분 = «나중에 결정» | 0 — 3pl 은 셀프취소 차단이 먼저 막는다(N21) |
| D2 | core 정산 주문의 관리자 전체취소가 Wallet 자동 환불을 부르지 않는다 → `awaitingDecision` `manual_pending` | 0 (3pl 주문 0) |
| — | core 정산 주문의 관리자 취소에 멱등 키가 없으면 400(커널 규칙). 컨트롤러·인쇄 보드는 늘 키를 넘긴다 | 0 |
| — | 환불 필터에 살아 있는 주문의 미결 `manual_pending`·`requested` 가 걸린다 | G1 ① 의 수만큼 목록이 늘어난다 |
| — | 행 배지 `requested` «환불 요청됨», `waived` «환불 안 함» | 새 상태만 |

## Global Constraints

- 커널(`order-cancellation/`)은 `WalletRefundClient`·`wallet-refund.client` 를 import 하지 않는다(가드 그대로). Wallet `refundByIntent(` 를 부르는 파일은 `CancellationRefundManager` 하나(Task 1 가드).
- 문구는 글자 그대로 옮긴다: `'이미 취소된 주문입니다.'`, `'타임아웃된 주문은 취소할 수 없습니다.'`, `'이미 환불한 금액은 Medusa 주문 부분취소에만 적을 수 있습니다.'`, `retryWalletRefund`·`adminManualRefundComplete` 의 400 문구 전부.
- 와우프레스 순서는 요청 규칙 그대로: precheck → gate(트랜잭션 밖) → 트랜잭션[cancel + 환불 효과] → 실패 시 `noteSalesCancelFailed`(스펙 §5.3).
- 금액 규칙(`calculatePartialCancellationRefund`, 전체취소 = `totalAmount`)은 바꾸지 않는다.
- admin-web 새 뮤테이션 훅은 `.permission` 을 선언하고 화면은 `run={…}`/`canRun(…)` 으로 판정한다(`mutation-guard.gate.spec.ts`). 새 core 라우트는 `@RequirePermission`(`route-classification.spec.ts`).

## Review Focus

- **환불 효과를 쓴 트랜잭션이 롤백되면 링크도 없어야 한다** — `cancel()` 이 상자 후 대기 등으로 던질 때 `requested`/`manual_pending` 링크가 남으면 취소 안 된 주문이 «환불 결정 전» 목록에 뜬다. Task 2 통합 테스트가 고정.
- **같은 멱등 키로 다시 온 관리자 취소** — 두 번째 링크가 생기면 안 되고 첫 결과를 돌려줘야 한다. Task 2.
- **`requested` 를 남긴 고객 취소에서 실행이 던짐** — 응답은 성공(취소됨)이고 링크는 `requested` 로 남아 필터 ③에 걸린다. Task 2 단위 + Task 3 쿼리.
- **«환불 안 함» 뒤의 재시도·수동 완료** — `waived` 로 닫힌 링크는 다시 결정 대상이 아니다(재시도 400·수동 완료 대상 아님). Task 1.
- **스토어프론트가 모르는 상태** — `requested` 는 `pending`, `waived` 는 `none` 으로 보여야 한다(지금 미지 값은 `pending` 으로 떨어진다 — `waived` 가 «환불 처리중»으로 영영 남는 사고). Task 3.

---

### Task 1: 결제 쪽 매니저 `CancellationRefundManager` — 옮기기 + 방침 기록·실행·환불 안 함

**Files:**
- Create: `apps/core/src/modules/sales-order/cancellation-refund/cancellation-refund.manager.ts`
- Create: `apps/core/src/modules/sales-order/cancellation-refund/cancellation-refund.types.ts`
- Create: `apps/core/src/modules/sales-order/cancellation-refund/cancellation-refund.manager.spec.ts`
- Create: `apps/core/src/modules/sales-order/cancellation-refund/wallet-refund-callers.guard.spec.ts`
- Move: `services/partial-cancellation-refund-calculator.ts`(+spec) → `cancellation-refund/` (import 경로만 고친다)
- Modify: `apps/core/src/modules/sales-order/services/store-sales-orders.service.ts` (`retryWalletRefund`·`adminManualRefundComplete` 는 매니저에 한 줄 위임, `requestWalletRefundAfterCancel`·`recordWalletRefundLink` 는 매니저로 이동, 관리자 core 갈래는 아직 매니저의 옮긴 메서드를 부른다)
- Modify: `apps/core/src/modules/sales-order/sales-order.module.ts` (provider 등록)
- Modify: `apps/core/src/modules/sales-order/services/store-sales-orders.service.spec.ts` (옮긴 테스트는 매니저 spec 으로)

**Interfaces:**
- Produces (`cancellation-refund.types.ts`):
  - `export type RefundPolicy = 'immediate' | 'decide_later';`
  - `export const REFUND_REQUESTED = 'requested'; export const REFUND_WAIVED = 'waived';` (링크 상태 — `StoreRefundStatus` 에 넣지 않는다)
- Produces (`CancellationRefundManager`, `@Injectable`, 생성자 `DbService<typeof wmsSchema>`·`SalesOrdersService`·`WalletRefundClient`):
  - `effectFor(policy: RefundPolicy, so: SalesOrderRow, lines: CancelLine[] | undefined, reasonCode: string | undefined, tx: DbTx): Promise<CancelSalesOrderWalletRefundDto>` — 커널이 `cancel()` 의 `walletRefund` 로 넘길 값.
    - `immediate` + 전체 → `{ externalRef: wallet:intent:<id> | wallet:manual:<so>, refundStatus: 'requested', metadata: { intentId, reasonCode, actor: 'customer' } }` (금액 없음 — 스펙 §5.5)
    - `decide_later` + 전체 → `refundStatus: 'manual_pending'`, `metadata: { awaitingDecision: true, note: '관리자 환불 결정 대기', intentId, reasonCode, actor: 'admin' }`
    - 부분(방침 무관) → `refundStatus: 'manual_pending'`, `metadata` = 지금 `adminCancelRequest` 부분 갈래의 `extraMetadata` 그대로(`cancellationScope`·`manualReason`·`refundEstimateAmount`·`breakdown`·`cancelledLines`·`warnings`) + `awaitingDecision: true` + `note: \`부분취소 수동 검토 필요: ${manualReason}\``, `actor` 는 방침에 따라 customer/admin. 추정은 tx 로 읽은 주문 줄로 `calculatePartialCancellationRefund`.
  - `executeRequested(salesOrderId: string): Promise<StoreRefundStatus | null>` — 판매주문이 `cancelled` 이고(상자 후 취소가 박스 작업 중이라 «대기»로 끝났으면 아직 아니다 — 물건이 나갈 수 있는데 돈부터 나가지 않게, `requested` 로 남겨 목록에서 결정) 최신 환불 링크가 `requested` 일 때만 옮긴 `requestWalletRefundAfterCancel(so, { reasonCode }, { actor: 'customer', attemptType: 'initial', correlationId: \`cancel:${orderCancellationId}:initial\` })`. 아니면 `null`.
  - `retry(orderId)` / `completeManually(orderId, dto)` — 지금 `retryWalletRefund`·`adminManualRefundComplete` 본문. 바뀌는 것 둘: 재시도는 최신 링크가 `waived` 면 400 `'환불하지 않기로 한 주문입니다.'`; 수동 완료·재시도의 «미완료 manual_pending» 판정은 `succeeded` 와 `waived` 둘 다를 닫힘으로 본다.
  - `waive(orderId: string, dto: { adminNote?: string; refundLinkId?: string }): Promise<{ refundStatus: 'waived' }>` — 대상 = `refundLinkId` 의 링크, 없으면 가장 최근의 닫히지 않은 `awaitingDecision` `manual_pending`(또는 최신이 `requested`). 대상이 없으면 400 `'환불 결정 대기 건이 없습니다.'`. 이미 `waived` 로 닫혔으면 그대로 `{ refundStatus: 'waived' }`. 쓰는 링크: `refundStatus: 'waived'`, `completedRefundLinkId: <대상 id>`, `note: \`환불 안 함${adminNote ? \`: ${adminNote}\` : ''}\``, `actor: 'admin'`.

- [ ] **Step 1: 옮기기 테스트를 매니저 spec 으로** — store spec 의 `retryWalletRefund`·`adminManualRefundComplete`·Wallet outcome 별 기록 테스트를 매니저 spec 으로 옮겨(기대값 그대로) 빨갛게 확인.
- [ ] **Step 2: 새 테스트**
  - `effectFor` 넷: 즉시 전체 → `refundStatus 'requested'`·`amount` 없음·`externalRef 'wallet:intent:wi-1'`; 즉시 전체 + intent 없음 → `'wallet:manual:so-1'`; 나중 전체 → `awaitingDecision: true`·`note '관리자 환불 결정 대기'`; 부분 → `refundEstimateAmount` 가 계산기 값과 같고 `awaitingDecision: true`.
  - `executeRequested`: 최신이 `requested` → Wallet 호출 `correlationId 'cancel:oc-1:initial'`, 결과 링크 `succeeded`; 최신이 `succeeded` → Wallet 미호출·`null`; 주문이 아직 `cancelled` 가 아님(대기) → Wallet 미호출·`null`.
  - `waive`: 미결 `awaitingDecision` 링크를 `completedRefundLinkId` 로 닫는다; 대상 없음 → 400 `'환불 결정 대기 건이 없습니다.'`; 두 번 → 두 번째는 쓰지 않고 `waived`.
  - `retry`: 최신 `waived` → 400 `'환불하지 않기로 한 주문입니다.'`.
- [ ] **Step 3: 가드** `wallet-refund-callers.guard.spec.ts` — `apps/core/src` 에서 `/\.refundByIntent\(/` 를 부르는 비-spec 파일이 정확히 `['apps/core/src/modules/sales-order/cancellation-refund/cancellation-refund.manager.ts']`. walk 는 `order-cancellation.guard.spec.ts` 의 것을 복사(스펙·`__support__`·`__fixtures__` 제외).
- [ ] **Step 4: 구현** — 옮기고, store 는 위임. 이 Task 끝에서 관리자 core 갈래의 동작은 그대로다(D2 는 Task 2).
- [ ] **Step 5: 확인** `npx jest apps/core/src/modules/sales-order` 실패 0, `npm run type-check` 0.
- [ ] **Step 6: 커밋** `환불 기록·실행을 결제 쪽 매니저 하나로 모은다 — Wallet 을 부르는 파일은 CancellationRefundManager 하나 (K7 PR4)`

### Task 2: 커널이 core 정산 주문을 받는다 (D1·D2) — 관리자 문은 커널 한 번

**Files:**
- Modify: `apps/core/src/modules/sales-order/order-cancellation/order-cancellation.ts`
- Modify: `apps/core/src/modules/sales-order/order-cancellation/order-cancellation.types.ts`
- Modify: `apps/core/src/modules/sales-order/order-cancellation/order-cancellation.reader.ts` (최신 취소 id 읽기가 필요하면)
- Modify: `apps/core/src/modules/sales-order/order-cancellation/order-cancellation.spec.ts`
- Modify: `apps/core/src/modules/sales-order/order-cancellation/order-cancellation.guard.spec.ts` (STORE 를 셋 목록에서 뺀다)
- Modify: `apps/core/src/modules/sales-order/services/store-sales-orders.service.ts` (`adminCancelRequest` core 갈래·`afterPrintCancel`·계산기 import 삭제)
- Modify: `apps/core/src/modules/sales-order/services/store-sales-orders.service.spec.ts`
- Create: `apps/core/src/modules/sales-order/order-cancellation/core-settled-cancellation.integration.spec.ts` (`describeIfDb`, `channel-cancel-request/__support__/cancel-request.fixtures.ts` 의 `salesChannel: '3pl'` 픽스처)
- Modify: `docs/adr/0049-order-cancellation-one-kernel-owns-the-sequence.md` (현재 상태: N1 삭제, «PR 4: 환불 방침» 한 단락)

**Interfaces:**
- Consumes: Task 1 `CancellationRefundManager.effectFor`·`executeRequested`, `RefundPolicy`.
- Produces (`order-cancellation.types.ts`):
  ```ts
  export type CancellationOutcome =
    | { kind: 'channel_request'; view: CancelRequestView }
    | { kind: 'replayed' }
    | { kind: 'applied'; scope: 'full' | 'partial'; refund: CancellationRefundResult };
  export type CancellationRefundResult = {
    refundStatus: string; // 'requested' 실행 뒤면 Wallet 결과, 아니면 기록한 상태
    refundEstimateAmount?: number;
    manualReason?: string;
  };
  ```
  `OrderCancellation.request(intent): Promise<CancellationOutcome>` — 채널 경로는 `{ kind: 'channel_request', view }`(지금과 같은 view).

- [ ] **Step 1: 커널 단위 테스트(빨강)** — `makeKernel` 에 `refunds` 목(`effectFor`·`executeRequested`)과 `salesChannel: '3pl'`.
  - `'core 정산 주문의 운영자 전체취소 — precheck → gate → cancel(walletRefund = effectFor(decide_later)) 순서, Wallet 실행 없음'` (callOrder `['precheck','gate','cancel']`, `executeRequested` 미호출, 결과 `{ kind:'applied', scope:'full', refund:{ refundStatus:'manual_pending' } }`)
  - `'core 정산 주문의 고객 전체취소 — effectFor(immediate) 를 cancel 에 넘기고 커밋 뒤 executeRequested'` (callOrder 끝이 `'execute'`, `refund.refundStatus` = 실행 결과)
  - `'고객 excludePrint 부분취소는 effectFor 에 줄을 넘기고 실행하지 않는다'`
  - `'커밋 뒤 실행이 던져도 결과는 applied, refundStatus 는 requested'`
  - `'cancel 이 던지면 noteSalesCancelFailed 뒤 다시 던지고 실행하지 않는다'`
  - `'같은 키 재전송은 validateCancellationReplay 가 true 면 replayed — gate·cancel 없음'`
  - `'이미 취소/타임아웃이면 지금 문구로 400'`
  - `'core 정산 주문에 alreadyRefundedAmount 를 적으면 400'` (문구 Global Constraints)
  - 지운다: `'core 가 직접 취소하는 채널은 명령을 받지 않는다'`.
- [ ] **Step 2: 구현** — `request()` 에서 `cancel === 'core'` 면 `requestCoreSettled(intent, so)`:
  1. 키 없음 → 400(지금 커널 규칙). 재전송: `salesOrders.validateCancellationReplay(so.id, { sourceKey, reasonCode, reasonDetail, lines })` true → `{ kind: 'replayed' }`.
  2. `cancelled`·`timeout` 400(문구 그대로), 운영자 `alreadyRefundedAmount` 400.
  3. 줄: 운영자는 `intent.lines`, 고객은 지금 `requestAsCustomer` 의 `excludePrint` 계산 그대로. precheck → gate(고객은 `keepOnRefusal` 와 «인쇄 빼고» 안내 그대로 — 고객 gate 처리 코드를 두 경로가 함께 쓰게 뽑는다).
  4. `afterPrintCancel(printed, () => this.db.run(tx => { effect = refunds.effectFor(refundPolicyOf(intent.requester), so, lines, reasonCode, tx); salesOrders.cancel(so.id, { reasonCode, reasonDetail, lines, cancelledBy: 'admin' | 'customer', fulfillmentCommandContext: { idempotencyKey: sourceKey, actorId, actorRoles: [] }, walletRefund: effect }, tx) }))` — 운영자 `actorRoles` 는 문이 넘긴다(의도 타입 운영자 칸에 `actorRoles: string[]` 추가).
  5. `effect.refundStatus === 'requested'` 면 커밋 뒤 `executeRequested(so.id)` — 던지면 `logger.error` 후 `'requested'` 로 결과.
  - `refundPolicyOf(requester)`: customer → `'immediate'`, operator → `'decide_later'`(N16). 같은 파일의 비공개 함수.
- [ ] **Step 3: 문** — `adminCancelRequest` 는 `this.cancellation.request(…)` 한 번 뒤 결과를 지금 응답 모양으로: `channel_request` → `{ requestId, status, scope, convertedFromFull }`; `replayed` → 지금 replay 응답(`{ status: so.status, refundStatus: (await buildActionsView(so)).refundStatus }`); `applied` → `{ status: refreshed.status, refundStatus, refundEstimateAmount?, manualReason? }`. 고객 `processCancelRequest` 는 결과를 쓰지 않는다(그대로). store spec 의 core 갈래 테스트는 «커널에 넘긴 의도»와 «결과 → 응답 매핑» 검사로 바꾼다.
- [ ] **Step 4: 통합 테스트** `core-settled-cancellation.integration.spec.ts` (실제 커널·매니저, Wallet 클라이언트 목):
  - `'운영자 전체취소는 같은 취소 id 의 awaitingDecision manual_pending 링크 하나를 남기고 Wallet 을 부르지 않는다'`
  - `'운영자 부분취소는 추정액을 담은 링크를 남긴다'` (`refundEstimateAmount` = 계산기 값)
  - `'고객 전체취소는 requested 링크를 남기고, 커밋 뒤 Wallet 을 cancel:<취소 id>:initial 로 부른다'`
  - `'cancel 이 던지면 환불 링크도 없다'` (출고 증거로 거절되는 줄 — 링크 0행)
  - `'같은 키 두 번째 요청은 링크를 더 만들지 않는다'`
- [ ] **Step 5: 가드·ADR** — `order-cancellation.guard.spec.ts` 의 세 기대값에서 `STORE` 를 빼고 상수·주석 삭제. ADR-0049 «현재 상태» N1 단락을 지우고 «PR 4: core 정산 주문도 커널이 받는다. 환불 방침은 요청자에서 정하고(N16) 취소와 같은 트랜잭션의 환불 링크로 남긴다 — 실행·재시도·환불 안 함은 `CancellationRefundManager`(결제 쪽). 커널은 Wallet 을 모른다.»
- [ ] **Step 6: 확인** — `npx jest apps/core/src/modules/sales-order scripts/security` 실패 0, `REQUIRE_CORE_DB=1` 통합(`k6_it`) 실패 0, `npm run type-check` 0. `scripts/security/idor-reviewed.spec.ts` 가 store 줄 좌표를 고정하므로 store 를 고친 뒤 `npx jest scripts/security` 를 꼭 돌린다.
- [ ] **Step 7: 커밋** `core 가 돈을 쥔 주문의 취소도 커널 한 번 — 고객은 환불 요청 한 줄, 관리자는 환불 결정 전으로 (K7 PR4, D1·D2)`

### Task 3: «환불 결정 전·실패» 목록과 «환불 안 함» 라우트 (core)

**Files:**
- Modify: `apps/core/src/modules/sales-order/services/sales-orders.service.ts:778-849` (`refundIssueOnly`)
- Modify: `apps/core/src/modules/sales-order/controllers/admin-return-exchange.controller.ts` (waive 라우트, retry·manual-complete 는 매니저 위임 그대로)
- Modify: `apps/core/src/modules/sales-order/services/store-sales-orders.service.ts` (`buildActionsView` 상태 매핑 + `adminWaiveRefund` 한 줄 위임)
- Modify: `apps/core/src/modules/sales-order/services/sales-orders.list.integration.spec.ts`
- Modify: `apps/core/src/modules/sales-order/services/store-sales-orders.service.spec.ts`
- Create: `scripts/ops/k7-pr4-predeploy-check.js` (PR3 스크립트 꼴, 읽기 전용)

**Interfaces:**
- Consumes: Task 1 `CancellationRefundManager.waive`, `REFUND_REQUESTED`·`REFUND_WAIVED`.
- Produces: `POST /admin/sales-orders/:id/refund-waive` → `{ refundStatus: 'waived' }`, `@RequirePermission('payment.refund.execute')`, 본문 `AdminDecideRequestDto`.

- [ ] **Step 1: 목록 통합 테스트(빨강)** — `sales-orders.list.integration.spec.ts` 에 `refundIssueOnly` 묶음:
  - `'살아 있는 주문의 닫히지 않은 manual_pending 이 걸린다'`
  - `'waived 로 닫힌 manual_pending 은 안 걸린다'`
  - `'최신 링크가 requested 면 걸린다, 그 뒤 succeeded 가 오면 안 걸린다'`
  - 기존 `failed`·`succeeded` 종결 케이스는 그대로 통과.
- [ ] **Step 2: 쿼리** — `status = 'cancelled'` 조건 삭제, ① 의 닫힘 판정을 `refundStatus IN ('succeeded','waived')`, ② 옆에 ③ «최신 링크 `requested`»(② 와 같은 `notExists(later)` 꼴)를 OR 로. 주석의 규칙 셋을 갱신(admin-web 도출과 같은 규칙이라는 문장 유지).
- [ ] **Step 3: 스토어프론트 상태** — `buildActionsView` 의 저장값 해석을 작은 순수함수 `storeRefundStatusOf(stored: unknown): StoreRefundStatus`(같은 파일)로: `VALID_REFUND_STATUSES` 면 그대로, `'requested'` → `'pending'`, `'waived'` → `'none'`, 그 밖 → `'pending'`. 단위 테스트 `'waived 는 none, requested 는 pending'`. `refundSummary` 는 `none` 이면 만들지 않는다(지금 조건 그대로 따라온다).
- [ ] **Step 4: 라우트** — `adminWaiveRefund(@Param('id') id, @Body() dto: AdminDecideRequestDto)` → `storeSalesOrdersService.adminWaiveRefund(id, dto)` → 매니저 `waive`. `@HttpCode(200)`, `@ApiOperation({ summary: '취소 주문 환불 안 함 결정 (환불 결정 대기 건에만)' })`. `npx jest libs/authorization` 의 라우트 분류 spec 통과 확인.
- [ ] **Step 5: G1 스크립트** `scripts/ops/k7-pr4-predeploy-check.js` — 읽기 전용 트랜잭션, 셋:
  ① 이 PR 로 필터에 새로 걸리는 주문: `status <> 'cancelled'` 이고 닫히지 않은 `manual_pending` 환불 링크가 있는 판매주문 수(채널별) + 그 링크 `created_at` 최소·최대.
  ② `sales_channel = '3pl'` 판매주문 수(상태별) — D1·D2 가 닿는 주문. 0 이 예상.
  ③ 환불 링크 `refundStatus` 별 행 수 — 배포 전 `requested`·`waived` 0 이 정상.
  실행 줄은 PR3 스크립트 머리 주석과 같은 꼴(`cd deployments/lcnine/services && npx sst shell --stage live -- node -e "$(cat ../../../scripts/ops/k7-pr4-predeploy-check.js)"`).
- [ ] **Step 6: 확인** — `npx jest apps/core/src/modules/sales-order libs/authorization scripts/security` 실패 0, 통합 실패 0, `npm run type-check` 0.
- [ ] **Step 7: 커밋** `환불 필터가 «환불 결정 전·실패»를 본다 — 살아 있는 주문의 미결·요청 뒤 멈춘 환불, 환불 안 함 결정 (K7 PR4)`

### Task 4: admin-web — 환불 결정 버튼과 넓힌 필터

**Files:**
- Create: `apps/admin-web/src/features/order/history/hooks/refund-link.utils.ts` (+ `refund-link.utils.spec.ts`)
- Modify: `apps/admin-web/src/features/order/history/hooks/use-order-rows.ts:274-317` (즉석 함수 → `refundOfTimeline`)
- Modify: `apps/admin-web/src/features/order/history/hooks/refund-filter.utils.ts` (+ spec 이 없으면 만든다)
- Modify: `apps/admin-web/src/features/order/history/components/table/index.tsx` (배지 둘, 버튼)
- Modify: `apps/admin-web/src/features/order/history/components/modals/cancel-order-modal.tsx` (전체취소 `manual_pending` 문구)
- Modify: `apps/admin-web/src/features/order/history/components/filter-box/index.tsx`, `table/index.tsx:1095` (필터 문구)
- Modify: `apps/admin-web/src/lib/api/domains/orders/sales-orders.client.ts`, `apps/admin-web/src/lib/services/orders/mutations.ts`, `index.ts` (훅 export)

**Interfaces:**
- Consumes: Task 3 라우트.
- Produces:
  - `refundOfTimeline(timeline: TimelineItem[]): { refundStatus?: string; refundLinkId?: string; refundEstimateAmount?: number; manualReason?: string; awaitingDecision: boolean }` — 지금 규칙 + 닫힘은 `succeeded`·`waived` 의 `completedRefundLinkId`, `awaitingDecision` = 결과 링크가 `metadata.awaitingDecision === true` 이거나 `requested`.
  - `useAdminWaiveRefund()` — `mutationFn({ id, adminNote?, refundLinkId? })`, 무효화는 `useAdminManualRefundComplete` 와 같은 셋, `useAdminWaiveRefund.permission = ['payment.refund.execute'] as const satisfies PermissionRequirement`.

- [ ] **Step 1: 순수함수 테스트(빨강)** `refund-link.utils.spec.ts`:
  - `'waived 로 닫힌 manual_pending 은 결정 대기가 아니고 최신 링크 상태를 보인다'`
  - `'awaitingDecision manual_pending 은 awaitingDecision: true 와 그 링크 id'`
  - `'옛 manual_pending(플래그 없음)은 awaitingDecision: false'`
  - `'최신 requested 는 awaitingDecision: true'`
  - `use-order-rows.spec.ts` 의 기존 환불 기대값은 그대로 통과해야 한다.
  `refund-filter.utils` spec: `'살아 있는 주문의 manual_pending 도 걸린다'`, `'requested 도 걸린다'`, `'succeeded·waived·none 은 안 걸린다'` — 함수는 `orderStatus` 조건을 떼고 `refundStatus ∈ {failed, manual_pending, requested}`.
- [ ] **Step 2: 구현** — `use-order-rows` 는 `refundOfTimeline` 를 부르고 행에 `refundAwaitingDecision` 을 싣는다. 표:
  - `REFUND_STATUS_CONFIG` 에 `requested: { label: '환불 요청됨', className: 'bg-blue-100 text-blue-700' }`, `waived: { label: '환불 안 함', className: 'bg-gray-100 text-gray-500' }`.
  - `refundAwaitingDecision` 인 첫 행에만: 주문이 `cancelled` 이고 `walletIntentId` 가 있으면 `RetryRefundButton`(라벨 «환불 실행»), 그리고 «환불 안 함» 버튼(`canRun(useAdminWaiveRefund)` 일 때, `refundLinkId` 를 넘긴다). `requested` 행에도 «환불 실행». 옛 `manual_pending` 행은 지금 그대로(«수동 환불 완료»만).
  - 취소 결과 패널 전체취소 `manual_pending` 문구: 제목 `'주문 취소 완료 · 환불 결정 필요'`, 본문 `'주문내역에서 환불 실행 또는 환불 안 함을 고르세요.'`(ui-minimal-text — 한 문장).
  - 필터 문구: 체크박스 `'환불 결정 전·실패만'`, 표 머리 `'환불 결정 전·실패 주문만 표시 중'`.
- [ ] **Step 3: 확인** — `npm run test:admin-web` 실패 0(`mutation-guard.gate.spec.ts`·`screen-access.gate.spec.ts` 포함), `(cd apps/admin-web && npx tsc --noEmit)` 0 — CI 는 admin-web tsc 를 안 돌리니 꼭 직접.
- [ ] **Step 4: 커밋** `주문내역 환불 결정 — 환불 실행·환불 안 함, 필터는 «환불 결정 전·실패» (K7 PR4)`

---

## 배포

- **Core + admin-web, 마이그 없음.** 순서: Core 먼저(새 라우트·필터 의미) → admin-web. admin-web 이 먼저 뜨면 «환불 안 함»이 404 지만 그 버튼은 `awaitingDecision` 링크에만 뜨고 그 링크는 새 Core 만 만든다 — 실제로는 안 보인다.
- 배포 전 G1(`scripts/ops/k7-pr4-predeploy-check.js`) ①·②·③ 를 사람(사용자)이 돌린다. ① 이 크면 그 주문들은 옛 부분취소의 미결 환불이다 — 목록에 뜨는 게 맞지만, 처리 방침을 먼저 정한다.
- 롤백 안전: 새 링크 상태(`requested`·`waived`)는 3pl 주문과 «환불 안 함» 결정에서만 생긴다. 옛 Core 는 `waived` 를 모르는 `pending` 으로 읽는다(스토어프론트) — ③ 에서 `waived` 가 0 이면 롤백 무해.
