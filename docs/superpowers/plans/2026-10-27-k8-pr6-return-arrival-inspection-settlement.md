# K8 PR 6 — 반품 도착·검수 → Medusa 수령·택배비·환불 → 정산 관측 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 창고가 반품 도착과 검수를 core 에 기록하면, core 가 Medusa 에 «수령 알림»을 보내고, Medusa 가 수령·택배비 차감·환불을 한 번에 끝낸다. 그 결과를 channel-adapter 가 관측해 core 가 반품을 «정산 끝»으로 닫고 고객 이벤트를 낸다. 반품이 처음으로 끝까지 돈다.

**Architecture:** ① core 는 반품 예정 기록(PR 5) 밑에 «SKU 항목»과 «도착 기록»을 두고, 도착(`RETURN_RECEIVE`)·검수(`RETURN_ACCEPT`/`RETURN_REJECT`) 명령이 원장(PR 4)과 기록을 한 트랜잭션에서 옮긴다. ② 검수가 끝나면 같은 트랜잭션에서 `SettleChannelReturn` 명령을 `channel-orders.commands.v1` 에 싣는다. ③ channel-adapter 가 그 명령으로 우리 Medusa 정산 라우트를 부른다. Medusa 는 주문 잠금 안에서 «수령 확정 → 택배비 주문 수정 → 환불»을 진행 기록(`return.metadata`)과 함께 단계별로 하고, 같은 requestId 재시도는 끊긴 곳부터 잇는다(부분취소와 같은 꼴). ④ 성공은 사실로 내지 않는다 — channel-adapter 가 즉시 재수집하고, 반품 관측이 `ChannelReturnSettled` 를 낸다. 실패만 `ChannelReturnSettlementFailed` 로 돌아오고, core 크론이 일시 실패를 다시 낸다.

**Tech Stack:** NestJS + Drizzle(core·channel-adapter), `@app/events` 아웃박스·명령 스트림, `@app/cron-once`, zod 계약(`packages/event-contracts`), Medusa 2.13.4 코어 워크플로(`beginReceiveReturn`·`receiveItemReturnRequest`·`dismissItemReturnRequest`·`confirmReturnReceive`·order edit), Jest(unit·`describeIfDb` 통합), Medusa HTTP 통합(`@medusajs/test-utils`).

**Spec:** `docs/superpowers/specs/2026-10-26-k8-returns-on-medusa-design.md` — §4.1(그림), §4.3(«반품 예정 기록»의 사다리·도착·검수·세트·받는 창고), §4.4(정산 1~4, «함정»), §7(배포 순서), §8 PR 6. 결정 D1·D3·D4·D10. PR 3 계획 N1·N2, PR 5 계획 N3·N4·N8 을 깨지 않는다.

## 범위 — 설계 §8 PR 6 을 둘로 나눈다 (2026-10-27 사용자 결정)

- **PR 6(이 계획):** 정상 길 끝까지 — 도착·검수 명령, 수령 알림 명령, Medusa 정산(수령 + 택배비 + 환불), 정산 관측, 고객 이벤트 `collected`·`completed`·`SalesOrderReturned`, 일시 실패 재발행. PR 3·PR 4 본문이 PR 6 에 넘긴 숙제 넷도 여기서 닫는다.
- **PR 6b(다음 계획):** CS 문 셋 — 환불 보류(`held`) 정산(차감액·메모), 선환불, 미도착으로 닫기. 그리고 영구 거절된 정산의 [다시 시도]·[계좌 송금으로 환불].
- 그래서 이 PR 에서 검수의 «환불 보류»는 `held` 에서 멈추고(명령 없음), 부분 도착은 검수를 거절한다(N7). 둘 다 개통 전이라 막다른 길이 사람에게 닿지 않는다(D9).

## PR 1~5 본문이 넘긴 것 (이 PR 이 닫는다)

| 출처 | 넘긴 것 | 여기서 |
| --- | --- | --- |
| PR 3 #1149 | 수령까지 끝난 반품도 전체취소를 막는다 — «PR 6 정산 때 다시 본다» | N10 — 계속 막는다. Task 4 가 테스트로 못 박는다 |
| PR 3 #1149 | 반품 취소는 «도착 전만»인데 Medusa 는 도착을 모른다 | N11 — 반품 취소가 core 상태를 묻는다. Task 10 |
| PR 4 #1155 | `return_default` 가 RETURNED·DEFECTIVE 가 섞인 칸이 된다 → 실사가 ON_HAND 만 읽어 ADJUST_UP 유령재고 | N12 — 실사가 그 칸을 받지 않는다. Task 8 |
| PR 4 #1155 | 이력 서랍 «이벤트 취소»가 반품 전이를 되돌려 반품 기록과 어긋난다 | N12 — 반품 전이는 역분개를 거절한다. Task 8 |
| PR 5 #1156 | `collected`·`completed`·`SalesOrderReturned` 는 PR 6 | Task 7(collected)·Task 9(completed·SalesOrderReturned) |

## 코드에서 확인한 것 (develop `a3de62b1e`)

- **반품 예정 기록(PR 5).** `customer_returns`(상태 enum 일곱 값 전부 이미 있다)·`customer_return_lines`(판매 라인 × 판매 단위 수량, `channel_order_item_id`). **창고·SKU·도착·검수 칸이 없다.** 상태 쓰기는 `transitionCustomerReturn`(`customer-return/customer-return-transition.ts`) 하나가 직전 상태 CAS 로 한다 — `set` 이 `cancelledAt` 만 받는다. K6 상태 목록(`line-quantities/claim-statuses.ts`)은 진행 중 = `expected~refund_pending`, 소진 = `settled` 로 이미 다 들어 있다 — 이 PR 이 목록을 고칠 일은 없다.
- **원장(PR 4).** `InventoryCommandService.returnReceive|returnAccept|returnReject({ skuId, warehouseId, quantity, idempotencyKey })`(`inventory/core/services/inventory-command.service.ts:741-753`). 위치는 늘 그 창고 `return_default`. 같은 키로 전이·SKU·창고·수량이 다르면 409, 같으면 기존 이벤트를 돌려준다. **«새로 만들었는지»는 돌려주지 않는다** — 그래서 도착 수량을 «이벤트를 만들었을 때만 더한다»로 셀 수 없다(N4). Nest 예외(`BadRequestException`·`ConflictException`)를 던진다.
- **세트 구성.** `sales_order_line_compositions(sales_order_line_id, sku_id, qty_per_unit)`(`inventory.schema.ts:1533`). 구성이 없는 라인은 K6 SKU 층에 행이 없어 배송완료가 0 이고, 그래서 PR 3 자격이 반품을 열어 주지 않는다.
- **원래 출고한 창고.** `deliveredParcelsSql`(`line-quantities.sql.ts:73`)이 배송완료 소포를 `shipment_id` 와 함께 낸다. `shipments.warehouse_id` 는 nullable(입점사 상자는 `supplier_id`, K3).
- **명령 길(취소).** core 가 `@InjectPublisher(CHANNEL_ORDERS_COMMAND_STREAM)` 으로 `CancelChannelOrder` 를 싣는다(`channel-cancel-request.manager.ts:383-389`, 파티션 키 `channelOrderPartitionKey`). channel-adapter `ChannelOrdersCommandConsumer` → `ChannelOrderCancelManager.execute(command, messageId)` 가 Medusa 를 부르고, **실패만** `ChannelOrderSettlementFailed` 로 낸 뒤 ack 한다(멱등키 `settlement-failed:<requestId>:<deliveryId>:<code>`). 성공이면 `orderPoller.syncOrder(channel, id, { force: true })` 로 즉시 재수집한다 — 성공의 사실은 재수집이 낸다.
- **`ChannelOrderSettlementFailed.scope` 는 `z.enum(['full','partial'])`** 이다(`orders.stream.ts:676`). `'return'` 을 더하면 옛 스키마를 가진 소비자가 그 payload 검증에서 throw 한다(PR 5 N1 의 이유와 같다). 그래서 반품 실패는 새 이름이다(N2).
- **명령 스트림의 소비자는 channel-adapter 하나다.** 새 명령 타입을 옛 channel-adapter 가 받으면 `SchemaValidationInterceptor` 가 warn 하고 넘겨 **명령이 ack 되어 사라진다.** 다시 내는 것은 core 크론(Task 9)이다.
- **정산 재발행(취소).** `RetryChannelSettlementRule`(`order-reconcile/rules/retry-channel-settlement.rule.ts`)은 주문 진행 판정(order-progress)의 `cancel_request` 단계에 붙어 돈다. 반품 단계 판정(`return_exchange`)은 아직 옛 반품 표를 읽는다(설계 §5 — PR 10 이 다시 잇는다). 그래서 이 PR 은 리컨실러에 기대지 않는다(N9).
- **Medusa 부분취소(본보기).** `partialCancelOrder`(`workflows/orders/partial-cancel/partial-cancel-order.ts`)가 `orderCancelLockKey` 잠금 안에서 «수정 → 기록(edited) → 환불 → 기록(refunded)»을 하고, 같은 requestId 재호출은 기록의 단계부터 잇는다. 끊긴 확정 수정은 `internal_note` 태그로 찾는다(`ensureNoDanglingEdit`). 배송비 청구는 order edit 안의 `createOrderEditShippingMethodWorkflow(custom_amount)` + 이름 바꾸기(`renameAddedShippingMethod`, «부분취소 배송비»)다. 환불은 `refundOrderPayments({ note, mode, kind })`, 그 앞에 `reconcileOrderWalletRefunds`.
- **Medusa 반품 수령.** `confirmReturnReceiveWorkflow` 는 ① 받은 품목(`RECEIVE_RETURN_ITEM`)만 `return.location_id` 의 재고 level 을 올리고(재고 관리 variant 인데 그 위치 level 이 없으면 throw), ② 주문 변경을 확정한 뒤 `createOrUpdateOrderPaymentCollection` 을 부른다 — 차액이 양수일 때만 NOT_PAID 결제 컬렉션을 만든다. `beginReceiveReturnWorkflow` 는 `internal_note` 를 받고, 끊긴 수령은 `cancelReturnReceiveWorkflow({ return_id })` 로 버린다. **반품 액션의 돈 효과는 코드로 확정하지 못했다:** `RETURN_ITEM`·`RECEIVE_RETURN_ITEM`·`RECEIVE_DAMAGED_RETURN_ITEM` 셋 다 `isDeduction: true` 에 `unit_price × qty` 를 돌려준다(`@medusajs/order/dist/utils/actions/*.js`). 요청 확정 때 이미 `pending_difference` 가 움직이는지, 수령 때 움직이는지가 «돌려줄 돈» 계산을 정한다. Task 1 이 실측으로 못 박는다.
- **택배비 계산.** `calculateShippingFee(policy, lines, postalCode)`(`almond-fulfillment/calculate-shipping-fee.ts`) — `free` 0, `flat` baseFee, `conditional_free` 소계 ≥ 기준이면 0, `per_quantity` baseFee × 수량, 그리고 **지역 추가비는 0원이어도 더한다.** `planShipping`(`partial-cancel/plan-shipping.ts`)은 «부분취소 배송비»와 반품·교환·클레임 배송 방법을 원래 방법에서 뺀다(PR 1). 주문 metadata `partialCancels[*].groupFees` 를 버전 순으로 겹친 것이 «지금 그룹 요금»이다(`priorGroupFees`).
- **외부 환불.** `unresolvedExternalRefund` 는 메모가 `wallet:` 로 시작하는 환불만 «외부»로 센다(`external-refund.ts:30`). 우리 반품 환불 메모(`return-settle:<id>`)는 외부가 아니다 — 반품 정산이 뒤 부분취소를 «외부 환불 미해결»로 막지 않는다.
- **PR 3 의 반품 기록.** `return.metadata.almondReturn`(`load-return-order.ts`)에 `feeBearer` 가 있다. 반품 metadata 는 `orderModule.updateReturns([{ selector: { id }, data: { metadata } }])` 배열형으로만 저장된다(PR 3 실측). 반품 취소(`cancel-order-return.ts`)는 Medusa 상태만 본다 — `received` 면 거절하지만 «창고 도착»은 모른다.
- **실사.** 위치 확인 `assertLocation`(`stocktaking/services/stocktaking.service.ts:399`)을 모든 실사 경로(`:132·214·272·419·772`)가 지난다. 기대 수량은 `ON_HAND` 만 읽는다(`:152·439·825`).
- **역분개.** `StockEventStore.reverseEvent`(`stock-event.store.ts:595`)는 출고 시도 원천 이벤트만 따로 거절한다(`SHIPMENT_DISPATCH_REVERSAL_REQUIRES_RECALL`). 반품 전이는 막지 않는다.
- **옛 `SalesOrderReturned` 생산자.** `store-return-exchange.service.ts:615-690` 의 private 메서드. `readLineQuantities` 의 `completedSetUnits(line, sku => sku.returnConsumed)` 로 «통째로 돌아온 세트 수»를 낸다(PR 5 N5 로 새 기록의 `settled` 도 `returnConsumed` 에 든다). 멱등키 `so-returned:<id>`. 소비자는 ugc 리뷰 적립 회수(`order-cancellation.consumer.ts`).

