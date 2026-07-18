# QA 정의 문서

## 개요

테스트에 도움이 될 만한 절차들입니다. 테스트 절차를 전부 기억하고 신경쓰지 않아도 되므로 뇌 용량을 덜 사용할 수 있고, 관련 코드가 기록되어 있으니 AI에게 '이 테스트의 이 부분이 실패한다'고 말해 주면 토큰과 시간을 덜 쓰고도 원인을 찾을 겁니다. 

이 시스템의 비동기적인 특성 때문에, 테스트가 실패한 것 같다면 일단 실패 의심만 하고 나서, 5분 뒤에도 똑같은지 확인해 보면 좋습니다. 

테스트 중에는 아래 값들을 기록해 두면 도움이 됩니다. 아래 표가 표로 보이지 않는다면 MarkText 등 적절한 마크다운 에디터로 이 문서를 다시 열어서 사용하시는 것을 권해 드립니다. 테스트를 여러 세트 진행하셨다면 표를 복사해서 테스트 시작 날짜와 시간을 기록하신 뒤 사용하시면 커밋 충돌시 문제가 적겠습니다. 혹시나 필요시에는 row를 추가해서 사용하세요.

### YYYY-MM-DD hh:mm:ss (양식)

| 항목                                          | 기록값 |
| ------------------------------------------- | --- |
| categoryId, category slug/path              |     |
| PIM masterId                                |     |
| draft versionId, active versionId           |     |
| variantId 목록                                |     |
| Medusa productId, handle                    |     |
| storefront cartId, checkout cartId          |     |
| wallet intentId                             |     |
| Medusa orderId/displayId                    |     |
| Core salesOrderId                           |     |
| fulfillmentOrderId / fulfillmentOrderItemId |     |

## 1. 상품 등록, 버전 관리, publish

관련 코드:

- admin-web 상품 등록: `apps/admin-web/src/app/(admin)/mall/product-registration/(components)/product-registration.client.tsx`
- admin-web 상품 상세/버전: `apps/admin-web/src/features/mall/products-detail/template/index.tsx`
- Core PIM API: `apps/core/src/modules/catalog/core/products/controllers/product-master-versions.controller.ts`
- publish event: `apps/core/src/modules/catalog/core/products/services/product-versions.service.ts`

### 절차

1. admin-web에서 `자사몰 > 상품 > 카테고리` 또는 `/mall/categories`로 이동한다.
2. 테스트 카테고리를 생성한다.
   - 이름: `QA-... Category`
   - slug: `qa-...`
   - active/visible 상태로 설정한다.
3. `/mall/product-registration`에서 테스트 상품을 생성한다.
   - 상품명: `QA-... Product V1`
   - 카테고리: 위에서 만든 테스트 카테고리
   - 이미지 1개 이상
   - 옵션/variant 1개 이상
   - variant 1개 이상 수정
4. 생성 후 이동한 URL에서 `masterId`, `versionId`를 기록한다.
   - admin-web은 생성 응답의 `masterId`, `id(versionId)`로 `/mall/products-list/:masterId?versionId=:versionId`로 이동한다.
5. draft 상태에서 상품명, 설명, SEO, 옵션/variant, 가격, 카테고리를 한 번 이상 수정한다.
6. publish 버튼을 눌러 active version으로 전환한다.
7. `/mall/products-list/:masterId/versions`에서 active version이 하나만 존재하는지 확인한다.
8. active version 기반으로 새 draft를 만든다.
   - Core API 기준: `POST /masters/:masterId/versions`
   - UI에서는 버전 트리/상세 화면의 draft 생성 동선을 사용한다.
9. 새 draft에서 상품명 또는 가격을 `QA-... Product V2`처럼 눈에 띄게 수정한다.
10. 새 draft를 publish한다.

### 기대 결과

