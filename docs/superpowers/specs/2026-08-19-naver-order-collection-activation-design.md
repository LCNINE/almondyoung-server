# 네이버 주문 수집 개통과 격리 큐 운영 화면 (#643 · #640)

- 날짜: 2026-08-19
- 이슈: #643 (네이버 `ChannelOrderSource`) · #640 (미매핑 격리 큐 화면) · 신규 1건 (취소 계약)
- 선행: #639 · #599 · #652 · #654 · #656 · #674 (전부 종결)
- 관련: ADR-0031 · CONTEXT.md §채널 상품 식별 실패 · §Payment Accepted · §주문취소

## 1. 문제

ADR-0031 이 수집 경로를 `OrderPollerOrchestrator → ChannelOrderSource → ChannelOrderTranslator → 공용 아웃박스`
하나로 좁혔고 source 구현체는 `MedusaOrderSource` 뿐이다. 네이버 자리는 비어 있다.

코드 선행은 전부 해소됐고 남은 차단 요인은 데이터다 — `channel_variant_listings` 의 네이버 행이 **0행**이고,
네이버는 `lineIdentity: 'mapped'` 라 전 라인이 수기 매핑에 의존한다. 매핑 없이 켜면 수집은 성공하고 전 라인이 격리된다.
그런데 격리를 볼 화면이 없다 (`grep '/adapter/' apps/admin-web/src` → 0건).

## 2. 착수 전 확정한 사실

| 사실 | 근거 | 영향 |
|---|---|---|
| 개통 스위치는 코드가 아니라 DB 다 | `order-poller.orchestrator.ts:60-88` — 폴러가 매 주기 Core 에 활성 채널을 묻고 비활성 채널은 워터마크도 안 건드리고 건너뛴다 | 배포와 개통을 분리할 수 있다. shadow 점검이 공짜가 된다 |
| naver 행이 이미 `is_active=true` | 2026-08-18 실측 | **배포 전에 내려두지 않으면 배포 즉시 수집이 시작된다** |
| admin-web → channel-adapter 프록시가 이미 있다 | `apps/admin-web/src/app/api/proxy/channel/[...path]/route.ts`, auth 쿠키 전달 기본값 `true` | #640 "인증 경로" 판정 불필요 |
| 조치에 필요한 Core API 가 다 있다 | `channel-listing.controller.ts` — `POST /`, `PUT /:id/activate`, `PUT /:id/deactivate` | 화면이 조치를 끝낼 수 있다 |
| 네이버 주문 상세 zod 가 `z.any()` 다 | `naver.order.zod.ts:170-186` | 상세 스키마를 새로 써야 한다. 필드명이 저장소에 없다 |
| `ProductOrderStatusSchema` 에 `DISPATCHED` 가 없다 | `naver-core.zod.ts:209-219` (옛 매핑 `naver-smartstore.adapter.ts:756` 에는 있다) | 발송 후 상태 변경이 parse 에서 깨진다 |
| Core 는 부분취소를 이미 구현해뒀다 | `cancel-sales-order.dto.ts:16-25`, `partial-cancellation-refund-calculator.ts`, `fulfillments.service.ts:432` | 라인 개념을 새로 만들 필요가 없다 |
| 라인의 채널 좌표도 이미 있다 | `inventory.schema.ts:1324,1343` (`channel_order_item_id` + 부분 unique), `channel-order.translator.ts:116` | 채널 라인 ID → `salesOrderLineId` 해석이 단건 확정이다 |
| 옛 `/adapter` REST 는 읽기 전용이다 | `channel-adapter.controller.ts` 의 `queryOrders` 는 `channelReader.findOrders` 만 부른다 | 이중 수집 위험 없음 |

## 3. 전략

**운영 전략은 lazy 매핑이다** (사용자 결정). 사전 전량 매핑을 하지 않고, 미매핑 주문이 들어올 때마다 그 자리에서 등록한다.
네이버 스토어는 실판매 중이고 주문량은 적다.

