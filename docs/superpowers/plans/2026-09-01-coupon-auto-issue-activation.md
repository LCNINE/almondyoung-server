# 자동발급 개통 (P7) — 실행 플랜

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 발급 시점의 룰 평가를 «고객 고유 / 카트 문맥 / 그 외» 세 부류로 명시하고, 분류표 밖 속성을 만나면 **발급을 거부**(fail-closed)한다. 그리고 자동발급이 실제로 도는 동안 실패가 조용히 쌓이지 않도록 재구동 지연(`7-2`)과 관측(`7-4`)을 붙인다.

**Architecture:** 판정은 컨테이너를 모르는 순수 함수 하나(`modules/promotion-meta/issuance-rules.ts`)로 뽑고, 오늘 `meetsGroupRule` 을 부르는 **6곳 + 인라인 사본 1곳** 전부가 그 함수를 부른다. 분류표는 닫혀 있으며, 엔진이 ORDER 스코프로 노출하는 속성이 분류표를 벗어나면 **유닛 스펙이 CI 에서 빨개진다**(프로덕션에서 조용히 fail-closed 되기 전에). channel-adapter 쪽은 발급 결과를 prom-client 카운터로 세고, 실패 inbox 행을 15분마다 한 번 되살린다(마커로 1회 제한).

**Tech Stack:** Medusa v2 (커스텀 라우트 · 모듈 순수 함수) · NestJS(channel-adapter, `@nestjs/schedule` · drizzle) · prom-client · Jest

