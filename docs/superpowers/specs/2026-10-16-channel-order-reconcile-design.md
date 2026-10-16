# 채널 주문 대사 — 채널엔 있는데 core 에 없거나 취소가 안 닿은 주문을 원인과 무관하게 찾고 다시 배달한다 (#1016 45번)

트래킹: #1016 45번(채널에서 수집했는데 core 에 판매주문이 없는 주문, 채널에선 취소됐는데 core 에선 취소 안 된 주문을 **원인과 무관하게** 찾는 대사가 없다).
관련: 7·8번(이벤트 실패 출구, `docs/superpowers/specs/2026-10-15-event-failure-exits-design.md`) — 그 스펙 D1 이 이 행을 따로 떼어 두었다. 13번(정체 보드, `docs/superpowers/specs/2026-10-06-order-stall-board-design.md`). 판단 10(채널 주문의 정본은 채널).

출발점은 develop `7479ebb6b` 의 코드다.

## 1. 배경

### 1.1 core 에 없는 주문은 어디에도 안 보인다

정체 보드의 단계 판정은 `sales_orders` 에서 시작한다(`apps/core/src/modules/fulfillment/order-progress/order-progress.judge-sql.ts` 의 `so` CTE).
판매주문(SO)이 생기지 않은 주문은 보드에 없다. 0단계 «수집» 칸은 channel-adapter 의 수집 격리(`order_collection_failures`) 건수만 센다(정체 보드 스펙 D9).
7·8번의 «이벤트 실패» 화면은 **메시지를 보내거나 소비하다 실패한 것**만 잡는다. 메시지가 아예 안 나갔거나 컨슈머가 실패 없이 넘어간 주문은 못 본다.

### 1.2 주문이 빠지는 자리

- **매핑은 있는데 SO 가 없다.** 폴러는 `wms_order_mappings` 삽입·`OrderCreated` 적재·해시 기록을 한 트랜잭션에서 한다(`order-poller.orchestrator.ts` `processOrderItem`).
  매핑 행은 «보냈다»는 뜻이지 «core 에 생겼다»는 뜻이 아니다. 그 뒤 어느 단계에서 사라져도 다음 폴링은 «이미 넘긴 주문»으로 본다.
- **취소가 매핑 없이 왔다.** `processLifecycleItem` 은 매핑이 없으면 로그만 찍고 아무것도 남기지 않는다.
- **core 가 취소를 못 받았다.** core 의 `OrderCancelled` 처리는 SO 를 못 찾으면 재시도하지 않는다(`order-events.consumer.ts`, `NotFoundException` 비재시도). 어댑터는 그 취소를 «처음 본 것만 보낸다»(`claimFirstSeen`)로 이미 기록했으므로 다시 안 보낸다.

### 1.3 지금 있는 «다시 끌어오기»로는 대부분 안 고쳐진다

`syncOrder(channel, externalOrderId, { force })`(`POST /adapter/orders/:channel/:externalOrderId/sync`, `ResyncChannelOrder` 명령)는 폴링과 같은 처리를 태운다. 그래서:

| 경우 | `syncOrder` 가 하는 일 | 고쳐지나 |
| --- | --- | --- |
| 어댑터가 못 본 주문(매핑 없음) | `OrderCreated` 적재 | 고쳐진다 |
| 매핑 있음 · SO 없음 | 매핑이 있으니 `OrderModified` 적재 → core 는 SO 가 없어 NotFound | 안 고쳐진다 |
| 채널 취소 · core 미취소 | lifecycle 은 `claimFirstSeen` 이라 `force` 와 무관하게 다시 안 낸다 | 안 고쳐진다 |

따라서 이 행의 조치는 «다시 끌어오기»가 아니라 **«다시 배달하기»**다(§6).

### 1.4 두 서비스는 서로의 DB 를 못 읽는다

core 와 channel-adapter 는 같은 RDS 의 다른 논리 DB 다(`dbUrl('core')`·`dbUrl('channel_adapter')`). dblink·fdw 는 없다.
의존 방향은 한쪽뿐이다 — 어댑터는 core 를 안다(`SalesChannelClient` → `GET /internal/channels/active-sites`, 내부 키). core 는 어댑터를 HTTP 로 부르지 않고 명령 토픽에 낼 뿐이다.

## 2. 목표와 성공 기준

