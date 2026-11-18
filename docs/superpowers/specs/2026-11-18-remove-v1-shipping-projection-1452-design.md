# #1452 옛 주문 단위 배송 투영 삭제 — 짧은 설계

## 왜

channel-adapter 의 옛 투영(`FulfillmentShipped/Delivered` → inbox `CoreFulfillment*` → Medusa 주문 메타데이터 최상위
`coreTrackingNumber`·`coreCarrier`·`coreShippedAt`·`coreDeliveredAt`·`coreFulfillmentId`)은 한 번도 성공하지 않았다.
`payload.orderId`(core 판매주문 PK)로 `wms_order_mappings.wms_order_id`(수집 때 만든 uuid)를 찾기 때문에 매핑을 늘 못 찾는다.
그 칸을 읽는 코드도 없다. 시도별 투영(`ShipmentShipped` → `coreShipmentAttempts`)이 같은 정보를 이미 쓰고 있다.
결정은 «고치지 않고 지운다»(2026-11-18 사용자, 이슈 본문).

## 목표 / 비목표

- 목표: 옛 투영의 소비자·inbox 처리부·Medusa 클라이언트 메서드·스펙·문서 줄을 지운다. 시도별 투영의 동작은 그대로 둔다.
- 비목표: core 의 `fulfillments.events.v1` 생산자와 계약은 건드리지 않는다(지운다면 따로, 소비자 먼저 배포한 뒤).
  Medusa 에 이미 있는 옛 칸 값도 건드리지 않는다.
- 실패의 모양: 시도별 투영의 `coreShippingStatus` 계산이 조금이라도 바뀌는 것.

## 접근

한 가지 길뿐이다 — 삭제. 고치는 길은 사용자가 기각했다(읽는 곳 없는 칸을 채우는 길이 하나 더 생긴다).

## 무엇을 지우나 (channel-adapter)

- `src/consumers/fulfillment-events.consumer.ts` + spec, `adapter.module.ts` 의 import·컨트롤러 등록.
- `src/adapters/medusa/inbox-worker.service.ts` — allowlist 의 `CoreFulfillmentShipped`·`CoreFulfillmentDelivered`, 두 `case`, spec 의 해당 케이스.
- `src/adapters/medusa/medusa.client.ts` — `updateOrderShippingProjection` 과 spec 의 v1 케이스.
- `apps/channel-adapter/CLAUDE.md` §4 구독 표의 `fulfillments.events.v1` 줄.

## 내가 정한 것 (사용자 확인함)

- `mergeCoreShippingStatus` 에서 `writer` 인자와 v1 갈래를 없앤다. 남는 동작은 지금 v2 호출과 같다:
  시도가 없으면 들어온 값, 기존이 `delivered` 면 `delivered`, 아니면 시도 배열에서 도출한 값.
- `EventFailuresModule.sequencedTopics` 에서 `FULFILLMENT_STREAM` 을 뺀다 — 이 앱이 더는 그 토픽을 소비하지 않는다.
- `EventsModule.forApp` 의 `publishes` 목록은 그대로 둔다(발행 쪽은 범위 밖).
- consumer lag 메트릭은 선언된 소비 토픽에서 도출되므로 따로 손볼 것이 없다.

## 배포

- 마이그 없음. channel-adapter 만.
- 배포 전 라이브(터널은 사용자가 띄움):
  `select event_type, status, count(*) from inbox_events where event_type in ('CoreFulfillmentShipped','CoreFulfillmentDelivered') group by 1,2;`
  `pending`·`processing` 이 남아 있으면 `published` 로 닫는다. 결과와 처리를 PR 본문에 적는다.

## 완료 조건

- `npm run type-check`·`npx jest` 0.
- 로컬 E2E 에서 자사몰 주문을 내보낸 뒤 `scripts/ops/emergency-outbound/local/compare.ts` 가 플래그 없이 통과.
- channel-adapter 로그에 `[CoreFulfillmentShipped]` 가 찍히지 않는다.
