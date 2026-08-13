# 검증 게이트 초록화 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `npm run type-check` 와 `npx jest` 를 develop 에서 에러 0 · 실패 0 으로 만들고, GitHub Actions 로 고정해 다시 빨개지지 않게 한다.

**Architecture:** 게이트가 빨간 원인은 코드 품질이 아니라 (1) 세 TS 설정이 서로 다른 파일 집합을 봐서 spec 이 어느 게이트에도 안 걸린 채 표류했고 (2) CI 에 게이트가 없어 아무도 막지 않았기 때문이다. 따라서 먼저 **게이트에 들어오지 말았어야 할 것을 스코프에서 걷어내고**, 남은 진짜 부채를 근본원인 그룹별로 해소한 뒤, **CI 로 0 을 고정**한다.

**Tech Stack:** TypeScript 5.x, Jest 29 + ts-jest 29.4.6, NestJS 11, GitHub Actions

## Global Constraints

- 기준선 커밋: `2fa3708dc` (develop). 이 계획의 모든 수치는 이 커밋 실측값이다.
- 기준선 실측: `type-check` 에러 **159건** (spec 127 / scripts 31 / 실코드 1), `jest` **22 suite 실패 · 62 test 실패** (392 통과, 86 skip).
- **프로덕션 코드는 고치지 않는다.** 조사 결과 22건 실패 전부가 spec·설정·레지스트리 문제이고 프로덕션 회귀는 0건이다. 프로덕션 코드를 고쳐야 할 근거가 새로 나오면 작업을 멈추고 보고한다.
- 각 Task 는 **수치가 줄었음을 명령 출력으로 증명**한 뒤 커밋한다. "고쳤다"는 주장만으로 넘어가지 않는다.
- 마이그레이션 0건, env 0건, 시크릿 0건. 배포 영향 없음 (CI 워크플로 추가 제외).
- 커밋 메시지는 한국어, Conventional Commits.

### 측정 명령 (전 Task 공통)

```bash
# 타입 에러 개수
npx tsc -p tsconfig.json --noEmit 2>&1 | grep -c "error TS"

# jest 실패 suite 개수
npx jest --silent 2>&1 | tail -5
```

> ⚠️ `tail` 로 자른 출력에 개수를 매기지 말 것. 반드시 `grep -c` 또는 jest 요약줄을 근거로 쓴다.

---

## 근본원인 요약 (조사 완료 — 재조사 불필요)

### type-check 159건

| 분류 | 건수 | 근본원인 |
|---|---|---|
| spec/test | 127 | `tsconfig.jest.json` 의 `isolatedModules: true` → ts-jest 가 **transpile-only**. spec 은 어느 게이트에서도 타입 검사를 안 받아 표류. 실증: `aggregate-then-sort.strategy.spec.ts` 는 tsc 에러 4건인데 jest 28 test 전부 PASS |
| scripts/일회성 | 31 | 죽은 일회성 마이그레이션 스크립트 + 오래 안 돌린 수동 테스트 스크립트 |
| 실서비스 코드 | 1 | `fulfillment/services/__support__/logistics-wiring.ts` — 테스트 지원 파일. 배포 코드 타입 에러는 **0건** |

`nest build` 가 초록인 이유: `tsconfig.build.json` 이 `**/*spec.ts` 를 제외한다.

### jest 22 suite

| 분류 | 건수 | 근본원인 |
|---|---|---|
| A. user-service DI 부패 | 10 | `Nest can't resolve dependencies`. 전용 config 로 돌려도 10/16 실패 → config 문제 아님, 스펙이 DI 그래프 변경을 못 따라감 |
| B. 프론트 spec 혼입 | 2 | 루트 jest `roots: apps/` 가 admin-web·wallet-web spec 까지 수집. `@tanstack/react-query` 미설치, `@packages/web-observability` 매핑 없음 |
| C. 외부 환경 요구 | 2 | `coupang-integration.spec.ts`(실 DB+목서버), `membership-api.itdoc.spec.ts`(전용 config). 다른 통합 spec 은 `REQUIRE_*_DB=1` 가드 컨벤션을 지키는데 이 둘만 무가드 |
| D. 개별 실패 | 8 | 아래 표 |

### D 분류 8건 — 개별 확정 진단

| spec | 근본원인 | 성격 |
|---|---|---|
| `sales-order/.../partial-cancellation-refund-calculator.spec.ts` | 구현 결과 타입이 개명됨: `autoRefundable`→`manualRequired`(의미 반전), `refundAmount`→`refundEstimateAmount`. 스펙은 옛 이름을 assert → `undefined` | 스펙 낡음 (tsc 24건과 **동일 원인**) |
| `channel-adapter/.../medusa.client.spec.ts` | 구현이 `allow_backorder: false` 를 추가 발행. 스펙 기대값이 정확일치라 실패 | 스펙 낡음 |
| `wallet/.../cash-receipts.service.spec.ts` | 구현 `findIntentOrThrow` 에 `UUID_RE` 가드 추가. 스펙 픽스처가 `intent-001` 이라 모든 가드 테스트가 NotFound 로 먼저 튕김 | 스펙 낡음 (픽스처) |
| `core/.../product-sku-mapping.service.spec.ts` | 구현이 tx 안에서 `.select()` 호출 추가. 스펙의 수제 trx 목에 `select` 미구현 → `trx.select is not a function` | 스펙 낡음 (목) |
| `channel-adapter/scripts/lib/pim-snapshot-builder.spec.ts` | 구현 쿼리 형태 변경. 목이 `Unexpected query` throw | 스펙 낡음 (목) |
| `channel-adapter/.../shipment-dispatch-translations.spec.ts` | **시한폭탄.** 스펙이 `dispatchedAt: '2026-07-14…'` 를 하드코딩. 구현은 "배송일은 30일 전부터 현재까지" 검증 → 벽시계가 30일을 넘기며 자동 실패 시작 | 시간 의존 |
| `scripts/security/idor-reviewed.spec.ts` | **감지기가 제대로 작동 중.** 감사 레지스트리의 evidence 좌표(`business-licenses.service.ts:136`, `:351`)가 코드 이동으로 어긋남 | 레지스트리 갱신 필요 |
| `core/src/app.controller.spec.ts` | Nest 스캐폴딩 잔재. `getHello is not a function` | 죽은 스펙 |