1. 최근 3일 안에 갱신된 Medusa 주문 중 «core 에 있어야 하는데 없는 것», «취소됐는데 core 에선 취소 안 된 것»을 30분 안에 찾는다
2. 찾은 것을 정체 보드 0단계 칸과 «채널과 어긋남» 목록에서 볼 수 있다
3. 실행 모드에서는 이중 출고 위험이 없는 범위에서 사람 없이 다시 배달하고, 다음 주기에 풀렸는지 확인한다
4. 자동으로 못 푸는 것은 사람이 [다시 배달] 또는 [종결]로 닫을 수 있다 — 이 행이 «출구 없는 칸»을 새로 만들지 않는다
5. core 는 어댑터를 알지 않는다(의존 방향 유지)
6. core 가 죽어 있어도 수집 폴링은 영향받지 않는다
7. `npm run type-check` 에러 0 · `npx jest` 실패 0 · admin-web `tsc --noEmit` 0

## 3. 결정 (사용자 결정 2026-10-16)

| # | 질문 | 결정 | 기각한 안과 이유 |
| --- | --- | --- | --- |
| D1 | 무엇과 맞춰 보나 | **채널 자체(Medusa API)와 core SO** | 어댑터 기록(매핑·해시)과 core: 어댑터가 못 본 주문을 놓친다 — «원인과 무관하게»와 어긋난다 |
| D2 | 대사를 어디에 두나 | **channel-adapter.** core 에는 «어댑터 → core» 방향의 묶음 조회 API 하나만 더한다 | core 에 둔다: core 가 채널 목록을 알기 위해 어댑터나 Medusa 를 불러야 한다(역방향 결합) / core 가 SO 사실을 이벤트로 내고 어댑터가 사본을 쌓는다: 첫 백필과 사본 어긋남이 새 문제가 된다 |
| D3 | 반대 방향(core 는 취소, 채널은 아님)도 하나 | **안 한다.** 35번 «이미 어긋난 주문 대조» 체크박스를 일회성 읽기 전용 스크립트로 따로 닫는다 | 넣는다: 35번 뒤로 새로 생길 수 없고, 조치가 «다시 배달»이 아니라 사람 판단이며, 상시 0 인 칸이 는다 |
| D4 | 자동인가 버튼인가 | **자동. 관찰 모드로 먼저 배포**하고 거짓 양성 0 을 본 뒤 규칙마다 실행 모드로 바꾼다(리컨실러 관례) | 보드 버튼만: 사람이 매번 눌러야 하고 정체 보드 D8(보드엔 조치 없음)과 어긋난다 |
| D5 | 자동 범위 | **«core 에 없음»은 채널 생성 3일 안의 주문만 자동.** 그보다 오래된 건 «사람 확인» | 무제한: 셀메이트로 이미 나간 옛 주문이 지금 SO 가 되면 출고 대기열에 올라 이중 출고 후보가 된다 |

### 3.1 설계 중 코드에서 나온 결정

- **D6 — «취소 미반영»은 나이와 무관하게 자동이다.** D5 의 위험은 SO 를 «새로 만드는» 데서 온다. 취소를 다시 보내는 건 출고를 막는 쪽이다.
  대신 core SO 상태가 `pending`·`confirmed` 일 때만 자동이다. `shipped`·`delivered` 는 셀메이트 스크립트가 쓴 값이고(SO 의 코드상 전이는 `pending → confirmed → cancelled` 뿐) 그 SO 에 취소를 보내면 core 가 거절하므로 «사람 확인»이다.
- **D7 — 그래서 훑는 창은 «생성» 이 아니라 «갱신» 3일이다.** 취소는 생성보다 늦게 오고, Medusa 의 `updated_at` 은 취소 때 바뀐다. 생성 3일로 훑으면 10일 된 주문의 오늘 취소를 못 본다.
- **D8 — 이벤트 실패가 열린 주문은 다시 배달하지 않는다.** 7·8번은 주문 생애 토픽을 `aggregateId`(= 어댑터의 `wmsOrderId`)로 줄 세운다(`sequencedTopics`).
  같은 주문의 outbox `FAILED`(어댑터)나 dead letter `failed`·`held`(core)가 남아 있으면 다시 보낸 이벤트도 그 뒤에 보류된다.
  그 주문의 출구는 «이벤트 실패» 화면이므로, 대사는 시도를 세지 않고 «사람 확인 — 이벤트 실패 열림»으로 둔다.

