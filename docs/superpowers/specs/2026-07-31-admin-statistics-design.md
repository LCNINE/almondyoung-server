# admin-web 통계 페이지 + analytics 집계 확장

- 브랜치: `feat/admin-statistics` (base `c6b9c0af6`)
- 스키마 변경: **7항목** (전부 추가형 — expand phase, `migrate → deploy`).
  `drizzle-kit generate` 는 이를 묶어 마이그레이션 파일 1건으로 낼 수 있다 — 파일 개수가 아니라 변경 항목 수다.
- 백필: **주문·멤버십 양쪽 수행** (전용 스크립트)
- 범위: 매출·주문 / 고객·멤버십 두 부문. 물류·CS 부문은 이번 범위 밖.

## 배경

admin-web 메뉴에 `판매/통계` 그룹이 **껍데기로만 존재한다** (`apps/admin-web/src/lib/utils/menu.ts:433`).
하위 9개 항목 전부 `path` 가 없어 클릭해도 아무 데도 가지 않는다.

| 기존 껍데기 항목 | 이번 범위 |
|---|---|
| 판매 현황 › 상품별 / 옵션별 / 기간별 | ✅ |
| 판매 현황 › 회원등급별 | ✅ |
| 애널리틱스 › 고객 행동 / 전환율 | ❌ 웹 행동 추적 데이터 부재 |
| 배송 통계 › 합배송 / 오배송 / 택배 사이즈 | ❌ 물류 부문 |

즉 신규 메뉴를 만드는 작업이 아니라 **이미 있는 뼈대를 채우는 작업**이다.

## 조사 결과

### analytics 는 이미 파이프라인이 서 있다

| 층 | 테이블 | 입자 |
|---|---|---|
| fact | `fact_order_events` | 이벤트 1건 (카프카 봉투 원본, `payload` jsonb) |
| fact | `fact_order_items` | 주문 품목 1줄 (금액·`variantId`·`customerId`) |
| agg | `agg_product_order_daily` | 날짜×상품×채널 |
| agg | `agg_user_product_purchase` | 고객×상품 |
| dim | `dim_product_masters` / `_variants` / `_categories` | 엔티티 1건 |

**다만 소비하는 이벤트가 `OrderCreated` 하나뿐이다** (`datasets/orders/ingest/order-events.consumer.ts:34`).
현재 상태로는 총주문액(GMV)만 나오고 취소·환불 차감이 불가능하다.

### 필요한 이벤트는 전부 이미 발행 중이다

**생산자와 이벤트 계약을 건드릴 필요가 없다.**

| 이벤트 | 발행 근거 |
|---|---|
| `OrderCancelled` | channel-adapter `order-event-routing.ts:17` 관문에 등재 (core `sales-order/consumers/order-events.consumer.ts:123` 이 소비 중) |
| `OrderRefundCreated` | 〃 관문에 등재 (core `:210` 소비 중) |
| `MembershipStatusChanged` | membership 아웃박스 발행 (channel-adapter `consumers/membership-event.consumer.ts:26` 이 소비 중) |

⚠️ **"소비 중" 은 발행의 근거가 아니다.** `orders.events.v1` 에 무엇이 실리는지의 단일 관문은
channel-adapter `order-event-routing.ts:17-22` 의 `ORDER_STREAM_EVENT_TYPES` 이며, 여기 없는
이벤트는 발행되지 않는다. 초안은 `OrderPaymentCompleted` 를 notification 이 소비한다는 이유로
발행 중이라 추론했으나 이는 오류였다 — 아래 "이번에 하지 않는 것" 참조.

`orders.events.v1` 의 생산자는 channel-adapter 다 (`order-event-routing.ts:3`).
**자사몰(Medusa) 주문도 channel-adapter 가 수집해 이 스트림으로 발행한다** — 사용자 구두 확인(2026-07-31).
따라서 이 스트림이 전 채널 주문의 단일 관문이며, analytics 가 매출의 단일 진실 공급원이 될 자격이 있다.

### fact → dim/agg 전파 메커니즘은 존재하지 않는다

이 설계의 백필 방식을 결정한 사실이다. 현재 구조는 **파생이 아니라 한 트랜잭션 안의 이중 쓰기**다.

