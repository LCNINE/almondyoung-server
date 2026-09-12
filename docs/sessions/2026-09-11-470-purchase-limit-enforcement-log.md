# #470 구매제한 집행 — 작업 로그 (2026-09-11~12)

> **이 파일이 무엇인가.** `feat/470-purchase-limit-enforcement` 브랜치(29 커밋)를 만들면서 남긴
> 실행 원장이다. 그 브랜치는 **머지하지 않았고 재설계 예정**이다 — 코드는 버리더라도
> 여기 적힌 «발견»은 다시 쓰기 위해 develop 에 남긴다.
>
> **읽는 법.** 시간순이다. 세 종류의 줄이 섞여 있다:
> - `Ruling:` — 사람 대신 내린 판정 34건. 무엇을 왜 정했고 틀리면 무슨 비용인지.
> - `minor (deferred)` — 이연한 지적 44건. 재설계해도 상당수는 그대로 유효하다.
> - 나머지 — 태스크별 디스패치·리뷰 결과·실측.
>
> **재설계 때 먼저 볼 곳** (본문에서 검색):
> - `## 🔑 라이브 실측` — 이 기능이 «휴면» 임을 보인 숫자. 문제 정의가 여기서 바뀐다.
> - `Critical 1 (스크립트가 아웃박스` — 개통 작업이 다른 도메인을 망가뜨릴 뻔한 사슬.
> - `두 번째 프로듀서` / `세 번째 경로` — 같은 스냅샷을 만드는 경로가 넷이라는 발견.
> - `## 최종 whole-branch 리뷰 결과` — 남은 위험 전부와 그 우선순위.
>
> 브랜치 자체는 `feat/470-purchase-limit-enforcement` 로 보존돼 있다(설계·계획 문서는 그 안에 커밋됨).

---

# SDD ledger — plan: docs/superpowers/plans/2026-09-11-purchase-limit-enforcement.md

Spec: docs/superpowers/specs/2026-09-11-purchase-limit-enforcement-design.md (읽음)
Branch: feat/470-purchase-limit-enforcement (worktree 아님 — 세션이 in-place 로 설정됨, main/master 아님)
Base commit: dd9abce41

## 사전 스캔 (실행 전)

### 태스크 쌍 — 파일/인터페이스 공유

| 쌍 | 공유 대상 | 생산 ↔ 소비 | 결과 |
|---|---|---|---|
| T1 → T2 | `modules/purchase-limit/service.ts`, 같은 통합 스펙 | T2 가 T1 클래스에 메서드 추가 | 충돌 없음 (순서 보장됨) |
| T1 → T4 | `consumeOne(input)` / `ConsumeOutcome` | `{cart_id,customer_id,product_id,qty,limit}` → `consumed|already|exceeded{remaining}` | 시그니처 일치 |
| T1 → T5 | `getRemaining(customerId, productId, limit)` | → `number` | 일치 |
| T2 → T4 | `releaseClaims(ids[])` | 보상이 호출 | 일치 |
| T2 → T6 | `releaseByCart(cartId)` | 취소 구독자가 호출 | 일치 |
| T2 → T7 | `listStuckClaims(before, limit)` | 스위퍼가 호출, `{id,cart_id}[]` | 일치 |
| T3 → T4, T5 | `readPurchaseLimitMeta(product)` → `{synced,lifetimeLimit,minPerOrder,maxPerOrder}` | T5 가 `...meta` 스프레드로 `LimitCheckLine` 완성 | 필드 4개 정확히 일치 |
| T3 ↔ T9 | metadata 키 이름 | T9 가 쓰는 `pimMinQuantityPerOrder`/`pimMaxQuantityPerOrder` ↔ T3 이 읽는 같은 이름 | 일치 (오타 시 조용히 실패하므로 T9 리뷰에서 재확인) |
| T8 → T9 | 스냅샷 필드 `minQuantityPerOrder`/`maxQuantityPerOrder` | 일치 |
| T4, T5 → T7 | 배선 가드가 소스 문자열을 검사 | `consumePurchaseLimitsForCart(` · `restoreConsumedPurchaseLimits(` · `validatePurchaseLimits(` · `assertWithinPurchaseLimits(` | T4·T5 의 실제 호출 형태와 일치. T7 은 반드시 T4·T5 뒤 |
| T4, T5 → T11 | 에러 토큰 4종 | `EXCEEDED`·`MIN_QUANTITY`·`LOGIN_REQUIRED`·`NOT_SYNCED` | T11 파서 TOKENS 와 일치 |
| T12 → core API | `UpsertPurchaseConstraintDto` | `{requiresMembership, lifetimeQuantityLimit:number|null}` | 일치 |
| T4 ↔ T5 | 상품별 수량 합산 로직 | 입력 모양이 다름(`cartItems` vs `input.items`+`variants`) | 중복 아님 — 추출 강제하지 않음 |

### 태스크 자체 정합성

| 태스크 | 확인 | 결과 |
|---|---|---|
| T1 | 스펙이 부르는 메서드 ↔ 구현, 마이그레이션 ↔ 모델, `ON CONFLICT` 술어 ↔ 파셜 유니크 | 일치. 기대값 검산 완료(remaining 3/1/2) |
| T2 | `injectManual` 이 같은 태스크에서 정의됨, CTE 한 문장 | 일치 |
| T3 | 6 케이스 ↔ `positiveInt` 동작 | 일치 |
| T4 | 목 서비스 ↔ 실제 시그니처, `MedusaError` 는 파일에 이미 import 됨 | 일치 |
| T5 | — | **발견 1 (아래)** |
| T6 | 목의 `'query'`/`'logger'` ↔ `ContainerRegistrationKeys` 실측값 | 일치 (실측 확인) |
| T7 | `stripComments` ↔ complete-cart 의 `//` 주석 블록 | 일치 |
| T8~T12 | 이웃 파일 규약을 읽어 맞추라는 지시 | 코드 전량을 적지 못한 자리 — 구현자가 파일을 열어야 함 |

### 발견과 판정

**발견 1 — T5 의 `reject()` 가 타입 좁히기를 못 할 수 있다.**
`const reject = (...): never => {...}` 형태는 TypeScript 제어흐름 분석에서 never-returning 으로
인정되지 않는 경우가 있다(변수 자체에 타입 주석이 필요). 그러면 `if (!ctx.customer_id) reject(...)`
뒤에서 `ctx.customer_id` 가 여전히 `string | null` 로 남아 `getRemaining` 호출이 타입 에러가 난다.

Ruling: 구현자가 `const reject: (token: string, productId: string, remaining: number) => never = (...) => {...}`
로 «변수에» 타입을 주석하거나, 호출부를 `throw rejectionOf(...)` 형태로 바꾼다 — 둘 중 무엇이든
`npm run type-check` 가 0 이면 된다. 계획의 의미(토큰 + 잔여 수량 동봉)는 바꾸지 않는다.
비용: 틀리면 T5 에서 타입 에러로 한 라운드 더 돈다. 기능 영향 없음.

**발견 2 — T8~T12 는 계획이 코드 전량을 담지 못한다.**
core 어셈블러의 진입 시그니처, transformer 함수명, core 스크립트 실행 패턴, storefront 테스트 러너,
admin-web 폼 구조는 이웃 파일을 읽어야 알 수 있어 계획이 「열어서 맞추라」로 남겼다.

Ruling: 그 태스크들의 구현자에게 **읽을 이웃 파일을 명시**해 디스패치한다(브리프에 이미 적혀 있다).
플레이스홀더가 아니라 의도적 위임으로 취급하고, 리뷰는 「이웃 규약을 따랐는가」로 본다.
비용: 틀리면 해당 태스크만 한 라운드 더. 다른 태스크로 번지지 않는다.

**발견 3 — T7 의 가드는 T4·T5 가 끝나야 초록이다.**
Ruling: 순서를 계획대로 지킨다(T7 은 7번째). T7 이 빨가면 가드를 고치지 말고 배선을 고친다 —
계획 본문에 이미 그렇게 적혀 있다. 비용: 없음.

스캔 결과: 서로 모순되는 태스크 없음. Global Constraints 와 충돌하는 태스크 없음.
리뷰 루브릭이 결함으로 볼 만한 계획 강제 사항 없음(T4↔T5 중복은 중복이 아님을 확인).

## 진행

Task 1: dispatched (model sonnet, BASE dd9abce41, brief task-1-brief.md, report task-1-report.md)
Task 1: implementer DONE (commit cbbc5d694) — 통합 5/5, 모듈 전체 157/157 주장
Task 1: task review dispatched (model opus, diff review-dd9abce41..cbbc5d694.diff)
Task 1: controller check — 루트 `npm run type-check` 에러 0 (기준선 유지). 구현자가 본 apps/medusa tsc 오류 3건은 루트 tsconfig 범위 밖이며 이 태스크와 무관.
Task 1: task review = Needs fixes. Important 5건(1·2·3 은 plan-mandated), Minor 6건.

Task 1: Ruling: Important 1 (consumeOne 이 쓰기 둘을 자기 트랜잭션 없이 한다) — **고친다**.
  계획 코드가 틀렸다. 스펙(구속력 있는 권위)이 요구한 것은 「원자적 소모」인데, UPSERT 는 즉시 커밋되고
  createPurchaseLimitClaims 는 별도 트랜잭션을 연다 — 사이에서 실패하면 카운터만 오르고 claim 이 없어
  **영구히 해제 불가**다. 되돌림(T2)이 claim 을 근거로 하므로 데이터 손상 경로다.
  처방: promotion-meta 선례대로 공개 래퍼 → `@InjectTransactionManager() @MedusaContext()` 본체 위임.
  비용: 틀리면 T1 에 한 라운드 더. 안 고치면 라이브에서 해제 불가능한 카운터가 쌓인다.

Task 1: Ruling: Important 2 (멱등성이 read-then-act) — **고친다. 순서를 뒤집는다.**
  claim INSERT 를 카운터 UPSERT «앞»에 두고, (cart_id, product_id) 유니크 인덱스가 멱등성의 판정자가
  되게 한다 — unique 위반 = `already`. 트랜잭션 안이므로 진 쪽은 롤백되어 카운터도 안 오른다.
  이건 쿠폰 선례가 이미 발견한 순서다(promotion-meta: 「장 생성이 슬롯 예약보다 먼저다」).
  비용: 틀리면 한 라운드. 안 고치면 같은 카트 동시 완료가 `already` 아닌 원시 unique 예외로 튄다.

Task 1: Ruling: Important 3 (claim 질의 술어 ↔ 유니크 인덱스 술어 불일치) — **인덱스를 좁힌다.**
  두 선택지 중 「질의에서 released_at 을 뺀다」가 아니라 「인덱스를 `WHERE deleted_at IS NULL AND
  released_at IS NULL` 로 좁힌다」를 택한다. 전자는 해제된 카트의 재완료를 소모 없이 통과시켜 fail-open 이
  된다 — fail-closed 를 택한 설계와 어긋난다. 후자는 해제가 슬롯을 비워 재클레임이 가능해진다.
  모델 `.indexes()` 와 마이그레이션 «둘 다» 같이 바꿔야 한다(브리프 제약 ①의 3자 정합).
  비용: 틀리면 한 라운드. 마이그레이션은 아직 어디에도 적용된 적이 없어 in-place 수정이 안전하다.

Task 1: Ruling: Important 4 (마이그레이션이 어떤 테스트도 안 돈다) — **부분 수용.**
  moduleIntegrationTestRunner 가 모델로 스키마를 만든다는 지적은 사실이고 구조적 한계다. 다만 새 마이그레이션
  테스트 하네스를 이 태스크에서 만드는 건 저장소 전반 문제라 범위 밖이다. 대신 (a) `qty` 양수 검증을 추가해
  드리프트된 CHECK(`nonneg`)가 «코드 경로에서 도달 불가»하게 만들고, (b) 마이그레이션에 「모듈 러너가 이
  파일을 돌리지 않는다」는 주석을 박고, (c) 모델·마이그레이션 술어를 한 쌍으로 바꾸도록 지시한다.
  비용: 틀리면 마이그레이션 SQL 의 오타가 라이브 첫 부팅에서만 드러난다. 그 위험은 남긴다.

Task 1: Ruling: Important 5 (동시성 스펙이 «원자적»과 «직렬화됨»을 구별 못 한다) — **고친다.**
  이 태스크의 핵심 주장을 검증하는 유일한 테스트가 우연에 의존해선 안 된다. 트랜잭션 둘을 명시로 열어
  T1 미커밋 상태에서 T2 가 블록되고 T1 커밋 후 0행을 받는 결정적 스펙을 «추가»한다(기존 것은 유지).
  Ruling 1 이 sharedContext 를 받게 만들므로 이제 쓸 수 있다.
  비용: 틀리면 한 라운드. 안 고치면 이 스펙이 미래에 조용히 아무것도 단언하지 않게 된다.

