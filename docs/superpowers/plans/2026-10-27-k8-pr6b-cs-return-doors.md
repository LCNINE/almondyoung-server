# K8 PR 6b — CS 의 반품 문: 보류 정산 · 선환불 · 미도착 닫기 · 정산 다시 시도 · 계좌 송금 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** PR 6 의 정상 길이 멈추는 자리마다 CS 가 끝낼 문을 연다. 환불 보류(`held`)는 차감액·메모로 정산하고, 도착 전에 환불을 먼저 낼 수 있고(선환불), 덜 온 반품은 «미도착»으로 닫고 온 것만 정산하며, 영구 거절·멈춘 정산은 같은 요청으로 다시 내거나 계좌 송금으로 바꾼다.

**Architecture:** ① 문은 전부 core 관리자 라우트다 — core 가 반품 기록을 옮기고 같은 트랜잭션에 명령을 싣는다(PR 6 꼴). ② 보류 정산·미도착 닫기·다시 시도는 PR 6 의 `SettleChannelReturn` 에 칸을 더해 같은 Medusa 정산을 탄다. 선환불만 새 명령 `PrepayChannelReturn` 과 새 Medusa 워크플로다. ③ 돈의 장부: 반품 요청이 열린 동안 Medusa 는 반품 품목 값을 «이미 돌려줄 돈»으로 보아 선환불에 크레딧 라인을 붙이지 않는다(Task 1 실측) — 선환불은 수령이 만든 차액과 산술로 상계되고, 정산은 P 만큼 덜 낸다. 상계 크레딧 라인은 크레딧이 붙은 환불(반품 전 외부 환불)의 몫에만 넣는다(N6). CS 차감은 택배비처럼 order edit 의 배송 방법(«반품 차감»)으로 남긴다. ④ 성공은 재수집 관측이, 실패는 channel-adapter 가 사실로 낸다(PR 6 과 같다).

**Tech Stack:** NestJS + Drizzle(core·channel-adapter), `@app/events` 아웃박스·명령 스트림, `@app/cron-once`, zod 계약(`packages/event-contracts`), Medusa 2.13.4(`refundPaymentWorkflow`·`createOrderCreditLinesWorkflow`·반품 수령 워크플로·order edit), Jest(unit·`describeIfDb` 통합), Medusa HTTP 통합(`@medusajs/test-utils`).

**Spec:** `docs/superpowers/specs/2026-10-26-k8-returns-on-medusa-design.md` — D10, §4.3(사다리·«PR 6 에서 확정한 결과» N7·N9·N17), §4.4(«CS 의 두 문», «PR 6 에서 확정한 결과» N13·(a-2)·(c)·(e)), §8 PR 6b. PR 6 계획 `docs/superpowers/plans/2026-10-27-k8-pr6-return-arrival-inspection-settlement.md` 의 N1~N17 을 깨지 않는다.

## PR 1~6 본문이 넘긴 것 (이 PR 이 닫는다)

| 출처 | 넘긴 것 | 여기서 |
| --- | --- | --- |
| PR 6 #1157 | 검수의 «환불 보류»는 `held` 에서 멈춘다 | 보류 정산 — Task 7 |
| PR 6 #1157 N7 | 부분 도착은 검수를 거절한다 | 미도착 닫기 — Task 7 |
| PR 6 #1157 N9 | 12번 내고 `stalled` 면 사람 일 | 다시 시도 — Task 8 |
| PR 6 #1157 (c) | 택배비 청구 전(`received`)에 멈춘 정산은 사람이 풀어야 한다(그동안 그 주문 부분취소·다른 반품 500) | 다시 시도가 같은 requestId 로 이어 간다 — Task 8 |
| PR 6 #1157 N16 | 외부 환불 미해결이면 정산 거절, «상계는 PR 6b» | 다시 시도의 «이미 환불한 금액» — Task 5·8 |
| PR 6 #1157 (e) | 모르는 400 은 일시로 재시도(사람 길이 없어서) | 그대로 둔다 — 이제 `stalled` 뒤 다시 시도가 사람 길이다(N12) |
| PR 6 #1157 (a-2) | A×2+E «반품 먼저·취소 나중»이면 3,000 덜 뺀다 | 고치지 않는다(N13) |
| PR 3 #1149 | 반품 취소는 도착 전만 | 선환불한 반품도 취소 거절 — Task 4 |

## 코드에서 확인한 것 (develop `1ec597794`)

- **Medusa 의 차액.** `pending_difference = current_order_total − transaction_total`(`@medusajs/order/dist/utils/calculate-order-change.js:82`). 주문 변경 없는 환불은 차액을 양수로 민다. 그러나 `refundPaymentWorkflow` 는 환불이 «돌려줄 차액»을 넘으면 넘는 만큼 **크레딧 라인을 자동으로 붙인다**(`core-flows/dist/payment/workflows/refund-payment.js:91-124`) — wallet 직접 환불 투영(`projectWalletRefund`)이 «+X 금액 조정»으로 남는 이유가 이것이다. 부분취소는 그 +X 를 «−X 상계 크레딧 라인»으로 품목 값으로 다시 분류한다(`partial-cancel-order.ts` `offsetExternalRefund`, reference `'partial-cancel'`). Medusa 는 크레딧 라인 합이 0 이하면 0 으로 자른다(같은 함수 주석).
- **🔴 Task 1 실측(반품 요청이 열린 주문).** `refundPaymentWorkflow` 가 읽는 주문 summary(저장된 값)는 확정된 반품 요청의 품목 값을 «돌려줄 돈»으로 센다(30,000×2 반품 요청 → `pending_difference −60,000`). 같은 주문을 `loadOrderView` 로 읽으면 0 이다 — 두 읽기가 다르다. 그래서 24,000 선환불은 크레딧 라인 0 이고 `loadOrderView` 차액은 +24,000, NOT_PAID 0. 수령 2 확정 → −36,000. 반품 요청 없는 주문의 같은 환불은 크레딧 +24,000(기존 스펙 `partial-cancel.spec.ts:91`·`channel-cancel-settlement.spec.ts:59` 와 같다). 수령 뒤 order edit 에 방법 둘(3,000·2,000) → −55,000, NOT_PAID 0. 할인 줄 품목 값 추정 == 수령 차액. 부분 수령 → `partially_received`, `return_requested_quantity` 1.
- **반품 수령의 돈.** `RECEIVE_RETURN_ITEM`·`RECEIVE_DAMAGED_RETURN_ITEM` 이 `unit_price × qty` 를 빼고, 할인은 수량 비례(PR 6 Task 1 실측: 수령 1·폐기 1 → −60,000). 부분취소의 `itemRefundEstimate`(`plan-partial-cancel.ts:52`)가 같은 몫을 `unitPrice × q − cancelledAdjustmentShare(adjustments, quantity, quantity − q)` 로 미리 센다. `OrderView.lines` 는 `adjustments` 를 싣는다(`load-order-view.ts:63`).
- **부분 수령.** `RECEIVE_RETURN_ITEM` 은 `return_requested_quantity` 를 받은 만큼만 줄인다 — 나머지는 요청 상태로 남고 반품은 `partially_received` 다. 남은 품목만 취소하는 지원 워크플로는 없다: `cancelReturnWorkflow` 는 받은 품목이 하나라도 있으면 던진다(`core-flows/dist/order/workflows/return/cancel-return.js:43`), `CANCEL_RETURN_ITEM` 액션은 그 워크플로 안에서만 쓰인다.
- **PR 6 정산(`settle-order-return.ts`).** 기록 단계 `received → charged → refunded`, 요청 해시 = `hashReturnSettlement(requestId, items)`, `refundMode` 는 해시 밖(«자동 거절 뒤 같은 요청을 수동으로 다시 보낸다»). `assertItemsMatch` 가 품목 집합·수량 합의 일치를 요구한다. `assertNoExternalRefund` 는 `unresolvedExternalRefund(refunds, partialCancelRecords)` 만 본다 — 반품 기록의 상계를 모른다. 택배비는 `addSettlementCharge` 한 방법, 상한은 `owed`.
- **core 정산 칸(`customer_returns.settlement`).** `CustomerReturnSettlement = { state, refundMode, startedAt, lastIssuedAt, attempts, lastFailure }`. 재발행 크론의 멱등키는 `customer-return-settle:<id>:issue:<attempts+1>` 이고 12번에서 `stalled` — **`attempts` 를 0 으로 되돌리면 다음 재발행 키가 옛 키와 겹쳐 아웃박스가 조용히 버린다.**
- **취소 정산의 사람 문(본보기).** `ChannelCancelRequestManager.restartSettlement(kind 'retry' | 'manual', alreadyRefundedAmount)`(`channel-cancel-request.manager.ts:283`) — 진행 중이면 Conflict, 수동 중 다시 수동이면 Conflict, «이미 환불한 금액»은 마지막 실패가 외부 환불 거절일 때만, 저장된 명령을 고쳐 재발행도 같은 값을 내게 한다. 라우트 `POST sales-orders/:id/cancel-request/:requestId/retry|manual-refund`, 권한 `payment.refund.execute`.
- **K6.** 반품 예정 기록 줄 수량을 읽는 곳은 `claim-quantities.sql.ts` 세 곳뿐이다(`:105`·`:108` SKU 합, `:165` `returnHeld`). `SalesOrderReturned` 의 줄 수량은 `completedSetUnits(… returnConsumed)` 로 K6 에서 따라온다.
- **검수 → 명령.** `toSettleItems` 는 `rejectedQty` 만 폐기로 센다 — 보류 수량은 원장에선 DEFECTIVE 인데 Medusa 엔 «수령»으로 가 Medusa 재고를 올린다.
- **권한 키.** `order.claim.write`(반품·교환 처리), `payment.refund.execute`(환불 실행·수동 송금 확정)가 카탈로그에 있다. 새 키는 없다.