## 이름 붙은 결정

- **N1. 명령 하나·사실 둘.** core→Medusa 는 `SettleChannelReturn`(명령, `channel-orders.commands.v1`). Medusa→core 는 성공 `ChannelReturnSettled`(재수집 관측, `orders.events.v1`)와 실패 `ChannelReturnSettlementFailed`(channel-adapter 가 직접, 같은 토픽). 취소 정산과 같은 «성공은 재수집이 낸다» 꼴이다.
- **N2. 반품 실패는 새 사실 이름이다** — `ChannelOrderSettlementFailed.scope` enum 을 넓히지 않는다(옛 소비자 throw). 새 이름은 옛 소비자가 warn 하고 넘긴다 → 소비자 선배포 불필요. 명령 `SettleChannelReturn` 도 새 이름이라 옛 channel-adapter 는 warn 하고 ack 한다 — 그 명령은 사라지지만 core 크론이 다시 낸다(N9). 둘 다 개통 전이라 실린 명령이 0 이다.
- **N3. core 의 SKU 항목.** 새 테이블 `customer_return_items` = 반품 줄 × 굳은 구성 SKU. `expected_qty = 줄 수량 × qty_per_unit`. 검수 결과 `accepted_qty`·`rejected_qty`·`held_qty` 는 검수 전 null. PR 5 의 `recordRequested` 가 줄과 함께 만든다. 구성이 없는 줄은 `BadRequestError` — 그런 줄은 배송완료가 0 이라 정상이면 반품이 오지 않는다(위 «세트 구성»). 창고 화면(PR 7)이 바코드를 이 항목 행으로 고른다 — 같은 SKU 가 두 줄에 있어도 서버가 배분을 추측하지 않는다.
- **N4. 도착은 기록 행이 멱등을 진다.** 새 테이블 `customer_return_arrivals(customer_return_item_id, quantity, idempotency_key unique, stock_event_id, …)`. 도착 수량 = 그 행들의 합(칸을 따로 두지 않는다 — 어긋날 칸이 없다). 호출자의 키를 항목마다 `<key>:<itemId>` 로 넓혀 `onConflictDoNothing` 으로 넣고, 새로 넣었을 때만 `returnReceive(idempotencyKey: 'customer-return-arrival:<arrivalId>')` 를 부른다. 이미 있으면 같은 항목·수량인지 보고(다르면 `ConflictError`) 원장을 다시 부르지 않는다. 한 반품이 두 소포로 나눠 와도 된다.
- **N5. 받는 창고 = 첫 도착이 정한 창고, 그 주문을 배송완료한 창고 중 하나여야 한다.** 설계 §4.3 «원래 출고한 창고»를 검증으로 옮긴다. 도착 입력이 `warehouseId` 를 받고(현장 스테이션이 자기 창고를 안다), 그 판매주문의 배송완료 소포(`deliveredParcelsSql`) 상자의 `warehouse_id` 집합에 없으면 `BadRequestError`. 첫 도착이 `customer_returns.warehouse_id` 를 쓰고, 다음 도착은 같은 창고여야 한다.
- **N6. 검수는 반품 하나에 한 번, 전부 도착한 뒤에.** 입력은 항목마다 `accepted`·`rejected`·`held`, 합 = 도착 수량 = 기대 수량. 원장은 양품 → `returnAccept`, 불량·보류 → `returnReject`(설계 §4.3, 키 `customer-return-inspect:<itemId>:accept|reject`). 보류가 하나라도 있으면 `held`(명령 없음, PR 6b 가 연다), 아니면 `inspected` + 명령. 이미 검수한 반품에 같은 결과가 다시 오면 그대로 돌려주고(더블클릭·재시도), 다른 결과면 `ConflictError`.
- **N7. 부분 도착은 이 PR 에서 검수를 거절한다** — `BadRequestError('아직 도착하지 않은 수량이 있습니다…')`. 설계 §4.3 의 «도착분만 정산하고 나머지는 CS 가 닫는다»는 PR 6b 의 «미도착으로 닫기»가 연다.
- **N8. Medusa 에 알리는 줄 단위 결과.** 줄마다 `dismissed = min(줄 수량, max over 그 줄의 SKU 항목 ceil(rejected / qty_per_unit))`, `received = 줄 수량 − dismissed`. 세트 한 벌은 구성품이 하나라도 불량이면 불량이다(설계 §4.3). 이 값은 돈을 바꾸지 않는다 — 수령·폐기 둘 다 환불 대상이고 금액이 같다(설계 §4.4-1, Task 1 이 확인). Medusa 재고 level 만 받은 수량만큼 오른다(아래 N15).
- **N9. 재발행은 core 크론이다, 리컨실러가 아니다.** `@CronOnce('*/5 * * * *', { name: 'customer-return-settlement-retry' })`. 정산 상태 `in_progress` 이고 마지막 발행이 5분 넘었으면 같은 requestId 로 다시 낸다(멱등키 `customer-return-settle:<id>:issue:<n>`). 12번(약 1시간) 내고도 안 끝나면 `stalled` 로 멈추고 error 로그 — 사람 일이다(PR 6b 목록). 영구 거절(`refused`)은 크론이 건드리지 않는다. 리컨실러는 주문 진행 판정의 반품 단계가 새 기록을 읽기 전(PR 10)까지 붙일 자리가 없다.
- **N10. 수령까지 끝난 반품도 전체취소를 계속 막는다**(PR 3 숙제의 답). Medusa 전체취소는 «캡처 − 환불»을 다 돌려준다 — 반품 정산이 뺀 택배비까지 돌려준다. 그리고 반품이 있는 주문은 배송완료가 있어 core 가 운영자 전체취소를 부분취소로 바꾸고(`cancelScope`, `convertedFromFull`), 고객은 출고 뒤 취소할 수 없다 — 이 막음에 걸리는 정상 호출은 없다. 동작은 그대로 두고 Task 4 가 «정산 끝난 반품 → 전체취소 400»을 테스트로 못 박는다.
- **N11. Medusa 반품 취소는 core 에 도착을 묻는다**(PR 3 숙제의 답). core 자격 API(`POST /internal/sales-orders/return-eligibility`) 응답에 `customerReturns: [{ channelReturnId, status }]` 를 더하고, 반품 취소가 그 반품의 core 상태가 `expected` 가 아니면(`cancelled` 제외) `return_arrived` 로 거절한다. core 에 기록이 없으면(관측 지연 ≤ 5분) 통과 — 그 사이 도착은 있을 수 없다(도착 명령이 기록을 요구한다). 이게 없으면 도착 뒤 CS 가 Medusa 반품을 취소할 수 있고, core 는 `ChannelReturnCancelled` 를 `ConflictError` 로 DLQ 에 보낸다(PR 5).
- **N12. PR 4 숙제 둘은 서버에서 막는다.** ① 실사 `assertLocation` 이 `system_role = 'return_default'` 칸을 거절한다 — 그 칸의 수량은 반품 검수와 이어지는 평범한 이동이 정리한다. ② `reverseEvent` 가 `RETURN_RECEIVE`·`RETURN_ACCEPT`·`RETURN_REJECT` 를 `ConflictException`(code `RETURN_EVENT_REVERSAL_NOT_ALLOWED`)으로 거절한다 — 반품 기록이 그 이벤트의 주인이다. 서랍의 버튼은 그대로 둔다(누르면 거절 문구가 뜬다).
- **N13. 택배비 규칙(설계 D4·§4.4-2 를 계산식으로).** 부담 주체 `seller` 면 차감 0. `customer` 면 세 몫:
  - **반품 택배비** — 이번 반품이 닿은 배송 그룹마다 한 번: `free` 정책 0, 그 밖은 `calculateShippingFee({ ...policy, type: 'flat' }, [{ subtotal: 0, quantity: 1 }], postalCode)`(= baseFee + 지역 추가비). `per_quantity` 도 한 번(설계).
  - **무료배송 깨짐** — 남는 수량이 있는 그룹: `planShipping` 을 «남는 수량»(주문 수량 − 이전 반품 수령·폐기 − 이번 반품)으로 돌린 «올라감»(newFee − currentFee).
  - **왕복** — 남는 수량이 0 이 된 그룹: 정책이 `conditional_free` 일 때만 `max(0, flatFee − currentFee)`(처음 면제한 기본요금). `flat`·`per_quantity` 는 이미 냈고, `free` 그룹은 판매자가 늘 무료로 정한 것이라 0.
  - **줄어드는 배송비는 돌려주지 않는다** — 물건은 이미 배송됐다(부분취소의 «내려감 환불»과 다르다).
  - 합은 이번 «돌려줄 돈»을 넘지 않는다. 넘치면 반품 택배비 → 깨짐 → 왕복 순으로 채운다.
  - 스냅샷이 없거나 그룹이 맞지 않거나 배송비 할인이 붙은 주문(`planShipping` 의 `adjustable: false` 사유)은 차감 0 + `feeNotAdjusted: true` — 고객에게 불리하지 않은 쪽. CS 가 PR 6b 보류 정산으로 다룬다.