그 결과:

- 일괄 등록 도구는 **스코프 밖**이다 (YAGNI). Core 리스팅 API 는 단건 POST 뿐이고 그걸로 충분하다.
- **개통의 유일한 전제는 #640 화면의 품질**이다. 개통 초기엔 사실상 모든 주문이 한 번씩 격리를 거치므로
  "격리 → 매핑 등록 → 재수집" 한 바퀴가 몇 초 안에 끝나야 한다.
- 재처리 트리거는 **화면이 조치 후 replay 를 호출**한다 (후보 A). Core 가 리스팅 생성 이벤트를 내고
  channel-adapter 가 자가 재처리하는 안(후보 B)은 새 계약이 붙는 데 비해 원인 9종 중 `listing_not_found`
  하나만 덮는다. replay 는 이미 멱등적이라(이미 수집됨 → `closed_already_collected`) 중복 클릭이 안전하다.
- **shadow 점검을 개통 전에 한 번 끼운다** (§7). 문서만 보고 쓴 zod 의 정확성을 실 응답으로 바꾸는 유일한 수단이고,
  킬스위치 덕분에 비용이 10분이다.

## 4. 작업 단위와 배포 순서

| # | 단위 | 앱 | 마이그레이션 |
|---|---|---|---|
| 1 | 취소 계약 + Core 소비자 (§5) | `@packages/event-contracts`, core | 0 |
| 2 | `NaverOrderSource` (§6) | channel-adapter | 0 |
| 3 | 격리 큐 화면 (§8) | admin-web (+ `@packages/domain-types`, channel-adapter 소폭) | 0 |

**배포 순서: 1 → 2 → shadow(§7) → 3 → 개통.** 1이 2보다 먼저인 것은 안전 요건이다 (§5 마지막).
개통은 코드가 아니라 `sales_channels.is_active` 를 올리는 운영 행위다.

## 5. 취소 계약 + Core 소비자

### 5.1 문제

`OrderCancelledPayload` (`orders.stream.ts:118`) 에는 라인 범위가 없다. 그래서 소비자는 항상 전체 취소를 부른다
(`order-events.consumer.ts:173`). 네이버는 `productOrder` 단위 부분취소가 흔하므로 그대로 두면 **멀쩡한 라인까지 취소**된다.

Core 의 의미론은 이미 `lines` 유무로 갈린다 — `lines` 가 있으면 `cancelPartial`, 없으면 전체 취소
(`sales-orders.service.ts:440,1211`). 그 축을 그대로 계약에 옮긴다.

### 5.2 계약

```ts
// OrderCancelledPayload 에 선택 필드 추가
cancelledLines?: Array<{ channelOrderItemId: string; quantity: number }>;
```

선택 필드 추가라 소비자 zod 런타임 검증에 걸리지 않는다 (값이 늘어나는 enum/literal 이 위험한 축이고, 이건 아니다).

### 5.3 소비자

`handleOrderCancelled` 가 `cancelledLines` 를 `sales_order_lines.channel_order_item_id` 로 조회해
`salesOrderLineId` 로 바꾼 뒤 `cancel(id, { lines })` 로 넘긴다.
`(salesOrderId, channelOrderItemId)` 부분 unique 인덱스가 있어 조회는 단건 확정이다.
해석 실패는 `NotFoundException` — 이미 `nonRetryableErrors` 라 무한 재시도로 가지 않는다.

### 5.4 배포 순서가 안전 요건인 이유

**옛 Core 소비자는 `cancelledLines` 를 모르므로 부분취소를 전체 취소로 실행한다.** 조용한 데이터 사고다.
따라서 `Core → channel-adapter` 순서가 강제이며, 네이버 개통은 그 뒤다.

## 6. `NaverOrderSource` (#643)

