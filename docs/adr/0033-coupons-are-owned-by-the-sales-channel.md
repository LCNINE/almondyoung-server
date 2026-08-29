# 쿠폰은 판매채널이 소유한다 — 판정은 Medusa 안에서 하고, 밖은 사건만 알린다

자사몰 쿠폰을 core 나 다른 서비스의 사건과 엮으려 할 때마다 "쿠폰 데이터를 어디에 두는가" 가 다시 열린다. 이 저장소에는 이미 익숙한 두 패턴이 있어서 — 상품은 core 가 정본을 갖고 채널로 복제하고, 주문은 채널이 정본을 갖고 core 가 수집한다 — 쿠폰도 둘 중 하나일 거라고 읽게 된다. **쿠폰은 둘 다 아니다.** 이 ADR 은 그 이유를 적고, 다음에 같은 질문이 열리지 않도록 경계를 못 박는다.

[[0013-sales-channels-hold-commerce-projections]] 를 뒤집지 않는다. 그 ADR 의 "Core 가 commerce SoT, 판매채널은 projection" 은 **상품·재고·주문**에 대한 문장이고, 쿠폰은 그 목록에 없다. [[0031-channel-capability-vector-and-listing-ownership]] 의 어휘를 그대로 쓴다 — Medusa 가 다른 것은 소유 구조가 아니라 능력이며, 쿠폰은 그 능력 표에 아직 축으로 올라오지 않은 항목이다.

이 ADR 은 문서다 — 코드 변경 0건, 마이그레이션 0건. 지금의 구현은 이미 아래 결정과 일치한다. 새로 정하는 것이 아니라, 흩어져 있어 매번 다시 논의되던 것을 한 곳에 적는다.

## 왜 상품·주문의 패턴이 쿠폰에 걸리지 않는가

두 패턴은 각각 다른 동인에서 나왔다. 동인을 꺼내 보면 쿠폰이 왜 다른지가 보인다.

**상품이 core → 채널로 복제되는 동인은 "여러 채널이 같은 실체를 필요로 한다" 이다.** 같은 상품이 네이버에도 쿠팡에도 자사몰에도 올라간다. 실체가 하나인데 거처가 여럿이라 정본이 필요하다.

**주문이 채널 → core 로 넘어오는 동인은 "다른 컨텍스트가 그 데이터에 작용해야 한다" 이다.** WMS 가 물건을 실제로 보내야 한다. 읽는 것을 넘어 처리해야 하니 이쪽으로 와야 한다.

**쿠폰은 둘 다 해당되지 않는다.** 네이버 쿠폰은 네이버가, 쿠팡 쿠폰은 쿠팡이 소유한다 — 공유될 실체가 없다. 그리고 쿠폰이 적용된 *결과*는 이미 주문에 실려 넘어온다 — core 가 쿠폰 자체에 대해 할 일이 없다. 복제 동인이 0이다.

측정이 이를 뒷받침한다. 쿠폰이라는 개념은 오늘 Medusa 밖으로 한 발자국도 나가 있지 않다:

- core `sales-order` 스키마에 discount / promotion / coupon 컬럼 **0개**
- analytics · wallet · ugc-service · membership 에 쿠폰을 아는 파일 **0개**
- 이벤트 계약이 나르는 것은 `discountAmount: number` **하나뿐** (`packages/event-contracts/streams/orders.stream.ts:84`)

밖으로 나가는 것은 쿠폰이 아니라 **할인된 금액**이다. 그것은 쿠폰이 아니라 주문의 사실이다.

## Decision

### 1. 쿠폰의 SoT 는 그 쿠폰이 사는 채널이다. 복제본을 만들지 않는다

자사몰 쿠폰의 정본은 Medusa 다. 네이버·쿠팡 쿠폰의 정본은 각 마켓플레이스다. **core 에 쿠폰 테이블을 만들지 않으며, 캐시·미러·읽기모델도 만들지 않는다.**

채널이 소유한다는 것은 채널이 사라지면 그 쿠폰도 함께 사라진다는 뜻이고, 그것이 정상이다. core 에 복제해 두면 채널을 걷어낼 때 참조할 곳 없는 고아 데이터가 남는다.