- 최초 생성 버전은 `draft`다.
- 최초 publish 후 해당 version만 `active`가 된다.
- active 기반 새 draft를 publish하면 새 version이 `active`가 되고 이전 active는 `inactive`가 된다.
- 이전 active version의 데이터는 새 draft 수정으로 직접 변하지 않는다.
- publish 시 `products.events.v1 / ProductMasterActiveVersionChanged` 이벤트가 발행되고 payload에 full `snapshot`이 포함된다.
- snapshot에는 최소 아래 필드가 포함되어야 한다.
  - `masterId`, `versionId`, `version`, `name`
  - `categories`
  - `images`
  - `optionGroups`
  - `variants`
  - variant 가격 정보
  - `purchaseConstraint`가 설정된 경우 해당 값

### 백엔드 확인 포인트

- `GET /masters/:masterId/versions`에서 version 상태를 확인한다.
- `GET /masters/:masterId/versions/active`에서 active version이 최신 publish version인지 확인한다.
- Core outbox 또는 Kafka에서 `ProductMasterActiveVersionChanged`가 존재하는지 확인한다.
- 이벤트의 `snapshot.versionId`가 active versionId와 일치하는지 확인한다.

주의: 현재 Core 코드상 기존 active가 있는 상태에서 새 version을 publish할 때 `changeReason`이 `rollback`으로 기록될 수 있다. QA의 핵심 판정은 `changeReason` 문자열보다 active version 교체와 full snapshot 포함 여부다.

## 2. 상품 이벤트 전파: channel-adapter, Medusa, search

관련 코드:

- PIM product consumer: `apps/channel-adapter/src/consumers/pim-product-event.consumer.ts`
- Channel adapter inbox worker: `apps/channel-adapter/src/adapters/medusa/inbox-worker.service.ts`
- PIM to Medusa sync: `apps/channel-adapter/src/adapters/medusa/pim-medusa-sync.service.ts`
- Search consumer: `apps/search/src/product-events.consumer.ts`

### 절차

1. 1단계에서 publish한 `masterId`로 channel-adapter 로그를 확인한다.
2. channel-adapter DB에서 PIM 이벤트가 `processed_events`, `inbox_events`에 들어왔는지 확인한다.
3. inbox worker 처리 후 `inbox_events.status`가 성공 상태인지 확인한다.
4. `pim_medusa_mappings`에서 `pim_master_id = masterId`인 row를 확인한다.
5. Medusa admin/API에서 product를 조회한다.
   - handle은 코드상 `masterId`로 생성된다.
6. search 앱에서 상품명을 검색한다.
   - 검색 API가 열려 있으면 `GET /search/products?q=<QA prefix>`로 확인한다.
   - OpenSearch 접근이 가능하면 `search_products` index에서 document id가 `masterId`인지 확인한다.

### 기대 결과

Channel-adapter:

- `pim_medusa_mappings.sync_status = synced`
- `pim_medusa_mappings.medusa_product_id`가 존재한다.
- `pim_medusa_mappings.medusa_handle = masterId`
- 재처리해도 같은 event가 중복 product를 만들지 않는다.

Medusa product:

- product status가 published다.
- `metadata.pimMasterId = masterId`
- `metadata.pimVersionId = active versionId`
- variant metadata에 `pimVariantId`, `variantCode`가 있다.
- variant 가격이 KRW로 반영된다.
- image, category, tag, product type, purchase constraint metadata가 누락되지 않는다.

Search:

- 검색 결과에 active 상품이 노출된다.
- `master_id`, `version_id`, `name`, `category_ids`, `min_base_price/max_base_price`, `status=active`가 반영된다.

### 실패 판정

- Medusa product는 생겼지만 variant metadata에 PIM identity가 없으면 fail이다. 이후 주문 polling이 `CHANNEL_PRODUCT_IDENTIFICATION_FAILED`로 격리된다.
- search 색인이 없거나 이전 version 이름/가격을 보여주면 fail이다.
- 카테고리만 수정했을 때는 `CategoryChanged`가 Medusa category projection만 갱신한다. 기존 active 상품의 category membership은 새 active version publish snapshot으로 검증한다.