Task 1: minor (deferred): `input.limit!` non-null 단언 — 도달 시 remaining=NaN
Task 1: minor (deferred): `const [claim] = await (this as any)…` — any 구조분해 무방비
Task 1: minor (deferred): `down()` 의 DROP TABLE CASCADE (저장소 관행과 일치)
Task 1: minor (deferred): claim 테이블에 qty>=0 CHECK 없음 (qty 검증이 대체)
Task 1: minor (deferred): 커밋 트레일러·루트 jest 증거는 diff 로 확인 불가 — 컨트롤러가 루트 type-check 0 은 직접 확인함
Task 1: fix round 1/5 dispatched (원 구현자 재개, FIX_BASE cbbc5d694, 5 Important 전달)
Task 1: fix round 1 구현 완료 (commit 41db712dd) — 5건 전부 판정대로 반영 주장, purchase-limit 6/6 + 모듈 158/158
Task 1: fix round 1 re-review dispatched (model sonnet, diff review-cbbc5d694..41db712dd.diff)
Task 1: fix round 1/5 (5 addressed, 0 open; commits cbbc5d694..41db712dd)
Task 1: minor (deferred): `isUniqueViolation` 이 promotion-meta/service.ts 의 바이트 단위 복제 — 저장소 관행이나 DRY 부채
Task 1: complete (commits dd9abce41..41db712dd, review clean)

Task 2: Ruling (사전) — 브리프 코드는 T1 «수정 전» 구조로 쓰였다. T1 fix 가 서비스를 공개 얇은 래퍼 →
  `@InjectTransactionManager() @MedusaContext()` protected 본체로 갈랐으므로, 쓰기를 둘 이상 하는 새 메서드는
  같은 패턴을 따라야 한다. 특히 `releaseByCart` 는 SELECT + release 두 문장이라 «반드시» 트랜잭션 본체가 필요하다.
  비용: 안 하면 T1 에서 고친 것과 똑같은 「사이에서 실패하면 반만 반영」 구멍이 되돌아온다.

Task 2: Ruling (사전) — 브리프의 `releaseClaims` CTE 에 실제 결함이 있다. `UPDATE counter c ... FROM released r`
  는 같은 `(customer_id, product_id)` 로 매칭되는 r 이 여러 행이면 **카운터를 한 번만** 갱신한다(Postgres 가
  임의의 한 행을 고른다). 카트 안에서는 유니크 인덱스가 중복을 막지만 **스위퍼는 여러 카트의 claim 을 한 번에
  넘기므로** 같은 고객·상품이 겹칠 수 있다 — 그때 차감이 샌다.
  처방: `released` 를 `(customer_id, product_id)` 로 GROUP BY 해 `SUM(qty)` 를 만든 뒤 그걸로 UPDATE 한다.
  비용: 안 고치면 스위퍼가 돌 때마다 조용히 한도가 덜 풀린다 — 로그도 안 남는다.
Task 2: dispatched (model sonnet, BASE 41db712dd, 사전 판정 A·B·C 전달)
Task 2: implementer DONE (commit 8122dadaf) — 모듈 통합 9 suites/164 tests PASS 주장, type-check 0 주장
Task 2: 구현자 자체 발견 — 브리프 `injectManual` 의 `EXCLUDED.manual_qty` 가 음수 주입을 무효화하던 버그를 함께 수정(회귀 스펙 추가 주장). 리뷰가 판정한다.
Task 2: task review dispatched (model opus, diff review-41db712dd..8122dadaf.diff)
Task 2: task review = Spec ✅ / quality Approved, 단 Important 1건(plan-mandated) + Minor 5건.
Task 2: controller check — 커밋 3건 전부 `Claude-Session:` 트레일러 존재(리뷰어의 ⚠️ 해소).

Task 2: Ruling: Important 1 (`listStuckClaims` 의 유일한 스펙이 `return []` 로도 통과한다) — **고친다.**
  이 findings 는 plan-mandated 다(브리프가 그 스펙을 지정했다). 그래도 고친다 — 이유는 계획 자신이
  Task 7 에서 #833 을 인용하며 「죽은 코드를 유닛 스펙이 초록으로 지키는 병」을 막겠다고 선언했기 때문이다.
  같은 병을 스위퍼 조회에 남기면 그 선언이 위선이 된다. 스위퍼는 훅 보상이 실패한 claim 의 «마지막 그물»이고,
  `return []` 로의 회귀가 초록으로 배포되면 그물이 조용히 사라진다.
  처방: 원시 SQL 로 claim 의 `created_at` 을 과거로 밀고 (a) 그 claim 이 «반환되는지» (b) 이미 해제된 claim 이
  «제외되는지» (c) LIMIT 이 배치를 자르는지 셋을 단언한다. 스위트는 이미 원시 EM 을 갖고 있다.
  비용: 틀리면 한 라운드. 안 고치면 T7 의 스위퍼가 무엇 위에 서 있는지 아무도 모른 채 배포된다.

Task 2: minor (deferred): `manual_qty` 스펙이 «어느 컬럼이 줄었는지» 구별 못 함 — getRemaining 이 합만 노출
Task 2: minor (deferred): `injectManual` 에 정수 가드 없음 — `GREATEST(0, 1.5)` 가 integer 컬럼에서 조용히 반올림. 형제 메서드(consumeOne_)는 가드가 있다
Task 2: minor (deferred): `releaseClaims` 가 카운터 행이 없을 때 조용히 차감을 건너뛰고도 양수를 반환
Task 2: minor (deferred): 동시 `releaseClaims` 배치 둘이 카운터 행 잠금 순서로 교착 가능 — 스위퍼가 두 태스크에서 동시에 돌 때만. **T7 디스패치에 포인터로 실을 것**

Task 2: 🔴 Ruling (절차 교정): **루트 `npm run type-check` 는 `apps/medusa` 를 제외한다** (tsconfig.json:7 에서 확인).
  T1·T2 에서 내가 「루트 type-check 0」을 검증 증거로 두 번 보고했는데 그 범위에 이 태스크들의 파일이 없다.
  medusa 작업의 실질 게이트는 «통합 스펙 실행»뿐이다 — jest 도 swc transpile-only 라 타입을 안 본다.
  앞으로 medusa 태스크에서는 루트 type-check 를 증거로 인용하지 않는다. admin-web(T12)·storefront(T11) 도 같은 이유로
  각 트리의 tsc 를 따로 돌려야 한다.
Task 2: fix round 1/5 dispatched (원 구현자 재개, FIX_BASE 8122dadaf, Important 1건)
Task 2: fix round 1 구현 완료 (commit a0d7d25aa, 테스트 전용 diff) — bug-injection 으로 판별력 확인 주장(새 스펙 (a) RED, 기존 약한 스펙은 GREEN 유지 = 리뷰 지적 재현)
Task 2: fix round 1 re-review dispatched (model sonnet, diff review-8122dadaf..a0d7d25aa.diff)
Task 2: fix round 1/5 (1 addressed, 0 open; commits 8122dadaf..a0d7d25aa)
Task 2: complete (commits 41db712dd..a0d7d25aa, review clean)

Task 3: Ruling (사전) — 브리프의 테스트 명령이 부정확하다. `apps/medusa` jest 는 `TEST_TYPE` 으로 유닛/통합을
  가르므로 `TEST_TYPE=unit NODE_OPTIONS=--experimental-vm-modules npx jest <path>` (= package.json 의 `test:unit`)
  가 맞다. 브리프의 `npx jest <path>` 만으로는 설정이 안 잡힌다. 비용: 틀리면 구현자가 명령에서 헤맨다.
Task 3: dispatched (model haiku — 브리프에 코드 전량이 있고 파일 2개짜리 순수 함수, BASE a0d7d25aa)
Task 3: implementer DONE (commit 6c2346a69) — 유닛 6/6 통과 주장
Task 3: task review dispatched (model sonnet, diff review-a0d7d25aa..6c2346a69.diff) — JS 강제변환 함정(`Number('')===0`, `Number([3])===3`) 판정 요청
Task 3: task review = Spec ✅ / Approved, Critical·Important 0건, Minor 3건.
Task 3: minor (deferred): 강제변환 엣지(`'3.5'`·`Infinity`·`''`·`true`·`[3]`)에 테스트 없음 — 리뷰어가 손으로 전수 추적해 «전부 null 로 안전»함을 확인. 커버리지 구멍이지 계약 위반 아님. 브리프 원문의 구멍
Task 3: minor (deferred): 쓰레기값 루프가 `.lifetimeLimit` 만 단언 — 전체 객체 `toEqual` 이 더 강함
Task 3: minor (deferred): `pimPurchaseConstraint` 가 «명시적 null» 인 경우(생략이 아니라) → `synced:false`. 의도에 맞지만 무문서·무테스트. **T9 에 의미 있음**: transformer 가 `?? null` 을 쓰므로 미동기화 상품이 이 경로로 온다
Task 3: complete (commits a0d7d25aa..6c2346a69, review clean)

Task 4: Ruling (사전) — 소모는 라인마다 «별도 트랜잭션»이다. T1 fix 로 `consumeOne` 이 컨텍스트 없으면 스스로
  트랜잭션을 열기 때문이다. validate 훅에서 트랜잭션 매니저를 얻는 지원된 경로가 없으므로 이대로 두고,
  거절 전 `releaseClaims(claimIds)` 가 보상 역할을 한다. 구현자에게 「한 트랜잭션으로 묶지 마라」고 지시했다.
  비용: 라인 3개 중 2번째에서 실패하면 1번째 소모가 잠깐 커밋됐다가 즉시 해제된다 — 창이 좁고 보상이 덮는다.
  리뷰어에게 named risk 로 넘겨 판정받는다.
Task 4: dispatched (model sonnet, BASE 6c2346a69, 판정 A~F 전달. ADR 경로 docs/adr/0034-coupon-issuance-writes-go-through-workflows.md 확인)
Task 4: implementer DONE (commit a21e8de17) — 헬퍼 유닛 6/6, hooks 5 suites/35 tests 주장
Task 4: controller check — [A] query.graph 필드 125-126행 존재 / [C] 한도 343행 < 쿠폰 352행 / 훅 중복 등록 없음. 셋 다 직접 확인.
Task 4: task review dispatched (model opus). named risk 로 넘긴 것: **StepResponse 보상 payload 모양 변경**
  — 옛 코드는 `ConsumedCouponGrants` 를 직접 실었고 새 코드는 `{grants, limits}` 를 싣는다. 워크플로 엔진이
  스텝 출력을 DB 에 영속화하므로, 배포 롤오버 중 시작된 워크플로가 배포 후 보상을 돌면 옛 모양을 읽어
  `payload?.grants` 가 undefined → **쿠폰 장이 복구되지 않는다.** 창이 실재하는지 리뷰가 판정한다.
Task 4: task review = Needs fixes. Important 3건 + ⚠️ 4건(컨트롤러가 해소). Minor 4건.
Task 4: controller check — 커밋 트레일러 존재 확인(리뷰어 ⚠️ 해소).

Task 4: 🔴 Ruling: ⚠️ 「비회원 경로」는 **진짜 스펙 위반이다** — 고친다.
  스펙 §7(design.md:282)은 「`customer_id` 없는 주문 | 한도 상품이면 **차단** | 판정 불가 = fail-closed」라고
  적었는데, 헬퍼(`consume-purchase-limits.ts:28-29`)는 조기 반환으로 **통과**시킨다. 주석은 「훅 앞쪽이 이미
  거절했다(Task 5)」고 하지만 Task 5 는 «담기» 훅이고 이건 «주문 직전»이다 — Task 5 배포 전에 담긴 카트나
  API 직접 호출은 이 마지막 방어선을 그냥 지난다. 리뷰어가 판정 비대칭도 지적했다(게스트에게 NOT_SYNCED 는
  걸리는데 EXCEEDED 는 안 걸린다).
  처방: 비회원이면 «한도가 걸린 라인이 하나라도 있는지» 보고, 있으면 `PURCHASE_LIMIT_LOGIN_REQUIRED` 로 거절한다
  (Task 5 가 쓸 토큰과 같은 어휘). 한도 없는 상품만 담았으면 지금처럼 빈 결과로 통과.
  비용: 틀리면 한 라운드. 안 고치면 스펙이 「차단」이라 적어 둔 경로가 실제로는 통과다.

Task 4: Ruling: Important 1 (보상 payload 모양 폴백 없음) — **고친다.**
  리뷰어가 창의 실재를 코드로 좁혔다: 워크플로가 `store:true, retentionTime:THREE_DAYS` 라 스텝 출력이 3일
  영속되지만, 라우트가 transactionId 를 재사용하지 않고 async 스텝도 없어 invoke/compensate 가 갈리는 경로를
  «증명하지는 못했다»(엔진 revival 이 유일 후보). 확률은 낮다 — 그러나 비용이 1줄이고 실패가 조용하다.
  처방: `new StepResponse(undefined, { ...consumed, limits: consumedLimits })` 로 옛 키를 최상위에 남기고,
  읽는 쪽은 옛 모양을 관용한다. 비용: 틀리면 불필요한 3줄. 안 고치면 배포 창에서 쿠폰이 조용히 유실된다.

Task 4: Ruling: Important 2 (보상 훅의 두 복원이 직렬 — 첫째 실패가 둘째를 삼킨다) — **고친다.**
  invoke 경로는 try/catch 로 막아 놓고 보상 경로만 안 막은 «한쪽만 지킨 방어」다. 각각 개별 try/catch + 로깅.