## 4. 구성

```
channel-adapter                                         core
┌───────────────────────────────────────────┐          ┌──────────────────────────────────┐
│ ChannelOrderReconcileJob (@CronOnce 30분)  │          │ POST /internal/sales-orders/lookup│
│   ① Medusa: updated_at > now-3d 주문 목록  │          │   (InternalOnly, 최대 200건)       │
│   ② 판정(순수 함수) ── 기대값 ──────────────┼─ HTTP ──▶│   SO 상태 · 이벤트 실패 열림 여부   │
│   ③ 불일치 기록 order_reconcile_findings   │          └──────────────────────────────────┘
│   ④ (실행 모드) 다시 배달 → outbox ─────────┼─ Kafka ─▶ orders.events.v1 (기존 컨슈머)
│   ⑤ 열린 불일치 해소 확인(core 조회만)      │
│ order-reconcile-findings 컨트롤러          │◀─ admin-web «채널과 어긋남» 목록·정체 보드 0단계
└───────────────────────────────────────────┘
```

## 5. 찾기

### 5.1 주기와 대상

- channel-adapter 에 `@CronOnce('*/30 * * * *', { name: 'channel-order-reconcile' })`. 앱 루트가 이미 `CronOnceModule` 을 import 한다.
- 활성 채널만 본다 — 폴러와 같은 `SalesChannelClient.getActiveSites()`, 실패하면 그 주기를 건너뛴다(fail-closed).
- 대상 채널은 «대사 가능한 source»를 구현한 채널이다. 이번엔 `medusa` 만 구현한다(naver 는 비활성, 4번·2번 행과 함께 개통 때).
- Medusa 조회는 `GET /admin/orders` 를 `updated_at > now - 3일` 로 페이지 단위(100) 조회한다. `MedusaClient.listOrders` 의 `isCollectableOrder` 거르기와 `ORDER_FIELDS` 를 그대로 쓴다. admin API 는 #855 로 store 와 분리된 인스턴스에 간다.

### 5.2 유예 — 아직 오는 중인 주문은 건너뛴다

주문의 `updated_at` 이 다음 둘 중 **늦은 시각**보다 뒤면 이번 주기엔 판정하지 않는다.

- `now - 30분`
- 그 채널 폴러 워터마크 `sync_statuses.last_sync_at - 2분`(폴러 lookback). 폴러가 멈춰 있으면 그 사이 주문은 폴러가 따라잡을 몫이고, 폴러 정체는 대사가 아니라 폴러 쪽 문제다

### 5.3 판정 — 폴러와 같은 해석을 쓴다

기대값을 따로 구현하지 않는다. source 가 폴링 때 만드는 스냅샷(`ChannelOrderSnapshot.paymentState`·lifecycle 관측)을 그대로 입력으로 받는 **순수 함수**로 판정한다.

입력: 채널 스냅샷, 어댑터 매핑 유무(`wmsOrderId`), 열린 수집 격리 유무, 어댑터 outbox 의 그 주문 `FAILED` 유무, core 조회 결과(SO 상태 또는 없음, core 이벤트 실패 열림 여부), 지금 시각.

| 채널 상태 | core | 결과 |
| --- | --- | --- |
| `paymentState = 'accepted'` | SO 없음 | **`missing_order`** |
| `paymentState = 'accepted'` | SO 있음 | 정상 |
| `pending`(무통장 입금 대기·환불 신청 등) | — | 정상(원래 core 에 없다) |
| 취소 관측 있음 · 매핑 없음 | SO 없음 | 정상(수집 전에 끝난 주문) |
| 취소 관측 있음 · 매핑 있음 | SO 없음 | **`missing_order`** — SO 가 생겨야 취소도 닿는다 |
| 취소 관측 있음 | SO `cancelled` | 정상 |
| 취소 관측 있음 | SO 그 밖 | **`cancel_not_applied`** |

먼저 거르는 것: 열린 수집 격리가 있는 주문(0단계 격리 칸에 이미 보인다).

«취소 관측 · 매핑 있음 · SO 없음»을 `missing_order` 로 두는 이유: SO 를 만들어야 그 뒤 취소가 닿는다. 다시 배달은 `OrderCreated` 뒤 `OrderCancelled` 를 같은 순서 키로 이어서 낸다(§6.2).