`apps/core` 의 `promotions` / `promotion_products` 테이블은 이 결정의 대상이 아니다. 그것은 쿠폰이 아니라 **상품 가격 한시 할인(타임세일)** 이고, 오늘 완전히 휴면이다 — `catalog.schema.ts:716` 에 `pgTable` 정의는 있으나 `catalogSchema` 집합 객체에 미포함이라 코드에서 접근할 경로가 없다. 둘을 같은 것으로 읽지 말 것.

### 2. 쿠폰에 대한 모든 판정은 Medusa 안에서 한다

"이 고객에게 이 쿠폰을 줘도 되는가", "이미 줬는가", "수량이 남았는가", "이 고객이 쓸 수 있는가" — 전부 Medusa 안에서 답한다. 오늘 이미 그렇다:

| 판정 | 구현 |
|------|------|
| 중복 발급 차단 | `promotion_issue_log` 의 `(customer_id, promotion_id)` partial unique |
| 대상 그룹 검증 | `meetsGroupRule()` — list · claim · 자동발급 전 경로 |
| 선착순 수량 | `reserveClaimSlot()` — `UPDATE … WHERE issued_count < max_claims RETURNING` 원자적 예약 |
| 사용 권한 | customer-promotion remote link 존재 여부 |
| 사용량·예산 | Medusa campaign budget (`usage` / `spend` / `use_by_attribute`) |

**이 결정이 복제를 불필요하게 만드는 지점이다.** 판정을 밖으로 꺼내려 하면 "밖이 보유 현황을 알아야 한다" 가 되고, 그때 비로소 복제본이 필요해 보인다. 판정을 안쪽에 두면 그 요구 자체가 생기지 않는다. **밖의 서비스는 쿠폰을 읽을 필요가 없고 알릴 필요만 있다.**

### 3. 밖에서 안으로 — 사건만 알린다

다른 서비스가 쿠폰 발급을 유발하고 싶을 때, 그 서비스는 **자기 도메인의 사실**만 발행한다. "쿠폰을 발급하라" 라는 명령을 보내지 않는다.

```
user-service          core / ugc / membership …
  UserEmailVerified     (도메인 사건)
        │                     │
        └──── Kafka ──────────┘
                  ▼
          channel-adapter          ← Medusa 는 Kafka 를 직접 받지 않는다
            inbox (멱등·재시도)
                  ▼
          POST /admin/customers/:id/issue-coupons
                  ▼
              Medusa 가 판정
```

`UserEmailVerified` 는 "쿠폰 주세요" 가 아니라 "이 사람 이메일이 인증됐다" 이다. user-service 는 쿠폰이 존재하는지조차 모른다. **어떤 사건에 어떤 쿠폰이 나가는지는 Medusa 의 `promotion_meta.auto_issue_trigger` 가 정한다** — 보상 정책이 마케팅 쪽에 남는다.

**core 는 Medusa 를 계속 모른다.** 오늘 core 에 Medusa HTTP 클라이언트는 0곳이고, `medusa` 라는 문자열은 판매채널 enum 값 하나로만 나온다(`inventory.schema.ts:174`). core 가 아는 것은 "medusa 라는 이름의 판매채널이 있다" 까지이며, 그것이 Medusa 인지 카페24 인지는 모른다. 이 선을 유지한다.

**전용 동선이라는 우려에 대해.** channel-adapter 를 거치는 것이 쿠폰만을 위한 거추장스러운 우회로처럼 보일 수 있으나, 그렇지 않다. `adapters/medusa/medusa.client.ts` 는 2,381줄이고 고객 그룹 편입·해제, 메타데이터 갱신, 멤버십 동기화가 모두 이 경로를 지난다. 쿠폰 자동발급은 그중 메서드 하나(`issuePromotionsByTrigger`)다. **쿠폰을 위해 낸 길이 아니라 이미 깔린 길에 얹힌 것이고, 한계비용은 사실상 0이다.**

### 4. 안에서 밖으로 — 나가는 것은 결과지 쿠폰이 아니다

주문이 완료되면 밖으로 나가는 것은 `discountAmount` 다. 쿠폰 코드도, promotion id 도, 발급 이력도 나가지 않는다.

