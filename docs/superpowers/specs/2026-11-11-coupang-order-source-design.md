# 쿠팡 주문 수집 — 수집하자마자 상품준비중, 셀메이트가 못 보낸 주문은 넘겨받는다

상위: #1233 (축 4) · 이슈: #1245
관련: ADR-0031(다채널 주문 수집) · `docs/superpowers/specs/2026-11-10-market-cancel-request-approval-design.md`(#1283, 마켓 고객 취소요청 — 이 설계가 그 «쿠팡 관측»을 맡는다)

## 1. 왜

셀메이트를 끊는 날 쿠팡 주문도 우리 앱으로 넘어온다(#1233 결정). 그런데 쿠팡 주문 수집 source 가 없다 — `apps/channel-adapter/src/adapter.module.ts` 의 `CHANNEL_ORDER_PROVIDER` 는 Medusa·Naver 둘뿐이다. HTTP 클라이언트(`adapters/coupang/clients/*`)와 송장 업로드 경로(`CoupangAdapter.executeDispatchShip`)는 대부분 있다. 이 일은 **네이버 source 를 본으로 쿠팡 source 를 더하고, 그 길에 있는 조용한 결함을 고치는 일**이다.

셀메이트는 주기 수집이 없다. 아침에 사람이 «주문수집» 버튼을 누르면 결제완료 그대로 가져오고, **송장을 작성할 때** 상품준비중으로 바꾼다. 취소도 버튼을 눌러 한 번에 가져온다. 이 방식이 불만이었고, 우리는 channel-adapter 크론이 주기적으로 가져온다(`order-poller.orchestrator.ts`, 5분).

## 2. 쿠팡의 규칙 (2026-11-11 조사)

출처는 전부 공식 개발자 포털 `https://developers.coupang.com/ko/` 아래 경로다(옛 `developers.coupangcorp.com` 은 여기로 302).

| 사실 | 출처 |
|---|---|
| 키는 판매자 ID 당 **한 쌍**. 연동업체 둘, 또는 연동업체 하나 + 자체개발 하나를 동시에 붙일 수 없다. 연동 정보를 바꾸면 이전 쪽 호출은 `403 Not allowed IP`. 반영까지 최대 30분, 수정은 주 10회 | `faq/can-i-register-more-than-2-integrators-when-issuing-an-openapi-key`, `faq/when-issuing-an-openapi-key-can-i-register-one-integator-and-one-self-developmen`, `faq/after-reissuing-the-api-key-or-modifying-the-integrator-information-or-ip-addres` |
| 자체개발은 호출 IP 를 최대 10개 등록. 테스트 환경 없음. 키 유효기간 180일, 재발급하면 옛 키 즉시 무효 | `getting-started/issue-open-api-keynew`, `faq/if-an-openapi-key-is-reissued-is-the-existing-api-key-unusable-immediately` |
| 판매자 ID 기준 초당 5회. 넘으면 429 로 수분~수십 분 막힘. 단시간 에러가 몰리면 IP 가 403 «Sorry! Access denied» — 권고는 5초에 20건이면 10분 멈춤 | `notices/optimization-and-adjustment-of-open-api-rate-limiteffective-march-17th2026`, `faq/how-to-resolve-sorry-access-denied-http-403-error-when-calling-coupang-openapi` |
| 발주서 목록은 **상태별 조회만** 있다(변경분 피드 없음). 한 번에 상태 하나. 일 단위 페이징(최대 31일, `maxPerPage` ≤ 50 + `nextToken`) / 분 단위(`searchType=timeFrame`, 최대 24시간, 페이징 없음). 결제 뒤 목록에 잡히기까지 약 10분, 단건 조회는 즉시 | `api/shipments/po-list-query-paging-by-day`, `api/shipments/po-list-query-by-minute`, `faq/i-cannot-find-the-order-that-i-just-created` |
| `shipmentBoxId` 는 18자리(2024-11~) — JS number 정밀도(2^53)를 넘는다 | `notices/updatethe-length-of-shipmentboxid-value-will-be-changed-to-18-digits-october-30-` |
| 줄 고유 ID 는 문서에 없다. `vendorItemId` 는 «변하지 않으며 key 로 사용». 분리배송하면 먼저 보낸 품목의 `shipmentBoxId` 가 바뀐다 | `getting-started/coupang-open-api`, `faq/i-want-split-a-shipment` |
| 줄 수량: `shippingCount`(원 주문) · `holdCountForCancel`(취소돼 환불 예정) · `cancelCount`(취소 확정). 보낼 수량 = `shippingCount − holdCountForCancel − cancelCount` | `faq/is-partial-cancellation-reflected-to-a-po` |
| 결제완료(`ACCEPT`) 동안 고객이 배송지를 바꿀 수 있다 | 목록 조회 문서 |
| 상품준비중 처리 `PATCH …/v4/vendors/{vendorId}/ordersheets/acknowledgement`(상자 ≤ 50). `ACCEPT` 에만 된다. 환불 진행 중이면 거절. 응답은 상자별 `succeed`·`resultCode`·`retryRequired`. 성공해도 WING 표시는 최대 30분 늦을 수 있다 | `api/shipments/changing-the-status-to-product-in-preparation` |
| **송장 업로드는 상품준비중(`INSTRUCT`)에서만 된다.** `ACCEPT` 에 올리면 `INVALID_STATUS` | `faq/what-do-i-do-when-uploading-waybill-number-returns-error-invalid-status` |
| 결제완료 단계 고객 취소는 즉시 취소(판매자 할 일 없음, `cancelType=CANCEL` 로 관찰). 상품준비중 뒤 고객 취소는 출고중지요청(`RU`) — 판매자가 출고중지완료(`stoppedShipment`) 또는 이미출고(`completedShipment`)로 처리 | `workflows/shipmentrefund-api-workflow`, `api/returns/return-cancellation-request-list-query` |
| 출고중지완료의 `cancelCount` 는 **접수번호(`receiptId`) 전체 수량(`cancelCountSum`)** 이어야 한다. 품목 단위 처리 불가 | `faq/i-want-to-suspend-shipment-what-value-do-i-enter-for-the-cancelcount-parameter`, `faq/can-i-suspend-shipment-by-item-instead-of-receiptid` |

## 3. 정해진 것 (사용자, 2026-11-11)

1. **수집하자마자 상품준비중으로 넘긴다.** 셀메이트(송장 작성 때 넘김)와 다르다.
   - 얻는 것: 포장 중·이미 나간 상자를 쿠팡이 즉시 취소해 버리지 못한다(그 뒤 고객 취소는 출고중지요청이 되어 core 판정을 거친다). 배송지가 일찍 굳는다. 일이 수집기 안에서 끝난다.
   - 받아들인 것: 고객이 결제 뒤 10~15분이 지나면 «즉시 취소» 대신 «취소요청 → 승인»을 거친다.
   - 버린 대안: 송장 발급 때(셀메이트와 같음 — core→channel-adapter 새 신호 필요), 송장 업로드 직전(포장 끝난 상자가 마지막까지 즉시 취소됨).
2. **쿠팡 고객 취소요청 자동 승인을 첫날부터 켠다**(`act`). 켜지 않으면 1번 때문에 늘어나는 취소요청을 전부 사람이 WING 에서 승인해야 한다. 이 source 가 접수 전체 수량을 실어 #1283 이 남긴 막힘(`customer-cancel-approver.ts` 의 `coupang_cancel_count_unknown`)을 푼다.
3. **셀메이트 몫과 우리 몫은 시각이 아니라 «키를 옮기는 순간의 상태»로 가른다.** 키를 옮기면 셀메이트는 쿠팡 API 를 못 부르므로(송장도 못 올린다) 지도의 «T 이전 주문은 셀메이트가 끝까지» 가 쿠팡에선 성립하지 않는다. 대신:
   1. 마지막 셀메이트 날, 셀메이트가 수집한 쿠팡 주문은 송장 작성·업로드까지 끝낸다(→ 상품준비중 이상).
   2. 그날 저녁 연동 정보를 우리로 바꾼다.
   3. 그 순간 **결제완료로 남은 주문 = 우리 몫.** 상품준비중 이상인 주문 중 우리가 수집하지 않은 것은 셀메이트 몫이고, 우리는 만들지 않는다.
4. **재고가 모자라 셀메이트가 못 보낸 주문은 우리가 넘겨받는다.** 송장을 안 썼으니 결제완료로 남아 3번 규칙대로 우리 첫 수집에 들어오고, 앱에서 재고 부족 상자로 기다렸다 나간다. 조건 둘:
   - 키를 옮긴 뒤 그 주문을 셀메이트 화면으로 출고하지 않는다(런북 한 줄, #1251).
   - 🔴 **재고를 두 번 빼지 않는다.** 마지막 재고 sync 는 «셀메이트 현재재고 − 미발송주문수»를 넣는다(`scripts/sellmate/sync-stock.ts` `parseStockRows`). 넘겨받는 주문은 이미 미발송으로 빠져 있는데 core 가 수집하며 또 예약한다. 넘겨받은 주문의 수량을 재고에 되돌려 넣어야 한다.
5. **리허설은 반드시 한다.** 테스트 환경이 없고 키가 하나라 리허설 없이는 컷오버 당일이 첫 실전이다. 셀메이트는 아침 버튼 때만 쿠팡을 부르므로, 밤에 연동 정보를 우리로 바꿔 **읽기만** 하고 되돌린다. 쿠팡 상태를 바꾸는 호출(상품준비중·송장·출고중지)은 리허설에서 막는다.
6. **쿠팡 주문은 나눠 보내지 않는다.** 다 모일 때까지 기다렸다 한 번에 보낸다. 쿠팡 분리배송은 첫 상자 때 나머지의 출고예정일을 약속해야 하고 그 날짜는 못 바꾼다 — 중국 선적 도착을 모르는 채 약속하게 된다. 받아들인 것: 재고 부족 주문(넘겨받는 주문 포함)의 고객이 더 오래 기다린다.
7. **리허설은 사무실 PC 에서 돌린다.** 그 PC 의 IP 를 리허설 밤에만 쿠팡에 추가 등록하고 끝나면 뺀다. 원 응답은 그 PC 의 레포 밖에만 두고, 가짜 값으로 바꾼 자료만 커밋한 뒤 원본은 지운다.

## 4. 만들 것

### 4.1 `CoupangOrderSource`

`ReplayableChannelOrderSource` 를 구현한다(격리함 재처리·즉시 끌어오기에 `fetchOrder` 가 필요하다). 파일 배치·스펙 구성은 `naver-order.source.ts`·`naver-order-fields.ts` 를 따른다 — 응답 필드 해석은 `coupang-order-fields.ts` 한 곳에 모은다(리허설 응답으로 확정할 자리).

- 클래스 이름은 정확히 `CoupangOrderSource` 다 — 컷오버 판정(`scripts/ops/cutover-preflight/checks/wiring.ts`)이 `adapter.module.ts` 의 `inject:` 배열에서 이 이름을 찾는다.
- **결제완료는 시간선이 아니라 대기열로 본다.** 우리가 수집 즉시 상품준비중으로 넘기므로 결제완료 목록은 «아직 우리 손을 안 탄 주문»이다. 매 주기 결제완료를 일 단위로 넉넉히(첫 실행·평소 모두 31일) 훑는다. 3·4번 결정의 «넘겨받기»가 이걸로 된다 — 셀메이트가 못 보낸 오래된 주문도 결제완료로 남아 있다. (Claude 판단: 생성 시각 워터마크를 쓰면 키 전환 이전 주문을 놓치고, 결제완료 대기열은 우리가 비우므로 작다)
- **이미 수집한 주문의 변화**(부분 취소로 줄 수량이 줄어듦, 상품준비중 직후 확정된 배송지)는 상품준비중 이후 상태를 조회해 본다. 조회 범위·주기는 빌더 몫이되 초당 5회 안이어야 한다. **`wms_order_mappings` 에 없는 상품준비중 이후 주문은 셀메이트 몫이므로 판매주문을 만들지 않는다**(3번 결정).
- 결제 수락 판정: 결제완료·상품준비중 이후 = `accepted`. 보낼 수량이 0 인 줄은 `cancelled: true` 로 남긴다(빼면 해시가 흔들린다 — 인터페이스 주석). 모든 줄이 0 이면 `orderCancelled`.
- 한 주문(`orderId`)에 상자(`shipmentBoxId`)가 여럿일 수 있다. 스냅샷은 `orderId` 단위로 모은다.

### 4.2 줄 식별

- `channelOrderItemId = ${orderId}:${vendorItemId}` · `channelProductId = vendorItemId`(격리함 매핑·송장 업로드 키와 같다 — `create-channel-listing.dto.ts` 예시가 이미 이 뜻).
- 같은 주문에 같은 `vendorItemId` 가 두 줄로 오면 추측하지 않고 그 주문을 격리한다(문서로 확인 못 함 — 리허설 데이터로 본다).
- 쿠팡 응답의 `orderItemId` 는 쓰지 않는다(문서에 없고, zod 도 optional). (Claude 판단)
- core 의 dispatch 409(`SHIPMENT_EVENT_IDENTITY_MISSING`, `apps/core/src/modules/fulfillment/services/dispatch-effects.ts`)와 inbox worker 의 manual 분기는 이 두 값이 채워지면 통과한다.

### 4.3 상품준비중 처리 (1번 결정)

- **channel-adapter 의 수집 트랜잭션**(`wms_order_mappings` + `OrderCreated` 아웃박스, `order-poller.orchestrator.ts` `processOrderItem`)이 **커밋된 뒤** 그 주문의 상자들을 상품준비중으로 넘긴다. core 가 판매주문을 만들었다는 회신은 기다리지 않는다 — 그 신호가 지금 없고, 만들면 core 계약·배포 순서가 바뀐다(§8). (Claude 판단, 2026-11-11 검토에서)
  - 대가: core 소비가 거절·DLQ 로 끝나면 쿠팡에선 상품준비중인데 우리 판매주문이 없는 주문이 남는다. 그 출구는 이미 있는 이벤트 실패 출구(DLQ 화면)다. 덧붙여 판정 스크립트의 컷오버 뒤 점검(`--after-cutover`)에 «쿠팡 상품준비중인데 core 판매주문 없음» 한 줄을 더한다.
- 매칭 대기로 격리된 주문은 넘기지 않는다 — 재처리로 들어간 뒤 넘긴다. (Claude 판단: 격리 동안은 고객 즉시 취소가 열려 있는 편이 무해하다)
- 실패 처리: 상자별 결과를 본다. `retryRequired` 면 다음 주기에 다시(결제완료 대기열에 그대로 남으므로 저절로 된다). 환불 진행 중 거절은 취소 관찰(4.5)로 이어진다. 504·521 은 단건 조회로 반영 여부를 확인한 뒤 다시.
- 넘긴 직후 단건 조회로 배송지를 한 번 더 읽는다. 바뀌었으면 기존 해시 경로로 `OrderModified` 가 나가고 core 가 송장 발급 전이면 반영한다(`apps/core/src/modules/sales-order/channel-order-change/channel-order-change.manager.ts`, 발급 뒤면 `WAYBILL_ISSUED` 로 막고 화면에 보인다).
- 리허설 모드(4.8)에서는 부르지 않는다.

### 4.4 송장·출고 경로 결함 수정

- 🔴 **송장 업로드 실패가 성공으로 기록된다.** 클라이언트(`coupang-order.client.service.ts` `uploadInvoices`·`acknowledgeOrdersheets`)는 봉투를 벗겨 `{responseCode, responseList}` 를 돌려주는데 어댑터 `transformCoupangResponseToSyncResult`(`coupang.adapter.ts`)는 `data.responseList` 를 읽어 늘 빈 목록 → 성공이다. 상자·품목별 `succeed`·`resultCode`·`retryRequired` 를 결과에 옮긴다. 스펙(`shipment-dispatch-translations.spec.ts`)이 봉투째 mock 해 이걸 가리니 실제 클라이언트 반환 모양으로 고친다.
- 🔴 **`shipmentBoxId` 정밀도.** zod 가 `z.number()` 이고 응답 JSON 을 number 로 읽는 순간 깨진다 — zod 단계가 아니라 **응답 파싱 단계**에서 18자리 정수를 문자열로 받는다. `orderId`·`receiptId` 도 같은 처리를 한다(길이 확인 못 함 — 같은 위험으로 본다). 요청 body 에 실을 때도 문자열 그대로 넣는 방법을 빌더가 고른다.
- `dispatch.update_tracking` 이 items 없이 변환을 불러 늘 실패한다 — 고친다.
- **쿠팡 능력 `multipleTrackingNumbers` 를 `false` 로**(`services/channel-capabilities.ts`, 6번 결정). 나뉜 상자의 출고는 inbox worker 가 manual 로 돌리고(`shipment-dispatch-inbox.worker.ts` 의 `isPartial` 분기), 사람이 WING 에서 처리한다. 운영 규칙 «쿠팡 주문은 정체 보드에서 나눠 보내지 않는다»는 런북 #1251 에. 나눠 보내기 버튼 자체를 쿠팡 주문에서 막는 건 core·admin-web 일이라 이 작업 밖이다. 지금 코드가 `splitShipping` 을 세우는 갈래(`translateOrderToInvoiceDtos`)는 이 능력이 막으므로 그대로 두되, 테스트로 «쿠팡 나뉜 상자는 업로드하지 않는다»를 고정한다.
- 클라이언트에 속도 제한(초당 5회, 판매자 ID 단위 — 프로세스가 둘이어도 넘지 않게)과 429·연속 에러 물러남을 넣는다. 지금은 timeout·재시도도 없다.

### 4.5 취소 관찰 (#1283 의 쿠팡 몫)

#1283 설계 §4 의 계약을 그대로 쓴다.

- 상품준비중 뒤 출고중지요청(`returnRequests` 의 `RU`) → `ChannelCancelRequested`. `channelRequestRef = receiptId`, `channelRequestKey = receiptId`(빌더가 철회 뒤 재요청을 구별해야 한다고 판단하면 키를 넓힌다). 줄은 `returnItems[]` 의 `vendorItemId`·`cancelCount`, **줄 합 = `cancelCountSum`**.
- 결제완료 단계 즉시 취소(`cancelType=CANCEL`)와 발주서의 `holdCountForCancel`·`cancelCount` 증가 → 줄 단위 `OrderCancelled`(«N개 더»가 아니라 «이 줄의 취소 수량은 이만큼»).
- `customer-cancel-approver.ts` 의 쿠팡 실행부는 줄 합 대신 접수 전체 수량을 쓴다. 한 접수 안 일부만 멈출 수 있으면 접수 전체를 «못 멈춤»으로 본다는 #1283 규칙과 맞는다.

### 4.6 승인 스위치를 채널별로

`CHANNEL_CANCEL_APPROVAL_MODE` 는 지금 두 채널 공용이라 쿠팡을 켜면 네이버도 켜진다. 네이버는 켜기 전 shadow 점검(#1244)이 남았다. 채널별로 켤 수 있게 나눈다 — 형태(변수 둘·목록 하나)는 빌더 몫. IaC(`deployments/lcnine/services/infra/services.ts`)와 `config/env.validation.ts` 에 배선한다(지금 둘 다 없음).

### 4.7 배선·정리

- 자격증명 `COUPANG_ACCESS_KEY`·`COUPANG_SECRET_KEY`·`COUPANG_VENDOR_ID` 를 `sst.Secret` 으로(지금 자리표시 `'1'`). 판정 스크립트가 자리표시를 이미 잡는다.
- `CHANNEL_ORDER_PROVIDER` 에 등록, `syncable-channels.ts` 에 쿠팡 추가.
- 죽은 `test:coupang:integration`(`package.json`, 가리키는 파일은 `21da4557a` 에서 삭제)과 루트 `CLAUDE.md` 의 그 줄, `apps/channel-adapter/CLAUDE.md` 의 «source 는 Medusa 하나» 문장을 고친다.
- 판매채널 행은 비활성으로 두고 키 전환 때 켠다 — 폴러의 active-sites 게이트가 그 전까지 막는다. **배포해도 휴면이다.**

### 4.8 리허설 모드 (5번 결정)

- 수집기를 «읽기만» 모드로 돌리는 스위치. 쿠팡 상태를 바꾸는 호출(상품준비중·송장·출고중지·이미출고)과 core 로 가는 이벤트를 전부 막는다. 판매채널이 비활성이어도 돌 수 있어야 한다. **사무실 PC 에서 돌리는 일회성 명령**이다(7번 결정) — 라이브 DB·Kafka 에 닿지 않고 쿠팡 읽기 호출과 파일 쓰기만 한다. 원본 출력 위치는 레포 밖 경로를 인자로 받는다.
- 내는 것:
  1. 발주서·취소요청 원 응답 — `coupang-order-fields.ts` 의 필드 해석을 확정하는 테스트 자료가 된다. 🔒 **공개 레포다.** 커밋하는 자료는 수취인·주문자·주소·연락처·주문번호를 가짜 값으로 바꾼 뒤에만 넣는다. 원본은 레포 밖에 둔다.
  2. 넘겨받을 주문 목록(지금 결제완료인 주문)과, 상품준비중이지만 송장이 없는 주문(셀메이트가 송장 작성 중 멈춘 것 — 사람이 볼 목록).
  3. 4.2 의 의심(같은 옵션 두 줄, 스냅샷으로 못 만드는 주문)에 걸리는 건수.

### 4.9 넘겨받은 주문의 재고 되돌리기 (4번 결정)

- 되돌릴 대상은 «키 전환 전에 결제된 주문»이 **아니라** «마지막 재고 sync 의 미발송주문수에 잡힌 주문» = **셀메이트가 수집했고 아직 안 보낸 주문** 중 우리 첫 수집에 들어온 것이다. 셀메이트는 아침 버튼 때만 수집하므로 그 뒤 키 전환 전까지 결제된 주문은 미발송에 없다 — 그것까지 되돌리면 오버셀이다. 판정 근거는 마지막 sync 와 같은 시점에 받은 셀메이트 주문 내보내기(런북 «시각 T» 의 주문이력)와 마지막 재고 파일이다. (Claude 판단, 2026-11-11 검토에서)
- 더할 양은 «넘겨받은 수량»이 아니라 **다시 계산한 목표와 마지막 sync 목표의 차**다: 품목마다 `max(0, 현재재고 − (미발송주문수 − 넘겨받은 수량)) − max(0, 현재재고 − 미발송주문수)`. `parseStockRows` 가 음수를 0 으로 잘라 둔 품목에서 원래 실물보다 많이 넣지 않기 위해서다. (Claude 판단)
- 일회성 스크립트, 기본 dry-run, 같은 주문을 두 번 더하지 않는다. 원장에 남는 이벤트·사유 형태는 빌더 몫(`stock_events` 규칙을 따른다).
- 당일 순서(셀메이트 마지막 sync 다음, 첫 수집 다음)는 런북 #1251 에 넣는다.

## 5. 사람 작업

- [ ] WING 에서 API 키 «자체개발»로 발급 준비 — 호출 IP 는 우리 NAT EC2 고정 EIP(`deployments/lcnine/services/infra/shared.ts`, 값은 레포에 적지 않는다).
- [ ] 리허설 밤: 연동 정보를 자체개발로(호출 IP = NAT EIP + 사무실 PC IP) → 사무실 PC 에서 읽기 전용 실행 → 원본에서 가짜 값 자료 만들고 원본 삭제 → 셀메이트로 되돌림 → 다음 날 아침 셀메이트 수집이 되는지 확인.
- [ ] 리허설 뒤 쿠팡 등록 IP 에서 사무실 PC IP 를 뺀다(키 전환 때 NAT EIP 만 남긴다).
- [ ] 마지막 셀메이트 날: 수집한 쿠팡 주문 송장까지 끝내기, 저녁에 키 전환.
- [ ] 키 만료 180일 — 재발급 일정을 달력·런북에. 재발급하면 Secret 을 같은 날 바꿔야 한다(옛 키 즉시 무효).

## 6. 하지 않는 것

재고·품절을 쿠팡에 반영(#1246) · 반품·교환 처리(첫날 판매자센터 수동) · 택배사 코드 오매핑(#1136) · 이미출고·자동 거부 · 쿠팡 분리배송 업로드(6번 결정 — 막기만 한다) · 쿠팡 주문의 나눠 보내기 버튼 막기(core·admin-web) · 자사몰·네이버 드레인의 재고 부족 잔여 주문(런북 #1251 에서 따로).

## 7. 확인 못 한 것 — 리허설·첫 운영에서 본다

- 발주서 목록의 `createdAt` 이 주문 시각인지 결제 시각인지.
- 상품준비중 처리 직후 곧바로 상세가 `INSTRUCT` 로 읽히는지(WING 표시는 최대 30분 늦다고만 적혀 있다).
- 연동 정보를 셀메이트로 되돌릴 때 셀메이트에 키를 다시 넣어야 하는지(재발급만 안 하면 키는 그대로일 가능성이 높다 — 추측).
- 상품준비중 뒤 고객 취소가 `RU` 와 `UC` 양쪽에 잡힌다는 FAQ 문구 — 같은 요청을 두 번 세지 않게 키를 `receiptId` 로 둔다.
- 같은 주문에 같은 `vendorItemId` 두 줄이 오는지.
- `orderId`·`receiptId` 길이(정밀도 위험 여부).

## 8. 배포

channel-adapter 만 바뀐다(core 계약 변경 없음 — `channelOrderItemId`·`channelProductId`·`ChannelCancelRequested` 는 이미 있다). 마이그 없음. 판매채널 비활성이라 배포해도 휴면이고, 켜는 건 컷오버 당일이다. #1282·#1283 과 같은 배치에 실어도 된다.

https://claude.ai/code/session_011oZEDhqPbzYYiM8HqiuLnN
