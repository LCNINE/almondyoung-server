# 쿠폰 보유 상태의 정본을 하나로 — 설계

> 2026-09-03. PR #778 리뷰에서 나온 13건을 뿌리로 접은 결과 나온 설계.
> 이 문서는 **왜** 를 적는다. **무엇을 어떤 순서로** 는
> `docs/superpowers/plans/2026-09-03-coupon-single-source-of-truth.md` 에 있다.

## 1. 문제

「이 고객이 이 쿠폰을 가지고 있는가」의 정본이 **셋**이다.

| 정본 | 무엇을 결정하나 | 누가 쓰나 |
|---|---|---|
| `coupon_grant` 행 | 쓸 수 있는가 | `PromotionMetaModuleService` |
| `promotion_meta.issued_count` | 상한에 걸리나 | 별도 raw SQL 4개 |
| customer↔promotion 링크 | 마이페이지·어드민에 보이나 | 워크플로 스텝 / 라우트 |

셋이 서로 다른 트랜잭션·다른 코드로 유지되므로 「둘이 어긋난 상태」가 언제든 만들어진다.
PR #778 리뷰 13건 중 **8건이 그 어긋남의 서로 다른 이름**이었다.

## 2. 실측 근거 (2026-09-03)

### 2.1 코어는 링크를 모른다

- `grep -rl "customer_promotion" apps/medusa/node_modules/@medusajs/` → **0건**.
  링크는 `apps/medusa/src/links/customer-promotion.ts` 의 `defineLink` 로 우리가 만든 것이고,
  코어 프로모션 모듈에 이를 읽는 코드가 없다.
- 코어가 고객을 보는 지점은 둘뿐이고 둘 다 링크가 아니다: 프로모션 `rules`,
  그리고 campaign budget 의 `use_by_attribute`
  (`@medusajs/promotion/dist/utils/compute-actions/usage.js` 는 `customer_id` 를
  **컨텍스트에서 뽑을 뿐** 링크를 조회하지 않는다).
- grep 에 잡히는 `promotions.id` 대부분은 링크가 아니라 **코어의 cart/order↔promotion 관계**다
  (`api/store/carts/query-config.ts`, `workflows/hooks/cart/complete-cart.ts:25`,
  `workflows/hooks/cart/record-coupon-usage.ts:59` 는 `entity: 'order'`).
  우리 링크를 실제로 읽는 곳은 **6곳뿐**이고, 그중 스토어프론트 2곳은 이미 grant 로 옮겨져 있다
  (`api/store/coupons/preview/route.ts:147`, `api/store/events/[slug]/route.ts:65` 의 주석).

### 2.2 링크는 새 모델을 표현할 능력이 없다

링크는 pivot 이라 (고객, 프로모션)당 **1행**인데, PR #778 은 `quantity` 로 N장 발급을 허용했다.
`extraColumns` 의 `used_at`/`expires_at`/`order_id`/`issued_via` 는 **N장 중 어느 장인지 말할 수 없다.**
공식 문서상 extra columns 는 읽기는 되지만 **필터링은 문서화돼 있지 않고**, 우리 코드도 그걸로
필터하지 않는다 — 판정은 전부 `coupon_grant` 가 한다. 즉 그 4개 컬럼은 이미 죽은 중복이다.

### 2.3 상한의 원자성은 카운터가 아니라 «행 락» 에서 온다

`PromotionMetaModuleService.reserveClaimSlot` (`service.ts:126-138`) 은

```sql
UPDATE "promotion_meta" SET "issued_count" = "issued_count" + 1
 WHERE "promotion_id" = ? AND "issued_count" < ? RETURNING "id"
```

인데, 이것이 상한을 지키는 이유는 `issued_count` **값**이 아니라 이 UPDATE 가 잡는
`promotion_meta` 행의 **배타 락**이다. Postgres READ COMMITTED 에서 두 번째 UPDATE 는 첫
커밋을 기다렸다가 `WHERE` 를 재평가한다.