포인트와 혼동하지 말 것. 같은 계약 파일이 이미 선을 그어 놓았다(`orders.stream.ts:84` 주석): **포인트는 할인이 아니라 결제수단**이라 `totalAmount` 에 포함돼 있고, 쿠폰은 할인이라 `discountAmount` 로 빠진다. 회계적으로 다른 물건이므로 쿠폰(Medusa)과 포인트(wallet)가 다른 시스템에 사는 것이 맞다.

### 5. 읽기는 admin-web 프록시가 Medusa 를 직접 부른다. 직권 발급은 동기다

관리자·CS 화면이 쿠폰을 보거나 발급할 때 **이벤트를 태우지 않는다.** admin-web 의 `app/api/proxy/medusa/[...path]/route.ts` 가 `MEDUSA_API_KEY` 로 인증해 Medusa admin API 로 그대로 프록시하며, 쿠폰 관리 화면 전체가 이 경로로 동작한다.

사람이 버튼을 누르고 결과를 즉시 보는 작업에 비동기 파이프라인을 끼우면 실패가 사람에게서 멀어진다. **동기 호출이 옳다.** admin-web 이 모든 서비스를 직접 부르는 것은 이 저장소의 기존 규칙이기도 하다.

### 6. 명시적 예외 — 분석용 파생은 밖에 둔다

쿠폰 발급·사용을 **분석 목적으로** 밖에 적재하는 것은 이 ADR 이 금지하는 복제가 아니다. 단 세 조건을 만족해야 한다:

1. **SoT 가 아니다.** 판정에 쓰지 않는다. 발급 가부·수량·권한을 이 데이터로 결정하는 코드가 생기면 그 순간 위반이다.
2. **재생성 가능하다.** 지우고 다시 만들 수 있어야 한다.
3. **거처는 analytics 다.** core 가 아니다.

오늘 analytics 는 `discountAmount` 조차 소비하지 않는다(참조 0건). 즉 "이 쿠폰이 매출을 얼마나 올렸나" 에 답할 데가 없다. 필요해지면 이 예외 조항 아래에서 만든다.

### 7. 확장 지점 — 트리거를 늘릴 때 손대는 여섯 곳

`auto_issue_trigger` 는 **닫힌 enum 으로 유지한다** (`customer_registered` / `membership_activated` / `birthday`). 자유 문자열이나 등록제로 열지 않는다 — 오타가 런타임 무음으로 변하고, 실사용이 0인 지금 그 유연성에 수요가 없다.

대신 늘릴 때의 절차를 여기 적는다. **같은 값이 여섯 곳에 독립적으로 선언돼 있고, 그중 컴파일러가 잡아주는 것은 하나도 없다.**

| # | 위치 | 형태 |
|---|------|------|
| 1 | `apps/medusa/src/modules/promotion-meta/service.ts:7` | `AutoIssueTrigger` 타입 |
| 2 | `apps/medusa/src/modules/promotion-meta/service.ts:31` | `upsert()` 안의 **인라인 리터럴 배열** (1번과 연결돼 있지 않다) |
| 3 | `apps/medusa/src/api/admin/customers/[id]/issue-coupons/route.ts:8` | `VALID_TRIGGERS` |
| 4 | `Migration20260527100000.ts:10` | DB CHECK 제약 — **새 마이그레이션으로 교체해야 한다** |
| 5 | `apps/admin-web/.../coupons/coupon-helpers.tsx:30` | admin-web 의 **자체** `AutoIssueTrigger` 타입 + 라벨 맵 |
| 6 | `apps/channel-adapter/.../medusa.client.ts:2377` | 메서드 시그니처의 **인라인 유니온** |