```ts
// order-events.consumer.ts:44-51
await this.inTx(async (tx) => {
  const result = await this.orderFactsService.recordOrderCreated(envelope, payload, tx);
  if (!result.claimed) return;
  await this.orderAggregatesService.applyOrderCreated(result.seeds, tx);   // 컨슈머가 직접 호출
  await this.userPurchaseAggregatesService.applyOrderCreated(...);
});
```

fact 에 행이 들어가는 것을 감지해 agg 를 갱신하는 장치가 없다. 컨슈머가 양쪽을 각각 쓰고,
원자성은 트랜잭션이, 중복은 `claimed` 게이트가 막는다. fact 서비스가 반환하는 `seeds` 는
"이 이벤트로 인한 증분"이라 agg 서비스가 그대로 적용할 뿐 fact 를 다시 읽지 않는다.

쓰기 지점 전수 확인 — agg 2곳(`order-aggregates.service.ts:63`, `user-purchase-aggregates.service.ts:58`),
dim 3곳(`product-dimensions.service.ts:234·292·311`). **재계산·백필·리플레이 코드는 0건**
(`rebuild|recompute|backfill|replay` 전부 미검출).

추가로, **dim 은 애초에 fact 에서 파생되지 않는다.** products 파이프라인에는 fact 테이블이 없고
이벤트 → dim 직접이다.

**결론: fact 에 데이터를 부어넣어도 dim·agg 는 따라오지 않는다.** 백필은 "fact 를 채우는 것"이
아니라 "fact·dim·agg 를 한 세트로 채우는 것"이어야 한다.

### 멤버십 이벤트의 제약

`MembershipStatusChanged` 하나뿐이고 status 6종을 갖는다
(`packages/event-contracts/streams/membership.stream.ts:12` — `ACTIVE`/`PAUSED`/`RESUMED`/`CANCELLED`/`RECURRING_CANCELLED`/`EXPIRED`).

- `tierId` 가 **optional** (`:27`) → 등급 미상 버킷이 생긴다
- `OrderCreated.customerId` 는 **nullable** (`orders.stream.ts:234`) → 비회원 주문이 있다
- 주문은 `customerId`, 멤버십은 `userId` 로 필드명이 다르나 **같은 값** — 사용자 구두 확인(2026-07-31)

**상태가 바뀔 때만 발행된다는 점이 결정적이다.** 조용히 `ACTIVE` 를 유지 중인 기존 회원은
이벤트를 만들지 않으므로, 이벤트만으로는 등급 맵이 영원히 다 채워지지 않는다.
신규 가입은 괜찮다 — `subscription.creator.ts:51` 이 구독 생성 트랜잭션 안에서
`MembershipStatusChanged(ACTIVE)` 를 아웃박스에 기록한다.

같은 문제를 channel-adapter 가 먼저 겪었고 주기적 전수 동기화로 해결한 선례가 있다
(`internal-membership.controller.ts:52` — "전체 정합화 크론이 실시간 그룹동기화 이벤트 유실분을 복구").

### 연결 경로가 없다

- `apps/admin-web/src/app/api/proxy/` 에 analytics 프록시 부재
- analytics 컨트롤러는 `JwtAuthGuard` 하나뿐이라 관리자 RBAC 가 없다
- `GET /summary` 는 `NotImplementedException('TODO: 뭘 리턴하게 할지 고민중')` (`analytics.service.ts:20`)

### user 이벤트는 미사용

`packages/event-contracts/streams/user.stream.ts` 는 정의만 있고 발행·소비 흔적이 없다.
**회원 가입 추이는 analytics 로 끌어올 수 없고** user-service 직접 조회로 남긴다.

## 설계 결정

### analytics 가 통계의 주도권을 갖는다

```
channel-adapter ──orders.events.v1──┐
  (전 채널 + 자사몰 단일 관문)        │
                                    ├──> analytics ──> admin-web /statistics
membership ──membership.events.v1───┘         (신규 프록시 경유)
```

**명시적 예외 둘** — 흐리지 않고 문서에 못박는다:

1. **회원 가입 추이** → user-service 직접 조회 (user 이벤트 미발행)
2. **실시간 운영 현황** (오늘 미출고 등) → 홈 `MainTemplate` 위젯에 존치. 통계 페이지로 옮기지 않는다.