- **N14. Medusa 정산의 단계와 장부.** 진행 기록 `return.metadata.almondReturnSettlement`(PR 3 의 `almondReturn` 과 다른 키 — 요청 기록 읽기가 그대로 남는다). 단계 `received`(수령 확정) → `charged`(택배비 주문 수정 확정, 차감 0 이면 건너뜀) → `refunded`. **차감은 수령 «뒤»의 order edit 에 «반품 택배비» 배송 방법(`custom_amount`)으로 남긴다** — 수령 전에 넣으면 차액이 잠깐 양수가 돼 NOT_PAID 결제 컬렉션이 생긴다(위 «Medusa 반품 수령» ②). 그 뒤 차액 = −(돌려줄 돈 − 차감)이고 환불이 그 만큼이라 장부가 맞는다. 이 방법은 다음 부분취소의 배송비 판정에서 빠져야 한다 — `planShipping` 의 «부분취소 배송비» 구분을 «정산 청구 이름 둘»로 넓힌다. 기록의 `groupFees` 는 부분취소 기록과 같이 겹친다(반품 뒤 부분취소가 깨짐을 다시 빼지 않게).
- **N15. Medusa 재고는 다시 맞추지 않는다.** 수령 확정이 Medusa 재고 level 을 양품만큼 올리지만, channel-adapter 재고 동기화가 core 값으로 절대값 덮어쓰기를 한다(설계 §4.4-4). 그 사이 잠깐 많게 보일 수 있다 — Merge Danger 에 적는다.
- **N16. 외부 환불이 미해결이면 정산을 거절한다** — `return_settle_rejected` / reason `external_refund_unresolved`(영구 거절). wallet 에서 직접 낸 환불이 있는 주문에 반품 환불을 더 내면 이중 환불이다. 상계는 PR 6b 선환불과 함께 연다.
- **N17. 정산 결과의 상태.** `ChannelReturnSettled`(환불까지 끝, auto·manual 무관) → `settled`. manual(wallet «송금 대기»)도 `settled` 다 — 취소 정산이 manual 을 `applied` 로 닫는 것과 같다(설계 §4.3 은 manual 을 `refund_pending` 에 뒀다 — 고친다). `ChannelReturnSettlementFailed` 가 `received: true`(수령은 확정, 환불만 남음)면 `inspected → refund_pending`. 실패 사실은 순서 없이 와도 `at` 이 더 늦은 것만 적는다(취소 정산과 같다).

## Global Constraints

- 사는 곳: `packages/event-contracts`, `apps/medusa`, `apps/channel-adapter`, `apps/core`(테이블 둘 + 칼럼 여섯 + 마이그 하나), 문서(설계 §4.3·§4.4·§8, `apps/channel-adapter/CLAUDE.md`).
- 마이그: `npm run db:generate:core -- --name add-customer-return-receiving`. **expand, `migrate → deploy`.** 새 enum 값 없음.
- core 레이어: 컨트롤러·소비자·크론 → `CustomerReturnService`(위임만) → manager(검증·쓰기·이벤트). 트랜잭션은 `dbService.run(fn, tx)`, 공개 메서드 마지막 인자 `tx?: DbTx`. `@InjectTypedDb<typeof wmsSchema>()`. `db.query.*`·`any`·`as` 금지. 오류는 `@app/shared` 의 `NotFoundError`·`BadRequestError`·`ConflictError`.
- 라우트 권한: 도착·검수 `@RequirePermission('inventory.stock.operate')`, 조회 `@RequirePermission('order.claim.read')`. 데코레이터 묶음은 같은 일을 하는 `purchase-order.controller.ts:274-286` 수령 라우트를 따른다. 새 권한 키는 없다. 응답에 고객 개인정보를 싣지 않는다(PII 선언 불필요).
- 멱등 키 모양(전부 이 계획이 정한다):
  - 도착 행 `<호출자 키>:<customerReturnItemId>`, 원장 `customer-return-arrival:<arrivalId>`
  - 검수 원장 `customer-return-inspect:<customerReturnItemId>:accept|reject`
  - 명령 아웃박스 `customer-return-settle:<customerReturnId>:issue:<n>`(n = 1 부터)
  - Medusa 요청 키 = core `customer_returns.id`. 환불 메모 `return-settle:<requestId>`, 주문 변경 태그 `return-receive:<requestId>`·`return-fee:<requestId>`
  - 실패 사실 `return-settlement-failed:<requestId>:<deliveryId>:<code(120자까지)>`
  - 고객 이벤트 `so-claim:return:<id>:collected|completed`(기존 함수), `so-returned:<id>`
- 관측 키: `return:<returnId>:settled`.
- 응답 계약(Medusa 정산 라우트)은 부분취소와 같은 모양: 200 / 400 `{ type: 'not_allowed', code: 'return_settle_rejected', reason, message }` / 400 `{ code: 'wallet_refund_refused:<code>', stage: 'received' }` / 502 `{ type: 'refund_pending', stage: 'received' }` / 그 밖 500(일시).
- 게이트:
  - `npm run type-check` 0.
  - `npx jest packages/event-contracts apps/channel-adapter/src apps/core/src/modules/sales-order apps/core/src/modules/inventory scripts/security libs/cron-once` 실패 0(통합은 skip). 기존 실패(admin-web 근태 4건 — ICU)는 이 범위 밖이다.
  - core 통합: scratch DB 에 `DATABASE_URL` 주입, `--runInBand`(같은 DB 통합 스펙은 병렬 안전하지 않다). 로컬 core DB 는 마이그 이력이 어긋나 공용 러너가 migrate 에서 멈춘다(PR 3~5 와 같다).
  - `(cd apps/medusa && npm run test:unit)` 실패 0. Medusa 통합: `scripts/local/run-medusa-integration.sh --testPathPattern '<패턴>'`(postgres·redis 둘 다, 패턴은 `'http/return-settle\.spec'` 처럼 escape — 워크트리 경로에 `return` 이 든다).

## Review Focus

1. **같은 검수를 두 번 보낸다**(더블클릭·앱 재시도). 원장 이벤트는 항목·종류마다 1개, `SettleChannelReturn` 아웃박스 1행, 두 번째 응답은 첫 번째와 같다. 결과가 다르면 409. — Task 7 통합.
2. **한 반품이 두 소포로 나눠 도착한다.** 도착 두 번 → 도착 행 2, `RETURNED` 합 = 기대, `collected` 고객 이벤트 1. 기대를 넘는 세 번째 도착은 거절, 원장 그대로. 다른 창고로 온 두 번째 도착도 거절. — Task 7 통합.
3. **수령은 됐는데 환불이 실패했다가 다시 온다.** Medusa 가 502(`refund_pending`)를 낸 뒤 같은 requestId 재호출 → 수령을 두 번 하지 않고(주문 변경 `return-receive:` 확정 1개), 택배비 방법도 1개, 환불만 나간다. core 는 `refund_pending` 을 거쳐 `settled`. — Task 4(Medusa) + Task 9(core).
4. **무료배송 주문을 단순 변심으로 전량 반품한다.** 조건부 무료(50,000 / 3,000) 그룹, 30,000×2 전량 → 차감 = 반품 택배비 3,000 + 왕복 3,000, 환불 = 60,000 − 6,000. 같은 주문을 «하자»로 반품하면 차감 0, 환불 60,000. 1개만 변심 반품하면 반품비 3,000 + 깨짐 3,000. — Task 3 단위 + Task 4 통합(전량 한 갈래).
5. **반품 정산 뒤 같은 주문의 부분취소.** «반품 택배비» 방법이 원래 방법으로 읽히지 않는다(`NO_SNAPSHOT`·`GROUP_MISMATCH` 로 멈추지 않는다), 반품이 이미 뺀 깨짐을 다시 빼지 않는다. — Task 3 단위(`planShipping` 거르기·groupFees 겹치기) + Task 4 통합 한 갈래.

---

### Task 1: 전제 실측 — Medusa 반품 수령·폐기·택배비 주문 수정의 돈과 재고

코드 변경 없이 스펙 하나다. **빨가면 멈추고 응답 본문과 함께 보고한다** — Task 3·4 의 «돌려줄 돈» 계산이 바뀐다.

**Files:**
- Create: `apps/medusa/integration-tests/http/return-settlement-premises.spec.ts`

**Interfaces:**
- Consumes: PR 3 의 `requestOrderReturn`, `return-request.spec.ts` 의 주문 준비 꼴(배송완료 2개 줄·반품 옵션·사유 시드·core 자격 목). 주문은 재고 관리 variant 로 만든다.