5번의 라벨 맵만 `Record<AutoIssueTrigger, string>` 이라 exhaustive 하지만, 그것은 **admin-web 자신의 복사본**(5번 앞줄)에 대해 exhaustive 할 뿐이다. Medusa 에서 값을 하나 늘려도 **어느 앱에서도 타입 에러가 나지 않는다.** 이 저장소는 같은 실패를 겪은 적이 있다(#724 — 라벨 맵이 두 벌인데 한쪽만 exhaustive 라 타입 게이트가 못 잡았다).

따라서 트리거를 추가할 때는 위 표를 체크리스트로 쓴다. 여섯 곳을 하나로 합치는 것은 이 ADR 의 범위가 아니다 — 앱 경계를 넘는 공유 타입은 `@packages/event-contracts` 에 두는 것이 이 저장소의 관례이나, 실사용이 0인 지금 그 추상화는 이르다.

그리고 사건 자체를 붙이는 쪽(발행 서비스 → channel-adapter 소비자 → inbox)은 별개 작업이다. `birthday` 가 타입·CHECK 제약·어드민 UI 에는 있으나 **발행처가 없어 미구현으로 남아 있는 것**이 그 예다(생성 UI 에서 `disabled`).

## 측정 (2026-08-28, live)

**매핑 건강도** — 이 ADR 의 결정 3은 "밖이 고객을 지목할 수 있다" 에 의존한다. 그 매핑은 Medusa customer 의 `metadata.almond_user_id` 이고, 실패 시 이메일 fallback + 자동 복구 경로가 있다(`membership-medusa-sync.service.ts:55–80`). 방어 코드의 존재가 파손을 시사하는 듯 보여 실측했다:

| 항목 | 값 |
|------|-----|
| 고객 | 2,695명 (전원 계정 보유, 게스트 0) |
| `almond_user_id` 부재 | **0건** |
| 유령 (1 userId → 여러 customer) | **0건** |
| 계정보유 고객 이메일 중복 | **0건** |

**매핑은 온전하다.** 자동 복구 경로는 방어적으로 쓰였거나 이미 수습된 흔적이며, 오늘의 라이브 상태는 깨끗하다. 결정 3이 딛고 설 바닥이 있다.

**쿠폰 실사용** — 기능은 배포돼 있으나 트래픽을 맞은 적이 없다:

| 항목 | 값 |
|------|-----|
| `promotion` | 1개 (active **0개**) |
| meta 없는 `promotion` | 0개 |
| 발급 링크 | 1건 |
| **쿠폰이 적용된 주문** | **0건** |
| 캠페인 / 쿠폰 이벤트 | 0개 / 0개 |

**이 수치가 이 ADR 을 지금 쓰는 이유다.** 옮길 데이터도, 깨질 발급 이력도, 무효화될 고객 쿠폰도 없다 — 경계를 못 박는 비용이 사실상 0인 유일한 시점이다. 쿠폰이 수천 건 쌓인 뒤에는 같은 결정이 마이그레이션 프로젝트가 된다.

## 알려진 구멍

이 ADR 이 만들지 않았고, 이 ADR 이 막지도 않는 것들. 전부 위 결정 안에서 해결 가능하다.

| # | 구멍 | 상태 |
|---|------|------|
| 1 | **CS 고객축 조회 화면 없음** | 백엔드 `GET /admin/customers/:id/promotions` 는 있으나 admin-web 이 한 번도 호출하지 않는다. `users/[id]` 상세에 쿠폰 탭 0건. 설계 결함이 아니라 미구현 — 결정 5 안에서 화면만 만들면 된다 |
| 2 | **반품·취소 시 쿠폰 복구 없음** | 회수 기능(`removeIssueLog` + `releaseClaimSlot`)은 있으나 주문 취소·환불에 연결돼 있지 않다. 결정 3의 동형 확장(core 가 사건 발행 → 트리거 추가)으로 해결 |
| 3 | **쿠폰 효과 분석 불가** | analytics 가 `discountAmount` 미소비. 결정 6의 예외 아래에서 해결 |
| 4 | **최대 할인금액 미강제** | `promotion_meta.max_discount_amount` 는 저장·조회되나 체크아웃에서 읽는 코드 0곳, 생성 폼 입력란도 없음. Medusa 기본 엔진 미지원 — 이 ADR 과 무관한 별개 기능 부채 |
| 5 | **자동 발급 라이브 OFF** | `COUPON_AUTO_ISSUE_ENABLED` 가 인프라에 미설정이라 결정 3의 경로 전체가 차단돼 있다. 개통은 운영 결정 |

## 검증되지 않은 것

**이 원칙은 실전 검증된 적이 없다.** 설계는 코드로 존재하고 통합 테스트 973줄이 붙어 있지만, 쿠폰이 적용된 주문이 0건이므로 트래픽 아래에서 확인된 것은 없다. 특히:

- 1인당 사용 횟수는 **우리 코드가 세지 않는다.** Medusa campaign budget `use_by_attribute/customer_id` 에 위임했고, 미들웨어·`completeCart` 훅 어디에도 주문 수를 세어 비교하는 로직이 없다. ~~엔진의 동시성 보장 수준을 우리는 검증하지 않았다.~~ → **2026-08-29 판정됨. 아래 «엔진 위임의 실제 강도» 참조.**
- 체크아웃 2단계 검증(장바구니 추가 시 미들웨어 + 주문 완료 직전 훅)의 race window 축소 효과도 실트래픽에서 확인된 바 없다.

첫 실사용 전에 두 번째를 확인할 것.

### 엔진 위임의 실제 강도 (2026-08-29, `@medusajs/promotion` 2.13.4 소스 실측)

위 항목이 오래 "미검증"으로 남은 이유는 우리가 엔진 내부를 읽지 않았기 때문이다. 읽었고, 결론은 **위임한 한도는 동시성 안전하지 않다** 이다.

`services/promotion-module.js:75–97` (`registerCampaignBudgetUsageByAttribute_`):

```js
const [usage] = await this.campaignBudgetUsageService_.list({ budget_id, attribute_value });
if (!usage) { create({ used: 1 }) }
else {
  const newUsedValue = MathBN.add(usage.used ?? 0, 1);  // 읽고
  if (limit && gt(newUsedValue, limit)) throw ...        // 비교하고
  await update({ id, used: newUsedValue });              // 쓴다
}
```

원자적 `UPDATE … WHERE` 도 `SELECT FOR UPDATE` 도 없는 read-modify-write 다. `registerUsage` 에 `InjectTransactionManager()` 는 붙어 있으나 isolation level 지정이 없어 Postgres 기본값(READ COMMITTED)으로 돌고, 그 수준에서 트랜잭션은 lost update 를 막아주지 않는다. 같은 패턴이 전역 한도(`promotion.limit`/`used`, budget `usage`/`spend`)에도 그대로 있다.

- **첫 사용은 우연히 막힌다** — `promotion_campaign_budget_usage` 의 `(attribute_value, budget_id)` partial unique 가 동시 insert 를 23505 로 터뜨린다. 우아하지 않을 뿐 막히기는 한다.
- **2회차 이후 증가는 보호가 없다.** 동시 2건이 `used=1` 을 읽고 둘 다 `used=2` 를 쓴다.

**여기서 비대칭이 생긴다: 발급은 우리가 원자적으로 막고(`reserveClaimSlot` 의 `UPDATE … WHERE issued_count < ? RETURNING`), 사용은 엔진이 열어 둔다.** 결정 2의 "판정은 Medusa 안에서" 는 유지되나 *어느 Medusa 인가*가 갈린다 — 우리가 쓴 판정은 원자적이고, 위임한 판정은 아니다.

그럼에도 위임을 유지한다. 실사용 0건에서 엔진을 포크할 이유가 없고, 한도 초과의 손해는 쿠폰 몇 장이지 재고나 결제가 아니다. 다만 **1인당 한도를 엄격히 지켜야 하는 쿠폰(예: 고액 정액 할인)을 발행하기 전에는** 이 한계를 알고 발행하거나, `max_claims`(발급 상한) 쪽으로 조이는 편이 낫다 — 그쪽은 이미 원자적이다.

코드 형태로 내린 판단이며, 동시성 테스트로 lost update 를 재현한 것은 아니다.

## 결과

- core 는 Medusa 를 계속 모른다. 쿠폰 테이블·캐시·읽기모델을 core 에 만들지 않는다.
- 밖은 사건만 발행한다. "쿠폰을 발급하라" 는 명령은 어느 서비스도 보내지 않는다.
- 쓰기는 channel-adapter 를, 읽기는 admin-web 프록시를 지난다. 관리자 직권 발급은 동기다.
- 분석용 파생만이 예외이며, SoT 가 아니고 재생성 가능해야 한다.
- 위임한 사용 한도(campaign budget)는 동시성 안전하지 않다. 엄격한 한도가 필요하면 원자적인 `max_claims` 쪽으로 조인다.
- 트리거 추가 시 여섯 곳 체크리스트를 쓴다. 컴파일러는 도와주지 않는다.
