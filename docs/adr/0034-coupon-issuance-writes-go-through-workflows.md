# 쿠폰 발급 쓰기는 워크플로를 지난다 — 모듈 안은 트랜잭션, 모듈 밖은 보상

`coupon_grant` 테이블로 옮기면서 쿠폰 발급 경로가 넷이 됐다. 넷은 서로 다른 것을 하지 않는다 —
같은 12단계 프로토콜(슬롯 예약 → 장 생성 → 실패 시 되돌리기 → 표시용 링크 생성)을 **각자 손으로
재현한다.** 이 ADR 은 그 재현을 그만두는 경계를 정하고, 왜 그 경계가 Medusa 의 결에 맞는지를
적는다.

[[0033-coupons-are-owned-by-the-sales-channel]] 을 뒤집지 않는다. 그 ADR 은 쿠폰이 *어디에*
사는지를 정했고(Medusa 안), 이 ADR 은 그 안에서 쓰기가 *어떤 길로* 지나는지를 정한다.
[[0025-single-transaction-runner]] 의 "트랜잭션은 전파한다" 와 같은 판단이되, 대상이 drizzle
서비스가 아니라 Medusa 모듈이라 장치가 다르다.

## 왜 「복제해서 규율로 맞춘다」가 실패했는가

네 경로 — 고객축 수동발급(A) · 쿠폰축 대량발급(B) · 자동발급 트리거(C) · 셀프 클레임(D) —
을 12단계로 나란히 놓으면 **7단계에서 갈린다.**

| 단계 | A | B | C | D |
|---|---|---|---|---|
| 입력 상한 | 수량 1–50, **곱 상한 없음** | 수량 1–50, 고객 ≤500, **곱 ≤1000** | — | — |
| status·is_automatic | skip 사유 등재 | 조기반환 사유 | **query 필터로 제외 → 사유 없음** | throw |
| 「이미 보유」 선검사 | 없음 | 없음 | 없음 | **있음** |
| grant 실패 시 | skip·break | skip·break | **throw 500** | throw |
| 링크 실패 처리 | 반환값 → `link_error` | 반환값 → `link_error` | **`.catch()` 삼킴** | **`.catch()` 삼킴** |
| 링크 복구 경로 | 전량-duplicate 분기 | 전량-duplicate 분기 | **없음** | **구조적으로 불가능** |

결정적인 것은 갈렸다는 사실 자체가 아니라 **갈린 방식**이다.