---

## File Structure

**설정 (Task 1·2·3):**
- Modify: `package.json` — 루트 jest `roots`/`testPathIgnorePatterns`, `test:wallet-web` 스크립트 추가
- Modify: `apps/channel-adapter/coupang-integration.spec.ts` — 환경 가드
- Delete: `apps/core/src/app.controller.spec.ts`

**D 분류 개별 수정 (Task 4~9):** 각 spec 파일 1개씩, 프로덕션 코드 무변경

**A 분류 (Task 10):** `apps/user-service/src/api/**/*.spec.ts` 10개

**타입 에러 (Task 11~13):** spec 127건 / scripts 31건 / `__support__` 1건

**CI (Task 14):** Create `.github/workflows/verification-gates.yml`

---

## Task 1: 루트 jest 수집 범위에서 프론트 앱 제외

**Files:**
- Modify: `package.json` (jest 설정 블록, `test:*` 스크립트)

**Interfaces:**
- Produces: 루트 `npx jest` 는 백엔드(apps 중 nest 앱 · libs · packages · scripts)만 수집한다. 프론트는 전용 스크립트로만 돈다.

**근본원인:** 루트 jest `roots` 에 `<rootDir>/apps/` 가 통째로 들어있어 `apps/admin-web` · `apps/wallet-web` 의 spec 까지 수집된다. 그런데 이 두 앱의 의존성은 각자의 `node_modules` 에 있고 그건 `modulePathIgnorePatterns` 로 무시된다. 수집은 하는데 해석은 못 하는 모순.

- [ ] **Step 1: 현재 실패 2건을 재현해 근거를 남긴다**

```bash
npx jest --silent apps/admin-web/src/lib/services/products/queries.spec.ts apps/wallet-web/app/api/payment-intents/
```

기대 출력: 2 suite 실패. `Cannot find module '@tanstack/react-query'` 와 `Cannot find module '@packages/web-observability'`.

- [ ] **Step 2: 루트 jest `testPathIgnorePatterns` 에 프론트 앱을 추가한다**

`package.json` 의 `jest.testPathIgnorePatterns` 배열을 다음으로 교체:

```json
"testPathIgnorePatterns": [
  "/node_modules/",
  "/e2e/membership-cancel/",
  "<rootDir>/apps/admin-web/",
  "<rootDir>/apps/wallet-web/"
]
```

- [ ] **Step 3: wallet-web 전용 테스트 스크립트를 추가한다**

`apps/admin-web` 에는 이미 `test:admin-web` 이 있으나 `apps/wallet-web` 에는 없다. `package.json` scripts 에 `test:admin-web` 바로 아래로 추가:

```json
"test:wallet-web": "jest --roots ./apps/wallet-web --transform '{\"^.+\\\\.(t|j)sx?$\":[\"ts-jest\",{\"tsconfig\":\"apps/wallet-web/tsconfig.json\"}]}'",
```

- [ ] **Step 4: 루트 실행에서 두 spec 이 더 이상 수집되지 않음을 확인한다**

```bash
npx jest --listTests 2>&1 | grep -cE "admin-web|wallet-web"
```

기대 출력: `0`

- [ ] **Step 5: 전체 jest 를 돌려 실패가 22 → 20 으로 줄었음을 확인한다**

```bash
npx jest --silent 2>&1 | tail -5
```

기대: `Test Suites: 20 failed, ... ` — **20 이 아니면 멈추고 원인을 조사한다.**

- [ ] **Step 6: 커밋**

```bash
git add package.json
git commit -m "test: 루트 jest 수집 범위에서 프론트 앱을 분리한다

루트 jest 가 admin-web·wallet-web spec 을 수집하지만 두 앱의 의존성은
각자의 node_modules 에 있고 그건 modulePathIgnorePatterns 로 무시된다.
수집은 하는데 해석은 못 하는 모순이라 항상 2 suite 가 빨갛다.

프론트는 전용 스크립트로만 돌린다. wallet-web 은 스크립트가 없어 신설."
```

---

## Task 2: 외부 환경을 요구하는 spec 에 가드를 적용한다

**Files:**
- Modify: `apps/channel-adapter/coupang-integration.spec.ts:1-30`
- Modify: `package.json` (jest `testPathIgnorePatterns`, scripts)

**Interfaces:**
- Consumes: Task 1 이 정리한 `testPathIgnorePatterns` 배열
- Produces: `REQUIRE_COUPANG_INTEGRATION=1` 이 없으면 coupang 통합 spec 은 skip 된다

**근본원인:** 이 저장소에는 이미 `REQUIRE_*_DB=1` 환경 가드 컨벤션이 있다 (`test:channel-dispatch:integration`, `test:bulk-session:integration` 등 package.json 에 8개). `coupang-integration.spec.ts` 만 이 컨벤션 밖이라 실 DB·목서버 없이 항상 실패한다. `membership-api.itdoc.spec.ts` 는 전용 config(`test:membership`)로 돌게 설계됐는데 루트 실행에 딸려 들어온다.

- [ ] **Step 1: coupang 통합 spec 상단에 환경 가드를 넣는다**

`apps/channel-adapter/coupang-integration.spec.ts` 의 `describe(` 로 시작하는 최상위 블록을 찾아, import 문 바로 아래에 다음을 추가하고 최상위 `describe` 를 `describeIntegration` 으로 바꾼다:

```typescript
// 실 PostgreSQL + adapter-mock 서버가 떠 있어야 도는 통합 테스트다.
// 저장소 컨벤션(REQUIRE_*_DB=1)에 맞춰 명시 옵트인일 때만 실행한다.
// 실행: npm run test:coupang:integration
const describeIntegration = process.env.REQUIRE_COUPANG_INTEGRATION === '1' ? describe : describe.skip;
```

- [ ] **Step 2: 전용 실행 스크립트를 추가한다**

`package.json` scripts 에 `test:channel-dispatch:integration` 옆으로 추가:

```json
"test:coupang:integration": "REQUIRE_COUPANG_INTEGRATION=1 jest --runInBand apps/channel-adapter/coupang-integration.spec.ts",
```

- [ ] **Step 3: itdoc spec 을 루트 실행에서 제외한다**

Task 1 에서 만든 `testPathIgnorePatterns` 배열에 한 줄 추가:

```json
"<rootDir>/apps/membership/test/membership-api.itdoc.spec.ts"
```

- [ ] **Step 4: 가드가 걸렸는지 확인한다**

```bash
npx jest --silent apps/channel-adapter/coupang-integration.spec.ts 2>&1 | tail -4
```

기대: `Test Suites: 1 skipped` (실패 0)

- [ ] **Step 5: 전체 jest 가 20 → 18 로 줄었음을 확인한다**

```bash
npx jest --silent 2>&1 | tail -5
```

기대: `Test Suites: 18 failed, ...`

- [ ] **Step 6: 커밋**

```bash
git add package.json apps/channel-adapter/coupang-integration.spec.ts
git commit -m "test: 외부 환경을 요구하는 spec 을 옵트인 가드 뒤로 옮긴다

coupang 통합 spec 은 실 DB+목서버가 필요한데 저장소의 REQUIRE_*_DB=1
컨벤션 밖에 있어 기본 실행에서 항상 빨갰다. itdoc spec 은 전용 config
로 돌게 설계됐는데 루트 실행에 딸려 들어왔다."
```

---

## Task 3: 죽은 스캐폴딩 스펙을 삭제한다

**Files:**
- Delete: `apps/core/src/app.controller.spec.ts`

**근본원인:** `nest new` 가 만든 잔재. `expect(appController.getHello()).toBe('Hello World!')` 인데 `AppController` 에 `getHello` 가 없다. 검증하는 게 없다.

- [ ] **Step 1: 정말 죽었는지 확인한다 — getHello 가 실제로 없어야 한다**

```bash
grep -rn "getHello" apps/core/src/
```

기대: `apps/core/src/app.controller.spec.ts` 에서만 나온다. **다른 파일에서도 나오면 삭제하지 말고 멈춘다.**

- [ ] **Step 2: 삭제한다**

```bash
git rm apps/core/src/app.controller.spec.ts
```

- [ ] **Step 3: 17 로 줄었음을 확인한다**

```bash
npx jest --silent 2>&1 | tail -5
```

기대: `Test Suites: 17 failed, ...`

- [ ] **Step 4: 커밋**

```bash
git commit -m "test: nest 스캐폴딩 잔재 app.controller.spec.ts 를 삭제한다

AppController 에 getHello 가 없다. 검증하는 대상이 없는 스펙이다."
```

---

## Task 4: 시한폭탄 스펙을 상대 시각으로 고친다

**Files:**
- Modify: `apps/channel-adapter/src/services/shipment-dispatch-translations.spec.ts:5-28`

**근본원인:** 스펙이 `dispatchedAt: '2026-07-14T00:00:00.000Z'` 를 하드코딩한다. 구현(`naver-smartstore.adapter.ts`)은 "배송일은 30일 전부터 현재까지만 가능합니다" 를 zod 로 검증한다. 작성 시점엔 통과했지만 벽시계가 30일을 넘기면서 자동으로 빨개졌다. **날짜를 갱신하는 건 폭탄을 다시 심는 것이다 — 상대 시각으로 바꿔야 한다.**

- [ ] **Step 1: 현재 실패 원인을 눈으로 확인한다**

```bash
npx jest apps/channel-adapter/src/services/shipment-dispatch-translations.spec.ts -t "without an internal-ID fallback" 2>&1 | grep -A 10 "네이버 발송처리 실패"
```

기대: `"message": "배송일은 30일 전부터 현재까지만 가능합니다"`

- [ ] **Step 2: 하드코딩 날짜를 상대 시각으로 교체한다**

`dispatchedAt: '2026-07-14T00:00:00.000Z',` 를 다음으로 바꾼다:

```typescript
      // 구현이 "30일 전 ~ 현재" 창을 검증한다. 절대 날짜를 박으면 벽시계가
      // 창을 벗어나는 순간 스펙이 저절로 빨개진다 (실제로 그렇게 됐다).
      dispatchedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
```

- [ ] **Step 3: 통과를 확인한다**

```bash
npx jest --silent apps/channel-adapter/src/services/shipment-dispatch-translations.spec.ts 2>&1 | tail -5
```

기대: `Test Suites: 1 passed`, `Tests: 6 passed`

- [ ] **Step 4: 같은 폭탄이 다른 곳에도 있는지 훑는다**

```bash
grep -rn "20[0-9][0-9]-[0-9][0-9]-[0-9][0-9]T" apps/channel-adapter/src --include=*.spec.ts | head -20
```

찾은 것 중 "N일 이내" 류 검증을 타는 것이 있으면 같은 방식으로 고치고, 없으면 그대로 둔다. (단순 픽스처 날짜는 폭탄이 아니다.)

- [ ] **Step 5: 커밋**

```bash
git add apps/channel-adapter/src/services/shipment-dispatch-translations.spec.ts
git commit -m "test: 네이버 발송 스펙의 하드코딩 날짜를 상대 시각으로 바꾼다

구현이 배송일을 '30일 전~현재' 로 검증하는데 스펙은 절대 날짜를 박아
뒀다. 벽시계가 창을 벗어나며 저절로 빨개진 시한폭탄이었다. 날짜를
갱신하면 폭탄을 다시 심는 셈이라 상대 시각으로 바꾼다."
```

---

## Task 5: 부분취소 환불 계산기 스펙을 현재 API 로 재작성한다

**Files:**
- Modify: `apps/core/src/modules/sales-order/services/partial-cancellation-refund-calculator.spec.ts` (전면)
- Read only: `apps/core/src/modules/sales-order/services/partial-cancellation-refund-calculator.ts:36-180`

**근본원인:** 구현의 결과 타입이 `PartialCancellationRefundResult = { refundEstimateAmount, breakdown, manualRequired, manualReason, warnings }` 인데 스펙은 `result.autoRefundable` / `result.refundAmount` 를 assert 한다. `autoRefundable` → `manualRequired` 는 **의미가 반전**됐다. 이 한 파일이 tsc 에러 24건 · jest 실패의 최대 덩어리다.

