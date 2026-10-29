# K8 PR 11b — 교환 화면(스토어프론트 교환 폼 · CS 교환 표시·[교환품 보내기] · 고객 actions `exchange`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** PR 11 이 연 교환 커널을 사람이 쓸 수 있게 한다 — 고객은 주문에서 [교환 신청]으로 판매자 잘못 사유 교환을 접수하고 진행을 보며, CS 는 반품 목록에서 교환을 구별해 [교환품 보내기]를 누르고, 인쇄(디자인) 상품은 교환 자격에서 빠진다.

**Architecture:** 새 라우트·마이그·이벤트 계약 없이 기존 칸을 넓힌다. ① core 반품 자격 응답의 줄마다 `exchangeable`(인쇄 줄이면 false)을 싣고, Medusa 가 그 값으로 교환 접수를 거절하고 `returnable` 응답에 실어 화면이 미리 막는다. ② core 고객 actions 가 교환 가능한 배송완료 소포가 있으면 `exchange` 를 다시 낸다. ③ 화면 셋(스토어프론트 폼·주문 상세 칸, admin-web CS 목록·시트·접수 대화상자, 진행 판정 라벨)이 `kind` 를 읽는다.

**Tech Stack:** NestJS · Drizzle · Medusa 2.13.4 · Next.js(admin-web, 스토어프론트) · next-intl(ko/en/ja) · TanStack Query · jest / vitest.

**Spec:** `docs/superpowers/specs/2026-10-26-k8-returns-on-medusa-design.md` §4.9 «PR 11 설계» E12(화면은 PR 11b)와 «PR 11 에서 확정한 결과» 알려진 잔여 ②·④, §8 표의 11b 행. PR 11 계획 `docs/superpowers/plans/2026-10-29-k8-pr11-exchange-reshipment.md` 의 N 번호(N14 CS 문 상태표, N17 자격 칸)를 그대로 쓴다.

## 이전 PR 본문에서 넘어온 숙제 (#1146~#1176)

| 출처 | 숙제 | 이 계획 |
| --- | --- | --- |
| #1176 Merge Danger·설계 잔여 ② | 인쇄(디자인) 상품 교환은 교환 줄이 `almond_design_id` 를 복사하지 않아 인쇄 없이 나간다 — «PR 11b 자격에서 막는다» | Task 1·2 (N1~N3) |
| #1176 잔여·설계 잔여 ④ | 정산 미리보기·스토어 반품 칸이 교환을 모른다 | Task 2 (N5·N6) |
| #1176 동작 변경 | 거절 코드 `exchange_requires_seller_fault`·`exchange_released` 문구는 생겼지만 부를 화면이 없다 | Task 3·4 |
| #1174 N9 · PR 11 계획 머리말 | core 가 `exchange` 액션을 다시 켠다, 스토어프론트 교환 버튼 코드는 그대로 둠 | Task 1 (N4) |
| #1174 동작 변경 | `/mypage/exchange?type=exchange` 는 «고객센터로» 안내, 메뉴 «반품 관리» | Task 3 (N10)·Task 4 (N16) |
| #1174 알려진 잔여 | 스토어프론트 죽은 `exchange-order-card`·`return-order-card` | Task 3 (지운다) |
| #1162 N9 | Medusa 고객 라우트는 `getAuthHeaders()`(`_medusa_jwt`) + `withAuth: false` | Task 3 — 새 호출 없음, 기존 `requestReturn` 에 칸만 더한다 |
| #1162 N5·N6 · #1159 접수 충돌 교훈 | 결과 모름은 본문 잠금 + 같은 `request_id`, `request_id_conflict` 는 끝 상태 | Task 3·4 — 교환도 같은 상태 기계(종류는 잠근 본문에 들어간다) |
| #1176 운영 | 배포 중 CS 교환 접수 금지(옛 core 가 `kind` 를 버린다) | 이 PR 은 PR 11 이 라이브가 된 «뒤», 또는 같은 배치에서 PR 11 과 함께 — 배포 절 |