## 3. Storefront 상품 탐색, 장바구니, checkout 진입

관련 코드:

- category page: `web/almondyoung-storefront/src/app/[countryCode]/(main)/category/[...segments]/page.tsx`
- product detail: `web/almondyoung-storefront/src/app/[countryCode]/products/[handle]/page.tsx`
- cart API: `web/almondyoung-storefront/src/lib/api/medusa/cart.ts`
- checkout: `web/almondyoung-storefront/src/app/[countryCode]/(checkout)/checkout/page.tsx`
- payment redirect: `web/almondyoung-storefront/src/domains/checkout/templates/checkout-template.tsx`

### 절차

1. storefront에서 테스트 국가 코드로 접속한다.
   - 예: `/kr/category/<category-slug>`
2. 1단계에서 만든 카테고리 목록 페이지에서 테스트 상품이 노출되는지 확인한다.
3. 상품 상세로 진입한다.
   - URL은 `/kr/products/:handle`
   - handle은 channel-adapter 코드 기준 `masterId`다.
4. 상세 페이지에서 이미지, 상품명, 가격, 옵션/variant가 2단계 Medusa projection과 일치하는지 확인한다.
5. 상품을 장바구니에 담는다.
6. 장바구니 페이지에서 line item 수량, 가격, 썸네일을 확인한다.
7. checkout으로 진입한다.
8. 배송지, 연락처, 배송 메모를 입력한다.
9. 결제 요청 버튼을 누르고 wallet-web으로 redirect되는지 확인한다.

### 기대 결과

- category page에 active product가 노출된다.
- product detail은 `masterId` handle로 접근된다.
- 장바구니 line item의 Medusa variant가 PIM variant metadata를 유지한다.
- checkout cart에 shipping method가 없으면 storefront callback/action 코드가 completion 직전에 shipping method를 보장한다.
- 결제 요청 시 Medusa payment session provider는 `pp_almond-payment_almond-payment`를 사용하고, wallet-web `/pay/:intentId?region=kr`로 이동한다.

## 4. Wallet 결제, 리전별 결제수단, 무통장 입금

관련 코드:

- wallet-web pay page: `apps/wallet-web/app/pay/[intentId]/page.tsx`
- wallet-web pay form: `apps/wallet-web/app/pay/[intentId]/pay-form.tsx`
- region payment methods: `apps/wallet/src/payment-config/payment-config.service.ts`
- bank transfer provider: `apps/wallet/src/providers/bank-transfer/bank-transfer.provider.ts`
- bank transfer admin approval: `apps/wallet/src/admin/bank-transfer-admin.service.ts`
- Wallet outbox: `apps/wallet/src/messaging/outbox-dispatcher.service.ts`
- Medusa payment hook: `apps/medusa/src/api/hooks/payment-events/route.ts`
- storefront callback: `web/almondyoung-storefront/src/app/[countryCode]/(checkout)/checkout/callback/actions.ts`

### 리전별 결제수단 절차

1. wallet-web `/pay/:intentId?region=kr`에서 표시되는 결제수단을 기록한다.
2. Wallet API `GET /v1/regions/kr/payment-methods` 결과와 화면을 비교한다.
3. admin-web `/payments/methods`, `/payments/regions`에서 catalog enabled, region active, region-method enabled 상태를 바꿔본다.
4. wallet-web을 새로고침하고 결제수단 표시가 변경되는지 확인한다.

### 기대 결과

- 표시되는 결제수단은 `paymentMethodCatalog.isEnabled`, `regions.isActive`, `regionPaymentMethods.isEnabled`를 모두 만족하는 method뿐이다.
- region query가 `kr`이면 한국 리전에 허용된 결제수단만 보인다.
- 사용 가능한 외부 결제수단이 없으면 wallet-web은 “사용 가능한 결제수단 없음” 상태를 보여준다.

### 무통장 입금 절차

1. wallet-web에서 `무통장입금`을 선택한다.
2. 결제 확인을 누른다.
3. 화면에 입금 대기 상태가 표시되는지 확인한다.
   - 은행명, 계좌번호, 예금주, 금액, 통화가 표시되어야 한다.