A 와 B 는 주석까지 복붙 수준으로 같고 서로를 가리키는 주석이 여섯 곳 있다("형제(쿠폰축) 라우트와
같은 계약이다"). 그런데도 곱 상한이 B 에만 있다. 그리고 A 의 주석은 이렇게 적혀 있다 —
*「형제(쿠폰축) 라우트는 Task 12 리뷰에서 이 수정을 받았는데 이쪽은 빠져 있었다」*.

**표류가 이미 한 번 일어났고, 사람이 손으로 따라잡은 기록이 코드에 남아 있다.** 서로를 명시적으로
참조하는 주석 여섯 개도 그것을 못 막았다. 규율로 두 벌을 맞추는 방식은 이 지점에서 이미 시험을
치렀고 떨어졌다.

D 의 링크 구멍은 특히 라우트 안에서 고칠 수 없다. 「이미 보유」 빠른 경로가 링크 생성보다 앞에
있어서, 링크 없이 장만 있는 고객이 재클릭하면 영원히 200 만 돌려주고 링크 생성 지점에 닿지
않는다. 코드 주석도 *「로그가 유일한 단서다」* 라고 인정한다. 순서를 바꾸면 다른 것이 깨진다 —
이건 라우트가 프로토콜을 들고 있는 한 풀리지 않는 매듭이다.

## 측정 — 문서에 없던 두 가지

이 결정은 Medusa 가 무엇을 지원하는지에 달려 있는데, **둘 다 문서에 답이 없어서 소스와 실 DB 로
확인했다.** 기록해 둔다. 다음에 같은 질문이 열릴 때 다시 파지 않도록.

**1. `createRemoteLinkStep` 은 보상이 내장돼 있다.** `llms.txt` → helper-steps → 개별 레퍼런스
페이지 어디에도 롤백 언급이 없다. 소스가 답이었다:

```js
// @medusajs/core-flows/dist/common/steps/create-remote-links.js
createStep('create-remote-links',
  async (data, { container }) => { await link.create(data); return new StepResponse(data, data) },
  async (createdLinks, { container }) => { await link.dismiss(createdLinks) })   // ← 보상
```

`dismissRemoteLinkStep` 도 대칭으로 보상이 있다 — dismiss 전 상태를
`link.list(…, { asLinkDefinition: true })` 로 보존했다가 `link.create` 로 되살린다. 회수
워크플로의 롤백도 따로 짤 필요가 없다.

**2. 트랜잭션은 모듈 서비스 메서드 경계를 넘어 전파된다 — 컨텍스트를 넘기면.** 문서는
"여러 메서드 호출에 걸친 트랜잭션은 다루지 않는다" 로 비어 있다. 데코레이터 소스가 답이었다:

- `@InjectTransactionManager` — `if (originalContext?.transactionManager) return originalMethod.apply(...)`
  → 이미 트랜잭션이 있으면 새로 열지 않고 **참여한다**
- `@InjectManager` (`MedusaService` 가 생성 메서드에 자동으로 붙인다) —
  `copiedContext.transactionManager = originalContext.transactionManager` → **그대로 전달한다**

실 DB 스펙으로 확인했다. 슬롯 raw UPDATE 와 `createCouponGrants` 를 한 트랜잭션에 넣고 throw
하면 `{ grants: 0, issued: 0 }` 로 **둘 다 롤백**되고, 예외 없이 끝내면
`{ grants: 1, issued: 1 }` 로 **둘 다 커밋**된다.

**즉 「슬롯 예약과 장 생성이 따로 논다」는 제약은 없었다.** 지금 네 라우트가 손으로 밟는 예약·해제
춤은 필요해서 있는 게 아니라, 묶을 수 있다는 사실을 몰라서 있는 것이다.

**3. 트랜잭션 안에서 ORM 쓰기와 원시 SQL 은 «쓴 순서대로 실행되지 않는다».** 구현하고 나서
모듈 통합 스펙이 잡아낸 것이다. `MedusaService` 가 만든 `createCouponGrants` 는 MikroORM
unit-of-work 라 엔티티를 **등록만** 하고 INSERT 를 커밋 시점 flush 까지 미룬다. 반면
`em.execute` 로 쓴 슬롯 UPDATE 는 즉시 나간다. 그래서 코드에서 INSERT 를 위에 적어도 실제
SQL 순서는 뒤집히고, 두 가지가 한꺼번에 깨졌다 —

- 상한에 닿은 프로모션에 「이미 받은 사람」이 재시도하면 `'duplicate'` 가 아니라
  `'exhausted'` 가 나온다(이 ADR 이 없애려던 바로 그 증상이 ORM 의 지연 flush 로 되살아난다)
- 커밋 시점에 터진 유니크 위반은 `MikroOrmBaseRepository.transaction` 에서 던져지므로
  우리 `try/catch` 를 **벗어나** `'duplicate'` 로 변환되지도 않는다

해법은 `createCouponGrants` 직후의 명시적 `flush()` 다. 이 두 증상은 **목으로는 재현되지
않는다** — 결정 4 의 게이트가 없었으면 리뷰에서도 통과했을 것이고, 실제로 그렇게 통과할
뻔했다.

## Decision

### 1. 모듈 경계 «안» 의 다단 쓰기는 한 트랜잭션 메서드로 묶는다

`@InjectTransactionManager` + `@MedusaContext` 로 감싼 메서드 하나가 슬롯 예약과 장 생성을
함께 처리하고, 호출부에는 **결과만** 돌려준다.

```
issueGrantWithSlot(...) → 'created' | 'duplicate' | 'exhausted'
consumeGrantIfUnused(grantId, orderId, usedAt) → boolean
```

`reserveClaimSlot` / `releaseClaimSlot` 을 짝지어 부르는 책임은 호출부에서 사라진다.
반환값이 `'duplicate'` 를 `'exhausted'` 보다 먼저 결정하므로, 「이미 받은 사람이 재클릭하면
발급 수량이 모두 소진되었습니다」 가 되는 순서 문제도 함께 사라진다.

**조건부 쓰기는 술어를 SQL 에 적는다.** `consumeGrantIfUnused` 는
`UPDATE … WHERE id = ? AND used_at IS NULL RETURNING id` 다. 읽고 검사한 뒤 쓰는 방식은
쓰지 않는다 — `markGrantUsedIfUnused` 가 그 모양이었고, 이름과 달리 원자적이지 않다(list →
검사 → 무조건 UPDATE). 단일 스레드 백필에서는 안전했지만 핫패스 가드로는 쓸 수 없다.
같은 파일의 `reserveClaimSlot` 이 이미 올바른 기법을 쓰고 있다.

### 2. 모듈 경계를 «넘는» 쓰기는 워크플로 + 보상을 지난다

장(`promotion-meta` 모듈)과 표시용 링크(link 모듈)는 서로 다른 모듈이라 한 트랜잭션에 들어가지
않는다. 그 자리가 보상의 자리다.

```
issueCouponGrantWorkflow: issueCouponGrantsStep → createRemoteLinkStep
```

링크 생성 실패는 워크플로 실패가 되고, 앞선 스텝이 보상된다(이번 실행이 만든 장만 회수하고
그만큼 슬롯을 되돌린다 — `duplicated` 는 이전 제출이 만든 남의 것이라 건드리지 않는다).
**`.catch(() => {})` 로 삼키는 것이 구조적으로 불가능해진다** — C 와 D 가 하고 있던 것이 그것이다.

**회수(revoke)에는 대칭 워크플로를 두지 않는다.** 처음엔 `revokeCouponGrantWorkflow` 를 같이
두려 했으나, 만들면서 두 가지가 드러났다. 첫째, 결정 1 이 회수 경로를 이미 자기치유로
만들었다 — 링크는 「남은 장이 없을 때만」 걷고, 회수할 장이 0개여도 그 판정을 하므로, 한 번
어긋나도 **다음 회수 시도가 고친다**. 둘째, soft delete 의 보상은 「되살리기 + 슬롯 재예약」인데
그 재예약은 그 사이 상한이 찼으면 **정당하게 실패할 수 있다**. 복구하지 못하는 보상은 없는
것보다 나쁘다 — 롤백됐다고 믿게 만든다. 그래서 회수는 직접 호출로 남긴다.

이것이 Medusa 가 이 문제에 대해 제공하는 답이고, 이 저장소는 이미 그 답을 쓰고 있다 —
커스텀 워크플로 12개가 있고 그중 `capture-order-payments` · `register-auth-identity` ·
`create-product-steps` 세 스텝이 보상 함수를 갖는다. 새 패턴을 들여오는 것이 아니다.

### 3. 라우트에는 정책 게이트·워크플로 호출·응답 모양만 남는다

발급 가능 여부 판정(visibility · status · 발급창 · eligibility)은 이미
`issuance-rules.ts` · `validity.ts` 로 뽑혀 있다. 라우트는 그 조합을 부르고, 워크플로를 부르고,
자기 축에 맞는 응답을 만든다.

네 경로에 **남아도 되는 차이는 응답 모양뿐이다.** 고객축은 `promotion_id` 목록을, 쿠폰축은
`customer_id`+`granted` 목록을 돌려준다 — 축이 실제로 달라서 나는 정당한 차이다. 나머지 6개
갈림은 정당하지 않으므로 사라진다.

### 4. 이 결정의 방어선은 실 DB 통합 스펙이고, 그것을 CI 게이트에 꽂는다

1·2번이 고치는 결함들은 **목으로는 전부 통과하고 실 DB 에서만 갈린다.** 조건부 UPDATE 가
정말 조건부인지, 트랜잭션이 정말 함께 롤백되는지는 목이 알려주지 않는다.

그런데 그 방어선이 꽂혀 있지 않았다:

- CI(`medusa-unit-tests.yml`)는 `npm run test:unit` 만 돌았다
- `test:medusa:integration` 은 루트 `package.json` 에 있으나 **어느 워크플로에도 없었다**
- `integration-tests/http/` 에 쿠폰 전용 스펙 8개(~150KB)가 있는데 **한 번도 게이트를 통과한
  적이 없다**

지식이 없어서가 아니었다는 점이 중요하다. `@medusajs/test-utils` 가 `DATABASE_URL` 이 아니라
`DB_HOST`/`DB_PORT`/`DB_USERNAME`/`DB_PASSWORD` 를 읽는다는 함정은 이미
`docs/local-dev.md` §6 에 적혀 있었고, `scripts/local/run-medusa-integration.sh` 가 그 넷을
파생시켜 넘기는 래퍼로 존재했다. **아는데 안 꽂혀 있었다** — 「사람이 로컬에서 돌리는 것이
유일한 방어선」이라고 문서가 스스로 적어둔 상태로 남아 있었다.

그 상태의 대가도 확인됐다. 문서는 "postgres 만 있으면 된다" 고 적고 있었지만 실제로는 redis 도
필수다(`medusa-config.js` 에서 `TEST_TYPE` 으로 in-memory 로 갈리는 것은 `event_bus`
하나뿐이고 `cache-redis`·`caching-redis`·`workflow-engine-redis`·`locking-redis` 는 실제
접속한다 — redis 없이 돌리면 부팅 단계에서 실패한다). **아무도 안 돌리는 절차는 틀린 채로 남는다.**

그래서 이 ADR 의 **첫 번째 실행 항목은 코드가 아니라 게이트다.** 통합 스펙을
`medusa-unit-tests.yml` 에 postgres + redis service 와 함께 붙이고, 로컬 절차의 오류를
바로잡는다.

## 하지 않는 것

- **모델을 바꾸지 않는다.** `coupon_grant` 테이블과
  `idx_coupon_grant_issue_key` unique(promotion_id, customer_id, issue_key) 는 건강하다 —
  발급 멱등성을 DB 가 잡고 있고, 테이블 쓰기는 이미 서비스 안에 봉해져 있다(호출부 0곳).
  고치는 것은 모델이 아니라 **쓰기가 지나는 길**이다.
- **Medusa 코어 라우트를 override 하지 않는다.** CLAUDE.md 의 확장 권장 순서를 그대로 따른다.
- **모듈 서비스를 교체하지 않는다.** 그 결론이 나오면 그 자체가 오답 신호다
  ([[framework-extension-points-need-docs]] 가 기록한 실사고).
- **Medusa 캠페인 예산으로 돌아가지 않는다.** ~~캠페인 예산은 «전체 사용량» 이라 1인 1장 · 개별
  만료 · 사용 이력을 표현하지 못한다.~~ 이 근거는 v2.11 의 `use_by_attribute` 로 낡았다 — 바뀐
  기각 사유는 아래 「2026-09-04 개정」 의 기각 (c) 다. 결론은 같다: `coupon_grant` 가 장부다.

## 결과

- 발급 프로토콜이 라우트 4곳에서 **모듈 1곳 + 워크플로 1곳**으로 모인다. 표류할 표면이 없어진다.
- 링크 실패를 삼키는 경로가 사라진다 — 삼키려면 워크플로를 우회해야 하고, 그건 리뷰에서 보인다.
- 「1장 = 1회」 가 애플리케이션 읽기-후-쓰기가 아니라 **SQL 술어**로 집행된다.
- 대가: 발급 한 건당 워크플로 오버헤드가 붙는다. 대량발급은 곱 상한 1000 이 이미 있으므로
  실측이 필요한 구간은 그 상한 근처뿐이다.

## 2026-09-03 보강 — 결정 1 은 소모 seam 에도, 결정 3 은 verdict 로

PR #778 머지 직전 재리뷰 14건을 세 시험(접기의 2차 미분 / 인터페이스 폭 대 불변식 / 매단 자리의
문서 정당성)으로 판정한 결과는 `docs/superpowers/specs/2026-09-03-coupon-module-depth-design.md` 에
있다. 이 ADR 에 닿는 결론 둘:

- **결정 1 「조건부 쓰기는 술어를 SQL 에 적는다」는 소모의 «선택»에도 적용된다.** `consumeGrantIfUnused(id)`
  는 술어를 SQL 에 두었지만 *어느 id 인지*는 훅이 골랐다 — 고르기와 CAS 가 다른 층에 있어 같은
  고객의 두 카트가 같은 장을 골랐다. `consumeOneUsableGrant` 가 FEFO·만료 경계·재호출(순차) 멱등성·
  `FOR UPDATE SKIP LOCKED` 를 한 UPDATE 로 묶는다. 핫패스는 이것만 부른다.
  (2026-09-04 개정에서 `consumeOneUsableGrantForCart` 로 — 키가 주문에서 카트로, 결과가 세 값으로)
- **결정 3 「라우트에는 정책 게이트·워크플로 호출·응답 모양만」은 워크플로 출력이 날것이면 지켜지지
  않는다.** `{created[], duplicated[], exhausted}` 를 라우트 넷이 제각각 접었다. 워크플로가 요청
  배치를 받아 요청당 `verdict`(`issued|partial|already_issued|exhausted|error`) 를 돌려주고,
  `.run()` 은 HTTP 요청당 1회다. 요청 하나의 예외는 그 요청의 `error` 로 격리한다 — 스텝이 던지면
  보상이 성공분까지 걷는다.