## 이름 붙은 결정

- **N1. 문은 core 라우트, 돈은 Medusa.** CS 는 Medusa 를 직접 부르지 않는다 — core 가 기록과 명령을 한 트랜잭션에 묶어야 크론 재발행·관측이 한 기록 위에 선다. 예외는 읽기 하나(N9 미리보기).
- **N2. 보류 정산 = `held → inspected` + `SettleChannelReturn.holdDeduction { amount, memo }`.** 차감액 0 은 «차감 없이 정산»이다(칸을 싣지 않는다). Medusa 는 차감을 택배비와 **같은 order edit** 에 «반품 차감» 배송 방법(`custom_amount`)으로 남긴다 — 이름을 `SETTLEMENT_CHARGE_NAMES` 에 더해 부분취소가 원래 방법으로 읽지 않는다. 그룹 요금(`groupFees`)에는 넣지 않는다.
- **N3. 차감은 넘치면 깎는다, 거절하지 않는다.** 차감액은 수령 «뒤» `owed` 를 알아야 판정되는데, 수령 뒤 거절은 반품을 `received` 에 가둔다. 채우는 순서: 선환불·외부 상계 → 택배비(① 반품비 ② 깨짐 ③ 왕복) → 보류 차감. 기록은 요청액과 적용액을 둘 다 남기고 core 결과에 적용액이 간다.
- **N4. 선환불은 새 명령 `PrepayChannelReturn` 과 새 워크플로 `prepayOrderReturn`.** 설계 §4.4 는 «같은 정산 라우트에 모드»라 했으나, 선환불은 수령·택배비가 없고 반품 하나에 정산과 따로 한 번 있어 진행 기록·실패 사실이 갈린다 — 라우트·기록을 나눈다(설계 §6 «이름은 빌더 몫»). 요청 키는 정산과 같은 core `customer_returns.id`, 환불 메모는 `return-prepay:<id>`(정산은 `return-settle:<id>`).
- **N5. 선환불 금액.** Medusa 가 계산한다: 품목 값 `V = floor(Σ unitPrice × q − cancelledAdjustmentShare)`(반품 품목 전부), 택배비 예상 `F = planReturnFees(…, returnedNow = 반품 수량, chargeCap = V).total`. 기본 = `V − F`, CS 가 금액을 주면 `1 ≤ amount ≤ V`(넘으면 `prepay_exceeds_item_value`). 상한이 `V` 라 정산의 `owed ≥ P` 가 늘 성립한다 — 그래야 상계 뒤 차액이 양수가 되지 않는다(Task 1 이 `V == owed` 를 실측한다).
- **N6. 선환불한 금액은 Medusa 환불 행이 정본이고, 상계 크레딧 라인은 «크레딧이 붙은 몫»에만.** 정산은 `return-prepay:<id>` 메모 환불의 합 `P` 와 CS 가 적은 외부 환불 `E` 만큼 덜 낸다. 크레딧 라인이 붙었는지는 환불 때 반품 요청이 열려 있었는지에 달려 있어(Task 1) 환불 행만 보고는 모른다 — 그래서 차액으로 잰다: `B` = 수령 «전» `loadOrderView` 차액(장부 맞추기 뒤). 크레딧 없는 몫은 `B` 에 양수로 들어 있으므로 상계 크레딧 라인 = `clamp(P + E − B, 0, P + E)`(reference `'return-offset'`, reference_id = requestId). 이 식은 그 주문의 다른 돈 일이 끝나 있을 때만 맞다 — `P + E > 0` 인데 `refunded` 가 아닌 부분취소 기록·다른 반품 정산 기록이 있으면 일반 Error(500, 기다림). 응답을 잃은 선환불도 장부 맞추기가 메모로 넣으므로 `P` 에 든다.
- **N7. 선환불과 정산은 Medusa 주문 잠금이 줄 세운다.** 정산이 먼저 돌면 뒤에 온 선환불은 `return_already_settled`(영구) — core 는 선환불을 `superseded` 로 둔다. 선환불이 먼저면 정산이 뺀다. 그래서 core 는 선환불이 진행 중이어도 검수를 막지 않는다. 선환불은 반품이 `requested`(Medusa)·정산 기록 없음일 때만 열린다.
- **N8. 미도착 닫기 = 줄의 `missing_qty`.** core 가 줄마다 «온전히 도착한 벌» `min over SKU 항목 floor(도착 / qty_per_unit)` 을 세고 `missing_qty = 줄 수량 − 그 값` 을 쓴다. 정산 명령의 줄 수량은 `quantity − missing_qty`, 0 인 줄은 싣지 않고 `closesMissing: true` 를 싣는다. 검수는 «기대 = 도착»이 아니라 «합 = 도착»만 본다(일부만 온 세트의 구성품도 원장에서 정리돼야 한다). 닫은 뒤 도착은 Conflict. K6 의 세 곳이 `quantity − missing_qty` 를 센다 — 닫힌 수량은 다시 청구할 수 있다.
  - Medusa 는 `closesMissing` 일 때만 «품목 일부·수량 미달»을 받는다(없으면 PR 6 처럼 `items_mismatch`). **남은 반품 품목은 취소하지 않는다**(설계 §4.3 교정) — 지원 워크플로가 없다(위 «부분 수령»). 남은 `return_requested_quantity` 는 그 줄의 재반품을 막을 뿐이다.
  - 거절: 도착한 것이 없으면(`expected`) «반품 취소로 닫으세요», 온전한 벌이 하나도 없으면 같은 문구(N15 잔여), 다 왔으면 «검수하세요».
- **N9. 미리보기 하나는 Medusa 에서 읽는다.** `GET /admin/orders/:id/returns/:return_id/settlement-preview` → `{ itemValue, feeEstimate: ReturnSettlementDeduction, defaultPrepayAmount, prepaidAmount }`. 선환불 기본값과 보류 차감의 여지를 화면(PR 7)이 보여 줄 숫자다 — core 는 부르지 않는다. 쓰기 없음.
- **N10. 다시 시도·계좌 송금은 취소 정산의 꼴을 그대로.** 대상 둘(정산·선환불)마다 라우트 둘. `refused`·`stalled` 만 받는다(`in_progress` → Conflict «진행 중», `done`·`superseded` → Conflict). 계좌 송금은 `refundMode: 'manual'`(이미 수동이면 Conflict). «이미 환불한 금액»은 정산 다시 시도에만, 마지막 실패 코드가 `return_settle_rejected:external_refund_unresolved` 일 때만. 저장된 명령 칸(`settlement.command`)을 고쳐 크론 재발행도 같은 값을 낸다.
- **N11. 재발행 키는 `issues`, 상한은 `attempts`.** 정산·선환불 진행 칸에 `issues`(지금까지 낸 수, 멱등키 `…:issue:<issues>`)를 더하고, `attempts`(마지막 재시작 뒤 낸 수, 12 상한)는 재시작 때 1 로. `issues` 가 없는 행은 `attempts` 로 읽는다(라이브 0행이지만 읽기를 관대하게).
- **N12. 모르는 400 은 계속 일시다**(PR 6 (e)). 이제 12번 뒤 `stalled` → 다시 시도가 사람 길이다. 부분취소처럼 영구로 바꾸면 사람이 볼 기회 없이 `refused` 가 된다 — 지금 꼴이 더 안전하다.
- **N13. A×2+E 잔여는 고치지 않는다.** «반품 먼저·취소 나중»이 3,000 을 덜 빼는 것은 고객 유리이고, 고치려면 부분취소 환불 하한(PR 6 (a-1))을 순서 무관하게 다시 짜야 한다 — 이 PR 의 문들과 독립이고 라이브 반품 0건이다. 설계 (a-2) 에 «6b 에서 다시 봤고 그대로»라고 적는다.
- **N14. 보류 수량은 Medusa 에 폐기로 알린다.** `toSettleItems` 가 `rejectedQty + heldQty` 를 센다 — 원장(DEFECTIVE)과 Medusa 재고가 같은 쪽을 본다. 돈은 바뀌지 않는다(수령·폐기 금액이 같다).
- **N15. 선환불한 반품은 미도착으로 닫지도, 취소하지도 못한다.** 닫으면 `owed < P` 가 되어 상계 뒤 차액이 양수(NOT_PAID 결제 컬렉션)가 되고, 취소하면 환불이 반품 없이 남는다. 끝내 안 오면 반품은 `expected`/`arrived` 로 목록에 남는다 — **사용자 확인 필요(아래 «열린 질문»)**.