순수 대안 검토: **core 직접 집계**는 매출만 보면 더 빠르고 정확하지만 고객·멤버십 부문에서
막다른 길이다 — `users`(user-service) + `subscription_contracts`(membership) + 주문(core)이
서로 다른 DB라 어떤 서비스도 조인할 수 없고, 이벤트를 다 받는 서비스만 답할 수 있다.

### 등급은 박제하지 않고 이력 차원으로 조인한다

**주문 처리 시점에 등급을 fact 에 박아넣는 방식은 채택하지 않는다.** 그 방식은 소비 시점에
등급을 모르면 영원히 틀린 채로 남는데, 멤버십 구독 직후 주문이 몰리는 것이 정상 패턴이라
가장 중요한 구간이 정확히 누락된다.

대신 SCD Type 2 차원을 두고 조회 시점에 결합한다:

```sql
fact_order_items f
  JOIN dim_customer_membership m
    ON f.customer_id = m.user_id
   AND f.occurred_at >= m.valid_from
   AND (m.valid_to IS NULL OR f.occurred_at < m.valid_to)
```

등급 정보가 1분 뒤에 오든 하루 뒤에 오든, 도착 시 `valid_from` 이 구독 시작일로 기록되므로
**그 사이 주문이 자동으로 올바른 등급에 귀속된다.** 소급 정정이 공짜다.
부수 효과로 주문 소비 경로에서 멤버십 의존이 사라져 두 파이프라인이 독립적으로 돈다.

**트레이드오프: 등급별 매출만은 사전집계를 포기한다.** 등급이 나중에 정정될 수 있어 미리
구우면 틀린 값이 굳는다. 초기 데이터가 적고 등급별 매출은 초 단위 신선도가 불필요하므로
지금은 조인으로 충분하다. 데이터가 커지면 그때 agg 로 승격한다.

Kimball 분류로 정리하면 셋의 역할이 겹치지 않는다:

| 테이블 | 분류 | 답하는 질문 |
|---|---|---|
| `fact_membership_events` | transaction fact | "왜 해지했나" (사유 분포) |
| `dim_customer_membership` | SCD Type 2 dimension | "그때 몇 등급이었나" (주문 조인) |
| `agg_membership_daily` | periodic snapshot fact | "그날 몇 명이었나" (회원 수 추이) |

### 백필 — 주문·멤버십 양쪽 수행

전파 메커니즘이 없으므로 백필은 **fact·dim·agg 를 한 세트로** 채운다.
방식은 **합성 이벤트를 기존 처리 경로에 먹이는 것**이다.

원본 DB 를 읽어 이벤트 페이로드 모양으로 만든 뒤, 컨슈머가 호출하는 것과 **같은 서비스
메서드**를 호출한다. 집계 로직이 한 벌만 존재하므로 백필 결과와 실시간 결과가 어긋날 수 없다.
백필 전용 재계산 함수를 따로 두는 방식은 로직이 두 벌이 되어 "백필 구간만 숫자가 다른"
추적하기 어려운 버그를 만들므로 채택하지 않는다.

| 대상 | 원본 | 합성 이벤트 |
|---|---|---|
| 주문 | core `sales_orders`(`inventory.schema.ts:1109`) + `sales_order_lines`(`:1160`) | `OrderCreated`. 취소된 주문은 `status` 로 판정해 `OrderCancelled` 를 뒤이어 먹인다 |
| 멤버십 | membership `subscription_contracts` (`billingDate`·`createdAt`·`cancelledAt`·`status`·`planId`) | `MembershipStatusChanged`. 구독 시작·종료 구간을 복원 |

**멱등성 — 이벤트 종류마다 보장 수준이 다르다. 초안의 뭉뚱그린 주장은 틀렸다.**

합성 `messageId` 를 원본 키(주문은 `orderKey`, 멤버십은 `contractId`)에서 결정론적으로
생성한다. **백필을 두 번 돌리는 것**은 이것만으로 안전하다 — 두 번째 실행이 첫 번째와 같은
`messageId` 를 만들어 `claimed` 게이트에 걸린다.