**결정 2 의 매단 자리(`orderCreated`)는 미문서 훅이다** — `completeCartWorkflow` 레퍼런스는 `validate`
하나만 노출한다. 그 이전은 별도 결정(PR-3)이며 이 ADR 의 개정으로 다룬다. 후보와 스파이크 항목은
위 설계 문서 §6.

## 2026-09-04 개정 — 소모 seam 은 `validate` 훅이고, 소모의 키는 카트다 (PR-3)

이슈 #782 의 결정이다. 쿠폰 «소모»(주문에 쓰인 장을 `used_at` 으로 찍는 것)는
`completeCartWorkflow.hooks.orderCreated` 에 매달려 있었고, 그 훅은 **문서에 없다**(레퍼런스가
노출하는 훅은 `validate` 하나, `.d.ts` 에도 없어 `@ts-expect-error` 로 눌러 썼다). 후보는 넷이었다 —
(a) `validate` 핸들러 안에서 소모 + 훅 보상 (b) `order.placed` 구독자 (c) 캠페인 예산
`use_by_attribute` (d) 그대로 두고 가드 스펙만. **(a) 를 택한다.** 이유는 "문서화된 자리" 하나가
아니다 — 소모를 `validate` 로 옮기면 **검사와 소모가 같은 문장이 되어** 결정 1 이 라우트와 모듈에서
없앤 「읽고 검사한 뒤 쓰기」가 훅에서도 사라진다. 자리 문제와 원자성 문제가 같은 수로 풀린다.

### 측정 — 이번에 소스로 확인한 것 (재조사 금지)

Medusa 2.13.4. 경로는 `apps/medusa/node_modules/@medusajs/` 아래.