넘기지 않은 것(범위 밖, PR 본문 «알려진 잔여»로): 덜 도착한 교환의 문(#1176 잔여 ①), 외부 환불이 있는 주문의 교환 `stalled`(M5), 교환 상자 Medusa `coreShipmentAttempts` 미기록, 창고 스테이션의 교환 표시(N15), Q1(선환불 뒤 끝내 미도착).

## 결정 (이 계획에서 정한 것)

| # | 결정 |
| --- | --- |
| N1 | **인쇄 판정의 정본은 core 다** — 교환 상자를 내보내는 쪽이고 고객 actions 와 같은 값을 봐야 한다. `ReturnEligibilityLine.exchangeable: boolean` = 그 판매주문 줄의 `almond_design_id IS NULL`. 반품 가능 수량(`deliveredUnits`)은 그대로 — 인쇄 상품 «반품»은 지금처럼 된다 |
| N2 | Medusa 자격 파서는 `exchangeable` 이 없으면 **false**(옛 core = 교환 안 됨, 반품은 영향 없음). 불리언이 아니면 `CoreEligibilityUnavailable` |
| N3 | Medusa `planReturnRequest`: `kind 'exchange'` 이고 고른 품목의 core 줄이 `exchangeable: false` 면 `ReturnRequestRejected('exchange_item_unsupported')`. 자리는 품목별 `item_not_in_order` 판정 바로 뒤(수량·기한보다 먼저). `describeReturnable` 줄에 `exchangeable`(core 줄이 없거나 취소 주문이면 false), `returnable` GET 응답 품목에 `exchangeable` |
| N4 | core 고객 actions: 배송완료 분기(`already_shipped`)에서 `claimable > 0` 인 소포 중 **인쇄 줄이 아닌** 소포가 하나라도 있으면 `exchange` 를 낸다(`return` 판정 바로 뒤). `StoreOrderAction` 에 `'exchange'`. 판정은 순수 함수 `hasExchangeableParcel(parcels, printLineIds): boolean`(`return-eligibility.ts`) |
| N5 | Medusa 고객 반품 목록(`describeStoreReturns`): 항목에 `kind: 'return' \| 'exchange'`, 단계에 `exchanged`(정산 기록 `stage 'exchanged'`). 단계 판정 순서: canceled → refunded → **exchanged** → processing → requested. 교환의 `can_cancel` 은 지금 규칙 그대로(core 열림은 취소 POST 가 `exchange_released` 로 거절한다 — N2 of PR 8 과 같은 이유로 core 를 묻지 않는다) |
| N6 | 정산 미리보기가 쓰는 `assertPrepayableReturn` 에도 교환 판정(`exchange_unsupported`)을 넣는다 — 지금은 선환불 `run` 이 `assertOurLiveReturn` 바로 뒤에서만 거절한다(`prepay-order-return.ts:117`, 그 자리는 그대로). 교환 미리보기는 400 `return_prepay_rejected` |
| N7 | core 정산 다시 시도(`restart`)는 교환에 `kind 'manual'`(계좌 송금)·`alreadyRefundedAmount`·`dropHoldDeduction` 을 `BadRequestError('교환은 …')` 로 거절한다. 일반 다시 시도는 받는다(대체 줄 일시 실패 → `refund_pending` 에서 다시 보낼 길) |
| N8 | 확인 필요: 교환에는 `refund_overdue` 를 내지 않고 새 `exchange_overdue` 를 낸다 — 도착했고 `exchange_released_at` 가 없고 끝나지 않았고 `refundDueAt(arrivedAt)` 을 지났다. 기한 계산·`refundDueAt` 칸·정렬은 그대로(같은 3평일) |
| N9 | core 목록 행 `CustomerReturnListItem.kind`. 진행 판정 상태는 `'<kind>:<status>'`(`return:held` · `exchange:held`) — 단계 키 `return_exchange` 그대로(PR 10 N6) |
| N10 | 스토어프론트 `/mypage/exchange?type=exchange` = 교환 폼. 반품 폼과 **한 컴포넌트**(`ReturnRequestClient` 의 `mode: 'return' \| 'exchange'`) — 사유는 부담 주체 `seller` 넷만, 택배비 줄은 «교환 택배비는 저희가 부담해요» 고정, 줄 막힘에 `not_exchangeable`(순서: `nothing_left` → `not_exchangeable` → `window_closed`), 본문에 `kind: 'exchange'`(반품이면 칸 없음). `ExchangeUnavailable` 과 그 번역 키는 지운다 |
| N11 | 고객 진입은 주문 단위 [교환 신청] 버튼 하나(이미 있는 `canExchange` 코드). 상품 줄별 «교환 신청» 링크는 만들지 않는다 |
| N12 | 주문 상세 «반품» 칸은 «반품·교환» 칸 하나 — 항목마다 종류 표지, 교환 단계 문구는 `exchangeStage.<stage>` 키 |
| N13 | admin-web 버튼: 교환이면 `closeMissing`·`settleHeld`·`prepay`·`retryPrepayment`·`manualPrepayment`·`manualSettlement` 를 내지 않고, `retrySettlement` 는 `needs` 없이만. 새 `releaseExchange` — `kind 'exchange'` ∧ (`exchangeReleasedAt` 없음 ∧ 상태 `expected`·`arrived`·`held`) 이면 «교환품 보내기», (`exchangeReleasedAt` 있음 ∧ `held`) 이면 «교환 정산 열기». 열린 교환은 `cancel` 을 내지 않는다(Medusa `exchange_released`) |
| N14 | admin-web 접수 대화상자(주문 목록 [반품 접수])에 «반품 / 교환» 선택. 교환이면 사유에서 `change_of_mind` 를 빼고, `other` 는 부담 주체 `seller` 고정, `exchangeable: false` 줄은 막는다. 대화상자 이름은 «반품·교환 접수» |
| N15 | 창고 스테이션(PR 7b)은 바꾸지 않는다 — 작업자의 도착·검수 일은 반품과 같고, 교환 상자는 검수가 연다 |
| N16 | admin-web 메뉴·페이지 제목 «반품 관리» → «반품·교환 관리», 대시보드 칩 «반품» → «반품·교환»(수는 그대로 — 교환도 `customer_returns` 행) |

## Global Constraints

- 트랜잭션: `this.dbService.run(fn, tx)`, 공개 메서드 `tx?: DbTx` 마지막(ADR-0025). Inventory Query Rules(`db.query.*`·`with`·`any`·`as` 금지).
- 마이그 없음, 이벤트 계약 변경 없음. 새 HTTP 라우트 없음(`route-classification.spec.ts`·`pii-routes.spec.ts` 무변경이어야 한다).
- Medusa 거절 코드 정본은 `ReturnRejectReason` — 새 값 `exchange_item_unsupported` 는 스토어프론트 `RETURN_REJECT_MESSAGE_KEYS`·ko/en/ja 문구·admin-web `RETURN_REJECT_MESSAGES` 와 같은 커밋(`scripts/storefront/medusa-return-parity.spec.ts`).
- 스토어프론트 → Medusa 고객 라우트는 `getAuthHeaders()` + `withAuth: false`(PR 8 N9). 새 서버 액션을 만들지 않는다.
- admin-web 은 컴포넌트 테스트가 없다 — 판정·검증·라벨은 순수 함수 파일에 두고 스펙을 붙인다. 새 뮤테이션 훅은 `.permission` 선언(`mutation-guard.gate.spec.ts`), 버튼은 `run={useX}`. DTO 는 손 미러 — core·Medusa 정의와 칸마다 맞춘다.
- 스토어프론트 번역 키는 ko/en/ja 세 벌 같은 집합(`locale-parity.test.ts` — 기준선 실패 2건 `logoContest.detail.description` 외에 늘면 안 된다).
- 통합 스펙: core 는 `describeIfDb` + scratch DB `--runInBand`, Medusa 는 `scripts/local/run-medusa-integration.sh --testPathPattern '<escape 한 이름>'`(postgres+redis). 스펙 안 `dotenv.config()` 금지.
- 기준선: 루트 `npx jest` 의 admin-web 근태 4건(ICU), `npx tsc --noEmit -p apps/medusa/tsconfig.json` 기존 3건, 스토어프론트 `npx tsc --noEmit` 45건·vitest 2건, core 통합 `expected-arrivals-parity`·`unified-reservation`·`cancellation-plan` «인쇄 줄»(불안정)·`waybill.manager` ERROR-04/05·`shipment-planning` tombstone.

## Review Focus

1. **인쇄 줄과 일반 줄이 섞인 배송완료 주문** → 고객에게 [교환 신청]이 보이고, 폼에서 인쇄 줄은 «교환할 수 없는 상품이에요»로 막히며, 막힘을 우회해 보내도 Medusa 가 `exchange_item_unsupported` 400. 인쇄 줄만 있는 주문은 버튼이 없다. → Task 1(actions), Task 2(거절), Task 3(막힘).
2. **롤링 중 옛 core 가 `exchangeable` 없이 답한다** → Medusa 는 false 로 읽어 교환만 막고 반품은 그대로 통과. → Task 2(파서).
3. **선발송한 교환이 검수 보류로 멈췄다**(`exchangeReleasedAt` 있음 ∧ `held`) → CS 시트에 «교환 정산 열기»만 있고 «도착 전 취소»·«보류 정산»은 없다. → Task 4.
4. **교환 정산이 끝난 고객 목록** → 단계가 «처리 중»에 영영 머물지 않고 `exchanged` 문구가 보인다. 열린 교환을 고객이 취소하면 `exchange_released` 문구. → Task 2, Task 3.
5. **교환 정산 실패 뒤 CS 가 «계좌 송금»을 누를 수 있다** → 버튼이 없고, API 를 직접 불러도 core 400 — 교환에는 보낼 돈이 없다. → Task 1, Task 4.

---

### Task 1: core — 교환 자격·고객 actions·CS 읽기·정산 다시 시도 가드

**Files:**
- Modify: `apps/core/src/modules/sales-order/internal/return-eligibility.ts`(`ReturnEligibilityLine.exchangeable`, `toReturnEligibilityLines` 입력에 `almondDesignId`, 새 `hasExchangeableParcel`)
- Modify: `apps/core/src/modules/sales-order/internal/return-eligibility.reader.ts`(줄 select 에 `almondDesignId`)
- Modify: `apps/core/src/modules/sales-order/dto/store-order-actions.dto.ts`(`StoreOrderAction` 에 `'exchange'`, Swagger enum)
- Modify: `apps/core/src/modules/sales-order/services/store-sales-orders.service.ts:555-575`(N4 — 그 판매주문의 인쇄 줄 id 를 한 번 읽는다, 주석의 «교환은 … 내지 않는다» 교정)
- Modify: `apps/core/src/modules/sales-order/customer-return/customer-return-attention.ts`(N8 — 입력에 `kind`·`exchangeReleasedAt`)
- Modify: `apps/core/src/modules/sales-order/customer-return/customer-return.reader.ts`(목록 행 `kind`, attention 입력)
- Modify: `apps/core/src/modules/sales-order/customer-return/customer-return-settlement.manager.ts`(`restart` N7 — 레코드 잠금 직후)
- Modify: `apps/core/src/modules/fulfillment/order-progress/order-progress.judge-sql.ts:175`(N9 — `cr.kind::text || ':' || cr.status::text`, 주석)
- Test: `return-eligibility.spec.ts`, `return-eligibility.reader.integration.spec.ts`, `store-sales-orders.service.spec.ts`, `customer-return-attention.spec.ts`, `customer-return.reader.integration.spec.ts`, `customer-return-settlement.manager.integration.spec.ts`, `order-progress.judge.integration.spec.ts`

**Interfaces:**
- Consumes: PR 11 `wmsTables.customerReturns.kind`·`.exchangeReleasedAt`, `salesOrderLines.almondDesignId`, `readParcelClaimEligibility`(`{ salesOrderLineId, claimable, … }`), 픽스처 `claim-facts.fixtures.ts` 의 교환 하나.
- Produces:
  - `ReturnEligibilityLine.exchangeable: boolean`
  - `hasExchangeableParcel(parcels: Array<{ salesOrderLineId: string; claimable: number }>, printLineIds: ReadonlySet<string>): boolean`
  - `StoreOrderAction = 'cancel' | 'track' | 'return' | 'exchange' | 'receipt'`
  - `CustomerReturnAttention` 에 `'exchange_overdue'`, `CustomerReturnAttentionInput.kind: CustomerReturnKind`·`.exchangeReleasedAt: Date | null`
  - `CustomerReturnListItem.kind: CustomerReturnKind`
  - 진행 판정 상태 문자열 `exchange:<customer_return_status>`

- [ ] **Step 1: 실패하는 테스트**
  - `return-eligibility.spec.ts`: `almondDesignId 가 있는 줄 → exchangeable false, deliveredUnits 는 그대로`, `없는 줄 → true`; `hasExchangeableParcel`: `일반 줄 소포 claimable 1 → true`, `인쇄 줄 소포만 claimable → false`, `일반 줄 소포 claimable 0 + 인쇄 줄 claimable 1 → false`, `빈 배열 → false`.
  - 자격 리더 통합: `인쇄 줄 + 일반 줄 주문 → lines 의 exchangeable 이 [false, true]`.
  - `store-sales-orders.service.spec.ts`: `배송완료 + 일반 줄 claimable → availableActions 에 return·exchange`, `배송완료 + 인쇄 줄만 claimable → return 만`, `claimable 0 → 둘 다 없음`, `배송 전 → exchange 없음`.
  - `customer-return-attention.spec.ts`: `교환 도착 4평일 뒤·열림 없음 → ['exchange_overdue'], refund_overdue 없음`, `교환 열림 있음 → []`, `반품은 지금처럼 refund_overdue`, `교환 held → ['held', 'exchange_overdue'] 순서`(held 가 먼저, N5 순서 끝에 붙인다).
  - 리더 통합: `목록 행 kind 가 exchange`, `attention bucket 에 exchange_overdue 교환이 든다`.
  - 정산 통합: `교환 refund_pending + restart manual → 400, settlement 그대로`, `교환 + alreadyRefundedAmount → 400`, `교환 + dropHoldDeduction → 400`, `교환 refund_pending + restart retry → in_progress, 명령 1`.
  - 진행 판정 통합: `열린 교환 → stage return_exchange, state 'exchange:expected'`, `열린 반품 → 'return:expected'`(회귀).
- [ ] **Step 2: FAIL 확인** — `npx jest apps/core/src/modules/sales-order/internal/return-eligibility.spec.ts apps/core/src/modules/sales-order/services/store-sales-orders.service.spec.ts apps/core/src/modules/sales-order/customer-return/customer-return-attention.spec.ts` · `npm run test:core:integration:local -- 'apps/core/src/modules/(sales-order/(internal|customer-return)|fulfillment/order-progress)/.*integration' --runInBand`(scratch DB — 사용자 dev DB 를 쓰지 않는다)
- [ ] **Step 3: 구현** — actions 는 `already_shipped` 분기의 `Promise.all` 에 인쇄 줄 id select(`salesOrderId = so.id ∧ almondDesignId IS NOT NULL`)를 하나 더한다. 판정 SQL 의 상태 목록 두 벌(PR 10 Minor)은 건드리지 않는다.
- [ ] **Step 4: PASS 확인** — 같은 명령, 그다음 `npx jest scripts/security`(컨트롤러 무변경 확인)·`npm run type-check` 0
- [ ] **Step 5: Commit** — `feat(core): 교환 자격 — 인쇄 줄은 교환 불가, 고객 actions exchange, 교환 확인 필요·진행 상태, 교환 계좌 송금 거절 (K8 PR11b)`

### Task 2: Medusa — 교환 자격 거절·returnable `exchangeable`·고객 목록 교환·선환불 판정

**Files:**
- Modify: `apps/medusa/src/workflows/orders/returns/core-return-eligibility.ts`(N2)
- Modify: `apps/medusa/src/workflows/orders/returns/plan-return-request.ts`(`ReturnRejectReason` 에 `exchange_item_unsupported`, `ReturnableLine.exchangeable`, N3)
- Modify: `apps/medusa/src/api/orders-returns/return-request-handlers.ts`(`returnable` 응답 `exchangeable`, 목록 응답 `kind`)
- Modify: `apps/medusa/src/workflows/orders/returns/describe-store-returns.ts`(N5)
- Modify: `apps/medusa/src/workflows/orders/returns/prepay-order-return.ts:234`(N6 — `assertPrepayableReturn` 에 교환 판정)
- Modify: 스토어프론트 `web/almondyoung-storefront/src/domains/order/return-request/return-reasons.ts`(`exchange_item_unsupported: "reject.exchangeItemUnsupported"`)·ko/en/ja `mypage.json` 문구, admin-web `apps/admin-web/src/features/cs/return-exchange/return-request-form.ts` `RETURN_REJECT_MESSAGES`·`lib/types/dto/customer-returns.ts` `ReturnRejectReason` — parity 를 한 커밋에
- Test: `__tests__/core-return-eligibility.unit.spec.ts`, `__tests__/plan-return-request.unit.spec.ts`, `__tests__/describe-store-returns.unit.spec.ts`, `integration-tests/http/return-request.spec.ts`, `integration-tests/http/return-routes.spec.ts`, `integration-tests/http/return-prepay.spec.ts`, `integration-tests/http/fixtures/return-fixture.ts`(`FakeCore` 줄에 `exchangeable`)

**Interfaces:**
- Consumes: Task 1 응답 칸 `lines[].exchangeable`(HTTP — import 하지 않는다).
- Produces:
  - `CoreReturnEligibility.lines[].exchangeable: boolean`
  - `ReturnableLine.exchangeable: boolean`; HTTP `GET …/returnable` → `items[].exchangeable: boolean`
  - `StoreReturnStage = 'requested' | 'processing' | 'refunded' | 'exchanged' | 'canceled'`, `StoreReturnView.kind: 'return' | 'exchange'`; HTTP `GET /store/orders/:id/returns` → `returns[].kind`, `stage` 에 `exchanged`
  - `ReturnRejectReason` 에 `'exchange_item_unsupported'`

- [ ] **Step 1: 실패하는 테스트**
  - 파서: `exchangeable 없는 옛 줄 → false`, `exchangeable 'yes' → CoreEligibilityUnavailable`, `true 그대로`.
  - 판정: `kind exchange + exchangeable false 줄 → exchange_item_unsupported`, `kind return + exchangeable false → 통과`(인쇄 반품은 된다), `kind exchange + 둘 중 한 줄만 false 를 고름 → 거절, 다른 줄만 고름 → 통과`; `describeReturnable`: `core 줄 없음 → exchangeable false`, `취소 주문 → 전 줄 false`.
  - 고객 목록: `정산 기록 stage exchanged → stage exchanged, kind exchange`, `기록 kind 없음 → kind return`, `교환 수령(received)·기록 없음 → processing`, `취소된 교환 → canceled`.
  - 통합 `return-request.spec.ts`: `FakeCore exchangeable false 줄로 교환 접수 → 400 reason exchange_item_unsupported, 반품 0`, `같은 줄 반품 접수 → 200`. `return-routes.spec.ts`: `returnable 품목에 exchangeable`, `교환 정산 뒤 고객 목록 → kind exchange·stage exchanged·can_cancel false`. `return-prepay.spec.ts`: `교환 반품 settlement-preview → 400 return_prepay_rejected(reason exchange_unsupported)`.
- [ ] **Step 2: FAIL 확인** — `(cd apps/medusa && npx jest src/workflows/orders/returns/__tests__)` · `scripts/local/run-medusa-integration.sh --testPathPattern 'http/return-(request|routes|prepay)\.spec'`
- [ ] **Step 3: 구현** — 판정 자리는 N3. 고객 목록의 `exchanged` 판정은 `readReturnSettlementRecord(r.metadata)?.stage === 'exchanged'`.
- [ ] **Step 4: PASS 확인** — 같은 명령 + `npx tsc --noEmit -p apps/medusa/tsconfig.json`(기존 3건만) + `npx jest scripts/storefront/medusa-return-parity.spec.ts`
- [ ] **Step 5: Commit** — `feat(medusa): 인쇄 상품 교환 거절·returnable exchangeable·고객 목록 교환 단계·교환 미리보기 거절 (K8 PR11b)`

### Task 3: 스토어프론트 — 교환 폼·주문 상세 «반품·교환» 칸

**Files:**
- Modify: `web/almondyoung-storefront/src/app/[countryCode]/(mypage)/mypage/exchange/page.tsx`(N10 — `renderReturn(orderId, itemId)` → `renderRequest(orderId, itemId, mode)`)
- Modify: `web/almondyoung-storefront/src/domains/order/return-request/return-request-form.ts`(`ReturnFormLine.exchangeable`·막힘 `not_exchangeable`, `buildReturnFormLines(items, returnable, now, mode)`, `reasonsFor(mode)`, `feeNotice(reason, mode)`)
- Modify: `web/almondyoung-storefront/src/domains/order/return-request/return-request-client.tsx`(`mode` prop — 제목·사유 칩·택배비 줄·완료 문구·본문 `kind`)
- Modify: `web/almondyoung-storefront/src/lib/types/{dto,ui}/returns.ts`·`src/lib/api/medusa/return-outcome.ts`(`exchangeable`, `kind`, 단계 `exchanged`, `toReturnRequestBody` 가 교환이면 `kind: "exchange"`)
- Modify: `web/almondyoung-storefront/src/domains/order/details/order-returns-view.ts`·`components/order-returns-section.tsx`(N12 — `returnStageKey(stage, kind)`, 종류 표지)
- Modify: `src/i18n/messages/{ko,en,ja}/mypage.json`(`order.returnRequest` 교환 문구, `reject.exchangeItemUnsupported` 는 Task 2, `order.returns.exchangeStage.*`·종류 표지, `exchangeUnavailable` 삭제)
- Delete: `src/domains/order/exchange/exchange-unavailable.tsx`, `exchange-order-card.tsx`, `return-order-card.tsx`(삭제 전 `grep -rn "exchange-order-card\|return-order-card\|ExchangeUnavailable" src` 로 호출자 0 확인 — 남은 호출자가 있으면 그 파일은 남기고 멈추지 않는다)
- Test: `return-request-form.test.ts`, `order-returns-view.test.ts`, `src/lib/api/medusa/returns.test.ts`

**Interfaces:**
- Consumes: Task 2 `returnable` `exchangeable`, 목록 `kind`·`exchanged`, 거절 코드 셋(`exchange_requires_seller_fault`·`exchange_released`·`exchange_item_unsupported`).
- Produces: `ReturnFormMode = "return" | "exchange"`, `ReturnRequestInput.kind?: "exchange"`, `CustomerReturn.kind: "return" | "exchange"`, `CustomerReturnStage` 에 `"exchanged"`.

- [ ] **Step 1: 실패하는 테스트**
  - 폼: `교환 모드 + exchangeable false 줄 → blocked not_exchangeable`, `교환 모드 + 남은 수량 0 인 인쇄 줄 → nothing_left`(순서), `반품 모드 + exchangeable false → none`, `교환 모드 + 막힌 줄 itemId 는 미리 고르지 않는다`, `reasonsFor('exchange') = defective·not_as_described·wrong_item·damaged_in_shipping`, `feeNotice(어느 사유, 'exchange') = seller`.
  - 본문: `toReturnRequestBody({ …, kind: 'exchange' }) 에 kind 'exchange'`, `kind 없으면 본문에 kind 키 없음`(옛 반품 해시 그대로).
  - 상태 기계: `교환 unknown 뒤 잠긴 본문에 kind 'exchange' 가 남는다`.
  - 상세 칸: `returnStageKey('exchanged', 'exchange') = 'exchangeStage.exchanged'`, `returnStageKey('requested', 'return') = 'stage.requested'`, `cancelRejectKey('exchange_released')` 회귀.
  - DTO: `toCustomerReturns` 가 `kind` 없는 응답을 `return` 으로 읽는다.
- [ ] **Step 2: FAIL 확인** — `cd web/almondyoung-storefront && npx vitest run src/domains/order src/lib/api/medusa`
- [ ] **Step 3: 구현** — 문구(ko): 제목 «교환 신청», 전 줄 막힘 «지금 교환할 수 있는 상품이 없어요»(반품의 `empty` 와 짝), 택배비 줄 «교환 택배비는 저희가 부담해요», 막힘 «교환할 수 없는 상품이에요(인쇄 상품은 반품으로 신청해 주세요)», 완료 «교환 신청이 접수됐어요 — 회수한 상품을 확인한 뒤 같은 상품을 다시 보내 드려요», 단계 `exchangeStage`: requested «교환 접수됐어요» · processing «회수한 상품을 확인하고 있어요» · exchanged «교환품을 보내 드려요» · canceled «교환을 취소했어요», 종류 표지 «반품»/«교환». en·ja 는 같은 뜻으로.
- [ ] **Step 4: PASS 확인** — `npx vitest run`(기준선 2건만), `npx tsc --noEmit`(45건 그대로), 루트 `npx jest scripts/storefront`
- [ ] **Step 5: Commit** — `feat(storefront): 교환 신청 폼과 주문 상세 반품·교환 칸 — 인쇄 상품은 막고, 교환 단계를 보인다 (K8 PR11b)`

### Task 4: admin-web — CS 교환 표시·[교환품 보내기]·접수 대화상자 교환·진행 라벨

**Files:**
- Modify: `apps/admin-web/src/lib/types/dto/customer-returns.ts`(`CustomerReturnKind`, `CustomerReturnView.kind`·`.exchangeReleasedAt`, `CustomerReturnListItem.kind`, attention `exchange_overdue`, `OrderReturnable.items[].exchangeable`, `RequestOrderReturnBody.kind?`)
- Modify: `apps/admin-web/src/lib/api/domains/customer-returns/index.ts`(`releaseExchange(id)` → `POST admin/customer-returns/:id/exchange-release`)
- Modify: `apps/admin-web/src/lib/services/customer-returns/mutations.ts`(`useReleaseCustomerExchange`, `.permission = ['order.claim.write']`)
- Modify: `apps/admin-web/src/features/cs/return-exchange/customer-return-labels.ts`(`RETURN_KIND_LABELS`, `EXCHANGE_STATUS_LABELS`, `statusLabel(kind, status)`, attention `exchange_overdue: '교환 기한 지남'`, 버튼 `releaseExchange`)
- Modify: `apps/admin-web/src/features/cs/return-exchange/customer-return-actions.ts`(N13 — `releaseExchange` 의 라벨 선택 `releaseExchangeLabel(view): string`)
- Modify: `apps/admin-web/src/features/cs/return-exchange/return-request-form.ts`(N14 — `ReturnRequestForm.kind`, `reasonOptionsFor(kind)`, 검증)
- Modify: `components/customer-returns-table`(종류 칸)·`customer-return-sheet`(종류·«교환품 출고 지시 <시각>» 줄·버튼 연결)·`customer-return-action-dialog`(교환품 보내기 확인 — 두 번 누르기)·`request-return-dialog`(종류 선택)
- Modify: `apps/admin-web/src/lib/api/domains/orders/order-progress.shape.ts:252-257`(`/^(return|exchange):(.+)$/`)
- Modify: 메뉴·페이지 제목·대시보드 칩 문구(N16 — `grep -rn "반품 관리\|'반품'" apps/admin-web/src --include=*.ts*` 로 자리를 찾는다)
- Test: `customer-return-actions.spec.ts`, `customer-return-labels.spec.ts`, `return-request-form.spec.ts`, `order-progress.shape.spec.ts`, `lib/services/customer-returns/query-keys.spec.ts`(무변경 확인)

**Interfaces:**
- Consumes: Task 1 `kind`·`exchangeReleasedAt`·`exchange_overdue`·`exchange:` 상태, PR 11 라우트 `POST admin/customer-returns/:id/exchange-release`(200 view, 400 반품, 409 상태), Task 2 `exchangeable`·`exchange_item_unsupported`.
- Produces: `CustomerReturnAction.kind` 에 `'releaseExchange'`, `useReleaseCustomerExchange`, `statusLabel(kind, status)`.

- [ ] **Step 1: 실패하는 테스트**
  - 버튼(N13 표의 행마다): `교환 expected·열림 없음 → cancel·releaseExchange('교환품 보내기')·retryPickup, prepay 없음`, `교환 expected·열림 있음 → cancel 없음·releaseExchange 없음`, `교환 arrived·덜 도착 → closeMissing 없음`, `교환 held·열림 없음 → releaseExchange('교환품 보내기'), settleHeld 없음`, `교환 held·열림 있음 → releaseExchange('교환 정산 열기')`, `교환 refund_pending + settlement refused(external_refund_…) → retrySettlement needs 없음, manualSettlement 없음`, `교환 inspected·settled → releaseExchange 없음`, `반품 → releaseExchange 없음`(회귀 — 기존 스펙 전부 그대로 통과).
  - 라벨: `EXCHANGE_STATUS_LABELS` = expected «도착 대기» · arrived «도착» · inspected «정산 중» · held «보류» · refund_pending «정산 실패» · settled «완료» · cancelled «취소»(목록·시트엔 종류 칸이 따로 있어 «교환»을 붙이지 않는다). `statusLabel('exchange', 'settled') = '완료'`, `statusLabel('exchange', 'refund_pending') = '정산 실패'`, `statusLabel('return', 'settled') = '환불 완료'`(회귀), attention·kind 라벨 키 집합이 DTO 유니온과 같다.
  - 접수: `교환 + change_of_mind → '교환은 판매자 잘못 사유만 접수할 수 있습니다'`, `교환 + other → fee_bearer seller 로 본문`, `교환 + exchangeable false 줄 → 오류`, `교환 본문에 kind 'exchange'`, `반품 본문에 kind 키 없음`, `exchange_item_unsupported 거절 문구`.
  - 진행 라벨: `stateLabel('exchange:expected') = '교환 도착 대기'`, `stateLabel('exchange:held') = '교환 보류'`, `stateLabel('return:held') = '반품 환불 보류'`(회귀).
- [ ] **Step 2: FAIL 확인** — `npm run test:admin-web -- features/cs/return-exchange lib/api/domains/orders`
- [ ] **Step 3: 구현** — 성공 토스트 «교환품 출고를 지시했습니다 — 상자는 출고 화면에 나타납니다», 409 는 서버 문구 그대로.
- [ ] **Step 4: PASS 확인** — 같은 명령 + `cd apps/admin-web && npx tsc --noEmit` 0 + `npm run test:admin-web -- lib/auth 'app/api/proxy/medusa'`(mutation-guard·screen-access·medusa-coverage 게이트)
- [ ] **Step 5: Commit** — `feat(admin-web): CS 교환 — 종류 표시, 교환품 보내기, 반품·교환 접수, 교환 진행 라벨 (K8 PR11b)`

### Task 5: 게이트·문서

**Files:**
- Modify: `docs/superpowers/specs/2026-10-26-k8-returns-on-medusa-design.md` §4.9 끝에 «PR 11b 에서 확정한 결과»(계획과 달라진 판정만, N 번호로), §8 표 11b 행은 그대로
- 확인: `git status` 에 임시 파일 없음

- [ ] **Step 1: 전체 게이트** — `npm run type-check` 0 · 루트 `npx jest` 실패 = 근태 4건뿐 · `(cd apps/medusa && npm run test:unit)` · `scripts/local/run-medusa-integration.sh --testPathPattern 'http/return-'`(전체를 한 번에 돌리면 힙 OOM — PR 11 실측) · `npx tsc --noEmit -p apps/medusa/tsconfig.json` 기존 3건 · core 통합 `customer-return`·`internal`·`order-progress` `--runInBand`(기준선만) · `cd apps/admin-web && npx tsc --noEmit` 0 · 스토어프론트 vitest·tsc 기준선
- [ ] **Step 2: 설계 «확정한 결과» 쓰기**
- [ ] **Step 3: Commit** — `docs: K8 PR11b 확정한 결과`

## 배포 (PR 본문에 옮길 것)

- 마이그·이벤트 계약 변경 없음. core·Medusa·admin-web·스토어프론트 한 `sst deploy`. 순서 제약은 없다 — 어느 쪽이 먼저 떠도 교환이 «덜» 열릴 뿐이다(옛 core → Medusa 가 `exchangeable` false 로 교환 거절, 옛 Medusa → 스토어프론트 폼이 `exchangeable` 없음 = 전 줄 막힘).
- 🔴 **PR 11(#1176)이 라이브가 아니면 이 PR 을 따로 먼저 배포하지 않는다** — PR 11 과 같은 배치(`migrate → deploy`)이거나 그 뒤. 그 배치의 «배포 중 CS 교환 접수 금지»와 롤백 금지 셋을 승계한다.
- 개통 전에는 휴면이다 — 셀메이트 시기 배송완료 0 이라 `exchange` 액션이 안 나오고 폼에 들어와도 전 줄 0(D9).
- 배포 뒤 확인: ① 아무 라이브 주문 `GET /store/orders/by-channel-order/:id/actions` 에 `exchange` 없음(배송완료 0) ② `GET /admin/orders/:id/returnable` 품목에 `exchangeable` 칸 ③ admin-web «반품·교환 관리»가 빈 목록으로 열린다 ④ `/mypage/exchange?orderId=<라이브 주문>&type=exchange` → «지금 교환할 수 있는 상품이 없어요».
- ⛔ 화면 스모크(로컬 E2E, 브라우저 로그인은 사람): 배송완료 주문으로 교환 신청 → 주문 상세 «교환 접수됐어요» → CS 시트 «교환품 보내기» → 상자 draft 생성. PR 8 처럼 자동 게이트가 못 보는 이음매(인증 헤더·프록시 경로)가 있다.
