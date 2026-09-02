# 쿠폰 그랜트 모델 — 세션 핸드오프

**이 문서 하나로 새 세션이 콜드 스타트할 수 있게 쓴 것이다.** 앞 세션의 대화·작업 원장·태스크 리포트는
전부 사라졌다(gitignore 스크래치였고 마무리 때 삭제했다). 여기 없는 맥락은 없다고 보면 된다.

- **작성**: 2026-09-02, 14태스크 실행 + 전체 브랜치 리뷰 + 수정 웨이브를 마친 직후
- **상태**: 코드 작업은 끝났고 **사람의 제품 결정 2건**과 **선택적 소수정 2건**이 남았다

---

## 0. 시작하는 법

```
워크트리 : /home/pauseb/workspace/almondyoung-server/.claude/worktrees/coupon-grant-model
브랜치   : feat/coupon-grant-model  (upstream: origin/develop)
베이스   : 42e2ac141  (origin/develop 분기점)
HEAD     : 757a4adcb  (32커밋, 워킹트리 깨끗, 미푸시)
```

🔴 **`npm install` 을 돌리지 마라.** 이 워크트리는 의존성을 메인 체크아웃으로 심볼릭 링크해 두었다 —
`node_modules` · `apps/medusa/node_modules` · `apps/medusa/.env` · `apps/admin-web/node_modules` 4개.
이 저장소 워크트리의 기존 관례이고, 링크가 끊겼으면 다시 걸면 된다(`ln -sfn <메인경로> <워크트리경로>`).

**전제**: docker compose 의 postgres(5432)·redis(6379)가 떠 있어야 통합 스펙이 돈다.

**함께 읽을 것** (전부 이 브랜치에 커밋돼 있다):
- `docs/superpowers/specs/2026-09-02-coupon-grant-model-design.md` — 설계. **구속력 있는 정본**
- `docs/superpowers/plans/2026-09-02-coupon-grant-model.md` — 14태스크 구현 플랜(이미 전부 실행됨).
  ⚠️ 이 플랜에는 **실행 중 발견된 결함이 여럿 있다**(§6 참조). 플랜 텍스트를 무비판적으로 따르지 말 것