- [ ] **Step 1: 구현의 현재 계약을 정확히 읽는다**

```bash
sed -n '36,100p' apps/core/src/modules/sales-order/services/partial-cancellation-refund-calculator.ts
```

`RefundBreakdown`, `ManualRefundReason`, `PartialCancellationRefundInput`, `PartialCancellationRefundResult` 네 타입의 필드명·타입을 그대로 받아적는다. 추측하지 않는다.

- [ ] **Step 2: 스펙의 기대값을 새 계약으로 옮긴다**

기계적 치환이지만 **의미 반전에 주의한다**:

| 옛 스펙 | 새 스펙 |
|---|---|
| `expect(result.autoRefundable).toBe(false)` | `expect(result.manualRequired).toBe(true)` |
| `expect(result.autoRefundable).toBe(true)` | `expect(result.manualRequired).toBe(false)` |
| `expect(result.refundAmount).toBe(N)` | `expect(result.refundEstimateAmount).toBe(N)` |

`manualReason` · `breakdown` 은 이름이 같으므로 그대로 둔다. 입력 객체 필드도 `PartialCancellationRefundInput` 과 대조해 맞춘다.

- [ ] **Step 3: 타입 에러가 이 파일에서 사라졌는지 확인한다**

```bash
npx tsc -p tsconfig.json --noEmit 2>&1 | grep -c "partial-cancellation-refund-calculator.spec"
```

기대: `0` (기준선 24)

- [ ] **Step 4: 테스트가 통과하는지 확인한다**

```bash
npx jest --silent apps/core/src/modules/sales-order/services/partial-cancellation-refund-calculator.spec.ts 2>&1 | tail -5
```

기대: `Test Suites: 1 passed`

> 만약 기대 **금액**이 안 맞으면 (이름이 아니라 값이 틀리면) 그건 스펙 낡음이 아니라 계산 로직 변경이다. **멈추고 보고한다** — 프로덕션 회귀일 수 있다.

- [ ] **Step 5: 커밋**

```bash
git add apps/core/src/modules/sales-order/services/partial-cancellation-refund-calculator.spec.ts
git commit -m "test: 부분취소 환불 계산기 스펙을 현재 결과 타입으로 옮긴다

구현이 autoRefundable→manualRequired(의미 반전), refundAmount→
refundEstimateAmount 로 개명됐는데 스펙이 안 따라와 undefined 를
assert 하고 있었다. 타입 에러 24건도 같은 원인."
```

---

## Task 6: medusa.client 스펙 기대값에 allow_backorder 를 반영한다

**Files:**
- Modify: `apps/channel-adapter/src/adapters/medusa/medusa.client.spec.ts:748-750`, `:849-851`

**근본원인:** 구현이 variant 업데이트에 `allow_backorder: false` 를 함께 보내도록 바뀌었는데, 스펙은 `toHaveBeenCalledWith` 정확일치라 실패한다.

- [ ] **Step 1: 구현이 정말 그렇게 보내는지 확인한다 (기대값을 맞추기 전에 의도된 변경인지 판정)**

```bash
grep -n "allow_backorder" apps/channel-adapter/src/adapters/medusa/medusa.client.ts
```

기대: 구현에 `allow_backorder: false` 를 명시적으로 넣는 코드가 있고, 주석이나 커밋으로 의도가 설명된다. 확인:

```bash
git log --oneline -3 -S"allow_backorder" -- apps/channel-adapter/src/adapters/medusa/medusa.client.ts
```

**의도된 변경이 아니면 멈추고 보고한다.**

- [ ] **Step 2: 두 기대값에 필드를 추가한다**

`:749` 를:

```typescript
      update: [{ id: 'variant_medusa_1', manage_inventory: false, allow_backorder: false }],
```

`:850` 을:

```typescript
      update: [{ id: 'variant_medusa_1', manage_inventory: true, allow_backorder: false }],
```

- [ ] **Step 3: 통과 확인**

```bash
npx jest --silent apps/channel-adapter/src/adapters/medusa/medusa.client.spec.ts 2>&1 | tail -5
```

기대: `Test Suites: 1 passed`

- [ ] **Step 4: 커밋**

```bash
git add apps/channel-adapter/src/adapters/medusa/medusa.client.spec.ts
git commit -m "test: medusa variant 업데이트 기대값에 allow_backorder 를 반영한다

구현이 manage_inventory 와 함께 allow_backorder:false 를 보내도록
바뀌었는데 스펙이 정확일치라 빨갰다."
```

---

## Task 7: cash-receipts 스펙 픽스처를 UUID 로 바꾼다

**Files:**
- Modify: `apps/wallet/src/cash-receipts/cash-receipts.service.spec.ts` (픽스처 상수)
- Read only: `apps/wallet/src/cash-receipts/cash-receipts.service.ts:205-220`

**근본원인:** 구현 `findIntentOrThrow` 에 `if (!UUID_RE.test(intentId)) throw new NotFoundException(...)` 가드가 추가됐다. 스펙 픽스처가 `intent-001` 같은 비-UUID 라서 **모든 가드 테스트가 본론에 닿기 전에 NotFound 로 튕긴다.** 메모리에 "유일한 회귀 후보" 로 남아있던 항목인데, 조사 결과 회귀가 아니라 픽스처 낡음이다.

- [ ] **Step 1: 가드를 눈으로 확인한다**

```bash
sed -n '205,220p' apps/wallet/src/cash-receipts/cash-receipts.service.ts
```

기대: `UUID_RE.test(intentId)` 가 실패하면 `NOT_FOUND` 를 던진다.

- [ ] **Step 2: 스펙의 비-UUID 식별자를 찾는다**

```bash
grep -n "intent-001\|charge-001\|cr-001" apps/wallet/src/cash-receipts/cash-receipts.service.spec.ts
```

- [ ] **Step 3: 고정 UUID 상수로 교체한다**

파일 상단 픽스처 정의부에서 비-UUID 문자열을 고정 UUID 로 바꾼다. 랜덤 생성하지 말고 리터럴로 박아 재현 가능하게 둔다:

```typescript
const INTENT_ID = '11111111-1111-4111-8111-111111111111';
const CHARGE_ID = '22222222-2222-4222-8222-222222222222';
const RECEIPT_ID = '33333333-3333-4333-8333-333333333333';
```

기존 `'intent-001'` / `'charge-001'` / `'cr-001'` 문자열 리터럴을 전부 이 상수 참조로 치환한다. `DTO` 안의 intentId 도 포함한다.

- [ ] **Step 4: 통과 확인**

```bash
npx jest --silent apps/wallet/src/cash-receipts/cash-receipts.service.spec.ts 2>&1 | tail -5
```

기대: `Test Suites: 1 passed`

> UUID 로 바꾼 뒤에도 실패가 남으면 그건 픽스처 문제가 아니다. **멈추고 남은 실패의 원인을 따로 조사한다.**

- [ ] **Step 5: 커밋**

```bash
git add apps/wallet/src/cash-receipts/cash-receipts.service.spec.ts
git commit -m "test: cash-receipts 스펙 픽스처를 UUID 로 바꾼다

구현 findIntentOrThrow 에 UUID 형식 가드가 추가됐는데 스펙 픽스처가
intent-001 이라 모든 가드 테스트가 본론 전에 NotFound 로 튕겼다.
회귀가 아니라 픽스처 낡음."
```

---

## Task 8: 수제 트랜잭션 목 2건을 현재 호출에 맞춘다

**Files:**
- Modify: `apps/core/src/modules/product-matching/services/product-sku-mapping.service.spec.ts` (trx 목)
- Modify: `apps/channel-adapter/scripts/lib/pim-snapshot-builder.spec.ts:40-55` (쿼리 목)

**근본원인:** 두 스펙 모두 손으로 만든 목이 구현의 새 호출을 모른다.
- `product-sku-mapping`: 구현이 tx 안에서 `.select()` 를 부르는데 목에 `select` 가 없어 `trx.select is not a function`
- `pim-snapshot-builder`: 구현의 쿼리가 바뀌어 목이 `Unexpected query` 를 throw

- [ ] **Step 1: product-sku-mapping — 구현이 무엇을 부르는지 읽는다**

```bash
sed -n '256,285p' apps/core/src/modules/product-matching/services/product-sku-mapping.service.ts
```

`.select({...}).from(...).where(...)` 체인의 정확한 형태와 반환에 기대하는 행 모양을 받아적는다.

- [ ] **Step 2: 스펙의 trx 목에 select 체인을 추가한다**

스펙에서 trx 목을 만드는 곳을 찾아 (`grep -n "trx" apps/core/src/modules/product-matching/services/product-sku-mapping.service.spec.ts | head`), Step 1 에서 읽은 체인을 지원하도록 확장한다. 반환은 빈 배열이 기본이고, 링크를 기대하는 케이스만 행을 넣는다:

```typescript
      select: jest.fn().mockReturnValue({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockResolvedValue([]),
        }),
      }),
```

- [ ] **Step 3: product-sku-mapping 통과 확인**

```bash
npx jest --silent apps/core/src/modules/product-matching/services/product-sku-mapping.service.spec.ts 2>&1 | tail -5
```

기대: `Test Suites: 1 passed`

- [ ] **Step 4: pim-snapshot-builder — 목이 못 알아듣는 쿼리를 확인한다**

```bash
sed -n '40,60p' apps/channel-adapter/scripts/lib/pim-snapshot-builder.spec.ts
sed -n '20,60p' apps/channel-adapter/scripts/lib/pim-snapshot-builder.ts
```

목의 매칭 조건과 구현이 실제로 넘기는 sql 을 대조한다.

- [ ] **Step 5: 목의 매칭 조건을 현재 쿼리에 맞춘다**

`Unexpected query` 로 떨어지는 분기가 안 타도록 매칭 조건을 넓히거나 새 분기를 추가한다. **`throw` 를 지우지 말 것** — 그 throw 가 다음번 드리프트를 잡아주는 안전망이다.

- [ ] **Step 6: pim-snapshot-builder 통과 확인**

```bash
npx jest --silent apps/channel-adapter/scripts/lib/pim-snapshot-builder.spec.ts 2>&1 | tail -5
```

기대: `Test Suites: 1 passed`

- [ ] **Step 7: 커밋**

```bash
git add apps/core/src/modules/product-matching/services/product-sku-mapping.service.spec.ts apps/channel-adapter/scripts/lib/pim-snapshot-builder.spec.ts
git commit -m "test: 수제 트랜잭션 목을 구현의 현재 호출에 맞춘다

product-sku-mapping 은 구현이 tx 안에서 select 를 부르는데 목에 없어
trx.select is not a function 이었고, pim-snapshot-builder 는 쿼리 형태
변경으로 목이 Unexpected query 를 던졌다."
```

---

## Task 9: IDOR 감사 레지스트리의 좌표 드리프트를 갱신한다

**Files:**
- Modify: `scripts/security/idor-reviewed.ts` 또는 evidence 좌표를 담은 레지스트리 파일 (Step 1 에서 확정)
- Read only: `apps/user-service/src/api/business-licenses/business-licenses.service.ts`

**근본원인:** 이건 **스펙이 제대로 작동한 결과**다. `idor-reviewed.spec.ts` 는 감사 레지스트리에 적힌 evidence 좌표 ±5줄 안에 predicate 원문이 실제로 있는지 검사하는 드리프트 감지기다. `business-licenses.service.ts` 의 코드가 이동하면서 `:136` 과 `:351` 좌표가 어긋났다. 감지기를 끄면 안 되고 **좌표를 갱신**해야 한다.

관련 SoT: `docs/api-authz-audit-2026-08.md`

- [ ] **Step 1: 좌표가 어디에 적혀 있는지 찾는다**

```bash
grep -rn "business-licenses.service.ts" scripts/security/ | head
```

- [ ] **Step 2: predicate 원문이 지금 몇 번째 줄인지 실측한다**

레지스트리에 적힌 predicate 문자열 2개를 확인한 뒤:

```bash
grep -n "<predicate 원문 1>" apps/user-service/src/api/business-licenses/business-licenses.service.ts
grep -n "<predicate 원문 2>" apps/user-service/src/api/business-licenses/business-licenses.service.ts
```

- [ ] **Step 3: 좌표를 실측값으로 갱신한다**

`136` → 실측 줄번호, `351` → 실측 줄번호. **predicate 원문은 건드리지 않는다** — 원문이 바뀌었다면 그건 인가 로직이 바뀐 것이고, 좌표 갱신이 아니라 재심사 대상이다. 그 경우 멈추고 보고한다.

- [ ] **Step 4: 감지기가 초록인지 확인한다**

```bash
npx jest --silent scripts/security/idor-reviewed.spec.ts 2>&1 | tail -5
```

기대: `Test Suites: 1 passed`, `Tests: 6 passed`

- [ ] **Step 5: 커밋**

```bash
git add scripts/security/
git commit -m "chore(security): IDOR 감사 레지스트리의 evidence 좌표 드리프트를 갱신한다

business-licenses.service.ts 의 코드 이동으로 좌표가 어긋났다. 감지기가
설계대로 작동한 결과이므로 감지기가 아니라 좌표를 고친다."
```

---

## Task 10: user-service DI 스펙 부패 10건

**Files:**
- Modify: `apps/user-service/src/api/auth/auth.controller.spec.ts`, `auth.service.spec.ts`
- Modify: `apps/user-service/src/api/users/users.controller.spec.ts`, `users.service.spec.ts`
- Modify: `apps/user-service/src/api/shop/shop.controller.spec.ts`, `shop.service.spec.ts`
- Modify: `apps/user-service/src/api/admin/dormant/dormant.controller.spec.ts`, `dormant.service.spec.ts`
- Modify: `apps/user-service/src/api/admin/roles/roles.controller.spec.ts`, `roles.service.spec.ts`

**근본원인:** 전부 `Nest can't resolve dependencies of the X (?)`. 서비스·컨트롤러의 생성자 의존성이 늘었는데 `Test.createTestingModule({ providers: [...] })` 가 안 따라왔다. **전용 config(`npm run test:user-service`)로 돌려도 10/16 실패**하므로 config 문제가 아니라 스펙 부패다.

이 Task 는 10개 파일이지만 수정이 동일 패턴이라 한 Task 로 묶는다. 파일당 2~5분.

- [ ] **Step 1: 기준선을 잡는다**

```bash
npx jest --config ./apps/user-service/jest.config.js --silent 2>&1 | tail -5
```

기대: `Test Suites: 10 failed, 6 passed, 16 total`

- [ ] **Step 2: 실패 10건의 "없는 provider" 목록을 뽑는다**

```bash
npx jest --config ./apps/user-service/jest.config.js --silent 2>&1 | grep "Please make sure that the argument"
```

각 줄이 어떤 토큰이 빠졌는지 알려준다 (`ConfigService`, `DbService`, `RolesReader`, `RolesService`, `STREAM_PUBLISHER_users.events.v1` 등).

- [ ] **Step 3: 파일 하나씩, 빠진 provider 를 목으로 채운다**

각 spec 의 `Test.createTestingModule({...})` 의 `providers` 배열에 빠진 토큰을 추가한다. 값은 그 스펙이 실제로 쓰는 만큼만 목으로 채운다:

```typescript
        { provide: ConfigService, useValue: { get: jest.fn() } },
        { provide: DbService, useValue: { db: {}, run: jest.fn() } },
        { provide: 'STREAM_PUBLISHER_users.events.v1', useValue: { publish: jest.fn() } },
```

`should be defined` 만 있는 스펙은 그것만 통과하면 된다. **검증하는 게 `toBeDefined()` 뿐인 스펙은 살릴 가치를 따져보고, 의미 있는 assertion 이 하나도 없으면 삭제를 제안한다** (삭제는 임의로 하지 말고 보고 후 결정).

- [ ] **Step 4: 파일 하나 고칠 때마다 그 파일만 돌려 확인한다**

```bash
npx jest --config ./apps/user-service/jest.config.js --silent <파일경로> 2>&1 | tail -4
```

- [ ] **Step 5: 10개 전부 초록인지 확인한다**

```bash
npx jest --config ./apps/user-service/jest.config.js --silent 2>&1 | tail -5
```

기대: `Test Suites: 16 passed, 16 total`

- [ ] **Step 6: 루트 실행의 실패가 0 인지 확인한다**

Task 1~9 를 먼저 끝냈다면 A 분류 10건이 마지막 남은 실패였으므로, 여기서 `Test Suites: 0 failed` 가 나와야 한다. 0 이 아니면 남은 실패가 무엇인지 확인하고 보고한다.

```bash
npx jest --silent 2>&1 | tail -5
```

- [ ] **Step 7: 커밋**

```bash
git add apps/user-service/src/api/
git commit -m "test(user-service): DI 그래프 변경을 못 따라온 스펙 10건을 고친다

서비스·컨트롤러의 생성자 의존성이 늘었는데 TestingModule providers 가
안 따라왔다. 전용 config 로 돌려도 10/16 실패라 config 문제가 아니다."
```

---

## Task 11: spec 타입 에러를 0 으로 내린다

**Files:**
- Modify: 다수 `**/*.spec.ts` (Step 1 에서 목록 확정)

**근본원인:** ts-jest 가 transpile-only 라 spec 은 타입 검사를 안 받는다. 그래서 프로덕션 타입이 바뀌어도 spec 이 조용히 표류했다. Task 5·7·8 에서 이미 일부(최소 24건)가 해소된다.

- [ ] **Step 1: 현재 남은 spec 에러 목록을 뽑는다**

```bash
npx tsc -p tsconfig.json --noEmit 2>&1 | grep "error TS" | grep -E "\.spec\.ts|/test/" | sed 's/(.*//' | sort | uniq -c | sort -rn
```

- [ ] **Step 2: 파일 수가 많은 것부터 하나씩 고친다**