## 열린 질문 (계획 검토 때 답한다)

- **Q1. 선환불했는데 물건이 끝내 안 오면?** 이 계획(N15)은 «닫지 못하고 목록에 남긴다»다. 대안은 «손실로 닫기» — 안 온 수량을 Medusa 에 폐기로 알려 장부를 닫는다(고객이 돈과 물건을 다 가진 채 기록 종료). 대안을 고르면 Task 7 에 문 하나가 늘고 Task 5 의 `closesMissing` 판정이 갈린다.

## Global Constraints

- 사는 곳: `packages/event-contracts`, `apps/medusa`, `apps/channel-adapter`, `apps/core`(칼럼 셋 + 마이그 하나), 문서(설계 §4.3·§4.4·§8, `apps/channel-adapter/CLAUDE.md`).
- 마이그: `npm run db:generate:core -- --name add-customer-return-cs-doors`. **expand, `migrate → deploy`.** 새 enum 값 없음.
- core 레이어: 컨트롤러·소비자·크론 → `CustomerReturnService`(위임만) → manager. `dbService.run(fn, tx)`, 공개 메서드 마지막 인자 `tx?: DbTx`, `@InjectTypedDb<typeof wmsSchema>()`, `db.query.*`·`any`·`as` 금지, 오류는 `@app/shared` 의 `NotFoundError`·`BadRequestError`·`ConflictError`. 반품 기록 행은 `for update` 로 먼저 잡는다(PR 6 꼴). 상태는 `transitionCustomerReturn` 만 쓴다.
- 라우트(`admin/customer-returns`): 미도착 닫기 `@RequirePermission('order.claim.write')`, 보류 정산·선환불·다시 시도·계좌 송금 `@RequirePermission('payment.refund.execute')`. 응답은 `CustomerReturnView`(개인정보 없음). 메모는 자유 문구 `@IsString() @Matches(/\S/) @MaxLength(500)`.
- 멱등 키(이 계획이 정한다):
  - 정산 명령 `customer-return-settle:<id>:issue:<issues>` (PR 6 형식 그대로, 번호만 `issues`)
  - 선환불 명령 `customer-return-prepay:<id>:issue:<issues>`
  - Medusa 선환불 메모 `return-prepay:<requestId>`, 상계 크레딧 라인 reference `'return-offset'`, reference_id = requestId(N6)
  - 선환불 실패 사실 `return-prepay-failed:<requestId>:<deliveryId>:<code(120자까지)>`, 관측 키 `return:<returnId>:prepaid`
- Medusa 선환불 라우트 응답은 정산 라우트와 같은 모양: 200 / 400 `{ type: 'not_allowed', code: 'return_prepay_rejected', reason, message }` / 400 `{ code: 'wallet_refund_refused:<code>' }` / 502 `{ type: 'refund_pending' }` / 그 밖 500.
- 게이트:
  - `npm run type-check` 0, `npx tsc --noEmit -p apps/medusa/tsconfig.json` 는 기존 3건(`src/admin/lib/sdk.ts`×2, `confirm-purchase.unit.spec.ts`)만 — 루트 게이트는 medusa 를 안 본다.
  - `npx jest packages/event-contracts apps/channel-adapter/src apps/core/src/modules/sales-order scripts/security libs/cron-once` 실패 0(통합은 skip). admin-web 근태 4건(ICU)은 범위 밖.
  - core 통합: scratch DB 에 `DATABASE_URL` 주입, `--runInBand`.
  - `(cd apps/medusa && npm run test:unit)` 실패 0. Medusa 통합: `scripts/local/run-medusa-integration.sh --testPathPattern '<패턴>'`(postgres·redis, 패턴은 `'http/return-prepay\.spec'` 처럼 escape).

## Review Focus

1. **선환불 뒤 정산의 장부가 0 으로 닫힌다.** 30,000×2 변심 전량, 선환불 기본값 → 정산: 환불 합(선환불 + 정산) = 60,000 − 택배비, 마지막 차액 0, 상계 크레딧 라인 0, NOT_PAID 결제 컬렉션 0. 반품 «전»에 외부 환불(크레딧 +E)이 있던 주문은 상계 −E 로 차액 0. CS 가 품목 값 전액을 선환불했으면 정산의 택배비·차감은 0 으로 깎이고 정산 환불 0. — Task 5 통합.
2. **보류 차감이 남은 돈보다 크다.** 차감 100,000 요청 → 적용액 = owed − 택배비, 정산 환불 0, 기록에 요청·적용 둘 다, NOT_PAID 0. — Task 3 단위(채우기 순서) + Task 5 통합.
3. **다시 시도 뒤 크론이 정말 다시 낸다.** `stalled`(attempts 12) → 다시 시도(issues 13) → 5분 뒤 크론이 issue 14 를 싣는다(옛 키와 안 겹친다). — Task 8 통합.
4. **선환불과 검수 명령이 엇갈린다.** 정산이 먼저 Medusa 에 닿으면 선환불은 `return_already_settled` 이고 core 선환불 `superseded`, 환불 1번. 선환불이 먼저면 정산이 그만큼 덜 낸다. — Task 4·5 통합(Medusa) + Task 8(core 상태).
5. **미도착 닫은 뒤 늦은 소포·K6.** 2개 중 1개 도착 → 닫기 → 검수 → 정산 품목 1개(`closesMissing`), 늦게 온 둘째 소포 도착 → Conflict, K6 `claimable` 이 닫힌 1개를 돌려준다. — Task 6·7 통합.

---

### Task 1: 전제 실측 — 선환불·상계·부분 수령의 돈

코드 변경 없이 스펙 하나. **빨가면 멈추고 응답 본문과 함께 보고한다** — N5·N6·N8 이 바뀐다.

**Files:**
- Create: `apps/medusa/integration-tests/http/return-prepay-premises.spec.ts`

**Interfaces:**
- Consumes: PR 6 `return-settlement-premises.spec.ts` 의 주문 준비 꼴(30,000×2 줄, 반품 2개 요청 확정, wallet 목), settlement 의 `refundOrderPayments`·`loadOrderView`, partial-cancel 의 `cancelledAdjustmentShare`.

- [ ] **Step 1: 스펙 작성**
  - (실측으로 고친 갈래 — 위 «🔴 Task 1 실측») `it('반품 요청이 열린 주문의 RETURN 환불 24,000 → 크레딧 라인 0, 차액 +24,000, NOT_PAID 0')` — `refundOrderPayments({ amount: 24000, note: 'return-prepay:t1', mode: 'auto', kind: 'RETURN' })`.
  - `it('그 뒤 수령 2 확정 → 차액 −36,000, 남은 36,000 환불 → 차액 0, 크레딧 0, NOT_PAID 0')`.
  - `it('반품 요청 «전» 환불 24,000 → 크레딧 +24,000·차액 0, 그 뒤 반품 요청·수령 2 → −60,000, −24,000 상계 크레딧 + 36,000 환불 → 차액 0')` — `createOrderCreditLinesWorkflow`(`reference: 'return-offset'`). N6 식의 두 갈래(크레딧 없음·있음)를 끝까지 잰다.
  - `it('5,000 할인이 붙은 줄의 품목 값 추정이 수령 차액과 같다')` — `floor(unitPrice × 2 − cancelledAdjustmentShare(adjs, 2, 0))` == 수령 전후 차액(반올림 전 값 포함해 기록).
  - `it('같은 order edit 에 배송 방법 둘(3,000·2,000) → 차액이 5,000 오르고 NOT_PAID 0')`.
  - `it('2개 요청 중 1개만 수령 확정 → status partially_received, return_requested_quantity 1, 차액 −30,000')`.