### 5.4 처리 방식 — 자동인가 사람인가

불일치마다 `handling` 을 정한다.

| 종류 | 자동(`auto`) 조건 | 아니면 사람(`human`) — 사유 |
| --- | --- | --- |
| `missing_order` | 채널 주문 생성이 3일 안 | `out_of_window` |
| `cancel_not_applied` | core SO 가 `pending`·`confirmed` | `core_status`(셀메이트 `shipped` 등) |
| 공통 | 어댑터 outbox `FAILED` 없음 · core 이벤트 실패 열림 없음 | `event_failure_open` |
| 공통 | 시도 3회 미만 | `attempts_exhausted` |

`event_failure_open` 은 일시 상태다 — 이벤트 실패가 종결되면 다음 주기에 다시 `auto` 로 돌아온다. 나머지 사유는 한번 붙으면 사람이 닫을 때까지 남는다.

### 5.5 core 묶음 조회 API

`POST /internal/sales-orders/lookup` — core, `@InternalOnly()`(기존 `SalesChannelsInternalController` 와 같은 내부 키). Swagger 제외.

```ts
// 요청
{ salesChannel: 'medusa' | 'naver' | 'coupang', orders: { externalOrderId: string; wmsOrderId?: string }[] } // 1~200건
// 응답
{ orders: { externalOrderId: string; salesOrder: { status: OrderStatus } | null; openEventFailure: boolean }[] }
```

- `salesOrder` 는 `sales_orders(sales_channel, channel_order_id)` unique 로 찾는다. 상태 말고는 싣지 않는다 — 주소·고객 정보는 판정에 필요 없다.
- `openEventFailure` 는 `wmsOrderId` 가 있을 때만 의미가 있다: core `event.dead_letters` 에 `topic = orders.events.v1`, `sequence_key = wmsOrderId`, `status in ('failed','held')` 행이 있으면 참.
- 이 API 는 core 가 어댑터를 아는 게 아니라 «내부 호출자에게 SO 존재를 알려 주는» 것이다 — 호출자가 누구인지 모른다.

## 6. 다시 배달하기

### 6.1 모드

규칙 둘(`missing_order`, `cancel_not_applied`)이 **각자** `mode: 'observe' | 'act'` 상수를 가진다. 첫 배포는 둘 다 `observe`.
관찰 모드는 불일치를 기록하고 `last_result = 'would_act'` 만 남긴다. 아무것도 적재하지 않고 시도 수도 세지 않는다.

### 6.2 경로

모두 어댑터 DB 한 트랜잭션에서 outbox 적재와 불일치 행 갱신(시도 수 +1, `last_attempt_at`, `last_result`)을 함께 한다.

- **`missing_order` · 매핑 없음** → 기존 `syncOrder(channel, externalOrderId)`. 폴링과 같은 경로라 매핑·`OrderCreated`·해시가 생긴다.
- **`missing_order` · 매핑 있음** → 새 경로 `redeliverOrderCreated`. 채널에서 주문을 새로 가져와(`fetchOrderForSync`) 번역하되 `orderId` 를 **기존 `wmsOrderId`** 로 고정하고 `OrderCreated` 를 적재한다. 매핑·해시는 건드리지 않는다.
  번역기의 `orderId: uuidv4()`(`channel-order.translator.ts`)에 «주어진 id 를 쓴다» 입력을 더한다. 그 주문에 취소 관측이 있으면 이어서 `OrderCancelled` 도 같은 트랜잭션에 적재한다(같은 `aggregateId` 라 순서가 지켜진다).
- **`cancel_not_applied`** → 새 경로 `redeliverLifecycle(eventKey='cancelled')`. 채널에서 주문을 새로 가져와 취소 관측을 만들고, `claimFirstSeen` 을 건너뛰고 `OrderCancelled` 를 적재한다. 해시 행은 그대로 둔다.

core 쪽은 바꾸지 않는다. `OrderCreated` 는 `findByChannelOrderId` 로 멱등이고, 다시 보낸 `OrderCancelled` 는 새 메시지 id 라 `order_events` 중복 검사를 지나 `salesOrdersService.cancel` 로 간다.

### 6.3 확인과 포기

