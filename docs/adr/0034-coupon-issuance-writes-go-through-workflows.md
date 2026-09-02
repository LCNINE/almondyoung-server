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
issueCouponGrantWorkflow:  issueGrantStep → createRemoteLinkStep
revokeCouponGrantWorkflow: revokeGrantsStep → dismissRemoteLinkStep
```

링크 생성 실패는 워크플로 실패가 되고, 앞선 스텝이 보상된다. **`.catch(() => {})` 로 삼키는
것이 구조적으로 불가능해진다** — 지금 C 와 D 가 하고 있는 것이 그것이다.

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
- **Medusa 캠페인 예산으로 돌아가지 않는다.** 캠페인 예산은 «전체 사용량» 이라 1인 1장 · 개별
  만료 · 사용 이력을 표현하지 못한다. `coupon_grant` 는 그 빈칸을 메우는 것이 맞다.

## 결과

- 발급 프로토콜이 라우트 4곳에서 **모듈 1곳 + 워크플로 1곳**으로 모인다. 표류할 표면이 없어진다.
- 링크 실패를 삼키는 경로가 사라진다 — 삼키려면 워크플로를 우회해야 하고, 그건 리뷰에서 보인다.
- 「1장 = 1회」 가 애플리케이션 읽기-후-쓰기가 아니라 **SQL 술어**로 집행된다.
- 대가: 발급 한 건당 워크플로 오버헤드가 붙는다. 대량발급은 곱 상한 1000 이 이미 있으므로
  실측이 필요한 구간은 그 상한 근처뿐이다.