- [ ] **Step 2: 실행** — `scripts/local/run-medusa-integration.sh --testPathPattern 'http/return-prepay-premises\.spec'` → PASS. 빨가면 멈추고 보고.
- [ ] **Step 3: Commit** — `test(medusa): 반품 요청이 열린 주문의 선환불·상계·품목 값 추정·부분 수령의 차액을 못 박는다 (K8 PR6b)`

### Task 2: 계약 — 정산 명령의 CS 칸, 선환불 명령·사실

**Files:**
- Modify: `packages/event-contracts/streams/channel-orders-command.stream.ts`, `packages/event-contracts/streams/orders.stream.ts`
- Test: 두 스트림의 기존 spec

**Interfaces:**
- Produces:
  - `SettleChannelReturnPayload` 에 선택 칸 셋: `holdDeduction?: { amount: number; memo: string }`(amount int ≥ 1, memo 1~500자), `alreadyRefundedAmount?: number`(int ≥ 0), `closesMissing?: boolean`.
  - `PrepayChannelReturnPayload { requestId; salesChannel; externalOrderId; returnId; amount?: number /* int ≥ 1 */; refundMode: ChannelCancelRefundMode; memo: string; requestedAt: string }` + 스트림 `events` 에 `PrepayChannelReturn`.
  - `ReturnSettlementDeduction.hold?: number`(int ≥ 0). `ChannelReturnSettledPayload` 에 `prepaidAmount?: number`·`externalRefundApplied?: number`(int ≥ 0).
  - `ChannelReturnPrepaidPayload { orderId; salesChannel: SalesChannel; externalOrderId; returnId; requestId; amount: number; refundMode: ChannelCancelRefundMode; prepaidAt: string }`, `ChannelReturnPrepayFailedPayload { requestId; salesChannel: string; externalOrderId; returnId; retryable: boolean; failureCode: string; message: string; at: string }` + `ORDER_STREAM.events` 에 둘.
  - 전부 선택 칸이거나 새 이름이다 — 옛 소비자는 칸을 버리거나 warn 하고 넘긴다(N1·N2 of PR 6). 주석에 «옛 channel-adapter 는 `holdDeduction` 을 버린다 → 배포 직전 `held` 반품 0 확인»을 적는다.
- [ ] **Step 1: 실패하는 테스트** — 정산 명령: 세 칸을 실은 정상 parse 통과, `holdDeduction.amount: 0`·`memo: ''`·`alreadyRefundedAmount: -1` throw. 선환불 명령: 정상 통과, `amount: 0`·`refundMode` 누락 throw. `ChannelReturnSettled`: 새 칸 없이도 통과(옛 생산자), `deduction.hold: 1.5` throw. 두 새 사실: 정상 통과, 필수 칸 누락 throw.
- [ ] **Step 2: 실행** — `npx jest packages/event-contracts` → FAIL.
- [ ] **Step 3: 구현** — 기존 `z.object` 관례, 수령·폐기 항목 스키마는 이번에 하나로 묶는다(PR 6 미룬 Minor).
- [ ] **Step 4: 실행** — PASS, `npm run type-check` 0.
- [ ] **Step 5: Commit** — `feat(event-contracts): 반품 정산 명령의 보류 차감·상계·미도착 칸, 선환불 명령과 성공·실패 사실 (K8 PR6b)`

### Task 3: Medusa — 정산 도구 넓히기(순수 함수·공용 도구)

**Files:**
- Create: `apps/medusa/src/workflows/orders/settlement/offset-credit-line.ts` (부분취소 `offsetExternalRefund` 를 꺼낸다)
- Create: `apps/medusa/src/workflows/orders/returns/return-item-value.ts`
- Create: `apps/medusa/src/workflows/orders/returns/return-prepay-record.ts`
- Create: `apps/medusa/src/workflows/orders/returns/apply-return-offsets.ts`
- Modify: `settlement/order-edit-charge.ts`(`charges[]`), `partial-cancel/plan-shipping.ts`(`RETURN_HOLD_DEDUCTION_NAME`), `partial-cancel/partial-cancel-order.ts`(꺼낸 함수를 부르고, 외부 환불 판정에 반품 기록을 더한다), `returns/return-settlement-record.ts`(새 칸)
- Test: `returns/__tests__/return-item-value.unit.spec.ts`, `returns/__tests__/apply-return-offsets.unit.spec.ts`, `returns/__tests__/return-prepay-record.unit.spec.ts`, 기존 `plan-shipping`·`return-settlement-record` 단위 스펙

**Interfaces:**
- Produces:
  - `offsetCreditLine(container: MedusaContainer, input: { orderId: string; reference: string; referenceId: string; amount: number }): Promise<void>` — 같은 reference·referenceId 라인이 있으면 건너뛴다, 0 이하면 아무것도 안 한다. 로그 문구에서 «부분취소»를 `reference` 로 바꾼다. 부분취소는 `reference: 'partial-cancel'` 로 부른다(동작 그대로).
  - `addSettlementCharge(container, { orderId; tag; shippingOptionId; charges: Array<{ name: string; amount: number }>; actorId? })` — 한 order edit 에 방법 여럿, 0 원 몫은 건너뛴다. 부분취소·반품 정산 호출부를 고친다.
  - `export const RETURN_HOLD_DEDUCTION_NAME = '반품 차감'`, `SETTLEMENT_CHARGE_NAMES` 에 더한다.
  - `returnItemValue(lines: OrderView['lines'], items: Array<{ itemId: string; quantity: number }>): number` — N5 식, 내림.
  - `return-prepay-record.ts`: `RETURN_PREPAY_METADATA_KEY = 'almondReturnPrepay'`, `prepayNote(requestId) = 'return-prepay:' + requestId`, `type ReturnPrepayRecord = { requestId; requestHash; stage: 'requested' | 'refunded'; amount: number; itemValue: number; feeEstimate: ReturnSettlementDeduction; memo: string; requestedAt: string; refundedAt?: string; refundMode?: string }`, `readReturnPrepayRecord(metadata: unknown): ReturnPrepayRecord | null`(어긋나면 null), `hashReturnPrepay(requestId, amount: number | null, memo)`, `prepaidTotal(refunds: Array<{ amount: unknown; note?: string | null }>, requestId: string): number`.
  - `ReturnSettlementRecord` 새 칸(전부 선택): `deduction.hold?: number`, `hold?: { requested: number; memo: string }`, `prepaidApplied?: number`, `externalRefundApplied?: number`, `closesMissing?: boolean`. 읽기는 칸이 없으면 PR 6 기록으로 읽는다(옛 기록 호환).
  - `applyReturnOffsets(input: { owed: number; room: number; diffBeforeReceive: number; prepaid: number; externalRefund: number; fees: ReturnSettlementDeduction; holdRequested: number }): { prepaidApplied: number; externalRefundApplied: number; offsetCreditLine: number; deduction: ReturnSettlementDeduction /* hold 포함, 깎인 값 */; refundAmount: number }` — N3 순서, `offsetCreditLine` 은 N6 식(`clamp(prepaidApplied + externalRefundApplied − diffBeforeReceive, 0, 그 합)`, 그리고 `room` 이하). `room` = 수령 뒤 `floor(−pendingDifference)`: Medusa `validateOrderCreditLinesStep` 은 음수 라인이 |차액| 을 넘으면 거절한다(부분취소 `room` 과 같은 이유). `available = owed − prepaidApplied − externalRefundApplied`, 택배비는 `available` 안에서 ①→②→③, 보류는 남은 것 안에서.
  - Medusa 쪽 `ReturnSettlementDeduction`(`plan-return-fees.ts`, 계약을 import 하지 않는 사본)에도 `hold?: number` 를 더한다.
  - 외부 환불 판정: `unresolvedExternalRefund(refunds, [...부분취소 기록, ...loadReturnSettlementRecords])` — 부분취소·반품 정산 두 호출부 모두. 반품 기록의 `externalRefundApplied` 가 빠진다.