- [ ] **Step 1: 스펙 작성** — 30,000원 줄 하나 수량 2, 반품 2개(단순 변심) 요청까지 PR 3 꼴로 만든 뒤:
  - `it('반품 요청 확정은 pending_difference 를 바꾸지 않는다')` — 요청 전후 `loadOrderView(...).pendingDifference` 가 같다. (다르면 «돌려줄 돈»의 기준점이 요청 때다 — 멈춘다.)
  - `it('수령 1·폐기 1 확정 뒤 pending_difference 가 -60,000 만큼 움직이고 NOT_PAID 결제 컬렉션이 없다')` — `beginReceiveReturnWorkflow({ return_id, internal_note: 'return-receive:t1' })` → `receiveItemReturnRequestWorkflow(1)` → `dismissItemReturnRequestWorkflow(1)` → `confirmReturnReceiveWorkflow`. 반품 `status 'received'`, 재고 level 은 반품 위치에서 +1(양품만).
  - `it('수령 뒤 order edit 으로 3,000 배송 방법을 더하면 차액이 -57,000 이고 NOT_PAID 결제 컬렉션이 없다')` — 부분취소와 같은 `beginOrderEditOrderWorkflow` → `createOrderEditShippingMethodWorkflow({ custom_amount: 3000 })` → request → confirm.
  - `it('수령 확정이 주문 updated_at 을 민다')` — 확정 전 `GET /admin/orders/:id?fields=id,updated_at` 값보다 뒤.
- [ ] **Step 2: 실행** — `scripts/local/run-medusa-integration.sh --testPathPattern 'http/return-settlement-premises\.spec'` → PASS. 빨가면 멈추고 보고한다.
- [ ] **Step 3: Commit** — `test(medusa): 반품 수령·폐기·택배비 주문 수정의 차액·결제 컬렉션·재고를 못 박는다 (K8 PR6)`

### Task 2: 계약 — `SettleChannelReturn` 명령, `ChannelReturnSettled`·`ChannelReturnSettlementFailed` 사실

**Files:**
- Modify: `packages/event-contracts/streams/channel-orders-command.stream.ts`
- Modify: `packages/event-contracts/streams/orders.stream.ts`
- Test: `packages/event-contracts/streams/orders.stream.spec.ts`, `packages/event-contracts/streams/__tests__/`(명령 스트림 spec 이 있는 자리 — 없으면 `channel-orders-command.stream.spec.ts` 를 만든다)

**Interfaces:**
- Produces:
  - `interface SettleChannelReturnPayload { requestId: string; salesChannel: string; externalOrderId: string; returnId: string; items: Array<{ channelOrderItemId: string; received: number; dismissed: number }>; refundMode?: ChannelCancelRefundMode; requestedAt: string }`. 주석: `requestId` 는 core `customer_returns.id`(Medusa 멱등 키), `received`·`dismissed` 는 판매 단위.
  - `interface ReturnSettlementDeduction { returnShipping: number; freeShippingBreak: number; roundTrip: number }` (원, 0 이상 정수).
  - `interface ChannelReturnSettledPayload { orderId: string; salesChannel: SalesChannel; externalOrderId: string; returnId: string; requestId: string; refundAmount: number; deduction: ReturnSettlementDeduction; feeNotAdjusted: boolean; refundMode: ChannelCancelRefundMode; settledAt: string; items: SettleChannelReturnPayload['items'] }`.
  - `interface ChannelReturnSettlementFailedPayload { requestId: string; salesChannel: string; externalOrderId: string; returnId: string; received: boolean; retryable: boolean; failureCode: string; message: string; at: string }`. 주석: `received` = Medusa 수령은 확정됐고 환불만 남았다. 판매주문 id 를 싣지 않는다(`ChannelOrderSettlementFailed` 와 같은 이유).
  - 스트림 `events` 에 셋. 명령 스키마: `items.min(1)`, 수량 `int().nonnegative()`, 줄마다 `received + dismissed > 0`, 같은 줄 두 번 금지(`CancelChannelOrderSchema` 의 superRefine 꼴).

- [ ] **Step 1: 실패하는 테스트**
  - 명령: 정상 parse 통과. `items: []`, `received: 0, dismissed: 0` 인 줄, 같은 `channelOrderItemId` 두 번, `requestedAt` 이 ISO 아님은 각각 throw.
  - `ChannelReturnSettled`: 정상 통과, `refundAmount: -1`·`deduction.roundTrip: 1.5`·`salesChannel` 누락은 throw.
  - `ChannelReturnSettlementFailed`: 정상 통과, `received` 누락 throw.
- [ ] **Step 2: 실행** — `npx jest packages/event-contracts` → 새 케이스 FAIL.
- [ ] **Step 3: 구현** — 스키마는 `z.object`(이 파일들 관례).
- [ ] **Step 4: 실행** — 같은 명령 PASS, `npm run type-check` 0.
- [ ] **Step 5: Commit** — `feat(event-contracts): 반품 정산 명령과 정산 성공·실패 사실 (K8 PR6)`

### Task 3: Medusa — 반품 택배비 계획(순수 함수)과 «정산 청구» 구분 넓히기

**Files:**
- Create: `apps/medusa/src/workflows/orders/returns/plan-return-fees.ts`
- Create: `apps/medusa/src/workflows/orders/settlement/group-fees.ts`
- Modify: `apps/medusa/src/workflows/orders/partial-cancel/plan-shipping.ts` (`RETURN_FEE_CHARGE_NAME`, `SETTLEMENT_CHARGE_NAMES`, `ShippingMethodView.isPartialCancelCharge` → `isSettlementCharge`)
- Modify: `apps/medusa/src/workflows/orders/settlement/load-order-view.ts` (`toShippingMethodView` 이 새 칸을 채운다)
- Modify: `apps/medusa/src/workflows/orders/partial-cancel/partial-cancel-order.ts` (`priorGroupFees` 가 `mergeGroupFees` 를 쓰고, 반품 정산 기록의 `groupFees` 도 겹친다)
- Test: `apps/medusa/src/workflows/orders/returns/__tests__/plan-return-fees.unit.spec.ts`, `settlement/__tests__/group-fees.unit.spec.ts`, 기존 `plan-shipping` 단위 스펙(이름 바꾼 칸)

**Interfaces:**
- Produces:
  - `export const RETURN_FEE_CHARGE_NAME = '반품 택배비'`, `export const SETTLEMENT_CHARGE_NAMES: readonly string[] = [PARTIAL_CANCEL_CHARGE_NAME, RETURN_FEE_CHARGE_NAME]`. `ShippingMethodView.isSettlementCharge: boolean`(이름이 둘 중 하나). `planShipping` 은 `isSettlementCharge` 인 방법을 원래 방법에서 뺀다.
  - `export function mergeGroupFees(records: Array<{ orderVersion: number; groupFees: Record<string, number> }>): PriorGroupFees` — 버전 오름차순으로 겹친다(나중 것이 이긴다). 부분취소의 `priorGroupFees` 가 이것으로 바뀐다.
  - `returns/return-settlement-record.ts`: `RETURN_SETTLEMENT_METADATA_KEY = 'almondReturnSettlement'`, `readReturnSettlementRecord(metadata: unknown): ReturnSettlementRecord | null`(모양이 하나라도 어긋나면 null — PR 3 `readReturnRequestRecord` 와 같은 태도), `loadReturnSettlementRecords(container: MedusaContainer, orderId: string): Promise<ReturnSettlementRecord[]>`(그 주문 반품들의 기록 중 읽히는 것). `ReturnSettlementRecord` 칸:

    | 칸 | 뜻 |
    | --- | --- |
    | `requestHash` | `items` 정렬 해시 — 같은 requestId 다른 품목은 거절 |
    | `stage` | `'received' \| 'charged' \| 'refunded'` |
    | `items` | `Array<{ itemId; received; dismissed }>` 정렬 |
    | `owed` | 수령이 만든 «돌려줄 차액»(원, 반올림) |
    | `deduction` · `feeNotAdjusted` | 택배비 계획 결과(cap 적용 뒤) |
    | `refundAmount` | `owed − deduction 합` |
    | `groupFees` · `orderVersion` | 수령 확정 뒤 주문 버전 — 부분취소 기록과 겹친다 |
    | `receivedAt` · `refundedAt?` · `refundMode?` | |
  - `export function planReturnFees(input: { feeBearer: 'customer' | 'seller'; methods: ShippingMethodView[]; lines: Array<ShippingLineView & { returnedNow: number }>; postalCode: string | null; priorGroupFees: PriorGroupFees; chargeCap: number }): ReturnFeePlan`. `lines[].newQty` = 남는 수량(주문 − 이전 반품 수령·폐기 − 이번 반품), `returnedNow` = 이번 반품 수량.
  - `type ReturnFeePlan = { feeNotAdjusted: boolean; deduction: ReturnSettlementDeduction; total: number; groupFees: Record<string, number> }`. `groupFees` 는 깨짐·왕복이 올린 그룹의 «이 반품 뒤 그룹 요금»(currentFee + 그 그룹 몫)만 — 반품 택배비는 그룹 요금이 아니다. `ReturnSettlementDeduction` 은 Task 2 와 같은 칸(Medusa 는 계약을 import 하지 않으므로 같은 모양을 이 파일에 둔다).
  - 규칙은 N13 그대로. `seller` → `{ feeNotAdjusted: false, deduction 0·0·0, total 0, groupFees {} }`. 그룹·스냅샷 판정은 `planShipping` 에 맡긴다(`chargeCap: Number.MAX_SAFE_INTEGER` 로 돌려 «올라감»만 읽고, `adjustable: false` 면 `feeNotAdjusted: true`·전부 0).

- [ ] **Step 1: 실패하는 단위 테스트** — `plan-return-fees.unit.spec.ts`. 주문 A·B(30,000×각 1), 조건부 무료 정책(기준 50,000, 기본 3,000, 제주 +3,000) 그룹 하나, 배송 방법 amount 0:
  - `it('판매자 사유는 차감 0')`.
  - `it('변심 1개 반품 → 반품비 3,000 + 깨짐 3,000')` — `deduction { returnShipping: 3000, freeShippingBreak: 3000, roundTrip: 0 }`, `groupFees { [profile]: 3000 }`.
  - `it('변심 전량 반품 → 반품비 3,000 + 왕복 3,000')` — 30,000×2 한 줄로도 같은 값(Review Focus 4).
  - `it('제주 주소는 반품비·왕복에 지역 추가비가 붙는다')` — 반품비 6,000, 왕복 3,000(처음 낸 지역 추가비 3,000 을 뺀 기본요금).
  - `it('free 그룹은 0, flat 그룹 전량 반품은 왕복 0')`, `it('per_quantity 그룹은 반품비 baseFee 한 번, 줄어드는 배송비는 돌려주지 않는다')`.
  - `it('두 그룹에 걸친 반품은 그룹마다 반품비')`.
  - `it('합이 chargeCap 을 넘으면 반품비 → 깨짐 → 왕복 순으로 채운다')` — cap 4,000 → `3000/1000/0`.
  - `it('앞선 부분취소가 이미 그룹 요금을 올렸으면 깨짐을 다시 빼지 않는다')` — `priorGroupFees { [profile]: 3000 }` → 깨짐 0.
  - `it('스냅샷이 없으면 feeNotAdjusted, 차감 0')`.
  - `group-fees.unit.spec.ts`: 버전 순 겹치기(역순 입력도 같은 결과).
  - `plan-shipping` 스펙: `it('반품 택배비 방법은 원래 방법이 아니다')` — 그 이름의 방법(스냅샷 없음)이 섞여도 `adjustable: true`(Review Focus 5).