Task 4: Ruling: Important 3 (plan-mandated — 판정 로직이 테스트가 못 닿는 파일에 있다) — **고친다.**
  `buildLimitLines(cartItems, enforced)` 를 헬퍼로 추출해 기존 유닛 스펙이 덮게 한다. 계획 자신이 Task 7 에서
  #833 을 인용하며 「테스트가 못 보는 로직」을 막겠다고 했는데, 가장 안전critical 한 판정(NOT_SYNCED = fail-closed)이
  정확히 그 상태다. 브리프가 지정한 배치이므로 plan-mandated 지만 그래도 고친다.

Task 4: minor (deferred): `cartItems` 선언에 `product.id` 누락 → 사용처 캐스트 2회
Task 4: minor (deferred): `filter(qty>0)` 이 「합계 0」을 조용히 버림 — items.quantity 가 안 오면 전면 미집행. **T7 가드는 두 필드 문자열을 «모두» 단언해야 한다**
Task 4: minor (deferred): 스펙 서비스 대역이 `as any` — 컴파일 결합은 헬퍼의 `Pick<>` 이 대신 든다
Task 4: minor (deferred): 미커버 분기 둘(releaseClaims 던질 때 토큰 유지 / restore non-empty 경로)

Task 4: 🔑 개통 선행조건 추가 — 리뷰어 확인: `listStuckClaims` 의 호출자가 레포에 **0곳**이다(T7 이 만든다).
  헬퍼가 해제 실패를 삼키는데(`consume-purchase-limits.ts:47-50`) 그걸 회수할 스위퍼가 아직 없으므로,
  **플래그 ON 전에 T7 의 스위퍼가 배포돼 있어야 그 삼킴이 정당해진다.** 최종 보고의 개통 절차에 실을 것.
Task 4: fix round 1 구현 완료 (commit 0e6ab79b2) — hooks 5 suites/46 tests(35→46, +11) 주장
Task 4: controller check — [1] LOGIN_REQUIRED 존재 / [4] buildLimitLines 추출됨, complete-cart:342 가 호출. 직접 확인.
Task 4: fix round 1 re-review dispatched (model sonnet, diff review-a21e8de17..0e6ab79b2.diff)
  — 재리뷰 핵심 둘: [1] 이 «한도 걸린 라인이 있을 때만» 거절하는가(과잉 차단 아닌가) / [4] 추출이 진짜 테스트에 닿는가
Task 4: fix round 1/5 (4 addressed, 0 open; commits a21e8de17..0e6ab79b2)
Task 4: complete (commits 6c2346a69..0e6ab79b2, review clean)

Task 5: Ruling (사전, preflight 발견 1 재확인) — `const reject = (...): never =>` 형태는 TS 제어흐름 분석이
  never-returning 으로 «인정하지 않을 수 있다»(변수 자체에 타입 주석이 필요). 그러면 `if (!ctx.customer_id) reject(...)`
  뒤에서 `ctx.customer_id` 가 `string | null` 로 남아 타입 에러다. 변수에 주석하거나 호출부를 throw 로 바꾼다.
Task 5: Ruling (사전) — Task 4 가 `buildLimitLines(cartItems, enforced)` 를 이미 만들었다. T5 는 입력 모양이 다르다
  (워크플로 input.items + variants vs query.graph 의 cartItems). **강제로 공유시키지 않는다** — 구현자가 실제로
  모양이 맞으면 재사용하고, 아니면 왜 분리했는지 주석으로 남긴다. 맹목적 중복과 강제 추상화를 둘 다 피한다.
Task 5: Ruling (사전) — 토큰 어휘는 Task 4 가 이미 고정했다: `PURCHASE_LIMIT_EXCEEDED` ·
  `PURCHASE_LIMIT_NOT_SYNCED` · `PURCHASE_LIMIT_LOGIN_REQUIRED` · (+T5 신규 `PURCHASE_LIMIT_MIN_QUANTITY`),
  payload `{"product_id":…,"purchase_limit_remaining":N}`. T11 파서가 정확 일치로 읽으므로 어긋나면 clamp 가 조용히 안 먹는다.
Task 5: dispatched (model sonnet, BASE 0e6ab79b2, 판정 A~F 전달)
Task 5: implementer DONE (commit 03af2fa7e) — hooks 6 suites/53 tests 주장, 유닛 7건 TDD
Task 5: 구현자 자체 발견 — 브리프의 최소수량 검사가 `quantity === 0`(라인 «삭제»)까지 막는 버그였다고 주장.
  보정했다고 함. 리뷰가 판정한다. (제 계획의 7번째 결함 후보)
Task 5: controller check — 훅 등록 4건으로 변화 없음 / 토큰 4종 일치 / T7 가드가 볼 호출 리터럴 3곳 존재. 직접 확인.
Task 5: task review dispatched (model opus). named risk: `getRemaining` 이 한도 라인마다 1회 — 담기 뜨거운 경로에서
  N+1 이 되는가(Medusa 는 이미 CPU 포화 #835). 배치 조회가 필요한 수준인지 판정 요청.
Task 5: task review = Needs fixes. Important 2건(둘 다 plan-mandated) + Minor 3건. named risk(getRemaining N+1)는 «배치 불필요» 판정.

Task 5: 🔴 Ruling: Important 1 (두 훅이 «요청 델타»만 보고 «카트 결과 수량»을 안 본다) — **고친다. 두 겹으로.**
  설계 §3.4 는 「카트 안 수량만 보면 되므로」라고 적었는데 구현은 「요청 안 수량」이다. 스펙이 구속력 있는 권위다.
  리뷰어가 전수 grep 으로 확인: min/max 를 검사하는 곳이 **이 두 훅뿐**이고 complete-cart 는 lifetimeLimit 만 본다.
  그래서 양방향으로 틀린다 — (오거절) min=2 상품이 카트에 2개 있는데 1개 더 담으면 `1 < 2` 로 거절, 결과 수량 3은
  조건을 만족하는데도 막힌다. (우회) max=5 를 3개+3개로 나눠 담으면 각각 통과하고 카트엔 6이 남아 그대로 결제된다.
  처방 (a): 담기 훅이 기존 카트 라인을 «합산»한다 — 같은 파일 `validateWelcomeMembership`(:172-196)이
    `cartModule.retrieveCart(…,{relations:['items']})` 로 이미 그 패턴을 갖고 있다. 그대로 쓴다.
  처방 (b): complete-cart 에도 min/max 집행을 «추가»한다 — `buildLimitLines` 가 이미 카트 전체를 상품별로
    합산하므로 min/max 를 함께 실어 거절하면 몇 줄이다. 이게 없으면 주문당 한도만 유일하게 fail-closed 가 아니다.
  비용: (a) 없이 플래그를 켜면 min 설정 상품에서 «정상 구매가 막힌다». (b) 없이는 우회가 영구히 남는다.

Task 5: Ruling: Important 2 (`quantity === 0` 카브아웃이 무테스트 면적에 있다) — **고친다.**
  구현자가 방금 발견해 고친 「삭제가 막히는 버그」를 되돌려도 게이트가 전부 초록이다(그 훅 파일은 스펙 0건).
  처방: 규칙을 순수 함수 안으로 옮긴다 — `assertWithinPurchaseLimits` 가 `qty === 0` 라인을 최소수량 검사에서
  제외하고, 스펙으로 고정한다. 그러면 두 훅이 같은 규칙을 상속한다.

Task 5: minor (deferred): MIN 토큰의 `purchase_limit_remaining` 이 «잔여»가 아니라 «최소»를 싣는다 — **T11 이 이 값을
  일괄 clamp 상한으로 쓰면 정반대로 수량을 내린다.** T11 디스패치에 포인터 실을 것
Task 5: minor (deferred): `synced` 검사가 min/max 뒤에 와서, 미동기화 상품에 옛 min/max 가 남아 있으면 두 표면의 토큰이 갈린다(둘 다 거절이라 fail-closed 는 유지)
Task 5: minor (deferred): 한도 없는 카트에도 `resolveCartCustomerId` 가 `retrieveCart` 를 1회 부른다 — `lifetimeLimit !== null` 가드로 0회 가능
Task 5: T7 이월 — 문자열 가드가 정의줄(`const validatePurchaseLimits = async (`)과 호출줄을 구별하는 건 «우연»이다(공백 때문). T7 은 호출 형태를 특정할 것
Task 5: fix round 1/5 dispatched (원 구현자 재개, FIX_BASE 03af2fa7e, Important 2건 — (a)담기 훅 카트 합산 + (b)complete-cart 에 min/max 집행 추가)
Task 5: fix round 1 구현 완료 (commit 26279a10d) — hooks 6 suites/63 tests(53→63, +10) 주장.
  (a) `mergeCartQuantityLines` 순수 함수 추출 + 스펙 5건 / (b) `buildLimitLines` 에 min/max 최종 방어선 + 스펙 5건 /
  [2] qty===0 규칙을 `assertWithinPurchaseLimits` 안으로 이동 + 회귀 1건.
  구현자 판단: (b) 가 Task 4 파일을 건드리지만 「검사 두 줄」이라 별도 태스크로 떼지 않음.
Task 5: fix round 1 re-review dispatched (model sonnet, diff review-03af2fa7e..26279a10d.diff)
Task 5: fix round 1/5 (2 addressed, 0 open; commits 03af2fa7e..26279a10d)
  재리뷰가 Medusa core-flows 소스로 검증: `addToCartWorkflow` 의 `item.quantity` 는 기존 라인에 `MathBN.sum` 되는
  «델타»이고, `CreateCartWorkflowInputDTO` 에는 `cart_id` 필드가 없어 createCart 경로는 그대로다. 합산 로직이
  실제 워크플로 시맨틱과 일치함을 확인.
Task 5: minor (deferred): 담기 훅에서 구매제한과 웰컴딜이 같은 `input.cart_id` 를 «각자» retrieveCart 한다 —
  플래그 ON + 웰컴 태그 섞인 addToCart 에서 카트 이중 조회(이 회차가 만든 신규 중복). 구현자 자진 공개
Task 5: complete (commits 0e6ab79b2..26279a10d, review clean)
Task 6: dispatched (model haiku — 브리프에 코드 전량, 파일 2개, 선례 coupon-grant-restore.ts 가 그대로 본. BASE 26279a10d)
Task 6: implementer DONE (commit c849e9f05) — 유닛 3/3 주장
Task 6: controller check — diff 가 구독자 파일 2개만 건드림(훅 미접촉) / `event: 'order.canceled'` 단일(반품 미포함, 설계 결정 4 준수). 직접 확인.
Task 6: task review dispatched (model sonnet, diff review-26279a10d..c849e9f05.diff)
Task 6: task review = Needs fixes. 코드는 정확(컨테이너 키·releaseByCart 시그니처·선례 일치 전부 실측 확인).
  Important 2건은 «테스트 엄밀성» 이고 둘 다 plan-mandated — 내 브리프 Step 1 스펙이 선례보다 약했다.

Task 6: Ruling: Important 1 (테스트 3이 복구 로그가 «실제로 찍히는지» 안 본다) — **고친다.**
  `.resolves.toBeUndefined()` 만 단언해서 catch 블록을 통째로 비워도(`catch(e){}`) 똑같이 통과한다.
  즉 「취소를 막지 않는다」는 증명하지만 [D] 의 뒷절반 「사람이 고칠 단서를 남긴다」는 증명하지 않는다.
  선례 `coupon-grant-restore.unit.spec.ts:59-63` 은 `expect(logger.error).toHaveBeenCalledWith(
  expect.stringContaining('cart_2'))` 를 «함께» 단언한다. 같은 수준으로 올린다.

Task 6: Ruling: Important 2 (테스트 1이 `query.graph` 인자를 안 본다) — **고친다.**
  목의 `graph` 가 입력을 무시하고 고정값을 반환해서, 필터 키가 `order_id` → `id` 로 바뀌어도 전 테스트가 초록이다.
  그러면 «모든 취소 주문에서 한도가 영구히 안 풀린다» — calibration 이 Minor 에서 명시적으로 제외한 부류다.
  선례는 `{entity:'order_cart', fields:[...], filters:{order_id:'order_1'}}` 를 단언한다. 같게.

Task 6: minor (deferred): `config.context.subscriberId` 미설정 — 저장소의 다른 구독자 6개는 «전부» 설정한다(유일한 예외).
  리뷰어가 로더 폴백(`kebabCase(handler.name)` → `handle-purchase-limit-restore`)이 충돌 없이 동작함을 확인.
  기능 결함은 아니나 깨지지 않은 관행의 유일한 이탈 — 최종 리뷰가 분류
Task 6: minor (deferred): `data?.id` 누락 가드·`config.event` 값 자체에 대한 테스트 없음(선례엔 있음)
Task 6: fix round 1/5 dispatched (원 구현자 재개, FIX_BASE c849e9f05, 테스트 단언 2건 — 구현 코드 미접촉)

## 🔑 라이브 실측 (2026-09-12, 읽기 전용, sst shell --stage live)

- `product_purchase_constraints` 총 **141행**
- **`lifetime_quantity_limit` 설정된 행: 0** ← #470 의 본체는 «완전 휴면»이다
- `requires_membership = true`: **141행** (= 141행 전부가 멤버십전용 용도. 이건 이미 집행된다)
- active 상품 버전 **11,366개 전부가 `min_quantity=1, max_quantity=null`** — 스키마 기본값.
  `max < 100` 0건, `min > 1` 0건. **주문당 한도도 실질 설정이 단 한 건도 없다.**

**판정: 지금 새고 있는 돈은 0원이다.** 스펙 §8 ⑤ 의 분기가 「0 = 휴면」으로 확정됐다.

이 사실이 바꾸는 것:
1. **개통 위험이 크게 낮아졌다** — 「항상 기록 + 소급 적용」 결정의 유일한 실무 위험이 「정책을 붙이는 순간
   이미 초과한 고객이 예고 없이 차단된다」였는데, 한도가 0건이라 소급으로 차단될 고객이 **0명**이다.
   지금이 켜기 가장 안전한 시점이다.
2. **개통이 곧 동작 확인이 아니다** — 플래그를 켜도 한도가 0건이라 아무 일도 안 일어난다.
   MD 가 첫 한도를 설정해야 비로소 동작한다. **스모크는 「한도를 하나 걸고 실제로 막히는지」여야 한다.**
3. **T8·T9(min/max 배관)는 지금 아무 값도 안 나른다** — 배관은 여전히 필요하지만(나중에 설정되면 흘러야 하니)
   「11,366건이 새고 있다」가 아니다. 우선순위 근거로 쓰지 말 것.
4. #470 의 우선순위 라벨(`priority:p2`)은 실측 기준으로 **유지 또는 하향**이 맞다. 이슈 본문의 첫 체크박스
   (「라이브 core DB 에 한도가 설정된 행이 있는지 — 이 수가 우선순위를 정한다」)의 답이 **0** 이다.
Task 6: fix round 1 구현 완료 (commit 187987505, 테스트 전용) — bug-injection 확인 주장(필터키 변경→T1 RED, 로깅 제거→T3 RED)
Task 6: fix round 1 re-review dispatched (model sonnet, diff review-c849e9f05..187987505.diff)
Task 6: fix round 1/5 (2 addressed, 0 open; commits c849e9f05..187987505, 테스트 전용 diff — 구현 미접촉 확인)
Task 6: complete (commits 26279a10d..187987505, review clean)

Task 7: Ruling (사전) — 가드가 단언해야 할 «배선 목록»이 계획 작성 이후 늘었다. 계획 본문의 5건에 더해:
  (a) `buildLimitLines(` 호출(T4 fix 로 추출됨) (b) `assertWithinPurchaseLimits(` 가 «두» 훅 파일 모두에 있을 것
  (T5 가 담기·수량변경 양쪽에 배선) (c) `query.graph` 필드가 `items.quantity` 와 `items.variant.product.id`
  **둘 다**일 것 (T4 Minor 이월 — 하나만 빠져도 전 라인이 조용히 건너뛰어진다)
Task 7: Ruling (사전) — 문자열 가드가 «정의줄»과 «호출줄»을 구별하는 건 지금 «우연»이다
  (`const validatePurchaseLimits = async (` 에는 `= async` 사이 공백 때문에 `validatePurchaseLimits(` 가 없다).
  T5 리뷰가 지적했다. 가드는 그 우연에 기대지 말고 호출 형태를 특정할 것(예: `await <name>(`).
Task 7: Ruling (사전) — T2 Minor 이월: 동시 `releaseClaims` 배치 둘이 카운터 행 잠금 순서로 교착 가능.
  스위퍼가 두 곳에서 동시에 돌 때만이므로, 스크립트 주석에 「두 개를 동시에 돌리지 말 것」을 명시한다(코드 강제는 범위 밖).
Task 7: dispatched (model sonnet, BASE 187987505, 판정 A~E — 가드 목록 확장·호출형태 특정·스위퍼 동시실행 경고)
Task 7: implementer DONE (commit 8444a7162) — 가드 8/8, hooks 전체 71/71 주장. bug-injection 7회로 판별력 확인 주장
  (특히 주석 처리된 죽은 블록에 같은 리터럴이 남아 있어도 «활성» 필드만 지우면 가드가 빨개지는 것까지).
Task 7: controller check — 훅 등록 4건 변화 없음 / `listStuckClaims` 호출자가 생겼다(scripts/restore-stuck-purchase-limits.ts:51).
  소모 헬퍼 주석 「스위퍼가 받는다」가 이제 현재시제다.
Task 7: task review dispatched (model sonnet, diff review-187987505..8444a7162.diff)
Task 7: task review = Needs fixes. Important 1건 + Minor 6건. 스위퍼 자체는 «정확»(선례 추종, dry-run 부작용 0,
  [D] 판정 순서 맞음, order_cart 배치 조회의 페이지네이션 위험까지 리뷰어가 소스로 확인 — 없음).

Task 7: 🔴 Ruling: Important 1 (가드가 수량변경 훅의 «디스패처»를 안 본다) — **고친다.**
  `check-welcome-membership-quantity.ts` 는 훅 본문(:50)이 `checkPurchaseLimit(...)` 를 부르고, 그 함수(:75-90)가
  `assertWithinPurchaseLimits(` 를 부른다. 가드는 **후자만** 파일 전체에서 찾는다. 그래서 :50 의 디스패처 호출을
  주석 처리하면 **집행이 완전히 죽는데 가드 8건이 전부 초록이다** — `assertWithinPurchaseLimits(` 리터럴이
  도달 불가 상태로 파일에 남아 있기 때문. **이게 정확히 #833 의 모양**이다(디스패처가 끊겼는데 callee 본문이
  남아 렉시컬하게 매치).
  대조: 담기 훅은 «두» 단언(디스패처 `validatePurchaseLimits(` + 내부 `assertWithinPurchaseLimits(`)으로 맞게 했다.
  수량변경 훅에만 그 2단 검사가 빠졌다. 처방: `checkPurchaseLimit(` 디스패처 단언 추가.
  리뷰어 확인: 레포 어디에도 `checkPurchaseLimit` 도달성을 덮는 테스트가 없고, `no-duplicate-validate-hooks` 는
  «중복»만 보지 «누락»은 못 본다.
  비용: 안 고치면 이 태스크가 막겠다고 선언한 바로 그 회귀가 그대로 통과한다.