- [ ] **Step 1: 실패하는 단위 테스트**
  - `return-item-value`: 할인 없는 30,000×2 중 1 → 30,000. 줄 할인 5,000(수량 2) 중 1 → 27,500. 소수 몫은 내림.
  - `apply-return-offsets`: `it('선환불 24,000·owed 60,000·택배비 6,000 → 정산 환불 30,000')`, `it('선환불이 owed − 택배비보다 크면 택배비가 깎인다')`(owed 60,000·P 58,000 → 반품비 2,000·깨짐 0), `it('보류 100,000 요청 → 남은 만큼만 적용, 환불 0')`(Review Focus 2), `it('외부 상계는 선환불 다음, 택배비 앞')`, `it('전부 0 이면 환불 = owed, 상계 크레딧 0')`, `it('선환불 24,000 이 수령 전 차액에 +24,000 으로 들어 있으면 상계 크레딧 0')`, `it('크레딧이 붙은 외부 환불 10,000(수령 전 차액 0) → 상계 크레딧 10,000')`, `it('상계 크레딧은 room 을 넘지 않는다')`.
  - `return-prepay-record`: 읽기·쓰기 왕복, 칸 하나 어긋나면 null, `prepaidTotal` 이 다른 메모·다른 requestId 를 빼고 합친다.
  - `plan-shipping`: `it('반품 차감 방법은 원래 방법이 아니다')`.
  - `return-settlement-record`: 새 칸 없는 PR 6 기록이 그대로 읽힌다.
- [ ] **Step 2: 실행** — `(cd apps/medusa && npx jest src/workflows/orders/returns src/workflows/orders/settlement src/workflows/orders/partial-cancel)` → FAIL.
- [ ] **Step 3: 구현** — 위 Interfaces 대로. 부분취소 쪽은 함수 위치·인자만 바뀌고 동작이 같아야 한다.
- [ ] **Step 4: 실행** — 같은 명령 PASS, `(cd apps/medusa && npm run test:unit)` 0, `scripts/local/run-medusa-integration.sh --testPathPattern 'http/partial-cancel'` PASS(꺼낸 상계·청구 회귀).
- [ ] **Step 5: Commit** — `refactor(medusa): 상계 크레딧 라인·정산 청구를 공용으로, 반품 품목 값·선환불 기록·상계 순서 (K8 PR6b)`

### Task 4: Medusa — 선환불 워크플로·라우트·미리보기, 선환불한 반품은 취소 거절

**Files:**
- Create: `apps/medusa/src/workflows/orders/returns/prepay-order-return.ts`
- Create: `apps/medusa/src/workflows/orders/returns/return-settlement-preview.ts`
- Create: `apps/medusa/src/api/admin/orders/[id]/returns/[return_id]/prepay/route.ts` + `parse-input.ts`
- Create: `apps/medusa/src/api/admin/orders/[id]/returns/[return_id]/settlement-preview/route.ts`
- Modify: `apps/medusa/src/workflows/orders/returns/cancel-order-return.ts` (`return_prepaid`)
- Test: `apps/medusa/integration-tests/http/return-prepay.spec.ts`, `return-cancel.spec.ts`(케이스)

**Interfaces:**
- Consumes: Task 3 의 `returnItemValue`·`ReturnPrepayRecord`·`prepayNote`·`hashReturnPrepay`, PR 6 의 `planReturnFees`·`readReturnRequestRecord`·`readReturnSettlementRecord`·`refundOrderPayments`·`reconcileOrderWalletRefunds`·`orderCancelLockKey`.
- Produces:
  - `type PrepayOrderReturnInput = { orderId; returnId; requestId; amount?: number; refundMode?: RefundMode; memo: string; actorId? }`, `type PrepayOrderReturnResult = { returnId; requestId; amount: number; refund: { mode: RefundMode; amount: number }; stage: 'refunded' }`.
  - `prepayOrderReturn(container, input)` — 주문 잠금 안. 오류 `ReturnPrepayRejected(reason, message)`(reason: `not_our_return`·`return_canceled`·`return_already_settled`·`request_id_conflict`·`prepay_exceeds_item_value`·`external_refund_unresolved`·`pending_refund_outstanding`), `ReturnPrepayRefundPending`, `ReturnPrepayRefundRefused(refusalCode)`.
  - 흐름: 반품·요청 기록 확인 → 정산 기록이 있거나 반품이 `received`·`partially_received` 면 `return_already_settled` → 선환불 기록이 `refunded` 면 결과 그대로, 해시가 다르면 `request_id_conflict` → (기록 없을 때) 장부 맞추기 → 외부 환불 미해결이면 거절 → 주문 차액(`loadOrderView`)이 음수면(돌려줄 돈이 이미 밀려 있다) `pending_refund_outstanding` — N6 의 상계 식은 다른 돈 일이 끝난 주문을 전제한다 → `V`·`F` 계산(N5) → 금액 판정 → 기록 `requested` → `refundOrderPayments({ amount, note: prepayNote, mode, kind: 'RETURN' })` → 기록 `refunded`. 이어 가는 호출은 정산과 같은 꼴이다: 장부 맞추기 뒤 같은 메모로 전액을 부르면 `refundOrderPayments` 가 같은 메모의 장부 몫을 빼고 남은 몫만 낸다(`refund-order-payments.ts:31`).
  - `returnSettlementPreview(container, { orderId, returnId }): Promise<{ itemValue: number; feeEstimate: ReturnSettlementDeduction; defaultPrepayAmount: number; prepaidAmount: number }>` — 선환불과 같은 `V`·`F` 계산 함수를 쓴다(따로 두 벌 쓰지 않는다).
  - 라우트 `POST /admin/orders/:id/returns/:return_id/prepay` 본문 `{ requestId, amount?, refundMode?, memo }`, `GET …/settlement-preview`. 응답 계약은 Global Constraints.
  - `cancelOrderReturn`: 주문 변경을 건드리기 전, `prepaidTotal(주문 환불, 반품의 요청 기록 requestId) > 0` 또는 선환불 기록이 있으면 `ReturnRequestRejected('return_prepaid', '먼저 환불한 반품은 취소할 수 없습니다')`. `ReturnRejectReason` 에 값을 더한다(medusa tsc 가 잡는다 — PR 6 Task 10 교훈).
- [ ] **Step 1: 실패하는 통합 테스트** — `return-prepay.spec.ts`(주문 준비는 Task 1 꼴):
  - `it('금액 없이 선환불 → V − F 환불, 메모 return-prepay:<id>, kind RETURN, 반품 requested 그대로, 차액 0')`.
  - `it('금액 지정 10,000 → 10,000')`, `it('품목 값보다 큰 금액 → 400 prepay_exceeds_item_value, 환불 0')`.
  - `it('같은 requestId 두 번 → 환불 1')`, `it('환불 502 뒤 같은 requestId → 남은 몫만')`, `it('wallet 영구 거절 → 400 wallet_refund_refused, 기록 requested')`.
  - `it('정산 끝난 반품에 선환불 → 400 return_already_settled')`(Review Focus 4 의 한 갈래).
  - `it('환불이 밀린 부분취소가 있어 차액이 음수인 주문 → 400 pending_refund_outstanding')`.
  - `it('미리보기가 선환불 기본값과 같은 숫자를 준다, 선환불 뒤 prepaidAmount')`.
  - `return-cancel.spec.ts`: `it('선환불한 반품 취소 → 400 return_prepaid, 반품 그대로')`.
- [ ] **Step 2: 실행** — `scripts/local/run-medusa-integration.sh --testPathPattern 'http/return-(prepay|cancel)\.spec'` → FAIL.
- [ ] **Step 3: 구현**.
- [ ] **Step 4: 실행** — PASS, `--testPathPattern 'http/return-'` 전부 PASS, `npx tsc --noEmit -p apps/medusa/tsconfig.json` 기존 3건만.
- [ ] **Step 5: Commit** — `feat(medusa): 반품 선환불 — 수령 없이 RETURN 환불, 금액 기본값·상한, 미리보기, 선환불한 반품은 취소 거절 (K8 PR6b)`

### Task 5: Medusa — 정산이 보류 차감·선환불·외부 상계·미도착을 안다

**Files:**
- Modify: `apps/medusa/src/workflows/orders/returns/settle-order-return.ts`
- Modify: `apps/medusa/src/api/admin/orders/[id]/returns/[return_id]/settle/parse-input.ts`
- Test: `apps/medusa/integration-tests/http/return-settle.spec.ts`(케이스)