**파일**: `apps/channel-adapter/src/services/order-collection/naver-order.source.ts`,
`implements ReplayableChannelOrderSource`, `readonly channel: SalesChannel = 'naver'`.
등록은 `adapter.module.ts:269` provider 배열에 `createOrderProvider(naverSource, translator)` 한 줄.

### 6.1 grain 이 어긋난다 — 조회가 3단계다

네이버의 1급 단위는 `productOrderId`(라인)이고 `orderId`(주문)는 상위다. `getLastChangedStatuses` 는 **변경된 라인만** 준다.
그대로 주문으로 접으면 3라인 주문 중 1라인만 바뀐 주기에 **라인이 하나뿐인 판매주문**이 Core 에 생긴다.

```
getLastChangedStatuses(since) → productOrderId[] → orderId 로 그룹핑
  → orderId 마다 getProductOrderIdsByOrderId(orderId)   # 형제 라인 복원 (naver-order.client.ts:227)
  → getOrderDetails(전체 productOrderIds)                # 상세 (naver-order.client.ts:187)
```

호출이 늘지만 주문량이 적으므로 완전성을 택한다.

### 6.2 결제 상태

CONTEXT.md:130 의 "결제 실패 위험을 벗어난 상태" 를 네이버에 대입한다.
발주확인은 판매자의 수락 행위지 결제 위험이 아니므로 게이트로 쓰지 않는다.

| 네이버 `productOrderStatus` | `ChannelPaymentState` |
|---|---|
| `PAYED` `DISPATCHED` `DELIVERING` `DELIVERED` `PURCHASE_DECIDED` | `accepted` |
| `PAYMENT_WAITING` | `pending` |
| `CANCELED` `CANCELED_BY_NOPAYMENT` `RETURNED` | `terminal` |

`ProductOrderStatusSchema` 에 **`DISPATCHED` 를 추가**한다.

### 6.3 취소 관측

- 관측 시점에 **전 라인 취소** → full 1건 (`cancelledLines` 생략), `eventKey='cancelled'`.
- **일부 취소** → 취소된 **라인마다** partial 1건, `eventKey='cancelled:<productOrderId>'`.
  라인 단위 키라 중복 계수가 정확하다.
- 환불(`OrderRefundCreated`)은 첫 판에서 제외한다. 네이버 클레임 상태 19종 해석은 별건이다.

### 6.4 취소된 라인을 스냅샷에서 빼지 않는다

**🔴 빼면 change hash 가 바뀌어 부분취소가 `collected_order_modification_not_accepted` 로 오격리되고,
그 사유는 replay 가 거부한다** (`order-poller.orchestrator.ts:271`). 취소 이벤트와 이중 처리이기도 하다.

따라서:

- `ChannelOrderLineSnapshot` 에 `cancelled?: boolean` 을 더한다.
- translator 의 `payload.items` 는 **살아있는 라인만** (최초 수집 시 죽은 라인을 계약에 넣지 않는다).
- translator 의 `changes` 해시는 **전 라인 기준** — 취소가 modification 을 유발하지 않는다.

Medusa 는 `cancelled` 를 쓰지 않아 값이 그대로다. 즉 기존 해시 계약이 깨지지 않으므로
배포 직후 한 주기가 통째로 격리되는 사고가 없다 (`channel-order.translator.spec.ts` 가 그 계약을 못 박고 있다).

### 6.5 라인 조립

- `channelOrderItemId` = `productOrderId` — 발송처리 명령이 되돌려받는 값.
- `channelProductId` = **옵션 단위 식별자 우선, 없으면 상품 식별자.** 정본 값은 §7 shadow 로 확정하고,
  그때까지 후보를 상수 하나로 격리해 둔다. 운영자가 실제로 등록하는 값과 같아야 한다.
- `productName` · `quantity` · `unitPrice` 는 채널 값을 싣는다 (금액은 채널이 SoT — CONTEXT.md:126).
- `customerId` 는 `null` 고정. 네이버 구매자는 user-service 계정이 아니고, 이메일 링크는 오결합 위험 대비 이득이 없다.