문제는 **실시간 이벤트와 겹칠 때**다. 실제 이벤트의 `messageId` 는 카프카 생산자가 만든
ULID 라 백필이 만든 합성 값과 절대 같을 수 없으므로, `claimed` 게이트는 둘을 서로 다른
메시지로 보고 **양쪽 다 통과시킨다.**

| 이벤트 | 겹침 안전? | 이유 |
|---|---|---|
| `OrderCreated` | ✅ 안전 | `fact_order_items` 의 `uq_fact_order_items_order_item` (orderKey, salesChannel, orderItemId) 이 **두 번째 게이트**다. messageId 가 달라도 품목 insert 가 `onConflictDoNothing` 으로 전부 튕기고, `insertedItems.length === 0` 이면 seed 가 비어 집계가 돌지 않는다 (`order-facts.service.ts:161`) |
| `OrderCancelled` | ❌ **안전하지 않다** | 두 번째 게이트가 없다. 합성 취소는 다른 messageId 로 깨끗이 claim 되고, `cancelledAmount` 를 **한 번 더 차감한다.** 막을 것이 아무것도 없다 |

**계획 2 가 반드시 만족해야 할 요건 — 둘 중 하나를 택한다:**

1. **선행 확인**: 합성 취소를 먹이기 전에 그 주문에 대한 취소 봉투가 `fact_order_events` 에
   이미 있는지 조회하고, 있으면 건너뛴다. `idx_fact_order_events_order` 가 있으므로 비용은
   `orderId` 조건 하나다. `OrderFactsService.hasCancellationEnvelope` 가 이미 같은 조회를
   하고 있어 재사용 가능하다.
2. **동일 messageId 유도**: 합성 `messageId` 를 실제 이벤트도 만들어낼 값에서 유도한다.
   현실적으로 1번이 간단하다 — 실제 messageId 는 생산 시점에 생성되는 ULID 라 원본 DB 만
   보고 재현할 수 없다.

`OrderRefundCreated` 도 취소와 같은 부류다(두 번째 게이트 없음). 백필이 환불까지 합성하게
되면 같은 요건이 적용된다.

**스냅샷 동기화는 백필에 흡수된다.** 별도 경로를 두지 않으므로 "두 경로가 같은 dim 에
합류할 때의 중복 구간" 문제가 발생하지 않는다. 다만 드리프트 보정용 주기 실행은 유지한다.

### 백필 실행 형태 — 전용 스크립트

레포 관례를 따르되 연결 방식만 다르다.

```
npx tsx scripts/analytics-backfill/index.ts \
  --stage dev --deployment lcnine-services \
  [--orders] [--memberships] [--from YYYY-MM-DD] [--apply] [--allow-live]
```

- **dry-run 이 기본.** `--apply` 없이는 건수만 세고 쓰지 않는다 (`fix-lolliking-membership-flag.ts` 관례)
- `--allow-live` 없이 live stage 거부
- 진행 상황과 건너뛴 건수를 로그로 남긴다

**읽기는 `postgres` 직접, 쓰기는 analytics 서비스 호출**로 나눈다. 기존 스크립트들은
`buildDatabaseUrl`(`scripts/seeding/lib/db-connection`)로 직접 붙어 SQL 을 쏘지만, 백필이
그러면 집계 로직이 두 벌이 된다. 쓰기 측은 `NestFactory.createApplicationContext` 로 DI
컨텍스트를 얻어 기존 서비스를 호출한다.

**구현 시 확인 필요**: `AnalyticsModule` 을 그대로 부팅하면 Kafka 컨슈머까지 뜬다.
백필 전용 경량 모듈로 필요한 프로바이더만 임포트해야 한다. 레포에
`createApplicationContext` 선례가 없으므로 이 스크립트가 첫 사례가 된다.

### 고아 이벤트 방어는 여전히 필요하다

백필이 과거 주문을 채우므로 고아 취소는 크게 줄지만, **백필 시점 경계는 남는다** —
백필 커버리지 밖의 주문에 대한 취소가 들어오면 원본 없이 음수 증분만 더해져 해당 날짜
매출이 마이너스로 내려앉는다.

```ts
const original = await this.orderFactsService.findByOrderKey(payload.orderId, tx);
if (!original) {
  this.logger.warn(`백필 범위 밖 주문의 취소 — 건너뜀: ${payload.orderId}`);
  return;                          // agg 갱신하지 않음
}
```