4. Wallet DB/API에서 payment intent가 `REQUIRES_ACTION`인지 확인한다.
5. admin-web `/payments/bank-transfers`에서 해당 intent가 대기 목록에 보이는지 확인한다.
6. 관리자가 입금 확인을 처리한다.
   - API 기준: `POST /v1/admin/payment-intents/:intentId/bank-transfer-confirm`
   - body 예: `{ "depositorNote": "QA deposit confirmed" }`
7. Wallet outbox에서 `payments.events.v1 / payment.intent.captured`가 발행되는지 확인한다. (legacy `payment.intent.succeeded`는 더 이상 발행되지 않는다. Medusa hook과 channel-adapter relay는 둘 다 capture로 처리하므로 호환된다.)
8. channel-adapter/payment relay와 Medusa hook 처리 후 Medusa payment가 captured projection 상태가 되는지 확인한다.
9. wallet-web 대기 화면에서 상태 새로고침 또는 완료 링크를 통해 storefront callback으로 돌아간다.
10. storefront callback이 `cart.complete()`를 수행하고 `/kr/checkout/success/:intentId?orderId=:orderId`로 이동하는지 확인한다.

### 기대 결과

- 무통장 confirm 전에는 주문 완료 페이지로 넘어가지 않는다.
- admin 승인 후 Wallet intent status는 `CAPTURED`다.
- `payment.intent.captured` payload의 `intentId`가 Medusa payment `payment_session_id`와 매칭된다.
- Medusa hook은 `payment.intent.captured`를 capture event로 처리한다.
- Medusa payment에는 capture record 또는 `captured_at`이 반영된다.
- storefront 주문 완료 페이지에 Medusa order id/display id가 표시된다.

### 실패 판정

- Wallet intent는 성공했지만 Medusa payment가 captured로 반영되지 않으면 fail이다.
- Medusa payment가 captured인데 storefront callback이 order를 만들지 못하면 fail이다.
- callback 성공 URL에 `orderId`가 없거나 success page가 order 소유권 검증 때문에 주문 요약을 표시하지 못하면 investigate 후 원인을 기록한다.

## 5. Medusa 주문 전파: channel-adapter to Core

관련 코드:

- Medusa order provider: `apps/channel-adapter/src/services/order-collection/medusa-order.provider.ts`
- Order poller: `apps/channel-adapter/src/services/order-collection/order-poller.orchestrator.ts`
- Accepted payment statuses: `apps/channel-adapter/src/adapters/medusa/medusa-order-status.ts`
- Core order consumer: `apps/core/src/modules/sales-order/consumers/order-events.consumer.ts`
- Sales order creation: `apps/core/src/modules/sales-order/services/sales-orders.service.ts`

### 절차

1. 4단계에서 생성된 Medusa order id를 기록한다.
2. Medusa order `payment_status`가 `authorized` 또는 `captured`인지 확인한다.
3. channel-adapter order poller가 실행될 때까지 기다린다.
   - cron은 `*/5 * * * *`, 즉 5분 주기다.
4. channel-adapter DB `wms_order_mappings`에서 `sales_channel=medusa`, `channel_order_id=Medusa order id`인 row를 확인한다.
5. channel-adapter inbox에 `OrderCreated`가 enqueue되고 Kafka `orders.events.v1`로 발행되는지 확인한다.
6. Core에서 `sales_orders.channel_order_id = Medusa order id`인 판매주문을 확인한다.
7. 판매주문 라인이 Medusa line item과 같은 수량/금액/PIM variantId를 갖는지 확인한다.
8. `walletIntentId`가 Core sales order에 저장되는지 확인한다.

### 기대 결과

- Medusa order line item마다 아래 identity가 있어야 한다.
  - variant metadata `pimVariantId`
  - product metadata `pimMasterId`
  - product metadata `pimVersionId`