에러 유형별 대응:
- `TS2345` (인자 타입 불일치) / `TS2322` (대입 불가): 픽스처를 현재 타입에 맞춘다
- `TS2339` (없는 프로퍼티): 프로덕션에서 개명·삭제된 필드. 현재 이름으로 바꾼다
- `TS2554` (인자 개수): 시그니처가 바뀌었다. 호출을 맞춘다
- `TS2307` (모듈 없음): import 경로가 죽었다. 실제 위치를 찾아 고치거나, 대상이 삭제됐으면 그 스펙이 검증하던 게 사라진 것이므로 스펙 삭제를 검토한다

**`as any` / `@ts-expect-error` 로 덮지 않는다.** CLAUDE.md 의 타입 안전 규칙이 적용된다. 덮어야만 넘어가는 케이스가 나오면 멈추고 보고한다.

- [ ] **Step 3: 파일 하나 고칠 때마다 그 파일 에러가 0 인지 확인한다**

```bash
npx tsc -p tsconfig.json --noEmit 2>&1 | grep -c "<파일명>"
```

- [ ] **Step 4: 고친 spec 이 여전히 통과하는지 확인한다**

타입만 맞추고 런타임을 깨뜨리면 안 된다.

```bash
npx jest --silent <파일경로> 2>&1 | tail -4
```

- [ ] **Step 5: spec 에러 총계가 0 인지 확인한다**

```bash
npx tsc -p tsconfig.json --noEmit 2>&1 | grep "error TS" | grep -cE "\.spec\.ts|/test/"
```

기대: `0` (기준선 127)

- [ ] **Step 6: 커밋 — 파일 10개 단위로 나눠 커밋한다**

```bash
git add <파일들>
git commit -m "test: spec 타입 에러를 현재 프로덕션 타입에 맞춘다 (N/M)"
```

---

## Task 12: 일회성 스크립트 타입 에러 31건을 처분한다

**Files:**
- Delete: `apps/channel-adapter/scripts/legacy/migrate-pim-to-medusa.ts`, `migrate-pim-to-medusa-branch.ts`
- Delete: `apps/channel-adapter/test-coupang-single.ts`
- Delete: `scripts/medusa-db-migration/` (drizzle pull 산출물)
- Modify: `apps/channel-adapter/test-orchestration.ts`, `test-coupang-sync.ts`, `test-naver-sync.ts`
- Modify: `apps/channel-adapter/scripts/retry-failed.ts`, `apps/membership/drizzle/seed.ts`, `scripts/qa/seed-qa7-dev.ts`, `scripts/seed-data/seeders/04-membership.seeder.ts`

**근본원인:** PIM→Medusa 마이그레이션은 완료됐고 그 도구들이 남아 썩었다. 반면 `test-orchestration` 류는 아직 `package.json` 스크립트로 배선돼 있다 — 배선된 건 고치고, 안 된 건 지운다.

- [ ] **Step 1: 삭제 후보가 정말 참조되지 않는지 확인한다**

```bash
grep -rn "migrate-pim-to-medusa\|test-coupang-single\|medusa-db-migration" package.json docs scripts apps --include=*.json --include=*.md --include=*.ts | grep -v "^apps/channel-adapter/scripts/legacy/\|^scripts/medusa-db-migration/"
```

기대: 출력 없음. **한 줄이라도 나오면 그 파일은 삭제 대상에서 뺀다.**

- [ ] **Step 2: 죽은 마이그레이션 도구를 삭제한다**

```bash
git rm apps/channel-adapter/scripts/legacy/migrate-pim-to-medusa.ts apps/channel-adapter/scripts/legacy/migrate-pim-to-medusa-branch.ts apps/channel-adapter/test-coupang-single.ts
git rm -r scripts/medusa-db-migration
```

- [ ] **Step 3: 아직 배선된 스크립트를 고친다**

`test-orchestration.ts`(9건), `test-coupang-sync.ts`(4건), `test-naver-sync.ts`(2건) 는 `package.json` 의 `test:orchestration*` / `test:coupang:sync` / `test:naver-sync*` 로 배선돼 있다. Task 11 과 같은 유형별 대응으로 고친다.

> 이 셋은 실 API 를 때리는 수동 스크립트라 타입만 맞추고 실행 검증은 하지 않는다. 타입이 맞았다고 동작이 검증된 건 아님을 커밋 메시지에 남긴다.

- [ ] **Step 4: 시드·QA 스크립트를 고친다**

`retry-failed.ts`(1), `apps/membership/drizzle/seed.ts`(3), `scripts/qa/seed-qa7-dev.ts`(3), `scripts/seed-data/seeders/04-membership.seeder.ts`(1). `seed.ts` 의 `TS2339: Property 'users' does not exist` 는 membership 스키마에서 `users` 가 사라진 것이므로, 실제 테이블명을 스키마에서 확인해 맞춘다:

```bash
grep -n "export const" apps/membership/src/shared/schemas/entities/schema.ts | head -20
```

- [ ] **Step 5: scripts 에러가 0 인지 확인한다**

```bash
npx tsc -p tsconfig.json --noEmit 2>&1 | grep -c "error TS"
```

기대: `1` — 남는 건 Task 13 의 `logistics-wiring.ts` 뿐

- [ ] **Step 6: 커밋 (삭제와 수정을 나눈다)**

```bash
git commit -m "chore: 완료된 PIM→Medusa 마이그레이션 도구를 삭제한다"
git commit -m "fix(scripts): 배선된 수동 스크립트의 타입 에러를 고친다

타입만 맞췄다. 실 API 를 때리는 스크립트라 동작 검증은 안 했다."
```

---

## Task 13: 마지막 1건 — logistics-wiring.ts

**Files:**
- Modify: `apps/core/src/modules/fulfillment/services/__support__/logistics-wiring.ts:88`

**근본원인:** `DbService<A>` 를 `DbService<B>` 자리에 넘긴다. CLAUDE.md 의 cross-BC seam 규칙(`DbService<MergedSchema>` + `TxFor` 로 한 번만 좁히기)이 적용되는 지점인데 지켜지지 않았다.

- [ ] **Step 1: 에러 전문과 88행 문맥을 읽는다**

```bash
npx tsc -p tsconfig.json --noEmit 2>&1 | grep "logistics-wiring"
sed -n '75,100p' apps/core/src/modules/fulfillment/services/__support__/logistics-wiring.ts
```