건너뛴 건수를 로그로 남겨 추적 가능하게 한다.

### 멱등성 게이트 순서를 유지한다

신규 핸들러도 기존 순서를 지킨다 (`order-events.consumer.ts:44-51`):

```ts
const result = await this.orderFactsService.recordOrderCreated(envelope, payload, tx);
if (!result.claimed) return;                              // 중복이면 여기서 끊김
await this.orderAggregatesService.applyOrderCreated(result.seeds, tx);
```

`fact_order_events` 의 PK 가 `messageId` 라 재전송 시 insert 가 튕기고 `claimed: false` 가 된다.
agg 갱신이 그 뒤에 있어야 중복 가산이 막힌다.

### 스키마 변경 (7항목)

| # | 대상 | 내용 |
|---|---|---|
| 1 | `agg_product_order_daily` | `grossRevenue`·`cancelledAmount`·`refundedAmount` 컬럼 추가 — 현재 금액 컬럼이 없어 매출을 못 낸다 (`schema.ts:88-89`). 셋 다 writer 가 있다 (주문/취소/환불) |
| 2 | `agg_channel_daily` | 신규 — 날짜×채널: `grossRevenue`·`cancelledAmount`·`refundedAmount`·`ordersCount` |
| 3 | `agg_variant_order_daily` | 신규 — 날짜×옵션: 메뉴의 '옵션별' 항목용 |
| 4 | `agg_customer_lifetime` | 신규 — 고객 PK: 최초주문일·누적주문수·누적매출 |
| 5 | `fact_membership_events` | 신규 — `messageId` PK(멱등 게이트), `status`·`reasonCode`·`tierId` 보존 |
| 6 | `dim_customer_membership` | 신규 — `userId`·`tierId`·`validFrom`·`validTo`·`contractId`. `(userId, validFrom)` 유니크 |
| 7 | `agg_membership_daily` | 신규 — 날짜×status(6종)×tierId: 회원 수 추이 |

전부 추가형이라 ADR-0005 기준 expand phase 1개 PR 로 묶이고 순서는 **`migrate → deploy`** 다.

### 집계 입자는 KST 다

모든 `agg_*_daily.aggDate` 는 **`Asia/Seoul` 기준 달력 날짜**다. UTC 가 아니다.

UTC 로 버킷을 나누면 00:00–09:00 KST 에 들어온 주문이 전부 전날로 밀린다 — 한국 시장에서
이 구간은 무시할 수 있는 꼬리가 아니라 매일 아침 9시간치 매출이므로, 일별 그래프가 상시
어긋난다. 레포 관례도 `Asia/Seoul` 이다 (`apps/core/src/modules/inventory/shared/services/time.util.ts`
의 `SEOUL_TZ`).

구현은 `apps/analytics/src/shared/date.util.ts` 의 `toSeoulDateOnly` 한 곳뿐이며,
**날짜 키를 만드는 모든 경로가 이 함수를 거쳐야 한다.** 특히 백필(계획 2)이 자체 날짜 계산을
하면 백필 구간과 실시간 구간의 경계에서 하루가 어긋나 이어붙지 않는다.

조회 측(계획 3)도 기간 필터를 KST 로 계산해야 한다 — `agg_date` 가 KST 인데 필터 경계를
UTC 로 잡으면 구간 양 끝에서 하루가 새거나 겹친다. 기존 `product-ranking.query.ts:68` 의
90일 롤링 필터가 아직 UTC 계산이라 계획 3 에서 정리 대상이다.

### 집계 테이블은 비대칭이다 — 표 사이의 숫자를 더하지 말 것

**모든 집계 테이블이 같은 금액 컬럼을 갖고 있지 않다.** 계획 3 이 이걸 모르면 조용히
틀린 화면을 만든다.

| 테이블 | grossRevenue | cancelledAmount | refundedAmount | 순매출을 낼 수 있나 |
|---|---|---|---|---|
| `agg_channel_daily` | ✅ | ✅ | ✅ | ✅ 완전 |
| `agg_product_order_daily` | ✅ | ✅ | ✅ | ✅ 완전 |
| `agg_variant_order_daily` | ✅ | ❌ | ❌ | ❌ **총매출뿐** |
| `agg_customer_lifetime` | ✅ (`totalRevenue`) | ❌ | ❌ | ❌ **총매출뿐** |

