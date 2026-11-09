# 마켓 고객 취소요청 — 요청 순간 core 가 멈추고, 멈췄으면 마켓에 승인까지 보낸다

상위: #1233 (축 4). #1244(네이버)·#1245(쿠팡)의 «취소요청 주문의 출고 정지 신호» 항목을 이 설계가 맡는다.
관련 ADR: 0042(채널 주문 취소는 채널이 시작, core 는 문지기) · 0044(물리 취소는 요청 순간 core 가 확정, 돈은 채널) · 0049(취소 커널 하나) · 0047(줄 수량 사실).

## 1. 왜

셀메이트를 끊는 날 네이버·쿠팡 주문이 우리 앱으로 넘어온다. 고객이 마켓에서 취소를 요청한 주문이 그대로 포장·출고되면 안 된다.

지금 상태:

- 네이버 수집(`apps/channel-adapter/src/services/order-collection/naver-order.source.ts`)은 **처음 수집할 때** 취소요청(`CANCEL_REQUEST`·`CANCELING`·`ADMIN_CANCELING`)이 붙은 주문을 `paymentState: 'pending'` 으로 돌려 판매주문을 만들지 않는다. **이미 core 에 들어간 주문에 나중에 붙은 취소요청은 아무 신호도 내지 않는다.** 취소는 상품주문이 `CANCELED` 가 된 뒤에야 `OrderCancelled` 로 온다 — 그사이 상자는 계속 나간다.
- 쿠팡은 주문 수집 source 가 없다(#1245). 클레임 조회·처리 클라이언트(`coupang-return.client.service.ts`)는 있지만 부르는 곳이 없다.
- 🔴 네이버는 2024-10-10 부터 상품주문 하나 안에서 **일부 수량만** 취소할 수 있다(이때 상품주문 상태는 `PAYED` 그대로, `claimStatus` 만 `CANCEL_DONE`). 우리 수집은 `quantityClaimCompatibility` 를 보내지 않고 `currentClaim` 을 읽지 않아서, **일부 수량 취소를 못 보고 원래 수량 그대로 출고한다.** 근거: https://github.com/commerce-api-naver/commerce-api/discussions/1773
- 쿠팡 임시 구현 `translateClaimIdToCoupangInfo` 는 `cancelCount: 1` 고정이다(`coupang.adapter.ts`).

## 2. 마켓의 규칙 (2026-11-10 조사)

| | 네이버 | 쿠팡 |
|---|---|---|
| 요청이 생기는 시점 | 발주확인 뒤. 발주확인 전 고객 취소는 판매자 승인 없이 바로 취소완료 | 상품준비중 뒤 «출고중지요청»(`returnRequests` 의 `RU`). 결제완료 단계 취소는 바로 취소(`cancelType=CANCEL` 로 조회) |
| 승인 | `POST /v1/pay-order/seller/product-orders/{productOrderId}/claim/cancel/approve` (클라이언트 `naver-claim.client.ts` `approveCancel` 있음) | `PATCH …/returnRequests/{receiptId}/stoppedShipment` (클라이언트 있음) |
| 거부 | **전용 API 없음.** 송장과 함께 발송처리(`product-orders/dispatch`)하면 거부된다 | «이미출고» `PATCH …/returnRequests/{receiptId}/completedShipment` (택배사·송장 필요, 왕복 배송비 판매자 귀책) |
| 다른 사유로 거부 | 확인된 길 없음 | 확인된 길 없음 |
| 아무도 처리 안 하면 | 4영업일 뒤 자동 환불(주문형 가이드 근거 — 스마트스토어 적용은 미확인) | `releaseStopStatus` 에 «자동처리(이미출고)» 값이 있다. 조건·시간 미확인 |
| 고객 철회 | 미확인 | 반품철회 API(`returnWithdrawRequests`)는 있음. 출고중지요청 철회 가능 여부 미확인 |
| 단위 | 상품주문(`productOrderId`)별, 수량 일부 가능(`currentClaim.cancel.requestQuantity`, `quantityClaimCompatibility=true` 일 때) | 접수번호(`receiptId`) 하나에 `returnItems[]`(`vendorItemId`·`shipmentBoxId`·`cancelCount`), 수량 일부 가능 |

출처: 네이버 공식 Q&A https://github.com/commerce-api-naver/commerce-api/discussions/529 · /701 · /1618 · /1773, 네이버페이 주문형 취소반품교환 가이드 PDF, 쿠팡 https://developers.coupangcorp.com/hc/en-us/articles/360033919613 · /360033793034 · /360022937554 · /360034027374. 쿠팡 문서는 본문을 직접 읽지 못하고 공식 도메인 검색 결과 문구로 확인했다 — 구현 전에 본문으로 다시 확인한다.

**핵심:** 두 마켓 모두 «거부»는 사실상 «이미 보냈다» 하나뿐이다. 이건 core 가 «못 멈춘다»고 판정하는 경우와 겹친다.

## 3. 정해진 것 (사용자, 2026-11-10)

1. **멈춤(보류)이 아니라 요청 순간 취소한다.** 마켓 취소요청을 보면 core 가 우리 쇼핑몰 고객 취소와 같은 판정으로 처리하고, 멈출 수 있으면 그 자리에서 물리 취소한다. 판매자센터 결정을 기다리는 «출고 보류»는 만들지 않는다 — ADR-0044 가 보류 관문을 없앤 이유(끝나지 않는 보류, 출구가 «취소한 고객에게 출고»뿐)가 마켓에도 그대로 적용된다.
2. **«받지 않기» 창을 두지 않는다.** 거부가 맞는 경우(이미 나감·송장이 등록 단계를 넘음·인쇄 제작 중)는 core 판정이 이미 «못 멈춘다»로 가른다.
3. **채널이 알려 주는 줄 취소는 «N개 더 취소»가 아니라 «이 줄의 취소 수량은 이만큼이다»라는 상태로 받는다.** 이미 그만큼 취소돼 있으면 아무것도 안 한다.
4. **core 가 멈춘 요청은 마켓에 승인까지 자동으로 보낸다.** 첫날 «클레임은 판매자센터에서 사람이» 결정(#1233)의 예외다. 이미 실행한 취소를 알리는 것이라 사람 판단이 들어갈 자리가 없고, 쿠팡 «자동처리(이미출고)»와 «승인 깜빡함» 위험이 함께 사라진다.
5. **못 멈춘 요청은 사람 몫이다.** 자동 거부는 첫날 범위 밖이다(아래 §5.4).

## 4. 목표 · 비목표 · 반목표

**목표**

- 이미 수집된 마켓 주문에 고객 취소요청이 붙으면, 멈출 수 있는 줄은 다음 수집 주기 안에 core 에서 취소되고 마켓에 승인이 간다.
- 시작된 배치 안의 상자도 기존 장치로 멈춘다 — 상자 전량 취소는 이탈(해체), 일부 줄 취소는 `recovery_required`(`CANCEL_REPLAN_PENDING`) 대기.
- 못 멈춘 요청과 승인이 영구 실패한 요청은 운영자가 찾을 수 있는 곳에 남는다.
- 네이버 일부 수량 취소가 관측된다.

**비목표**

- 반품·교환 클레임 자동화(첫날 판매자센터 수동 — #1233).
- 쿠팡 «이미출고» 자동 처리, 네이버 거부를 위한 별도 호출(네이버는 우리 정상 발송이 곧 거부다).
- 운영자가 시작하는 마켓 판매자 취소(`cancel: 'seller_center'` 그대로).
- 돈. 환불은 마켓이 한다(ADR-0042 원칙 1). core·channel-adapter 는 wallet 을 부르지 않는다.

**반목표 (기술적으로 돌아도 실패)**

- 고객이 취소요청한 물건이 나간다 — 멈출 수 있었는데.
- core 가 취소했는데 마켓에는 승인이 안 가서, 쿠팡이 «이미출고»로 자동 처리하거나 고객이 며칠 기다린다.
- 같은 줄 취소가 두 번 오는 것(요청 순간 core 취소 → 승인 뒤 수집)이 컨슈머 실패·DLQ·격리로 이어진다.
- core 에 마켓 클레임 식별자(쿠팡 `receiptId` 등)의 의미가 스며든다 — core 는 채널을 모른다.
- 보류 관문(송장 발급·배치 시작·발송 사전검사가 «열린 요청»을 묻는 것)이 되살아난다.

## 5. 흐름

### 5.1 channel-adapter — 요청을 사실로

수집이 이미 core 에 들어간 주문에서 **새** 취소요청을 보면 사실 하나를 낸다: «고객이 이 주문의 이 줄들을 이 수량만큼 취소해 달라고 요청했다».

- 네이버: `claimType=CANCEL` · `claimStatus` 가 요청 계열(`CANCEL_REQUEST` 등)인 상품주문. 수량은 `currentClaim.cancel.requestQuantity`(`quantityClaimCompatibility=true` 로 조회). 수집이 그 칸을 읽도록 고친다.
- 쿠팡: `returnRequests` 의 출고중지요청(`RU`)·`returnItems[].cancelCount`. 쿠팡 주문 source(#1245)가 생길 때 같은 사실을 내도록 붙인다 — 이 설계는 계약과 core·실행부를 만들고, 쿠팡 관측은 #1245 의 source 안에서 한다.
- 사실에는 마켓의 요청 참조를 **불투명한 문자열**로 싣는다. 구현은 칸이 둘이다 — `ChannelCancelRequested.channelRequestRef`(승인 API 의 대상: 네이버 상품주문번호, 쿠팡 `receiptId`)와 `channelRequestKey`(한 요청의 멱등 식별: 네이버 `${productOrderId}:${claimId ?? 'na'}`). core 는 둘 다 해석하지 않는다. 명령은 새로 두지 않고 `CancelChannelOrder` 에 `answers`(`channelRequestRef`·`needsApproval`) 칸을 더했다 — 재발행·실패 사실·정산 화면이 `meta.request.command` 하나로 돈다. core 멱등 키는 `channel-request:` + `channelRequestKey` 다. 같은 요청의 재관측은 같은 키 → core 가 멱등으로 거른다.
- 처음 수집 때부터 요청이 붙은 주문은 지금처럼 판매주문을 만들지 않는다(바꾸지 않는다).

### 5.2 core — 판정과 물리 취소

취소 커널(`apps/core/src/modules/sales-order/order-cancellation/order-cancellation.ts`)에 새 문을 하나 둔다. 고객 취소(`customerGate`)와 같은 판정을 쓴다: `cancelRequests.precheck` + 인쇄 gate + 상자 상태별 처리(`cancelOutstanding` — 배치 전 즉시 취소, 시작된 배치의 상자 전량은 이탈, 일부는 대기, 나간 상자는 거절).

- **멈출 수 있음:** 같은 트랜잭션에서 요청한 줄·수량을 취소하고, 기존 채널 취소 요청 행(`sales_order_amendments`, `CHANNEL_CANCEL_REQUEST`, 상태 `settling`)을 남기고, 승인 명령을 아웃박스에 낸다. 요청 행이 이미 있는 정산 수명주기(재발행·실패 기록·운영자 화면)를 탄다.
- **못 멈춤:** 취소하지 않는다. **core 에 행을 남기지 않는다** — BadRequest 계열 거절과 인쇄 gate 거절은 결과 `not_stoppable` 로 warn 로그만 남기고(`order-cancellation.ts`, `market-cancel-request.integration.spec.ts` 가 지킨다), 인쇄 제작 중 거절은 기존 인쇄 보드에 남는다(`keepOnRefusal` 없이 부른다). 닫을 행이 없는 이유: 네이버는 우리가 그 상자를 발송하면 발송처리가 곧 거부이고, 쿠팡은 «자동처리(이미출고)»가 있어 사람이 닫을 일이 거의 없다. 쿠팡이 사람 손을 요구하면 WING 에서 «이미출고» 처리한다.
- **판정 단위는 마켓의 승인 단위다** — 네이버는 상품주문 하나, 쿠팡은 `receiptId` 하나. 사실 한 건 = 승인 단위 하나, core 의 멱등 키·요청 행 하나도 그 단위다. 고객이 상품주문 셋을 한꺼번에 취소요청했고 그중 하나만 인쇄 제작 중이면, 둘은 취소·승인되고 하나만 «못 멈춤»이다. (Claude 판단 — 승인 API 가 그 단위로만 가므로 더 큰 단위로 묶으면 실행부가 다시 쪼개야 한다)
- **한 승인 단위 안에서 요청 수량 전부를 멈출 수 없으면 그 단위 전체를 «못 멈춤»으로 본다**(일부만 취소하고 승인하는 갈래를 만들지 않는다 — 쿠팡 `receiptId` 안의 여러 품목도 같다). (Claude 판단)
- **core 에 없는 주문의 요청은 조용히 넘긴다**(no-op, 실패 아님). 컷오버 때 네이버 첫 실행은 직전 1시간을 보므로(`FIRST_RUN_LOOKBACK_MS`) 셀메이트가 처리 중인 T 이전 주문의 요청이 들어올 수 있다 — 그건 셀메이트 몫이다. (Claude 판단)
- 인쇄 상품 줄이 섞여 있으면 고객 취소처럼 «인쇄 빼고 취소»를 묻지 않는다 — 묻을 고객이 없다. 인쇄 제작 중이면 그 요청은 «못 멈춤». (Claude 판단)

### 5.3 channel-adapter — 승인 실행

명령을 받아 네이버 `approveCancel` / 쿠팡 `stoppedShipment` 를 부른다.

- **성공은 사실로 내지 않는다.** 다음 수집이 취소완료를 가져오는 것이 사실이다(ADR-0042 원칙 4).
- **영구 실패**(마켓이 거절)는 기존 정산 실패 사실 경로로 돌려보낸다 → 요청 행이 `refused` → 운영자에게 «판매자센터에서 승인 필요».
- **일시 실패**는 ack 하고, 다시 부르는 곳은 core 리컨실러 하나다(ADR-0044 결정 3, `retry-channel-settlement.rule.ts`).
- 마켓이 «이미 승인됨»으로 답하면(사람이 판매자센터에서 먼저 눌렀다) 성공으로 본다.
- **승인 실행은 관찰 모드로 먼저 나간다.** channel-adapter 환경 스위치 `CHANNEL_CANCEL_APPROVAL_MODE`(`act` 일 때만 마켓을 부르고, 그 밖·미설정은 관찰 — `customer-cancel-approver.ts` 머리 주석)가 «승인을 부를지, 불렀을 것이라고 기록만 할지»를 가른다. 관찰 모드는 로그만 남기고 **영구 실패**(`failureCode: 'approval_observe_mode'`, `retryable: false`)로 끝낸다 → 요청 행 `refused` → 기존 정산 화면의 «판매자센터에서 승인 필요». 리컨실러가 같은 명령을 계속 재발행하지 않게 하려는 것이다. 관찰 모드에서도 core 의 물리 취소는 돈다 — 그러면 첫날 원래 결정(사람이 판매자센터에서 승인)과 같은 상태가 된다. 실 주문 한 건으로 끝까지 확인한 뒤 실행 모드로 바꾼다. 이 저장소의 다른 자동 외부 쓰기(리컨실러·대사)와 같은 순서다. (Claude 판단)

### 5.3a «못 멈춤» 요청 — 닫을 행이 없다 (구현에서 바뀐 것)

초안은 «못 멈춤» 요청을 행으로 남기고 수집 관측(`CANCEL_REJECT`·`releaseStopStatus`·클레임 소멸)으로 닫으려 했다. §5.2 대로 행을 남기지 않기로 해서 **이 관측 닫기는 만들지 않았다.** 사람이 손으로 닫는 버튼도 만들지 않는다.

- 그래도 마켓이 취소를 확정하는 경우(네이버 자동 환불·사람의 판매자센터 승인)에는 지금 있는 채널 취소 수신 경로를 탄다 — 인쇄 줄은 커널이 와우프레스 거절을 보드에 남기고(`receiveChannelCancellation`), 출고된 줄은 판매주문 취소의 출고 뒤 후속 효과로 남는다.
- 수집된 취소가 마켓 요청 행이 있는 상태에서 core 에 거절당하면(seller_center 경로), core 는 아직 취소할 수 있는 만큼만 취소하고(수량을 잔량으로 clamp) 나머지는 warn 으로 남긴다. 400 계열 거절만 삼키고 그 밖은 그대로 던진다(`order-cancellation.ts`).

### 5.4 수집된 취소완료 — 상태로 받기

승인 뒤 수집이 줄 취소를 가져오면 core 는 «이 줄의 채널 취소 수량 = X»로 받아, 이미 X 만큼 취소돼 있으면 아무것도 안 하고 모자라면 그 차이만 취소한다. 그리고 그 요청 행을 `applied` 로 닫는다. 마켓 요청 행은 줄마다 `cancelledBefore`(요청 순간 그 줄의 기취소 수량)를 들고, 모든 줄의 채널 누적 취소 수량이 `cancelledBefore + quantity` 이상이 되면 닫는다(`channel-cancel-settler.ts` `settleLinesCancelled`).

지금 줄 단위 `OrderCancelled` 는 «N개 취소»로 해석되고, 이미 취소된 줄이면 `cancelQuantityExceedsMessage` 400 을 던진다(`sales-orders.service.ts` `cancelBeforeBoxingPartial`). 전체취소는 이미 취소됐으면 조용히 넘어간다 — 부분도 그렇게 만든다. 또 `cancelForChannel` 은 지금 «줄 단위 취소(마켓)는 요청과 무관»하다며 요청 행을 닫지 않는다 — 마켓 요청 행을 닫도록 바꾼다.

네이버 수집은 일부 수량 취소(`PAYED` + `CANCEL_DONE`)도 줄 취소로 낸다. 이때 싣는 수량은 **그 줄의 누적 취소 수량**이다. 지금 `cancelledLines[].quantity` 의 뜻(«이번에 취소된 수량»으로 읽힌다)과 겹치지 않게 의미를 계약에 분명히 적는다 — 칸을 새로 둘지 뜻을 고정할지는 빌더 몫이되, 소비자(core)를 먼저 배포할 수 있는 모양이어야 한다.

### 5.5 채널 능력

core `CHANNEL_CANCELLATION_CAPABILITIES` 와 channel-adapter `CHANNEL_CAPABILITIES` 에 «고객 취소요청에 승인을 보낼 수 있는가» 축을 더한다(네이버·쿠팡 예, Medusa 는 비대상 — Medusa 고객 취소는 core 가 직접 받는다). 두 표의 parity spec 이 이 축도 지킨다. 채널 이름 비교로 가르지 않는다.

## 6. 제약

- 레이어·트랜잭션·이벤트 규칙은 루트 `CLAUDE.md` 그대로. core 는 직접 발행하지 않는다(`enqueue`). 커널 밖에서 취소 순서를 조립하지 않는다(ADR-0049).
- 이벤트 계약 변경은 **소비자 먼저 배포**(이벤트 계약 zod 검증은 소비자에서 throw 한다). 사실 계약은 core 가, 명령 계약은 channel-adapter 가 소비자다.
- 테넌트: 사실·명령 모두 테넌트 이벤트다. 봉투 테넌트는 라이브러리가 찍는다.
- 공개 레포 — 테넌트 값·실주문 번호를 코드·문서·PR 에 적지 않는다.
- 라이브 네이버는 아직 한 번도 돌지 않았다(#1244). 이 설계의 네이버 쪽 끝 확인은 #1244 의 자격증명·shadow 점검과 같이 한다.

## 7. 알려진 위험

- **고객 철회:** 마켓에서 고객이 취소요청을 철회할 수 있다면, core 는 이미 취소했고 마켓 주문은 살아 있는 채로 갈린다. 승인을 즉시 보내므로 창은 짧다. 갈림은 채널 주문 대사(#1016 45번)가 잡아야 한다 — 그 대사가 «마켓 줄 살아 있음 · core 줄 취소»를 보는지 빌더가 확인하고, 못 보면 규칙을 더한다. 사람은 판매자센터에서 판매자 취소로 맞춘다.
- **철회 갈림 — 대사가 못 잡는다(Task 7 확인).** `channel-order-reconcile.classifier.ts` 의 `classifyChannelOrder` 는 «채널 쪽 `OrderCancelled` 인데 core 가 취소 아님»(`cancel_not_applied`)과 «core 에 주문 없음»(`missing_order`)만 본다. «마켓 줄 살아 있음 · core 줄 취소»는 `soStatus !== null` 로 정상 취급해 null 을 돌려주므로 **잡지 못한다.** 코드는 고치지 않았고 이 계획 범위 밖의 후속으로 둔다(이슈 초안은 Task 7 보고서). 그때까지 철회는 판매자센터에서 판매자 취소로 사람이 맞춘다.
- **대사 분류기의 부분취소 오판(잠재).** 분류기는 `OrderCancelled` 관측 하나면 «채널 취소»로 보는데, 네이버 일부 수량 취소도 줄 단위 `OrderCancelled` 로 나간다. 대사가 Medusa 만 덮는 오늘은 닿지 않지만, 채널 주문으로 넓힐 때 부분취소를 전체취소로 오판한다.
- **네이버를 켜기 전 막음(🔴).** `naver-order-fields.ts` 머리 주석의 shadow 점검 목록 — (a) `requestQuantity` 가 누적인가 클레임별인가, (b) 일부 취소 뒤 `productOrder.quantity` 가 원래인가 남은 수량인가, (c) 클레임 칸 이름·위치 — 과 승인부의 «이미 승인됨» 코드 상수(`customer-cancel-approver.ts` `NAVER_ALREADY_APPROVED_CODE`)를 실 응답으로 확정한 뒤에 켠다.
- **쿠팡 `act` 전(🔴).** 전량 범위 명령은 줄을 싣지 않아 `cancelCount` 를 알 수 없다. #1245 가 수량을 명령에 실어야 쿠팡 승인을 `act` 로 켠다.
- **네이버 4영업일 자동 환불**은 스마트스토어 적용이 미확인이다. 승인을 자동으로 보내므로 설계는 이 규칙에 기대지 않는다.
- **배치 중 일부 줄 취소**는 상자를 `recovery_required` 로 멈추고 사람이 다시 짜야 한다. 첫날 이 대기가 생길 수 있다 — 동작은 그대로 둔다.

## 8. 빌더에게 맡긴 것

- 사실·명령의 이름과 모양. 새 명령을 둘지, `CancelChannelOrder` 에 «이 요청에 답한다» 칸을 더할지. (기존 요청 행·정산 수명주기를 재사용한다는 것은 정해진 것.)
- 요청 행의 «못 멈춤» 표시를 기존 상태 값으로 둘지 새 값으로 둘지, 운영자가 그걸 어느 화면에서 보는지(기존 정산 화면·주문 상세 중).
- 네이버 클레임 조회 범위(`lastChangedType=CLAIM_REQUESTED` 를 쓸지, 기존 변경 조회로 충분한지).
- 쿠팡 관측을 #1245 의 source 와 어떤 순서로 묶을지.
- 마켓 문서 본문 재확인(특히 쿠팡 — §2 의 미확인 칸).

## 9. 완료 조건

- 단위·통합 테스트: 이미 수집된 주문에 취소요청 → 배치 전 / 배치 중(상자 전량·일부) / 나간 뒤 각각의 결과, 같은 요청 재관측, 승인 영구 실패, 승인 뒤 취소완료 수집이 no-op.
- 네이버 일부 수량 취소가 관측돼 그 수량만 취소된다.
- 라이브: 실 네이버 주문 1건으로 «취소요청 → core 취소 → 승인 → 취소완료 수집»이 끝까지 돈다(#1244 완료 조건과 같이).
