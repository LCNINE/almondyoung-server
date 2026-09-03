# 쿠폰 모듈을 깊게 — 소모 seam · 워크플로 verdict · 쌍둥이 정리 (PR-2 설계)

> 2026-09-03. PR #778(ADR-0034 + 정본 1벌화) 머지 직후의 재리뷰 14건을 구조로 판정한 결과.
> 이 문서는 **왜**를 적는다. **무엇을 어떤 순서로**는
> `docs/superpowers/plans/2026-09-03-coupon-module-depth.md` 에 있다.

## 1. 판정 — 어디가 구조 문제이고 어디가 아닌가

#778 은 두 번 구조를 고쳤다(라우트 4벌 → 모듈+워크플로 / 정본 3벌 → 1벌). 그런데 머지 직전
재리뷰가 다시 14건을 냈다. 세 가지 시험으로 원인을 갈랐다.

**시험 1 — 접기의 2차 미분.** 구조 수정 뒤 다시 리뷰했을 때 «같은 종류의 뿌리»가 또 나오면
수정이 병을 옮겼을 뿐이다. 14건을 접으면:

| 뿌리 | 건 |
|---|---|
| 모듈 안 **쌍둥이 메서드 표류** (issue×2·consume×2·revoke×2·count×2 에 불변식이 한쪽만) | F1·F3·F10·F12 |
| 워크플로 출력이 tri-state 날것이라 **라우트 넷이 프로토콜을 재해석** | F6·F11·F14 |
| expand-contract **전환 잔재** | F2·F5·F9 |
| admin-web 조회 **seam 위치**(서버 fuzzy top-10 을 클라가 정확일치로 분류) | F4·F7 |
| 지엽 | F8·F13 |

첫 줄이 결정적이다 — ADR-0034 가 라우트에서 없앤 「복붙 후 표류」가 **모듈 안으로 내려왔다.**

**시험 2 — 인터페이스 폭 대 불변식.** 모듈이 `consumeGrantIfUnused(grantId)` 를 내놓고
*어느 장을 고를지*는 훅(`hooks/cart/coupon-usage.ts` → `grants.ts::selectGrantToConsume`)이
정한다. 고르기와 CAS 가 다른 층에 있으니 그 사이의 레이스(F1: 같은 고객의 두 카트가 결정적으로
같은 장을 고름)는 호출자의 문제가 된다. 삭제 시험: `selectGrantToConsume` 을 지우면 FEFO 규칙이
호출자 **한 곳**에서만 다시 필요하다 — 모듈의 정책이 밖에 나가 있는 것이다.

**시험 3 — 매단 자리의 문서 정당성.** `completeCartWorkflow` 레퍼런스가 노출하는 훅은
`validate` 하나다. `orderCreated` 는 `complete-cart.js` 런타임에만 있고 `.d.ts` 에 없다
(`@ts-expect-error` 로 눌러 쓴다). 소모 메커니즘 전체가 미문서 seam 위에 있다. **이 문제는
이 PR 이 풀지 않는다** — ADR-0034 개정이 걸린 결정이라 PR-3 으로 분리했다(§6).

**결론.** 모델(`coupon_grant` 단일 정본 · `issue_key` 파셜 유니크 · 커스텀 모듈 · 워크플로
경유)은 건강하다. 고칠 것은 **모듈 인터페이스의 깊이**와 **워크플로 출력의 모양**이다.

## 2. 실측 근거

- **`selectGrantToConsume` 의 소비자는 `hooks/cart/coupon-usage.ts` 하나다** (2026-09-03 grep).
  `usableGrants`·`hasUsableGrant`·`nextExpiryAt`·`grantsGovernUsage`·`latestUsedAt` 는 표시·게이트
  6곳이 쓰므로 남는다.
- **소모 훅의 HTTP 커버리지는 0이다.** 쿠폰 HTTP 스펙 10개 중 카트를 «완료»하는 것이 없다 —
  소모는 스펙에서 전부 `consumeGrantIfUnused(id)` 직접 호출로 만든다. 즉 훅 재배선의 방어선은
  모듈 통합 스펙이고, 훅 자체는 얇아야 한다.