- 다음 주기의 해소 확인(§7.2)이 풀렸는지 본다. 풀리면 `resolved`.
- 안 풀리고 시도가 3회에 닿으면 `handling = 'human'`, 사유 `attempts_exhausted`.
- 적재된 이벤트가 소비 단계에서 실패하면 core «이벤트 실패» 화면에도 따로 잡힌다. 그때부터는 D8 에 따라 `event_failure_open` 이 된다.

## 7. 기록

### 7.1 `order_reconcile_findings` (channel-adapter)

| 칸 | 타입 | 뜻 |
| --- | --- | --- |
| `id` | uuid PK | |
| `channel` | varchar | `medusa` 등 |
| `external_order_id` | varchar | 채널 주문 id |
| `display_order_no` | varchar null | 목록 표시용(Medusa `display_id`) |
| `kind` | varchar | `missing_order` · `cancel_not_applied` |
| `status` | varchar | `open` · `resolved` · `closed` |
| `handling` | varchar | `auto` · `human` |
| `human_reason` | varchar null | `out_of_window` · `core_status` · `event_failure_open` · `attempts_exhausted` |
| `core_status` | varchar null | 마지막 조회의 SO 상태(없으면 NULL) |
| `channel_created_at` | timestamptz | 채널 주문 생성 시각(D5 판정) |
| `mode` | varchar | 마지막 판정 때의 규칙 모드 |
| `last_result` | varchar null | `would_act` · `enqueued` · `skipped` · 오류 요약 |
| `attempt_count` | int default 0 | 실행 모드 시도 수 |
| `first_seen_at` · `last_seen_at` · `last_attempt_at` | timestamptz | |
| `resolved_at` · `closed_at` | timestamptz null | |
| `closed_by` · `close_memo` | varchar null | 사람 종결(메모 필수, 500자) |

- unique `(channel, external_order_id, kind)` **where `status = 'open'`**(부분 unique). 닫힌 뒤 같은 어긋남이 다시 생기면 새 행이다.
- 인덱스 `(status, handling)` — 요약 집계용.
- 새 테이블만 더하므로 additive(expand) 마이그 1건.

### 7.2 해소 확인

매 주기 끝에, 나이와 무관하게 **열린 행 전부**를 core 묶음 조회로만 다시 본다(Medusa 는 다시 부르지 않는다).
`missing_order` 는 SO 가 생기면, `cancel_not_applied` 는 SO 가 `cancelled` 가 되면 `resolved`.
`event_failure_open` 인 행은 그 플래그가 꺼지면 `handling` 을 다시 판정한다.

## 8. 보이기와 사람의 출구

### 8.1 정체 보드 0단계

어댑터 `GET adapter/order-collection-failures/summary` 옆에 `GET adapter/order-reconcile-findings/summary` 를 둔다. 응답은 `{ open, human, gaveUp, oldestFirstSeenAt }` 이다(`gaveUp` = `human_reason = 'attempts_exhausted'`).
admin-web 의 «수집» 칸은 두 요약을 합친다.

- `open` = 격리 + 열린 불일치
- `stuck` = 격리 + `human` 불일치
- `gaveUp` = `attempts_exhausted`

칸을 누르면 링크가 둘이 된다: «수집 격리»(기존 `/mall/channel-listings`) · «채널과 어긋남»(새 목록). 보드에는 여전히 조치 버튼을 두지 않는다(D8 유지). 0 인 쪽 링크는 숨긴다.

### 8.2 «채널과 어긋남» 목록

admin-web `/order/channel-mismatches`. 메뉴엔 넣지 않고 보드에서 들어온다.
칸: 주문번호(`display_order_no`, 없으면 채널 id), 종류(«core 에 없음» / «취소 미반영»), 첫 발견, 시도 수, 처리(자동 / 사람 — 사유). 기본은 `open` 만, 종결·해소 보기는 토글.

조치(사람 행에만, admin·master):

- **[다시 배달]** — §6.2 경로를 창(D5)·모드와 무관하게 한 번 실행한다. 3일 밖 주문은 이 버튼으로만 끌어온다 — 셀메이트로 안 나갔는지 사람이 확인하고 누른다.
  `event_failure_open` 이면 409 와 함께 «이벤트 실패 화면에서 먼저 처리» 안내.