같은 행을 `FOR UPDATE` 로 잠그고 `coupon_grant` 를 세면 **동일한 직렬화**를 얻는다.
`links/customer-promotion.ts:12` 의 「링크를 COUNT 하는 순간 원자성을 잃는다」는
`coupon_grant` 와 partial unique 인덱스가 생기기 **전** 판단이고, 지금은 근거가 소멸했다.

**COUNT 비용은 문제가 아니다.** 세는 대상이 `max_claims` 로 유계고(+ force 초과분),
상한 없는 프로모션은 애초에 세지 않으며, partial 인덱스
`idx_coupon_grant_promotion ON coupon_grant (promotion_id) WHERE deleted_at IS NULL` 이 이미 있다.

### 2.4 `issued_count` 는 지금 정의가 셋이다

| 어디서 | 무엇을 세나 | 근거 |
|---|---|---|
| 발급 | `max_claims !== null` 일 때만 +1 (**장 수**) | `service.ts:322` |
| 백필 | 링크 행 수 (**고객 수**) | `scripts/backfill-issued-count.ts:51-63` |
| 표시 | 「N**명**」 | `admin-web .../coupon-detail-dialog.tsx:163` |

`quantity` 도입이 1과 3을 갈랐고, 2는 원래 갈라져 있었다. 귀결:

- **라이브 결함 ①** 상한 없는 쿠폰의 어드민 발급현황은 언제나 `0명 (무제한)`.
  admin-web 은 이미 주석으로 자백한다 (`marketing-coupons-template.tsx:50`).
- **라이브 결함 ②** `backfill-issued-count` 를 PR #778 배포 후에 돌리면 `issued_count` 가
  「장 수」에서 「고객 수」로 깎여, 정당하게 소진된 슬롯이 풀리고 상한을 넘겨 발급한다.
  (리뷰 13건에 없던 항목이다.)

## 3. 결정

### 결정 1 — `issued_count` 를 `coupon_grant` COUNT 로 대체한다

발급 트랜잭션은 상한을 집행할 때만 `promotion_meta` 행을 `FOR UPDATE` 로 잠그고,
장을 INSERT 한 뒤 `coupon_grant` 를 세어 상한을 넘으면 되감는다.
카운터 mutator 4개(`reserveClaimSlot`·`releaseClaimSlot`·`incrementIssuedCount`·`setIssuedCount`)는
공개 표면에서 사라진다.

**「슬롯을 점유한다」의 정의는 `deleted_at IS NULL` 이다.** 회수된 미사용 장은 soft delete 되어
슬롯을 돌려주고, 사용된 장은 회수돼도 남아 슬롯을 계속 점유한다(이미 소비돼 다시 발급할 수 없다).
이는 옛 `revokeGrants` 의 의도(`service.ts:453-461` 주석)와 정확히 같다 — 차이는 그 의도를
**호출부가 짝지어 밟는 대신 데이터가 스스로 표현한다**는 것뿐이다.

### 결정 2 — 링크를 grant 의 파생물로 강등하고, 링크 쓰기를 없앤다

「발급된 프로모션 목록」은 `coupon_grant.promotion_id` 에서 유도한다. 링크를 읽는 남은 3곳
(마이페이지 1, 어드민 1, DELETE 경로 1)을 전부 grant 기준으로 바꾸고,
`issue-coupon-grant-workflow` 의 `createRemoteLinkStep` 과 두 DELETE 라우트의 `link.dismiss` 를 지운다.

이때 **워크플로의 보상이 «있으면 좋은 것»으로 내려앉는다.** 지금은 링크 스텝이 실패하면
이미 만든 장이 «보이지 않는 유령»이 되므로 보상이 정합성의 유일한 방어선이다. 링크가 사라지면
루프 중간 실패는 **부패가 아니라 부분 성공**이다 — 3/5 장이 발급됐고, 상한도 표시도 그 3장을
그대로 반영한다. 리뷰 발견 1·9 가 겨냥한 상태 자체가 만들어지지 않는다.