의도된 설계다. 옵션 단위 취소·환불은 이벤트가 라인 단위 귀속 정보를 충분히 싣지 않고,
고객 생애값은 "이 고객이 지금까지 얼마를 샀나" 라는 총량 지표라 감액 개념이 다르다.

**따라서 계획 3 은 두 가지를 지켜야 한다:**

1. **표를 가로질러 숫자를 합치지 말 것.** 옵션별 매출의 합 ≠ 상품별 매출의 합 ≠ 채널별
   매출의 합. 총매출끼리는 맞지만 순매출은 애초에 두 표에만 존재한다. 검증 화면에서
   "합계가 안 맞는다" 는 버그가 아니라 이 비대칭이다.
2. **옵션·생애 지표를 절대 `순매출` 로 라벨링하지 말 것.** `총매출`/`누적 구매액` 으로
   표기한다. 취소·환불이 빠지지 않은 숫자에 순매출 라벨을 붙이면 같은 화면 안에서 두
   지표가 서로 다른 정의로 나란히 놓인다.

### 취소는 취소일에 귀속된다 — 원주문일이 아니다

`order-facts.service.ts:237-238` 이 `cancelledAt` 으로 날짜 버킷을 잡는다. 즉 6월 주문이
오늘 취소되면 **오늘** 의 `cancelledAmount` 가 올라가고 6월 행은 그대로 남는다.

정당한 event-date accounting 이고 원장이 append-only 라는 성질과도 맞다(과거 행을 사후
수정하지 않는다). 다만 계획 3 이 반드시 알아야 할 귀결이 둘 있다:

1. **일별 순매출이 음수가 될 수 있다.** 주문이 적은 날 큰 과거 주문이 취소되면
   `grossRevenue = 0, cancelledAmount = 큰 값` 인 하루가 만들어진다. 버그가 아니다.
   차트에서 0 으로 clamp 하거나 음수 구간을 별도 표기해야지, 방어 코드로 숨기면 안 된다.
2. **취소환불률은 코호트 교차 비율이라 1 을 넘을 수 있다.** 분자(그날 취소된 금액)와
   분모(그날 주문된 금액)의 모집단이 다르다. 기간을 넓게 잡을수록 안정되지만 일 단위에선
   튄다. 100% 로 clamp 하거나 "해당 기간에 발생한 취소 / 해당 기간 주문액" 이라는 정의를
   화면에 명시한다.

원주문일 귀속이 필요해지면 `fact_order_items` 를 조인해 원주문 날짜로 되돌릴 수 있다 —
fact 를 남겨두는 이유 중 하나다. 사전집계를 그 입자로 다시 굽는 것은 이번 범위 밖이다.

### 화면 구조

```
/statistics/layout.tsx      ← 기간 필터 + 채널 필터 + 탭바 + 데이터 커버리지 배지
  ├ /statistics/sales       매출 개요
  ├ /statistics/products    상품
  └ /statistics/customers   고객·멤버십
```

- 필터는 URL 쿼리(`?from=&to=&channel=`)에 실어 탭 전환 시 유지되고 링크 공유가 된다
- 홈 `MainTemplate` 은 "오늘 처리할 일" 운영 위젯으로 존치 — 통계와 목적·신선도가 달라 섞으면 둘 다 애매해진다
- 메뉴 매핑: 기간별→`sales`, 상품별·옵션별→`products`, 회원등급별→`customers`

**데이터 커버리지 배지는 필수 사양이다.** 백필 시작일 이전 데이터는 존재하지 않는다는 사실이
화면에 드러나야 한다.

### 지표 목록

**탭 1 — 매출 개요**

| 요소 | 형태 | 출처 |
|---|---|---|
| KPI 4종 (아래 산식) | 타일 + 전기간 대비 증감 | `agg_channel_daily` |
| 매출 추이 | 시계열 (총매출/순매출 2선) | 〃 |
| 채널별 매출 비중 | 가로 막대 (정렬) | 〃 `salesChannel` 축 |
| 채널별 추이 비교 | 다중 시계열 | 〃 |
| 취소·환불 사유 분포 | 가로 막대 | `OrderCancelled.reason` (fact 스캔) |