- **[종결]** — 메모 필수(500자). «셀메이트로 이미 나감» 같은 경우. 닫힌 행은 해소 확인에서 빠진다.

API: `GET adapter/order-reconcile-findings`, `GET …/summary`, `POST …/:id/redeliver`, `POST …/:id/close`. 인가는 기존 `order-collection-failures` 컨트롤러와 같은 데코레이터·`GlobalExceptionFilter`.

## 9. 처음 한 번 — 전체 기간 훑기

배포 직후 한 번, 같은 판정으로 전체 기간을 훑어 옛 불일치를 목록에 올린다.
어댑터 내부 키 엔드포인트 `POST /internal/order-reconcile/sweep { channel, updatedAfter }` — 항상 관찰 모드로 돌고(설정과 무관) 다시 배달하지 않는다.
3일 밖 `missing_order` 는 `human / out_of_window` 로 들어간다. 결과 건수는 #1016 «남은 운영 작업»에 적는다.

## 10. 관찰 → 실행 전환

- 배포 PR 이 #1016 «남은 운영 작업»에 **«45번 `missing_order` 실행 모드 전환»·«45번 `cancel_not_applied` 실행 모드 전환»** 체크박스 둘을 단다.
- 전환 조건: 관찰 기간의 `would_act` 행을 실제와 대조해 거짓 양성 0, 근거를 전환 PR 본문에. 참 양성 0 이면 그 사실도 적는다.
- **이슈 본문의 «아직 관찰 모드인 규칙» grep 명령이 core 경로만 본다.** 이 규칙들은 어댑터에 있으므로 명령에 `apps/channel-adapter/src/services/order-reconcile` 를 더한다. 라이브 SQL 블록에도 어댑터 DB 의 `select kind, mode, last_result, count(*) from order_reconcile_findings group by 1,2,3` 를 더한다.

## 11. 배포

- channel-adapter `db:migrate`(새 테이블) → `sst deploy`. **`migrate → deploy`** — 뒤집히면 대사 작업과 요약 API 가 없는 테이블을 읽어 실패한다(수집 폴링은 무관).
- core 조회 API 는 순서가 무관하다. 어댑터가 먼저 떠서 404 를 받으면 그 주기를 건너뛴다.
- admin-web 은 어댑터 요약 API 가 404 면 그 몫을 0 으로 보지 않고 «알 수 없음»으로 둔다(기존 격리 요약과 같은 처리).
- 배포 뒤: §9 훑기 → 결과 기록.

## 12. 테스트

- **판정 순수 함수** — 표 §5.3·§5.4 의 각 칸. 무통장 입금 대기, 환불 신청, 수집 전 취소, 매핑 있는 취소 + SO 없음, 셀메이트 `shipped` 취소, 30분 유예, 폴러 워터마크 뒤, 생성 3일 경계, 열린 격리, 이벤트 실패 열림.
- **다시 배달 경로** — 통합 스펙(`describeIfDb`): 매핑 있는 주문의 `OrderCreated` 가 기존 `wmsOrderId` 로 적재되고 매핑·해시가 그대로인지, `OrderCancelled` 가 `claimFirstSeen` 을 건너뛰어 적재되는지, outbox 와 불일치 행 갱신이 한 트랜잭션인지(적재 실패 시 시도 수 불변).
- **관찰 모드** — 적재 0, `would_act` 기록, 시도 수 불변.
- **core 조회 API** — 내부 키 없으면 401, 200건 초과 400, `openEventFailure` 판정. 라우트 인가 가드 명단(`npx jest scripts/security`)에 올린다.
- **로컬 E2E** — 로컬 core 에서 Medusa 주문의 SO 를 하나 지우고, 관찰 모드가 `missing_order / would_act` 로 잡고 목록·보드에 뜨는지 본다. 실행 모드로 바꿔 SO 가 다시 생기고 `resolved` 되는지 본다.

## 13. 범위 밖

- 반대 방향(core 는 취소, 채널은 아님) — D3. 35번 체크박스의 일회성 스크립트.
- naver·쿠팡 대사 — source 인터페이스만 열어 두고 개통 때 구현.
- 수량·배송지 등 내용 불일치 — 5번(채널 변경 diff)의 몫.
- Grafana 알림 — 7·8번과 함께 미뤄 둔 알림 작업에 «`human` 불일치 > 0» 을 더할지 그때 정한다.