### 결정 3 — 회수 마커를 하나로 (`revoked_at`)

`deleted_at` 이 「슬롯을 안 점유한다」와 「회수됐다」를 겸하고 있어서, 회수 후 살아남은
**사용된** 장을 `restoreGrantsByOrder` 가 되살린다(리뷰 발견 2). `revoked_at` 을 추가해
회수 사실을 별도로 적고, 복구는 그 열이 비어 있는 장만 되돌린다.

`deleted_at` 의 의미와 partial unique 인덱스(`WHERE deleted_at IS NULL`)는 **건드리지 않는다** —
회수 후 재발급이 그 조건에 의존한다.

### 결정 4 — 링크 테이블 제거는 **이 계획에 넣지 않는다**

`CLAUDE.md` 의 expand-contract 규약상 column/table drop 은 별도 PR 이고, PR 사이에 deploy 가
끝나야 한다. 이 계획은 **읽기·쓰기를 전부 끊는 데까지**만 간다 (전 구간 additive).
링크 테이블과 `extraColumns` 제거는 이 계획이 라이브에서 한 사이클 돈 뒤 후속 PR 로.

## 4. 선행조건 (배포 아님, 착수 게이트)

**라이브에서 링크→grant 이관(`scripts/backfill-coupon-grants.ts`)이 완료됐는지 실측해야 한다.**
`api/store/customers/me/promotions/route.ts` 의 주석이 「아직 grant 없이 링크만 있는 구식 배정」을
명시적으로 다루고 있다 — 그런 행이 라이브에 남아 있으면 결정 2 가 그 고객들의 쿠폰을 통째로
사라지게 하고, 결정 1 이 상한을 과소 집계한다.

판정: 링크 행 수와 grant 보유 (고객, 프로모션) 쌍 수를 비교해 **차집합이 0** 이어야 한다.

## 5. 이 설계가 해소하는 리뷰 지적

| # | 지적 | 어떻게 사라지나 |
|---|---|---|
| 1 | 루프 중간 throw 시 grant 가 보상 없이 유령으로 남음 | 결정 2 — 링크가 없으면 유령 상태가 없다 (부분 성공) |
| 2 | revoke 가 남긴 used grant 를 주문취소가 되살림 | 결정 3 |
| 5 | dismiss 실패를 삼키고 removed 로 보고 | 결정 2 — dismiss 호출 자체가 사라진다 |
| 9 | 보상의 `releaseClaimSlot` 만 catch 없음 | 결정 1 — `releaseClaimSlot` 이 사라진다 |
| 11 | 재클릭이 매번 워크플로+링크 쓰기를 돌림 | 결정 2 — 링크 복구가 목적이었으므로 빠른 경로 복원 가능 |
| — | 백필이 «고객 수»로 상한을 깎음 (라이브 결함 ②) | 결정 1 + Task 8 |
| — | 상한 없는 쿠폰 발급현황 0 (라이브 결함 ①) | 결정 1 |

## 6. 이 설계가 해소하지 **않는** 것

리뷰 13건 중 아래 5건은 이 구조와 무관한 독립 결함이다. 이 계획은 그중 파일이 겹치는 2건만
막차로 태우고(Task 8), 나머지 3건은 **별도로 처리해야 한다 — 잊지 말 것**:

- **발견 4** — admin-web 회원 조회 `limit` 10 이 잘림을 못 막고 `total` 무시
  (`coupon-assign-dialog.tsx:80`)
- **발견 7** — 발급 tri-state 를 네 라우트가 제각각 해석
- **발견 13** — `looksLikePhone` 이 숫자 9자 이상을 전화번호로 오인
  (`classify-lookup-matches.ts:33`)

이 계획에 태우는 2건: 발견 6(페이지 내부 정렬), 발견 12(`consumeGrantIfUnused` 의 `updated_at`).
