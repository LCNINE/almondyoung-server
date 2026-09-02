# 쿠폰 «한 장» 을 여러 장으로 — 발급 그랜트 모델 설계

- **날짜**: 2026-09-02
- **선행**: `docs/superpowers/specs/2026-08-31-coupon-issuance-instance-and-validity-design.md` (P4+P5, 머지 `ef28e5d73`)
- **경계**: `docs/adr/0033-coupons-are-owned-by-the-sales-channel.md`
- **SoT**: 이슈 [#488](https://github.com/LCNINE/almondyoung-server/issues/488)

P4 는 발급된 «한 장»에 상태를 실었다. 이 설계는 그 «한 장»을 **여러 장**으로 만든다.
그리고 그 과정에서 **오늘 우연히 성립하던 따닥 방어가 사라지므로**, 멱등성을 부작용이 아니라
DB 제약으로 다시 세운다.

---

## 1. 이 설계가 서 있는 결정들

2026-09-02 세션에서 사용자와 확정했다.

| # | 결정 | 근거 |
|---|---|---|
| 1 | **모든 쿠폰은 1장 = 1회.** 예외 없음 | 물리 티켓 의미론. 여러 번 주고 싶으면 여러 장 준다 |
| 2 | **같은 쿠폰을 같은 고객에게 여러 장** 발급할 수 있다 | 「제한 없는 1,000원 할인」이 여러 출처에서 나간다 |
| 3 | **출처 이름표는 새로 만들지 않는다.** 기존 `IssueTrigger` 어휘 5개 그대로 | 아래 ⓐ |
| 4 | 유효기간이 다르면 **완전히 다른 쿠폰**으로 취급한다 | 운영 규칙. 같은 코드에 정책 두 개를 담지 않는다 |
| 5 | 로그인아이디 발급(①)을 **이 설계에 합친다** | 같은 다이얼로그를 두 번 뜯지 않기 위해 |

### ⓐ 왜 이름표를 새로 만들지 않는가

세 가지 이유가 겹친다.

1. **여러 장을 구분하는 것은 «행이 다르다»는 사실이지 이름표가 아니다.** grant 행마다
   `id` 와 `issued_at` 이 다르므로 같은 이름표로 두 장이 나가도 두 장으로 남는다.
2. **이름표는 이미 있고 이미 자동으로 붙는다** — `IssueTrigger` =
   `customer_registered | membership_activated | admin_manual | admin_force | customer_claim`
   (`modules/promotion-meta/service.ts:12-14`). 발급 경로가 각자 쓴다.
3. **대부분의 경우 쿠폰 코드 자체가 출처 라벨이다.** 결정 4에 의해 보상 쿠폰은 전용 코드가 된다.

이름표가 실제로 일하는 자리는 둘뿐이다 — `admin_force`(정책 게이트 우회의 감사 기록)와,
범용 쿠폰을 여러 이벤트에 재사용할 때의 경로별 집계. 후자는 전용 코드로 대체 가능하다.

### ⓑ 「한 쿠폰이 여러 캠페인에」는 엔진에서 불가능하고, 필요하지도 않다

`Promotion.campaign_id` 는 단일 FK다
(`node_modules/@medusajs/types/dist/promotion/common/promotion.d.ts:73`).
프로모션 하나는 캠페인 0~1개에만 속한다.

**그런데 우리 코드에서 Medusa 「캠페인」은 «발급 캠페인»이 아니라 «예산 슬롯»이다.**
`build-create-promotion-payload.ts` 는 예산이 필요할 때만 `CAMP_<코드>_<suffix>` 를 쿠폰당
하나씩 기계 생성하고, 아니면 캠페인을 아예 안 만든다(#488 `1-3`). 즉 결정 2가 요구하는
«여러 출처»와 엔진의 campaign 은 다른 물건이고, 해법은 campaign 을 다대다로 만드는 것이
아니라 **발급 인스턴스를 행으로 쪼개는 것**이다.

그리고 이 설계는 §5.3 에서 **`use_by_attribute` 예산 사용을 중단**하므로, 캠페인이 남는
용도는 「총 할인금액 한도」 하나로 줄어든다.

---

## 2. 소스에서 확정한 사실 — 설계가 여기 의존한다

### ⓒ 🔴 오늘의 따닥 방어는 의도가 아니라 복합 PK 의 부작용이다

`Link.create` 는 INSERT 가 아니라 **복합 PK upsert** 다. 이 저장소가 세 곳에서 실측 주석으로
남겼다 — `issue-coupons/route.ts:135`, `customers/[id]/promotions/route.ts:228`,
`claim/route.ts:120` (전부 “복합 PK upsert 라 중복이 예외가 되지 않는다”, 근거는
`integration-tests/http/coupon-validity.spec.ts` T3).

즉 **오늘 관리자가 발급 버튼을 두 번 눌러도 1장인 이유는 방어를 해서가 아니라 두 번째가 첫
행을 덮어써서**다. 이 설계는 그 제약을 없애는 것이 요점이므로, **아무것도 안 하면 따닥이 곧
2장이 된다.** §3.2 가 이 자리를 메운다.

### ⓓ 🔴 오늘도 이미 새고 있다 — 클레임의 read-then-write 경합

`claim/route.ts:88` 의 `alreadyClaimed` 는 `query.graph` 로 읽고 나중에 쓰는 구조라,
동시 두 요청이 **둘 다 통과**한다. 그 뒤 `reserveClaimSlot`(`:102`)이 **두 번** 돌고,
`link.create` 는 upsert 라 행은 하나만 남는다.

**결과: 「선착순 100명」 쿠폰이 따닥 한 번에 2명분을 소진한다.** 장수는 맞는데 `issued_count`
만 앞서간다. 라이브에 이미 있는 결함이고 쿠폰 실사용 0건이라 아직 발현되지 않았다.
§3.2 의 유니크가 이것도 함께 닫는다.

### ⓔ `used_at` 은 writer 만 있고 reader 가 0이다

`grep -rn 'used_at' apps/medusa/src` 결과 — 쓰는 곳은 `coupon-usage.ts:44`(주문 생성 시),
읽는 곳은 **표시 3곳뿐**(`admin/promotions/[id]/customers/route.ts:82`,
`admin/customers/[id]/promotions/route.ts:70`, `issued-link.ts` 의 타입 선언).
**어떤 게이트도 `used_at` 을 검사하지 않는다.**

그러므로 **「1장 = 1회」는 지금 존재하지 않는다.** 발급받은 쿠폰은 만료 전까지 몇 번이든
쓸 수 있고, 유일한 제동장치는 관리자가 폼의 「1인당 사용 횟수 제한」을 채웠을 때 생기는
캠페인 예산 `use_by_attribute` 뿐이다(비우면 무제한).

### ⓕ 읽기 이음매가 이미 하나다 — `issued-link.ts`

`modules/promotion-meta/issued-link.ts` 가 `findIssuedLink` / `listIssuedLinks` 를 노출하고,
**판정 소비자 6곳이 전부 이걸 통해 읽는다.** P4 가 계층 역전을 없애려고 만든 자리인데,
결과적으로 이 설계의 이음매가 됐다.

`getLinkModule` 을 **직접** 부르는 곳은 그 밖에 5곳이다 —
`admin/promotions/[id]/customers/route.ts:25`(현황 GET)·`:114`(회수 DELETE),
`claim/route.ts:56`, 그리고 스크립트 둘(`detach-coupon-campaigns.ts:199`,
`backfill-issued-count.ts:33`).

### ⓖ 체크아웃은 쿠폰을 «코드»로만 붙인다

스토어프론트가 부르는 것은 `addPromotionToCart(cartId, [code])` 다
(`web/almondyoung-storefront/src/domains/checkout/components/sections/discount.tsx:101,410,426,455,469`).
**엔진에는 «몇 번째 장» 개념이 없다.** 따라서 여러 장 중 한 장을 소모시키는 것은
전적으로 우리 층의 일이고, 그 자리는 이미 있다(`record-coupon-usage.ts` 의 `orderCreated` 훅).

### ⓗ 로그인아이디 조회에 새 API 가 필요 없다

`GET {USER_SERVICE}/admin/users?q=<검색어>` 가 `username · nickname · email · loginId ·
phoneNumber` 를 한 번에 `ilike` 로 검색한다(`apps/user-service/src/api/admin/users/users.service.ts:66-70`).
admin-web 이 이미 이 엔드포인트를 쓴다(`lib/api/domains/customer/index.ts:40`).

그 결과의 `users[].id` 를 **이미 존재하는** `GET /admin/customers/by-almond-user/:almondUserId`
(`apps/medusa/src/api/admin/customers/by-almond-user/[almondUserId]/route.ts`)에 넣으면
Medusa 고객이 나온다. 매핑은 `customer.metadata.almond_user_id` 이고 가입 시
`api/auth/[actor_type]/[auth_provider]/register/route.ts:43` 이 심는다.

🔴 **`almond_user_id` 가 없는 고객이 존재한다** — 코드 여러 곳이 “연동 안 된 계정”으로
fail-open 처리한다(`handle-validate-cart-items-inventory.ts:178`,
`welcome-membership-order.ts:98`, `membership-benefit-order.ts:258`).
그런 계정은 로그인아이디로 절대 안 잡힌다. 같은 `q` 가 이메일도 검색하므로 입력란 하나로
둘 다 처리된다 — **로그인아이디 조회를 이메일 조회의 «대체»로 만들지 말 것.**

### ⓘ `order.canceled` 구독자는 여러 개 달 수 있다

이미 둘이 붙어 있다(`welcome-membership-order.ts:133`, `membership-benefit-order.ts:314`).
워크플로 훅과 달리 구독자는 개수 제한이 없으므로
(`workflows/hooks/__tests__/no-duplicate-validate-hooks.unit.spec.ts` 의 대상이 아니다)
새 구독자를 안전하게 더할 수 있다.

### ⓙ 소프트삭제 + 유니크는 PARTIAL 이어야 한다

`promotion_meta` 와 `promotion_issue_log` 둘 다 DML 에는 full unique 로 선언하고
**마이그레이션에서 `WHERE deleted_at IS NULL` 파셜로 만든다**
(`models/promotion-meta.ts:23-30`, `models/promotion-issue-log.ts:13-19` 의 주석).
회수 후 재발급이 이 조건에 의존한다. `coupon_grant` 의 유니크도 **반드시 파셜**이어야 한다.

### ⓚ 새 확장점을 쓰지 않는다

이 설계가 쓰는 메커니즘은 전부 이 저장소에서 이미 프로덕션에 있다 — 커스텀 모듈 모델,
모듈 마이그레이션, `order.canceled` 구독, `completeCartWorkflow.hooks.orderCreated`,
커스텀 미들웨어. **모듈 서비스 교체도 코어 라우트 override 도 없다.**
(#488 `N9` 의 「재조사 금지」 목록과 마스터플랜 0번 규칙에 대한 답.)

---

## 3. 스키마

### 3.1 새 모델 `coupon_grant`

`apps/medusa/src/modules/promotion-meta/models/coupon-grant.ts`

| 컬럼 | 타입 | 의미 |
|---|---|---|
| `id` | pk | |
| `promotion_id` | text | 어느 쿠폰인가 |
| `customer_id` | text | 누가 갖고 있는가 |
| `issue_key` | text | **이 발급이 어떤 «사건»인가** (§3.2) |
| `issued_via` | text | `IssueTrigger` 어휘 5개. 새 값 없음 |
| `issued_at` | datetime | |
| `expires_at` | datetime null | 발급 시점에 `computeExpiresAt` 로 계산해 박는다. null = 무기한 |
| `used_at` | datetime null | 이 장이 소모된 시각 |
| `order_id` | text null | 이 장이 쓰인 주문 |

인덱스:

- `(customer_id)` — `listGrants(customerId)` 의 주 경로
- `(promotion_id)` — 발급 현황·회수
- **`(promotion_id, customer_id, issue_key)` UNIQUE, PARTIAL `WHERE deleted_at IS NULL`** — ⓙ

**나머지 유니크는 없다.** 그게 「여러 장」의 요점이다.

### 3.2 🔴 `issue_key` — 멱등성을 부작용이 아니라 제약으로

ⓒ 가 사라지는 자리를 이것이 메운다. 키가 «이 발급이 어떤 사건인가»를 표현하고, 유니크가
그 사건의 1회성을 DB 로 강제한다.

| 발급 경로 | `issue_key` | 그래서 무엇이 보장되나 |
|---|---|---|
| 셀프 클레임 | `'claim'` (고정) | **클레임은 영구 1장.** 따닥 방어가 DB 레벨. ⓓ 의 경합도 닫힌다 |
| 트리거 자동발급 | `'trigger:<trigger>'` | 트리거당 1장. channel-adapter 재시도가 멱등 |
| 관리자 수동 | `'<제출UUID>:<장번호>'` | 같은 제출은 몇 번 도착해도 N장, 새 제출은 새 장 |

**유니크 위반은 예외가 아니라 「이미 처리됨」이다.** 삼키고, 예약한 claim 슬롯이 있으면
반환하고, 원래 결과를 응답한다. 그래야 재시도가 안전하다.

관리자 경로의 제출 UUID 는 **클라이언트가 만든다**. 제출을 시작할 때 하나 만들어 ref 에
보관하고, 실패 재시도는 같은 키를 쓰고, 성공하면 폐기한다. 1인 N장이면
`${submitId}:1` … `${submitId}:N` 으로 장마다 다른 키를 준다.

> **UI 잠금은 방어가 아니다.** 지금 `coupon-assign-dialog.tsx` 가 `assignMutation.isPending`
> 으로 버튼을 잠그지만, 렌더 사이 연타도 **타임아웃 후 재제출**도 못 막는다. 대량 발급은
> 요청이 길어져 그 창이 오히려 커진다. 서버 제약이 유일한 방어선이다.

### 3.3 `promotion_issue_log` 를 걷는다

이 테이블의 존재 이유는 `isAlreadyIssued` 하나뿐이고(`service.ts:76-79`), grant 가 그
정보를 **상위집합으로** 갖는다(`customer_id` · `promotion_id` · `trigger`=`issued_via`, 게다가
시각·만료·사용까지). 두 벌을 남기면 서로 어긋날 수 있다.

제거 대상은 **코드뿐이다** — 모델 파일, `isAlreadyIssued` · `recordIssue` · `removeIssueLog` ·
`removeAllIssueLogs`(`service.ts:76-113`), 그리고 호출부 4곳(`issue-coupons/route.ts`,
`customers/[id]/promotions/route.ts`, `claim/route.ts`, `promotions/[id]/customers/route.ts`).

⚠️ **모델 파일을 지우는 것과 테이블을 DROP 하는 것은 다르다.** 이 모듈의 마이그레이션은
전부 손으로 쓰므로 모델 제거가 DDL 을 만들지 않는다. 테이블은 고아로 남고, 삭제는 §9 대로
별도 PR 이다.

### 3.4 마이그레이션 1건

`Migration<타임스탬프>.ts` — `promotion-meta` 모듈.

1. `coupon_grant` 생성 + 인덱스 3개(유니크는 파셜)
2. 기존 링크 행을 grant 1장씩으로 복사.
   `issue_key` 는 옛 행의 `issued_via` 에서 결정적으로 만든다 —
   `customer_claim` → `'claim'`, `customer_registered`/`membership_activated` →
   `'trigger:<값>'`, 그 외(`admin_manual` · `admin_force` · `issued_via IS NULL` 인 P4 이전 행)
   → **`'legacy'` 고정**.

   > 고정값으로 충분한 이유: 원본이 `(customer_id, promotion_id)` 복합 PK 라 **쌍마다 정확히
   > 한 행**이고, 유니크는 그 쌍에 `issue_key` 를 더한 삼중이다. 행 id 를 섞을 필요가 없다
   > (링크 행에 `id` 가 있다고 가정하지 않아도 된다). 이후 관리자 발급은 제출 UUID 키를
   > 쓰므로 `'legacy'` 와 절대 충돌하지 않는다.

3. `promotion_issue_log` 는 **테이블을 남긴다** — 코드에서만 끊는다(§3.3), DROP 은 §9 참조

**링크 테이블은 건드리지 않는다.** 컬럼도 그대로 둔다.

---

## 4. 판정은 순수 함수로 뽑는다

`apps/medusa/src/modules/promotion-meta/grants.ts` (신설, 컨테이너를 모른다)

```ts
export function usableGrants(grants: CouponGrant[], now: Date): CouponGrant[]
export function hasUsableGrant(grants: CouponGrant[], now: Date): boolean
export function selectGrantToConsume(grants: CouponGrant[], now: Date): CouponGrant | null
export function nextExpiryAt(grants: CouponGrant[], now: Date): Date | null
```

- **«사용 가능»** = `used_at == null` 그리고 `expires_at == null || now <= expires_at`.
  `validity.ts` 의 `isUsable` 과 같은 경계(양끝 포함)를 쓴다.
- **소모 순서는 만료 임박순(FEFO).** 만료가 같으면 `issued_at` 이 이른 것, 그것도 같으면
  `id` 오름차순(결정적이어야 테스트가 선다). **무기한(`expires_at == null`) 장은 맨 뒤.**
- `nextExpiryAt` 은 표시용 — 사용 가능한 장 중 가장 이른 만료.

> P1 교훈: 판정을 라우트 안 클로저로 두면 검증 대상 밖이다. `validity.ts` 와 같은 이유로
> 모듈 레벨 순수 함수로 둔다.

`issued-link.ts` 는 `grants.ts` 로 대체된다 — `listIssuedLinks(scope, customerId)` 가
`listGrants(scope, customerId): CouponGrant[]` 가 되고, 반환이 **고객×쿠폰당 1행에서 N행으로** 바뀐다.

---

## 5. 쓰기 경로

### 5.1 발급 3경로

셋 다 같은 모양이 된다: **claim 슬롯 예약 → grant insert → 유니크 위반이면 슬롯 반환 후 «이미 처리됨»**.

| 경로 | 파일 | 바뀌는 것 |
|---|---|---|
| 관리자 수동 | `admin/customers/[id]/promotions/route.ts` POST | `isAlreadyIssued` 삭제, `issue_key` 수용, N장 루프 |
| 트리거 자동 | `admin/customers/[id]/issue-coupons/route.ts` POST | `isAlreadyIssued` → 결정적 `issue_key` 로 대체 |
| 셀프 클레임 | `store/customers/me/promotions/[id]/claim/route.ts` | `alreadyClaimed` 선검사 삭제(ⓓ), `issue_key='claim'` |

**클레임의 `alreadyClaimed` 선검사를 지우는 것이 ⓓ 의 수정이다.** 「이미 받았음」은 이제
유니크 위반으로 알게 되고, 그 시점엔 슬롯을 이미 예약했으므로 반환한다. 응답은 지금처럼
200 `{success:true}` 를 유지한다(스토어프론트 계약 불변).

`max_claims` / `issued_count` 의 의미는 **바뀌지 않는다 — 계속 «장수»** 다. `claimable` 쿠폰은
`issue_key='claim'` 이라 1인 1장이므로 장수 = 사람수가 그대로 성립한다.

### 5.2 새 발급 라우트 — `POST /admin/promotions/:id/customers`

지금 GET·DELETE 만 있는 그 자리(`admin/promotions/[id]/customers/route.ts`)에 POST 를 더한다.
축이 반대인 기존 라우트(`고객 1명 ← 쿠폰 N개`)를 그대로 두고, **`쿠폰 1개 → 고객 N명`** 을 연다.

```
POST /admin/promotions/:id/customers
{ customer_ids: string[], quantity: number, submit_id: string, force?: boolean }
→ { issued: [{customer_id, granted}], skipped: [{customer_id, reason}] }
```

고객별로 §5.1 의 수동 발급 로직을 돌린다. 한 고객의 실패가 나머지를 막지 않는다(기존
배치 resilient 규약 유지). `issue_key = `${submit_id}:${n}``.

### 5.3 「1인당 사용 횟수 제한」 제거

「1장 = 1회」가 grant 로 강제되므로 캠페인 예산 `use_by_attribute` 를 쓸 이유가 없다.

- `coupon-create-dialog.tsx` — 입력란 제거
- `build-create-promotion-payload.ts` — `maxUsesPerCustomer` 필드와 **「총 할인금액 한도와
  동시 설정 불가」 throw 제거** → 두 한도가 공존 가능해진다
- `admin/promotions/[id]/customers/route.ts` GET — `max_uses_per_customer` 응답 필드 제거
- `store/customers/me/promotions/route.ts:145-178` — `use_by_attribute` 소진 필터 제거,
  「사용 가능한 장 없음」으로 대체

### 5.4 사용 기록 — 장을 소모한다

`workflows/hooks/cart/record-coupon-usage.ts` (`orderCreated` 훅, 이미 있음).
지금은 `(customer, promotion)` 한 행에 `used_at` 을 쓴다. 앞으로는
`selectGrantToConsume` 으로 **한 장을 골라** 그 행에만 쓴다.

⚠️ 이 훅은 실패해도 주문을 되돌리지 않는다(기존 판단 유지). 즉 **기록 유실 시 장이 안
줄어든다.** 그 창을 §6.1 의 백스톱이 좁히지 못하므로, 유실은 로그로 드러나야 한다.

### 5.5 🆕 취소 시 장 복구 — A2 종결

`apps/medusa/src/subscribers/coupon-grant-restore.ts` (신설, `order.canceled`).

그 `order_id` 를 가진 grant 의 `used_at`·`order_id` 를 비운다.
**이미 만료된 장은 되살리지 않는다** — 되살려도 쓸 수 없고, 「돌아왔는데 못 쓴다」가 더 나쁘다.

`used_at = null` 은 두 번 해도 결과가 같으므로 이벤트 중복 배달에 자연히 멱등하다.

이로써 **#488 `A2`(취소·전액환불 후에도 한도가 소진된 채 남아 쿠폰이 영구 소실)가 구조적으로
사라진다** — 복구할 캠페인 예산이 존재하지 않기 때문이다.

### 5.6 회수

`DELETE /admin/promotions/:id/customers` 와 `DELETE /admin/customers/:id/promotions` 는
이제 **장 단위**가 된다. 기본은 「그 고객의 그 쿠폰 전량 회수」로 지금 동작을 유지하고,
회수한 장수만큼 `releaseClaimSlot` 을 부른다(지금은 1회 고정 — **장수만큼으로 고쳐야 한다**).

---

## 6. 읽기·강제 경로 — «누가 이 값을 읽는가»

> 마스터플랜 「P1 에서 배운 것」 1번 요구: 읽기 경로를 grep 근거와 함께 적는다.
> 근거는 `grep -rn "listIssuedLinks|getLinkModule" apps/medusa/src` (테스트 제외).

### 6.1 강제 (돈이 걸린 자리)

| 파일 | 지금 | 바뀌는 판정 |
|---|---|---|
| `store/carts/middlewares/per-customer-limit.ts:22` | 그 한 장의 만료 | **`hasUsableGrant`** — 미사용·미만료 장이 하나라도 있는가 |
| `workflows/hooks/cart/complete-cart.ts:34` | 같음 | 같음 (부착 후 소진 race 백스톱) |
| `workflows/hooks/cart/record-coupon-usage.ts:70` | 그 한 장에 기록 | `selectGrantToConsume` 로 한 장 소모 |

앞의 둘은 `requiresIssuance(meta)` 안에서 하던 `customer.promotions` 조회
(`per-customer-limit.ts:66`, `complete-cart.ts:62`)도 **grant 조회로 대체**한다 — 링크는
「가진 적 있다」만 말하므로 다 쓴 쿠폰을 통과시킨다.

🔴 **이 셋이 「1장 = 1회」의 전부다.** 하나라도 빠지면 ⓔ 상태로 되돌아간다.

### 6.2 표시

| 파일 | 바뀌는 것 |
|---|---|
| `store/customers/me/promotions/route.ts:110` | 장수 + `nextExpiryAt`. `use_by_attribute` 소진 필터(`:145-178`) 제거 |
| `store/events/[slug]/route.ts:78` | 보유 여부 → **사용 가능한 장 존재 여부** |
| `store/coupons/preview/route.ts:130` | 같음 |
| `admin/customers/[id]/promotions/route.ts:61` | 장수 + 장 목록 |
| `admin/promotions/[id]/customers/route.ts:25` | 고객별 보유/사용 장수 |

`displayExpiresAt`(`validity.ts`)의 계약은 유지하되 인자가 «한 장»에서 «가장 이른 사용 가능
장»으로 바뀐다. 🔴 **그 함수의 헤더 주석이 설명하는 함정(`??` 로 합치면 무기한 장이 정책값으로
샌다)은 여전히 유효하다** — 여러 장이 되어도 `?:` 분기를 유지할 것.

### 6.3 admin-web

| 파일 | 바뀌는 것 |
|---|---|
| `coupon-assign-dialog.tsx` | §7 전면 재설계 |
| `coupon-customers-dialog.tsx` | 고객별 보유/사용 장수 표시, 회수 문구 |
| `coupon-create-dialog.tsx` | 「1인당 사용 횟수 제한」 입력란 제거 |
| `lib/build-create-promotion-payload.ts` | §5.3 |
| `lib/coupon-meta.ts` · `template/marketing-coupons-template.tsx` | 「발급 현황」 셀의 의미 유지(장수) — 변경 없음 확인 |

---

## 7. 어드민 발급 다이얼로그 (① 포함)

`coupon-assign-dialog.tsx` 재설계. **새 조회 API 는 없다**(ⓗ).

**흐름**

1. 여러 줄 입력 — 로그인아이디/이메일 혼용 가능. 개행·쉼표 구분
2. 줄마다 `GET {USER_SERVICE}/admin/users?q=<줄>` → 정확히 1건이면 확정, 0건/2건 이상이면 그 줄을 «미해결»로 표시
3. 확정된 `users[].id` → `GET /admin/customers/by-almond-user/:id` → Medusa customer id
4. 수량 입력(기본 1)
5. 제출 → `POST /admin/promotions/:id/customers` (§5.2)
6. 결과 표 — 성공/실패 + 사유(`skipReasonLabel` 재사용)

**해석·집계 로직은 `.tsx` 밖으로.** admin-web 은 `.tsx` 가 jest transform 밖이라
다이얼로그 안에 판정을 두면 검증되지 않는다([[admin-web-no-component-tests]]).
`lib/parse-issue-targets.ts` 로 뽑는다 — 입력 문자열 → 줄 배열 정규화, 중복 제거,
`issue_key` 생성 규칙, 결과 집계.

**`force`** 는 지금처럼 남긴다 — 분류표 밖 룰(#488 `1-5`)의 탈출구이고 `issued_via='admin_force'`
로 기록된다. 대량 경로에서도 같은 의미를 유지한다.

---

## 8. 검증

### 8.1 유닛 (`.ts`)

- `grants.spec.ts` — `usableGrants` · `hasUsableGrant` · `selectGrantToConsume`(FEFO,
  무기한 뒤로, 동률 시 결정적 순서) · `nextExpiryAt`
- `parse-issue-targets.spec.ts` (admin-web) — 입력 파싱, 중복 제거, `issue_key` 생성
- 기존 `validity` · `issuance-rules` 스펙은 손대지 않는다

### 8.2 실 DB 통합 — `scripts/local/run-medusa-integration.sh --testPathPattern 'coupon-'`

🔴 **CI 는 이걸 안 돌린다(DB 없음). 쿠폰 도메인의 유일한 방어선이다.**
🔴 `npm run test:integration:http` 를 직접 부르지 말 것 — 러너가 `DATABASE_URL` 이 아니라
`DB_HOST`/`DB_USERNAME`/`DB_PASSWORD`/`DB_PORT` 를 읽어 전 스펙이 SASL 로 죽는다.

새 스펙 `coupon-grant.spec.ts`:

| # | 검사 |
|---|---|
| G1 | 같은 고객에게 같은 쿠폰 2장 발급 → grant 2행 |
| G2 | **따닥** — 같은 `submit_id` 로 2회 POST → grant 1행, 응답 동일 |
| G3 | **클레임 따닥** — 동시 2회 claim → grant 1행 **그리고 `issued_count` +1**(ⓓ 회귀 방지) |
| G4 | 트리거 재시도 — 같은 trigger 로 2회 → 1행 |
| G5 | 2장 보유 후 주문 1건 → 1장만 `used_at`, 남은 1장으로 재사용 가능 |
| G6 | 마지막 장 소모 후 카트 부착 → `COUPON_NOT_ASSIGNED` 계열 거부 |
| G7 | FEFO — 만료가 다른 2장 중 이른 것이 먼저 소모 |
| G8 | 주문 취소 → 그 장의 `used_at` 복구, 다시 사용 가능 (A2) |
| G9 | 만료된 장은 취소해도 복구되지 않는다 |
| G10 | 회수 → 장수만큼 `releaseClaimSlot` |

🔴 **`.rejects.toThrow()` 를 쓰지 말 것** — 워크플로 엔진을 거친 에러는 프로토타입을 잃어
`Error` 인스턴스가 아니다. `try/catch` + `expect(err.message).toContain(...)`.
🔴 **포트를 상수로 박지 말 것** — `39100 + (process.pid % 400)`, 모듈 로드 시점에 결정.

### 8.3 게이트

- 루트 `npm run type-check` · `npx jest --maxWorkers=2`
- **`cd apps/admin-web && npx tsc --noEmit`** — 루트 type-check 는 admin-web 을 제외한다
- medusa 유닛 · medusa 모듈 통합
- `packages/domain-types/coupon-vocabulary-drift.spec.ts` — 어휘를 안 늘리므로 통과해야 정상

---

## 9. 배포

**마이그레이션 1건 · 시크릿 0 · env 0.**

**순서는 `migrate → deploy` (expand).** 새 코드가 `coupon_grant` 를 읽고 쓰므로 테이블이
먼저 있어야 한다. 롤링 중 옛 태스크는 새 테이블을 모르고 링크만 보므로 안전하다
(옛 태스크가 발급하면 grant 가 안 생기지만, 그 창에서 발급이 일어날 확률은 낮고
발생해도 링크 행으로 남아 나중에 손으로 복구 가능하다).

**`promotion_issue_log` 는 이번 배포에서 DROP 하지 않는다.** 코드에서만 사용을 끊고,
테이블 삭제는 별도 PR 로 미룬다 — ADR-0005 §5 의 expand-contract 컨벤션(column/table drop 은
코드 변경과 같은 PR 에 묶지 않는다)이고, 롤백 여지를 남긴다.

**배포 전 실측 1건** (#488 코멘트에 SQL 을 남길 것):

```sql
-- use_by_attribute 예산을 가진 활성 프로모션 수. 0이면 §5.3 의 detach 걱정이 사라진다.
SELECT count(*) FROM promotion p
  JOIN campaign c ON c.id = p.campaign_id
  JOIN campaign_budget b ON b.campaign_id = c.id
 WHERE p.status = 'active' AND b.type = 'use_by_attribute';
```

0이 아니면, 그 프로모션들은 엔진 예산과 grant 가 **이중으로** 제약하게 된다(더 엄격한 쪽이
이긴다). 기능상 안전하지만 관리자에게 설명되지 않는 거절이 생기므로 마이그레이션에서 detach 한다.

---

## 10. 이번에 하지 않는 것

| 안 하는 것 | 이유 |
|---|---|
| Medusa 링크 테이블 제거 | `customer.promotions` 셀렉션을 쓰는 8곳을 손수 조인으로 바꾸는 별도 작업. 링크는 표시 조인 편의로 남는다 |
| `promotion_issue_log` 테이블 DROP | §9 — 별도 PR |
| 출처 자유 라벨 / 발급 배치 회수 | ⓐ. `issue_key` 가 나중에 배치 id 역할을 할 수 있지만 지금 UI 를 만들지 않는다 |
| 발급 시 고객 알림 | 발급 경로 3개 전부 알림이 0인 것은 사실이나, 이 설계의 범위 밖. 별도 이슈로 남길 것 |
| 쿠폰이 여러 캠페인에 소속 | ⓑ — 엔진 불가이고 필요도 없다 |
| 「1인당 N회」 축 복원 | 결정 1 |

---

## 11. ⛔ 아직 안 잰 것

1. **`use_by_attribute` 예산 보유 활성 프로모션 수** — §9 의 SQL. 라이브 미실행
2. **전액 환불이 `order.canceled` 없이 일어나는 경로가 있는가** — §5.5 가 `order.canceled`
   하나에 걸려 있다. 환불 전용 이벤트로만 끝나는 경로가 있으면 A2 가 그만큼 안 닫힌다.
   구현 전에 Medusa 이벤트 목록에서 확인할 것
3. **`almond_user_id` 가 없는 라이브 고객 수** — ⓗ. 많으면 §7 의 「미해결 줄」이 자주 뜬다
4. **브라우저 수동 확인 0회** — 새 발급 다이얼로그. #488 리허설 2차에 넣을 것

---

## 12. 이 설계가 #488 에 미치는 영향

- **`A2` 종결** — §5.5. 개통 전 위험 하나가 우회가 아니라 소멸로 해결된다
- **`1-2` 의 제약 해소** — §5.3 으로 두 한도가 공존 가능해진다(P1 이 열어둔 「예산 슬롯이
  하나뿐」 제약의 마지막 잔재)
- **신규 결함 ⓓ 수정** — 클레임 경합으로 인한 `issued_count` 이중 소진
- **작업 순서에 삽입되는 지점**: 「리허설 2차 → A5 개통」 앞. 이 설계는 발급·사용 경로를
  전부 건드리므로 **리허설 2차보다 먼저** 들어가야 한다. 리허설 2차의 항목에 G1~G10 에
  대응하는 수동 검사를 더한다
- 🔴 **지금이 유일하게 싼 시점** — 쿠폰이 적용된 주문 0건. 개통 후엔 링크→grant 이관이
  실사용 데이터를 동반한다