- **`issueGrant` 와 `markGrantUsedIfUnused` 의 프로덕션 호출자는 `scripts/backfill-coupon-grants.ts`
  하나다.** `issueGrant` 는 `issueGrantWithSlot({max_claims:null, enforce_cap:false})` 와 같다.
- **`.run()` 횟수.** 대량발급은 고객당 1회(최대 500), 고객축은 프로모션당 1회(최대 500), 자동발급은
  프로모션당 1회. `medusa-config.js` 는 `workflow-engine-redis` 라 각 실행이 Redis 왕복이다.
  문서는 “implement all custom flows within workflows, then execute them from API routes” 이므로
  워크플로를 걷는 것은 답이 아니다 — **입력을 배치로** 만드는 것이 답이다.
- **스토어프론트는 클레임 응답 본문을 읽지 않는다.** `web/almondyoung-storefront/src/lib/api/medusa/
  {promotion,store}.ts` 의 `claimCoupon` 은 둘 다 `Promise<void>`. 클레임 페이지의 `result.reason` 은
  preview 응답이다. 200 본문을 두 경로에서 한 모양으로 바꿔도 깨지는 소비자가 없다.
  HTTP 스펙 한 곳(`coupon-grant.spec.ts` «이미 보유한 고객의 재클레임…»)만 `reason: 'already_issued'`
  를 단언하므로 그 필드는 유지한다.
- **channel-adapter 는 `skipped.reason` 을 닫힌 어휘로 센다**
  (`apps/channel-adapter/src/observability/coupon-issue.metrics.ts`). 자동발급 응답의 사유 집합을
  늘리는 것은 계약 변경이다 — 이 PR 은 늘리지 않는다.
- **`no-duplicate-validate-hooks.unit.spec.ts` 는 소스를 정규식
  `/(\w+Workflow)\.hooks\.(\w+)\s*\(/g` 로 스캔한다.** 훅 등록 줄의 식별자 연쇄
  `completeCartWorkflow.hooks.orderCreated(` 는 그대로 남겨야 가드가 계속 센다.

## 3. 결정

### 결정 1 — 소모는 모듈 안에서 «고르기+CAS 한 문장»으로

```ts
consumeOneUsableGrant(input: {
  promotion_id: string; customer_id: string; order_id: string; now: Date;
}, sharedContext?: Context<EntityManager>): Promise<string | null>   // 소모한 grant id, 없으면 null
```

```sql
UPDATE "coupon_grant" SET "used_at" = ?, "order_id" = ?, "updated_at" = now()
 WHERE "id" = (
   SELECT "id" FROM "coupon_grant"
    WHERE "promotion_id" = ? AND "customer_id" = ?
      AND "deleted_at" IS NULL AND "used_at" IS NULL
      AND ("expires_at" IS NULL OR "expires_at" >= ?)
      AND NOT EXISTS (SELECT 1 FROM "coupon_grant" o
                       WHERE o."promotion_id" = ? AND o."customer_id" = ?
                         AND o."order_id" = ? AND o."deleted_at" IS NULL)
    ORDER BY "expires_at" ASC NULLS LAST, "issued_at" ASC, "id" ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED)
 RETURNING "id"
```

- **FEFO** 는 `ORDER BY` 가, **만료 경계(포함)** 는 `expires_at >= now` 가, **재호출 멱등성**은
  `NOT EXISTS(order_id)` 가, **동시성**은 `FOR UPDATE SKIP LOCKED` 가 맡는다. 옛 훅이 애플리케이션
  코드로 들고 있던 네 규칙이 전부 한 문장에 들어간다.
- 두 카트가 동시에 완료되면 한쪽이 잠근 장을 다른 쪽이 **건너뛰고 다음 장**을 잡는다 — F1 이
  재시도 루프 없이 구조로 사라진다. 장이 하나뿐이면 늦은 쪽은 `null` 이고, 그건 정답이다.
- `null` 은 「소모할 장이 없다」다 — 발급 개념이 없는 `public` 쿠폰이 대부분이라 **경고하지 않는다.**
  옛 훅의 「이미 사용됐거나 회수됨」 경고는 고르기/CAS 분리가 만든 상태였고, 이제 생기지 않는다.