1. **`completeCartWorkflow` 의 순서** (`core-flows/dist/cart/workflows/complete-cart.js`):
   `acquireLockStep(key: cart.id)`(:259) → `order_cart` 링크 조회(:264) →
   `validateCartPaymentsStep`(:285) → `compensatePaymentIfNeededStep`(:288) → **`validate` 훅(:291)** →
   `when("create-order", !orderId)`(:296) { `createOrdersStep`(:408) → `parallelize(` 링크 생성 ·
   `completed_at` · 재고예약 · `registerUsageStep` · `order.placed` 발행 `)`(:483) →
   `beforePaymentAuthorization`(:493, `@ignore`) → `authorizePaymentSessionStep`(:499) →
   `orderCreated`(:522, `@ignore`) } → `releaseLockStep`(:528). 옵션은 `idempotent: false, store: true`.
   함의 셋: ① 같은 카트의 동시 완료는 락이 직렬화한다 ② 이미 주문이 있는 카트를 다시 완료하면 주문
   생성은 건너뛰지만 **`validate` 는 다시 지난다** ③ **`validate` 시점엔 주문 id 가 없다.**
2. **훅 핸들러는 보상 함수를 가진 스텝이다.** `workflows-sdk/dist/utils/composer/create-hook.js` 의
   `function hook(invokeFn, compensateFn)` 이 `createStepHandler({ compensateFn: compensateFn ?? noop })`
   로 등록한다. 실패 시 오케스트레이터는 `DONE` 상태 스텝과 `PERMANENT_FAILURE` 스텝 **모두**에
   `beginCompensation()` 을 건다(`orchestration/dist/transaction/transaction-orchestrator.js`
   `flagStepsToRevert`). 단 **실패한 스텝 자신의 보상은 invoke 출력을 받지 못한다** —
   `helpers/create-step-handler.js` 의 compensate 는 `stepArguments.invoke[stepName]?.output` 이 없으면
   `undefined` 로 부른다. 즉 훅 안에서 «소모 뒤 throw» 하면 그 소모는 훅 보상이 아니라 **훅 자신이**
   되돌려야 한다.
3. **돈은 마지막 스텝에서 움직인다.** `apps/medusa/src/modules/almond-payment/service.ts:153`
   `authorizePayment` — 지연 승인의 확정은 여기서 일어나고, 실패는 throw 되어 워크플로가 주문·예약을
   롤백하며 고객 돈은 움직이지 않는다. `validate` 는 그보다 앞이다. 지연 승인이 아닌 옛 intent 는
   `compensatePaymentIfNeededStep`(측정 1) 이 받는다 — 이것도 `validate` 앞에 있다.
4. **훅 입력 카트에 최상위 `customer_id` 는 없다.** `completeCartFields`(`core-flows/dist/cart/utils/
   fields.js`) 는 `customer.*` 를 싣는다. 워크플로 자신도 `cart.customer?.id` 로 읽는다(:452
   `registrationContext`). 실측(2026-09-04, `coupon-consume.spec.ts` ⑦): 같은 필드 목록으로 읽은
   행에는 최상위 `customer_id` 도 **함께 온다** — 목록엔 없지만 카트 FK 라 실린다. 그래서 옛
   `cart.customer_id` 읽기도 틀리지 않았고, 새 코드의 `cart.customer?.id ?? cart.customer_id ?? null`
   은 둘 다 맞는 값이다(다른 가드 셋의 동작 변화 없음). 단 ⑦ 은 훅 인자 자체를 캡처한 것이 아니라
   같은 필드 목록의 재질의다.
5. **캠페인 예산의 집행은 원자적이지 않다.** `promotion/dist/services/promotion-module.js:127`
   `registerUsage` 는 `listActivePromotions_` 로 읽고 `+1` 해서 `update` 한다(read-modify-write).
   `use_by_attribute` 도 같다 — `registerCampaignBudgetUsageByAttribute_`(:75) 가 `list` → `create`
   또는 `update`. 한도 판정은 `computeActions`(:428, **카트 계산 시점**) 에 있고, 등록(:91) 의 판정은
   주문 생성 뒤 `parallelize` 안에서 돈다. 어느 쪽도 «같은 고객의 두 카트» 를 막지 못한다.
6. **(개정 전) `coupon_grant.order_id` 를 읽는 프로덕션 코드는 `restoreGrantsByOrder` 하나였다.**
   스토어 응답(`store/customers/me/promotions/format-promotion.ts`)·스토어프론트·admin-web 은
   읽지 않는다. 백필 스크립트가 옛 링크 행에서 옮겨 적었을 뿐이다. → PR-3 에서 `restoreGrantsByOrder`
   는 `restoreGrantsByCart` 로 바뀌며(결정 6) 읽는 곳이 0 이 됐다.