- [ ] **Step 2: CLAUDE.md 의 seam 규칙대로 고친다**

`as any` / `asTx(tx as unknown)` 금지. 이 파일이 여러 스키마를 걸친다면 `DbService<MergedSchema>` 를 선언하고 `TxFor<MergedSchema>` 로 한 번만 좁힌다. 테스트 지원 파일이므로 프로덕션 시그니처를 바꾸지 않고 해결되는지 먼저 본다.

- [ ] **Step 3: 타입 에러 총계가 0 인지 확인한다**

```bash
npx tsc -p tsconfig.json --noEmit 2>&1 | grep -c "error TS"
```

기대: `0`

- [ ] **Step 4: 이 파일을 쓰는 스펙이 여전히 통과하는지 확인한다**

```bash
grep -rln "logistics-wiring" apps/core/src --include=*.spec.ts
npx jest --silent <나온 파일들> 2>&1 | tail -5
```

- [ ] **Step 5: 커밋**

```bash
git add apps/core/src/modules/fulfillment/services/__support__/logistics-wiring.ts
git commit -m "fix(core): logistics-wiring 의 DbService 스키마 불일치를 해소한다

type-check 에 남은 마지막 1건. CLAUDE.md 의 cross-BC seam 규칙대로
넓은 스키마를 선언하고 한 번만 좁힌다."
```

---

## Task 14: CI 게이트를 추가해 0 을 고정한다

**Files:**
- Create: `.github/workflows/verification-gates.yml`
- Modify: `CLAUDE.md` (게이트 문단)

**Interfaces:**
- Consumes: Task 1~13 이 만든 `type-check` 0 · `jest` 0 상태
- Produces: PR 에서 두 게이트가 자동으로 돈다. 이후 baseline 비교 절차가 불필요해진다

**근본원인:** `.github/workflows/` 에 `migration-safety.yml` 하나뿐이고 type-check 도 jest 도 안 돈다. 막는 게 없으니 계속 쌓였다. **이 Task 를 빼면 나머지 13개가 몇 주 안에 원상복구된다.**

- [ ] **Step 1: 워크플로를 만든다**

`.github/workflows/verification-gates.yml`:

```yaml
name: Verification gates

# type-check 와 jest 를 PR 게이트로 고정한다.
# 이 워크플로가 없던 동안 spec 타입 에러 127건 · jest 실패 22 suite 가
# 아무 저항 없이 쌓였다 (2026-08-13 조사). 초록을 되찾은 뒤 다시 썩지
# 않게 하는 게 목적이므로 flagging 이 아니라 *차단*이다.

on:
  pull_request:
    types: [opened, synchronize, reopened]
  push:
    branches: [develop]

concurrency:
  group: verification-gates-${{ github.ref }}
  cancel-in-progress: true

jobs:
  gates:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: npm

      - name: Install
        run: npm ci

      - name: Type check
        run: npm run type-check

      - name: Unit tests
        run: npx jest --ci --silent
```

- [ ] **Step 2: 로컬에서 두 명령이 정말 exit 0 인지 확인한다**

```bash
npm run type-check
echo "type-check exit=$?"
```

```bash
npx jest --ci --silent
echo "jest exit=$?"
```

**둘 다 `exit=0` 이 아니면 워크플로를 커밋하지 않는다.** 빨간 게이트를 CI 에 올리면 모두가 무시하기 시작하고, 그게 애초에 이 문제를 만든 경로다.

- [ ] **Step 3: CLAUDE.md 에 게이트를 문서화한다**

`## Code Quality` 절에 추가:

```markdown
### 검증 게이트

```bash
npm run type-check   # tsc --noEmit, spec 포함. 에러 0 이 기준선이다
npx jest             # 전체 유닛 테스트. 실패 0 이 기준선이다
```

두 명령 모두 **0 이 정상**이다. PR 에서 `.github/workflows/verification-gates.yml`
이 자동으로 돌며 차단한다. develop 과 비교해 "원래 깨져 있었다"를 확인하는
절차는 더 이상 필요 없다 — 빨간 건 이 PR 이 만든 것이다.

주의: `nest build` 는 `tsconfig.build.json` 이 `**/*spec.ts` 를 제외하므로
spec 타입 에러를 잡지 못한다. jest 도 `tsconfig.jest.json` 의
`isolatedModules: true` 때문에 transpile-only 라 타입을 검사하지 않는다.
**spec 의 타입을 지키는 건 `type-check` 뿐이다.**

프론트·통합 테스트는 별도 명령이다: `test:admin-web`, `test:wallet-web`,
`test:membership`, `test:coupang:integration`, `test:*:integration`.
```

- [ ] **Step 4: 커밋**

```bash
git add .github/workflows/verification-gates.yml CLAUDE.md
git commit -m "ci: type-check 와 jest 를 PR 게이트로 고정한다

게이트가 CI 에 없어서 spec 타입 에러 127건과 jest 실패 22 suite 가
저항 없이 쌓였다. 초록을 되찾았으니 다시 썩지 않게 차단한다."
```

---

## 최종 검증

- [ ] **type-check 0**

```bash
npm run type-check
echo "exit=$?"
```

기대: `exit=0`

- [ ] **jest 0**

```bash
npx jest --silent 2>&1 | tail -5
```

기대: `Test Suites: ... 0 failed`, `Tests: ... 0 failed`

- [ ] **빌드가 여전히 초록**

```bash
npm run build:core
echo "exit=$?"
```

기대: `exit=0`

- [ ] **분리한 테스트들이 각자 돌아간다**

```bash
npm run test:user-service
npm run test:admin-web
```

- [ ] **PR 을 연다**

```bash
gh pr create --base develop --title "chore: 검증 게이트를 초록으로 되돌리고 CI 로 고정한다" --body "..."
```

---

## 배포 영향

- 마이그레이션 **0건**, env **0건**, 시크릿 **0건**
- 프로덕션 코드 변경 **0건** (Task 13 의 `__support__` 파일은 테스트 지원)
- 배포 순서 제약 없음. CI 워크플로만 머지 즉시 발효