**Spec:** 이 플랜에는 별도 설계 문서가 없다. 결정의 정본은 두 곳이며, 어긋나면 앞이 맞다:
1. 이슈 [#488](https://github.com/LCNINE/almondyoung-server/issues/488) 「2026-08-31 개통 전 결정」 절의 **`1-5`** 항목 (분류표·fail-closed 의 근거)
2. `docs/superpowers/plans/2026-08-29-coupon-domain-master-plan.md` 의 «해결된 설계 질문» 인용 블록 + 「결정 6건 확정」 표

---

## Global Constraints

- **분류표는 닫혀 있다. 재조사하지 않는다** (2026-08-31 결정, 로컬 실측 완료):

  | 종류 | 속성 | 발급 시점 |
  |---|---|---|
  | **고객 고유** | `customer.groups.id` (**operator `in` 만**) | 평가한다 |
  | **카트 문맥** | `region.id` · `shipping_address.country_code` · `sales_channel_id` · `currency_code` · `subtotal` | **의도적으로 무시**한다 |
  | **그 외 전부** | — | **fail-closed** — 발급 skip + 로그 |

- **fail-closed 의 근거는 «네이티브 대시보드가 만들 수 있다»가 아니다.** 네이티브 대시보드를 쓰지 않는 것이 우리 원칙이므로 그 논거는 성립하지 않는다. 옳은 근거는 **`N5`** — 엔진이 지원하는 조건을 우리 화면이 안 만드는 것은 **admin-web 의 기능 미비**이고 언젠가 채워진다. 그날 발급 로직이 준비돼 있지 않으면 그 순간부터 조건을 무시한 발급이 조용히 시작된다. 코드 주석에도 이 근거를 적는다.
- **`subtotal` 은 엔진이 어드민에 노출하지 않는데 우리 폼이 만드는 값**이라(`build-create-promotion-payload.ts:77-84`) 분류표에 **명시적으로** 넣는다. 빼면 모든 최소주문금액 쿠폰이 fail-closed 로 떨어진다.
- **fail-closed 는 발급 3경로 + 표시 3경로 전부에 적용한다.** 표시만 fail-open 이면 「발급받기」 버튼이 보이는데 누르면 거부되는 상태가 된다. 이미 **발급된** 쿠폰 목록(`assigned`)은 원래 `meetsGroupRule` 을 타지 않으므로 보유 쿠폰이 사라지는 회귀는 없다.
- **`7-3`(발급 계약이 3서비스에 새는 얕은 seam)은 이번에 하지 않는다.** 2026-08-31 결정 5 로 **별도 트랙**이다. 이 플랜은 channel-adapter 를 여전히 「트리거만 넘기는 얇은 호출자」로 두고, 계약 패키지를 만들지 않는다.
- **`COUPON_AUTO_ISSUE_ENABLED` 플립은 이 PR 에 없다.** 순서가 `P7 → 리허설 2차 → A5 개통` 이라, 플립을 코드에 담으면 머지·배포가 곧 개통이 돼 리허설 2차를 건너뛴다. 플립 절차는 아래 「배포 (플랜 밖, 사람이 한다)」에만 적는다.
- **마이그레이션 0 · 시크릿 0 · env 0.** 어느 태스크도 스키마를 건드리지 않는다.
- **판정 로직은 `.ts` 순수 함수에 둔다.** Medusa 유닛 러너가 `**/src/**/__tests__/**/*.unit.spec.ts` 만 매치하므로, 라우트 핸들러 클로저 안에 있는 분기는 **테스트가 실행조차 되지 않는다**. admin-web 도 같다 — jest transform 이 `^.+\.(t|j)s$` 라 `.tsx` 안의 로직은 검증 대상 밖이다.
- **`@packages/*` 를 `apps/medusa` 에서 import 하지 않는다.** Medusa 빌드에 번들러가 없어 런타임에 해석되지 않는다.
- **고객 대면 응답에는 새 `reason` 어휘를 만들지 않는다.** 스토어프론트가 닫힌 집합으로 읽는다(`coupons/claim/page.tsx:35-42`, `checkout/.../discount.tsx:36-38`, `coupon-claim-button.tsx:15-39`). 분류표 밖 룰도 고객에게는 기존 `COUPON_GROUP_RESTRICTED` / `group_restricted` 로 접는다. **어드민에게는 반대로 구별해 보여준다**(`unsupported_rule`) — 고쳐야 할 사람이 어드민 쪽이기 때문이다.
- 브랜치: `feat/coupon-auto-issue-activation` (이미 생성됨, `develop` `2693e1bf5` 위).

### 이 값을 읽는 소비자 (P1 교훈 — 쓰기 경로만 세면 Critical 이 난다)

| 값 | 쓰는 곳 | **읽는 곳** |
|---|---|---|
| `meetsGroupRule` | `admin/promotions/helpers.ts:161` | 발급 2 (`issue-coupons`, `customers/[id]/promotions`) + 표시 3 (`coupons/preview`, `events/[slug]`, `me/promotions` ×2 호출) — **총 6 호출** |
| 그룹 룰 인라인 사본 | — | `store/customers/me/promotions/[id]/claim/route.ts:68-81` (**7번째 자리**. `meetsGroupRule` grep 으로는 안 잡힌다) |
| `skipped[].reason` | `customers/[id]/promotions/route.ts`, `issue-coupons/route.ts` | **admin-web** `coupon-assign-dialog.tsx:21-30`(라벨 맵, 없는 값은 «발급할 수 없습니다» 로 뭉갬) · channel-adapter `medusa.client.ts:2404`(길이만 셈) |
| `preview` 의 `reason` | `coupons/preview/route.ts` | storefront `coupons/claim/page.tsx:35-75` (닫힌 집합) |
| `events` 의 `reason` | `events/[slug]/route.ts` | storefront `coupon-claim-button.tsx:15-39` (닫힌 집합) |

### 검증 명령 (전 태스크 공통)

⚠️ **플랜 문서마다 이 명령이 틀려 있었다.** 아래가 실제로 도는 것이다.

```bash
# medusa 유닛 (루트에서)
npm run test:medusa
# medusa 타입 — 선재 에러 3건이 기준선이다 (0 아님)
cd apps/medusa && npx tsc --noEmit
# medusa HTTP 통합 — 필터를 붙이지 않는다
scripts/local/run-medusa-integration.sh
# medusa 모듈 통합
scripts/local/run-medusa-integration.sh --modules
# 루트 (apps/medusa · web 제외)
npm run type-check && npx jest --maxWorkers=2
# admin-web (루트 게이트가 안 보는 트리)
npm run test:admin-web
cd apps/admin-web && npx tsc --noEmit
```

- 🔴 **`npm run test:integration:http` / `:modules` 를 직접 부르지 말 것.** 러너가 `DATABASE_URL` 이 아니라 `DB_HOST`/`DB_USERNAME`/`DB_PASSWORD`/`DB_PORT` 를 읽어서 전 스펙이 `SASL: client password must be a string` 로 죽는다. 「develop 이 원래 빨갛다」가 아니라 환경이 안 넘어간 것이다. 위 `run-medusa-integration.sh` 가 `.env` 의 `DATABASE_URL` 에서 넷을 파생시킨다.
- 🔴 **`npx jest` 는 OOM 이 난다** — 반드시 `--maxWorkers=2`.
- **storefront 는 이 플랜이 건드리지 않는다** — `web/**` 트리 게이트는 돌리지 않는다. 대신 위 Global Constraints 의 「새 `reason` 어휘를 만들지 않는다」가 그 트리를 안 건드리는 것의 근거이고, Task 3 의 스텝이 그것을 확인한다.

---

## File Structure

**신규**

| 파일 | 책임 |
|---|---|
| `apps/medusa/src/modules/promotion-meta/issuance-rules.ts` | 발급 시점 룰 분류표 + 평가 순수 함수. 컨테이너·워크플로를 모른다 |
| `apps/medusa/src/modules/promotion-meta/__tests__/issuance-rules.unit.spec.ts` | 위 함수의 유닛 스펙 |
| `apps/medusa/src/modules/promotion-meta/__tests__/issuance-rules-engine-drift.unit.spec.ts` | 엔진의 ORDER 스코프 속성이 분류표를 벗어나면 빨개지는 드리프트 가드 |
| `apps/medusa/integration-tests/http/coupon-issuance-rules.spec.ts` | 발급·표시 경로의 fail-closed 통합 스펙 |
| `apps/admin-web/src/features/mall/marketing/coupons/lib/skip-reason-labels.ts` | 발급 스킵 사유 → 한글 라벨 (`.tsx` 에서 빼낸다 — `.tsx` 는 jest transform 밖) |
| `apps/admin-web/src/features/mall/marketing/coupons/lib/skip-reason-labels.spec.ts` | 백엔드가 낼 수 있는 사유가 전부 라벨을 갖는지 |
| `apps/channel-adapter/src/observability/coupon-issue.metrics.ts` | prom-client 카운터 2 · 게이지 1 + 기록 함수 |
| `apps/channel-adapter/src/observability/coupon-issue.metrics.spec.ts` | 위 기록 함수의 유닛 스펙 |
| `apps/channel-adapter/src/services/coupon-issue-reconciliation.spec.ts` | 빠른 레인 유닛 스펙 (mock db) |
| `apps/channel-adapter/src/services/coupon-issue-reconciliation.integration.spec.ts` | 마커 1회성 — 실 Postgres (guarded) |

**수정 — apps/medusa**

| 파일 | 무엇을 |
|---|---|
| `src/api/admin/promotions/helpers.ts` | `meetsGroupRule` **삭제** |
| `src/api/admin/customers/[id]/issue-coupons/route.ts` | 평가기 도입 · 필터를 per-promo skip 사유로 · fail-closed 로그 |
| `src/api/admin/customers/[id]/promotions/route.ts` | 평가기 도입 · `unsupported_rule` 사유 · fail-closed 로그 |
| `src/api/store/customers/me/promotions/[id]/claim/route.ts` | 인라인 그룹 룰 사본 제거 → 평가기 |
| `src/api/store/coupons/preview/route.ts` | 평가기 · 비로그인 분기를 `requiresCustomerContext` 로 |
| `src/api/store/events/[slug]/route.ts` | 평가기 |
| `src/api/store/customers/me/promotions/route.ts` | 평가기 (2 호출) |

**수정 — 그 밖**

| 파일 | 무엇을 |
|---|---|
| `apps/admin-web/.../coupons/components/coupon-assign-dialog.tsx` | 라벨 맵을 `lib/skip-reason-labels.ts` 에서 import |
| `apps/channel-adapter/src/adapters/medusa/medusa.client.ts` | 발급 결과·실패를 메트릭으로 |
| `apps/channel-adapter/src/services/coupon-issue-reconciliation.service.ts` | 빠른 레인 크론 + 백로그 게이지 |
| `docs/superpowers/plans/2026-08-29-coupon-domain-master-plan.md` | 진행상황 (P7 + P4+P5 머지 상태 정정) |

---

## Task 1: 발급 시점 룰 평가 순수 함수

**Files:**
- Create: `apps/medusa/src/modules/promotion-meta/issuance-rules.ts`
- Test: `apps/medusa/src/modules/promotion-meta/__tests__/issuance-rules.unit.spec.ts`
- Test: `apps/medusa/src/modules/promotion-meta/__tests__/issuance-rules-engine-drift.unit.spec.ts`

**Interfaces:**
- Consumes: 없음 (이 플랜의 첫 태스크)
- Produces:
  - `evaluateIssuanceRules(rules, customerGroupIds): IssuanceEligibility`
  - `isIssuableToCustomer(rules, customerGroupIds): boolean`
  - `requiresCustomerContext(rules): boolean`
  - `type IssuanceEligibility = { eligible: true } | { eligible: false; reason: 'group_mismatch' } | { eligible: false; reason: 'unsupported_rule'; attribute: string; operator: string }`
  - `type PromotionRuleLike = { attribute?: string | null; operator?: string | null; values?: ... }`
  - `CUSTOMER_SCOPED_ATTRIBUTES` · `CART_CONTEXT_ATTRIBUTES` (드리프트 가드가 읽는다)

- [ ] **Step 1: 실패하는 유닛 스펙을 쓴다**

`apps/medusa/src/modules/promotion-meta/__tests__/issuance-rules.unit.spec.ts`:

```ts
import {
  evaluateIssuanceRules,
  isIssuableToCustomer,
  requiresCustomerContext,
  CART_CONTEXT_ATTRIBUTES,
  CUSTOMER_SCOPED_ATTRIBUTES,
} from '../issuance-rules';

const groups = (...ids: string[]) => new Set(ids);

describe('evaluateIssuanceRules', () => {
  it('룰이 없으면 통과한다', () => {
    expect(evaluateIssuanceRules([], groups())).toEqual({ eligible: true });
    expect(evaluateIssuanceRules(null, groups())).toEqual({ eligible: true });
    expect(evaluateIssuanceRules(undefined, groups())).toEqual({ eligible: true });
  });

  it('customer.groups.id + in — 그룹에 속하면 통과', () => {
    const rules = [{ attribute: 'customer.groups.id', operator: 'in', values: [{ value: 'cg_1' }] }];
    expect(evaluateIssuanceRules(rules, groups('cg_1'))).toEqual({ eligible: true });
  });

  it('customer.groups.id + in — 그룹에 없으면 group_mismatch', () => {
    const rules = [{ attribute: 'customer.groups.id', operator: 'in', values: [{ value: 'cg_1' }] }];
    expect(evaluateIssuanceRules(rules, groups('cg_2'))).toEqual({
      eligible: false,
      reason: 'group_mismatch',
    });
  });

  it('문자열 values 도 받는다 (query.graph 가 두 모양으로 준다)', () => {
    const rules = [{ attribute: 'customer.groups.id', operator: 'in', values: ['cg_1'] }];
    expect(evaluateIssuanceRules(rules, groups('cg_1'))).toEqual({ eligible: true });
  });

  it('values 가 비면 아무도 못 받는다 (fail-closed)', () => {
    const rules = [{ attribute: 'customer.groups.id', operator: 'in', values: [] }];
    expect(evaluateIssuanceRules(rules, groups('cg_1'))).toEqual({
      eligible: false,
      reason: 'group_mismatch',
    });
  });

  it.each(CART_CONTEXT_ATTRIBUTES)('카트 문맥 룰 %s 은 의도적으로 무시한다', (attribute) => {
    const rules = [{ attribute, operator: 'in', values: [{ value: 'whatever' }] }];
    expect(evaluateIssuanceRules(rules, groups())).toEqual({ eligible: true });
  });

  it('분류표 밖 속성은 fail-closed 다 (오늘의 fail-open 을 뒤집는다)', () => {
    const rules = [{ attribute: 'customer.email', operator: 'eq', values: [{ value: 'a@b.c' }] }];
    expect(evaluateIssuanceRules(rules, groups('cg_1'))).toEqual({
      eligible: false,
      reason: 'unsupported_rule',
      attribute: 'customer.email',
      operator: 'eq',
    });
  });

  it('아는 속성이라도 모르는 operator 면 fail-closed 다', () => {
    // 엔진은 gt/lt/eq/ne/in/lte/gte 를 다 허용한다. 우리 폼은 `in` 만 만든다.
    const rules = [{ attribute: 'customer.groups.id', operator: 'ne', values: [{ value: 'cg_1' }] }];
    expect(evaluateIssuanceRules(rules, groups('cg_1'))).toEqual({
      eligible: false,
      reason: 'unsupported_rule',
      attribute: 'customer.groups.id',
      operator: 'ne',
    });
  });

  it('카트 문맥 + 고객 고유가 섞이면 고객 고유만 본다', () => {
    const rules = [
      { attribute: 'subtotal', operator: 'gte', values: [{ value: '30000' }] },
      { attribute: 'customer.groups.id', operator: 'in', values: [{ value: 'cg_1' }] },
    ];
    expect(evaluateIssuanceRules(rules, groups('cg_1'))).toEqual({ eligible: true });
    expect(evaluateIssuanceRules(rules, groups('cg_9'))).toEqual({
      eligible: false,
      reason: 'group_mismatch',
    });
  });

  it('분류표 밖 룰이 하나라도 있으면 나머지가 통과해도 거부다', () => {
    const rules = [
      { attribute: 'customer.groups.id', operator: 'in', values: [{ value: 'cg_1' }] },
      { attribute: 'customer.created_at', operator: 'gte', values: [{ value: '2026-01-01' }] },
    ];
    expect(evaluateIssuanceRules(rules, groups('cg_1'))).toMatchObject({
      eligible: false,
      reason: 'unsupported_rule',
    });
  });
});

describe('isIssuableToCustomer', () => {
  it('eligible 을 boolean 으로 접는다', () => {
    expect(isIssuableToCustomer([], groups())).toBe(true);
    expect(
      isIssuableToCustomer(
        [{ attribute: 'customer.groups.id', operator: 'in', values: [{ value: 'cg_1' }] }],
        groups('cg_2'),
      ),
    ).toBe(false);
  });
});

describe('requiresCustomerContext', () => {
  it('카트 문맥 룰만 있으면 고객 문맥이 필요 없다', () => {
    expect(requiresCustomerContext([{ attribute: 'subtotal', operator: 'gte', values: [] }])).toBe(false);
    expect(requiresCustomerContext([])).toBe(false);
  });

  it('고객 고유 룰이나 분류표 밖 룰이 있으면 고객 문맥이 필요하다', () => {
    expect(
      requiresCustomerContext([{ attribute: 'customer.groups.id', operator: 'in', values: [] }]),
    ).toBe(true);
    expect(requiresCustomerContext([{ attribute: 'customer.email', operator: 'eq', values: [] }])).toBe(
      true,
    );
  });
});

describe('분류표 자체', () => {
  it('고객 고유 1 + 카트 문맥 5 로 닫혀 있다', () => {
    expect(CUSTOMER_SCOPED_ATTRIBUTES).toEqual(['customer.groups.id']);
    expect([...CART_CONTEXT_ATTRIBUTES].sort()).toEqual(
      [
        'currency_code',
        'region.id',
        'sales_channel_id',
        'shipping_address.country_code',
        'subtotal',
      ].sort(),
    );
  });
});
```

- [ ] **Step 2: 드리프트 가드 스펙을 쓴다**

`apps/medusa/src/modules/promotion-meta/__tests__/issuance-rules-engine-drift.unit.spec.ts`:

```ts
import path from 'node:path';
import { CART_CONTEXT_ATTRIBUTES, CUSTOMER_SCOPED_ATTRIBUTES } from '../issuance-rules';

/**
 * 엔진이 어드민에 노출하는 ORDER 스코프 룰 속성을 **엔진 자신에게서** 읽는다.
 *
 * 깊은 내부 경로를 «일부러» 참조한다. Medusa 업그레이드가 여섯 번째 속성을 추가하면
 * 프로덕션에서 조용히 fail-closed 로 떨어지기 전에 여기가 먼저 빨개져야 하고, 경로가
 * 사라져도 마찬가지로 빨개져야 한다 — 그때 분류표를 다시 확인하는 것이 이 가드의 목적이다.
 */
function engineOrderScopeAttributes(): string[] {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- 엔진 내부 경로를 의도적으로 참조한다
  const pkgJsonPath = require.resolve('@medusajs/medusa/package.json');
  const mapPath = path.join(
    path.dirname(pkgJsonPath),
    'dist/api/admin/promotions/utils/rule-attributes-map.js',
  );
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- 위와 같은 이유
  const { getRuleAttributesMap } = require(mapPath) as {
    getRuleAttributesMap: (args: Record<string, string>) => { rules: { value: string }[] };
  };
  return getRuleAttributesMap({
    promotionType: 'standard',
    applicationMethodType: 'percentage',
    applicationMethodTargetType: 'order',
  }).rules.map((r) => r.value);
}

describe('발급 시점 분류표 ↔ 엔진 드리프트', () => {
  it('엔진의 ORDER 스코프 속성이 전부 분류표 안에 있다', () => {
    const known = new Set<string>([...CUSTOMER_SCOPED_ATTRIBUTES, ...CART_CONTEXT_ATTRIBUTES]);
    const unclassified = engineOrderScopeAttributes().filter((a) => !known.has(a));
    expect(unclassified).toEqual([]);
  });

  it('2026-09-01 실측 — 다섯이다', () => {
    expect(engineOrderScopeAttributes().sort()).toEqual(
      [
        'customer.groups.id',
        'region.id',
        'shipping_address.country_code',
        'sales_channel_id',
        'currency_code',
      ].sort(),
    );
  });
});
```

- [ ] **Step 3: 스펙이 실패하는 것을 확인한다**

Run: `npm run test:medusa`
Expected: FAIL — `Cannot find module '../issuance-rules'`

- [ ] **Step 4: 최소 구현을 쓴다**

`apps/medusa/src/modules/promotion-meta/issuance-rules.ts`:

```ts
/**
 * 발급 시점의 룰 평가 (#488 `1-5`, P7).
 *
 * 엔진의 룰 평가(`areRulesValidForContext`)는 **카트 컨텍스트**에서 `rule.attribute` 경로를
 * 뽑아 비교한다. 그런데 **발급 시점에는 카트가 없다.** 그래서 「모든 룰을 평가한다」는 처방은
 * 그대로 쓰면 틀린다 — 룰을 두 부류로 갈라야 한다.
 *
 * - **고객 고유** — 카트 없이 평가할 수 있고 평가해야 의미가 있다. 오늘 `customer.groups.id` 하나뿐.
 * - **카트 문맥** — 발급 시점에 평가할 수 없고, **막아서도 안 된다.** 고객이 나중에 그 리전에서
 *   살 수 있다. 그래서 «의도적으로 무시»한다. 성능이 아니라 의미 때문이다.
 * - **그 외 전부** — **fail-closed.** 발급하지 않고 skip + 로그.
 *
 * 🔴 **fail-closed 의 근거는 «네이티브 대시보드가 나머지를 만들 수 있으니까»가 아니다.**
 * 네이티브 대시보드를 쓰지 않는 것이 우리 원칙이라 그 논거는 성립하지 않는다. 옳은 근거는
 * 반대 방향이다(#488 `N5`): 엔진이 지원하는 조건을 우리 화면이 안 만드는 것은 **admin-web 의
 * 기능 미비**이고, 언젠가 채워진다. **그날 이 파일이 준비돼 있지 않으면 그 순간부터 조건을
 * 무시한 발급이 조용히 시작된다.** fail-closed 는 그 창을 막고, 새 조건을 화면에 추가한 사람이
 * 발급 쪽도 함께 손봐야 한다는 것을 즉시 알게 한다.
 *
 * 목록을 닫아 두는 대가는 「엔진이 여섯 번째 속성을 추가하면 그 쿠폰이 아무에게도 안 나간다」
 * 인데, 그것을 프로덕션 전에 알아채라고 `__tests__/issuance-rules-engine-drift.unit.spec.ts` 가 있다.
 *
 * 컨테이너도 워크플로도 모르는 순수 함수다 — 라우트 안 클로저로 두면 Medusa 유닛 러너가
 * `__tests__/*.unit.spec.ts` 만 매치하므로 검증 대상 밖이 된다.
 */

export type PromotionRuleValueLike = { value?: string | null } | string | null | undefined;

export type PromotionRuleLike = {
  attribute?: string | null;
  operator?: string | null;
  values?: readonly PromotionRuleValueLike[] | null;
};

/**
 * 발급 시점에 평가하는 룰. **(속성, operator) 쌍으로 닫는다.**
 *
 * operator 까지 못 박는 이유: 엔진은 `gt|lt|eq|ne|in|lte|gte` 를 전부 허용하는데
 * (`@medusajs/types` `PromotionRuleOperatorValues`), 우리 폼이 만드는 것은 `in` 뿐이다
 * (`build-create-promotion-payload.ts:77-84`). `ne` 로 들어온 그룹 룰을 `in` 처럼 읽으면
 * **의미가 정반대로 뒤집힌 채 조용히 발급**된다 — 속성만 보는 분류표는 그 사고를 못 막는다.
 */
const CUSTOMER_SCOPED_RULES: readonly { attribute: string; operator: string }[] = [
  { attribute: 'customer.groups.id', operator: 'in' },
];

/** 위 목록의 속성 축. 드리프트 가드와 스펙이 읽는다. */
export const CUSTOMER_SCOPED_ATTRIBUTES: readonly string[] = ['customer.groups.id'];

/**
 * 발급 시점에 **의도적으로 무시**하는 속성.
 *
 * 앞 넷은 엔진이 어드민에 노출하는 ORDER 스코프 속성이고, `subtotal` 은 **엔진이 노출하지
 * 않는데 우리 폼이 만드는 값**이라 명시적으로 넣는다. 빼면 최소주문금액 쿠폰이 전부
 * fail-closed 로 떨어진다.
 */
export const CART_CONTEXT_ATTRIBUTES: readonly string[] = [
  'region.id',
  'shipping_address.country_code',
  'sales_channel_id',
  'currency_code',
  'subtotal',
];

export type IssuanceEligibility =
  | { eligible: true }
  | { eligible: false; reason: 'group_mismatch' }
  | { eligible: false; reason: 'unsupported_rule'; attribute: string; operator: string };

function ruleValues(rule: PromotionRuleLike): string[] {
  return (rule.values ?? [])
    .map((v) => (typeof v === 'string' ? v : v?.value))
    .filter((v): v is string => typeof v === 'string' && v.length > 0);
}

/**
 * 이 고객에게 지금 이 쿠폰을 **발급**할 수 있는가.
 *
 * 카트 문맥 룰은 건너뛴다. 분류표 밖은 거부한다. 거부 사유는 호출부가 skip 사유·로그로 쓴다.
 */
export function evaluateIssuanceRules(
  rules: readonly PromotionRuleLike[] | null | undefined,
  customerGroupIds: ReadonlySet<string>,
): IssuanceEligibility {
  for (const rule of rules ?? []) {
    const attribute = rule?.attribute ?? '';
    const operator = rule?.operator ?? '';

    if (CART_CONTEXT_ATTRIBUTES.includes(attribute)) continue;

    const supported = CUSTOMER_SCOPED_RULES.some(
      (r) => r.attribute === attribute && r.operator === operator,
    );
    if (!supported) {
      return { eligible: false, reason: 'unsupported_rule', attribute, operator };
    }

    // 여기 도달하는 것은 오늘 `customer.groups.id` + `in` 하나뿐이다.
    const requiredIds = ruleValues(rule);
    if (!requiredIds.some((id) => customerGroupIds.has(id))) {
      return { eligible: false, reason: 'group_mismatch' };
    }
  }

  return { eligible: true };
}

/** `evaluateIssuanceRules` 의 boolean 판. 표시 경로의 필터가 쓴다. */
export function isIssuableToCustomer(
  rules: readonly PromotionRuleLike[] | null | undefined,
  customerGroupIds: ReadonlySet<string>,
): boolean {
  return evaluateIssuanceRules(rules, customerGroupIds).eligible;
}

/**
 * 이 쿠폰의 판정에 **고객이 누구인지**가 필요한가.
 *
 * 비로그인 프리뷰가 「로그인해야 알 수 있다」를 고르는 데 쓴다. 카트 문맥 룰만 있으면 고객과
 * 무관하므로 false 다. 분류표 밖 룰은 true 로 접는다 — 어차피 로그인해도 거부되지만, 비로그인
 * 응답에 새 어휘를 만들지 않기 위해 여기서 흡수한다.
 */
export function requiresCustomerContext(
  rules: readonly PromotionRuleLike[] | null | undefined,
): boolean {
  return (rules ?? []).some((rule) => !CART_CONTEXT_ATTRIBUTES.includes(rule?.attribute ?? ''));
}
```

- [ ] **Step 5: 스펙이 통과하는 것을 확인한다**

Run: `npm run test:medusa`
Expected: PASS — 신규 2 suite 포함 전부 통과. 특히 드리프트 가드의 「다섯이다」가 통과해야 한다(엔진 경로 참조가 살아있다는 증거).

- [ ] **Step 6: 타입 게이트**

Run: `cd apps/medusa && npx tsc --noEmit`
Expected: 선재 에러 **3건** 그대로 (`src/admin/lib/sdk.ts(5,14)`·`(6,12)`, `confirm-purchase.unit.spec.ts(11,41)`). 늘어나면 이 태스크가 만든 것이다.

- [ ] **Step 7: 커밋**

```bash
git add apps/medusa/src/modules/promotion-meta/issuance-rules.ts \
        apps/medusa/src/modules/promotion-meta/__tests__/issuance-rules.unit.spec.ts \
        apps/medusa/src/modules/promotion-meta/__tests__/issuance-rules-engine-drift.unit.spec.ts
git commit -m "feat(coupon): 발급 시점 룰 분류표 + fail-closed 평가기 (#488 1-5)"
```

---

## Task 2: 발급 3경로를 평가기로 바꾼다

**Files:**
- Modify: `apps/medusa/src/api/admin/customers/[id]/issue-coupons/route.ts:66-93`
- Modify: `apps/medusa/src/api/admin/customers/[id]/promotions/route.ts:174-180`
- Modify: `apps/medusa/src/api/store/customers/me/promotions/[id]/claim/route.ts:59-81`
- Test: `apps/medusa/integration-tests/http/coupon-issuance-rules.spec.ts`

**Interfaces:**
- Consumes: Task 1 의 `evaluateIssuanceRules` · `IssuanceEligibility`
- Produces: 새 skip 사유 문자열 **`unsupported_rule`** (Task 4 의 admin-web 라벨과 Task 5 의 메트릭 라벨이 이 값을 쓴다). 자동발급 라우트의 `skipped[]` 가 이제 `not_started`·`expired`·`group_mismatch` 도 낸다(이전엔 조용히 필터됐다).

- [ ] **Step 1: 실패하는 통합 스펙을 쓴다**

`apps/medusa/integration-tests/http/coupon-issuance-rules.spec.ts`:

```ts
import { medusaIntegrationTestRunner } from '@medusajs/test-utils';
import { Modules, ContainerRegistrationKeys } from '@medusajs/framework/utils';
import jwt from 'jsonwebtoken';

jest.setTimeout(120 * 1000);

/**
 * 발급 시점 룰 분류 + fail-closed (#488 `1-5`, P7).
 *
 * 픽스처는 `coupon-admin.spec.ts` · `coupon-store.spec.ts` 의 관례를 그대로 복제한다 —
 * 공용 헬퍼가 저장소에 없고, 러너가 매 테스트 후 DB 를 teardown 하므로 `beforeEach` 에서
 * admin/customer 를 새로 만들어야 한다.
 */
medusaIntegrationTestRunner({
  inApp: true,
  // 트리거 자동발급은 프로덕션 기본 OFF(COUPON_AUTO_ISSUE_ENABLED). 이 스펙은 켠 상태의
  // 동작을 검증하므로 러너에만 켠다 — 라이브 플립과 무관하다.
  env: { COUPON_AUTO_ISSUE_ENABLED: 'true' },
  disableAutoTeardown: true,
  testSuite: ({ api, getContainer }) => {
    let adminHeaders: { headers: Record<string, string> };
    let storeHeaders: { headers: Record<string, string> };
    let customerId: string;
    let otherGroupId: string;
    let seq = 0;

    beforeEach(async () => {
      seq++;
      const container = getContainer();
      const config = container.resolve(ContainerRegistrationKeys.CONFIG_MODULE) as any;
      const secret = config.projectConfig.http.jwtSecret;

      const userModule = container.resolve(Modules.USER);
      const [user] = await userModule.createUsers([{ email: `admin${seq}@p7.test` }]);
      adminHeaders = {
        headers: {
          authorization: `Bearer ${jwt.sign(
            { actor_id: user.id, actor_type: 'user', auth_identity_id: 'a', app_metadata: { user_id: user.id } },
            secret,
          )}`,
        },
      };

      const pk = await api.post('/admin/api-keys', { title: `pk${seq}`, type: 'publishable' }, adminHeaders);

      const customerModule = container.resolve(Modules.CUSTOMER);
      const [cust] = await customerModule.createCustomers([{ email: `buyer${seq}@p7.test` }]);
      customerId = cust.id;
      storeHeaders = {
        headers: {
          'x-publishable-api-key': pk.data.api_key.token,
          authorization: `Bearer ${jwt.sign(
            { actor_id: cust.id, actor_type: 'customer', auth_identity_id: 'c', app_metadata: { customer_id: cust.id } },
            secret,
          )}`,
        },
      };

      // 고객이 **속하지 않은** 그룹. 이 그룹으로 만든 `ne` 룰은 「그룹 밖이면 준다」는 뜻이라
      // 오늘의 fail-open 이면 발급되고, fail-closed 면 거부된다 — 두 동작이 정확히 갈린다.
      const [group] = await customerModule.createCustomerGroups([{ name: `other${seq}` }]);
      otherGroupId = group.id;
    });

    const createPromo = async (
      code: string,
      rules: unknown[],
      additional_data: Record<string, unknown> = {
        visibility: 'claimable',
        auto_issue_trigger: 'customer_registered',
      },
    ) => {
      const res = await api.post(
        '/admin/promotions',
        {
          code,
          type: 'standard',
          is_automatic: false,
          status: 'active',
          application_method: { type: 'percentage', value: 10, target_type: 'order', currency_code: 'krw' },
          rules,
          additional_data,
        },
        adminHeaders,
      );
      return res.data.promotion.id as string;
    };

    /**
     * 분류표 밖 룰. 속성은 엔진이 아는 것이되 **operator 가 우리가 모르는 것**이라
     * 「생성은 반드시 된다 + 발급은 반드시 거부된다」를 둘 다 만족한다.
     */
    const unsupportedRule = () => [
      { attribute: 'customer.groups.id', operator: 'ne', values: [otherGroupId] },
    ];

    const autoIssue = () =>
      api.post(`/admin/customers/${customerId}/issue-coupons`, { trigger: 'customer_registered' }, adminHeaders);

    describe('발급 시점 룰 분류 (#488 1-5)', () => {
      it('분류표 밖 룰은 자동발급에서 unsupported_rule 로 skip 된다', async () => {
        const promoId = await createPromo('P7UNSUP', unsupportedRule());

        const res = await autoIssue();

        expect(res.status).toEqual(200);
        expect(res.data.issued.map((i: any) => i.promotion_id)).not.toContain(promoId);
        expect(res.data.skipped).toEqual(
          expect.arrayContaining([{ promotion_id: promoId, reason: 'unsupported_rule' }]),
        );
      });

      it('카트 문맥 룰(subtotal)은 의도적으로 무시하고 발급한다', async () => {
        const promoId = await createPromo('P7SUBTOTAL', [
          { attribute: 'subtotal', operator: 'gte', values: ['30000'] },
        ]);

        const res = await autoIssue();

        expect(res.data.issued.map((i: any) => i.promotion_id)).toContain(promoId);
      });

      it('수동 발급도 분류표 밖 룰을 skip 하고, force 는 그것을 넘는다', async () => {
        const promoId = await createPromo('P7MANUAL', unsupportedRule());

        const skipped = await api.post(
          `/admin/customers/${customerId}/promotions`,
          { promotion_ids: [promoId], force: false },
          adminHeaders,
        );
        expect(skipped.data.issued).not.toContain(promoId);
        expect(skipped.data.skipped.find((s: any) => s.promotion_id === promoId)?.reason).toEqual(
          'unsupported_rule',
        );

        const forced = await api.post(
          `/admin/customers/${customerId}/promotions`,
          { promotion_ids: [promoId], force: true },
          adminHeaders,
        );
        expect(forced.data.issued).toContain(promoId);
      });

      it('클레임도 거부한다 — 고객에게는 기존 어휘로 접어 보낸다', async () => {
        const promoId = await createPromo('P7CLAIM', unsupportedRule());

        await expect(
          api.post(`/store/customers/me/promotions/${promoId}/claim`, {}, storeHeaders),
        ).rejects.toThrow();
      });
    });
  },
});
```

> ⚠️ **마지막 케이스의 `.rejects.toThrow()` 에 주의.** Medusa 워크플로/라우트 에러가 `Error` 인스턴스가 아닌 경우가 있어 `.rejects.toThrow()` 가 **거짓 실패**할 수 있다. 실행 중 그렇게 되면 `try/catch` 로 받아 `err.response.status` 가 `400`(`MedusaError.Types.NOT_ALLOWED` 의 매핑)인지 단언하는 형태로 바꾼다 — `coupon-store.spec.ts` 의 다른 거부 케이스가 쓰는 모양을 따르면 된다.

- [ ] **Step 2: 스펙이 실패하는 것을 확인한다**

Run: `scripts/local/run-medusa-integration.sh`
Expected: 신규 **4 케이스 전부 FAIL** — 오늘은 fail-open 이라 `unsupported_rule` 이 나오지 않고 **발급된다**(클레임도 통과한다: 인라인 사본이 `operator === 'in'` 인 룰만 찾아서 `ne` 룰을 못 본다). 기존 스펙은 전부 통과해야 한다.

- [ ] **Step 3: 자동발급 라우트를 바꾼다**

`apps/medusa/src/api/admin/customers/[id]/issue-coupons/route.ts` — import 교체:

```ts
import { computeExpiresAt, issuanceWindowState } from '../../../../../modules/promotion-meta/validity';
import { evaluateIssuanceRules } from '../../../../../modules/promotion-meta/issuance-rules';
```

(`meetsGroupRule` · `isWithinIssuanceWindow` import 는 지운다.)

`const now = new Date();` 부터 루프 진입까지(현행 66-77행)를 아래로 교체한다:

```ts
  const now = new Date();
  const logger = req.scope.resolve(ContainerRegistrationKeys.LOGGER);
  const metaById = new Map<string, any>(metaRecords.map((m: any) => [m.promotion_id, m]));

  const issued: { promotion_id: string; code: string }[] = [];
  const skipped: { promotion_id: string; reason: string }[] = [];

  // 옛 코드는 창·그룹 불일치를 `filter` 로 조용히 떨어뜨려 응답에 흔적이 없었다. 자동발급은
  // 사람이 안 보는 경로라 그 침묵이 곧 «발급이 안 된 이유를 아무도 모름» 이었다 — 이제
  // 수동 경로처럼 사유를 실어 보내고, channel-adapter 가 그것을 메트릭으로 센다(#488 7-4).
  for (const promo of promotions as any[]) {
    const meta = metaById.get(promo.id);
    if (!meta) continue;

    // 발급 창은 캠페인이 아니라 promotion_meta 가 정한다 (#488 결정 1).
    const window = issuanceWindowState(meta, now);
    if (window !== 'ok') {
      skipped.push({ promotion_id: promo.id, reason: window === 'not_started' ? 'not_started' : 'expired' });
      continue;
    }

    // 분류표 밖 룰은 fail-closed (#488 1-5). 근거는 issuance-rules.ts 헤더 주석.
    const eligibility = evaluateIssuanceRules(promo.rules, customerGroupIds);
    if (!eligibility.eligible) {
      if (eligibility.reason === 'unsupported_rule') {
        logger.warn(
          `[coupon] 자동발급 skip — 발급 시점에 평가할 수 없는 룰 (promotion_id=${promo.id}, ` +
            `attribute=${eligibility.attribute}, operator=${eligibility.operator}, ` +
            `customer_id=${customerId}, trigger=${trigger}). ` +
            'modules/promotion-meta/issuance-rules.ts 의 분류표에 이 속성을 추가하고 평가를 구현할 것.',
        );
      }
      skipped.push({ promotion_id: promo.id, reason: eligibility.reason });
      continue;
    }

    const alreadyIssued = await promotionMetaService.isAlreadyIssued(customerId, promo.id);
```

이후 루프 본문(`alreadyIssued` 검사부터 끝까지)은 **그대로 둔다**. 루프 헤더가 `validPromotions` 에서 `promotions` 로 바뀐 것과, `issued`/`skipped` 선언이 루프 위로 올라간 것만 다르다. `validPromotions` 변수는 삭제한다.

- [ ] **Step 4: 수동 발급 라우트를 바꾼다**

`apps/medusa/src/api/admin/customers/[id]/promotions/route.ts` — import 에서 `meetsGroupRule` 을 빼고 평가기를 넣는다:

```ts
import { toMetadataShape } from '../../../promotions/helpers';
import { evaluateIssuanceRules } from '../../../../../modules/promotion-meta/issuance-rules';
```

(`meetsGroupRule` 을 import 목록에서 뺀다. 깊이가 `helpers`(3) 와 `modules`(5) 로 다른 것은 원래 그렇다 — 같은 파일의 기존 `computeExpiresAt` import 가 5단계다.)

`if (!force) { ... }` 블록 안의 그룹 검사(현행 176-180행)를 교체한다:

```ts
      // 분류표 밖 룰은 fail-closed (#488 1-5). `force` 는 여전히 이 게이트를 넘는다 —
      // 새 조건을 화면에 추가한 사람이 발급 로직을 고칠 때까지 운영이 막히지 않게 하는
      // 탈출구이고, 그 탈출은 `issued_via='admin_force'` 로 링크 행에 기록된다.
      const eligibility = evaluateIssuanceRules(promo.rules, customerGroupIds);
      if (!eligibility.eligible) {
        if (eligibility.reason === 'unsupported_rule') {
          logger.warn(
            `[coupon] 수동발급 skip — 발급 시점에 평가할 수 없는 룰 (promotion_id=${promo.id}, ` +
              `attribute=${eligibility.attribute}, operator=${eligibility.operator}, ` +
              `customer_id=${customerId}). force 로 우회할 수 있으나, ` +
              'modules/promotion-meta/issuance-rules.ts 의 분류표를 채우는 것이 정답이다.',
          );
        }
        skipped.push({ promotion_id: promo.id, reason: eligibility.reason });
        continue;
      }
```

**이 핸들러에는 `logger` 가 없다** — 다른 컨테이너 resolve 들(`query`/`link`/`promotionMetaService`) 옆에 추가한다. `ContainerRegistrationKeys` 는 이미 import 돼 있다:

```ts
  const logger = req.scope.resolve(ContainerRegistrationKeys.LOGGER);
```

- [ ] **Step 5: 클레임 라우트의 인라인 사본을 없앤다**

`apps/medusa/src/api/store/customers/me/promotions/[id]/claim/route.ts` — import 추가:

```ts
import { evaluateIssuanceRules } from '../../../../../../../modules/promotion-meta/issuance-rules';
```

현행 68-81행(`// 고객 그룹 rule 검증 …` 부터 닫는 `}` 까지)을 전부 아래로 교체한다:

```ts
  // 발급 시점 룰 평가 — 판정은 modules/promotion-meta/issuance-rules.ts 하나뿐이다.
  // 옛 코드는 여기에 그룹 룰 검사를 손으로 복제해 뒀고, 그래서 `meetsGroupRule` 을 grep 해도
  // 이 자리가 안 잡혔다 (#488 7-3 이 말하는 «샌 계약» 의 축소판).
  const customerGroupIds = new Set<string>((customers?.[0]?.groups ?? []).map((g: any) => g.id));
  const eligibility = evaluateIssuanceRules(promotion.rules, customerGroupIds);
  if (!eligibility.eligible) {
    if (eligibility.reason === 'unsupported_rule') {
      req.scope.resolve(ContainerRegistrationKeys.LOGGER).warn(
        `[coupon] 클레임 거부 — 발급 시점에 평가할 수 없는 룰 (promotion_id=${promotionId}, ` +
          `attribute=${eligibility.attribute}, operator=${eligibility.operator}, ` +
          `customer_id=${customerId}).`,
      );
    }
    // 고객에게는 사유를 구별해 주지 않는다 — 스토어프론트가 닫힌 어휘를 읽는다.
    throw new MedusaError(MedusaError.Types.NOT_ALLOWED, '이 쿠폰은 대상 고객만 발급받을 수 있습니다.');
  }
```

- [ ] **Step 6: 통합 스펙이 통과하는 것을 확인한다**

Run: `scripts/local/run-medusa-integration.sh`
Expected: PASS — 신규 4 케이스 통과 + `coupon-admin.spec.ts` 의 「group rule: customer IN group is issued」·「skip reasons: automatic / not_started / expired / group_mismatch」 등 기존 케이스 전부 통과.

⚠️ 기존 스펙이 깨지면 대부분 **자동발급 응답에 skip 사유가 늘어난 것**이 원인이다. 기존 기대가 `skipped: []` 를 **정확히** 단언하고 있으면 `expect.arrayContaining` 으로 완화하지 말고, **그 케이스에서 정말 skip 이 늘어야 하는지** 먼저 판단할 것.

- [ ] **Step 7: 유닛·타입 게이트**

```bash
npm run test:medusa
cd apps/medusa && npx tsc --noEmit
```
Expected: 유닛 전부 통과, 타입 선재 3건 그대로.

- [ ] **Step 8: 커밋**

```bash
git add apps/medusa/src/api/admin/customers apps/medusa/src/api/store/customers \
        apps/medusa/integration-tests/http/coupon-issuance-rules.spec.ts
git commit -m "feat(coupon): 발급 3경로를 fail-closed 룰 평가기로 (#488 1-5)"
```

---

## Task 3: 표시 3경로 정렬 + `meetsGroupRule` 삭제

**Files:**
- Modify: `apps/medusa/src/api/store/coupons/preview/route.ts:110-140`
- Modify: `apps/medusa/src/api/store/events/[slug]/route.ts:98`
- Modify: `apps/medusa/src/api/store/customers/me/promotions/route.ts:198,212`
- Modify: `apps/medusa/src/api/admin/promotions/helpers.ts:161-170` (삭제)
- Test: `apps/medusa/integration-tests/http/coupon-issuance-rules.spec.ts` (Task 2 파일에 케이스 추가)

**Interfaces:**
- Consumes: Task 1 의 `isIssuableToCustomer` · `requiresCustomerContext`
- Produces: `meetsGroupRule` 이 저장소에서 사라진다. 이후 어떤 태스크도 그 이름을 쓰지 않는다.

- [ ] **Step 1: 실패하는 케이스를 추가한다**

Task 2 의 `coupon-issuance-rules.spec.ts` 안 `describe('발급 시점 룰 분류 (#488 1-5)')` 에 이어 붙인다:

```ts
    describe('표시 경로도 같은 술어를 쓴다', () => {
      it('분류표 밖 룰 쿠폰은 프리뷰에서 거부된다 (기존 어휘 그대로)', async () => {
        await createPromo('P7PREVIEW', unsupportedRule());

        const res = await api.get('/store/coupons/preview?code=P7PREVIEW', storeHeaders);

        expect(res.status).toEqual(200);
        expect(res.data.valid).toBe(false);
        // 새 reason 을 만들지 않는다 — 스토어프론트가 닫힌 집합으로 읽는다.
        expect(res.data.reason).toEqual('COUPON_GROUP_RESTRICTED');
      });

      it('분류표 밖 룰 쿠폰은 claimable 목록에 뜨지 않는다', async () => {
        await createPromo('P7LIST', unsupportedRule());

        const res = await api.get('/store/customers/me/promotions', storeHeaders);

        const codes = (res.data.claimable_promotions ?? []).map((p: any) => p.code);
        expect(codes).not.toContain('P7LIST');
      });

      it('이미 발급된 쿠폰은 룰과 무관하게 목록에 남는다 (회귀 가드)', async () => {
        // 🔴 assigned 목록에 fail-closed 를 넣으면 **고객이 보유한 쿠폰이 사라진다.**
        // 카트에서는 엔진이 룰을 제대로 평가해 쓸 수 있는데도 목록에서만 없어진다.
        const promoId = await createPromo('P7OWNED', unsupportedRule(), { visibility: 'assigned_only' });
        const link = getContainer().resolve(ContainerRegistrationKeys.LINK) as any;
        await link.create([
          {
            [Modules.CUSTOMER]: { customer_id: customerId },
            [Modules.PROMOTION]: { promotion_id: promoId },
            data: { expires_at: null, issued_via: 'admin_manual', used_at: null, order_id: null },
          },
        ]);

        const res = await api.get('/store/customers/me/promotions', storeHeaders);

        expect((res.data.promotions ?? []).map((p: any) => p.code)).toContain('P7OWNED');
      });
    });
```

- [ ] **Step 2: 실패를 확인한다**

Run: `scripts/local/run-medusa-integration.sh`
Expected: 신규 3 케이스 중 **2건 FAIL**(프리뷰·claimable 목록) — 오늘은 `meetsGroupRule` 이 `in` 룰이 없으면 `true` 를 돌려줘 **프리뷰가 valid, 목록에 노출**된다. 세 번째(「이미 발급된 쿠폰은 목록에 남는다」)는 **지금도 통과해야 한다** — 그게 회귀 가드의 의미다. 지금 빨갛다면 픽스처가 틀린 것이지 구현이 틀린 게 아니다.

- [ ] **Step 3: 프리뷰 라우트를 바꾼다**

`apps/medusa/src/api/store/coupons/preview/route.ts` — import 교체:

```ts
import { resolveVisibility } from '../../../admin/promotions/helpers';
import {
  isIssuableToCustomer,
  requiresCustomerContext,
} from '../../../../modules/promotion-meta/issuance-rules';
```

비로그인 분기의 `hasGroupRule` 을 교체한다:

```ts
  if (!customerId) {
    // 고객이 누구인지 알아야 판정되는 룰이 하나라도 있으면 로그인부터 받는다.
    // 분류표 밖 룰도 여기서 흡수된다 — 로그인하면 아래에서 COUPON_GROUP_RESTRICTED 로 떨어진다.
    if (visibility !== 'public' || requiresCustomerContext(promotion.rules)) {
```

인증 고객 분기의 그룹 검사를 교체한다:

```ts
  if (!isIssuableToCustomer(promotion.rules, customerGroupIds)) {
```

(응답 본문 `reason: 'COUPON_GROUP_RESTRICTED'` 는 **그대로 둔다** — 스토어프론트가 닫힌 어휘를 읽는다.)

- [ ] **Step 4: 이벤트 라우트를 바꾼다**

`apps/medusa/src/api/store/events/[slug]/route.ts`:

```ts
import { resolveVisibility } from '../../../admin/promotions/helpers';
import { isIssuableToCustomer } from '../../../../modules/promotion-meta/issuance-rules';
```

```ts
    if (customerId && !isIssuableToCustomer(promo.rules, customerGroupIds)) {
      return { kind: 'blocked', reason: 'group_restricted' };
    }
```

- [ ] **Step 5: 마이페이지 목록 라우트를 바꾼다**

`apps/medusa/src/api/store/customers/me/promotions/route.ts` — import 에서 `meetsGroupRule` 을 빼고:

```ts
import { resolveVisibility, VISIBILITY_WHEN_META_MISSING } from '../../../../admin/promotions/helpers';
import { isIssuableToCustomer } from '../../../../../modules/promotion-meta/issuance-rules';
```

`publicPromotions` 와 `claimablePromotions` 의 필터 마지막 줄을 각각 교체한다:

```ts
      isIssuableToCustomer(promo.rules, customerGroupIds)
```

**`assignedPromotions` 는 건드리지 않는다** — 이미 발급된 쿠폰은 룰 평가 대상이 아니다. 여기에 fail-closed 를 넣으면 **고객이 이미 보유한 쿠폰이 목록에서 사라진다**(카트에서는 엔진이 룰을 제대로 평가하므로 쓸 수 있는데도).

- [ ] **Step 6: `meetsGroupRule` 을 삭제한다**

`apps/medusa/src/api/admin/promotions/helpers.ts` 의 `meetsGroupRule` 함수(161-170행)를 지우고 그 자리에 남긴다:

```ts
// `meetsGroupRule` 은 삭제됐다 (P7, #488 1-5). 발급 시점 룰 평가는
// `../../../modules/promotion-meta/issuance-rules` 의 `evaluateIssuanceRules` /
// `isIssuableToCustomer` 하나뿐이다. 이 함수는 그룹 룰만 봐서 나머지 조건을 **조용히 통과**시켰다.
```

- [ ] **Step 7: 잔존 참조가 0인지 확인한다**

```bash
grep -rn "meetsGroupRule" --include=*.ts --include=*.tsx apps/ web/ packages/ | grep -v node_modules
```
Expected: **0줄.**

- [ ] **Step 8: 스토어프론트 어휘가 안 늘었는지 확인한다**

```bash
grep -rn "COUPON_GROUP_RESTRICTED\|group_restricted" --include=*.ts apps/medusa/src/api/store | grep -v node_modules
```
Expected: 프리뷰 1건 + 이벤트 1건. **새 `reason` 문자열이 없어야 한다** — 있으면 storefront 트리를 건드려야 하고, 이 플랜의 Global Constraints 위반이다.

- [ ] **Step 9: 게이트**

```bash
scripts/local/run-medusa-integration.sh
npm run test:medusa
cd apps/medusa && npx tsc --noEmit
```
Expected: 통합 전부 통과(신규 7 케이스 포함), 유닛 전부 통과, 타입 선재 3건.

- [ ] **Step 10: 커밋**

```bash
git add apps/medusa/src/api apps/medusa/integration-tests
git commit -m "feat(coupon): 표시 3경로를 같은 술어로 + meetsGroupRule 삭제 (#488 1-5)"
```

---

## Task 4: admin-web — `unsupported_rule` 을 어드민이 알아보게 한다

**Files:**
- Create: `apps/admin-web/src/features/mall/marketing/coupons/lib/skip-reason-labels.ts`
- Create: `apps/admin-web/src/features/mall/marketing/coupons/lib/skip-reason-labels.spec.ts`
- Modify: `apps/admin-web/src/features/mall/marketing/coupons/components/coupon-assign-dialog.tsx:20-30`

**Interfaces:**
- Consumes: Task 2 가 만든 skip 사유 `unsupported_rule`
- Produces: `SKIP_REASON_LABELS` · `skipReasonLabel(reason)` — 다이얼로그가 부른다

- [ ] **Step 1: 실패하는 스펙을 쓴다**

`apps/admin-web/src/features/mall/marketing/coupons/lib/skip-reason-labels.spec.ts`:

```ts
import { BACKEND_SKIP_REASONS, skipReasonLabel } from './skip-reason-labels';

describe('skipReasonLabel', () => {
  it('백엔드가 낼 수 있는 사유가 전부 라벨을 갖는다', () => {
    for (const reason of BACKEND_SKIP_REASONS) {
      expect(skipReasonLabel(reason)).not.toBe(skipReasonLabel('아무거나-없는-값'));
    }
  });

  it('분류표 밖 룰은 «그룹 불일치» 와 다른 문구다', () => {
    // 이 둘이 같은 문구면 어드민이 «고객을 그룹에 넣으면 되겠네» 로 오해한다.
    // 실제로 필요한 것은 발급 로직에 그 룰을 구현하는 것이다.
    expect(skipReasonLabel('unsupported_rule')).not.toBe(skipReasonLabel('group_mismatch'));
    expect(skipReasonLabel('unsupported_rule')).toContain('발급 조건');
  });

  it('모르는 값은 기본 문구로 떨어진다', () => {
    expect(skipReasonLabel('brand_new_reason')).toBe('발급할 수 없습니다.');
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npm run test:admin-web`
Expected: FAIL — `Cannot find module './skip-reason-labels'`

- [ ] **Step 3: 라벨 모듈을 만든다**

`apps/admin-web/src/features/mall/marketing/coupons/lib/skip-reason-labels.ts`:

```ts
/**
 * 발급 스킵 사유 → 안내 문구.
 *
 * `.tsx` 안에 있던 것을 `.ts` 로 뺐다 — admin-web 의 jest transform 이 `^.+\.(t|j)s$` 라
 * `.tsx` 안의 로직은 **테스트가 실행조차 되지 않는다**. 라벨 누락은 조용한 종류의 결함이라
 * (없는 값은 «발급할 수 없습니다» 로 뭉개진다) 검증 가능한 자리에 있어야 한다.
 */

/**
 * Medusa 발급 라우트가 낼 수 있는 사유의 **손으로 유지하는 사본**이다.
 * 정본은 `apps/medusa/src/api/admin/customers/[id]/promotions/route.ts` 와
 * `.../issue-coupons/route.ts` 의 `skipped.push({ reason })` 자리들.
 * admin-web 이 medusa 를 import 할 수 없어(별도 트리·번들러 없음) 사본이 유일한 방법이다.
 */
export const BACKEND_SKIP_REASONS = [
  'inactive',
  'automatic',
  'not_started',
  'expired',
  'group_mismatch',
  'unsupported_rule',
  'max_claims_exceeded',
  'link_error',
  'already_issued',
] as const;

const LABELS: Record<string, string> = {
  inactive: '비활성 쿠폰입니다.',
  automatic: '자동 적용 쿠폰은 수동 발급할 수 없습니다.',
  not_started: '아직 발급 기간이 아닙니다.',
  expired: '기간이 만료된 쿠폰입니다.',
  group_mismatch: '대상 고객 그룹이 아닙니다.',
  // 「고객을 그룹에 넣으면 된다」로 오해하지 않도록 그룹 불일치와 확실히 다른 문구를 쓴다.
  // 실제로 필요한 것은 발급 시점 평가 로직(issuance-rules.ts)에 그 조건을 구현하는 것이다.
  unsupported_rule:
    '이 쿠폰의 발급 조건은 아직 발급 시점에 판정할 수 없습니다. 개발팀 확인이 필요합니다(강제 발급은 가능).',
  max_claims_exceeded: '발급 수량이 소진되었습니다.',
  link_error: '발급 처리 중 오류가 발생했습니다. 다시 시도해주세요.',
  already_issued: '이미 발급된 고객입니다.',
  unknown: '발급할 수 없습니다.',
};

export function skipReasonLabel(reason: string | null | undefined): string {
  return (reason && LABELS[reason]) || LABELS.unknown;
}
```

- [ ] **Step 4: 다이얼로그가 그것을 쓰게 한다**

`coupon-assign-dialog.tsx` 에서 파일 안 `const SKIP_REASON_LABELS: Record<string, string> = { ... }` 블록(21-30행)을 지우고 import 로 바꾼다:

```ts
import { skipReasonLabel } from '../lib/skip-reason-labels';
```

사용처는 **한 곳(158행)** 뿐이다:

```diff
-              <span>{SKIP_REASON_LABELS[skipReason] ?? SKIP_REASON_LABELS.unknown} 강제 발급하시겠습니까?</span>
+              <span>{skipReasonLabel(skipReason)} 강제 발급하시겠습니까?</span>
```

그러면 `SKIP_REASON_LABELS` 참조가 이 파일에서 사라지므로 import 는 `skipReasonLabel` 하나만 남긴다:

```ts
import { skipReasonLabel } from '../lib/skip-reason-labels';
```

확인:
```bash
grep -n "SKIP_REASON_LABELS" apps/admin-web/src/features/mall/marketing/coupons/components/coupon-assign-dialog.tsx
```
Expected: **0줄.**

- [ ] **Step 5: 스펙이 통과하는 것을 확인한다**

```bash
npm run test:admin-web
cd apps/admin-web && npx tsc --noEmit
```
Expected: 신규 3 케이스 통과, 타입 에러 0.

- [ ] **Step 6: 커밋**

```bash
git add apps/admin-web/src/features/mall/marketing/coupons
git commit -m "feat(coupon): 어드민이 unsupported_rule 을 구별해 보게 한다 (#488 1-5)"
```

---

## Task 5: 발급 관측 — prom-client 메트릭 (`7-4`)

**Files:**
- Create: `apps/channel-adapter/src/observability/coupon-issue.metrics.ts`
- Create: `apps/channel-adapter/src/observability/coupon-issue.metrics.spec.ts`
- Modify: `apps/channel-adapter/src/adapters/medusa/medusa.client.ts:2397-2431`

**Interfaces:**
- Consumes: Task 2 가 만든 skip 사유 문자열
- Produces:
  - `recordAutoIssueOutcome(trigger, result)` — 발급/스킵 카운터
  - `recordAutoIssueFailure(trigger, kind)` — 실패 카운터
  - `recordCouponIssueBacklog(rows)` — 백로그 게이지 (Task 6 이 부른다)
  - `COUPON_TRIGGER_EVENT_TYPES` — Task 6 이 쓰는 이벤트 타입 상수

- [ ] **Step 1: 실패하는 스펙을 쓴다**

`apps/channel-adapter/src/observability/coupon-issue.metrics.spec.ts`:

```ts
import { register } from 'prom-client';
import {
  recordAutoIssueOutcome,
  recordAutoIssueFailure,
  recordCouponIssueBacklog,
  COUPON_TRIGGER_EVENT_TYPES,
} from './coupon-issue.metrics';

const value = async (name: string, labels: Record<string, string>): Promise<number> => {
  const metric = await register.getSingleMetric(name)!.get();
  const found = metric.values.find((v) =>
    Object.entries(labels).every(([k, val]) => v.labels[k] === val),
  );
  return found?.value ?? 0;
};

describe('쿠폰 자동발급 메트릭', () => {
  beforeEach(() => {
    register.resetMetrics();
  });

  it('발급 건수와 스킵 사유를 각각 센다', async () => {
    recordAutoIssueOutcome('membership_activated', {
      issued: [{ promotion_id: 'p1' }, { promotion_id: 'p2' }],
      skipped: [{ promotion_id: 'p3', reason: 'already_issued' }],
    });

    expect(await value('coupon_auto_issue_total', {
      trigger: 'membership_activated',
      outcome: 'issued',
    })).toBe(2);
    expect(await value('coupon_auto_issue_total', {
      trigger: 'membership_activated',
      outcome: 'already_issued',
    })).toBe(1);
  });

  it('분류표 밖 룰 스킵은 고유 라벨로 보인다 — 이게 fail-closed 의 관측 지점이다', async () => {
    recordAutoIssueOutcome('customer_registered', {
      issued: [],
      skipped: [{ promotion_id: 'p1', reason: 'unsupported_rule' }],
    });

    expect(await value('coupon_auto_issue_total', {
      trigger: 'customer_registered',
      outcome: 'unsupported_rule',
    })).toBe(1);
  });

  it('모르는 사유는 other 로 접어 라벨 카디널리티를 닫는다', async () => {
    recordAutoIssueOutcome('customer_registered', {
      issued: [],
      skipped: [{ promotion_id: 'p1', reason: 'something_new' }, { promotion_id: 'p2' }],
    });

    expect(await value('coupon_auto_issue_total', {
      trigger: 'customer_registered',
      outcome: 'other',
    })).toBe(2);
  });

  it('빈 응답에도 죽지 않는다', () => {
    expect(() => recordAutoIssueOutcome('customer_registered', null)).not.toThrow();
    expect(() => recordAutoIssueOutcome('customer_registered', {})).not.toThrow();
  });

  it('영구/일시 실패를 나눠 센다', async () => {
    recordAutoIssueFailure('membership_activated', 'permanent');
    recordAutoIssueFailure('membership_activated', 'transient');
    recordAutoIssueFailure('membership_activated', 'transient');

    expect(await value('coupon_auto_issue_failures_total', {
      trigger: 'membership_activated',
      kind: 'permanent',
    })).toBe(1);
    expect(await value('coupon_auto_issue_failures_total', {
      trigger: 'membership_activated',
      kind: 'transient',
    })).toBe(2);
  });

  it('백로그 게이지는 행이 없는 타입을 0 으로 되돌린다', async () => {
    recordCouponIssueBacklog([{ eventType: 'UserEmailVerified', count: 3 }]);
    expect(await value('coupon_issue_inbox_failed_rows', { event_type: 'UserEmailVerified' })).toBe(3);
    expect(await value('coupon_issue_inbox_failed_rows', { event_type: 'MembershipStatusChanged' })).toBe(0);

    // 다음 회차에 3건이 해소되면 게이지도 내려가야 한다 — 안 그러면 알림이 영원히 켜져 있다.
    recordCouponIssueBacklog([]);
    expect(await value('coupon_issue_inbox_failed_rows', { event_type: 'UserEmailVerified' })).toBe(0);
  });

  it('트리거 이벤트 타입은 둘이다', () => {
    expect([...COUPON_TRIGGER_EVENT_TYPES]).toEqual(['UserEmailVerified', 'MembershipStatusChanged']);
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx jest --maxWorkers=2 coupon-issue.metrics`
Expected: FAIL — `Cannot find module './coupon-issue.metrics'`

- [ ] **Step 3: 메트릭 모듈을 만든다**

`apps/channel-adapter/src/observability/coupon-issue.metrics.ts`:

```ts
import { Counter, Gauge, register } from 'prom-client';

/**
 * 쿠폰 자동발급 관측 (#488 `7-4`).
 *
 * 그전까지 영구 실패는 `logger.error` 한 줄이 전부였고, 「발급이 안 되고 있다」는 사실을
 * 알 방법이 없었다. 자동발급은 사람이 안 보는 경로라 그 침묵의 대가가 크다.
 *
 * 모듈 스코프 싱글턴이다 — prom-client 전역 register 는 같은 이름을 두 번 등록하면 던지므로,
 * 인스턴스 필드로 두면 프로바이더가 두 번 생성될 때 부팅이 죽는다(`libs/events/src/dlq/dlq.metrics.ts`
 * 가 같은 이유로 같은 모양이다). 노출은 `startMetricsServer()` 가 앱포트+10000 에 띄우는
 * `/metrics` 이고 Alloy 가 긁어간다.
 */

/** 발급 트리거를 나르는 inbox 이벤트 타입. 리컨실과 게이지가 공유한다. */
export const COUPON_TRIGGER_EVENT_TYPES = ['UserEmailVerified', 'MembershipStatusChanged'] as const;

/**
 * 라벨 카디널리티를 닫는다. Medusa 가 새 사유를 내면 `other` 로 접히고, 그 사실은 이 배열을
 * 갱신하라는 신호다(그래야 Grafana 에서 구별된다).
 */
const KNOWN_OUTCOMES = new Set([
  'already_issued',
  'group_mismatch',
  'unsupported_rule',
  'max_claims_exceeded',
  'not_started',
  'expired',
]);

const autoIssueTotal = new Counter({
  name: 'coupon_auto_issue_total',
  help: 'Auto-issuance outcomes reported by the Medusa issue-coupons endpoint',
  labelNames: ['trigger', 'outcome'],
  registers: [register],
});

const autoIssueFailuresTotal = new Counter({
  name: 'coupon_auto_issue_failures_total',
  help: 'Failed calls to the Medusa auto-issuance endpoint, split by permanence',
  labelNames: ['trigger', 'kind'],
  registers: [register],
});

const inboxFailedRows = new Gauge({
  name: 'coupon_issue_inbox_failed_rows',
  help: 'inbox_events rows stuck in status=failed for coupon trigger event types',
  labelNames: ['event_type'],
  registers: [register],
});

export type AutoIssueResult = {
  issued?: unknown[] | null;
  skipped?: ({ reason?: string | null } | null)[] | null;
} | null | undefined;

export function recordAutoIssueOutcome(trigger: string, result: AutoIssueResult): void {
  const issued = result?.issued?.length ?? 0;
  if (issued > 0) autoIssueTotal.inc({ trigger, outcome: 'issued' }, issued);

  for (const entry of result?.skipped ?? []) {
    const reason = entry?.reason ?? '';
    autoIssueTotal.inc({ trigger, outcome: KNOWN_OUTCOMES.has(reason) ? reason : 'other' });
  }
}

export function recordAutoIssueFailure(trigger: string, kind: 'permanent' | 'transient'): void {
  autoIssueFailuresTotal.inc({ trigger, kind });
}

/**
 * 백로그 게이지를 «전체 다시 쓰기» 로 갱신한다.
 *
 * 행이 없는 타입을 0 으로 명시하는 것이 핵심이다. 안 그러면 마지막으로 관측된 값이 남아
 * 알림이 영원히 켜져 있고, 그 상태에서는 아무도 알림을 안 본다.
 */
export function recordCouponIssueBacklog(rows: { eventType: string; count: number }[]): void {
  const byType = new Map(rows.map((r) => [r.eventType, r.count]));
  for (const eventType of COUPON_TRIGGER_EVENT_TYPES) {
    inboxFailedRows.set({ event_type: eventType }, byType.get(eventType) ?? 0);
  }
}
```

- [ ] **Step 4: 스펙이 통과하는 것을 확인한다**

Run: `npx jest --maxWorkers=2 coupon-issue.metrics`
Expected: PASS (7 케이스)

- [ ] **Step 5: 클라이언트를 배선한다**

`apps/channel-adapter/src/adapters/medusa/medusa.client.ts` — import 추가:

```ts
import {
  recordAutoIssueOutcome,
  recordAutoIssueFailure,
} from '../../observability/coupon-issue.metrics';
```

`issuePromotionsByTrigger` 의 try 안 집계 부분을 교체한다:

```ts
      const issued = result?.issued?.length ?? 0;
      const skipped = result?.skipped?.length ?? 0;
      // 발급 결과를 메트릭으로 남긴다 (#488 7-4). 스킵 «사유» 까지 세는 것이 요점이다 —
      // fail-closed 스킵(unsupported_rule)은 로그를 안 보면 아무도 모른다.
      recordAutoIssueOutcome(trigger, result);
      if (issued > 0) {
```

catch 안, `isPermanent` 분기 직전에 넣는다:

```ts
      const isPermanent = typeof status === 'number' && status >= 400 && status < 500 && status !== 429;
      recordAutoIssueFailure(trigger, isPermanent ? 'permanent' : 'transient');
```

- [ ] **Step 6: 게이트**

```bash
npm run type-check && npx jest --maxWorkers=2
```
Expected: 타입 0, jest 전부 통과.

- [ ] **Step 7: 커밋**

```bash
git add apps/channel-adapter/src/observability apps/channel-adapter/src/adapters/medusa/medusa.client.ts
git commit -m "feat(coupon): 자동발급 결과·실패를 메트릭으로 (#488 7-4)"
```

---

## Task 6: 리컨실 빠른 레인 (`7-2`)

**Files:**
- Modify: `apps/channel-adapter/src/services/coupon-issue-reconciliation.service.ts`
- Create: `apps/channel-adapter/src/services/coupon-issue-reconciliation.spec.ts`
- Create: `apps/channel-adapter/src/services/coupon-issue-reconciliation.integration.spec.ts`

**Interfaces:**
- Consumes: Task 5 의 `recordCouponIssueBacklog` · `COUPON_TRIGGER_EVENT_TYPES`
- Produces: `sweepRecentFailures()` (15분 크론) · `refreshBacklogGauge()`

**이 태스크가 고치는 것과, 고칠 필요가 없던 것:**

> #488 `7-2` 는 「`pending`/`processing` 에 낀 이벤트는 리컨실 대상도 아님」이라고 적었다.
> **`processing` 쪽은 이미 워커가 처리한다** — `claimNextInboxEvent` 의 술어가
> `(status = 'processing' AND next_attempt_at <= NOW())` 를 포함해서, 리스가 만료된(기본 15분,
> `INBOX_PROCESSING_LEASE_MS`) 행을 다시 물어간다(`inbox-worker.service.ts:267`). 워커가 도는 한
> 「낀 채로 영원히」는 없다. **그러니 스윕을 새로 만들지 않는다.**
>
> 진짜로 남는 지연은 하나다: `MembershipStatusChanged` 가 재시도 5회(2·4·8·16초 백오프)를 태우고
> `failed` 가 되면, 그 뒤 재구동은 **03:00 크론뿐**이라 최대 ~24시간 밀린다. 이 태스크는 그 창을
> **15분**으로 줄이되, 되살리기를 **이벤트당 한 번**으로 묶는다 — 영구 실패(예: 잘못된 페이로드)가
> 15분마다 재시도 사다리를 다시 타면 1 vCPU Medusa 를 하루 96회 두드린다.

- [ ] **Step 1: 실패하는 유닛 스펙을 쓴다**

`apps/channel-adapter/src/services/coupon-issue-reconciliation.spec.ts`:

```ts
import { CouponIssueReconciliationService } from './coupon-issue-reconciliation.service';
import type { MedusaClient } from '../adapters/medusa/medusa.client';
import type { DbService } from '@app/db';
import type { ChannelAdapterSchema } from '../types';

function makeDb(opts: { revived?: { id: string }[]; backlog?: { eventType: string; count: number }[] }) {
  const returning = jest.fn().mockResolvedValue(opts.revived ?? []);
  const updateWhere = jest.fn().mockReturnValue({ returning });
  const set = jest.fn().mockReturnValue({ where: updateWhere });
  const update = jest.fn().mockReturnValue({ set });

  const groupBy = jest.fn().mockResolvedValue(opts.backlog ?? []);
  const selectWhere = jest.fn().mockReturnValue({ groupBy });
  const from = jest.fn().mockReturnValue({ where: selectWhere });
  const select = jest.fn().mockReturnValue({ from });

  return {
    db: { update, select },
    calls: { update, set, updateWhere, returning, select, groupBy },
  };
}

describe('CouponIssueReconciliationService.sweepRecentFailures', () => {
  const medusaClient = {} as MedusaClient;

  it('되살릴 때 재시도 상태를 전부 초기화하고 마커를 남긴다', async () => {
    const db = makeDb({ revived: [{ id: 'e1' }] });
    const service = new CouponIssueReconciliationService(
      { db: db.db } as unknown as DbService<ChannelAdapterSchema>,
      medusaClient,
    );

    await service.sweepRecentFailures();

    expect(db.calls.set).toHaveBeenCalledTimes(1);
    const patch = db.calls.set.mock.calls[0][0];
    expect(patch.status).toBe('pending');
    expect(patch.attempts).toBe(0);
    expect(patch.errorMessage).toBeNull();
    // failedAt 을 안 지우면 다음 회차의 lookback 창 계산이 옛 시각을 본다.
    expect(patch.failedAt).toBeNull();
    // 마커가 없으면 이 크론은 15분마다 같은 행을 영원히 되살린다.
    expect(patch.metadata).toBeDefined();
  });

  it('되살린 게 없어도 백로그 게이지는 갱신한다', async () => {
    const db = makeDb({ revived: [], backlog: [] });
    const service = new CouponIssueReconciliationService(
      { db: db.db } as unknown as DbService<ChannelAdapterSchema>,
      medusaClient,
    );

    await service.sweepRecentFailures();

    // 게이지를 «되살린 게 있을 때만» 갱신하면 해소된 뒤에도 옛 값이 남아 알림이 안 꺼진다.
    expect(db.calls.groupBy).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx jest --maxWorkers=2 coupon-issue-reconciliation`
Expected: FAIL — `service.sweepRecentFailures is not a function`

- [ ] **Step 3: 빠른 레인을 구현한다**

`apps/channel-adapter/src/services/coupon-issue-reconciliation.service.ts` — import 를 넓힌다:

```ts
import { and, eq, gte, inArray, sql } from 'drizzle-orm';
import {
  recordCouponIssueBacklog,
  COUPON_TRIGGER_EVENT_TYPES,
} from '../observability/coupon-issue.metrics';
```

기존 `COUPON_TRIGGER_TYPES` 상수를 지우고 `COUPON_TRIGGER_EVENT_TYPES` 를 쓴다(같은 값이 두 곳에 있으면 갈린다). 파일 상단에 추가한다:

```ts
/**
 * 빠른 레인이 이 이벤트를 이미 한 번 되살렸다는 표시.
 *
 * `inbox_events.metadata`(jsonb, nullable)에 쓴다 — 마이그레이션 없이 «1회» 를 표현할 수 있는
 * 유일한 자리다. 이게 없으면 영구 실패가 15분마다 재시도 사다리를 다시 타 1 vCPU Medusa 를
 * 하루 96회 두드린다. 두 번째부터는 03:00 크론(느린 백스톱)이 맡는다.
 */
const FAST_LANE_MARKER = 'coupon_fast_reset';

/** 빠른 레인의 대상 창. 그보다 오래된 실패는 급하지 않고, 03:00 크론이 더 넓은 창으로 본다. */
const FAST_LANE_LOOKBACK_MS = 24 * 60 * 60 * 1000;
```

`reconcile()` 아래에 새 크론을 더한다:

```ts
  /**
   * 최근 실패를 «한 번» 즉시 되살린다 (#488 `7-2`).
   *
   * 왜 필요한가: `MembershipStatusChanged` 는 재시도 5회(2·4·8·16초)를 태우면 `failed` 가 되고,
   * 그 뒤 재구동은 03:00 크론뿐이었다 — Medusa 가 1분 넘게 아프면 멤버십 쿠폰이 **다음날까지**
   * 밀린다. 여기서 그 창이 15분이 된다.
   *
   * 왜 «한 번» 인가: 위 FAST_LANE_MARKER 주석 참조.
   *
   * `processing` 에 낀 행은 여기서 다루지 않는다 — 워커의 클레임 술어가 리스 만료된
   * `processing` 을 이미 다시 물어간다(`inbox-worker.service.ts` 의 claim SQL).
   */
  @Cron('*/15 * * * *', { timeZone: 'Asia/Seoul' })
  async sweepRecentFailures(): Promise<void> {
    const since = new Date(Date.now() - FAST_LANE_LOOKBACK_MS);

    const revived = await this.dbService.db
      .update(inboxEvents)
      .set({
        status: 'pending',
        attempts: 0,
        nextAttemptAt: new Date(),
        errorMessage: null,
        failedAt: null,
        metadata: sql`coalesce(${inboxEvents.metadata}, '{}'::jsonb) || jsonb_build_object(${FAST_LANE_MARKER}, now())`,
      })
      .where(
        and(
          eq(inboxEvents.status, 'failed'),
          inArray(inboxEvents.eventType, [...COUPON_TRIGGER_EVENT_TYPES]),
          gte(inboxEvents.failedAt, since),
          // `metadata` 가 NULL 이어도, 키가 없어도 NULL 이라 둘 다 여기 걸린다.
          sql`${inboxEvents.metadata} -> ${FAST_LANE_MARKER} is null`,
        ),
      )
      .returning({ id: inboxEvents.id });

    if (revived.length > 0) {
      this.logger.warn(`쿠폰 발급 실패 ${revived.length}건을 즉시 재시도 큐로 되돌렸다 (빠른 레인)`);
    }

    await this.refreshBacklogGauge();
  }

  /**
   * `failed` 로 남은 발급 트리거 행 수를 게이지에 적는다 (#488 `7-4`).
   * 되살린 게 없어도 부른다 — 해소된 뒤 게이지가 안 내려가면 알림이 영원히 켜져 있다.
   */
  private async refreshBacklogGauge(): Promise<void> {
    const rows = await this.dbService.db
      .select({ eventType: inboxEvents.eventType, count: sql<number>`count(*)::int` })
      .from(inboxEvents)
      .where(
        and(
          eq(inboxEvents.status, 'failed'),
          inArray(inboxEvents.eventType, [...COUPON_TRIGGER_EVENT_TYPES]),
        ),
      )
      .groupBy(inboxEvents.eventType);

    recordCouponIssueBacklog(rows.map((r) => ({ eventType: r.eventType, count: Number(r.count) })));
  }
```

`private async run()` 의 마지막 `return` 직전에도 게이지를 갱신한다:

```ts
    await this.refreshBacklogGauge();
    this.logger.log(`쿠폰 발급 보정 완료: directIssued=${directIssued}, reset=${reset}, skipped=${skipped}`);
    return { directIssued, reset, skipped };
```

`run()` 의 이른 반환(`failed.length === 0`) 자리에도 넣는다:

```ts
    if (failed.length === 0) {
      this.logger.log('보정 대상 없음');
      await this.refreshBacklogGauge();
      return { directIssued: 0, reset: 0, skipped: 0 };
    }
```

- [ ] **Step 4: 유닛 스펙이 통과하는 것을 확인한다**

Run: `npx jest --maxWorkers=2 coupon-issue-reconciliation`
Expected: PASS (2 케이스)

- [ ] **Step 5: 실 DB 통합 스펙을 쓴다 (마커 의미론)**

`apps/channel-adapter/src/services/coupon-issue-reconciliation.integration.spec.ts`:

```ts
// eslint-disable-next-line @typescript-eslint/no-require-imports -- postgres publishes `export =`; Jest compiles CJS.
import postgres = require('postgres');
import { drizzle } from 'drizzle-orm/postgres-js';
import { CouponIssueReconciliationService } from './coupon-issue-reconciliation.service';
import type { MedusaClient } from '../adapters/medusa/medusa.client';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

/**
 * 빠른 레인의 술어 두 개는 **실 Postgres 에서만** 증명된다:
 *   1. `metadata -> 'coupon_fast_reset' is null` 이 NULL metadata 와 키 없음을 **둘 다** 잡는가
 *   2. `coalesce(metadata,'{}') || jsonb_build_object(...)` 가 기존 키를 보존하며 마커를 더하는가
 * 목으로는 둘 다 조용히 통과한다 — 그래서 이 파일이 있다.
 */
describeIfDb('쿠폰 빠른 레인 (PostgreSQL integration)', () => {
  let client: ReturnType<typeof postgres>;
  let service: CouponIssueReconciliationService;
  const createdIds: string[] = [];

  const insertFailed = async (metadata: string | null): Promise<string> => {
    const [row] = await client<{ id: string }[]>`
      insert into inbox_events
        (event_type, aggregate_type, aggregate_id, partition_key, payload, metadata,
         status, attempts, failed_at, error_message)
      values
        ('MembershipStatusChanged', 'Membership', ${`agg-${Math.random()}`}, 'pk',
         '{"userId":"u1"}'::jsonb, ${metadata}::jsonb, 'failed', 5, now(), 'boom')
      returning id
    `;
    createdIds.push(row.id);
    return row.id;
  };

  beforeAll(() => {
    client = postgres(DATABASE_URL as string, { max: 4, prepare: false });
    const db = drizzle(client);
    service = new CouponIssueReconciliationService({ db } as never, {} as MedusaClient);
  });

  afterAll(async () => {
    if (createdIds.length > 0) {
      await client`delete from inbox_events where id = any(${client.array(createdIds)})`;
    }
    await client.end({ timeout: 5 });
  });

  it('metadata 가 NULL 인 행도 되살리고, 두 번째 회차에는 건드리지 않는다', async () => {
    const id = await insertFailed(null);

    await service.sweepRecentFailures();
    const [afterFirst] = await client`select status, attempts, metadata from inbox_events where id = ${id}`;
    expect(afterFirst.status).toBe('pending');
    expect(afterFirst.attempts).toBe(0);
    expect(afterFirst.metadata).toHaveProperty('coupon_fast_reset');

    // 다시 실패시킨 뒤 두 번째 회차 — 마커가 있으므로 되살아나면 안 된다.
    await client`update inbox_events set status = 'failed', failed_at = now() where id = ${id}`;
    await service.sweepRecentFailures();
    const [afterSecond] = await client`select status from inbox_events where id = ${id}`;
    expect(afterSecond.status).toBe('failed');
  });

  it('기존 metadata 키를 보존하며 마커를 더한다', async () => {
    const id = await insertFailed('{"correlationId":"corr-1"}');

    await service.sweepRecentFailures();

    const [row] = await client`select metadata from inbox_events where id = ${id}`;
    expect(row.metadata).toMatchObject({ correlationId: 'corr-1' });
    expect(row.metadata).toHaveProperty('coupon_fast_reset');
  });
});
```

- [ ] **Step 6: 실 DB 로 돌려 본다 (가능하면)**

```bash
DATABASE_URL="$(grep -m1 '^DATABASE_URL=' apps/channel-adapter/.env | cut -d= -f2- | tr -d '"')" \
  npx jest --maxWorkers=2 coupon-issue-reconciliation.integration
```
Expected: PASS (2 케이스).
`DATABASE_URL` 이 없거나 로컬 channel-adapter DB 가 없으면 **skip 된다** — 그때는 이 스펙을 아래 「이번에 검증되지 않는 것」에 **반드시 적을 것**. 조용히 넘어가면 마커 술어가 미검증인 채로 배포된다.

- [ ] **Step 7: 게이트**

```bash
npm run type-check && npx jest --maxWorkers=2
```
Expected: 타입 0, jest 전부 통과.

- [ ] **Step 8: 커밋**

```bash
git add apps/channel-adapter/src/services
git commit -m "feat(coupon): 발급 실패 재구동을 15분 빠른 레인으로 (#488 7-2)"
```

---

## Task 7: 전체 게이트 + 문서

**Files:**
- Modify: `docs/superpowers/plans/2026-08-29-coupon-domain-master-plan.md` (진행 상황)

- [ ] **Step 1: 전 트리 게이트를 돌린다**

```bash
npm run test:medusa
cd apps/medusa && npx tsc --noEmit && cd -
scripts/local/run-medusa-integration.sh
scripts/local/run-medusa-integration.sh --modules
npm run type-check
npx jest --maxWorkers=2
npm run test:admin-web
cd apps/admin-web && npx tsc --noEmit && cd -
```

각 명령의 **실제 숫자를 받아 적는다**(「통과」가 아니라 `N suites / M tests`). 기준선:
- `apps/medusa` tsc — 선재 **3건**
- 루트 `type-check` — **0**
- admin-web tsc — **0**

- [ ] **Step 2: `meetsGroupRule` 이 사라졌는지 최종 확인**

```bash
grep -rn "meetsGroupRule" --include=*.ts --include=*.tsx apps/ web/ packages/ | grep -v node_modules
```
Expected: 주석 1줄(helpers.ts 의 안내)만, 함수 정의·호출 0.

- [ ] **Step 3: 마스터플랜 진행 상황을 갱신한다**

`docs/superpowers/plans/2026-08-29-coupon-domain-master-plan.md` 의 진행 상황에서:

1. P4+P5 항목의 **`**PR #771 OPEN · 미머지 · 미배포.**`** 를 **`**PR #771 MERGED (develop `ef28e5d73`, 2026-08-31). 미배포.**`** 로 고친다 — 지금 문서는 낡았고, 다음 사람이 그것을 보고 「P4 가 아직 안 들어갔다」로 읽는다.
2. `- [ ] **P7 플랜 작성**` 을 아래로 교체한다:

```markdown
- [x] **P7 플랜 작성·실행 (2026-09-01)** — `2026-09-01-coupon-auto-issue-activation.md`.
      브랜치 `feat/coupon-auto-issue-activation`. **마이그레이션 0 · 시크릿 0 · env 0.**
      분류표(고객 고유 1 + 카트 문맥 5)를 `modules/promotion-meta/issuance-rules.ts` 한 곳에 두고
      **`meetsGroupRule` 을 삭제**했다 — 발급 3경로 + 표시 3경로 + 클레임 라우트의 **인라인 사본**까지
      일곱 자리가 같은 술어를 쓴다. 🔴 그 인라인 사본은 `meetsGroupRule` grep 으로는 안 잡혔다.
      **operator 까지 못 박았다** — 엔진은 `gt|lt|eq|ne|in|lte|gte` 를 다 허용하는데 우리 폼은
      `in` 만 만든다. 속성만 보는 분류표였다면 `ne` 로 들어온 그룹 룰을 `in` 처럼 읽어
      **의미가 뒤집힌 채 조용히 발급**된다.
      **드리프트 가드**: `issuance-rules-engine-drift.unit.spec.ts` 가 엔진의
      `rule-attributes-map.js` 를 직접 읽어 ORDER 스코프 속성이 분류표를 벗어나면 CI 에서 빨개진다
      (프로덕션에서 조용히 fail-closed 되기 전에).
      `7-2` — 🔴 **#488 의 전제가 반만 맞았다**: `processing` 에 낀 행은 워커의 클레임 술어가
      리스 만료 후 이미 다시 물어간다. 진짜 지연은 `failed` → 03:00 크론뿐인 ~24시간이고,
      15분 빠른 레인 + `metadata` 마커(이벤트당 1회)로 줄였다. 마이그레이션 없이 «1회» 를
      표현할 자리가 그 jsonb 컬럼뿐이었다.
      `7-4` — prom-client 카운터 2 + 게이지 1. **스킵 «사유» 를 센다** — fail-closed 스킵은
      로그를 안 보면 아무도 모른다.
      **`7-3` 은 이번에 하지 않았다** (2026-08-31 결정 5, 별도 트랙).
      **`A5` 플립은 이 PR 에 없다** — 순서가 `P7 → 리허설 2차 → A5` 라, 플립을 담으면 배포가
      곧 개통이 된다. 절차는 플랜 「배포」 절.
```

- [ ] **Step 4: 커밋**

```bash
git add docs/superpowers/plans/2026-08-29-coupon-domain-master-plan.md
git commit -m "docs(coupon): 마스터플랜에 P7 실행 결과를 적는다"
```

- [ ] **Step 5: PR 을 연다**

```bash
git push -u origin feat/coupon-auto-issue-activation
gh pr create --base develop \
  --title "feat(coupon): 자동발급 개통 준비 — 발급 시점 룰 fail-closed (#488 1-5 · 7-2 · 7-4)" \
  --body "$(cat <<'BODY'
## 무엇을

`#488` P7. 발급 시점 룰 평가를 «고객 고유 / 카트 문맥 / 그 외» 로 분류하고 **분류표 밖은 발급하지 않는다**(오늘은 fail-open).

- `1-5` 분류표 + fail-closed — 발급 3경로 · 표시 3경로 · 클레임 인라인 사본까지 7자리가 한 술어를 쓴다. `meetsGroupRule` 삭제
- `7-2` 실패 재구동 창 ~24h → 15분 (이벤트당 1회, `metadata` 마커)
- `7-4` 자동발급 결과·실패·백로그 메트릭

## 안 한 것

- **`7-3`** (발급 계약이 3서비스에 샌다) — 2026-08-31 결정 5 로 별도 트랙
- **`A5` 플래그 플립** — 순서가 `P7 → 리허설 2차 → A5 개통`. 이 PR 은 코드만이고, 머지·배포해도 자동발급은 **꺼진 채**다

## 마이그레이션·시크릿·env

전부 **0**.

## 배포 전 사람 작업

없음. 개통(플래그 플립)은 리허설 2차 뒤 별도 작업이다 — 플랜 「배포」 절 참조.
BODY
)"
```

---

## 이번에 검증되지 않는 것

**실행자는 아래를 실제 상태로 갱신한 뒤에 완료를 보고한다.** 「돌렸다고 치고」가 가장 비싼 거짓말이다.

- **자동발급 전 구간 end-to-end** — `COUPON_AUTO_ISSUE_ENABLED` 가 꺼져 있어 라이브에서 이 경로는 **한 번도 실행된 적이 없다**. 통합 스펙은 러너에만 플래그를 켠다. 리허설 2차가 유일한 방어선.
- **빠른 레인의 SQL 술어** — Task 6 Step 6 을 실제로 돌렸는지 여기에 적을 것. 안 돌렸다면 `metadata -> 'coupon_fast_reset' is null` 과 jsonb 병합은 **미검증**이다(목은 조용히 통과한다).
- **메트릭이 실제로 스크레이프되는지** — `/metrics` 노출은 기존 배선(`startMetricsServer`)에 얹혀 있고 이 플랜은 그것을 확인하지 않는다. 배포 후 Grafana 에서 `coupon_auto_issue_total` 이 보이는지 한 번 봐야 한다.
- **admin-web 다이얼로그의 화면 동작** — `.tsx` 는 렌더 테스트가 없다. 라벨 «맵»은 `.ts` 로 빼서 검증하지만, 그 맵을 화면이 실제로 부르는지는 브라우저에서만 보인다.
- **`customer.email` 같은 «진짜 낯선» 속성으로 프로모션이 생성되는지** — 통합 스펙은 `customer.groups.id` + `ne`(확실히 생성되는 조합)로 fail-closed 를 증명한다. 임의 속성 생성 가능성은 #488 의 실측 기록에만 있다.

---

## 배포 (플랜 밖, 사람이 한다)

**이 PR 자체는 배포해도 동작이 거의 안 바뀐다** — 자동발급이 꺼져 있고, 라이브 자동발급 규칙이 0건이며, 표시 경로의 변화는 「분류표 밖 룰을 가진 쿠폰」이 있어야 드러나는데 라이브에 그런 쿠폰이 없다.

순서: `sst deploy` 한 번이 medusa·channel-adapter·admin-web 을 함께 롤린다(SST 한 스택엔 배포 순서가 없다 — `url()` 은 문자열이라 의존 간선이 0이고 `--target` 도 못 쓴다).

### A5 개통 — 리허설 2차가 끝난 뒤에 한다

1. **선행 확인** — 리허설 2차 완료(특히 「배송비 쿠폰 + 정률 캡」). 그리고 라이브에서 다시 한 번:
   ```sql
   SELECT count(*) FROM promotion_meta
    WHERE auto_issue_trigger IS NOT NULL AND deleted_at IS NULL;   -- 기대: 0
   ```
   **0 이 아니면 멈춘다.** 플래그를 켜는 순간 그 규칙이 발화한다. 0이면, 켜도 `getByAutoIssueTrigger` 가 빈 배열을 돌려주고 라우트가 `{issued:[],skipped:[]}` 로 끝난다 — 누가 쿠폰에 트리거를 붙이기 전까지 아무 일도 안 일어난다.
2. **플립** — `deployments/lcnine/services/infra/services.ts` 의 Medusa `environment` 블록(`MEDUSA_ADMIN_ONBOARDING_TYPE` 근처)에 한 줄:
   ```ts
   // 트리거 자동발급 개통 (#488 A5, 2026-XX-XX). 켜기 전 promotion_meta.auto_issue_trigger 0건 실측 완료.
   COUPON_AUTO_ISSUE_ENABLED: 'true',
   ```
3. **배포** — `sst deploy --stage live`
4. **개통 확인** — 플래그가 먹었는지는 발급이 아니라 **응답 모양**으로 본다. 회원가입 이벤트가 흐른 뒤 Grafana:
   ```promql
   sum by (trigger, outcome) (increase(coupon_auto_issue_total[1h]))
   ```
   꺼져 있으면 이 시리즈가 **아예 안 생긴다**(라우트가 즉시 빈 배열로 반환하고 `skipped` 도 비어 있다).
5. **되돌리기** — 그 한 줄을 지우고 재배포. 이미 발급된 쿠폰은 남는다(회수는 어드민에서 건별).

### 개통 후 볼 것 (알림 후보)

```promql
# fail-closed 스킵이 생기기 시작했다 = 우리 화면이 만드는 조건과 발급 로직이 어긋났다
sum(increase(coupon_auto_issue_total{outcome="unsupported_rule"}[1h])) > 0

# 발급 실패가 쌓인다
sum(coupon_issue_inbox_failed_rows) > 0

# 영구 실패(4xx) = 코드/설정 문제
sum(increase(coupon_auto_issue_failures_total{kind="permanent"}[1h])) > 0
```

⚠️ **`No Data` 를 `Alerting` 으로 매핑하지 말 것.** 이 시리즈들은 자동발급이 아무 일도 안 할 때 **존재하지 않는다** — 그 상태가 정상이다.