**Interfaces:**
- Consumes: Task 3 `applyReturnOffsets`·`offsetCreditLine`·`addSettlementCharge(charges)`·`prepaidTotal`·`RETURN_HOLD_DEDUCTION_NAME`, Task 4 의 선환불 메모.
- Produces:
  - `SettleOrderReturnInput` 에 `holdDeduction?: { amount: number; memo: string }`, `alreadyRefundedAmount?: number`, `closesMissing?: boolean`. 해시에 넣는다: `holdDeduction.amount`·`alreadyRefundedAmount`·`closesMissing`(재발행이 같은 값을 내므로 늘 같다 — 다른 값이면 `request_id_conflict`). `refundMode` 는 그대로 해시 밖.
  - `SettleOrderReturnResult` 에 `prepaidApplied`·`externalRefundApplied` 를 더하고, `deduction.hold` 가 적용액을 싣는다.
  - `ReturnSettleRejectReason` 에 `external_refund_exceeds`·`external_refund_absent`(부분취소 `checkAlreadyRefunded` 와 같은 뜻 — 그 함수를 쓴다).
- 흐름 변경(기록 없는 새 요청):
  1. `assertItemsMatch` — `closesMissing` 이면 «품목은 반품 품목의 부분집합, 줄마다 `0 < 수령 + 폐기 ≤ 반품 수량`», 아니면 PR 6 그대로.
  2. 외부 환불: `alreadyRefundedAmount` 가 없으면 PR 6 처럼 `external_refund_unresolved`, 있으면 `checkAlreadyRefunded(unresolved, alreadyRefundedAmount)`.
  3. 수령 뒤 `P = prepaidTotal(환불, requestId)`, 택배비 계획의 `chargeCap = max(0, owed − P − alreadyRefundedAmount)`, `applyReturnOffsets` 로 상계·차감·환불액. 기록에 새 칸.
  4. `charge` 단계: 상계 크레딧 라인 하나(`'return-offset'`, 금액 `offsetCreditLine`, 0 이면 건너뜀) → 택배비·보류 차감을 한 `addSettlementCharge`(`charges: [{ 반품 택배비, 합 }, { 반품 차감, hold }]`). 셋 다 이미 있으면 건너뛰므로 이어 가기가 두 번 넣지 않는다. 기록 `charged`.
- [ ] **Step 1: 실패하는 통합 테스트**
  - `it('선환불 기본값 뒤 정산 → 환불 합 60,000 − 택배비, 마지막 차액 0, 크레딧 합 0, NOT_PAID 0')`(Review Focus 1).
  - `it('품목 값 전액 선환불 뒤 정산 → 택배비 0 으로 깎임, 정산 환불 0, 차액 0')`.
  - `it('선환불이 먼저 Medusa 에 닿고 정산 → 정산이 P 만큼 덜 낸다')`(Review Focus 4).
  - `it('보류 차감 5,000·메모 → «반품 차감» 방법 5,000, 환불이 그만큼 적다')`, `it('보류 차감 100,000 → 적용액 = 남은 돈, 환불 0, 기록에 요청·적용')`(Review Focus 2).
  - `it('closesMissing 로 2개 중 1개만 정산 → partially_received, 환불 30,000 − 택배비')`, `it('closesMissing 없이 1개만 → 400 items_mismatch')`.
  - `it('외부 환불 있는 주문 + alreadyRefundedAmount → 그만큼 상계, 뒤의 부분취소가 그 외부 환불을 다시 묻지 않는다')`, `it('alreadyRefundedAmount 가 미해결보다 크면 400 external_refund_exceeds')`.
  - `it('received 에서 끊긴 보류 정산을 같은 요청으로 이어 가면 «반품 차감»·상계 라인이 하나씩')`.
  - `it('반품 «전» 외부 환불(크레딧 +10,000) + alreadyRefundedAmount 10,000 → 상계 −10,000, 마지막 차액 0')`, `it('선환불이 있는데 환불 안 끝난 부분취소 기록이 있으면 500, 반품 그대로')`(N6 의 전제).
  - `it('같은 requestId 에 보류 차감액만 다르면 400 request_id_conflict')`.
- [ ] **Step 2: 실행** — `scripts/local/run-medusa-integration.sh --testPathPattern 'http/return-settle\.spec'` → FAIL.
- [ ] **Step 3: 구현**.
- [ ] **Step 4: 실행** — PASS. `--testPathPattern 'http/(partial-cancel|channel-cancel|return-)'` 전부 PASS. unit 0, medusa tsc 기존 3건만.
- [ ] **Step 5: Commit** — `feat(medusa): 반품 정산이 선환불·외부 환불을 상계하고, 보류 차감을 남은 돈 안에서 받고, 미도착을 닫은 일부 정산을 받는다 (K8 PR6b)`

### Task 6: core 스키마 — 선환불·CS 결정 칸, 줄의 미도착 수량, K6

**Files:**
- Modify: `apps/core/src/modules/inventory/schema/inventory.schema.ts`
- Create: `apps/core/drizzle/<timestamp>_add-customer-return-cs-doors.sql` + `drizzle/meta/`(생성물)
- Modify: `apps/core/src/modules/sales-order/customer-return/customer-return.types.ts`, `customer-return-transition.ts`(`set` 의 Pick 에 `prepayment`·`csResolution`)
- Modify: `apps/core/src/modules/sales-order/line-quantities/claim-quantities.sql.ts`(세 곳)
- Test: `customer-return.types.spec.ts`, line-quantities 통합 스펙(K6 반품 케이스가 있는 파일)

**Interfaces:**
- Produces:
  - `customer_returns.prepayment` jsonb `$type<CustomerReturnPrepayment>()` null · `customer_returns.cs_resolution` jsonb `$type<CustomerReturnCsResolution>()` null · `customer_return_lines.missing_qty` int notNull default 0, check `missing_qty >= 0 and missing_qty <= quantity`.
  - 타입:
    - `CustomerReturnSettlement` 에 `issues: number`, `command: { holdDeduction?: { amount: number; memo: string }; alreadyRefundedAmount?: number; closesMissing?: boolean }`(둘 다 PR 6 행엔 없다 — 읽는 곳은 `issues ?? attempts`, `command ?? {}`).
    - `CustomerReturnPrepayment = { state: 'in_progress' | 'refused' | 'stalled' | 'done' | 'superseded'; refundMode: 'auto' | 'manual'; requestedAmount: number | null; memo: string; requestedBy: string; startedAt; lastIssuedAt; attempts; issues; lastFailure: { code; message; retryable; at } | null; outcome: { amount: number; refundMode: 'auto' | 'manual'; prepaidAt: string } | null }`.
    - `CustomerReturnCsResolution = { missing?: { memo: string; by: string; at: string }; hold?: { deduction: number; memo: string; by: string; at: string } }`.
    - `CustomerReturnSettlementOutcome` 에 `prepaidAmount?`·`externalRefundApplied?`(계약의 선택 칸 그대로), `deduction` 은 계약 타입이라 `hold?` 가 따라온다.
  - K6: `customer_return_line.quantity` 를 읽는 세 곳을 `(customer_return_line.quantity - customer_return_line.missing_qty)` 로.
- [ ] **Step 1: 실패하는 테스트** — K6 통합: `it('미도착으로 닫은 1개는 claimable 로 돌아오고 returnHeld 에서 빠진다')`(줄 2개 반품, missing_qty 1 을 직접 써서). 타입 스펙: 새 칸 존재.
- [ ] **Step 2: 실행** — scratch DB 로 해당 통합 → FAIL.
- [ ] **Step 3: 스키마 → `npm run db:generate:core -- --name add-customer-return-cs-doors`** — 생성 SQL 이 `ADD COLUMN` 셋·check 하나뿐인지 읽는다. 다른 객체가 섞이면 `git rm` 하고 보고. scratch 빈 DB 에 `npx drizzle-kit migrate --config apps/core/drizzle.config.ts` → `migrations applied successfully`.
- [ ] **Step 4: 구현 → 실행** — PASS, `npx jest apps/core/src/modules/sales-order` 0, `npm run type-check` 0.
- [ ] **Step 5: Commit** — 스키마 + SQL + meta + 코드 한 커밋: `feat(core): 반품 선환불·CS 결정 칸과 줄의 미도착 수량, K6 가 닫힌 수량을 돌려준다 (K8 PR6b)`

### Task 7: core — 미도착 닫기·보류 정산·선환불 요청