### 6.6 워터마크

- `since=null`(최초) → `now - 1h`. 과거를 소급하면 이미 수기 처리된 주문이 중복 유입된다.
- `since` 가 24시간보다 오래됐으면 `now - 24h` 로 clamp. 네이버 변경조회는 장기 구간을 거부한다.

### 6.7 zod 전략과 실패 정책

상세 스키마를 새로 쓴다. 저장소는 zod 4 이므로 `z.looseObject` 로 **우리가 읽는 필드만 검증하고 나머지는 통과**시킨다.

문서 기반이라 필드명이 틀릴 수 있는데, 방어선은 **parse 실패를 삼키지 않는 것**이다.
throw 하면 `recordSyncFailure` 가 남고 **워터마크가 그대로**라 5분 뒤 재시도된다 (무손실).
격리 사유 union 을 늘리지 않는다 — 격리는 식별 실패의 어휘이지 파싱 실패의 어휘가 아니다.

### 6.8 `fetchOrder(orderId)`

같은 3단계의 단건 판. replay 가 이걸로 산다. 구현하지 않으면 `replayFailure` 가
`No replayable order provider registered` 로 throw 하므로 **후처리 가능성 자체가 이 메서드에 달려 있다**.

## 7. shadow 점검 (개통 전 1회, 10분)

**목적**: 문서 기반 zod 를 실 응답으로 검증하고 `channelProductId` 정본 값을 확정한다.

1. 배포 전 `sales_channels` 의 naver 행을 **`is_active=false`** 로 내린다.
2. Core(§5) → channel-adapter(§6) 순으로 배포.
3. naver 를 `is_active=true` 로 올리고 **한 주기(5분)만** 돌린 뒤 다시 내린다.
4. 확인:
   - `sync_statuses` naver/orders 행의 `last_sync_at` · `error` — parse 실패가 여기 남는다.
   - `order_collection_failures where channel='naver'` — 행이 생겼는가, `affected_lines[].cause` 가 전부 `listing_not_found` 인가.
   - 그 행의 **`raw_order`** 로 필드명·옵션 식별자 확인 → `channelProductId` 확정.
   - `wms_order_mappings where sales_channel='naver'` 가 **0행**인가 (리스팅 0행이므로 판매주문은 안 생겨야 정상).

넷 중 하나라도 어긋나면 §6 으로 돌아가 고치고 다시 shadow.

**⚠️ shadow 와 개통 사이가 24시간을 넘으면 주문이 샌다.** shadow 가 워터마크를 남기는데 개통이 24시간 뒤면
`now-24h` clamp 에 걸려 그 사이 주문이 조회 범위 밖으로 빠진다. 개통 직전에 하거나, 늦어지면 개통 전에
naver/orders `sync_statuses` 행을 지워 최초 수집(`now-1h`)으로 되돌린다.
shadow 에서 격리된 주문은 행이 남으므로 개통 후 화면에서 처리하면 된다.

## 8. 격리 큐 운영 화면 (#640)

**위치**: `/mall/channel-listings` 에 탭 2개 ("채널 리스팅" / "미매핑 주문").
`page.tsx`(12줄) + `features/mall/channel-listings/template` 구조가 이미 있어 그 안에서 확장한다.

**데이터 경로**: 기존 `/api/proxy/channel` 프록시 재사용.
`lib/api/domains/` 에 `order-collection-failures.client.ts` 를 더하고 react-query 훅은 기존 패턴을 따른다.
새 env · CORS · 게이트 없음.

**목록**: 주문 단위 행 — 채널 / 외부주문번호 / 변경시각 / 사유 / 라인 수.
기본 필터 `status=quarantined`, 나머지 3종(`replayed` `closed_lifecycle` `closed_already_collected`)은 "닫힘" 으로 접는다.
`collected_order_modification_not_accepted` 행은 **재처리 버튼이 없는 별도 표시** —
`replayFailure` 가 `not_replayable` 로 응답하는 사유라 버튼을 주면 헛수고다.