KPI 산식 — 전부 `agg_channel_daily` 컬럼의 뺄셈·나눗셈으로 유도한다:

| 지표 | 산식 |
|---|---|
| 순매출 | `grossRevenue - cancelledAmount - refundedAmount` |
| 주문수 | `ordersCount` |
| 객단가 | 순매출 / `ordersCount` |
| 취소환불률 | `(cancelledAmount + refundedAmount) / grossRevenue` — **금액 기준** (건수 기준 아님) |

**탭 2 — 상품**

| 요소 | 형태 | 출처 |
|---|---|---|
| 상품 랭킹 (판매량·매출·주문수) | 정렬 가능 테이블 | `agg_product_order_daily` + `dim_product_masters` |
| 카테고리별 매출 구성 | 가로 막대 | + `dim_product_categories` 조인 |
| 옵션별 판매 | 테이블 | `agg_variant_order_daily` — **총매출만** (위 비대칭 표 참조) |
| 급상승·급하락 상품 | 증감률 테이블 | agg 기간 비교 |

**탭 3 — 고객·멤버십**

| 요소 | 형태 | 출처 |
|---|---|---|
| 신규 vs 재구매 매출 비중 | 시계열 (누적 영역) | `agg_customer_lifetime` |
| 재구매율 | 타일 + 추이 | 〃 |
| 고객 생애 구매액 분포 | 히스토그램 | 〃 |
| 회원 수 추이 | 시계열 (status 6종) | `agg_membership_daily` |
| 해지 사유 분포 | 가로 막대 | `fact_membership_events.reasonCode` |
| 등급별 매출·객단가 | 막대 | `fact_order_items` ⋈ `dim_customer_membership` (시점 조인) |
| 회원 가입 추이 | 시계열 | user-service 직접 (analytics 예외) |

차트의 "형태"는 데이터 모양에서 도출한 잠정안이다. **색상 팔레트·축 처리·다크모드 대응 등
시각화 규격은 구현 단계에서 `dataviz` 스킬로 확정한다.**

## 이번에 하지 않는 것

메뉴에 남기되 `isComingSoon` 을 유지한다.

- **결제 전환율 (`paidOrdersCount`)** — **생산자가 존재하지 않는다.** `orders.events.v1` 에 무엇이
  실릴지 결정하는 단일 관문인 channel-adapter `order-event-routing.ts:17-22` 의
  `ORDER_STREAM_EVENT_TYPES` 는 `OrderCreated`·`OrderModified`·`OrderCancelled`·`OrderRefundCreated`
  네 종만 나열하며, 레포 전체에 `OrderPaymentCompleted` 를 발행하는 코드가 없다. notification 이
  이 타입을 소비한다는 사실은 발행의 증거가 아니다 — **소비는 생산을 함의하지 않으며**, 초안이
  이 지표를 넣은 것은 바로 그 잘못된 추론 때문이었다. 따라서 핸들러·집계 메서드·`paidOrdersCount`
  컬럼을 전부 제거했다. 되살리려면 먼저 생산자(그리고 위 관문 등재)가 필요하다.
- **고객 행동·전환율** — 웹 행동 추적 데이터가 없다. 수집부터 시작하는 별도 프로젝트.
- **배송 통계** — `fulfillments` 스트림 기반 물류 부문.
- **시간대·요일별 주문 분포** — agg 가 일 단위라 시간축이 없다. 데이터가 쌓인 뒤 재검토.
- **주문 쪽 리플레이 도구 일반화** — 백필 스크립트가 사실상 첫 리플레이 도구가 되지만,
  범용화는 이번 범위 밖이다. 구조만 확장 가능하게 둔다.
- **dim upsert 의 순서 역전 방어** — 아래 별건 참조.

## 별건으로 발견한 결함

`product-dimensions.service.ts:234` 의 upsert 에 `where` 절이 없다:

```ts
await tx.insert(dimProductMasters).values(values).onConflictDoUpdate({
  target: dimProductMasters.masterId,
  set,                    // ← where 조건 없음
});
```