- 삭제: `grants.ts::selectGrantToConsume`, `hooks/cart/coupon-usage.ts`(+ 유닛 스펙),
  `grants.unit.spec.ts` 의 「selectGrantToConsume — FEFO」 블록. 그 행동은 모듈 통합 스펙으로 옮긴다.
- `consumeGrantIfUnused(grantId, …)` 는 **id 로 찍는 원시 연산**으로 남긴다 — 백필과 스펙 픽스처가
  쓴다. 핫패스 호출자는 훅 하나이고 그것은 `consumeOneUsableGrant` 만 부른다.

### 결정 2 — 쌍둥이를 줄인다

| 지금 | 뒤 |
|---|---|
| `issueGrant` / `issueGrantWithSlot` | `issueGrantWithSlot` 만. 백필은 `{max_claims:null, enforce_cap:false}` 로 부른다 |
| `consumeGrantIfUnused` / `markGrantUsedIfUnused` | `consumeGrantIfUnused`(id 원시) + `consumeOneUsableGrant`(핫패스). `markGrantUsedIfUnused` 는 백필 스크립트 안으로(조회 + `consumeGrantIfUnused`) |
| `countIssuedGrants(…, ctx)` / `countIssuedGrantsByPromotion(ids)` | 둘 다 `sharedContext?` 를 받는다(F10) |
| `revokeGrants` / `revokeGrantsByIssueKeys` | 0단계에서 이미 한 본체 |

백필 스크립트는 contract PR 이 지우므로 그 안에 5줄이 늘어나는 것은 감수한다.

### 결정 3 — 워크플로는 배치를 받고 verdict 를 돌려준다

```ts
type IssueGrantRequest = {
  promotion_id: string; customer_id: string; issue_keys: string[];
  issued_via: IssueTrigger; expires_at: string | null;      // ISO — 엔진 직렬화
  max_claims: number | null; enforce_cap: boolean;
};
type IssueGrantVerdict = 'issued' | 'partial' | 'already_issued' | 'exhausted' | 'error';
type IssueGrantResult = {
  promotion_id: string; customer_id: string; verdict: IssueGrantVerdict;
  created: number; duplicated: number; error?: string;
};
// 입력 { requests: IssueGrantRequest[] } → 출력 { results: IssueGrantResult[] } (입력과 같은 순서·길이)
```

| verdict | 뜻 | 라우트가 하는 일 |
|---|---|---|
| `issued` | created ≥ 1, 상한 안 닿음 | issued 에 넣는다 |
| `partial` | created ≥ 1 인데 도중에 상한 | issued **와** skipped(`max_claims_exceeded`) 둘 다 — 옛 루프와 같다 |
| `exhausted` | created 0, 상한 | skipped(`max_claims_exceeded`) |
| `already_issued` | created 0, 전부 duplicate | skipped(`already_issued`) — 「응답에 없는 항목」이 되지 않게 |
| `error` | 그 요청만 던짐 | 고객·프로모션 축: skipped(`grant_error`) + `logger.error(error)` / 자동발급: `failed` |

- **요청 하나의 예외는 그 요청의 `error` 로 격리한다** — 스텝이 던지면 배치 전체가 실패하고
  보상이 이번 실행의 «성공한» 장까지 걷어간다. 「한 고객의 장애가 나머지를 막지 않는다」는
  라우트 셋이 지키던 요구이므로 스텝 안에서 잡는다. 보상 데이터는 그대로 두되(created 키 목록),
  스텝이 던지지 않으므로 사실상 잠든 안전망이다 — 설계 문서(정본 1벌화 §3 결정 2)가 이미 그렇게 규정했다.
- **`.run()` 은 요청당 1회.** 대량발급 500명 → 1회. 자동발급 프로모션 N개 → 1회.
- **라우트 응답 모양은 바꾸지 않는다** — 고객축 `{issued: string[], skipped}`, 쿠폰축
  `{issued: {customer_id, granted}[], skipped, force}`, 자동발급 `{issued: {promotion_id, code}[], skipped}`.
  admin-web `BulkIssueResult`·`skip-reason-labels.ts`·channel-adapter 메트릭이 전부 그대로다.