7. **카트를 완료하는 HTTP 스펙은 둘**(`coupon-cap.spec.ts` · `deferred-approval-checkout.spec.ts`)이고
   **소모를 단언하는 스펙은 없다.** cap 스펙의 wallet 스텁(`POST /v1/payment-intents` 하나)은
   `validate` 까지 닿는 최소 픽스처라 그대로 재사용한다.
8. **완료 호출자는 다섯** — `store/carts/[id]/complete` · `store/payment-intents/[intentId]/complete` ·
   `hooks/payment-events`(무통장 선생성) · 복구 스크립트 둘. 전부 `completeCartWorkflow.run` 이라 훅
   하나가 전부를 덮는다. `order.placed` 도 같은 워크플로가 발행하므로 (b) 의 커버리지도 같았다.

### 결정 5 — 소모는 `validate` 훅의 «검사» 그 자체다. 되돌림은 훅의 보상이다

지금 `validate` 는 장을 **읽어서 검사**하고(`listGrantsForCustomer` → `hasUsableGrant`), 소모는 열 스텝
뒤의 다른 훅이 **쓴다**. 그 사이가 창이다 — 같은 고객의 두 카트가 장 하나로 둘 다 검사를 통과하면
할인 주문이 둘 선다(#778 재리뷰 F1 의 남은 절반). PR-2 는 «고르기와 CAS» 를 한 문장으로 합쳤고, 이
결정은 **«검사와 소모»** 를 한 문장으로 합친다.

```
consumeOneUsableGrantForCart({ promotion_id, customer_id, cart_id, now })
  → { outcome: 'consumed', grant_id } | { outcome: 'already', grant_id } | { outcome: 'none' }
```

- `consumed` — 이 카트가 장을 하나 잡았다(FEFO · 만료 경계 · `SKIP LOCKED` 는 PR-2 의 SQL 그대로).
  id 를 모아 훅 보상의 입력으로 돌려준다.
- `already` — 이 카트가 이미 잡은 장이 있다. 완료된 카트의 재완료(측정 1-②)와 엔진의 재호출이
  여기로 온다. **통과**다. 옛 구조에서는 재완료가 `validate` 를 다시 지나며 «장이 이미 사용됨» 으로
  `COUPON_EXPIRED` 를 냈다 — 주문이 이미 있는데 거절하는 경로였고, 이 결정이 부수적으로 닫는다.
- `none` — 잡을 장이 없다. 장이 사용을 지배하는 쿠폰(`grantsGovernUsage`)이면 `COUPON_EXPIRED` 로
  거절한다. 늦은 카트는 여기로 온다. `public` 쿠폰은 오늘처럼 정책(`isUsable`)이 정하되 장이 있으면
  소모는 시도한다 — 현행 `orderCreated` 훅과 같은 의미다.

**훅 안에서 소모는 마지막이다.** 통관부호·멤버십·캡 백스톱 등 다른 거절이 전부 지난 뒤에 소모
루프가 돈다. 그리고 **소모 루프 안의 거절은 자기가 잡은 장을 먼저 놓고 던진다** — 실패한 스텝의 보상은
빈손으로 불리기 때문이다(측정 2). 훅이 성공하고 뒤 스텝(주문 생성 · 재고예약 · 결제 승인)이 실패하면
그때는 훅 보상이 id 목록을 받아 되돌린다. 두 경로 모두 같은 `restoreGrants(ids)` 를 지난다.

**레퍼런스의 문장 “Don't use this hook to mutate the cart's line items or totals” 는 이렇게 읽는다.**
이 시점엔 총액이 결제 세션에 묶여 있으니 총액을 바꾸는 쓰기를 금하는 것이다. 우리 모듈 테이블에의
쓰기는 총액을 건드리지 않고 보상이 있다. 결정 2 「모듈 경계를 넘는 쓰기는 워크플로 + 보상을 지난다」
가 소모에도 그대로 적용되는 셈이다 — 발급이 `issueCouponGrantsStep` + 보상이듯 소모는 `validate` 훅
+ 보상이다. (이 해석은 2026-09-04 결정 시 확인됐다 — 「이 동작을 카트를 고치는 것으로 보지 않는다」.)

### 결정 6 — 소모의 키는 주문이 아니라 카트다

`validate` 시점엔 주문이 없다(측정 1-③). 결정이 내려지는 순간에 존재하는 것이 키여야 한다. 카트다.

- `coupon_grant.cart_id` 를 추가한다(nullable + 인덱스, additive 마이그레이션 1건). 핫패스는
  `order_id` 를 **더 쓰지 않는다.** 소모 SQL 의 재호출 멱등성 술어도 `order_id` 에서 `cart_id` 로 옮긴다.
  같은 카트의 동시 호출은 워크플로 락(측정 1-①)이 직렬화하므로 PR-2 가 «순차 한정» 이라 적어둔
  `NOT EXISTS` 의 한계는 이 자리에서는 닿지 않는다.
- 주문 ↔ 카트는 Medusa 의 `order_cart` 링크가 안다(`link-modules/dist/definitions/order-cart.js`,
  `order.cart` 별칭). 취소 복원 구독자(`subscribers/coupon-grant-restore.ts`)는 주문 → 링크 →
  `cart_id` 로 장을 고른다. **`order_id` 폴백은 두지 않는다** — 이 기능은 라이브에서 돈 적이 없어
  그 컬럼이 가리키는 주문이 없다(2026-09-04 확인). 폴백은 섬길 데이터가 없는 코드다.
- `order_id` 는 PR-3 에서 **읽기·쓰기를 전부 끊고**(핫패스·복원·백필 스크립트·스펙 픽스처), 컬럼
  자체는 **다음 배포 뒤 별도 PR 에서 DROP** 한다. CLAUDE.md 의 「column drop 은 2 PR」 규칙인데,
  Medusa 에서는 이 규칙이 더 무겁다 — 컨테이너가 부팅하며 스스로 migrate 하므로 같은 PR 에 DROP 을
  넣으면 롤링 중 옛 태스크(`orderCreated` 훅이 아직 `order_id` 를 쓴다)가 DROP 을 만난다. 옛 훅은 그
  실패를 삼키니 사고는 아니지만, 규칙을 깨서 얻는 것이 없다. DROP PR 의 선행 조건 하나: 라이브에서
  `SELECT count(*) FROM coupon_grant WHERE order_id IS NOT NULL` 이 0 인 것을 본다. 「어느 주문이 썼나」는
  그 뒤로 `order_cart` 조인이 답한다.
- **되돌림 본체는 하나다** — `restoreGrants(ids)`. 훅 보상(이번 실행이 잡은 id) · 취소 구독자(카트로
  고른 id) · 아래 스위퍼(조건으로 고른 id) 가 전부 이것을 지난다. 「만료된 장은 되살리지 않는다」 는
  고르는 쪽(구독자)의 필터로 남기고, 보상은 잡은 것을 무조건 놓는다 — 보상은 undo 이지 정책이 아니다.
  PR-2 가 모듈 안에서 걷어낸 쌍둥이(issue×2 · consume×2 · revoke×2)를 restore 로 다시 만들지 않는다.

### 결정 7 — 실패 정책이 바뀐다: 소모 실패는 주문 거절이다

`orderCreated` 시절의 I1 「기록 실패로 결제된 주문을 되돌리지 않는다」 는 **결제 뒤 훅에 맞는**
정책이었다. `validate` 는 돈이 움직이기 전이다(측정 3). 여기서 소모가 실패하면(`none` 이든 DB 오류든)
주문은 서지 않고 고객 돈은 움직이지 않는다 — 이미 `COUPON_EXPIRED` 가 하는 일이다. 그래서 새 훅
코드는 `try/catch` 로 삼키지 않는다. 삼키면 검사가 아니게 된다.

**남는 창은 프로세스 사망이다** — 훅이 커밋한 뒤 워크플로가 끝나기 전(수 초) 에 Medusa 가 죽으면
«주문 없는 소모» 가 남는다. 보상은 살아 있는 프로세스만 돌린다. 두 겹으로 받는다:

- 같은 카트의 재시도는 `already` 로 통과한다(락 TTL 2분 뒤). 고객이 재시도하는 경우는 스스로 낫는다.
- 버린 카트는 **스위퍼 잡**이 되돌린다 — `used_at IS NOT NULL AND cart_id IS NOT NULL` 이고 `order_cart`
  가 없고 카트 `completed_at IS NULL` 이고 소모 뒤 1시간이 지난 장. 되돌린 건수를 로그로 남긴다.
  선례는 `jobs/orphan-payment-reconcile.ts`(같은 모양의 잔여 케이스를 매시 훑는다).

옛 구조의 같은 창은 반대 방향이었다 — 주문은 섰는데 장이 안 찍힘(고객에게 유리, 회사가 한 장 손해).
새 구조는 고객에게 불리한 방향이라 스위퍼가 **선택이 아니라 결정의 일부**다 — PR-3 범위로 확정
(2026-09-04). 후속으로 미루지 않는다.

### 기각

- **(b) `order.placed` 구독자.** 자리는 문서화됐지만 검사(`validate`)와 소모(구독자)가 갈라진 채라
  F1 의 창이 그대로 남는다 — 결정 1 이 금지한 «읽고 검사한 뒤 쓰기» 의 모양이다. 주문이 이미 선 뒤라
  `none` 이 나와도 할 수 있는 것이 로그뿐이고, 겹치는 재전달 가드(파셜 유니크) 마이그레이션이 따로
  필요하다. 커버리지는 (a) 와 같다(측정 8) — 이점이 없다.
- **(c) 캠페인 예산 `use_by_attribute`.** 이 ADR 본문의 옛 기각 근거(「전체 사용량이라 1인 1장 불가」)는
  v2.11 부터 낡았다 — 정정한다. 새 근거는 측정 5 다: 집행이 원자적이지 않고, 판정 시점이 카트 계산이며,
  등록은 주문 생성 뒤다. 게다가 «어느 장을 썼나·언제 만료되나» 의 장부 훅은 여전히 필요하므로 seam
  문제를 없애지 못한 채 진실만 둘이 된다(`promotion_meta.max_claims` 와 예산 limit 의 의미 분리,
  날짜 없는 캠페인 재부착과 `detach-coupon-campaigns` 정합까지 덤으로).
- **(d) 유지.** 미문서 훅 · `@ts-expect-error` · F1 창 · 재완료 거절이 전부 남는다. 가장 싸지만 세
  시험(매단 자리의 문서 정당성)의 지적을 위험으로 문서화만 하는 선택이다.

### 증명 — 스펙

결정 4 그대로: 방어선은 실 DB 스펙이다. 이 결정의 주장은 전부 목으로는 구별되지 않는다.

- HTTP `integration-tests/http/coupon-consume.spec.ts` (cap 스펙의 wallet 스텁 재사용):
  ① 발급 장 하나 → 완료 → `used_at` · `cart_id` 찍힘, 주문 생김
  ② 같은 고객의 두 번째 카트 → 400 `COUPON_EXPIRED`, 주문 없음
  ③ `validate` 뒤 스텝 실패 → 장이 돌아옴 (스텁이 `GET /v1/payment-intents/:id` 에 실패 상태를 주어
  `authorizePaymentSessionStep` 이 던지게 한다 — 스텁 10줄)
  ④ 완료된 카트의 재완료 → 200 · 같은 주문 id · 장 그대로(`already`)
  ⑤ 주문 취소 → 링크 경유 복원
  ⑥ 스위퍼는 주문 없는 소모만 되돌리고, 주문이 선 소모는 놓지 않는다
  ⑦ 훅 입력 카트에서 고객 id 는 `customer.id` 로 읽힌다(측정 4 실측 겸함 — 같은 필드 목록의 재질의)
- 모듈 `service.integration.spec.ts`: 새 SQL 의 세 결과 · 카트 키 멱등성 · `SKIP LOCKED`.

### 이행 순서 (PR-3, 코드는 결정 뒤)

1. 모듈 — `cart_id` 마이그레이션(`Migration20260904120000`) · `consumeOneUsableGrantForCart` ·
   `restoreGrants` · `restoreGrantsByCart` · `listStuckConsumptions` 로 되돌림 통합 → 모듈 스펙.
2. 훅 — `hooks/cart/consume-coupon-grants.ts`(소모 헬퍼) + `hooks/cart/complete-cart.ts` 의
   `validate` 핸들러 **끝**에 소모, 두 번째 인자로 보상. `record-coupon-usage.ts` 삭제
   (`@ts-expect-error` 와 함께). 새 훅 등록은 없다 — `no-duplicate-validate-hooks.unit.spec.ts` 가
   지키는 규칙 그대로.
3. 구독자 — `subscribers/coupon-grant-restore.ts`, 취소 복원을 링크 경유로. `order_id` 를 읽는
   마지막 코드가 여기서 사라진다.
4. 스위퍼 — `scripts/restore-stuck-coupon-consumptions.ts` + `jobs/restore-stuck-coupon-consumptions.ts`
   (매시 23분, `COUPON_STUCK_MIN_AGE_MINUTES` 기본 60).
5. HTTP 스펙 — `integration-tests/http/coupon-consume.spec.ts` ①~⑦(⑦ = 측정 4 실측 겸용).
6. (다음 배포 뒤, 별도 PR) `order_id` DROP COLUMN — 선행 조건은 결정 6 의 count 0.

배포 제약: additive 마이그레이션 1건, Medusa 컨테이너가 부팅 시 자체 migrate 하므로(CLAUDE.md) 순서
제약 없음. 옛 태스크는 새 컬럼을 무시한다. 배포 직후 스위퍼의 첫 회는 0건이어야 한다 — 옛 행은
`cart_id` 가 없어 조건에 안 걸린다.

### 이 개정이 본문에서 바꾸는 것

- 「하지 않는 것」 의 캠페인 예산 항목 — 근거를 교체했다(결론 동일).
- 2026-09-03 보강 절의 「결정 2 의 매단 자리(`orderCreated`)는 미문서 훅이다 … 별도 결정(PR-3)」 —
  이 절이 그 결정이다.
- 2026-09-03 보강 절의 결정 1 문단 — `consumeOneUsableGrant` 는 `consumeOneUsableGrantForCart` 로
  바뀌었다(키가 주문에서 카트로, 결과가 세 값으로). 그 문단 자체는 09-03 시점의 기록이라 다시
  쓰지 않고, 문장 뒤에 이 개정을 가리키는 포인터만 붙였다.