- 이 identity가 하나라도 없으면 channel-adapter는 신규 Core order를 만들지 않고 order collection failure로 격리한다.
- Core는 `OrderCreated(status=confirmed)`를 소비해 sales order를 만들고 fulfillment backlog를 생성한다.

### 격리 케이스

의도적으로 PIM metadata가 없는 Medusa 상품으로 주문을 만들면:

- `order_collection_failures.status = quarantined`
- reason은 `CHANNEL_PRODUCT_IDENTIFICATION_FAILED`
- Core sales order는 생성되지 않는다.
- API 기준 `POST /adapter/order-collection-failures/:id/replay`로 재처리할 수 있다.

## 6. 주문 매칭과 fulfillment order 생성

관련 코드:

- matching API: `apps/core/src/modules/product-matching/controllers/product-matching.controller.ts`
- matching resolve: `apps/core/src/modules/product-matching/services/product-matching.service.ts`
- fulfillment backlog worker: `apps/core/src/modules/fulfillment/services/fulfillment-order-creation-backlog.worker.ts`
- fulfillment backlog service: `apps/core/src/modules/fulfillment/backlog/fulfillment-order-creation-backlog.service.ts`
- fulfillment creation: `apps/core/src/modules/fulfillment/services/fulfillments.service.ts`

### 테스트 주문 구성

최소 3개 상품/variant를 준비한다.

| 유형           | 준비 상태                                                               | 기대                                                                |
| ------------ | ------------------------------------------------------------------- | ----------------------------------------------------------------- |
| 재고 매칭 상품     | `product_matchings.status=matched`, `strategy=variant`, SKU link 존재 | sales order 이후 fulfillment order 생성                               |
| 미매칭 상품       | matching row가 없거나 `pending`                                         | backlog `awaiting_matching`                                       |
| 재고 비매칭 정상 상품 | `strategy=void`                                                     | 물리 fulfillment item 없이 통과, 단독 주문이면 fulfillment order not required |

### 매칭된 상품 주문 절차

1. matched 상품만 담아 주문을 완료한다.
2. channel-adapter polling 후 Core sales order가 생성되는지 확인한다.
3. fulfillment backlog가 `pending -> processing -> completed`로 이동하는지 확인한다.
4. fulfillment order가 생성되는지 확인한다.

기대 결과:

- `fulfillment_order_creation_backlogs.status = completed`
- `fulfillment_order_creation_backlogs.fulfillment_order_id`가 존재한다.
- `fulfillment_orders.status`는 전량 재고 예약 시 `ready`, 부분 예약 시 `partially_reserved`, 미예약 시 `created`다 (상자 라인 예약량에서 파생 계산되며, 부족분은 10초 재시도 워커가 재고 입고 후 채운다 — 실패 상태는 없다).
- FO 와 같은 트랜잭션에서 `draft` 상태의 상자(shipment)와 상자 라인이 생성되고, 라인별 부분예약이 즉시 시도된다.
- fulfillment order item은 matching SKU와 수량 배수를 반영한다.

### 미매칭 상품 주문 절차

1. 미매칭 상품을 포함해 주문을 완료한다.
2. Core sales order가 생성되는지 확인한다.
3. backlog worker가 `PRODUCT_SKU_MATCHING_REQUIRED`로 멈추는지 확인한다.
4. admin-web `/order/matching` 또는 `/matching/variants`에서 해당 variant/order line을 찾는다.
5. `PATCH /matchings/:id/resolve`에 해당하는 UI 동작으로 매칭을 해소한다.
   - SKU 매칭: `{ "strategy": "variant", "skuMappings": [{ "skuId": "...", "quantity": 1 }] }`
   - 재고 비매칭 정상 처리: `{ "strategy": "void", "resolveAsVoid": true }`
6. backlog가 다시 `pending`으로 깨고 다음 worker 실행 후 completed 또는 not_required가 되는지 확인한다.

기대 결과:

- matching resolve 시 `wakeBacklogsWaitingForVariant(variantId)`가 실행되어 해당 variant를 기다리던 backlog가 재시도된다.
- SKU 매칭으로 해소하면 fulfillment order가 생성된다.
- void 전략으로 해소하면 해당 line은 물리 출고 대상에서 제외된다.
- 모든 line이 void라면 fulfillment order는 생성되지 않거나 not_required로 종료된다.

## 7. 출고: 피킹, 검수, 송장, 발송, 직배, 송장 나누기, 합포

관련 코드:

- fulfillment API: `apps/core/src/modules/fulfillment/controllers/fulfillments.controller.ts`
- shipment 계획/분할: `apps/core/src/modules/fulfillment/controllers/shipment-planning.controller.ts`
- picking API (V2): `apps/core/src/modules/fulfillment/controllers/picking-v2.controller.ts`
- 검수/출고(dispatch): `apps/core/src/modules/fulfillment/controllers/shipment.controller.ts` (`inspection-scans`/`force-dispatch`)
- 운송장(waybill) API: `apps/core/src/modules/fulfillment/waybill/waybill.controller.ts`
- outbound batch API (V2): `apps/core/src/modules/fulfillment/controllers/outbound-batch-v2.controller.ts`
- direct ship API: `apps/core/src/modules/fulfillment/controllers/direct-ship.controller.ts`
- consolidation API: `apps/core/src/modules/fulfillment/controllers/consolidation.controller.ts`

### 일반 재고 출고 절차 (Outbound V2)

1. 상자(shipment)를 출고예정으로 전환한다. FO 생성 시 `draft` 상자가 이미 만들어져 있으므로, 전량 예약 확인 후 계획한다.
   - API 기준: `POST /shipments/:id/plan` (전량 예약 아니면 `SHIPMENT_NOT_FULLY_RESERVED` 거절)
2. batch를 생성한다.
   - API 기준: `POST /outbound-batches/v2`
   - `pickingMethod`: `individual` 또는 `total_picking`
3. `planned` 상자를 batch에 추가한다.
   - 후보 조회: `GET /outbound-batches/:batchId/eligible-shipments`
   - 편입: `POST /outbound-batches/:batchId/shipments/:shipmentId` (work item `queued` 생성)
4. 피커가 work item을 claim하고 피킹을 수행한다.
   - claim: `POST /batch-work-items/:workItemId/picker-claims` (`queued → picking`)
   - 피킹 계획: `POST /picking/v2/plans` → 시작: `POST /picking/v2/starts` → 스캔: `POST /picking/v2/scans` → 완료: `POST /picking/v2/completions` (`picking → ready_to_pack`)
5. 패커가 work item을 claim한다.
   - `POST /batch-work-items/:workItemId/packer-claims` (`ready_to_pack → packing`)
6. 운송장을 발급한다 (출고 전 필수 — 없으면 dispatch가 `SHIPMENT_INVOICE_NOT_READY`로 거절).
   - 발급: `POST /shipments/:shipmentId/waybills` (수동 등록: `.../waybills/manual`, 일괄: `POST /waybills:batch`)
7. 검수 스캔을 수행한다. 박스 전 라인의 `inspectedQty = qty`가 되는 순간 자동으로 출고(dispatch)된다 — 별도 ship 엔드포인트는 없다.
   - 검수 스캔: `POST /shipments/:id/inspection-scans`
   - 강제출고(검수 우회, 권한 필요): `POST /shipments/:id/force-dispatch`

기대 결과:

- shipment 상태가 `draft → planned → shipped`로 진행되고, work item 상태가 `queued → picking → ready_to_pack → packing → completed`로 진행된다.
- dispatch 트랜잭션에서 `SHIP` 재고원장 이벤트 기록, 예약 `confirmed → released`, 운송장 `used`, `dispatch_attempts` `dispatched`가 원자적으로 일어난다.
- 발송 처리 후 fulfillment order item의 `shippedQty = qty`가 되고, FO 파생 상태가 `completed`(전량) 또는 `partially_shipped`가 된다.
- `ShipmentShipped`·`FulfillmentProgressed` 이벤트가 발행되고, 전량 출고 시 `FulfillmentShipped`(V1)에 carrier, tracking number가 포함된다.