Task 7: minor (deferred): `stripComments` 가 `/* */` 블록 주석·행말 주석을 못 걷는다. 지금은 죽은 블록이 전부
  단일행 `//` 라 안전하지만 «가드가 의존하는 강제되지 않은 전제»다
Task 7: minor (deferred): 「두 필드」 검사가 파일 전체 substring 이라 특정 `query.graph` 호출에 스코프되지 않았다.
  `complete-cart.ts` 에 `query.graph` 가 이미 6곳(61·124·141·171·221·232)이고 늘어나는 추세
Task 7: 🟡 minor (deferred, 돈 방향 주의): 스위퍼 자체에 유닛 스펙이 없다. 선례
  `restore-stuck-coupon-consumptions.unit.spec.ts` 는 [D] 불변식을 목 컨테이너로 싸게 단언한다.
  `!withOrder.has` 가 뒤집히면 «주문이 실제로 생긴» claim 을 되돌려 고객이 한도를 초과해 살 수 있게 되는데
  그걸 잡을 게 아무것도 없다. 현재 로직은 정확(리뷰 확인). **최종 whole-branch 리뷰가 우선 분류할 것**
Task 7: minor (deferred): CLI 위치인자에 `Number.isFinite` 검증 없음 — 오타가 `Invalid Date` 컷오프를 만든다
Task 7: minor (deferred): dry-run 이 「스캔 상한 도달」 경고 전에 반환해 truncation 을 운영자에게 안 알린다
Task 7: fix round 1/5 dispatched (원 구현자 재개, FIX_BASE 8444a7162, Important 1건 — 가드에 디스패처 단언 추가. 스위퍼 미접촉)
Task 7: fix round 1 구현 완료 (commit f88a3c311, 가드 스펙 전용 8→9건) — bug-injection 이 리뷰어 예측과 일치
  (`:50` 주석 처리 시 «새» 단언만 RED, 나머지 8건 GREEN)
Task 7: fix round 1 re-review dispatched (model sonnet, diff review-8444a7162..f88a3c311.diff)

Task 8: Ruling (사전) — 🔴 `apps/core` 는 medusa 와 «달리» 루트 게이트 안이다(tsconfig exclude 에 없고 jest
  ignore 에도 없다. 내가 확인). 그러니 T8·T9·T10 에서는 `npm run type-check` 와 루트 `npx jest` 가 «유효한» 증거다.
  medusa 태스크들에 적용한 「무효한 증거」 경고를 여기 그대로 쓰면 안 된다.
Task 8: Ruling (사전) — 필드 이름은 T9·Medusa 파서와 짝이다(`minQuantityPerOrder`/`maxQuantityPerOrder` →
  `pimMinQuantityPerOrder`/`pimMaxQuantityPerOrder`). 오타는 런타임에 조용한 `undefined` 가 된다.
  구현자에게 파서 파일을 열어 «눈으로 대조»하고 그 결과를 리포트에 적으라고 지시.
Task 8: Ruling (사전) — 라이브 실측(min/max 실질 설정 0건)을 디스패치에 실었다. 「11,366건이 새고 있다」로
  오해하고 과잉 설계하지 않도록. 만드는 이유는 (1) 나중에 설정되면 흘러야 하고 (2) `synced` 3상태가
  fail-closed 의 전제이기 때문이다.
Task 8: dispatched (model sonnet, BASE f88a3c311, 판정 A~F)
Task 7: fix round 1/5 (1 addressed, 0 open; commits 8444a7162..f88a3c311)
  재리뷰가 «독립 재현»했다 — 구현자의 정규식과 파일을 노드에 직접 로드해 돌린 결과 `calledAs` 가 정의줄(`async
  function checkPurchaseLimit(`)과 호출줄(`await checkPurchaseLimit(`)을 정확히 구별하고, 디스패처 리터럴을 지운
  뮤턴트에서 «새» 단언만 RED 로 뒤집히는 것을 확인. 리포트의 bug-injection 결과와 일치.
Task 7: complete (commits 187987505..f88a3c311, review clean)
Task 7: 🔑 Medusa 쪽 전부 종료 (T1~T7). 남은 다섯은 core·channel-adapter·storefront·admin-web.
Task 8: implementer DONE (commit bbe85c3ed) — type-check 0, apps/core/catalog 960 passed, event-contracts 109,
  channel-adapter transformer/snapshot-builder 24 주장.
Task 8: 🔑 구현자가 브리프 밖에서 발견 — 스냅샷 타입이 `catalog.types.ts` 가 «아니라»
  `packages/event-contracts/streams/product.stream.ts` 의 `ProductSnapshot`/`ProductSnapshotSchema` 이고,
  **outbox publish 가 그 zod 스키마로 파싱하며 선언되지 않은 키를 «조용히 버린다»**. 인터페이스만 고치고 스키마를
  안 고쳤으면 이 태스크가 고치려는 바로 그 「조용한 유실」을 재현했을 것. 내 계획은 「catalog.types.ts 또는
  어셈블러 반환 타입」이라고 헤지했는데 «제3의 장소»였다.
Task 8: 구현자 우려 — 새 두 필드를 `.optional()` 로 뒀다(required 로 하니 무관한 기존 event-contracts 픽스처
  2건이 깨져서). 스키마가 «부재»를 허용하므로 「항상 싣는다」가 스키마 층에서 강제되지 않는다. 리뷰가 판정한다.
  (소비자 쪽 부재 = `synced:false` = 차단이라 «안전한 방향»의 실패이긴 하다.)
Task 8: task review dispatched (model opus). named risk: **배포 스큐** — 공유 계약이고 읽는 쪽이 여럿이다.
  core(신규)가 새 필드를 싣는데 channel-adapter(구버전)가 옛 스키마로 파싱하면 strip 해서 transformer 가 못 본다.
  그 경로가 실재하는지(인바운드를 zod 로 파싱하는가) 판정 요청. 실재하면 개통 절차에 배포 순서가 붙는다.
Task 8: task review = Spec ✅ / **Approved**. Critical 0, Important 1건(«이 diff 밖» 이월), Minor 4건.
  리뷰어가 구현자의 핵심 발견을 독립 검증했고 «보고보다 한 단계 더 이르다»고 판정 — `buildEventEnvelope` 가
  `payload = validatedPayload` 로 덮어써 **아웃박스 적재 시점에 이미** 미선언 키가 사라진다
  (`stream-publisher.service.ts:217-221` → `schema-validation.util.ts:63-71`, `validateOnPublish` 기본 true).
Task 8: `.optional()` 판정 = **수용**, 단 리뷰어가 더 강한 근거를 댔다 — 구현자의 「픽스처 2건이 깨져서」는 약하고,
  진짜 근거는 소비 측이다: `validateOnConsume`+`throwOnValidationError` 기본 true 라 required 로 만들면
  **배포 전에 발행돼 아직 떠 있는 옛 메시지가 소비 검증에서 throw → DLQ** 한다. 한 SST 스택이라 배포 순서로도 못 피한다.