**Files:**
- Create: `apps/core/src/modules/sales-order/customer-return/customer-return-cs.manager.ts`
- Create: `apps/core/src/modules/sales-order/customer-return/customer-return-prepay-command.ts` (`enqueuePrepayChannelReturn`)
- Modify: `customer-return-receiving.manager.ts`(검수·도착이 미도착을 안다), `customer-return-settle-command.ts`(`toSettleItems`·`enqueueSettleChannelReturn`), `customer-return.reader.ts`(view 새 칸), `customer-return.service.ts`, `customer-returns.controller.ts` + `dto/customer-return-cs.dto.ts`, `sales-order.module.ts`
- Modify: 보안 목록 — `npx jest scripts/security` 가 요구하는 줄(IDOR 리뷰 목록은 줄 좌표다)
- Test: `customer-return-cs.manager.integration.spec.ts`(`describeIfDb`), `customer-return-settle-command.spec.ts`(케이스)

**Interfaces:**
- Consumes: Task 2 계약, Task 6 칸·타입, PR 6 `transitionCustomerReturn`·`CustomerReturnReader`.
- Produces:
  - `toSettleItems(lines: Array<{ channelOrderItemId; quantity; missingQty: number; items: Array<{ qtyPerUnit; rejectedQty; heldQty }> }>)` — 줄 수량 = `quantity − missingQty`, 0 이면 뺀다, 폐기 = `ceil((rejected + held) / qtyPerUnit)` 의 최댓값(N14). 검수·재발행 두 호출부가 새 입력을 준다.
  - `enqueueSettleChannelReturn` 의 `p` 에 `command: CustomerReturnSettlement['command']` 를 더해 명령 칸으로 싣고, 멱등키는 `p.issue`(= `issues`).
  - `enqueuePrepayChannelReturn(publisher, tx, { customerReturnId; salesOrderId; channelReturnId; amount: number | null; refundMode; memo; issue })` — 키 `customer-return-prepay:<id>:issue:<n>`.
  - `CustomerReturnCsManager`:
    - `closeMissing(input: { customerReturnId; memo; actorId }, tx?): Promise<CustomerReturnView>` — N8·N15. 상태 `arrived` 만(그 밖 Conflict), 선환불이 `in_progress`·`stalled`·`done` 이면 Conflict, 이미 닫혔으면 view 그대로. 줄마다 `missing_qty` 를 쓰고 `cs_resolution.missing` 을 쓴다(상태는 그대로 `arrived`). 다 왔으면·온전한 벌이 없으면 BadRequest(N8 문구).
    - `settleHeld(input: { customerReturnId; deduction: number; memo; actorId }, tx?)` — 상태 `held` 만. `transitionCustomerReturn(held → inspected, set { settlement, csResolution.hold })` + `enqueueSettleChannelReturn(issue 1, command { holdDeduction?(deduction > 0 일 때), closesMissing?(닫혔을 때) })`. 같은 요청이 다시 오면(상태 `inspected` 이후, 저장된 hold 가 같으면) view 그대로, 다르면 Conflict.
    - `requestPrepay(input: { customerReturnId; amount: number | null; refundMode: 'auto' | 'manual'; memo; actorId }, tx?)` — 상태 `expected`·`arrived`, 미도착 닫지 않음, `prepayment` 없음(있으면 같은 금액·메모면 그대로, 다르면 Conflict). `prepayment` 를 `in_progress`(attempts 1, issues 1)로 쓰고 명령. 상태는 바꾸지 않는다(칸 쓰기 — `writePrepayment` private, PR 6 `writeSettlement` 꼴).
  - `recordInspection`: 미도착이 닫혔으면 «기대 = 도착» 검사를 건너뛰고 «합 = 도착»만. 명령에 `closesMissing`. `recordArrival`: 닫혔으면 Conflict(`'미도착으로 닫은 반품입니다'`).
  - 라우트: `POST :id/missing-closure { memo }`, `POST :id/held-settlement { deduction, memo }`(`deduction` `@IsInt() @Min(0)`), `POST :id/prepayment { amount?, refundMode?, memo }`(`amount` `@IsOptional() @IsInt() @Min(1)`, `refundMode` 기본 auto). 전부 `@HttpCode(200)`, 응답 view.
- [ ] **Step 1: 실패하는 테스트**
  - `toSettleItems`: 보류 1 → 폐기 1, 미도착 1(줄 2) → 줄 수량 1, 미도착 = 줄 수량이면 그 줄이 빠진다.
  - 통합: `it('2개 중 1개 도착 → 닫기 → 검수 → 정산 명령 품목 1·closesMissing')`, `it('닫은 뒤 늦은 소포 → Conflict, 원장 그대로')`(Review Focus 5), `it('다 온 반품 닫기 → BadRequest', '도착 전(expected) 닫기 → Conflict')`, `it('세트 A×2·B×1 1벌에 A 2개만 왔다 → 온전한 벌 없음 BadRequest')`, `it('보류 → 차감 3,000 정산 → inspected, 명령 holdDeduction 3,000, 같은 요청 두 번 → 명령 1')`, `it('보류 차감 0 → 명령에 holdDeduction 없음')`, `it('선환불 요청 → prepayment in_progress, PrepayChannelReturn 1, 상태 그대로')`, `it('선환불 중 미도착 닫기 → Conflict')`, `it('검수가 끝난 반품에 선환불 → Conflict')`.
  - `npx jest scripts/security` 와 route-classification 가드가 초록.
- [ ] **Step 2: 실행** — `DATABASE_URL=<scratch> npx jest apps/core/src/modules/sales-order/customer-return --runInBand` → FAIL.
- [ ] **Step 3: 구현**.
- [ ] **Step 4: 실행** — PASS, `npx jest scripts/security apps/core/src/modules/sales-order` 0, `npm run type-check` 0.
- [ ] **Step 5: Commit** — `feat(core): 반품 미도착 닫기·보류 정산·선환불 요청 — 기록을 옮기고 같은 트랜잭션에 명령 (K8 PR6b)`

### Task 8: core — 선환불 결과, 다시 시도·계좌 송금, 재발행

**Files:**
- Modify: `customer-return-settlement.manager.ts`(선환불 결과 둘, 다시 시도, 재발행이 선환불도 본다, `issues`)
- Modify: `apps/core/src/modules/sales-order/consumers/order-events.consumer.ts`(핸들러 둘)
- Modify: `customer-return.service.ts`, `customer-returns.controller.ts` + dto
- Test: `customer-return-settlement.manager.integration.spec.ts`(케이스), 크론 단위 spec

**Interfaces:**
- Consumes: Task 2 사실 둘, Task 7 명령 함수들.
- Produces:
  - `recordPrepaid(fact: ChannelReturnPrepaidPayload, tx?)` → `{ changed }` — 선환불 `done` + `outcome`. 이미 `done` 이면 false. requestId 가 기록 id 와 다르면 Conflict(PR 6 `lockByChannelReturnId` 를 쓴다).
  - `recordPrepayFailed(fact: ChannelReturnPrepayFailedPayload, tx?)` — `at` 이 더 늦은 것만, `retryable ? in_progress : refused`. 코드가 `return_prepay_rejected:return_already_settled` 면 `superseded`(N7).
  - `recordSettled`: 결과 칸에 `prepaidAmount`·`externalRefundApplied` 를 적고, 선환불이 `done` 이 아니면 `superseded`.
  - `restart(input: { customerReturnId; target: 'settlement' | 'prepayment'; kind: 'retry' | 'manual'; alreadyRefundedAmount?: number }, tx?)` — N10·N11. 대상 칸이 `refused`·`stalled` 일 때만. 정산은 상태 `inspected`·`refund_pending`, 선환불은 상태 `expected`·`arrived` 를 요구. `alreadyRefundedAmount` 는 정산·마지막 실패 `return_settle_rejected:external_refund_unresolved` 일 때만(아니면 BadRequest), `command.alreadyRefundedAmount` 에 저장. 칸을 `{ state: 'in_progress', refundMode, attempts: 1, issues: issues + 1, lastIssuedAt: now }` 로 쓰고 같은 트랜잭션에 명령.
  - `reissueStalled`: 정산 칸과 같은 규칙으로 선환불 칸(`prepayment->>'state' = 'in_progress'`, 상태 `expected`·`arrived`)도 고른다. 두 칸 모두 키는 `issues + 1`, 그 뒤 `issues`·`attempts` 를 민다. 수는 합쳐 돌려준다.
  - 소비자: `@On(ORDER_STREAM, 'ChannelReturnPrepaid')`(`@RetryPolicy({ nonRetryableErrors: [NotFoundError, BadRequestError] })`), `@On(ORDER_STREAM, 'ChannelReturnPrepayFailed')`.
  - 라우트: `POST :id/settlement/retry { alreadyRefundedAmount? }`, `POST :id/settlement/manual-refund`, `POST :id/prepayment/retry`, `POST :id/prepayment/manual-refund`.