- [ ] **Step 2: 실행** — `(cd apps/medusa && npx jest src/workflows/orders/returns src/workflows/orders/settlement src/workflows/orders/partial-cancel)` → 새 케이스 FAIL.
- [ ] **Step 3: 구현** — 위 Interfaces 대로. 이름 바꾼 칸을 읽는 곳은 `grep -rn isPartialCancelCharge apps/medusa/src` 로 전부 고친다.
- [ ] **Step 4: 실행** — 같은 명령 PASS, `(cd apps/medusa && npm run test:unit)` 실패 0, `npm run type-check` 0.
- [ ] **Step 5: Commit** — `feat(medusa): 반품 택배비 계획과 정산 청구 구분 — 반품 택배비 방법은 다음 부분취소가 원래 방법으로 읽지 않는다 (K8 PR6)`

### Task 4: Medusa — 반품 정산 워크플로와 라우트

**Files:**
- Create: `apps/medusa/src/workflows/orders/returns/settle-order-return.ts`
- Create: `apps/medusa/src/workflows/orders/settlement/order-edit-charge.ts` (부분취소의 «배송비 방법 더하고 이름 바꾸기 + 끊긴 수정 찾기»를 꺼낸다 — 부분취소도 이것을 쓴다)
- Create: `apps/medusa/src/api/admin/orders/[id]/returns/[return_id]/settle/route.ts` + `parse-input.ts`
- Modify: `apps/medusa/src/workflows/orders/partial-cancel/partial-cancel-order.ts` (꺼낸 함수를 부른다 — 동작 그대로)
- Test: `apps/medusa/integration-tests/http/return-settle.spec.ts`, 꺼낸 함수 단위 스펙은 기존 부분취소 통합이 지킨다

**Interfaces:**
- Consumes: Task 3 의 `planReturnFees`·`loadReturnSettlementRecords`·`ReturnSettlementRecord`·`RETURN_FEE_CHARGE_NAME`, PR 3 의 `readReturnRequestRecord`(`feeBearer`), settlement 의 `loadOrderView`·`refundOrderPayments`·`reconcileOrderWalletRefunds`·`orderCancelLockKey`, `unresolvedExternalRefund`.
- Produces:
  - `export async function addSettlementCharge(container: MedusaContainer, input: { orderId: string; tag: string; shippingOptionId: string; amount: number; name: string; actorId?: string }): Promise<void>` — order edit 열기(`internal_note: tag`) → 배송 방법 추가 → 이름 바꾸기 → request → confirm. 확정 전 실패는 수정을 버린다.
  - `export async function ensureNoDanglingChange(container, orderId: string, tag: string, onOpen: () => Promise<void>): Promise<void>` — 이 태그의 확정된 주문 변경이 있으면 throw(«진행 기록 없는 확정 — 두 번 하면 두 번 빠진다, 수동 확인»), 열린 것이 있으면 `onOpen()`. 부분취소의 `ensureNoDanglingEdit` 가 이것으로 바뀐다.
  - 기록 쓰기는 `orderModule.updateReturns([{ selector: { id }, data: { metadata: { ...기존, [RETURN_SETTLEMENT_METADATA_KEY]: record } } }])` 배열형(PR 3 실측 — 다른 꼴은 metadata 가 저장되지 않는다).
  - `export type SettleOrderReturnInput = { orderId: string; returnId: string; requestId: string; items: Array<{ itemId: string; received: number; dismissed: number }>; refundMode?: RefundMode; actorId?: string }`.
  - `export type SettleOrderReturnResult = { returnId: string; requestId: string; refundAmount: number; deduction: ReturnSettlementDeduction; feeNotAdjusted: boolean; refund: { mode: RefundMode; amount: number }; stage: 'refunded' }`.
  - `export async function settleOrderReturn(container, input): Promise<SettleOrderReturnResult>` — `orderCancelLockKey` 잠금 안.
  - 오류 셋: `ReturnSettleRejected(reason, message)`(정해진 거절), `ReturnSettleRefundPending(requestId, message)`, `ReturnSettleRefundRefused(requestId, refusalCode, message)`.
- 흐름(기록의 단계부터 잇는다):
  1. 반품을 읽는다(`return.order_id`·`status`·`metadata`·`items`). 주문이 다르거나 없으면 `ReturnOrderNotFound`(404). 우리 요청 기록이 없으면 `not_our_return`, 취소된 반품은 `return_canceled`. 기록의 해시가 다르면 `request_id_conflict`. 기록이 `refunded` 면 결과를 그대로 돌려준다.
  2. **기록이 없을 때만**: 품목 집합이 반품 품목과 같고 줄마다 `received + dismissed = 반품 품목 수량`인지(아니면 `items_mismatch`). `reconcileOrderWalletRefunds` → 미해결 외부 환불이 있으면 `external_refund_unresolved`(N16). `ensureNoDanglingChange(tag 'return-receive:<requestId>', open → cancelReturnReceiveWorkflow)`. 수령: begin(`internal_note`) → 받은 품목 receive → 폐기 품목 dismiss → confirm. `owed = round(차액 전 − 차액 후)`(Task 1 이 정한 기준). 그다음 택배비 계획 — `chargeCap: owed` 가 필요해서 수령 «뒤»에 돈다. 주문을 다시 읽어 남는 수량 = 줄 수량 − `return_received_quantity` − `return_dismissed_quantity`(이번 반품이 이미 들어 있다 — 또 빼지 않는다), `returnedNow` = 이번 입력. 기록 `received` 를 쓴다.
  3. `received` 이고 차감 합 > 0 이면 `addSettlementCharge(tag 'return-fee:<requestId>', name RETURN_FEE_CHARGE_NAME, shippingOptionId = 차감이 닿은 첫 그룹의 원래 방법 옵션)` — 그 전에 같은 태그 `ensureNoDanglingChange`. 기록 `charged`. 차감 0 이면 곧장 `charged`.
  4. `refundOrderPayments({ amount: refundAmount, note: 'return-settle:<requestId>', mode, kind: 'RETURN' })`. wallet 영구 거절 → `ReturnSettleRefundRefused`, 그 밖 → `ReturnSettleRefundPending`. 성공 → 기록 `refunded`(`refundedAt`·`refundMode`).
  - 부분취소의 `priorGroupFees` 입력에 `loadReturnSettlementRecords` 를 더한다(Task 3 에서 이미 했으면 그대로).
- 라우트 `POST /admin/orders/:id/returns/:return_id/settle` — 본문 `{ requestId, items: [{ item_id, received, dismissed }], refundMode? }`. 응답은 Global Constraints 의 계약(거절은 `reason` 칸에 위 코드).

- [ ] **Step 1: 실패하는 통합 테스트** — `return-settle.spec.ts`. 주문 준비는 Task 1 과 같은 꼴, 결제는 `partial-cancel-settlement.spec.ts` 의 wallet 목 꼴.
  - `it('변심 1개 수령 → 반품비·깨짐을 빼고 환불, 반품 received, 결과 200')` — 조건부 무료 주문 A·B 중 A 1개. 환불 메모 `return-settle:<requestId>`·kind `RETURN`, `refundAmount = 30,000 − 6,000`, 주문에 «반품 택배비» 방법 6,000, NOT_PAID 결제 컬렉션 0.
  - `it('하자 전량 폐기 → 차감 0, 환불 전액')`.
  - `it('변심 전량 → 반품비 + 왕복')`(Review Focus 4 의 통합 한 갈래).
  - `it('같은 requestId 두 번 → 환불 1, 수령 주문 변경 1, 두 번째 결과 같음')`.
  - `it('환불이 502 로 끊긴 뒤 같은 requestId → 수령·택배비를 다시 하지 않고 환불만')` — wallet 목이 첫 호출을 5xx 로(Review Focus 3).
  - `it('wallet 영구 거절 → 400 wallet_refund_refused:<code>, stage received')`.
  - `it('품목이 반품과 다르거나 수량 합이 다르면 400 items_mismatch, 주문 그대로')`, `it('취소된 반품 → 400 return_canceled')`, `it('같은 requestId 다른 품목 → 400 request_id_conflict')`, `it('wallet 직접 환불이 있는 주문 → 400 external_refund_unresolved')`.
  - `it('정산 끝난 반품이 있는 주문의 전체취소 → 400, 환불 0')`(N10 — PR 3 숙제).
  - `it('반품 정산 뒤 다른 품목 부분취소가 배송비를 다시 빼지 않는다')`(Review Focus 5).
- [ ] **Step 2: 실행** — `scripts/local/run-medusa-integration.sh --testPathPattern 'http/return-settle\.spec'` → FAIL.
- [ ] **Step 3: 구현** — 위 Interfaces·흐름대로. 부분취소에서 꺼낸 함수는 이름만 옮기고 동작을 바꾸지 않는다.
- [ ] **Step 4: 실행** — 같은 명령 PASS. `--testPathPattern 'http/(partial-cancel|channel-cancel|return-)'` 전부 PASS(부분취소·전체취소·PR 3 반품 회귀). `(cd apps/medusa && npm run test:unit)` 실패 0, `npm run type-check` 0.
- [ ] **Step 5: Commit** — `feat(medusa): 반품 정산 — 수령 확정, 사유가 정하는 택배비 차감, RETURN 환불을 단계 기록과 함께 (K8 PR6)`

### Task 5: channel-adapter — 정산 명령 실행, 실패 사실, 정산 관측