**상세**: 라인별 `cause` → 조치 문구 + 조치 버튼.
화면에서 바로 끝나는 것은 `listing_not_found`(매핑 생성) · `listing_inactive`(활성화) · `channel_inactive`(채널 활성화)이고,
나머지는 문구로 안내만 한다. `affected_lines` 가 없는 옛 행은 "사유 없음" 을 정상 상태로 렌더한다.

`no_active_version` 은 갈래를 판정하지 않고 둘 다 적는다 — Core `resolve` 는 "의도적 판매중지" 를 구분할 데이터를 주지 않는다:

> 활성 버전이 없습니다. 판매를 재개하려면 publish, 판매중지가 맞다면 네이버에서 해당 상품을 내리세요.

### 8.1 `AffectedLine` 에 `channelProductId` 를 더한다

지금 `affected_lines` 는 `{ lineId, cause }` 뿐이고 `lineId` 는 주문 라인 ID(`productOrderId`)다.
매핑 생성에 필요한 **채널상품ID 는 `raw_order` 안에만** 있어서, 프리필하려면 admin-web 이 채널별 원본 구조를 파싱해야 한다 —
채널 지식이 프런트로 새는 결합이다.

대신 `@packages/domain-types` 의 `AffectedLine` 에 선택 필드 `channelProductId?` 를 더한다.
translator 는 해석에 실패한 바로 그 키를 손에 쥐고 있으므로 저장 비용이 0 이고,
**"운영자가 등록하는 값 = 수집이 조회한 값" 이 구조적으로 보장된다** — #643 판정 1과 #640 프리필을
한자리에서 맞추라는 요구가 이걸로 충족된다. 옛 행은 값이 없으므로 선택 필드다.

### 8.2 조치 → 재처리

조치 API 성공 후 `POST /adapter/order-collection-failures/:id/replay` 를 이어서 호출하고,
응답 6종(`replayed` `already_processed` `still_quarantined` `closed_terminal` `closed_already_collected` `not_replayable`)을
사람 말로 번역해 보여준다.

### 8.3 격리 건수 배지

lazy 매핑 전략이면 운영자가 큐를 놓치는 순간 그 주문의 출고가 멈춘다.
사이드바 메뉴에 격리 건수 배지를 붙인다 (목록 API 의 `count` 재사용, 비용 0).
알림·메일은 YAGNI 로 뺀다.

## 9. 확정한 판정

| # | 판정 | 결론 | 근거 |
|---|---|---|---|
| 1 | `channelProductId` 정본 값 | 옵션 단위 우선, **shadow 로 확정** | 옵션 상품이면 옵션 단위여야 variant 와 1:1 |
| 2 | `paymentState` 경계 | `PAYED` 이후 accepted | CONTEXT.md:130 |
| 3 | `customerId` | `null` 고정 | 네이버 구매자는 user-service 계정이 아니다 |
| 4 | lifecycle 범위 | 취소 포함, 환불 제외 | 오출고 방지가 우선, 클레임 19종은 별건 |
| 5 | 재처리 트리거 | 화면이 조치 후 replay 호출 | 원인 9종을 한 버튼으로 덮는다 |
| 6 | 인증 경로 | 기존 `/api/proxy/channel` | 선례가 있고 auth 쿠키를 넘긴다 |
| 7 | `no_active_version` 문구 | 두 갈래를 다 적는다 | 판정할 데이터가 없다 |
| 8 | 개통 시퀀싱 | `is_active` 로 배포와 개통을 분리 | 폴러가 매 주기 활성 채널을 묻는다 |

## 10. 함정