### 직배(drop-ship) 절차

1. 직배 테스트용 SKU를 준비한다.
   - inventory SKU `stockType = drop_shipped` 또는 `consignment`
   - holder/supplier 정보가 있어야 `/direct-ship` 목록에서 회사별로 확인하기 쉽다.
2. 해당 SKU에 PIM variant를 매칭한다.
3. 직배 상품만 주문하거나 일반 재고 상품과 함께 주문한다.
4. Core sales order와 fulfillment order 생성을 기다린다.
5. `/order/direct-ship` 또는 API `GET /direct-ship/orders`에서 fulfillment order가 보이는지 확인한다.
6. 업체 전달을 수행한다.
   - `POST /direct-ship/orders/forward`
7. 업체 발송 완료 처리를 수행한다.
   - `PUT /direct-ship/orders/complete`

기대 결과:

- 직배 fulfillment order는 `fulfillmentMode = drop_ship`이어야 한다.
- `directShipStatus`는 `pending -> forwarded -> completed`로 이동한다.
- 직배 fulfillment order는 outbound batch에 추가할 수 없어야 한다.
- 업체별 export에 고객 배송 정보와 SKU/수량이 포함된다.

중요한 코드 기준 리스크:

- 현재 자동 sales order fulfillment 생성 경로는 `FulfillmentOrderCreationBacklogWorker -> FulfillmentsService.create({ salesOrderId, warehouseId, shippingAddress })`이고, 여기서 `fulfillmentMode`를 자동으로 `drop_ship`으로 결정하거나 stock type별로 fulfillment order를 나누는 로직은 보이지 않는다.
- 따라서 “일반 재고 상품과 직배 상품이 같은 주문에 있을 때 자동으로 서로 다른 fulfillment order로 분리되는가”는 반드시 결함 탐지 목적의 테스트로 수행한다.
- 실제 결과가 하나의 fulfillment order에 섞이거나 `fulfillmentMode`가 null/in_house로 남으면 fail로 기록한다.

### 송장 나누기 (상자 분할)

송장분할은 FO 분할이 아니라 **상자(shipment) 레이어**에서 수행한다 — 구 `POST /fulfillments/:id/split`(FO 분할)은 은퇴했다.

1. 한 fulfillment order에 여러 item 또는 큰 수량을 포함한 주문을 준비한다.
2. `draft` 상태 상자의 상자 라인 id를 기록한다.
3. `POST /shipments/:id/splits`를 실행해 일부 라인/수량을 새 상자로 분리한다.
4. 원 상자와 새 상자가 나뉘었는지 확인한다.
5. 각 상자를 개별적으로 `plan → batch 편입 → 피킹/검수`로 진행하고, 상자별로 별도 운송장을 발급한다.

기대 결과:

- `draft`가 아닌 상자에서는 split이 거부된다 (`SHIPMENT_NOT_DRAFT`).
- 원본 상자에 양수 수량이 남지 않는 분할은 거부된다.
- 예약 정보는 라인 이동에 따라 이동/보정된다.
- 각 상자에 서로 다른 운송장/tracking number를 부여할 수 있다.

### 합포/합배송

1. 같은 고객/같은 주소의 주문을 2개 이상 생성한다.
2. 각 주문의 FO 와 `draft` 상자가 생성되었는지 확인한다.
3. `GET /shipments/consolidation-candidates`로 합포 후보가 잡히는지 확인한다.
4. `POST /shipments/consolidations`로 여러 상자를 하나의 상자로 합친다.
5. 합쳐진 상자를 `plan → batch 편입 → 피킹/검수/출고`로 진행한다.

기대 결과:

- 합포되어 대체된 원본 상자는 `superseded` 상태가 된다.
- drop-ship 라인이 있는 상자는 합포/batch 대상에서 제외된다.
- 합쳐진 상자는 운송장 한 장으로 출고된다 (상자 = 송장 단위).