**Files:**
- Create: `apps/channel-adapter/src/services/order-cancel/channel-return-settle.manager.ts` (+ spec)
- Modify: `apps/channel-adapter/src/services/order-cancel/channel-order-cancel.repository.ts` (`recordReturnSettlementFailure`)
- Modify: `apps/channel-adapter/src/consumers/channel-orders-command.consumer.ts` (`@On(CHANNEL_ORDERS_COMMAND_STREAM, 'SettleChannelReturn')`)
- Modify: `apps/channel-adapter/src/adapters/medusa/medusa.client.ts` (`settleReturn`, `MedusaReturnSettleOutcome`)
- Modify: `apps/channel-adapter/src/services/order-collection/medusa-return-observations.ts` (`return:<id>:settled`)
- Modify: `channel-order-source.interface.ts`·`channel-order-provider.interface.ts`·`order-poller.orchestrator.ts`·`order-event-routing.ts` (PR 5 가 두 관측을 더한 자리에 셋째)
- Modify: `apps/channel-adapter/CLAUDE.md` (§4 스트림 표 — 소비하는 명령·내는 사실)
- Test: `medusa-return-observations.spec.ts`, `order-poller.orchestrator.spec.ts`, `medusa.client` 응답 분류 spec(부분취소 분류 spec 이 있는 파일)

**Interfaces:**
- Consumes: Task 2 계약, Task 4 라우트 응답.
- Produces:
  - `MedusaClient.settleReturn(orderId: string, returnId: string, input: { requestId: string; items: Array<{ itemId: string; received: number; dismissed: number }>; refundMode: ChannelCancelRefundMode }): Promise<MedusaReturnSettleOutcome>`.
  - `type MedusaReturnSettleOutcome = { kind: 'settled' } | { kind: 'rejected'; reason: string; message: string } | { kind: 'refund_refused'; failureCode: string; message: string } | { kind: 'refund_pending'; message: string } | { kind: 'not_found'; message: string } | { kind: 'transient'; failureCode: string; message: string }`. 분류는 `partialCancelOrder` 와 같은 순서(본문으로 502 를 가린다).
  - `ChannelReturnSettleManager.execute(command: SettleChannelReturnPayload, deliveryId: string): Promise<void>` — 채널 검사·수집 확인은 취소 매니저와 같다(`channel_not_supported`·`order_not_collected`). 결과 → 실패 사실:

    | 결과 | retryable | received | failureCode |
    | --- | --- | --- | --- |
    | rejected | false | false | `return_settle_rejected:<reason>` |
    | refund_refused | false | true | Medusa code 그대로 |
    | refund_pending | true | true | `refund_pending` |
    | not_found | false | false | `not_found` |
    | transient | true | false | 그대로 |

    성공이면 `orderPoller.syncOrder('medusa', externalOrderId, { force: true })`. 사실 적재 실패만 던진다.
  - 관측: 반품 metadata 의 `almondReturnSettlement.stage === 'refunded'` 이고 반품 status 가 `received`·`partially_received` 면 `ChannelReturnSettled` 관측 하나(eventKey `return:<id>:settled`). payload 는 기록에서(`requestId`·`refundAmount`·`deduction`·`feeNotAdjusted`·`refundMode`·`settledAt = refundedAt`·`items` 를 `channelOrderItemId` 로). 기록 모양이 어긋나면 skipped `no_settlement_record` + warn. 순서는 같은 반품의 requested 뒤.

- [ ] **Step 1: 실패하는 테스트**
  - `channel-return-settle.manager.spec.ts`: 위 표의 다섯 결과 → `recordReturnSettlementFailure` 인자(특히 `received`). 성공 → 사실 0, `syncOrder(force)` 1. 다른 채널 → `channel_not_supported`.
  - 분류 spec: 200 → settled, 400 `return_settle_rejected` → rejected(reason), 400 `wallet_refund_refused:X` → refund_refused, 502 본문 `refund_pending` → refund_pending, 본문 없는 502 → transient `http_502`, 네트워크 → transient `network`.
  - `medusa-return-observations.spec.ts`: `it('정산 끝난 반품 → requested 다음 settled')`, `it('received 단계 기록은 settled 를 내지 않는다')`.
  - 오케스트레이터: `ChannelReturnSettled` 관측 → enqueue payload 에 채널 키, 두 번 처리해도 한 번.
- [ ] **Step 2: 실행** — `npx jest apps/channel-adapter/src` → 새 케이스 FAIL.
- [ ] **Step 3: 구현** — 위 Files 대로. 실패 사실 멱등키는 Global Constraints.
- [ ] **Step 4: 실행** — 같은 명령 PASS, `npm run type-check` 0.
- [ ] **Step 5: Commit** — `feat(channel-adapter): 반품 정산 명령을 Medusa 에 실행하고 실패는 사실로, 성공은 재수집 관측으로 (K8 PR6)`

### Task 6: core 스키마 — SKU 항목·도착 기록·정산 칸 + 마이그, 접수가 항목을 만든다

**Files:**
- Modify: `apps/core/src/modules/inventory/schema/inventory.schema.ts` (`customerReturns` 칸 여섯, 새 테이블 둘, `wmsTables`)
- Create: `apps/core/drizzle/<timestamp>_add-customer-return-receiving.sql` + `drizzle/meta/` (생성물)
- Modify: `apps/core/src/modules/sales-order/customer-return/customer-return.types.ts`
- Modify: `apps/core/src/modules/sales-order/customer-return/customer-return-transition.ts` (`set` 의 Pick 을 넓힌다)
- Modify: `apps/core/src/modules/sales-order/customer-return/customer-return.manager.ts` (`recordRequested` 가 항목을 넣는다)
- Test: `customer-return.manager.integration.spec.ts`(케이스 추가), `customer-return.types.spec.ts`

**Interfaces:**
- Produces:
  - `customerReturns` 새 칸: `warehouseId` uuid FK `warehouses.id` restrict null · `arrivedAt`·`inspectedAt`·`settledAt` timestamptz null · `settlement` jsonb `$type<CustomerReturnSettlement>()` null · `settlementOutcome` jsonb `$type<CustomerReturnSettlementOutcome>()` null.
  - `customerReturnItems`(`customer_return_items`): `id` uuid pk · `customerReturnLineId` FK `customerReturnLines.id` cascade notNull · `skuId` FK `skus.id` restrict notNull · `qtyPerUnit` int notNull · `expectedQty` int notNull check `> 0` · `acceptedQty`·`rejectedQty`·`heldQty` int null. unique `(customer_return_line_id, sku_id)`. check: 셋이 모두 null 이거나 모두 0 이상.
  - `customerReturnArrivals`(`customer_return_arrivals`): `id` uuid pk · `customerReturnItemId` FK cascade notNull · `quantity` int check `> 0` · `idempotencyKey` varchar(255) notNull **unique** · `stockEventId` uuid null · `arrivedBy` varchar(255) null · `arrivedAt` timestamptz defaultNow. 인덱스 `(customer_return_item_id)`.
  - `customer-return.types.ts`:
    - `type CustomerReturnSettlement = { state: 'in_progress' | 'refused' | 'stalled' | 'done'; refundMode: 'auto' | 'manual'; startedAt: string; lastIssuedAt: string; attempts: number; lastFailure: { code: string; message: string; retryable: boolean; received: boolean; at: string } | null }`.
    - `type CustomerReturnSettlementOutcome = { refundAmount: number; deduction: ReturnSettlementDeduction; feeNotAdjusted: boolean; refundMode: 'auto' | 'manual'; settledAt: string }` (`ReturnSettlementDeduction` 은 계약에서 import — 타입 파일은 스키마 파일이 아니라 `@packages` import 가 된다).
    - `type CustomerReturnItem`·`CustomerReturnArrival` = `InferSelectModel`.
  - `transitionCustomerReturn` 의 `set`: `Partial<Pick<CustomerReturn, 'cancelledAt' | 'warehouseId' | 'arrivedAt' | 'inspectedAt' | 'settledAt' | 'settlement' | 'settlementOutcome'>>`.
  - `recordRequested`: 줄을 넣은 뒤 줄마다 `sales_order_line_compositions` 를 읽어 항목을 넣는다(`expectedQty = 줄 수량 × qty_per_unit`). 구성이 없는 줄이 하나라도 있으면 아무것도 쓰기 «전»에 `BadRequestError`(N3) — 줄 해석과 같은 자리에서 검사한다.

- [ ] **Step 1: 실패하는 통합 테스트** — `customer-return.manager.integration.spec.ts`:
  - `it('접수가 SKU 항목을 만든다 — 세트 A×2·B×1 줄 1벌이면 A 2·B 1')`.
  - `it('구성 없는 줄이 섞인 접수 → BadRequestError, 기록·줄·항목·이벤트 0')`.
  - 기존 13 케이스가 그대로 초록.
- [ ] **Step 2: 실행** — `DATABASE_URL=<scratch> npx jest apps/core/src/modules/sales-order/customer-return --runInBand` → FAIL.
- [ ] **Step 3: 스키마 → `npm run db:generate:core -- --name add-customer-return-receiving`** — 생성 SQL 이 `ALTER TABLE customer_returns ADD COLUMN` 여섯·`CREATE TABLE` 둘·FK·check·unique·index 만인지 읽는다. 다른 객체 변경이 섞이면 `git rm` 하고 원인을 보고한다.
- [ ] **Step 4: 빈 DB 부트스트랩** — scratch DB 에서 `npx drizzle-kit migrate --config apps/core/drizzle.config.ts` → `migrations applied successfully`.
- [ ] **Step 5: 구현 → 실행** — Step 2 PASS, `npm run type-check` 0.
- [ ] **Step 6: Commit** — 스키마 + SQL + meta + 코드 한 커밋: `feat(core): 반품 SKU 항목·도착 기록·정산 칸, 접수가 항목을 만든다 (K8 PR6)`

### Task 7: core — 도착·검수 명령과 수령 알림 명령

**Files:**
- Create: `apps/core/src/modules/sales-order/customer-return/customer-return-receiving.manager.ts`
- Create: `apps/core/src/modules/sales-order/customer-return/customer-return-settle-command.ts` (순수 `toSettleItems` + `enqueueSettleChannelReturn`)
- Create: `apps/core/src/modules/sales-order/customer-return/customer-return.reader.ts` (`CustomerReturnView` 조회)
- Create: `apps/core/src/modules/sales-order/customer-return/customer-returns.controller.ts` + `dto/`
- Modify: `customer-return.service.ts` (위임 셋), `sales-order.module.ts` (providers·controller, `InventoryCommandService` 를 주는 모듈 import)
- Modify: 보안 목록 — `npx jest scripts/security` 가 요구하는 줄(IDOR 리뷰 목록의 줄 좌표 등)
- Test: `customer-return-receiving.manager.integration.spec.ts`(`describeIfDb`), `customer-return-settle-command.spec.ts`