- `issueKeys` 는 `submit_id`·수량에만 의존하므로 루프 밖에서 한 번 만든다(F14).

### 결정 4 — 클레임 200 본문은 한 모양

```ts
{ success: true, promotion_id: string, issued: boolean, reason?: 'already_issued' }
```

- 첫 클레임: `{ success: true, promotion_id, issued: true }`
- 빠른 경로(usable 장 보유) **와** 원자 경로의 `already_issued`(쓴 장 보유자의 재클릭):
  `{ success: true, promotion_id, issued: false, reason: 'already_issued' }`
- `exhausted` → 지금처럼 `NOT_ALLOWED`(발급 수량 소진). `error` → `UNEXPECTED_STATE`.

두 소비자(스토어프론트 `Promise<void>` 둘) 모두 본문을 읽지 않으므로 additive 다.

## 4. 하지 않는 것

- **소모 훅의 자리(`orderCreated`)를 옮기지 않는다.** PR-3 (ADR-0034 개정 선행).
- **상한 COUNT 를 카운터로 되돌리지 않는다**(F2). 셀 대상이 `max_claims` 로 유계고 파셜 인덱스만
  탄다 — 락 직렬화 지적은 유효하지만 이 PR 의 문제가 아니다.
- **자동발급의 500 정책을 바꾸지 않는다**(F6). `skipped.reason` 어휘가 channel-adapter 계약이라
  200+`failed` 로 바꾸는 것은 그쪽과 함께 결정할 일. 이 PR 은 verdict 매핑만 정리한다.
- **admin-web 회원 조회(F4·F7)** 는 user-service 정확일치 조회 문제 — 별도 트랙.
- **마이페이지 6쿼리 직렬(F8)·`fillClaims` 3중복(F13)** — 후속. 이 PR 의 seam 과 무관하다.
- 마이그레이션 0. 응답 계약 변경 0(클레임 본문은 additive).

## 5. 이 설계가 해소하는 리뷰 지적

| # | 지적 | 어떻게 |
|---|---|---|
| F1 | CAS 실패 시 다음 장 재시도 없음 | 결정 1 — 고르기+CAS 한 문장, SKIP LOCKED |
| F9 | 단일 스텝 워크플로의 Redis 왕복 ×N | 결정 3 — 배치 입력, `.run()` 1회 |
| F10 | `countIssuedGrantsByPromotion` 이 ctx 거부 | 결정 2 |
| F11 | 클레임 200 본문 2종 | 결정 4 |
| F14 | `issueKeys` 루프 안 재생성 | 결정 3 |
| F6(부분) | 자동발급이 verdict 를 제각각 읽음 | 결정 3 의 표 — 500 정책은 유지 |

## 6. PR-3 에 넘기는 것 — 소모 seam

후보 셋. 코드보다 ADR-0034 개정과 스파이크가 먼저다.

- (a) 기존 `validate` 핸들러 안에서 `consumeOneUsableGrant` 를 부르고 **훅 보상**으로 복원 —
  문서: “the hook handler is a step function, you can set its compensation function”. 검사와 소모가
  한 문장이 되어 F1 의 창 자체가 닫힌다. `validate` 는 결제 승인 전이므로 승인 실패 시 보상이 복원.
- (b) `order.placed` 구독자 — 문서화된 자리, at-least-once 는 `NOT EXISTS(order_id)` 가 받는다.
- (c) 캠페인 예산 `use_by_attribute`(v2.11+, 설치 2.13.4 에 존재) — `customer_id` 별 사용 횟수를
  엔진이 집행하고 `registerUsageStep` 이 completeCart 에서 기록한다. ADR-0034 의 기각 근거
  (「전체 사용량이라 1인 1장 불가」)는 낡았다. 단 캠페인 재부착이 필요해 `detach-coupon-campaigns`
  가 다룬 창 충돌(날짜 없는 캠페인은 필터 안 함)을 스파이크로 재확인해야 한다.

어느 쪽이든 `consumeOneUsableGrant` 가 그대로 쓰인다 — 그래서 이 PR 이 먼저다.