- 🔴 **배포 전 naver `is_active` 를 내리지 않으면 배포 즉시 수집이 시작된다.**
- 🔴 **Core 선배포를 어기면 부분취소가 전체 취소로 실행된다** (§5.4).
- 🔴 **취소된 라인을 스냅샷에서 빼면 오격리 + 이중 처리** (§6.4).
- 🔴 **`OrderFetchItem.changes` 에 네이버 원어를 넣지 말 것.** 해시 입력이라 모양이 바뀌면 한 주기 주문이 전부
  `collected_order_modification_not_accepted` 로 격리되고 그 사유는 replay 가 거부한다.
- ⚠️ shadow 와 개통 사이 24시간 (§7).
- ⚠️ `sync_statuses.last_sync_at` 은 하트비트가 아니다. 폴링이 아무것도 못 잡으면 갱신되지 않는다 — 살아있는지는 `updated_at` 으로 본다.
- ⚠️ 증분 수집은 워터마크에서 2분 되감아 조회한다. 중복은 `wms_order_mappings` + change hash 가 흡수한다.
- ⚠️ `provider.channel as ChannelType` 캐스팅 때문에 `sync_statuses.channel_type` 에 `'naver'` 가 들어간다
  (`ChannelType` union 은 `'naver_smartstore'`). 워터마크는 같은 값으로 읽고 쓰므로 동작은 맞지만,
  옛 `naver_smartstore` 키로 보는 화면·대시보드에는 안 보인다.
- ⚠️ admin-web 은 컴포넌트 테스트가 불가능하다 (렌더러 없음 + `.tsx` transform 밖).
  **테스트가 초록이어도 배선이 살아있다는 근거가 되지 않는다.**

## 11. 검증

**자동**

- `npm run type-check` → 0
- `npx jest --maxWorkers=2` → 실패 0 (OOM 방지)
- `npm run test:admin-web` → 실패 0
- `naver-order.source.spec.ts` — 문서 기반 픽스처로:
  ① 3라인 중 1라인만 변경돼도 3라인이 조립되는가 ② 부분취소 시 lifecycle 이 라인 단위로 나가는가
  ③ 전체취소 시 terminal + full 취소 1건 ④ 미지 상태값에서 throw ⑤ `since=null` 바닥값과 24h clamp
- translator 스펙 — 취소 라인이 `items` 에서 빠지고 `changes` 해시에는 남는가
- Core 소비자 스펙 — `cancelledLines` → `salesOrderLineId` 해석, 해석 실패 시 `NotFoundException`
- admin-web `.ts` 순수 함수 스펙 — 사유→조치 문구, 상태→재처리 가능 여부, replay 결과→문구, 필터 조립

**수동 (유일한 방어선)**

- 브라우저: 빈 목록 / `affected_lines` 없는 옛 행 / 라인 여러 개 / `not_replayable` 건 / 프리필 후 생성 → 자동 재처리
- 개통 후: 폴러 `updated_at` age, `failed_syncs` +0, 신규 격리 건수, 첫 격리 건의 해소 한 바퀴

## 12. 미결 / 후속

- **부분취소 누적이 전량에 도달하는 경계.** `lines` 를 주면 항상 `cancelPartial` 이고, 누적이 전량이 돼도
  주문 상태를 `cancelled` 로 닫지 않는다 (`sales-orders.service.ts:1217-`). 마지막 라인이 취소되는 순간
  full cancel 이 오면 Core 가 "남은 수량만" 취소하는지 확인이 필요하다. 안전하지 않으면
  "전량 취소 시 주문 종결" 은 채널과 무관한 Core 도메인 규칙으로 별건 처리한다 — admin 수기 부분취소에도 같은 구멍이다.
- **환불 lifecycle** (`OrderRefundCreated`) — 네이버 클레임 상태 19종 해석과 함께 별건.
- **`/channel-listings/lookup` 폴백 제거** — Core `/resolve` 배포가 안정된 뒤 후속 PR.
- **#641** (`variantCode` notNull 승격 + 리스팅 키 이관) — 장기, 이 작업과 독립.
- **#665** (publish 중 동시 `createListing` 레이스) — 개통 후 창이 넓어진다.