**Interfaces:**
- Consumes: Task 6 테이블·타입, PR 4 `InventoryCommandService.returnReceive|returnAccept|returnReject`, `enqueueSalesOrderClaimProgress`, Task 2 명령 계약, `deliveredParcelsSql`.
- Produces:
  - `type CustomerReturnView = { id; salesOrderId; channelReturnId; status: CustomerReturnStatus; reason; feeBearer; requestedBy; warehouseId: string | null; requestedAt; arrivedAt; inspectedAt; settledAt: string | null; settlement: CustomerReturnSettlement | null; settlementOutcome: CustomerReturnSettlementOutcome | null; lines: Array<{ id; salesOrderLineId; channelOrderItemId; quantity; items: Array<{ id; skuId; qtyPerUnit; expectedQty; arrivedQty; acceptedQty: number | null; rejectedQty: number | null; heldQty: number | null }> }> }` — 개인정보 없음. `CustomerReturnReader.findById(id, tx?)`(없으면 `NotFoundError`).
  - `CustomerReturnReceivingManager.recordArrival(input: { customerReturnId: string; warehouseId: string; items: Array<{ customerReturnItemId: string; quantity: number }>; idempotencyKey: string; actorId: string }, tx?: DbTx): Promise<CustomerReturnView>`.
  - `CustomerReturnReceivingManager.recordInspection(input: { customerReturnId: string; items: Array<{ customerReturnItemId: string; accepted: number; rejected: number; held: number }>; actorId: string }, tx?: DbTx): Promise<CustomerReturnView>`.
  - `export function toSettleItems(lines: Array<{ channelOrderItemId: string; quantity: number; items: Array<{ qtyPerUnit: number; rejectedQty: number }> }>): SettleChannelReturnPayload['items']` — N8.
  - `export async function enqueueSettleChannelReturn(publisher: PublisherFor<typeof CHANNEL_ORDERS_COMMAND_STREAM>, tx: DbTx, p: { customerReturnId: string; salesOrderId: string; channelReturnId: string; items: SettleChannelReturnPayload['items']; refundMode: 'auto' | 'manual'; issue: number }): Promise<void>` — 판매주문의 채널·주문번호를 읽어 명령을 싣는다(멱등키·파티션 키는 Global Constraints·`channelOrderPartitionKey`). Task 9 의 재발행이 같은 함수를 쓴다.
  - 라우트(`@Controller('admin/customer-returns')`): `GET :id` → view, `POST :id/arrivals` 본문 `{ warehouseId, items: [{ customerReturnItemId, quantity }], idempotencyKey }`, `POST :id/inspection` 본문 `{ items: [{ customerReturnItemId, accepted, rejected, held }] }`. 중첩 DTO 는 별도 클래스, 수량 `@IsInt() @Min(0)`(도착은 `@Min(1)`).
- 규칙:
  - **잠금:** 둘 다 `customer_returns` 행을 `for update` 로 먼저 잡는다(같은 반품의 도착·검수가 겹치지 않게).
  - **도착:** 상태 `expected`·`arrived` 만(그 밖 `ConflictError`). 창고 N5. 항목은 그 반품의 것이어야 하고(`BadRequestError`), N4 대로 행 → 원장. `도착 합 + 이번 수량 > expectedQty` 면 `BadRequestError`(아무것도 안 씀). 첫 도착이면 `transitionCustomerReturn(expected → arrived, set { warehouseId, arrivedAt })` + `enqueueSalesOrderClaimProgress({ kind: 'return', stage: 'collected', requestId: <id>, requestedBy: <operator → admin>, occurredAt })`.
  - **검수:** N6·N7. 모든 항목이 정확히 한 번씩 와야 한다. `inspected` 로 갈 때 `settlement = { state: 'in_progress', refundMode: 'auto', startedAt: now, lastIssuedAt: now, attempts: 1, lastFailure: null }` 를 같은 전이의 `set` 으로 쓰고 `enqueueSettleChannelReturn(issue 1)`. `held` 면 명령·정산 칸 없음.
  - 상태가 이미 `inspected` 이후(`held` 포함)면: 저장된 항목 결과가 입력과 같으면 view 를 돌려주고, 다르면 `ConflictError`.

- [ ] **Step 1: 실패하는 테스트**
  - `customer-return-settle-command.spec.ts`: `toSettleItems` — 단품 2개 중 불량 1 → received 1·dismissed 1. 세트(A×2·B×1) 2벌, B 불량 1 → dismissed 1·received 1. A 불량 3 → dismissed 2(ceil(3/2)). 불량 0 → 전부 received.
  - `customer-return-receiving.manager.integration.spec.ts`(픽스처: 배송완료 소포가 있는 판매주문 + PR 5 기록 + 항목. 창고에 `return_default` 위치):
    - `it('첫 도착 → arrived, RETURNED 원장, collected 이벤트 1')`.
    - `it('두 소포로 나눠 도착 → 도착 행 2, collected 1, 합 초과 세 번째는 거절')`(Review Focus 2).
    - `it('같은 키로 도착 두 번 → 행 1·원장 이벤트 1, 다른 수량이면 409')`.
    - `it('배송완료하지 않은 창고로 도착 → BadRequest', '첫 도착과 다른 창고 → BadRequest')`.
    - `it('취소된 반품에 도착 → Conflict')`.
    - `it('검수 양품 1·불량 1 → inspected, ON_HAND 1·DEFECTIVE 1, SettleChannelReturn 1(received 1·dismissed 1), 정산 칸 in_progress')`.
    - `it('검수에 보류가 있으면 held, 명령 0, 보류 수량은 DEFECTIVE')`.
    - `it('부분 도착 상태의 검수 → BadRequest, 원장 그대로')`(N7).
    - `it('같은 검수 두 번 → 원장 이벤트·명령 각 1, 같은 응답 / 다른 결과 → Conflict')`(Review Focus 1).
    - `it('합이 도착 수량과 다른 검수 → BadRequest')`.
  - 라우트: 컨트롤러 spec 이 이 모듈에 있는 꼴이면 위임만 확인. `npx jest scripts/security` 와 `route-classification`·`permission` 가드가 초록.
- [ ] **Step 2: 실행** — `DATABASE_URL=<scratch> npx jest apps/core/src/modules/sales-order/customer-return --runInBand` → FAIL.
- [ ] **Step 3: 구현** — 위 Interfaces·규칙대로. 원장 메서드가 던지는 Nest 예외는 그대로 둔다(전역 필터가 상태로 바꾼다).
- [ ] **Step 4: 실행** — Step 2 PASS, `npx jest scripts/security apps/core/src/modules/sales-order` 실패 0, `npm run type-check` 0.
- [ ] **Step 5: Commit** — `feat(core): 반품 도착·검수 명령 — 원장 RETURNED·검수 전이, 수령 알림 명령, collected 고객 이벤트 (K8 PR6)`

### Task 8: core — 실사는 반품 칸을 받지 않고, 반품 전이는 역분개를 거절한다

**Files:**
- Modify: `apps/core/src/modules/inventory/stocktaking/services/stocktaking.service.ts` (`assertLocation`)
- Modify: `apps/core/src/modules/inventory/core/repositories/stock-event.store.ts` (`reverseEvent`)
- Test: 실사·역분개 통합 스펙이 있는 파일(`grep -rln "assertLocation\|reverseEvent" apps/core/src --include=*.integration.spec.ts`)에 케이스 추가

**Interfaces:**
- `assertLocation`: 위치의 `systemRole === 'return_default'` 면 `BadRequestException('반품 검수 칸은 실사할 수 없어요. 이 칸의 수량은 반품 검수가 정리해요.')`. 그 밖의 시스템 위치는 그대로.
- `reverseEvent`: 원 이벤트 `transitionType` 이 `RETURN_RECEIVE`·`RETURN_ACCEPT`·`RETURN_REJECT` 면 출고 원천 거절 바로 뒤에서 `ConflictException({ code: 'RETURN_EVENT_REVERSAL_NOT_ALLOWED', message: '반품 입고·검수 이벤트는 되돌릴 수 없습니다 — 반품 기록이 이 수량의 주인입니다' })`. 응답 모양은 같은 함수의 `shipmentDispatchReversalConflict` 를 따른다.

- [ ] **Step 1: 실패하는 테스트** — `it('return_default 위치를 실사에 넣으면 거절')`, `it('일반 위치는 그대로 실사된다')`, `it('RETURN_RECEIVE 이벤트 역분개 → 409 RETURN_EVENT_REVERSAL_NOT_ALLOWED, 원장 그대로')`, `it('RECEIVE 이벤트 역분개는 그대로 된다')`.
- [ ] **Step 2: 실행** — 해당 통합 스펙을 scratch DB 로 → FAIL.
- [ ] **Step 3: 구현**.
- [ ] **Step 4: 실행** — PASS, `npx jest apps/core/src/modules/inventory` 실패 0.
- [ ] **Step 5: Commit** — `fix(core): 실사는 반품 검수 칸을 받지 않고, 반품 입고·검수 이벤트는 역분개를 거절한다 (K8 PR6, PR4 이월)`

### Task 9: core — 정산 결과를 받아 닫고, 일시 실패를 다시 낸다

**Files:**
- Create: `apps/core/src/modules/sales-order/customer-return/customer-return-settlement.manager.ts`
- Create: `apps/core/src/modules/sales-order/customer-return/customer-return-settlement-retry.cron.ts`
- Create: `apps/core/src/modules/sales-order/common/sales-order-returned.ts` (옛 서비스의 `SalesOrderReturned` 줄 계산·적재를 꺼낸다)
- Modify: `apps/core/src/modules/sales-order/services/store-return-exchange.service.ts` (private 메서드가 새 함수를 부른다 — 동작 그대로)
- Modify: `apps/core/src/modules/sales-order/consumers/order-events.consumer.ts` (핸들러 둘)
- Modify: `customer-return.service.ts`, `sales-order.module.ts`
- Test: `customer-return-settlement.manager.integration.spec.ts`, 크론 단위 spec, `libs/cron-once` 가드가 초록인지