Task 8: named risk «배포 스큐» = **실재하지 않는다**(리뷰어 코드 확인). 소비 측 `SchemaValidationInterceptor` 는
  `validateSchemaOrThrow` 를 문으로 부르고 **반환값을 버린다**(strip 안 함), channel-adapter 인바운드에 zod parse 0건.
  → 개통 절차에 배포 순서 불필요.
Task 8: complete (commits f88a3c311..bbe85c3ed, review clean — Important 는 out-of-diff 이월)

Task 8→9: 🔴 Ruling: 이월 Important 를 **Task 9 범위에 넣는다.**
  (1) `apps/channel-adapter/scripts/lib/pim-snapshot-builder.ts:377-385` 가 «두 번째 프로듀서» 이고 아직 옛 분기다
      (제약 없으면 `purchaseConstraint: undefined`). `backfill-v2.ts:188` 과 legacy 스크립트가 쓴다.
      **배포 후 백필을 한 번 돌리면 그 상품들의 `synced` 가 다시 false 로 되돌아간다.**
  (2) 스냅샷은 `ProductMasterActiveVersionChanged` 때만 재발행되므로 **이 배포만으로는 active 11,366개 중
      어느 것도 `synced:true` 가 되지 않는다.** 대량 경로는 Task 10 이 만든다.
  비용: 안 고치면 개통일에 백필 한 번으로 전 카탈로그가 `NOT_SYNCED` 로 막힌다.

Task 8→10: 🔴 Ruling: **내 계획의 Task 10 전제가 틀렸다.** 계획은 「core 의 `productPublisher.publishEvent()` 를
  활성 마스터 전체에 돈다」고 적었는데, 그 메서드(`product-masters.service.ts:165`)는 **variant 생성 이벤트**다.
  스냅샷의 진짜 발행 경로는 `product-versions.service.ts` 의 `_emitActiveVersionChangedEvent(...)` 이고
  그게 어셈블러를 부른다(`:1154`). **private 메서드라 스크립트가 직접 못 부른다** — Task 10 이 그 진입점을
  어떻게 만들지 정해야 하고, **상품 데이터를 바꾸지 않는 순수 재발행**이어야 한다(재활성화 같은 부작용 금지).
Task 8: minor (deferred): zod strip 가드가 «기본 픽스처에 min/max 가 들어 있는 덕분»에 우연히 성립 —
  누가 픽스처에서 빼면 가드가 조용히 사라진다. 신규 describe 에 명시적 `schema.parse()` 1건이면 의도가 코드에 남는다
Task 8: minor (deferred): 자기리뷰의 blast-radius 주장이 사실과 다름(`apps/search/src/product-events.consumer.ts` 도 import). 실제 영향은 없음
Task 8: minor (deferred): zod `.positive()` 가 DB CHECK 보다 엄격 — `min_quantity=0` 행이 생기면 게시가 throw(안전 방향이나 관행으로만 유지)
Task 8: minor (deferred): 새 테스트 4건에 `{} as any`(이웃 관행 추종)
Task 9: dispatched (model sonnet, BASE bbe85c3ed, 범위 확대 — 갈래1 transformer + 갈래2 두 번째 프로듀서 정렬)
Task 9: implementer DONE (commit 38af6abd5) — channel-adapter 385 passed, type-check 0, **루트 전체 jest 5229 passed** 주장
Task 9: controller check — 갈래1 transformer 에 두 필드 존재(:99-100) / 갈래2 빌더의 옛 `undefined` 분기 사라지고
  어셈블러와 같은 모양 + 「왜」 주석. 직접 확인.
Task 9: 구현자 우려 — [D](두 프로듀서 정합 «자동» 가드)는 MSA 앱 경계상 미시도, 리터럴 드리프트는 사람 리뷰 의존.
Task 9: task review dispatched (model opus) — 핵심 둘: 갈래2 회귀 가드가 진짜 작동하는가 /
  두 프로듀서가 «필드별로» 정말 같은 모양인가(빌더는 raw SQL 이라 `Number()` 변환이 있고 어셈블러는 drizzle 타입)
Task 9: task review = Needs fixes. Important 2건 + Minor 4건. 갈래1·2·[B]·[C] 는 정확히 구현됐고,
  **두 프로듀서의 값 동형성을 리뷰어가 필드별로 대조해 «실제로 같다»고 확인**(int4 는 postgres.js 가 number 로 주므로
  `Number()` 가 no-op, drizzle 도 `number|null` — 변환 결과 동일). 갈래2 회귀 가드도 «진짜»다(되돌리면 빨개진다).

Task 9: Ruling: Important 1 ([D] 를 「불가능」이라 적은 근거가 틀렸다) — **고친다.**
  보고서는 「core 소스 import 가 tsconfig/jest 경계상 해석 안 될 것」이라 적었는데, 가드에 필요한 건 core 소스가
  아니라 **공유 계약**이고 channel-adapter 는 `@packages/event-contracts` 를 이미 **39개 파일**에서 import 한다
  (그중 하나가 이 데이터의 입구인 `consumers/pim-product-event.consumer.ts:12`). 경계 문제는 없다.
  그리고 이 드리프트는 정말 무방비다 — 계약 타입과 로컬 복제본(`src/types.ts` 의 `PimProductSnapshot`)이 코드
  경로에서 **한 번도 서로 대입되지 않고**(inbox JSON 을 거치며 타입 소실), 두 필드가 optional 이라 구조적 호환성으로도
  안 걸린다. 계약에서 이름이 바뀌면 **양쪽 다 컴파일되고 metadata 만 조용히 null 이 된다.**
  처방 (a): 5줄짜리 컴파일타임 단언(`Pick<ProductSnapshot,…> ≡ Pick<PimProductSnapshot,…>`).
  처방 (b): transformer 출력 키 ↔ medusa 파서는 «다른 트리»라 타입으로 못 묶는다 — 소스 리터럴 가드 스펙
  (Task 7 가드와 같은 방식으로 파일을 읽어 문자열 존재를 단언). 리뷰어가 「이 방법 말고 없다」고 판정.
  비용: 안 하면 계약 이름 변경이 조용한 null 로 끝나고 플래그 ON 시 전 카탈로그가 차단된다.

Task 9: 🔴 Ruling: Important 2 (`retry-failed.ts:144` 가 «저장된 옛 모양» 스냅샷을 재생한다) — **고친다.**
  `migration_failures.snapshot`(jsonb) 을 `as unknown as PimProductSnapshot` 로 캐스팅해 그대로 동기화하는데,
  그 행들은 이번 변경 «이전»에 적재된 옛 모양이라 `purchaseConstraint` 가 아예 없다 →
  transformer 가 `pimPurchaseConstraint: null` → 파서 `synced:false` → 플래그 ON 시 차단.
  **갈래 2 로 막으라고 한 실패 모드와 글자 그대로 같고 같은 `scripts/` 계열이다.** 보고서가 이 경로를 언급 안 했다.
  처방: 재생 직전 정규화(`purchaseConstraint ??= {requiresMembership:false, lifetimeQuantityLimit:null}`)
  또는 저장본 대신 `PimSnapshotBuilder` 로 재조회.

Task 9: minor (deferred): 빌더 min/max 테스트가 «SQL 변경»을 증명 못 한다 — 가짜 DB 가 SELECT 목록을 파싱하지 않아
  SELECT 에서 두 컬럼을 지워도 초록. tsc 도 SQL↔`MasterRow` 를 안 본다(`this.pimDb<MasterRow[]>` 단언). 사람 눈이 유일한 가드
Task 9: minor (deferred): **네 번째(휴면) 프로듀서** `adapters/medusa/pim.client.ts:152` 가 옛 모양. 런타임 배선은
  주석 처리됐고 `scripts/legacy/*` 만 쓴다(CLAUDE.md: v1 잔재는 사용 중지). 삭제가 정답으로 보이나 범위 밖
Task 9: minor (deferred): 빌더의 `Number(undefined)→NaN` 경로(`!== null` 을 `== null` 로 바꾸면 어셈블러와 완전 동일)
Task 9: 🟡 minor (deferred, 하류 주의): 이 배관이 이제 전 상품에 `pimMinQuantityPerOrder: 1` 을 싣는다(라이브 11,366 전부 min=1).
  파서 `positiveInt` 가 1 을 유효값으로 인정하므로 `minPerOrder` 가 거의 항상 non-null. 하류에서 「non-null = 한도 있음」으로
  읽는 표시 로직이 생기면 전 상품에 「최소 1개」가 붙는다. **T11(storefront) 디스패치에 포인터 실을 것**
Task 9: fix round 1/5 dispatched (원 구현자 재개, FIX_BASE 38af6abd5, Important 2건 — 드리프트 가드 2종 + retry-failed 정규화)
Task 9: fix round 1 구현 완료 (commit 9745644ac) — channel-adapter 396 passed, type-check 0, 루트 jest 5240 passed 주장.
  구현자가 **처음 만든 `toContain` 가드가 무효였음을 실측 중 스스로 발견해 고쳤다**(경계인식 정규식으로).
Task 9: fix round 1 re-review dispatched (model sonnet, diff review-38af6abd5..9745644ac.diff)

Task 10: dispatched (model sonnet, BASE 9745644ac). 브리프 전제가 틀렸음을 디스패치에 명시:
  `productPublisher.publishEvent`(product-masters.service.ts)는 **variant 생성 이벤트**이고 스냅샷과 무관하다.
  진짜 경로는 `product-versions.service.ts:1144` 의 private `_emitActiveVersionChangedEvent` 이고,
  「데이터를 안 바꾸고 스냅샷만 재발행」의 선례는 `categories.service.ts:965-1020` 이다(카테고리 변경 시 재발행).
  판정 A~F: 순수 재발행(데이터 변경 금지) / private 우회는 (a)어셈블러+퍼블리셔 직접 조합 또는 (b)전용 public 메서드 /
  zod 발행검증이 throw 하므로 실패를 모아 마지막에 목록 출력 / 규모 11,366 이라 dry-run·limit·delay 필수 /
  대상은 status='active' / Nest 컨텍스트는 이웃 스크립트 패턴.
  **「순수 재발행이 이 코드베이스에서 불가능하면 BLOCKED 로 보고하라 — 그게 가장 값진 정보다」를 명시.**
Task 9: fix round 1/5 (2 addressed, 0 open — 그러나 **fix diff 자체에 새 Important 1건**)
  재리뷰가 (1a) 단언이 `IfEquals` 기반의 «진짜» 양방향 동등성이고 `extends any` 류 눈속임이 아님을,
  (1b) 최종 정규식이 식별자 경계를 정확히 보아 접미사 리네임에서 매치 실패함을, (2) 정규화가 재생 직전
  실제 호출 지점에 꽂혔고 회귀 스펙이 옛 jsonb 모양을 정확히 재현함을 각각 코드로 확인.

Task 9: 🔴 Ruling: 새 Important (**존재하지 않는 가드를 있다고 주장하는 주석**) — **고친다.**
  `scripts/lib/normalize-legacy-snapshot.spec.ts:17-19` 가 「되돌리면 retry-failed.spec.ts 쪽 배선 가드가
  대신 잡는다」고 적었는데 **그 파일이 저장소에 없다**(내가 직접 확인: retry-failed 를 참조하는 스펙 0건).
  즉 누가 `retry-failed.ts:158` 의 정규화 호출을 지우고 원래 캐스트로 되돌려도 **아무 테스트도 안 빨개진다.**
  기능 결함은 아니지만 **이 리뷰 프로세스 전체가 다루는 병과 정확히 같은 종류**다 — 「가드가 있다는 주장」을
  검증 없이 믿는 것. 그리고 이 세션이 이미 세 번(T6·T7·T9) 같은 부류를 잡았다.
  처방: 배선 가드를 «실제로» 추가한다(이 fix 가 이미 쓴 소스 리터럴 가드 방식 그대로) + 주석을 사실에 맞게.
  비용: 안 하면 다음 사람이 없는 안전망을 믿고 그 호출을 지운다.
Task 9: fix round 2/5 dispatched (원 구현자 재개, FIX_BASE 9745644ac, 새 Important 1건 — 유령 가드 주석을 «진짜 가드»로)
Task 9: fix round 2 구현 완료 (commit 4fd44dd85) — 거짓 주석 정정 + 실제 배선 가드
  `scripts/retry-failed-normalization-wired.spec.ts` 신설(소스 리터럴, T7 계열). bug-injection 실측 주장.
  컨트롤러 확인: 그 파일이 실제로 존재하고 `normalizeLegacyPimSnapshot` 을 참조한다.
Task 9: fix round 2 re-review dispatched (model sonnet, diff review-9745644ac..4fd44dd85.diff)
  — 이번엔 특히 회의적으로 보라고 지시: 앞 라운드에서 이 구현자의 첫 `toContain` 가드가 «무효했던 전례»가 있다.
Task 9: fix round 2/5 (1 addressed, 0 open; commits 9745644ac..4fd44dd85)
  재리뷰 검증: 새 주석이 가리키는 파일이 «실재»하고 주장대로 동작함 / 가드가 vacuous 하지 않음
  (`=\s*name\(` 가 대입 연산자를 요구하므로 import 줄에 우연히 안 걸린다) / **루트 jest 가 이 스펙을 실제로
  주워 간다**는 것까지 확인(testRegex·roots·ignore 패턴 대조, 396→398 증가와 일치).