- [ ] **Step 1: 실패하는 통합 테스트**
  - `it('stalled(attempts 12) → 다시 시도 → issue 13 명령, 5분 뒤 크론 issue 14')`(Review Focus 3), `it('refused → 계좌 송금 → refundMode manual 명령, 이미 수동이면 Conflict')`, `it('진행 중 다시 시도 → Conflict')`.
  - `it('외부 환불 거절 뒤 이미 환불한 금액 10,000 → 명령 alreadyRefundedAmount 10,000, 크론 재발행도 같은 값')`, `it('다른 실패 뒤 이미 환불한 금액 → BadRequest')`.
  - `it('선환불 성공 사실 → done·outcome, 두 번 → changed false')`, `it('선환불 거절 return_already_settled → superseded')`, `it('settled 사실 → 진행 중 선환불 superseded, 결과에 prepaidAmount')`(Review Focus 4 의 core 갈래).
  - `it('크론이 in_progress 선환불도 5분 뒤 다시 낸다')`.
  - PR 6 의 정산 결과 케이스가 그대로 초록.
- [ ] **Step 2: 실행** — scratch DB `--runInBand` → FAIL.
- [ ] **Step 3: 구현**.
- [ ] **Step 4: 실행** — PASS, `npx jest apps/core/src/modules/sales-order libs/cron-once scripts/security` 0, `npm run type-check` 0.
- [ ] **Step 5: Commit** — `feat(core): 반품 선환불 결과·다시 시도·계좌 송금, 재발행이 선환불도 보고 키가 겹치지 않는다 (K8 PR6b)`

### Task 9: channel-adapter — 선환불 명령 실행·관측, 정산 명령의 새 칸

**Files:**
- Create: `apps/channel-adapter/src/services/order-cancel/channel-return-prepay.manager.ts` (+ spec)
- Modify: `channel-order-cancel.repository.ts`(`recordReturnPrepayFailure`), `consumers/channel-orders-command.consumer.ts`(`PrepayChannelReturn`), `adapters/medusa/medusa.client.ts`(`prepayReturn`, `settleReturn` 이 새 칸을 싣는다), `services/order-collection/medusa-return-observations.ts`(`prepaid`, settled 에 새 칸), PR 5·6 이 관측을 더한 자리(`channel-order-source.interface.ts`·`channel-order-provider.interface.ts`·`order-poller.orchestrator.ts`·`order-event-routing.ts`)
- Modify: `apps/channel-adapter/CLAUDE.md`(§4 스트림 표)
- Test: 매니저 spec, `medusa-return-observations.spec.ts`, 응답 분류 spec, 오케스트레이터 spec

**Interfaces:**
- Produces:
  - `MedusaClient.prepayReturn(orderId, returnId, input: { requestId; amount?: number; refundMode; memo }): Promise<MedusaReturnPrepayOutcome>`, `MedusaReturnPrepayOutcome` = `MedusaReturnSettleOutcome` 와 같은 갈래(`settled` 대신 `prepaid`, 거절 코드 `return_prepay_rejected`). 분류 함수는 정산 것을 코드 이름만 받아 함께 쓴다.
  - `settleReturn` 의 `input` 에 `holdDeduction?`·`alreadyRefundedAmount?`·`closesMissing?` — 명령 칸을 그대로 넘긴다(번역 없음).
  - `ChannelReturnPrepayManager.execute(command, deliveryId)` — 결과 → 실패 사실(`rejected` 영구 `return_prepay_rejected:<reason>`, `refund_refused` 영구, `refund_pending`·`transient` 일시, `not_found` 영구). 모르는 400 은 일시(N12). 성공이면 `syncOrder(force)`.
  - 관측: 선환불 기록 `stage === 'refunded'` → `ChannelReturnPrepaid`(eventKey `return:<id>:prepaid`, 순서 requested 뒤·settled 앞), 모양이 어긋나면 skipped `no_prepay_record` + warn. settled 관측은 기록의 `prepaidApplied`·`externalRefundApplied`·`deduction.hold` 를 싣는다(없으면 칸 생략).
- [ ] **Step 1: 실패하는 테스트** — 매니저 다섯 결과 → 실패 사실 인자, 성공 → `syncOrder` 1. 분류: 200 → prepaid, 400 `return_prepay_rejected` → rejected(reason). 관측: `it('선환불 끝난 반품 → requested 다음 prepaid')`, `it('requested 단계 선환불 기록은 prepaid 를 내지 않는다')`, `it('보류 차감·선환불 상계가 있는 정산 → settled 에 칸')`. 정산 매니저: 명령의 세 칸이 `settleReturn` 인자로 간다.
- [ ] **Step 2: 실행** — `npx jest apps/channel-adapter/src` → FAIL.
- [ ] **Step 3: 구현**.
- [ ] **Step 4: 실행** — PASS, `npm run type-check` 0.
- [ ] **Step 5: Commit** — `feat(channel-adapter): 반품 선환불 명령을 Medusa 에 실행하고 관측, 정산 명령의 보류 차감·상계·미도착 칸을 넘긴다 (K8 PR6b)`

### Task 10: 설계 문서

**Files:**
- Modify: `docs/superpowers/specs/2026-10-26-k8-returns-on-medusa-design.md`

- [ ] **Step 1: 고치기**
  - §4.3 사다리 문장: «그때 Medusa 반품의 남은 품목도 취소한다» → N8(남은 품목은 취소하지 않는다, 근거 `cancel-return.js:43`). 끝에 «**PR 6b 에서 확정한 결과.**» — N1·N7·N8·N10·N11·N14·N15.
  - §4.4 «CS 의 두 문»: 보류 정산은 N2·N3, 선환불은 N4·N5·N6(«반품 기록에 선환불액을 남겨»를 «Medusa 환불 행이 정본»으로). 「PR 6 에서 확정한 결과」 (a-2) 에 N13, (c)·(e) 에 «사람 길 = 다시 시도(PR 6b)». N16 의 «상계는 PR 6b» 를 결과로.
  - §8 표 6b 행 «사는 곳»은 그대로, 비고 «6 이 라이브인 뒤» 유지.
- [ ] **Step 2: Commit** — `docs: K8 설계에 PR6b 결과 — 미도착은 Medusa 반품을 취소하지 않는다, 선환불은 환불 행이 정본 (K8 PR6b)`

---

## Merge Danger (PR 본문용 메모)

- **배포:** core expand(`ADD COLUMN` 셋), `migrate → deploy`. 명령·사실은 새 이름이거나 선택 칸이라 소비자 선배포가 필요 없다.
- 🔴 **배포 직전:** 라이브 `select status, count(*) from customer_returns group by 1` 에 `held` 0 — 옛 channel-adapter 는 `holdDeduction` 을 버려 롤링 중 보류 정산이 차감 없이 나갈 수 있다. 개통 전(D9)이라 0 이어야 정상.
- **동작 변경:** Medusa 반품 취소가 선환불이 있으면 거절된다. 부분취소의 외부 환불 판정이 반품 정산의 상계를 뺀다(반품이 없는 주문은 그대로). 상계·청구 함수를 꺼냈다 — 부분취소 동작은 같아야 한다(Task 3 회귀).
- **알려진 잔여:** N13(A×2+E), N15(선환불 뒤 미도착은 닫지 못함 — Q1 답에 따라), 일부만 온 세트의 구성품만 온 반품은 닫지도 취소하지도 못함(N8 — CS 가 시스템 밖), 닫은 뒤 늦게 온 소포는 거절(CS 가 시스템 밖), Medusa 남은 반품 품목은 `partially_received` 로 남아 그 줄 재반품을 막는다.
- **롤백:** 이전 task definition 으로 돌려도 안전하다 — 옛 코드는 새 칸을 안 읽고, 새 명령·사실은 warn 으로 넘긴다. 이미 선환불한 반품의 정산을 옛 Medusa 가 받으면 선환불을 모르고 전액을 낸다 → 롤백 전 `prepayment->>'state' = 'done'` 이고 정산 전인 반품 0 확인.
- 배포 뒤 확인: ① 크론 로그 5분마다 0건 ② channel-adapter 로그에 `PrepayChannelReturn` 처리 오류 없음 ③ 아무 라이브 주문의 `GET …/settlement-preview` 가 반품 없음 404.