**Interfaces:**
- Consumes: Task 2 사실 둘, Task 6 칸, Task 7 `enqueueSettleChannelReturn`·`toSettleItems`, `enqueueSalesOrderClaimProgress`.
- Produces:
  - `export async function enqueueSalesOrderReturned(publisher: PublisherFor<typeof CORE_ORDER_STREAM>, tx: DbTx, p: { salesOrderId: string; returnRequestId: string; reason: SalesOrderReturnedPayload['reason']; reasonDetail?: string; returnedAt: Date; lines: Array<{ salesOrderLineId: string; channelOrderItemId: string | null; orderedQuantity: number }> }): Promise<void>` — 옛 본문 그대로(`completedSetUnits` 로 `returnedQuantity`, `remainingQuantity`, 0 줄 빼기, 멱등키 `so-returned:<id>`, 줄이 다 빠지면 warn 하고 안 낸다).
  - `CustomerReturnSettlementManager.recordSettled(fact: ChannelReturnSettledPayload, tx?: DbTx): Promise<{ changed: boolean }>` — 기록을 `channelReturnId` 로 찾는다(없으면 `NotFoundError`). 이미 `settled` 면 `{ changed: false }`. `transitionCustomerReturn(['inspected','refund_pending'] → settled, set { settledAt, settlementOutcome, settlement: { …, state: 'done' } })`, false 면 `ConflictError`. 같은 트랜잭션에서 `SalesOrderClaimProgressed(stage 'completed')` 와 `enqueueSalesOrderReturned`(reason = 기록 reason, lines = 반품 줄).
  - `CustomerReturnSettlementManager.recordSettlementFailed(fact: ChannelReturnSettlementFailedPayload, tx?: DbTx): Promise<{ changed: boolean }>` — 기록이 `inspected`·`refund_pending` 이 아니면 `{ changed: false }`(이미 닫힘 — 늦은 실패). `fact.at` 이 `settlement.lastFailure.at` 보다 이르면 무시. `lastFailure` 를 쓰고 `state` = `retryable ? 'in_progress' : 'refused'`. `received && status === 'inspected'` 면 `→ refund_pending`(N17).
  - `CustomerReturnSettlementManager.reissueStalled(now: Date, tx?: DbTx): Promise<number>` — `status in ('inspected','refund_pending')`·`settlement->>'state' = 'in_progress'`·`(settlement->>'lastIssuedAt')::timestamptz <= now − 5분` 인 행을 `for update skip locked` 로 잡아, `attempts < 12` 면 `enqueueSettleChannelReturn(issue attempts+1)` 하고 `attempts`·`lastIssuedAt` 를 민다. `attempts >= 12` 면 `state 'stalled'` + error 로그. 수는 돌려준다.
  - 크론: `@CronOnce('*/5 * * * *', { name: 'customer-return-settlement-retry' })` → `service.reissueStalled(new Date())`. 주기 상수 `CUSTOMER_RETURN_SETTLEMENT_RETRY_MS = 5 * 60_000`, `CUSTOMER_RETURN_SETTLEMENT_MAX_ISSUES = 12` 는 manager 파일에.
  - 소비자: `@On(ORDER_STREAM, 'ChannelReturnSettled')`(`@RetryPolicy({ nonRetryableErrors: [NotFoundError, BadRequestError] })`), `@On(ORDER_STREAM, 'ChannelReturnSettlementFailed')`. `order_events` 에 적지 않는다(PR 5 와 같은 이유).

- [ ] **Step 1: 실패하는 통합 테스트** — `customer-return-settlement.manager.integration.spec.ts`(픽스처는 Task 7 의 `inspected` 상태까지 만든다):
  - `it('settled 사실 → settled, 결과 칸, completed·SalesOrderReturned 이벤트 각 1')` — `SalesOrderReturned.returnedLines[0].returnedQuantity` 가 반품 수량.
  - `it('같은 settled 두 번 → 이벤트 각 1, 두 번째 changed false')`.
  - `it('received 실패 → refund_pending, 뒤이은 settled → settled')`(Review Focus 3 의 core 갈래).
  - `it('영구 거절 → refused, 크론이 건드리지 않는다')`.
  - `it('순서가 뒤바뀐 실패(이른 at) → 무시')`.
  - `it('크론: 5분 지난 in_progress → 명령 재발행(issue 2), 1분 된 것은 그대로')`, `it('12번 낸 뒤 → stalled')`.
  - 옛 반품 완료 스펙(`grep -rln "SalesOrderReturned" apps/core/src --include=*.spec.ts`)이 그대로 초록.
- [ ] **Step 2: 실행** — `DATABASE_URL=<scratch> npx jest apps/core/src/modules/sales-order/customer-return --runInBand` → FAIL.
- [ ] **Step 3: 구현** — 위 Interfaces 대로. 옛 서비스의 private 메서드는 새 함수만 부른다.
- [ ] **Step 4: 실행** — Step 2 PASS, `npx jest apps/core/src/modules/sales-order libs/cron-once` 실패 0, `npm run type-check` 0.
- [ ] **Step 5: Commit** — `feat(core): 반품 정산 결과로 반품을 닫고 completed·SalesOrderReturned, 일시 실패는 크론이 다시 낸다 (K8 PR6)`

### Task 10: 반품 취소가 core 에 도착을 묻는다 + 설계 문서

**Files:**
- Modify: `apps/core/src/modules/sales-order/internal/return-eligibility.ts`·`return-eligibility.reader.ts`·`return-eligibility.dto.ts` (`customerReturns`)
- Modify: `apps/medusa/src/workflows/orders/returns/core-return-eligibility.ts` (파싱 — 칸이 없으면 `[]`)
- Modify: `apps/medusa/src/workflows/orders/returns/cancel-order-return.ts` (`return_arrived`)
- Modify: `docs/superpowers/specs/2026-10-26-k8-returns-on-medusa-design.md`
- Test: `return-eligibility.reader.integration.spec.ts`(케이스), `apps/medusa/integration-tests/http/return-cancel.spec.ts`(케이스), `core-return-eligibility` 단위 스펙

**Interfaces:**
- core 응답 `ReturnEligibilityResponse.customerReturns: Array<{ channelReturnId: string; status: CustomerReturnStatus }>` — 그 주문의 반품 예정 기록 전부. `found: false` 면 `[]`.
- Medusa `CoreReturnEligibility.customerReturns: Array<{ channelReturnId: string; status: string }>`. 옛 core(칸 없음)면 `[]` — 그러면 지금처럼 통과한다.
- `cancelOrderReturn`: 반품 기록 확인 뒤, 주문 변경을 건드리기 «전»에 `fetchCoreReturnEligibility`. 그 반품의 core 상태가 있고 `expected`·`cancelled` 가 아니면 `ReturnRequestRejected('return_arrived', '창고에 도착한 반품은 취소할 수 없습니다')`. core 가 응답하지 않으면 요청과 같은 `CoreEligibilityUnavailable`(502).

- [ ] **Step 1: 실패하는 테스트** — core: `it('자격 응답에 반품 예정 기록의 상태를 싣는다')`. Medusa 통합: `it('core 가 arrived 라고 하면 반품 취소 400 return_arrived, 반품 그대로')`, `it('core 에 기록이 없으면 지금처럼 취소된다')`. 단위: 칸 없는 응답 → `[]`.
- [ ] **Step 2: 실행** — core 통합(scratch DB) + `scripts/local/run-medusa-integration.sh --testPathPattern 'http/return-cancel\.spec'` → FAIL.
- [ ] **Step 3: 구현**.
- [ ] **Step 4: 실행** — PASS. `--testPathPattern 'http/return-'` 전부 PASS.
- [ ] **Step 5: 설계 문서 고치기**:
  - §8 표: PR 6 행의 «무엇»을 «도착·검수 명령 + 수령 알림 명령 + Medusa 정산(수령·택배비·환불) + 정산 관측·고객 이벤트»로, 새 행 «6b | CS 문 셋: 환불 보류 정산·선환불·미도착 닫기, 영구 거절 정산의 다시 시도·계좌 송금 | core · medusa · channel-adapter |». 표 아래 문장 «PR 6 의 정산 라우트에는 보류 정산·선환불 모드가 같이 들어간다»를 «PR 6b 가 …»로.
  - §4.3·§4.4 끝에 «**PR 6 에서 확정한 결과.**» 블록 — N1·N2(사실·명령 이름, 소비자 선배포 불필요), N3·N4(SKU 항목·도착 기록), N5(받는 창고 검증), N7(부분 도착은 PR 6b), N9(크론 재발행), N13(택배비 계산식 — §4.4-2 를 이 식으로), N14(수령 뒤 order edit 로 차감), N17(manual 도 settled — §4.3 사다리 문장을 고친다), N10·N11(PR 3 숙제의 답).
- [ ] **Step 6: Commit** — `feat: 반품 취소가 core 에 도착을 묻는다, 설계에 PR6 결과와 6b 분할 (K8 PR6)`

---

## Merge Danger (PR 본문용 메모)

- **배포:** core 는 expand(`ALTER TABLE ADD COLUMN` 여섯·`CREATE TABLE` 둘), `migrate → deploy`. 이벤트·명령은 전부 새 이름이라 소비자 선배포가 필요 없다(N2). 옛 channel-adapter 가 롤링 중 `SettleChannelReturn` 을 ack 해 잃어도 core 크론이 5분 뒤 다시 낸다. 개통 전이라 실릴 명령이 0 이다.
- 🔴 **배포 직전 라이브 `select count(*) from customer_returns` 가 0 인지 본다** — 0 이 아니면 그 행들에는 SKU 항목이 없다(접수가 항목을 만드는 것은 이 PR 부터). 그런 반품은 도착 명령이 «항목 없음»으로 거절한다.
- **동작 변경:**
  - 실사에 `return_default` 위치를 넣으면 거절된다. 라이브에서 그 칸을 실사하는 운영이 있는지 배포 전 `stocktaking_lines` 를 그 위치로 집계해 본다.
  - 반품 입고·검수 이벤트는 이력 서랍에서 되돌릴 수 없다(라이브 0행).
  - Medusa 반품 취소가 core 를 한 번 부른다 — core 가 응답하지 않으면 반품 취소가 502.
  - «반품 택배비» 배송 방법이 주문에 붙을 수 있다 — 부분취소는 그것을 원래 방법으로 읽지 않는다.
- **Medusa 재고:** 반품 수령이 Medusa 재고 level 을 양품만큼 올린다. 다음 재고 동기화가 core 값으로 덮을 때까지 잠깐 많게 보일 수 있다(N15).
- **롤백:** 이전 task definition 으로 돌려도 안전하다 — 옛 코드는 새 칸·테이블을 안 읽고, 새 명령·사실은 warn 으로 넘긴다. 반품이 `inspected` 에 멈출 뿐 돈은 나가지 않는다.
- 배포 뒤 확인: ① `customer_returns`·`customer_return_items` 0행 ② core 로그에 `customer-return-settlement-retry` 크론 실행(5분마다, 0건) ③ channel-adapter 로그에 `SettleChannelReturn` 처리 오류 없음.