Task 9: out-of-scope minor (deferred): 새 가드의 `stripComments` 도 `/* */` 블록 주석 미처리(T7 과 같은 잠재 취약)
Task 9: complete (commits bbe85c3ed..4fd44dd85, review clean)

Task 10: implementer DONE (commit 3523fd1d9) — [B](a) 어셈블러+퍼블리셔 직접 조합, Nest 는 최소 ad-hoc 모듈
  (analytics-backfill 선례, CronOnceModule 등 타 BC 가 스크립트에서 도는 걸 회피). 유닛 11건(parseArgs),
  루트 type-check 0, 루트 jest 599/599 주장.
Task 10: 🔑 **실제 로컬 실행 증거** — dry-run 이 아웃박스 행 수 불변(아무것도 안 씀), `--limit=1` 발행 성공하고
  새 아웃박스 행에 `snapshot.minQuantityPerOrder`/`maxQuantityPerOrder` 존재, **`product_master_versions.updated_at`
  불변(순수 재발행 확인)**. 잘못된 인자는 DB/Kafka 접속 «전»에 실패.
  구현자 우려: 실행당 ~30초 Kafka bootstrap 고정비, 로컬 행이 1개뿐이라 대규모 실패 로그 가독성 미검증.
Task 10: task review dispatched (model opus) — 핵심 넷: [A] 순수 재발행이 «코드로도» 참인가(로컬 1건 관측은
  모든 경로를 못 덮는다) / payload 모양이 기존 발행과 같은가 / 11,366건에서 뭐가 터지는가(메모리·트랜잭션 경계·
  delay·중간 실패) / ad-hoc 모듈이 빠뜨린 의존이 없는가(조용히 다르게 동작할 수 있다)

Task 11: Ruling (사전) — 🔴 **storefront 는 jest 가 아니라 vitest 다**(`package.json` 의 `test: vitest run`).
  내 계획이 `npx jest` 라고 적었다. 이웃 테스트는 `src/lib/utils/cart-quantity.test.ts`(`.test.ts` 규약).
Task 11: Ruling (사전) — storefront 는 루트 게이트 «밖»(tsconfig exclude 에 `web`). `npm run type-check` 는
  증거가 아니다. 그 트리에서 `npx tsc --noEmit`.
Task 11: Ruling (사전) — 🔴 `PURCHASE_LIMIT_MIN_QUANTITY` 의 숫자는 «잔여»가 아니라 «최소»다(T5 리뷰 지적).
  clamp 상한으로 쓰면 수량을 내려 clamp 해서 정반대가 된다. 토큰별 의미 차이를 코드·주석에 명시하도록 지시.
Task 11: Ruling (사전) — `NOT_SYNCED` 는 내부 사정이므로 고객에게 흘리지 말 것. `attempted` 로 재요청 1회 제한.
Task 11: dispatched (model sonnet, BASE 3523fd1d9, 판정 A~G)
Task 10: task review = **Needs fixes. Critical 1건 + Important 2건 + Minor 3건.**
  [A]·[B]·[C]·[E] 는 «코드로» 확인됨 — 순수 재발행(어셈블러/로더에 insert·update·delete 0건, 의심스러웠던
  VariantPriceCacheService 도 순수 select), payload 가 선례와 «필드 단위» 일치, `forApp` 옵션이 CatalogModule 과
  «글자 단위» 동일(검증 정책 드리프트 없음), 대상 쿼리가 `getActiveVersion` 과 소프트삭제 필터까지 일치.

Task 10: 🔴🔴 Ruling: **Critical 1 (스크립트가 아웃박스 «디스패처»를 띄워 다른 BC 의 라이브 이벤트를 망가뜨린다)** — **고친다.**
  사슬: `enableOutbox:true` → `SCHEDULE_ROOT` + `OutboxDispatcher`(@Cron 5초) → `acquireEventBatch` 에
  **topic 필터가 없다**(PENDING 전부가 후보) → 이 컨테이너엔 `PRODUCT_STREAM` publisher 하나뿐 →
  다른 토픽은 `No publisher found for topic` → retryCount++ → **5회째 status='FAILED' 영구**.
  core 에 적재하는 BC 는 catalog 말고도 셋(fulfillment 4·inventory 2·sales-order 2 — 내가 직접 확인).
  즉 라이브에서 이 스크립트가 도는 동안 **재고·출고·주문 이벤트가 잡혀 지연되고 일부가 영구히 죽는다.**
  **`--dry-run` 도 예외가 아니다**(디스패처는 dry-run 플래그를 모른다).
  🔑 `libs/events/src/outbox/outbox-dispatcher.service.ts:64-72` 가 **이 사고를 이름까지 적어 뒀다**(Task 6-C-2).
  리포트의 「dry-run 이 아웃박스 행 수 불변」은 이 결함을 «구조적으로 못 잡는» 증거다 — 디스패처의 쓰기는 행 수가
  아니라 status/retry_count/next_attempt_at 컬럼이다.
  처방: `OUTBOX_DISPATCH_GATE`(seam 실재 확인) 로 이 프로세스의 발행을 전부 보류. 스크립트 의도(적재만 하고
  발행은 라이브 core 에 맡김)에 정확히 맞는다.
  비용: 안 고치면 개통 작업이 «다른 도메인»을 망가뜨린다. 이건 라이브 실행 «전»에 반드시 닫혀야 한다.