## 8. 최종 E2E 체크리스트

아래 항목이 모두 true여야 전체 pass다.

- PIM draft 생성, 수정, publish, active 기반 새 draft publish가 version 상태를 정확히 바꾼다.
- `ProductMasterActiveVersionChanged` payload에 full snapshot이 있다.
- channel-adapter inbox가 product/category event를 처리하고 Medusa product/category가 최신 active version을 반영한다.
- Medusa product/variant metadata에 PIM identity가 있다.
- search index에 active 상품이 색인된다.
- storefront category/product/cart/checkout 진입이 정상이다.
- wallet-web이 region별 결제수단을 정확히 보여준다.
- 무통장 입금은 admin 승인 전 대기, 승인 후 Wallet `CAPTURED`, Medusa capture projection, storefront order complete까지 이어진다.
- Medusa order polling으로 `wms_order_mappings`와 Core `sales_orders`가 생성된다.
- 미매칭 주문은 fulfillment backlog `awaiting_matching`으로 멈추고, 매칭 해소 후 자동 재시도된다.
- matched 주문은 fulfillment order로 변환된다.
- 일반 출고의 상자 plan, batch 편입, 피킹, 검수(자동 dispatch), 운송장 발급이 가능하다.
- 직배 주문은 일반 재고 출고와 분리되어 direct-ship workflow를 탄다.
- 송장 나누기는 상자(shipment) split 후 복수 운송장/복수 tracking 처리로 검증된다.
- 합포는 여러 상자를 하나의 상자로 합쳐(consolidation) 운송장 한 장으로 출고할 수 있다.

## 9. 빠른 endpoint/reference

### PIM/Core

- `POST /categories`
- `POST /masters`
- `GET /masters/:masterId/versions`
- `POST /masters/:masterId/versions`
- `PUT /masters/:masterId/versions/:versionId`
- `PATCH /masters/:masterId/versions/:versionId/publish`
- `GET /masters/:masterId/versions/active`

### Channel Adapter

- topic: `products.events.v1`
- topic: `orders.events.v1`
- table: `pim_medusa_mappings`
- table: `wms_order_mappings`
- table: `order_collection_failures`
- replay: `POST /adapter/order-collection-failures/:id/replay`

### Search

- index: `search_products`
- API: `GET /search/products`

### Wallet/Payment

- wallet-web: `/pay/:intentId?region=kr`
- `GET /v1/regions/:code/payment-methods`
- `GET /v1/admin/payment-intents/pending-bank-transfers`
- `POST /v1/admin/payment-intents/:id/bank-transfer-confirm`
- topic: `payments.events.v1`
- event: `payment.intent.captured` (legacy: `payment.intent.succeeded` — Medusa hook은 둘 다 capture로 수용)
- Medusa hook: `POST /hooks/payment-events`

### Core WMS

- `GET /matchings`
- `GET /matchings/order-lines`
- `PATCH /matchings/:id/resolve`
- table: `fulfillment_order_creation_backlogs`
- `GET /fulfillments`
- `POST /shipments/:id/plan`
- `POST /shipments/:id/splits`
- `POST /shipments/:id/inspection-scans`
- `POST /shipments/:id/force-dispatch`
- `POST /shipments/:shipmentId/waybills`
- `POST /waybills:batch`
- `POST /outbound-batches/v2`
- `GET /outbound-batches/:batchId/eligible-shipments`
- `POST /outbound-batches/:batchId/shipments/:shipmentId`
- `POST /batch-work-items/:workItemId/picker-claims`
- `POST /batch-work-items/:workItemId/packer-claims`
- `POST /picking/v2/plans` · `/starts` · `/scans` · `/completions`
- `GET /direct-ship/orders`
- `POST /direct-ship/orders/forward`
- `PUT /direct-ship/orders/complete`
- `GET /shipments/consolidation-candidates`
- `POST /shipments/consolidations`