`lastEventAt` 컬럼을 두고 값도 넣지만 **가드로 쓰이지 않는다.** 카프카 이벤트 순서가 뒤집혀
도착하면(재시도·파티션 리밸런싱) 오래된 이벤트가 최신 상태를 덮어쓴다. `deletedAt`·`isActive` 가
뒤집히면 삭제된 상품이 통계에 되살아나 보일 수 있다. **별도 이슈로 등록한다.**

## 구현 단계

| 단계 | 내용 | 배포 의존성 |
|---|---|---|
| 1. 집계 토대 | 스키마 7항목 + 이벤트 4종 소비 + 고아 방어 | `migrate` → analytics |
| 2. 백필 | 전용 스크립트 (주문·멤버십), dry-run 검증 후 `--apply` | 1단계 배포 후 |
| 3. 조회 API | 탭별 read-model 쿼리, `GET /summary` 해소 | analytics |
| 4. 연결 | `api/proxy/analytics/[...path]` + 관리자 RBAC 가드 | admin-web·analytics |
| 5. 화면 | 공통 셸(필터·탭바) → 탭 3개 | admin-web |
| 6. 배선 | `menu.ts` 껍데기에 `path` 부여, 불가 항목 `isComingSoon` 유지 | admin-web |

1~3단계가 끝나면 화면 없이 API 로 숫자를 검증할 수 있다.
**백필은 1단계 배포 이후에 돌린다** — 신규 컬럼과 테이블이 존재해야 한다.

## 검증

- **멱등성** — 같은 이벤트 2회 투입 시 agg 가 한 번만 반영되는지 (기존 `user-purchase-aggregates.service.spec.ts` 패턴 재사용)
- **백필 멱등성** — 백필을 두 번 돌려도 수치가 변하지 않는지. 실시간 이벤트와 겹칠 때 중복 가산이 없는지
- **백필 정합성** — 백필 구간의 집계 결과가 원본 DB 직접 집계와 일치하는지 (표본 대조)
- **고아 취소** — fact 없는 취소 이벤트가 agg 를 건드리지 않는지
- **음수 순매출** — 과거 주문이 오늘 취소된 날의 순매출이 음수로 내려가는지. **막는 것이 아니라
  화면에서 다루는 것이 목표다** (위 "취소는 취소일에 귀속된다" 참조)
- **시점 조인** — 구독 직후 주문이 올바른 등급에 귀속되는지
- **DLQ** — 새로 소비하는 3종(`OrderCancelled`·`OrderRefundCreated`·`MembershipStatusChanged`)의 payload 가 zod 검증을 통과하는지. `libs/events` 가 소비 시점에 런타임 검증하므로 지금껏 아무도 소비하지 않던 payload 는 여기서 처음 throw 날 수 있다
- **브라우저 검증** — 세 탭을 실제로 띄워 확인. 완료 조건에 포함한다

## 리스크

| 리스크 | 대응 |
|---|---|
| 백필 스크립트가 운영 DB 를 읽는 중 부하 | 배치 크기 제한 + dry-run 선행. 야간 실행 권장 |
| `AnalyticsModule` 부팅 시 Kafka 컨슈머 기동 | 백필 전용 경량 모듈로 프로바이더 격리 (구현 시 확인 필요) |
| `tierId` optional → 등급 미상 | "미상" 을 숨기지 않고 별도 항목으로 표시 |
| 비회원 주문(`customerId` null) | 고객 지표 분모에서 제외하고 비중을 함께 표기 |
| analytics 장애 시 페이지 전체 실패 | 탭별 독립 쿼리 + 에러 경계. 홈 운영 위젯은 영향 없음 |
| **analytics 가 상시 가동 서비스가 됨** | 지금까지 사실상 비필수였으나 통계가 의존하면 다운타임이 곧 기능 장애. 진행 중인 AWS 비용 절감과 상충하는 지점이라 사전 인지 필요 |

## 완료 정의

세 탭이 실데이터로 렌더되고, 백필이 완료되어 수치가 원본과 대조 검증되었으며,
멱등성·고아 취소·시점 조인 테스트가 통과하고, 브라우저에서 세 탭을 눌러 확인했으며,
DLQ 에 신규 유입이 없는 상태.