Task 10: Ruling: Important 2 (`origin` 부재) — **고친다.** `origin` 이 없으면 11,366건이 inbox 의 «정상 레인»으로
  들어가 MD 의 평범한 상품 게시가 전부 그 뒤에 줄 서고(후순위 레인은 `BULK_ORIGINS=['bulk_import']` 만 탄다),
  `pim-medusa-sync.service.ts:424-427` 이 **상품마다 storefront 를 무효화**한다(11,366회. 바로 위 주석이
  「대량등록은 상품마다 무효화하면 전역 목록 태그를 상품 수만큼 지운다」고 경고). Medusa CPU 포화(#835)와 겹친다.
  처방: `origin: 'bulk_import'` — 계약이 정의한 유일한 값이고 정본 발행도 싣는 자리다([B] 와 충돌하지 않는다).

Task 10: Ruling: Important 3 (완주 시간이 «~9.5분」이 아니라 «~31시간») — **고친다(문서·계획).**
  Medusa inbox worker 는 틱마다 한 건만 집고(maxConcurrentHandlers=1, handlerStartIntervalMs=10000)
  완료가 다음 클레임을 안 당긴다 → 상한 6건/분 → 11,366건 ≈ 31.6시간. `--delay` 는 아웃박스 «적재» 속도만
  조절할 뿐 그 병목을 제어하지 않는다. 스크립트 헤더와 리포트가 개통 담당자를 **두 자릿수 배로** 오도한다.
  ⚠️ 라이브가 `INBOX_MAX_CONCURRENT_HANDLERS` 등을 기본값과 다르게 주는지는 이 체크아웃에서 확인 불가 —
  **개통 계획은 그 값을 실측한 뒤 세워야 한다.**

Task 10: 🟡 Ruling (컨트롤러 재분류): Minor 4(재개·분할 불가)와 Minor 6(대상 DB 미에코·안전 기본값 부재)를
  **Important 로 올려 이번 라운드에 넣는다.** 리뷰어가 Minor 로 매긴 것은 Important 3(31시간)과 연결하기 «전»이다.
  31시간짜리 드레인에 `--offset` 이 없으면 한 번 끊길 때 처음부터이고, 이 저장소엔 `dev_core`/`core` 혼동 전례가 있는데
  인자 없이 부르면 곧바로 전량 발행이다. 스스로 본으로 든 `analytics-backfill` 은 정반대다(dry-run 기본·`--apply` 필수).
  비용: 재분류가 과했다면 몇 줄의 낭비. 안 하면 라이브 운영에서 되돌리기 어려운 실수가 난다.

Task 10: minor (deferred): 실패 목록에 사유 없이 id 만 — 사유별 카운트 한 줄이면 11k 줄 로그 되짚기를 면한다
Task 10: minor (deferred): `:161-162` 주석의 「라이브 11,366 이 «이 필터»의 결과」는 검증 불가(브리프 숫자는 필터 미명시)
Task 10: minor (deferred): `:27-29` 주석이 `enableOutbox` 가 데려오는 것을 「게이지 @Cron 하나」로 적었으나 실제로는 셋
  (디스패처 5초·게이지 15초·PUBLISHED 정리 DELETE 매일 02:00) — Critical 1 수정 시 같이 고쳐질 것
Task 10: fix round 1/5 dispatched (원 구현자 재개, FIX_BASE 3523fd1d9, Critical 1 + Important 2·3 + 재분류 4·5)

Task 11: implementer DONE_WITH_CONCERNS (commit 3c3491794) — vitest 32 files/293 passed(신규 16),
  storefront tsc 는 기존 베이스라인 53건 유지·자기 파일 0.
Task 11: 🔑 브리프 밖 발견 둘 —
  (1) `medusaError()` 가 payload 뒤에 **마침표를 덧붙인다**(updateLineItem 경로) → 순진한 `JSON.parse(slice)` 는 깨진다.
      파서를 「첫 `{` ~ 마지막 `}`」 추출로 바꾸고 회귀 테스트 추가.
  (2) `addToCart` 가 «던지지 않고» `{error}` 를 반환하며 직접 호출부가 **1곳이 아니라 3곳**
      (useAddToCart 훅 · PDP product-actions · quick-add-drawer). 셋 다 안 고치면 날 토큰이 고객에게 노출.
      **내 계획이 「담기 호출부」를 단수로, throw 기반으로 가정한 것이 틀렸다.**
Task 11: 구현자가 남긴 구멍 — `handleBuyNow`(바로구매, product-actions/index.tsx:418)가 같은 토큰 노출 위험.
  범위 밖이라 안 건드렸다고 보고. **리뷰가 판정한다 — 날 토큰이 고객에게 뜨는 경로가 남았다면 Minor 가 아니다.**
Task 11: task review dispatched (model opus) — 핵심 넷: [D] MIN 토큰을 clamp 상한으로 썼는가 /
  [F] 재요청이 정말 1회인가 / 토큰 노출 경로가 «전부» 닫혔는가(바로구매 포함) / 파서가 서버 «실제» 출력과 맞는가

컨트롤러 주의: T10 fix 구현자가 도는 동안 T12 구현자를 띄우지 않는다 — 두 에이전트가 동시에 `git add`/`commit` 하면
  인덱스가 섞일 수 있다. T10·T11 을 병렬로 돌린 것은 이미 한 번의 일탈이었고(트리가 겹치지 않아 무사), 반복하지 않는다.
Task 11: task review = **Needs fixes. Critical 1 + Important 2 + Minor 3.**
  [A]~[G] 판정은 전부 지켜졌고 리뷰어가 각각 코드로 확인했다 — 특히 **[D](MIN 을 clamp 상한으로 쓰지 않기)는
  회피만 한 게 아니라 타입 층에 「같은 필드가 토큰마다 다른 뜻」을 문서화**하고 스펙으로 고정했다.
  [F] 는 `attempted` 플래그 대신 «중첩 try» 로 구조적으로 1회를 보장 — 리뷰어가 「플래그는 잊을 수 있지만
  중첩은 못 잊는다」며 브리프보다 나은 답이라고 판정. `medusaError()` 마침표 발견도 실재 확인.
  ⚠️ 호출부 census 정정: 3곳이 아니라 **5곳**(훅 경유 간접 2곳 포함). 다만 그 둘은 `result.success` 만 읽어
  훅 수정으로 덮인다 — 개수는 틀렸고 결론은 맞다.

Task 11: 🔴 Ruling: **Critical 1 (바로구매가 날 토큰 + 상품 UUID 를 고객에게 보여준다)** — **고친다.**
  `product-actions/index.tsx:441` 이 `result.error` 를 그대로 토스트한다. `createBuyNowCart` 가
  `sdk.store.cart.createLineItem` 를 부르고(cart.ts:420) 그게 같은 `addToCartWorkflow` validate 훅을 타므로,
  한도 상품에 바로구매를 누르면 **`PURCHASE_LIMIT_EXCEEDED\n{"product_id":"prod_01J…","purchase_limit_remaining":2}`
  가 그대로 뜬다.** 구현자의 「바로구매 clamp 는 결제 함의가 달라 범위 밖」은 «clamp» 에 대해선 옳고 «누출» 과는
  무관하다 — 아무도 바로구매에 clamp 를 요구하지 않는다. 50줄 위 `handleAddToCart` 가 이미 하는 걸 8줄 복사하면 된다.
  같은 서버 액션이 훅 경유로는 마스킹되고 PDP 직접 경로로는 날것으로 나가는 «불일치»가 버그다.

Task 11: 🔑 Ruling: **Important 2 (clamp 재요청이 «카트에 이미 있으면» 반드시 실패하고 «거짓말까지 한다»)** — **고친다.**
  이건 **Task 5 와 Task 11 의 «조합»에서만 생기는 결함**이다. 둘 다 개별적으로는 옳다:
  - Task 5 가 서버를 「요청 델타」가 아니라 «병합된 카트 수량»으로 판정하게 고쳤다(그게 옳았다)
  - Task 11 이 서버가 준 `purchase_limit_remaining` 으로 재요청한다(그것도 자연스럽다)
  그런데 그 값은 **카트를 모른다** — `validate-purchase-limits.ts:89` 는 `maxPerOrder`(절대 상한)를,
  `:112` 는 `getRemaining()`(평생 잔여, 카트 미반영)을 보낸다.
  구체적으로: 카트에 2개, `maxPerOrder=5`, 4개 담기 → 병합 6>5 거절(remaining 5) → 5로 재요청 → 병합 2+5=7>5 →
  또 거절 → **「구매 한도에 도달해 더 담을 수 없어요」** 인데 실제로는 3개를 담을 수 있다.
  **재고 반복 구매의 «가장 흔한» 시나리오에서 매번 터진다.** 카트에 없을 때만 동작해서 아무도 못 잡았다.
  처방: 클라이언트가 `addToCart` 가 이미 들고 있는 카트(cart.ts:311)에서 그 상품의 현재 수량을 빼고 재요청한다
  (≤0 이면 `exhausted` 로). 카트 객체가 상품별 수량을 못 주면 «서버가 cap 대신 headroom 을 보내는» 대안이 있는데
  그건 계약 변경이라 서버 태스크 소관 — **구현자가 어느 쪽인지 밝히고 진행할 것.**

Task 11: Ruling: Important 3 (파싱 실패가 두 PDP 표면에서 누출을 되연다) — **고친다.**
  `product-actions/index.tsx:394-396`·`quick-add-drawer/index.tsx:266-267` 이 파서가 `null` 이면 `result.error` 로
  폴백한다. 마스킹 결정이 «payload 파싱 성공»에 의존하면 안 된다 — `message.startsWith("PURCHASE_LIMIT_")` 가드로
  구조적으로 불가능하게. 같은 트리의 `use-add-to-cart.ts:70-71`·`item/index.tsx:167-170` 이 이미 그 패턴을 쓴다.

Task 11: minor (deferred): 토큰→문구 매핑이 두 모양으로 존재하고 `item/index.tsx:166` 의 else 가 비exhaustive
Task 11: minor (deferred): 「남았어요」가 `maxPerOrder` 케이스엔 틀린 동사(잔여가 아니라 상한). ko/en/ja 공통
Task 11: minor (deferred): `productId` 를 파싱하지만 아무도 안 읽는다(브리프 지정이라 유지)
Task 11: 🔴 **standing fact — storefront 는 CI 가 «전혀» 안 돈다.** `.github/workflows/` 에 vitest 도
  storefront tsc 도 없다. 루트 type-check 는 `web` 제외, 루트 jest 는 `web/` 에 안 닿는다.
  **이 16개 테스트는 로컬 전용 증거이고, 파서가 회귀해도 아무것도 빨개지지 않는다.** 최종 보고에 실을 것.
Task 10: fix round 1 구현 완료 (commit fc9923163) — 5건 전부 반영 주장. 스크립트 스펙 16/16, 루트 jest 599 suites/5258, type-check 0.
Task 10: 🔑 **구현자가 [1] 을 «실증»했다** — 같은 DB 를 쓰는 실제 로컬 core 개발 서버(PID 797099)를 찾아
  다른 토픽 PENDING 행을 넣고 그 «게이트 없는» 서버가 집어 실패시키는 걸 관측(`retry_count` 0→2→3,
  `No publisher found for topic`), 그다음 «우리 모듈»의 `dispatchPendingEvents()` 를 직접 불러 적격 행이 있는데도
  **0건 선택**을 확인. 같은 DB·같은 시점의 게이트 유무 대조 + 원자적 SQL 증거(without_gate=2, with_gate=0).
  임시 하네스는 되돌려 삭제(diff 에 없음). **버그와 수정을 둘 다 실증한 유일한 사례다.**
Task 10: 구현자 잔여 우려 — 라이브 `INBOX_MAX_CONCURRENT_HANDLERS`/`INBOX_HANDLER_START_INTERVAL_MS` 는
  이 체크아웃에서 확인 불가. **운영자가 전량 실행 계획 전에 확인해야 한다.** 최종 보고에 실을 것.
Task 10: fix round 1 re-review dispatched (model sonnet, diff review-3c3491794..fc9923163.diff)
  — 핵심: 빈 문자열 prefix 가 «전부 매치»인지 «아무것도 매치 안 함»인지가 갈림길이다. 코드로 판정 요청.
Task 11: fix round 1/5 dispatched (원 구현자 재개, FIX_BASE 3c3491794, Critical 1 + Important 2·3)
Task 10: fix round 1/5 (5 addressed, 0 open; commits 3c3491794..fc9923163)
  재리뷰가 **빈 문자열 prefix 의 의미를 SQL 번역까지 추적해 확인** — `ilike(eventType, '%')` 를 `not()` 으로 감싸
  `NOT (event_type ILIKE '%')` 가 되고, 이게 `acquireEventBatch` WHERE 에 AND 되어 **어떤 토픽의 어떤 행도
  만족할 수 없다.** 「전부 보류」가 맞다. 주입 토폴로지도 확인 — `@Global()` 로 optional 토큰에 닿는 것은
  `FulfillmentOutboxDispatchGateModule` 이 프로덕션에서 이미 쓰는 «같은» 기법이고, import 순서는 무관하다.
  임시 하네스가 working tree 에 남지 않은 것도 확인.
Task 10: complete (commits 4fd44dd85..fc9923163, review clean)

Task 10: 🟡 **최종 리뷰로 이월(우선 분류 요망)** — 「`eventTypePrefixes: ['']` 가 전부 보류」라는 «관용구» 에
  자동 테스트가 **0건**이다. `outbox-dispatch-routing.spec.ts` 는 일반 prefix/topic 게이팅과 「빈 술어 ⇒ 조건 없음」은
  덮지만 이 트릭은 안 덮는다. **`pauseCondition()` 의 ilike/not 번역이 리팩터되면 CI 가 아무것도 안 잡고
  이 스크립트의 Critical 구멍이 조용히 다시 열린다.** 이번 diff 의 결함은 아니지만 그 Critical 을 지키는 유일한 장치다.
Task 10: minor (deferred): `--after` 재개가 성공/실패 모두에서 커서를 전진시켜, 출력된 힌트로 재실행하면 그 구간의
  실패분은 건너뛴다(운영자가 「실패 masterId 목록」으로 따로 재조준해야 함). 커서 재개의 내재적 성질
Task 10: minor (deferred, 기존 동작): `requeueStaleProcessingEvents()` 는 `pauseCondition()` 밖이라 이 프로세스가
  도는 동안 다른 BC 의 stale PROCESSING 행도 테이블 전역으로 requeue 한다. 멱등한 크래시 복구 동작이고 [1] 의
  위험(집어서 실패)과 무관 — 새 위험 아님

컨트롤러 결정: T11 fix 구현자가 도는 중이지만 **T12(admin-web) 구현자를 지금 띄운다.** 트리가 완전히 분리돼 있고
  (`web/` vs `apps/admin-web/`), 앞서 T10+T11 병렬이 무사히 끝났으며, 충돌 시 실패 모드가 «조용한 오염»이 아니라
  «보이는 index.lock 에러» 라서다. 마지막 태스크라 직렬화 비용이 크다.
Task 12: dispatched (model sonnet, BASE fc9923163). 판정 A~F:
  서버가 `lifetimeQuantityLimit <= 0` 을 400 으로 거절하고 DB CHECK 도 `IS NULL OR > 0` → 폼의 0·빈값·쓰레기는
  전부 null 로 보낼 것 / 순수 매핑 함수를 «먼저» 만들고 테스트(.tsx 는 CI 가 안 보므로 판정은 거기에만 얹힌다) /
  라벨은 일괄등록 엑셀과 «같은 말» 「평생구매한도」 / `requiresMembership` 매핑이 두 곳이니 둘 다 /
  읽기 «그리고» 쓰기를 배선(읽기만 하면 「보이는데 저장이 안 된다」) / 사람 스모크 체크리스트를 구체적으로.
  라이브 실측(한도 설정 행 0)을 실어 **이 화면이 MD 가 «첫 한도»를 넣는 경로이고 개통 스모크도 여기서 한다**는
  의미를 명시. 동시 작업 중인 storefront 구현자와의 git 충돌을 피하도록 «경로 명시 add» 지시.
Task 11: fix round 1 구현 완료 (commit 3416734a1) — vitest 304 passed(+11), tsc 베이스라인 53 유지(자기 파일 0,
  `git stash` diff 로 확인). 3건 전부 반영 주장.
Task 11: 🔑 구현자가 [2] 의 근본 원인을 «다시» 짚었다 — 내 처방(「카트 수량을 빼라」)보다 정확한 진술:
  **`limit.remaining` 은 «절대 상한»인데 `createLineItem` 의 `quantity` 는 기존 카트 수량 «위에 더해지는 델타»다.**
  `sumCartQuantityForProduct`(순수, 신규 6테스트) + 카트 «재조회»로 `delta = remaining − existingQty` 계산.
  옵션 A(클라이언트) 선택 — `getOrSetCart` 의 카트 객체에 `items` 가 없어 `retrieveCart` 를 한 번 더 불렀다.
Task 11: fix round 1 re-review dispatched (model sonnet, diff review-fc9923163..3416734a1.diff)
  ⚠️ base 주의: T10 fix 커밋(fc9923163)이 T11 원 구현 뒤에 끼어들어서, 순진하게 `3c3491794..HEAD` 로 잡으면
  T10 의 diff 까지 섞인다. fc9923163 을 base 로 다시 뽑았다.
  핵심 넷: 델타 재계산이 서버 병합 판정과 일치하는가(같은 상품 여러 라인도 합산하는가) / 재조회가 새 문제를
  만들지 않는가(왕복·경쟁·실패 폴백) / 노출 경로가 «전부» 닫혔는가(census 를 3→5 로 정정한 전례) /
  [3] 가드가 파싱 성공 여부와 «무관»하게 마스킹하는가
Task 11: fix round 1/5 (3 addressed, 0 open; commits 3c3491794..3416734a1)
  재리뷰 검증: 서버 `reject()` 를 직접 읽어 **`maxPerOrder` 분기든 `getRemaining()` 분기든 반환되는 `remaining` 이
  항상 «병합 수량이 넘으면 안 되는 절대 문턱값»** 임을 확인 → 성공 조건이 `existingQty + delta ≤ remaining` 이므로
  `delta = remaining − existingQty` 가 **두 분기 모두에 수학적으로 정확**. 합산 기준도 일치(서버 `mergeCartQuantityLines`
  는 product_id 단위, 클라 `sumCartQuantityForProduct` 도 product_id 단위). 재조회는 `cache:"no-store"` 이고
  `retrieveCart` 가 에러를 삼켜 null 을 주므로 안전 폴백이 실제로 도달 가능. 노출 경로 전수 재확인 — 잔존 없음.
Task 11: out-of-scope (deferred): `cart.ts` 의 델타 계산·재조회·재시도 실패 처리 분기가 무테스트
  (순수 함수 `sumCartQuantityForProduct` 만 테스트됨). `.tsx` 배선과 달리 «테스트 가능한» 영역이라 정당한 예외가 아니다
Task 11: out-of-scope (기록): 재조회~재요청 사이 레이스는 실패 방향이 항상 보수적(과다 담기·거짓 「더 담을 수 있음」이
  아니라 재거절 또는 과소 clamp) — [2] 가 지적한 거짓 소진 안내의 재발은 아님
Task 11: complete (commits 3523fd1d9..3416734a1, review clean)
Task 12: implementer DONE_WITH_CONCERNS (commit 23f9bef32) — admin-web tsc 0, test:admin-web 111 suites/952 tests 주장.
Task 12: 🔑 구현자 우려 — 서버에 `lifetimeQuantityLimit` 를 «즉시»(draft 없이) 저장하는 엔드포인트가 없다.
  `requiresMembership` PATCH 는 이 값을 «보존만» 한다(`product-versions.service.ts:929-940` 의 주석이 명시).
  그래서 기존 draft 전용 `PUT purchase-constraint` 로 연결 → **저장이 draft 뷰에서만 활성**(active 뷰는 읽기 전용).
  컨트롤러 확인: 컨트롤러 `PUT` 이 `upsertForDraft` 를 부르는 게 맞다. 다만 서비스엔 active 에 쓰는
  `upsertForVersion` 이 «있고» `updateRequiresMembership` 이 그걸 써서 active 를 직접 고치고 재싱크한다 —
  **능력은 있으나 `lifetimeQuantityLimit` 용 라우트가 없을 뿐**이다.
Task 12: task review dispatched (model sonnet) — 핵심: draft 전용이 «수용 가능한 답»인가 미완인가.
  판정 기준을 코드로 잡으라고 지시 — draft 에 값을 넣고 발행하면 `ProductMasterActiveVersionChanged` 가 나가
  Medusa 로 «흘러가는가». 흐르면 기능 완결 + UX 제약일 뿐이고, 안 흐르면 미완이다.
  그리고 비활성 입력이 «왜» 비활성인지 전달되는가(설명 없는 회색은 「고장났다」로 읽힌다).
Task 12: task review = Spec ✅ / **Approved**. Critical·Important 0건, Minor 3건.
  **draft 전용이 «수용 가능»으로 판정됐다 — 리뷰어가 코드로 확인**: `publishVersion` 이 «같은 버전 행»을
  draft→active 로 갱신하므로(새 행 복사가 아님) 제약 매핑이 `(masterId, versionId)` 키로 그대로 붙어 있고,
  `_emitActiveVersionChangedEvent` → `assembleActiveVersionSnapshot` 이 그 값을 스냅샷에 싣는다.
  **즉 기능은 완결이고 「즉시 토글 없음」은 UX 제약일 뿐이다.**
  비활성 입력도 설명된다 — 같은 카드의 기존 관행(`canEditBasicInformation` + 헤더 문구)을 따랐고 필드별 안내도 있다.
  구현자가 `.test.ts` → `.spec.ts` 로 바꾼 것도 옳다(루트 `testRegex` 가 `.spec.ts` 만 수집 — #793 함정 회피).
  그리고 admin-web 의 «순수 `.ts` 스펙»은 루트 jest 가 실제로 수집한다는 것까지 리뷰어가 확인했다
  (`roots` 에 `apps/` 포함, ignore 는 `.next`/`node_modules` 뿐, `moduleNameMapper` 가 `^@/` 를 매핑).
Task 12: minor (deferred): 사람 스모크에 「draft 저장 → 발행 → active 에서도 값이 보이는지」 항목이 없다(8번째로 추가 권장)
Task 12: minor (deferred): `PurchaseConstraintDto` 가 `products-detail.types.ts` 의 인라인 선언과 중복
Task 12: 🟡 minor (deferred, 기존 결함): 같은 카드에서 `requiresMembership` 스위치는 «active» 에 쓰고
  새 `lifetimeQuantityLimit` 은 «보고 있는 버전» 에 쓴다. draft 를 보며 스위치를 켜면 새로고침 후 안 바뀐 것처럼 보인다.
  이 diff 가 만든 게 아니고 정직하게 공개됐으나, **새 필드 바로 위에 있어 MD 가 둘을 같이 만지면 혼란**한다. 별도 티켓 권장
Task 12: complete (commits 3416734a1..23f9bef32, review clean)

## 🔑 12/12 태스크 전부 완료 — 최종 whole-branch 리뷰로 이행
컨트롤러 최종 게이트 (직접 실행): `npm run type-check` 에러 0 / `npx jest --maxWorkers=2`
  **600 suites · 5,264 tests 통과, 실패 0**(129 suites·940 tests 는 DB 가드로 skip).
최종 whole-branch 리뷰 dispatched (model opus, merge-base f5b8139e4..23f9bef32, 23 commits / 62 files / +6248 −90).
  이연 Minor 44건 분류와 「우선 분류 요망」 3건 의견, Production Readiness 판정을 요청.

## 최종 whole-branch 리뷰 결과 (opus, 3패스)
**Merge readiness: Ready with follow-ups — 단 C1·C2 를 이 PR 에서 닫은 뒤.**

C1 🔴 스위퍼가 선례의 «두 번째 안전조건»을 떨어뜨렸다 — `restore-stuck-coupon-consumptions.ts` 는
  `!withOrder.has(cartId) && !completed.has(cartId)` 둘을 보는데(그 docstring 이 이유를 명시), 구매한도 스위퍼는
  `cart.completed_at` 조회를 통째로 뺐다. `order_cart` 링크 조회가 한 번이라도 거짓 음성을 내면
  **주문이 실제로 생긴 claim 이 해제되고 카운터가 깎인다 = 고객이 한도를 초과해 산다.** 되돌릴 수 없다.
  «우선분류 ①(불변식 무테스트)»보다 한 단계 앞 — 테스트가 없는 게 아니라 **불변식 자체가 약하다.**
  게다가 스위퍼는 **플래그와 무관하게 배포 즉시 실행 가능**하다(게이트 밖).
C2 🔴 CLI 인자 오타가 스위퍼를 전량 해제로 뒤집을 수 있다 — `Number('60m')→NaN→Invalid Date` 가
  `created_at < ?` 바인딩으로 내려간다. 결과가 C1 과 같다.

I1 결제 «후» 실패 페이지가 날 토큰+UUID 를 그대로 렌더 — T11 census 가 닫지 않은 «다섯 번째 표면».
  `checkout/callback/actions.ts` → `toCheckoutErrorCode` 미매칭 → `/checkout/fail?message=` → 원문 렌더.
  그 파일 헤더가 스스로 「매핑 안 된 에러는 원문이 그대로 노출된다」고 적어 뒀다. PDP 바로구매 건보다 나쁘다(결제 후).
I2 수량변경 훅만 「카트 결과 수량」을 안 본다 — T5 의 수정을 그 훅이 못 받았다. 같은 상품 다른 옵션이 카트에
  있으면 통과했다가 **결제 후 거절**(+I1 로 날 토큰).
I3 「빈 prefix = 전부 보류」 무테스트인데 **그 관용구를 «무효화하는 방향»의 기존 테스트가 바로 옆에 있다**
  (`outbox-dispatch-routing.spec.ts:199`). 자연스러운 하드닝이 Critical 구멍을 다시 연다.
I4 개통 ④를 실행할 수단이 없다 — `PURCHASE_LIMIT_ENFORCED` 가 SST env 블록에도 env-template 에도 없다.
  선례 `COUPON_AUTO_ISSUE_ENABLED` 도 없어서 **플래그 기구가 라이브에서 한 번도 행사된 적이 없다.** 끄는 것도 배포다.
I5 ③ 실측이 «비율»이라 잔여 미동기화를 못 잡는다. 그리고 미동기화 상품 하나가 **카트 전체를 얼린다**
  (mergeCartQuantityLines 가 기존 라인 전부의 meta 를 읽는다). PIM 밖 상품(seed·수기)은 재발행으로도 안 고쳐진다.
  → 비율이 아니라 **0행 쿼리**가 게이트여야 한다.
I6 「플래그 OFF」가 「코드가 안 돈다」가 아니다 — 배포 직후부터 모든 주문이 상품마다 트랜잭션 1개를
  **결제 승인 뒤** 경로에서 돈다. 위험 구간은 개통이 아니라 «배포»다. 관측 항목이 필요.

이연 44건 분류: 머지 전 6 / 별도 티켓 12 / 버려도 됨 ~26.
우선분류 ③(storefront·admin-web CI 부재): 머지를 막지 않으나 **이 브랜치가 그 사실의 가장 큰 피해자** —
  파서가 「고객에게 날 토큰을 안 보인다」는 계약의 유일한 집행자인데 로컬 전용 증거다. PR 본문에 명시 + 별도 티켓.
최종 리뷰 fix wave dispatched (model sonnet, ONE dispatch — 스킬 규칙대로 findings 당 하나씩 띄우지 않는다).
  범위: C1·C2(머지 블로커) + I1~I6(개통 블로커) + M3·M4·T12-smoke(한 줄짜리).
  ⚠️ I4 가 `deployments/lcnine/services/infra/services.ts`(배포 인프라)를 건드린다 — 값은 `'false'` 만,
  다른 건 손대지 말라고 명시. **사용자에게 보고할 것.**
  구현자에게 「어떤 처방이 실제로는 틀렸다는 근거를 찾으면 고치지 말고 말하라 — 이 리뷰어의 판정도 완벽하지 않다」를 명시.
최종 fix wave 완료 (6 commits: bc5a66605 C1·C2 / 809066569 I1 / ab576e289 I2 / a1702a055 I3 /
  bf5310543 I4·I5·I6 / 1acc8a4f4 M3·M4). 구현자 주장: 루트 type-check 0 · 루트 jest 600 suites/5,265 ·
  medusa unit 54 suites/494 · storefront vitest 32 files/308. C1·I2·I3·M3 는 bug-injection 으로 RED 확인.
컨트롤러 확인: C1 의 두 신호(`!withOrder.has && !completed.has`) 존재 / I4 는 배포 인프라에
  `PURCHASE_LIMIT_ENFORCED: 'false'` 한 줄 + 주석만.
구현자가 닫지 못했다고 보고한 둘: (a) C2 에 전용 유닛 테스트 없음(내부 헬퍼라 non-export) —
  코드 리딩으로만 확인 (b) T12-smoke 가 `.superpowers/`(gitignore) 안이라 PR diff 에 안 나타남.
최종 scoped 재리뷰 dispatched (model opus). **두 번째 fix wave 는 없다** — 잔여는 컨트롤러가 판정한다.

## 최종 scoped 재리뷰 결과 — **Ready with named follow-ups**
C1·C2·I1·I2·I3·I4·I5·I6·M3·M4 전부 ADDRESSED(코드 기준). C1 은 코드 ADDRESSED / 스펙 PARTIALLY, T12-smoke 는 PARTIALLY.
리뷰어가 I3·I5·I4·I2 를 diff 밖 코드·스키마로 «독립 검증» 했다(정규식 SQL 번역, Medusa product 테이블 스키마,
line-item 의 product_id 실재, 워크플로가 `items.*` 를 싣는 것까지).

### 컨트롤러 판정 — 잔여 4건 (두 번째 fix wave 없음. 사용자에게 surface 한다)

Ruling: 잔여① **New Breakage — I2 가 「수량 0 = 라인 삭제」 카브아웃을 조건부로 만들었다** — **개통 전 필수.**
  `mergeCartQuantityLines` 가 요청 0 을 그대로 더하므로, 같은 상품의 다른 라인이 있으면 결과 qty 가 0 이 아니라
  «형제 합계» 가 되어 `if (line.qty === 0) continue` 가 안 탄다. 결과: `minPerOrder=2` 상품이 옵션 2줄로 담겨 있으면
  **어느 라인도 지울 수 없다.** 그건 Task 5 구현자가 발견해 고쳤던 바로 그 부류(「상품을 치우는 행위가 막힌다」)이고,
  그 결정을 못박은 🔴 주석의 전제를 호출부에서 무너뜨린 것이다. **스펙은 순수 함수를 직접 부르므로 이 변화를 못 본다.**
  완화: 플래그 OFF · 스토어프론트 삭제는 `deleteLineItem`(다른 워크플로) · 스테퍼가 0으로 안 내려감
  → **개통 후 API 직접 호출 경로에만** 나타난다. 처방 3줄(`buildQuantityChangeLine` 맨 앞에 `if (newQuantity === 0) return [];`).
  비용: 안 고치고 설계 문서 「알려진 구멍」에도 안 적으면, 개통 후 그 조합의 고객이 카트에서 상품을 못 지운다.

Ruling: 잔여② **C2 유닛 테스트 부재** — **머지 안 막음. 후속 권장(12줄).**
  가드 코드 자체는 입력 계열 전수로 확인됨(`'60m'`·`''`·`'0'`·`'-5'`·`'Infinity'` 전부 throw, `undefined` fallback).
  이 스위퍼는 `src/jobs/` 에 등록돼 있지 않아(전수 확인) 사람이 손으로 오타를 쳐야 닿는다 — C1 과 도달 확률이 다르다.
  다만 구현자의 「non-export 라 못 붙인다」는 **사실이 아니다** — 고정할 성질은 default export 의 관측 가능한 행동
  (파싱 거절 + **「DB/Kafka 접속 «전»에」라는 순서**)이고 그건 기본 export 로 닿는다. 순서는 코드 리딩이 시간에 걸쳐
  못 지키는 절반이다.

Ruling: 잔여③ **T12-smoke 가 gitignore 안이라 PR 에 없다** — **머지 전 권장(1줄).**
  `git add -f` 를 안 한 판단은 옳다. 틀린 건 «대안을 안 쓴 것». 추적되는 집이 이미 있다 —
  `docs/superpowers/plans/…-enforcement.md:2195-2200` 의 `Step 7: 사람 스모크` 체크박스.
  그 항목이 닫는 구멍이 「MD 가 첫 한도를 넣는 유일한 경로의 왕복」이라, 빠지면 개통 당일에야 드러난다.

Ruling: 잔여④ **C1 스펙이 두 신호 중 «하나만» 고정한다** — **머지 안 막음. 후속(1줄).**
  이식한 픽스처의 `cart_with_order` 가 `completed_at: new Date()` 도 갖고 있어, 첫 신호(`!withOrder.has`)를 통째로
  지워도 5개 테스트가 전부 GREEN 이다. **선례 스펙도 같은 결함을 갖고 있어** 「같은 모양으로 이식」 지시엔 충실했다.
  spec:35 의 `completed_at` 을 `null` 로 (선례도 같이 고칠 가치).

Ruling: 잔여⑤(리뷰어가 Low 로 낸 것) **`cart.items` 가 비면 I2 합산이 조용히 사라진다** — **park.**
  같은 훅에 이미 「cart 에 items 가 없는 경우」 fallback 이 있다(그 경우가 존재한다는 뜻). 그때 옛 동작으로
  조용히 되돌아간다. 안전 방향 실패이고(결제 시 `buildLimitLines` 가 최종 방어) 워크플로가 `items.*` 를 항상
  싣는 것으로 보여 실현 가능성 낮음.

워크스페이스 유지 — 최종 리뷰가 «clean» 이 아니고(named follow-ups) 머지도 안 됐다.