- `docs/superpowers/reports/2026-09-02-coupon-grant-deploy.md` — 배포 노트. 배포하는 사람이 읽을 것
- SoT 이슈: [#488](https://github.com/LCNINE/almondyoung-server/issues/488)

---

## 1. 이 브랜치가 한 일

**«발급된 쿠폰 한 장»을 여러 장으로 만들었다.**

이전에는 발급된 쿠폰 = Medusa 가 생성하는 customer↔promotion 링크 행이었고, 그 테이블의 복합 PK
`(customer_id, promotion_id)` 때문에 **고객당 최대 한 장**이었다. `Link.create` 가 upsert 라 발급 버튼을
두 번 눌러도 두 번째가 첫 행을 덮어써서 조용히 한 장으로 수렴했다 — **의도한 멱등성이 아니라 부작용**이다.

이 브랜치는 그 제약을 없애고(같은 쿠폰을 같은 고객에게 여러 출처에서 발급 가능), 멱등성을 **의도적으로**
다시 세웠다.

### 핵심 구조

| 층 | 무엇 |
|---|---|
| 쿠폰 **정의** | `promotion` (코드 단위) — 변경 없음 |
| 발급 **인스턴스** | 🆕 `coupon_grant` 테이블. 발급 1건 = 1행 |
| 멱등성 | `issue_key` + **파셜 유니크** `(promotion_id, customer_id, issue_key) WHERE deleted_at IS NULL` |
| 발급 출처 | 기존 `issued_via` 어휘 5개 그대로 (새 어휘 없음) |

`issue_key` 규약 — **이게 따닥·재시도 방어의 전부다**:

| 경로 | 키 | 효과 |
|---|---|---|
| 셀프 클레임 | `'claim'` 고정 | 영구 1장 |
| 트리거 자동발급 | `trigger:<trigger>` | 트리거당 1장, channel-adapter 재시도 멱등 |
| 관리자 발급 | `${submit_id}:${n}` | 같은 제출은 몇 번 도착해도 N장 |

### 함께 닫힌 것

- 🔴 **「1장 = 1회」가 이 브랜치 전에는 아예 없었다.** `used_at` 은 쓰이기만 하고 **어떤 게이트도 읽지
  않았다** — 발급받은 쿠폰을 만료 전까지 몇 번이든 쓸 수 있었다. 이제 세 자리에서 강제한다:
  카트 부착 미들웨어 · 체크아웃 `validate` 백스톱 · 주문 생성 소모 훅
- **A2** — 주문 취소·전액환불 후에도 쿠폰이 영구 소실되던 라이브 결함(`order.canceled` 구독자로 복구)
- **클레임 경합** — 따닥 한 번에 「선착순 100명」이 2명분 소진되던 라이브 결함(read-then-write 제거)
- **두 한도의 동시 설정 불가** — 「총 할인금액 한도」와 「1인당 사용 횟수」가 캠페인의 유일한 예산 슬롯을
  다투던 제약. 후자를 없애 전자가 슬롯을 온전히 쓴다
- **새 축** — `POST /admin/promotions/:id/customers` (쿠폰 1개 → 고객 N명). 기존 라우트는 반대 축이었다
- **어드민 화면** — 로그인아이디/이메일 여러 줄 × N장 발급. **새 조회 API 를 만들지 않았다**
  (user-service `/admin/users?q=` 가 loginId·email 등 5축을 한 번에 ilike 검색, medusa
  `/admin/customers/by-almond-user/:id` 는 이미 존재)

### 의도적으로 «안» 한 것 — 다시 논의하지 말 것

- `promotion_issue_log` **테이블**은 안 지웠다(코드만 걷음). expand-contract 컨벤션상 별도 PR
- Medusa 링크 테이블은 **유지**하고 발급 시 계속 만든다(payload 없이). 표시용 조인 전용
- 발급 시 고객 알림 **없음**(선재 문제, 범위 밖)

---

## 2. 검증 — 명령이 함정이다

🔴 **틀린 명령을 쓰면 「내 코드가 빨갛다」로 오독한다. 아래 표가 정본이다.**

| 대상 | 올바른 명령 | 기준선 |
|---|---|---|
| medusa HTTP 통합 | `scripts/local/run-medusa-integration.sh --testPathPattern 'integration-tests/http/'` | **10 suites / 117 tests** |
| medusa 모듈 통합 | `scripts/local/run-medusa-integration.sh --modules --testPathPattern 'promotion-meta'` | **5 suites / 84 tests** |
| medusa 유닛 | `cd apps/medusa && npm run test:unit` | 36 suites / 354 |
| medusa 타입 | `cd apps/medusa && npx tsc --noEmit` | **선재 3건**(develop 상속). 증가 0 이 기준 |
| admin-web 테스트 | **저장소 루트에서** `npm run test:admin-web` | 98 passed / 0 failed |
| admin-web 타입 | `cd apps/admin-web && npx tsc --noEmit` | 0 |
| 루트 전체 | `npm run type-check` · `npx jest --maxWorkers=2` | 0 · 522 suites / 4,594 |

### 🔴 동작하지 «않는» 명령 (실측으로 확인됨)

- **`cd apps/admin-web && npx jest`** — 그 디렉터리에 jest 설정도 transform 도 없어 전 스펙이
  `SyntaxError: Cannot use import statement outside a module` 로 죽는다. **반드시 루트에서 `npm run test:admin-web`.**
- **`npm run test:integration:http` / `:modules` 직접 호출** — 러너가 `DATABASE_URL` 이 아니라
  `DB_HOST`/`DB_USERNAME`/`DB_PASSWORD`/`DB_PORT` 를 읽어서 전 스펙이 SASL 로 죽는다.
- **`--testPathPattern 'coupon-'`** — 워크트리 이름이 `coupon-grant-model` 이라 **경로 전체가 매치**돼
  엉뚱한 스펙이 딸려온다. 반드시 디렉터리를 포함해서 좁힐 것.

### 🔴 게이트가 «본 적 없는» 것

- **루트 `npm run type-check` 는 `apps/medusa` 와 `apps/admin-web` 을 «둘 다» 제외한다.**
  즉 루트 게이트 0 은 이 브랜치 코드의 대부분을 본 적이 없다는 뜻이다.
- **CI 는 이 브랜치를 사실상 검증하지 않는다** — `apps/medusa` 전체 tsc 도, 쿠폰/모듈 통합 스펙도
  워크플로에 없다. CI 의 medusa 유닛은 transpile-only 라 타입을 안 본다.
- **admin-web 의 jest 도 transpile-only** — 타입 계약 변경의 RED 는 `tsc` 에서만 보인다.
- **`apps/medusa/tsconfig.json` 의 `include` 는 `src/**/*` 뿐** — `integration-tests/**` 는 타입 게이트 밖이다.
- **`web/almondyoung-storefront` 는 CI 가 0개다.**

**결론: 이 브랜치를 지키는 건 사람이 로컬에서 돌리는 위 표의 명령들뿐이다.**

---

## 3. 🔴 남은 작업 — 제품 결정 2건 (사람이 정해야 함)

둘 다 **브랜치가 미머지라 지금이 가장 싸다.** 개통 후엔 데이터 마이그레이션이 딸려온다.

### A1. 쓴 쿠폰이 마이페이지 어디에도 안 뜬다 — 그리고 이게 정상 경로다

**현상.** 마이페이지 응답 바구니는 셋뿐이다(`apps/medusa/src/api/store/customers/me/promotions/route.ts:282-289`):
`promotions`(사용 가능) · `claimable_promotions` · `expired_promotions`. **「사용함」 바구니가 없다.**

쿠폰을 쓰고 나면 그 장의 `expires_at` 에 따라:

| `expires_at` | 어디에 뜨나 | 왜 |
|---|---|---|
| **없음(무기한)** | **안 뜸** | `expiredEndsAtOf`(`:236-255`)가 `dated` 가 비어 `null` → `:266` 에서 continue |
| **미래** | **안 뜸** | `endsAt < now` 가 거짓(`:267`) |
| 과거 30일 이내 | 「만료」에 뜸 | 다만 **문구가 틀림** — 쓴 건데 만료됐다고 나옴 |
| 과거 30일 초과 | 안 뜸 | 컷오프 밖 |

🔴 **두 번째 줄이 정상 사용 경로다.** 고객은 보통 만료 전에 쓰므로 「쓰면 사라진다」가 예외가 아니라
**기본 동작**이다. 브랜치 이전에는 `used_at` 에 독자가 없어 계속 「사용 가능」에 남았다(그건 그것대로
버그였다 — 다시 쓸 수 있었으니까). 지금은 반대 극단이다.

**선택지**
1. **`used_promotions` 바구니 추가** — 국내 커머스 관례(사용완료 탭)와 일치. 서버는 `grantsOf(id)` 에
   `used_at != null` 인 장이 있으면 담으면 되고, 스토어프론트에 탭 하나가 붙는다. **앞 세션 추천**
2. 만료 바구니에 합치고 라벨을 「사용함/만료」로 — 서버 변경은 작지만 두 상태가 섞인다
3. 그대로 둔다 — 개통 후 「내 쿠폰 어디 갔냐」 문의

### A2. `public` 쿠폰에 직권 발급하면 그 고객«만» 제한된다

**현상.** 카트 게이트(`apps/medusa/src/api/store/carts/middlewares/per-customer-limit.ts:54-63`)가
`visibility` 를 보지 않는다:

```ts
if (mine.length > 0) {                    // ← 장이 하나라도 있으면 이 가지
  if (!hasUsableGrant(mine, now)) → 거절
} else if (!isUsable(null, meta, now)) → 거절
```

그리고 발급 라우트들은 상태·자동적용·발급창·룰만 검사하고 **`public` 쿠폰의 발급을 막지 않는다.**

결과: 관리자가 선의로 `public` 쿠폰을 특정 고객에게 발급하면 **그 고객만** 장 수만큼 제한되고 나머지는
계속 자유롭게 쓴다. 선의가 정확히 반대로 작동한다.

**선택지**
1. **발급 3경로에서 `visibility === 'public'` 을 거절**(`reason: 'public_promotion'`) — 4~6줄. **앞 세션 추천**
2. 게이트에서 `public` 이면 장을 무시 — 발급은 허용하되 무해화. 다만 현황에 장이 쌓여 관리자가 혼란
3. 그대로 둔다

---

## 4. 남은 작업 — 선택적 소수정 3건

프로세스상 「두 번째 수정 웨이브 없음」 규칙 때문에 남긴 것들이다. 전부 작다.

### B1. 「조회」부터 다시 누른 재제출 → 이중 발급 가능

`apps/admin-web/src/features/mall/marketing/coupons/components/coupon-assign-dialog.tsx:63-74`

`submitIdRef` 를 **재조회할 때마다 무조건 버린다**(대상이 바뀌었을 수 있으므로).

- 안전: 발급 실패 → **「발급」 재클릭** → 같은 키 → 멱등 ✅
- 위험: 발급 타임아웃 → 관리자가 **「조회」부터 다시 누름** → 새 키 → **또 발급** ❌

수정 전에는 반대 문제(대상을 바꿔 재조회해도 옛 키가 남아 3장 요청이 2장)가 있었고 리뷰가 이 트레이드오프를
택했다. **완전한 해법은 「해석된 대상 집합 + 수량이 실제로 바뀌었을 때만」 키를 버리는 것**이다.

### B2. `link_error` 가 「발급된」 고객을 실패로 보고

`apps/medusa/src/api/admin/promotions/[id]/customers/route.ts:326` (형제 라우트 `customers/[id]/promotions/route.ts` 도 동형)

grant 는 만들어졌는데 표시용 링크 생성이 실패하면 `skipped: link_error`(문구 「발급 처리 중 오류」)로
나간다. 실제로는 **쿠폰이 발급된 상태**다.

⚠️ 복구 경로는 이미 있다 — 같은 `submit_id` 로 재시도하면 전량 duplicate 로 떨어지면서 그 자리에서
링크를 다시 만든다(`:343` 의 `ensureLink`). 남는 건 문구와 실제 상태의 불일치뿐이다.

### B3. 상한 테스트의 단언 한 줄이 공허함

`apps/medusa/integration-tests/http/coupon-grant.spec.ts:394` (「customer_ids × quantity 상한(1000)」 테스트)

```ts
const many = Array.from({ length: 40 }, (_, i) => `cus_fake_${i}`);
// ... 400 단언 ...
expect(await svc().listGrantsForCustomer(customerId)).toHaveLength(0);   // ← customerId 는 대상이 아님
```

⚠️ 같은 형태의 단언이 이 파일에 7곳 있는데(`:141`·`:202`·`:223`·`:355`·`:394`·`:424`·`:439`)
**공허한 것은 `:394` 하나뿐**이다 — 나머지는 `customerId` 가 실제 발급 대상이라 유효하다. 일괄로 손대지 말 것.

수정 유무와 무관하게 통과한다. **이 브랜치가 세 번 잡아낸 실패 모드(이름보다 약하게 단언하는 테스트)의
네 번째 사례다.** 실질 방어는 바로 아래 대조군(곱이 상한 이내면 200 + 50장)이 하고 있어 치명적이진 않다.

---

## 5. 배포 선행조건 — 코드가 아니라 운영

배포 노트(`docs/superpowers/reports/2026-09-02-coupon-grant-deploy.md`)가 정본이다. 요약:

1. 🔴 **`sst deploy` 직후 «즉시» 백필** — `apps/medusa/src/scripts/backfill-coupon-grants.ts`.
   dry-run 이 기본이고 확인값을 요구한다. **그 사이는 장애 구간이다**: 기존 발급 쿠폰이 전부 사용 불가
   (`COUPON_NOT_ASSIGNED`)·마이페이지 미표시이고, **이미 클레임한 `claimable` 쿠폰을 다시 클레임할 수
   있다**(되돌리기 어려운 데이터 변화 — `issued_count` 가 실제로 깎인다). **환경별 1회**(dev·live 따로).
2. **마이그레이션 DDL 은 배포가 첫 실행이다.** 모듈 통합 러너는 DML 모델로 스키마를 합성하고 손으로 쓴
   마이그레이션을 안 돌린다. 배포 후 인덱스·CHECK 제약 존재를 SQL 로 확인할 것(노트에 쿼리 있음).
3. **롤백 주의** — 마이그레이션의 `down()` 이 `DROP TABLE` 이다. 개통 후 롤백하면 그 사이 발급된 장이
   전부 사라진다.
4. **배포 전 실측 1건** — `use_by_attribute` 예산을 가진 활성 프로모션 수(노트에 SQL). 0 이면 조치 불요.

---

## 6. 이 브랜치에서 배운 함정 — 다음 사람이 같은 데 빠지지 않게

앞 세션에서 실제로 사고가 났거나 리뷰가 실측으로 뒤집은 것들이다.

| | 함정 |
|---|---|
| **회귀 스코프** | 🔴 파일명 접두사(`coupon-`)로 스코프를 잡아 **쿠폰을 만지는 다른 이름의 스펙을 마지막까지 놓쳤다**(`deferred-approval-checkout.spec.ts`). **디렉터리 전체**로 잡을 것 |
| **테스트 정직성** | 이 브랜치의 반복 실패 모드. 「빨간 목록」에서 출발한 분류는 **공허하게 통과하는 테스트를 구조적으로 못 찾는다**. 계약을 바꿀 때 기존 단언이 여전히 «무엇»을 지키는지 개별 확인할 것 |
| **플랜 결함** | 플랜의 예시 코드를 예시 테스트에 **실행해 보지 않아** 자기모순이 통과했다(참조 구현을 붙이면 그 파일의 테스트가 실패했다). 구현자가 조용히 한쪽으로 맞췄다가 결함이 됐다 |
| **스펙 결함** | 최종 리뷰의 Critical 은 **스펙 결함이 먼저였다** — §6.1 이 세 강제 자리를 「그 한 장의 만료」로만 서술해 **정책 `starts_at` 강제를 빠뜨렸고**, 구현은 스펙을 충실히 따랐다. 지금은 `hasPolicyStarted` 로 분기 «밖»에서 검사한다(고치지 말 것) |
| **어휘 가드** | `coupon-vocabulary-drift.spec.ts` 는 2값 `AutoIssueTrigger` 만 앵커한다 — **5값 `IssueTrigger` 는 안 본다.** 「어휘 늘리면 가드가 잡는다」는 거짓 |
| **모델 주석** | 형제 모델 3개(`coupon-event.ts:20`·`coupon-event-item.ts:15`·`promotion-meta.ts:25`)의 「DML DSL 이 partial 을 못 쓴다」는 **설치된 SDK 기준으로 거짓**이다(`transformIndexWhere` 가 자동 주입). `coupon-grant.ts` 는 교정됐고 나머지는 안 고쳤다 |
| **`grants.ts` 무의존성** | 의도적으로 의존성이 없다(`service.ts` 의 타입 import 하나뿐). `validity.ts` 를 import 하지 말 것 — 순환이 된다. `toDate` 중복은 그래서 **의도된 것**이다 |
| **워크플로 훅** | `completeCartWorkflow.hooks.validate` 는 워크플로당 핸들러 하나뿐이다. 새로 «등록»하면 부팅이 죽는다 — 기존 핸들러 «안에서» 고칠 것 |
| **통합 스펙** | `.rejects.toThrow()` 금지 — 워크플로 엔진을 거친 에러는 프로토타입을 잃어 `Error` 인스턴스가 아니다. `try/catch` + 메시지 검사로 |
| **Bash cwd** | 도구 호출 간 작업 디렉터리가 «유지»된다. `cd apps/admin-web` 이 새어 admin-web 의 `package.json` 을 루트로 착각한 적이 있다 |

---

## 7. 미답 질문

- 🔴 **스펙 §11-2: 전액 환불이 `order.canceled` 없이 끝나는 경로가 있는가?**
  A2 복구 구독자가 `order.canceled` 하나에 걸려 있다. 그 경로가 있으면 A2 종결은 **증명이 아니라 주장**이다.
  구현 «전»에 답했어야 할 질문인데 미답으로 남았다.
- **브라우저 확인 0회** — 새 발급 다이얼로그를 아무도 안 열어봤다. 이 브랜치에서 배선의 자동 커버리지가
  0인 유일한 표면이다(`.tsx` 는 admin-web jest 가 실행조차 안 한다).
- **백필 스크립트 자동 테스트 0** — `medusa exec` 진입점이라. 정합 판정은 `markGrantUsedIfUnused` 서비스
  메서드로 뽑아 통합 테스트가 덮지만, 스크립트 본체는 dry-run 숫자 육안 확인이 유일한 방어선이다.
- **스토어프론트 5파일** — `COUPON_NOT_STARTED` 매핑 + 3로케일. 그 트리는 CI 가 0개라, 리뷰어가 손으로
  키 실재를 확인한 게 검증의 전부다. (누락돼도 거절 동작 자체는 정상 — 문구만 일반화된다)

---

## 8. 이월 마이너 29건

전체 리뷰가 「머지 전 필수」로 뽑은 4건은 이미 수정 웨이브에 들어갔다. 남은 29건은 전부 런타임 영향이
없거나 의도된 것이고, 갈래는 이렇다:

- **주석·문서 드리프트 5** (예: `grants.ts` 가 소비자를 「5곳」이라 적고 4개만 나열)
- **테스트 형태 nit 5** (예: 무기한 2장의 타이브레이크 전용 케이스 없음)
- **중복·스타일 5** (`toDate` 중복은 **의도됨** — §6 참조)
- **성능·UX 5** (예: 다이얼로그 조회 루프가 순차 — 30명이면 최대 60회 왕복)
- **알려진·수용됨 9** (예: 레거시 링크전용 배정의 정책 폴백 — 회귀 가드 때문에 불가피, 문서화됨)

지금 손대야 할 것은 없다. 다음에 이 도메인을 만질 때 함께 정리하면 된다.

---

## 9. 마무리 상태

- 브랜치는 **미푸시·미머지**다. 전체 브랜치 리뷰 → 수정 웨이브(13건) → 스코프 재리뷰까지 끝났고
  최종 판정은 **Ready to merge = Yes**(단 위 운영 선행조건 전제).
- 다음 행동은 셋 중 하나다: ① `develop` 로컬 머지 ② 푸시하고 PR ③ 그대로 두기.
  **A1·A2 를 이 브랜치에서 처리할 거라면 머지·PR 전에 하는 게 싸다.**
