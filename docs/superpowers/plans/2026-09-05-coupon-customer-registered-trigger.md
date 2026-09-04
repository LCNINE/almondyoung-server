# 쿠폰 `customer_registered` 트리거 재지정 (#775) — 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 발화할 수 없는 `customer_registered` 트리거의 입구를 user-service 의 `UserEmailVerified`(Kafka) 에서 Medusa 의 `customer.created` subscriber 로 옮기고, 발급 결과를 channel-adapter 와 같은 이름의 Prometheus 카운터로 내며, 「구독자는 있는데 발행자가 없다」를 기계가 잡는 가드 둘을 놓는다.

**Architecture:** 라우트 `POST /admin/customers/:id/issue-coupons` 안의 발급 루프를 순수 선별기(`selectAutoIssueCandidates`) + 얇은 오케스트레이터(`autoIssueCoupons`) 로 뽑아 라우트와 새 subscriber 가 공유한다. Medusa 는 `prom-client` 로 `:19000/metrics` 를 열고 Alloy 가 긁는다. channel-adapter 의 `UserEmailVerified` 경로는 지운다. 가드 A(루트 jest, 트리거 → 등록된 발행자)와 가드 B(Medusa jest, subscriber 이벤트 → 코어 emit 상수)를 소스 대조 스펙으로 둔다.

**Tech Stack:** Medusa 2.13.4 (subscribers, `query.graph`, workflows-sdk), prom-client 15, Grafana Alloy `discovery.dns` + `prometheus.scrape`, NestJS channel-adapter (drizzle), jest (루트 ts-jest · Medusa swc), `@medusajs/test-utils` HTTP 통합 러너(postgres + redis 필수).

**Spec:** `docs/superpowers/specs/2026-09-05-coupon-customer-registered-trigger-design.md` — §2 실측 ①~⑩ · §3 결정 1~5 · §4 설계 · §5 실패 처리 · §6 테스트가 이 계획의 경계다. 상위 이슈 #775, SoT #488.

## Global Constraints

- **`COUPON_AUTO_ISSUE_ENABLED` 는 이 PR 에서 켜지 않는다.** subscriber 도 라우트도 같은 `isAutoIssueEnabled()` 를 첫 줄에서 본다. 이 PR 의 배포가 A5 개통이 되면 안 된다(리허설 3차가 먼저).
- **마이그레이션 0 · 시크릿 0 · SST env 0.** Medusa 메트릭 포트는 Dockerfile 의 `PORT=9000` 에서 `+10000` 파생한다(19000). Alloy 의 `port = 19000` 리터럴이 그 합과 같아야 한다.
- **라우트의 응답 모양·상태코드는 불변**: `{ issued: {promotion_id, code}[], skipped: {promotion_id, reason}[] }`, 꺼져 있으면 `200 {issued:[],skipped:[]}`, 실패 있으면 500. `coupon-issuance-rules.spec.ts` 가 무수정으로 통과해야 한다. `VALID_TRIGGERS` 상수는 라우트에 **그대로 남긴다** — `coupon-vocabulary-drift.spec.ts` 가 그 이름을 앵커로 읽는다.
- **`medusa.client.ts` 의 `issuePromotionsByTrigger` 트리거 유니온은 두 값 유지.** 어휘 가드의 사이트다. 좁아지는 것은 호출부뿐.
- **새 훅 등록 없음.** subscriber 는 훅이 아니다. 파일 주석에도 `xxxWorkflow.hooks.yyy(` 패턴을 적지 말 것(`no-duplicate-validate-hooks.unit.spec.ts` 가 소스를 스캔한다).
- **Medusa 의존성은 lockfile 둘 다 갱신한다.** Dockerfile 은 `yarn.lock`(yarn v1 `--frozen-lockfile`), CI 는 `package-lock.json`(`npm ci`). 둘 중 하나만 바꾸면 한쪽이 죽는다.
- **재시도를 만들지 않는다**(스펙 결정 2). subscriber 는 catch 로 끝난다. `jobOptions.attempts` 도 스윕 잡도 없다.
- **통합 스펙에서 `.rejects.toThrow()` 금지** — 워크플로 엔진을 거친 에러는 `Error` 인스턴스가 아니다. `try/catch` + `expect(err.message).toContain(...)`.
- **게이트 명령(저장소 루트에서, 단순 명령으로):**
  - `npx tsc --noEmit -p apps/medusa/tsconfig.json` → **에러 3 이 기준선**(`src/admin/lib/sdk.ts` 2 · `src/api/store/orders/[id]/__tests__/confirm-purchase.unit.spec.ts` 1). Task 1 Step 1 에서 재측정. 🔴 `npm --prefix apps/medusa exec -- tsc` 는 루트 tsconfig 를 집어 0 을 낸다 — 쓰지 말 것. 🔴 `integration-tests/` 는 이 게이트 밖이다.
  - `npx tsc --noEmit --project apps/medusa/tsconfig.instrumentation.json` → 0 (CI 가 돌린다).
  - `npm --prefix apps/medusa run test:unit` → Task 1 Step 1 에서 기준선(suites/tests) 기록.
  - `scripts/local/run-medusa-integration.sh --testPathPattern 'coupon-'` → HTTP 통합. 🔴 `npm run test:integration:http` 를 직접 부르면 `SASL: client password must be a string` 으로 전 스펙이 죽는다. `COMPOSE_PROJECT_NAME=almondyoung-server docker compose up -d postgres redis` 가 먼저.
  - `npm run type-check` → 0. `npx jest --ci --silent` → 실패 0 (CI `verification-gates.yml` 과 동일). 메모리가 부족하면 `--maxWorkers=2`.
  - channel-adapter 만: `npx jest --testPathPattern 'apps/channel-adapter' --maxWorkers=2`.
- **커밋 메시지 끝에** `Claude-Session: https://claude.ai/code/session_01PphKuKs3h8JdVMVakkerg1` 트레일러. 브랜치 `feat/coupon-customer-registered-trigger`(이미 생성, 스펙 커밋 `6fd26acc7` 이 첫 커밋).
- 코드 주석은 주변 밀도를 따른다 — 쿠폰 모듈은 「왜」를 길게 적는 관례다. 🔴 표기는 어기면 실사고인 것에만.

---

### Task 1: 기준선 + 순수 선별기 `selectAutoIssueCandidates`

**Files:**
- Create: `apps/medusa/src/workflows/coupons/auto-issue-selection.ts`
- Test: `apps/medusa/src/workflows/coupons/__tests__/auto-issue-selection.unit.spec.ts`

> 스펙 §4.2.1 은 이 파일을 `modules/promotion-meta/` 에 뒀다. **`workflows/coupons/` 로 옮긴다** — 선별기가 `api/admin/promotions/helpers.ts` 의 `resolveVisibility` 를 쓰므로 모듈 디렉터리에 두면 모듈 → api 의존이 생긴다. 스펙 §4.2.1 은 플랜 작성 시 이미 그렇게 정정됐다.

**Interfaces:**
- Produces:
  ```ts
  export type AutoIssueSkipReason =
    | 'public_promotion' | 'not_started' | 'expired' | 'group_mismatch' | 'unsupported_rule'
    | 'already_issued' | 'max_claims_exceeded';
  export type AutoIssueMeta = ValidityPolicy & { promotion_id: string; max_claims?: number | string | null; visibility?: string | null };
  export type AutoIssuePromotion = { id: string; code: string; rules?: readonly PromotionRuleLike[] | null };
  export type AutoIssueSelection = {
    requests: IssueGrantRequest[];
    skipped: { promotion_id: string; reason: AutoIssueSkipReason }[];
    codeById: Map<string, string>;
    unsupportedRules: { promotion_id: string; attribute: string; operator: string }[];
  };
  export function selectAutoIssueCandidates(input: {
    trigger: AutoIssueTrigger; customerId: string; customerGroupIds: ReadonlySet<string>;
    metas: readonly AutoIssueMeta[]; promotions: readonly AutoIssuePromotion[]; now: Date;
  }): AutoIssueSelection;
  export type AutoIssueOutcome = {
    issued: { promotion_id: string; code: string }[];
    skipped: { promotion_id: string; reason: AutoIssueSkipReason }[];
    failed: { promotion_id: string; error: string }[];
  };
  export function foldGrantResults(results: readonly IssueGrantResult[], codeById: ReadonlyMap<string, string>): AutoIssueOutcome;
  ```
  Task 2(오케스트레이터)·Task 3(메트릭 타입)·Task 4(subscriber) 가 읽는다.

- [ ] **Step 1: 기준선을 잰다**

Run (저장소 루트):
```
npx tsc --noEmit -p apps/medusa/tsconfig.json
npm --prefix apps/medusa run test:unit
npm run type-check
```
tsc 에러 수(기대 3)·유닛 suites/tests·루트 type-check(기대 0)를 적어 둔다. 다르면 원인 파일을 먼저 적고 진행한다.

- [ ] **Step 2: 실패하는 유닛 스펙을 쓴다**

`apps/medusa/src/workflows/coupons/__tests__/auto-issue-selection.unit.spec.ts`:

```ts
import { foldGrantResults, selectAutoIssueCandidates } from '../auto-issue-selection';

const NOW = new Date('2026-09-05T00:00:00Z');
const groupRule = (groupId: string, operator = 'in') => ({
  attribute: 'customer.groups.id',
  operator,
  values: [{ value: groupId }],
});

const select = (
  metas: Parameters<typeof selectAutoIssueCandidates>[0]['metas'],
  promotions: Parameters<typeof selectAutoIssueCandidates>[0]['promotions'],
  customerGroupIds: string[] = [],
) =>
  selectAutoIssueCandidates({
    trigger: 'customer_registered',
    customerId: 'cus_1',
    customerGroupIds: new Set(customerGroupIds),
    metas,
    promotions,
    now: NOW,
  });

describe('selectAutoIssueCandidates — 라우트 루프의 순수 판', () => {
  it('게이트를 다 넘은 프로모션은 결정적 issue_key 로 요청이 된다', () => {
    const out = select(
      [{ promotion_id: 'p1', visibility: 'assigned_only', validity_days: 30, max_claims: '5' }],
      [{ id: 'p1', code: 'WELCOME', rules: [] }],
    );

    expect(out.skipped).toEqual([]);
    expect(out.codeById.get('p1')).toBe('WELCOME');
    expect(out.requests).toEqual([
      {
        promotion_id: 'p1',
        customer_id: 'cus_1',
        issue_keys: ['trigger:customer_registered'],
        issued_via: 'customer_registered',
        expires_at: new Date('2026-10-05T00:00:00Z').toISOString(),
        max_claims: 5,
        enforce_cap: true,
      },
    ]);
  });

  it('메타 행이 없는 프로모션은 조용히 건너뛴다 (요청도 스킵도 아님)', () => {
    const out = select([], [{ id: 'p1', code: 'X', rules: [] }]);
    expect(out.requests).toEqual([]);
    expect(out.skipped).toEqual([]);
  });

  it('public 쿠폰은 public_promotion 으로 스킵한다 (#488 A2)', () => {
    const out = select(
      [{ promotion_id: 'p1', visibility: 'public' }],
      [{ id: 'p1', code: 'X', rules: [] }],
    );
    expect(out.skipped).toEqual([{ promotion_id: 'p1', reason: 'public_promotion' }]);
    expect(out.requests).toEqual([]);
  });

  it('발급창 밖은 not_started / expired 로 스킵한다', () => {
    const out = select(
      [
        { promotion_id: 'p1', visibility: 'assigned_only', starts_at: '2026-09-06T00:00:00Z' },
        { promotion_id: 'p2', visibility: 'assigned_only', ends_at: '2026-09-04T00:00:00Z' },
      ],
      [
        { id: 'p1', code: 'A', rules: [] },
        { id: 'p2', code: 'B', rules: [] },
      ],
    );
    expect(out.skipped).toEqual([
      { promotion_id: 'p1', reason: 'not_started' },
      { promotion_id: 'p2', reason: 'expired' },
    ]);
  });

  it('그룹 룰은 평가한다 — 불일치는 group_mismatch', () => {
    const out = select(
      [{ promotion_id: 'p1', visibility: 'assigned_only' }],
      [{ id: 'p1', code: 'A', rules: [groupRule('grp_other')] }],
      ['grp_mine'],
    );
    expect(out.skipped).toEqual([{ promotion_id: 'p1', reason: 'group_mismatch' }]);
  });

  it('분류표 밖 룰은 unsupported_rule 로 스킵하고 로그용 좌표를 남긴다 (#488 1-5)', () => {
    const out = select(
      [{ promotion_id: 'p1', visibility: 'assigned_only' }],
      [{ id: 'p1', code: 'A', rules: [groupRule('grp_x', 'ne')] }],
    );
    expect(out.skipped).toEqual([{ promotion_id: 'p1', reason: 'unsupported_rule' }]);
    expect(out.unsupportedRules).toEqual([
      { promotion_id: 'p1', attribute: 'customer.groups.id', operator: 'ne' },
    ]);
  });

  it('max_claims 가 없으면 null, expires_at 이 없으면 null', () => {
    const out = select(
      [{ promotion_id: 'p1', visibility: 'assigned_only' }],
      [{ id: 'p1', code: 'A', rules: [] }],
    );
    expect(out.requests[0].max_claims).toBeNull();
    expect(out.requests[0].expires_at).toBeNull();
  });
});

describe('foldGrantResults — verdict 를 응답 모양으로', () => {
  const codeById = new Map([['p1', 'A'], ['p2', 'B'], ['p3', 'C'], ['p4', 'D']]);
  const r = (promotion_id: string, verdict: any, error?: string) => ({
    promotion_id,
    customer_id: 'cus_1',
    verdict,
    created: verdict === 'issued' ? 1 : 0,
    duplicated: verdict === 'already_issued' ? 1 : 0,
    ...(error ? { error } : {}),
  });

  it('issued/partial → issued, already_issued → skipped, exhausted → max_claims_exceeded, error → failed', () => {
    const out = foldGrantResults(
      [r('p1', 'issued'), r('p2', 'already_issued'), r('p3', 'exhausted'), r('p4', 'error', 'boom')],
      codeById,
    );
    expect(out.issued).toEqual([{ promotion_id: 'p1', code: 'A' }]);
    expect(out.skipped).toEqual([
      { promotion_id: 'p2', reason: 'already_issued' },
      { promotion_id: 'p3', reason: 'max_claims_exceeded' },
    ]);
    expect(out.failed).toEqual([{ promotion_id: 'p4', error: 'boom' }]);
  });

  it('코드를 모르는 프로모션은 빈 코드로 (방어)', () => {
    const out = foldGrantResults([r('p9', 'issued')], codeById);
    expect(out.issued).toEqual([{ promotion_id: 'p9', code: '' }]);
  });
});
```

- [ ] **Step 3: 실패를 확인한다**

Run: `npm --prefix apps/medusa run test:unit -- --testPathPattern auto-issue-selection`
Expected: FAIL — `Cannot find module '../auto-issue-selection'`.

- [ ] **Step 4: 선별기를 구현한다**

`apps/medusa/src/workflows/coupons/auto-issue-selection.ts`:

```ts
import { resolveVisibility } from '../../api/admin/promotions/helpers';
import { evaluateIssuanceRules, type PromotionRuleLike } from '../../modules/promotion-meta/issuance-rules';
import type { AutoIssueTrigger } from '../../modules/promotion-meta/service';
import { computeExpiresAt, issuanceWindowState, type ValidityPolicy } from '../../modules/promotion-meta/validity';
import type { IssueGrantRequest, IssueGrantResult } from './steps/issue-coupon-grants-step';

/**
 * 자동발급 한 번의 «판정» — I/O 없는 순수 함수 (#775, 스펙 §4.2.1).
 *
 * 옛날엔 이 루프가 `api/admin/customers/[id]/issue-coupons/route.ts` 안에 인라인이었다. 진입점이
 * 둘(channel-adapter 가 부르는 라우트 · Medusa `customer.created` subscriber)이 되면서 뽑았다.
 * 게이트 순서는 라우트 시절 그대로다: public → 발급창 → 룰. 각 단계의 사유 어휘도 그대로다 —
 * channel-adapter 의 `coupon-issue.metrics.ts` 가 `skipped.reason` 을 라벨로 세므로 이 유니온은
 * 그쪽 계약이다.
 */
export type AutoIssueSkipReason =
  | 'public_promotion'
  | 'not_started'
  | 'expired'
  | 'group_mismatch'
  | 'unsupported_rule'
  | 'already_issued'
  | 'max_claims_exceeded';

/** `promotion_meta` 행 중 판정이 읽는 것. 숫자 컬럼이 문자열로 오는 경우가 있어 `max_claims` 는 union. */
export type AutoIssueMeta = ValidityPolicy & {
  promotion_id: string;
  max_claims?: number | string | null;
  visibility?: string | null;
};

export type AutoIssuePromotion = {
  id: string;
  code: string;
  rules?: readonly PromotionRuleLike[] | null;
};

export type AutoIssueSelection = {
  /** 게이트를 넘은 것. 워크플로를 **한 번** 지난다. */
  requests: IssueGrantRequest[];
  skipped: { promotion_id: string; reason: AutoIssueSkipReason }[];
  codeById: Map<string, string>;
  /** fail-closed 로 떨어진 룰의 좌표. 호출자가 warn 로그로 남긴다 — 로그를 안 보면 아무도 모른다. */
  unsupportedRules: { promotion_id: string; attribute: string; operator: string }[];
};

export type AutoIssueSelectionInput = {
  trigger: AutoIssueTrigger;
  customerId: string;
  customerGroupIds: ReadonlySet<string>;
  metas: readonly AutoIssueMeta[];
  promotions: readonly AutoIssuePromotion[];
  now: Date;
};

export function selectAutoIssueCandidates(input: AutoIssueSelectionInput): AutoIssueSelection {
  const { trigger, customerId, customerGroupIds, metas, promotions, now } = input;
  const metaById = new Map(metas.map((m) => [m.promotion_id, m]));

  const requests: IssueGrantRequest[] = [];
  const skipped: AutoIssueSelection['skipped'] = [];
  const codeById = new Map<string, string>();
  const unsupportedRules: AutoIssueSelection['unsupportedRules'] = [];

  for (const promo of promotions) {
    const meta = metaById.get(promo.id);
    if (!meta) continue;

    // 🔴 `public` 쿠폰에 트리거를 걸어두면 가입자 전원에게 장이 한 장씩 생기고, 카트 게이트가
    // 「장이 있으면 장이 정한다」로 갈리는 탓에 **그 전원이** 1회 제한에 걸린다 (#488 A2).
    if (resolveVisibility(meta) === 'public') {
      skipped.push({ promotion_id: promo.id, reason: 'public_promotion' });
      continue;
    }

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
        unsupportedRules.push({
          promotion_id: promo.id,
          attribute: eligibility.attribute,
          operator: eligibility.operator,
        });
      }
      skipped.push({ promotion_id: promo.id, reason: eligibility.reason });
      continue;
    }

    codeById.set(promo.id, promo.code);
    requests.push({
      promotion_id: promo.id,
      customer_id: customerId,
      // 트리거당 한 장. 결정적 키라 어느 진입점에서 몇 번 불려도 멱등하다 — 멤버십을 가입·해지
      // 반복해도 같은 쿠폰이 두 번 안 나가는 이유가 이 키와 `idx_coupon_grant_issue_key` 다.
      issue_keys: [`trigger:${trigger}`],
      issued_via: trigger,
      expires_at: computeExpiresAt(meta, now)?.toISOString() ?? null,
      max_claims: meta.max_claims != null ? Number(meta.max_claims) : null,
      enforce_cap: true,
    });
  }

  return { requests, skipped, codeById, unsupportedRules };
}

export type AutoIssueOutcome = {
  issued: { promotion_id: string; code: string }[];
  skipped: { promotion_id: string; reason: AutoIssueSkipReason }[];
  /** 워크플로가 `error` verdict 를 돌려준 것. 라우트는 500 으로, subscriber 는 카운터로 올린다. */
  failed: { promotion_id: string; error: string }[];
};

/** 워크플로 verdict 를 응답 모양으로 접는다. 어휘가 늘면 `never` 분기가 컴파일을 막는다. */
export function foldGrantResults(
  results: readonly IssueGrantResult[],
  codeById: ReadonlyMap<string, string>,
): AutoIssueOutcome {
  const out: AutoIssueOutcome = { issued: [], skipped: [], failed: [] };
  for (const r of results) {
    switch (r.verdict) {
      case 'already_issued':
        out.skipped.push({ promotion_id: r.promotion_id, reason: 'already_issued' });
        break;
      case 'exhausted':
        out.skipped.push({ promotion_id: r.promotion_id, reason: 'max_claims_exceeded' });
        break;
      case 'issued':
      case 'partial': // 키가 하나라 partial 은 나올 수 없지만, 어휘가 닫혀 있으니 같은 칸에 둔다
        out.issued.push({ promotion_id: r.promotion_id, code: codeById.get(r.promotion_id) ?? '' });
        break;
      case 'error':
        out.failed.push({ promotion_id: r.promotion_id, error: r.error ?? 'unknown' });
        break;
      default: {
        const exhaustive: never = r.verdict;
        throw new Error(`알 수 없는 발급 결과: ${String(exhaustive)}`);
      }
    }
  }
  return out;
}
```

- [ ] **Step 5: 통과를 확인한다**

Run: `npm --prefix apps/medusa run test:unit -- --testPathPattern auto-issue-selection`
Expected: PASS (9 tests).

- [ ] **Step 6: 커밋**

```bash
git add apps/medusa/src/workflows/coupons/auto-issue-selection.ts apps/medusa/src/workflows/coupons/__tests__/auto-issue-selection.unit.spec.ts
git commit -m "refactor(coupon): 자동발급 판정을 순수 선별기로 뽑는다 (#775)

Claude-Session: https://claude.ai/code/session_01PphKuKs3h8JdVMVakkerg1"
```

---

### Task 2: 오케스트레이터 `autoIssueCoupons` + 라우트 리팩터

**Files:**
- Create: `apps/medusa/src/workflows/coupons/auto-issue-coupons.ts`
- Modify: `apps/medusa/src/api/admin/customers/[id]/issue-coupons/route.ts` (전체 교체)
- Test: 기존 `apps/medusa/integration-tests/http/coupon-issuance-rules.spec.ts` **무수정** (리팩터 가드)

**Interfaces:**
- Consumes: Task 1 의 `selectAutoIssueCandidates` · `foldGrantResults` · `AutoIssueOutcome`.
- Produces:
  ```ts
  export function isAutoIssueEnabled(env?: NodeJS.ProcessEnv): boolean;
  export async function autoIssueCoupons(container: MedusaContainer, input: { customerId: string; trigger: AutoIssueTrigger }): Promise<AutoIssueOutcome>;
  ```
  Task 4(subscriber) 가 둘 다 쓴다. 고객이 없으면 `MedusaError(NOT_FOUND)` 를 던진다. **플래그는 보지 않는다.**

- [ ] **Step 1: 오케스트레이터를 쓴다**

`apps/medusa/src/workflows/coupons/auto-issue-coupons.ts`:

```ts
import type { MedusaContainer } from '@medusajs/framework/types';
import { ContainerRegistrationKeys, MedusaError } from '@medusajs/framework/utils';
import { PROMOTION_META_MODULE } from '../../modules/promotion-meta';
import type PromotionMetaModuleService from '../../modules/promotion-meta/service';
import type { AutoIssueTrigger } from '../../modules/promotion-meta/service';
import {
  foldGrantResults,
  selectAutoIssueCandidates,
  type AutoIssueMeta,
  type AutoIssueOutcome,
  type AutoIssuePromotion,
} from './auto-issue-selection';
import { issueCouponGrantWorkflow, type IssueGrantResult } from './workflows/issue-coupon-grant-workflow';

/**
 * 트리거 자동발급 전면 차단 스위치. **두 진입점(라우트 · subscriber)이 같은 함수를 첫 줄에서 본다** —
 * 안 그러면 이 코드의 배포가 곧 A5 개통이다. 켜는 절차는 마스터플랜 「A5 개통」.
 */
export function isAutoIssueEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.COUPON_AUTO_ISSUE_ENABLED === 'true';
}

export type AutoIssueInput = { customerId: string; trigger: AutoIssueTrigger };

/**
 * 트리거 자동발급 한 번 (#775, 스펙 §4.2.1). 읽기(고객·메타·프로모션) → 순수 판정 → 워크플로 1회.
 *
 * 워크플로로 한 겹 더 감싸지 않는다 — 쓰기는 이미 `issueCouponGrantWorkflow` 를 지나(ADR-0034 결정 2)
 * 나머지는 읽기다. `workflow-engine-redis` 는 실행마다 상태를 영속하므로 가입마다 래퍼 기록을 하나 더
 * 남길 이유가 없다.
 *
 * 🔴 실패를 **모아서** 돌려주는 이유. 요청 하나가 터졌다고 던지면 A 의 실패가 같은 고객의 B·C 발급까지
 * 막는다. 반대로 삼키면 호출자가 성공으로 읽어 **그 쿠폰은 영영 안 나간다.** 그래서 「나머지는 다 시도하고
 * 실패는 `failed` 로 보고」다 — 라우트는 그것을 500 으로, subscriber 는 카운터로 올린다. 요청 단위
 * 격리는 스텝이 해 준다(`verdict === 'error'`).
 */
export async function autoIssueCoupons(container: MedusaContainer, input: AutoIssueInput): Promise<AutoIssueOutcome> {
  const { customerId, trigger } = input;
  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const promotionMetaService = container.resolve<PromotionMetaModuleService>(PROMOTION_META_MODULE);

  const { data: customers } = await query.graph({
    entity: 'customer',
    fields: ['id', 'groups.id'],
    filters: { id: customerId },
  });
  if (!customers?.length) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, `Customer ${customerId} not found`);
  }
  const customerGroupIds = new Set<string>(
    (customers[0].groups ?? []).map((g: { id: string }) => g.id),
  );

  const metas = (await promotionMetaService.getByAutoIssueTrigger(trigger)) as AutoIssueMeta[];
  if (!metas.length) return { issued: [], skipped: [], failed: [] };

  const { data: promotions } = await query.graph({
    entity: 'promotion',
    fields: ['id', 'code', 'status', 'is_automatic', 'rules.attribute', 'rules.operator', 'rules.values.value'],
    filters: { id: metas.map((m) => m.promotion_id), status: 'active', is_automatic: false },
  });

  const selection = selectAutoIssueCandidates({
    trigger,
    customerId,
    customerGroupIds,
    metas,
    promotions: promotions as AutoIssuePromotion[],
    now: new Date(),
  });

  for (const u of selection.unsupportedRules) {
    logger.warn(
      `[coupon] 자동발급 skip — 발급 시점에 평가할 수 없는 룰 (promotion_id=${u.promotion_id}, ` +
        `attribute=${u.attribute}, operator=${u.operator}, customer_id=${customerId}, trigger=${trigger}). ` +
        'modules/promotion-meta/issuance-rules.ts 의 분류표에 이 속성을 추가하고 평가를 구현할 것.',
    );
  }

  // 발급은 워크플로다 (ADR-0034 결정 1) — 요청 배치가 한 번에 지나간다 (PR-2 결정 3).
  const results: IssueGrantResult[] =
    selection.requests.length > 0
      ? (await issueCouponGrantWorkflow(container).run({ input: { requests: selection.requests } })).result.results
      : [];

  const folded = foldGrantResults(results, selection.codeById);
  for (const f of folded.failed) {
    logger.error(
      `[coupon] 자동발급 실패 (promotion_id=${f.promotion_id}, customer_id=${customerId}, trigger=${trigger}): ${f.error}`,
    );
  }

  return { issued: folded.issued, skipped: [...selection.skipped, ...folded.skipped], failed: folded.failed };
}
```

- [ ] **Step 2: 라우트를 얇게 만든다**

`apps/medusa/src/api/admin/customers/[id]/issue-coupons/route.ts` 전체를 이렇게 바꾼다:

```ts
import { AuthenticatedMedusaRequest, MedusaResponse } from '@medusajs/framework/http';
import { MedusaError } from '@medusajs/framework/utils';
import type { AutoIssueTrigger } from '../../../../../modules/promotion-meta/service';
import { autoIssueCoupons, isAutoIssueEnabled } from '../../../../../workflows/coupons/auto-issue-coupons';

// 🔴 이름을 바꾸지 말 것 — packages/domain-types/coupon-vocabulary-drift.spec.ts 가 이 상수를 앵커로 읽는다.
const VALID_TRIGGERS: AutoIssueTrigger[] = ['customer_registered', 'membership_activated'];

/**
 * POST /admin/customers/:id/issue-coupons
 * 트리거 기반 자동 발급: 지정 트리거에 등록된 활성 프로모션을 고객에게 발급한다.
 *
 * 두 역할이다 (#775):
 * - `membership_activated` 의 정상 입구 — channel-adapter 가 `MembershipStatusChanged` inbox 에서 부른다.
 * - `customer_registered` 의 **수동 복구 입구** — 정상 입구는 `subscribers/coupon-auto-issue-on-customer-created.ts`
 *   이고 재시도가 없으므로, 그 subscriber 가 실패 로그를 남기면 사람이 이 라우트를 한 번 부른다.
 *   발급 키가 결정적이라 몇 번 불러도 한 장이다.
 *
 * 판정·발급은 `workflows/coupons/auto-issue-coupons.ts` 가 한다. 여기엔 플래그 게이트·입력 검증·응답 모양만
 * 남는다 (ADR-0034 결정 3).
 */
export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const customerId = req.params.id;
  const { trigger } = req.body as { trigger: AutoIssueTrigger };

  // 트리거 자동발급 전면 차단. COUPON_AUTO_ISSUE_ENABLED=true 로만 켠다.
  // 200 + empty 로 응답해 channel-adapter 가 published 로 마킹하고 재시도하지 않게 한다.
  if (!isAutoIssueEnabled()) {
    return res.status(200).json({ issued: [], skipped: [] });
  }

  if (!trigger || !VALID_TRIGGERS.includes(trigger)) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, `trigger must be one of: ${VALID_TRIGGERS.join(', ')}`);
  }

  const { issued, skipped, failed } = await autoIssueCoupons(req.scope, { customerId, trigger });

  if (failed.length > 0) {
    // 사유 집합은 늘리지 않는다 — channel-adapter 가 `skipped.reason` 을 메트릭으로 세므로
    // 새 값은 그쪽 계약 변경이다. 실패는 200 의 사유가 아니라 500 으로 알린다.
    throw new MedusaError(
      MedusaError.Types.UNEXPECTED_STATE,
      `자동발급 실패 ${failed.length}건 (promotion_ids=${failed.map((f) => f.promotion_id).join(',')}, customer_id=${customerId}, trigger=${trigger})`,
    );
  }

  return res.status(200).json({ issued, skipped });
}
```

- [ ] **Step 3: 타입 게이트 + 어휘 가드**

Run:
```
npx tsc --noEmit -p apps/medusa/tsconfig.json
npx jest --testPathPattern 'coupon-vocabulary-drift' --maxWorkers=2
```
Expected: tsc 에러 수 = Step 1 기준선(3, 이 브랜치 무관). 어휘 가드 PASS(`VALID_TRIGGERS` 앵커가 여전히 잡힌다).

- [ ] **Step 4: 리팩터 가드 — 기존 HTTP 통합 스펙 무수정 통과**

Run:
```
COMPOSE_PROJECT_NAME=almondyoung-server docker compose up -d postgres redis
scripts/local/run-medusa-integration.sh --testPathPattern 'coupon-'
```
Expected: `coupon-issuance-rules.spec.ts` 를 포함해 전부 PASS. 실패하면 라우트 응답 모양이 바뀐 것이다 — 스펙을 고치지 말고 라우트를 고친다.

- [ ] **Step 5: 커밋**

```bash
git add apps/medusa/src/workflows/coupons/auto-issue-coupons.ts "apps/medusa/src/api/admin/customers/[id]/issue-coupons/route.ts"
git commit -m "refactor(coupon): 자동발급 오케스트레이터를 라우트에서 뽑는다 — 라우트는 게이트·응답만 (#775)

Claude-Session: https://claude.ai/code/session_01PphKuKs3h8JdVMVakkerg1"
```

---

### Task 3: Medusa 메트릭 — prom-client · 카운터 · `/metrics` 서버 · instrumentation

**Files:**
- Modify: `apps/medusa/package.json` · `apps/medusa/yarn.lock` · `apps/medusa/package-lock.json`
- Create: `apps/medusa/src/observability/coupon-issue.metrics.ts`
- Create: `apps/medusa/src/observability/metrics-server.ts`
- Modify: `apps/medusa/instrumentation.ts`
- Test: `apps/medusa/src/observability/__tests__/coupon-issue.metrics.unit.spec.ts` · `apps/medusa/src/observability/__tests__/metrics-server.unit.spec.ts`

**Interfaces:**
- Consumes: Task 1 의 `AutoIssueSkipReason`.
- Produces:
  ```ts
  // coupon-issue.metrics.ts
  export type AutoIssueOutcomeCounts = { issued: readonly unknown[]; skipped: readonly { reason: AutoIssueSkipReason }[] };
  export function recordAutoIssueOutcome(trigger: AutoIssueTrigger, result: AutoIssueOutcomeCounts): void;
  export function recordAutoIssueFailure(trigger: AutoIssueTrigger): void;   // kind='permanent' 고정
  // metrics-server.ts
  export function resolveMetricsPort(env?: NodeJS.ProcessEnv): number | undefined;
  export function startMetricsServer(env?: NodeJS.ProcessEnv): Server | undefined;
  ```
  Task 4 가 `record*` 둘을 쓴다.

- [ ] **Step 1: 의존성을 더한다 (lockfile 둘 다)**

Run (저장소 루트):
```
cd apps/medusa && yarn add prom-client@^15.1.3 && npm install --package-lock-only --no-audit --no-fund && cd ../..
git -C . diff --stat apps/medusa/package.json apps/medusa/yarn.lock apps/medusa/package-lock.json
```
Expected: 세 파일 모두 변경. `package.json` 의 `dependencies` 에 `"prom-client": "^15.1.3"` 가 `"postgres"` 다음, `"zod"` 앞에 들어간다(yarn 이 정렬한다).

- [ ] **Step 2: 메트릭 모듈의 실패하는 스펙**

`apps/medusa/src/observability/__tests__/coupon-issue.metrics.unit.spec.ts`:

```ts
import { register } from 'prom-client';
import { recordAutoIssueFailure, recordAutoIssueOutcome } from '../coupon-issue.metrics';

const value = async (name: string, labels: Record<string, string>): Promise<number> => {
  const metric = await register.getSingleMetric(name)!.get();
  const found = metric.values.find((v) => Object.entries(labels).every(([k, val]) => v.labels[k] === val));
  return found?.value ?? 0;
};

describe('Medusa 쪽 쿠폰 자동발급 메트릭 — channel-adapter 와 같은 이름·같은 라벨', () => {
  beforeEach(() => register.resetMetrics());

  it('발급 건수와 스킵 사유를 각각 센다', async () => {
    recordAutoIssueOutcome('customer_registered', {
      issued: [{ promotion_id: 'p1' }, { promotion_id: 'p2' }],
      skipped: [{ reason: 'already_issued' }, { reason: 'unsupported_rule' }],
    });
    expect(await value('coupon_auto_issue_total', { trigger: 'customer_registered', outcome: 'issued' })).toBe(2);
    expect(await value('coupon_auto_issue_total', { trigger: 'customer_registered', outcome: 'already_issued' })).toBe(1);
    expect(await value('coupon_auto_issue_total', { trigger: 'customer_registered', outcome: 'unsupported_rule' })).toBe(1);
  });

  it('발급 0·스킵 0 이면 시리즈를 만들지 않는다 (No Data 가 정상)', async () => {
    recordAutoIssueOutcome('customer_registered', { issued: [], skipped: [] });
    const metric = await register.getSingleMetric('coupon_auto_issue_total')!.get();
    expect(metric.values).toEqual([]);
  });

  it('실패는 전부 permanent 다 — 재시도가 없으므로 모든 실패가 최종이다', async () => {
    recordAutoIssueFailure('customer_registered');
    recordAutoIssueFailure('customer_registered');
    expect(await value('coupon_auto_issue_failures_total', { trigger: 'customer_registered', kind: 'permanent' })).toBe(2);
    expect(await value('coupon_auto_issue_failures_total', { trigger: 'customer_registered', kind: 'transient' })).toBe(0);
  });
});
```

- [ ] **Step 3: 실패를 확인한다**

Run: `npm --prefix apps/medusa run test:unit -- --testPathPattern coupon-issue.metrics`
Expected: FAIL — `Cannot find module '../coupon-issue.metrics'`.

- [ ] **Step 4: 메트릭 모듈을 쓴다**

`apps/medusa/src/observability/coupon-issue.metrics.ts`:

```ts
import { Counter, register } from 'prom-client';
import type { AutoIssueTrigger } from '../modules/promotion-meta/service';
import type { AutoIssueSkipReason } from '../workflows/coupons/auto-issue-selection';

/**
 * 쿠폰 자동발급 관측 — Medusa 쪽 (#775, 스펙 결정 1·5).
 *
 * `customer_registered` 는 이제 Medusa 안(`customer.created` subscriber)에서 발급되어 channel-adapter 의
 * 카운터를 지나지 않는다. 그래서 **같은 이름·같은 라벨**을 여기서 낸다 — Grafana 의
 * `sum by (trigger, outcome) (increase(coupon_auto_issue_total[1h]))` 가 job 구분 없이 두 트리거를 합산한다.
 * 세는 쪽은 «발화시킨 쪽»이다: `membership_activated` 는 channel-adapter, `customer_registered` 는 여기.
 * 라우트 안에서 세면 전자가 두 번 세어진다.
 *
 * channel-adapter 의 `KNOWN_OUTCOMES` 허용목록이 여기 없는 이유: `skipped.reason` 의 **생산자가 이 트리**라
 * 유니온(`AutoIssueSkipReason`)이 이미 닫혀 있다.
 *
 * 모듈 스코프 싱글턴이다 — prom-client 전역 register 는 같은 이름을 두 번 등록하면 던진다.
 * 노출은 `metrics-server.ts` 의 `:PORT+10000/metrics`, Alloy `prometheus.scrape "medusa"` 가 긁는다.
 */
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

export type AutoIssueOutcomeCounts = {
  issued: readonly unknown[];
  skipped: readonly { reason: AutoIssueSkipReason }[];
};

export function recordAutoIssueOutcome(trigger: AutoIssueTrigger, result: AutoIssueOutcomeCounts): void {
  if (result.issued.length > 0) autoIssueTotal.inc({ trigger, outcome: 'issued' }, result.issued.length);
  for (const entry of result.skipped) {
    autoIssueTotal.inc({ trigger, outcome: entry.reason });
  }
}

/**
 * `kind` 는 항상 `permanent` 다. subscriber 에는 재시도가 없어(스펙 결정 2) 모든 실패가 최종이고 사람이 봐야
 * 한다 — P7 의 알림 `failures_total{kind="permanent"} > 0` 이 정의 그대로 이 트리거를 덮는다.
 */
export function recordAutoIssueFailure(trigger: AutoIssueTrigger): void {
  autoIssueFailuresTotal.inc({ trigger, kind: 'permanent' });
}
```

- [ ] **Step 5: 메트릭 서버의 실패하는 스펙**

`apps/medusa/src/observability/__tests__/metrics-server.unit.spec.ts`:

```ts
import { once } from 'node:events';
import { resolveMetricsPort, startMetricsServer } from '../metrics-server';

describe('resolveMetricsPort — #613 의 교훈 셋', () => {
  it('METRICS_PORT 가 양의 정수면 그것', () => {
    expect(resolveMetricsPort({ METRICS_PORT: '19999', PORT: '9000' })).toBe(19999);
  });
  it('빈 문자열(Number("")===0)·NaN·0 은 미설정 → PORT+10000', () => {
    expect(resolveMetricsPort({ METRICS_PORT: '', PORT: '9000' })).toBe(19000);
    expect(resolveMetricsPort({ METRICS_PORT: 'abc', PORT: '9000' })).toBe(19000);
    expect(resolveMetricsPort({ METRICS_PORT: '0', PORT: '9000' })).toBe(19000);
  });
  it('PORT 도 없으면 undefined (서버를 안 띄운다)', () => {
    expect(resolveMetricsPort({})).toBeUndefined();
  });
});

describe('startMetricsServer', () => {
  it('/metrics 를 prom 텍스트로 답하고, 다른 경로는 404', async () => {
    const server = startMetricsServer({ METRICS_PORT: '0' /* 무시 */, PORT: String(30000 + (process.pid % 1000)) })!;
    await once(server, 'listening');
    const { port } = server.address() as { port: number };
    const ok = await fetch(`http://127.0.0.1:${port}/metrics`);
    expect(ok.status).toBe(200);
    expect(ok.headers.get('content-type')).toContain('text/plain');
    const nf = await fetch(`http://127.0.0.1:${port}/health`);
    expect(nf.status).toBe(404);
    server.close();
  });

  it('바인딩 실패는 던지지 않는다 — 관측 실패는 가용성 실패가 아니다', async () => {
    const port = String(31000 + (process.pid % 1000));
    const first = startMetricsServer({ PORT: port })!;
    await once(first, 'listening');
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const second = startMetricsServer({ PORT: port })!;
    await once(second, 'error');
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('메트릭 서버 바인딩 실패'));
    errorSpy.mockRestore();
    first.close();
  });
});
```

- [ ] **Step 6: 실패를 확인한다**

Run: `npm --prefix apps/medusa run test:unit -- --testPathPattern metrics-server`
Expected: FAIL — `Cannot find module '../metrics-server'`.

- [ ] **Step 7: 메트릭 서버를 쓴다 (libs/shared 의 소형 사본)**

`apps/medusa/src/observability/metrics-server.ts`:

```ts
import { createServer, Server } from 'node:http';
import { register } from 'prom-client';

/**
 * `libs/shared/src/observability/metrics-server.ts` 의 사본이다 — Medusa 는 번들러가 없어 `@app/*` 를
 * 런타임에 해석하지 못한다(같은 이유로 `@packages/*` 도 못 쓴다, ADR-0033 §7). 원본이 바뀌면 여기도 손본다.
 *
 * 메트릭 포트 = 앱 포트 + 10000. Medusa 는 Dockerfile 이 `PORT=9000` 을 박으므로 19000 이고, Alloy 의
 * `prometheus.scrape "medusa"` 가 그 숫자를 리터럴로 안다.
 */
export function resolveMetricsPort(env: NodeJS.ProcessEnv = process.env): number | undefined {
  const explicit = Number(env.METRICS_PORT);
  // 빈 문자열은 Number('') === 0 이라 `>= 0` 로 두면 폴백을 건너뛰고 OS 임의 포트에 붙는다 — Alloy 는 고정
  // 포트만 긁으므로 영구 up=0 이 되고 로그에 단서가 없다. `> 0` 이어야 한다 (#613 리뷰).
  if (Number.isInteger(explicit) && explicit > 0) return explicit;
  const appPort = Number(env.PORT);
  if (!Number.isInteger(appPort) || appPort <= 0) return undefined;
  return appPort + 10000;
}

function logError(msg: string, extra?: Record<string, unknown>): void {
  console.error(
    JSON.stringify({ level: 'error', service_name: 'medusa-metrics-server', time: new Date().toISOString(), msg, ...extra }),
  );
}

/**
 * Prometheus 스크레이프용 최소 HTTP 서버. Medusa 의 라우트 로더·미들웨어 밖이고, Medusa 의 `instrument.http` 는
 * 라우트 레이어 자체 계측이라 이 서버는 trace 를 만들지 않는다(스펙 §2 ⑥).
 *
 * ALB 는 앱 포트만 포워딩하고 태스크는 private subnet 이라 이 포트에 인터넷 경로가 없다 — 인증 가드 없음.
 */
export function startMetricsServer(env: NodeJS.ProcessEnv = process.env): Server | undefined {
  const port = resolveMetricsPort(env);
  if (port === undefined) return undefined;

  const server = createServer((req, res) => {
    if (req.url !== '/metrics') {
      res.writeHead(404).end();
      return;
    }
    register
      .metrics()
      .then((body) => {
        res.writeHead(200, { 'Content-Type': register.contentType });
        res.end(body);
      })
      .catch((err: unknown) => {
        logError('메트릭 수집 실패', { error: err instanceof Error ? err.message : String(err) });
        res.writeHead(500).end();
      });
  });

  // 리스너 없는 'error' 는 Node 가 throw 한다. 이 함수는 instrumentation.ts 에서 앱 부팅 전에 돌므로
  // EADDRINUSE 를 그대로 두면 uncaughtException 으로 프로세스가 죽는다 — 관측 실패가 가용성 실패로 승격된다.
  server.on('error', (err: NodeJS.ErrnoException) => {
    logError('메트릭 서버 바인딩 실패 — 프로세스는 계속 실행된다', { port, code: err.code, error: err.message });
  });

  server.listen(port, '0.0.0.0');
  server.unref();
  return server;
}
```

- [ ] **Step 8: 두 스펙 통과 확인**

Run: `npm --prefix apps/medusa run test:unit -- --testPathPattern 'observability'`
Expected: PASS (기존 observability 스펙 + 신규 2 파일).

- [ ] **Step 9: instrumentation.ts 에서 서버를 띄운다 — OTLP endpoint 와 독립**

`apps/medusa/instrumentation.ts` 의 import 블록에 한 줄을 더하고, `register()` 의 **첫 줄**에서 기동한다:

```ts
import { RedactingSpanExporter } from './src/observability/redacting-span-exporter';
import { startMetricsServer } from './src/observability/metrics-server';

export function register() {
  // Prometheus /metrics (:PORT+10000). OTLP endpoint 유무와 무관하게 연다 — 아래 early return 앞에 둔다.
  // 쿠폰 자동발급 카운터(#775)가 여기로 나간다. 포트 파생 규칙은 metrics-server.ts.
  startMetricsServer();

  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  if (!endpoint) {
```
(나머지는 그대로.)

- [ ] **Step 10: instrumentation 타입 게이트**

Run: `npx tsc --noEmit --project apps/medusa/tsconfig.instrumentation.json`
Expected: 0 에러.

- [ ] **Step 11: 커밋**

```bash
git add apps/medusa/package.json apps/medusa/yarn.lock apps/medusa/package-lock.json apps/medusa/instrumentation.ts apps/medusa/src/observability/coupon-issue.metrics.ts apps/medusa/src/observability/metrics-server.ts apps/medusa/src/observability/__tests__/coupon-issue.metrics.unit.spec.ts apps/medusa/src/observability/__tests__/metrics-server.unit.spec.ts
git commit -m "feat(medusa): prom-client 카운터 + :19000/metrics — 쿠폰 자동발급 관측 (#775)

Claude-Session: https://claude.ai/code/session_01PphKuKs3h8JdVMVakkerg1"
```

---

### Task 4: subscriber `customer.created` → `customer_registered`

**Files:**
- Create: `apps/medusa/src/subscribers/coupon-auto-issue-on-customer-created.ts`
- Test: `apps/medusa/src/subscribers/__tests__/coupon-auto-issue-on-customer-created.unit.spec.ts`

**Interfaces:**
- Consumes: Task 2 `autoIssueCoupons` · `isAutoIssueEnabled`, Task 3 `recordAutoIssueOutcome` · `recordAutoIssueFailure`.
- Produces: default export `handleCouponAutoIssueOnCustomerCreated(args: SubscriberArgs<{ id: string }>)`, `config.event === 'customer.created'`, `config.context.subscriberId === 'coupon-auto-issue-customer-registered'`. Task 5·6·8 이 파일 경로와 이벤트명을 읽는다.

- [ ] **Step 1: 실패하는 유닛 스펙**

`apps/medusa/src/subscribers/__tests__/coupon-auto-issue-on-customer-created.unit.spec.ts`:

```ts
import handleCouponAutoIssueOnCustomerCreated, { config } from '../coupon-auto-issue-on-customer-created';

jest.mock('../../workflows/coupons/auto-issue-coupons', () => ({
  isAutoIssueEnabled: jest.fn(),
  autoIssueCoupons: jest.fn(),
}));
jest.mock('../../observability/coupon-issue.metrics', () => ({
  recordAutoIssueOutcome: jest.fn(),
  recordAutoIssueFailure: jest.fn(),
}));

import { autoIssueCoupons, isAutoIssueEnabled } from '../../workflows/coupons/auto-issue-coupons';
import { recordAutoIssueFailure, recordAutoIssueOutcome } from '../../observability/coupon-issue.metrics';

function makeContainer(customers: Array<{ id: string; has_account: boolean }>) {
  const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  const query = { graph: jest.fn().mockResolvedValue({ data: customers }) };
  const container = {
    resolve: (key: string) => {
      if (key === 'query') return query;
      if (key === 'logger') return logger;
      throw new Error(`unexpected resolve: ${key}`);
    },
  };
  return { container, logger, query };
}

const run = (container: any, id?: string) =>
  handleCouponAutoIssueOnCustomerCreated({ event: { data: id ? { id } : {} }, container } as any);

describe('coupon-auto-issue-on-customer-created 구독자', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (isAutoIssueEnabled as jest.Mock).mockReturnValue(true);
  });

  it('customer.created 에 subscriberId 를 달고 등록된다', () => {
    expect(config.event).toBe('customer.created');
    expect(config.context?.subscriberId).toBe('coupon-auto-issue-customer-registered');
  });

  it('플래그가 꺼져 있으면 조회조차 하지 않는다 — 이 코드의 배포가 개통이면 안 된다', async () => {
    (isAutoIssueEnabled as jest.Mock).mockReturnValue(false);
    const { container, query } = makeContainer([{ id: 'cus_1', has_account: true }]);
    await run(container, 'cus_1');
    expect(query.graph).not.toHaveBeenCalled();
    expect(autoIssueCoupons).not.toHaveBeenCalled();
  });

  it('id 가 없으면 아무것도 하지 않는다', async () => {
    const { container, query } = makeContainer([]);
    await run(container);
    expect(query.graph).not.toHaveBeenCalled();
  });

  it('has_account=false(어드민 생성·게스트)는 회원가입이 아니다 — 발급 0', async () => {
    const { container } = makeContainer([{ id: 'cus_1', has_account: false }]);
    await run(container, 'cus_1');
    expect(autoIssueCoupons).not.toHaveBeenCalled();
    expect(recordAutoIssueOutcome).not.toHaveBeenCalled();
  });

  it('has_account=true 면 customer_registered 로 발급하고 결과를 센다', async () => {
    const outcome = { issued: [{ promotion_id: 'p1', code: 'A' }], skipped: [{ promotion_id: 'p2', reason: 'already_issued' }], failed: [] };
    (autoIssueCoupons as jest.Mock).mockResolvedValue(outcome);
    const { container, logger, query } = makeContainer([{ id: 'cus_1', has_account: true }]);

    await run(container, 'cus_1');

    expect(query.graph).toHaveBeenCalledWith({ entity: 'customer', fields: ['id', 'has_account'], filters: { id: 'cus_1' } });
    expect(autoIssueCoupons).toHaveBeenCalledWith(container, { customerId: 'cus_1', trigger: 'customer_registered' });
    expect(recordAutoIssueOutcome).toHaveBeenCalledWith('customer_registered', outcome);
    expect(recordAutoIssueFailure).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('cus_1'));
  });

  it('failed 가 있으면 실패 카운터 + error 로그에 복구 명령을 싣는다', async () => {
    (autoIssueCoupons as jest.Mock).mockResolvedValue({ issued: [], skipped: [], failed: [{ promotion_id: 'p1', error: 'boom' }] });
    const { container, logger } = makeContainer([{ id: 'cus_1', has_account: true }]);

    await run(container, 'cus_1');

    expect(recordAutoIssueFailure).toHaveBeenCalledWith('customer_registered');
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('/admin/customers/cus_1/issue-coupons'));
  });

  it('던져지면 삼키고(재시도 없음) 실패 카운터 + error 로그', async () => {
    (autoIssueCoupons as jest.Mock).mockRejectedValue(new Error('db down'));
    const { container, logger } = makeContainer([{ id: 'cus_1', has_account: true }]);

    await expect(run(container, 'cus_1')).resolves.toBeUndefined();

    expect(recordAutoIssueFailure).toHaveBeenCalledWith('customer_registered');
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('db down'));
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('/admin/customers/cus_1/issue-coupons'));
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npm --prefix apps/medusa run test:unit -- --testPathPattern coupon-auto-issue-on-customer-created`
Expected: FAIL — `Cannot find module '../coupon-auto-issue-on-customer-created'`.

- [ ] **Step 3: subscriber 를 쓴다**

`apps/medusa/src/subscribers/coupon-auto-issue-on-customer-created.ts`:

```ts
import { ContainerRegistrationKeys } from '@medusajs/framework/utils';
import { type SubscriberConfig, type SubscriberArgs } from '@medusajs/medusa';
import { recordAutoIssueFailure, recordAutoIssueOutcome } from '../observability/coupon-issue.metrics';
import { autoIssueCoupons, isAutoIssueEnabled } from '../workflows/coupons/auto-issue-coupons';

const TRIGGER = 'customer_registered' as const;

/**
 * 회원가입 자동발급의 입구 (#775, ADR-0035).
 *
 * 옛 입구는 user-service 의 Kafka `UserEmailVerified` 였는데 발행 코드가 도달 불가라(가입이 사용자를 이미
 * 인증된 상태로 넣는다) 한 번도 발화하지 못했다. 여기는 Medusa 코어가 고객 생성 워크플로 끝에 네이티브로
 * 내는 `customer.created` 를 듣는다 — 우리 가입 경로(`workflows/auth/.../register-customer-workflow.ts`)가
 * 그 워크플로를 지나므로 이벤트가 실제로 뜨고, **고객이 정의상 존재**해 「Medusa 고객 미존재 → 백오프」
 * 함정이 원인부터 사라진다.
 *
 * `has_account` 게이트: `customer.created` 는 어드민이 만든 고객(코어 `POST /admin/customers`, has_account=false)
 * 에도 뜬다. «회원가입» 은 인증 계정이 붙은 고객뿐이다. 게스트 결제 고객은 오늘은 이벤트 없이 생기지만
 * 엔진이 바뀌어도 같은 게이트가 덮는다.
 *
 * 🔴 재시도가 없다. Redis 이벤트버스의 기본 attempts 는 1 이고 우리 설정은 안 바꿨다(스펙 결정 2 — 같은
 * 프로세스·같은 DB 라 남는 실패는 순단과 버그뿐). 그래서 실패는 **삼키되 보이게** 한다: 카운터
 * `coupon_auto_issue_failures_total{trigger="customer_registered",kind="permanent"}` + error 로그. 복구는
 * 사람이 아래 로그의 명령을 한 번 부른다 — 발급 키가 결정적이라 몇 번 불러도 한 장이다.
 */
export default async function handleCouponAutoIssueOnCustomerCreated({
  event: { data },
  container,
}: SubscriberArgs<{ id: string }>) {
  if (!isAutoIssueEnabled()) return;
  const customerId = data?.id;
  if (!customerId) return;

  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const repair = `POST /admin/customers/${customerId}/issue-coupons {"trigger":"${TRIGGER}"}`;

  try {
    const { data: customers } = await query.graph({
      entity: 'customer',
      fields: ['id', 'has_account'],
      filters: { id: customerId },
    });
    const customer = customers?.[0] as { id: string; has_account?: boolean | null } | undefined;
    if (!customer?.has_account) return;

    const outcome = await autoIssueCoupons(container, { customerId, trigger: TRIGGER });
    recordAutoIssueOutcome(TRIGGER, outcome);

    if (outcome.failed.length > 0) {
      recordAutoIssueFailure(TRIGGER);
      logger.error(
        `[coupon] 회원가입 자동발급 일부 실패 (customer_id=${customerId}, promotion_ids=${outcome.failed
          .map((f) => f.promotion_id)
          .join(',')}). 재시도 없음 — 수동 복구: ${repair}`,
      );
    }
    if (outcome.issued.length > 0) {
      logger.info(
        `[coupon] 회원가입 자동발급 ${outcome.issued.length}장 (customer_id=${customerId}, codes=${outcome.issued
          .map((i) => i.code)
          .join(',')})`,
      );
    }
  } catch (e: any) {
    recordAutoIssueFailure(TRIGGER);
    logger.error(
      `[coupon] 회원가입 자동발급 실패 (customer_id=${customerId}): ${e?.message ?? e}. 재시도 없음 — 수동 복구: ${repair}`,
    );
  }
}

export const config: SubscriberConfig = {
  event: 'customer.created',
  context: { subscriberId: 'coupon-auto-issue-customer-registered' },
};
```

- [ ] **Step 4: 통과 확인 + 타입**

Run:
```
npm --prefix apps/medusa run test:unit -- --testPathPattern coupon-auto-issue-on-customer-created
npx tsc --noEmit -p apps/medusa/tsconfig.json
```
Expected: PASS (7 tests). tsc 는 기준선 3.

- [ ] **Step 5: 커밋**

```bash
git add apps/medusa/src/subscribers/coupon-auto-issue-on-customer-created.ts apps/medusa/src/subscribers/__tests__/coupon-auto-issue-on-customer-created.unit.spec.ts
git commit -m "feat(coupon): customer.created subscriber — customer_registered 의 새 입구 (#775)

Claude-Session: https://claude.ai/code/session_01PphKuKs3h8JdVMVakkerg1"
```

---

### Task 5: HTTP 통합 스펙 — subscriber 직접 호출 + 실제 워크플로 end-to-end

**Files:**
- Create: `apps/medusa/integration-tests/http/coupon-auto-issue-subscriber.spec.ts`

**Interfaces:**
- Consumes: Task 4 의 default export + `config`; `PromotionMetaModuleService.listGrantsForCustomer(customerId): Promise<CouponGrantRow[]>` (기존, `service.ts:353`).

- [ ] **Step 1: 스펙을 쓴다**

```ts
import { medusaIntegrationTestRunner } from '@medusajs/test-utils';
import { ContainerRegistrationKeys, Modules } from '@medusajs/framework/utils';
import { createCustomerAccountWorkflow } from '@medusajs/core-flows';
import jwt from 'jsonwebtoken';
import { PROMOTION_META_MODULE } from '../../src/modules/promotion-meta';
import handleCouponAutoIssueOnCustomerCreated from '../../src/subscribers/coupon-auto-issue-on-customer-created';

jest.setTimeout(180 * 1000);

/**
 * 회원가입 자동발급의 «층 사이» 증명 (#775, 스펙 §6).
 *
 * 앞부분은 subscriber 를 직접 부른다(`coupon-consume.spec.ts` 선례) — 결정적이다. 마지막 케이스는
 * **실제 `createCustomerAccountWorkflow`** 로 고객을 만들고 로컬 이벤트버스가 subscriber 를 깨워 `coupon_grant`
 * 행이 생기는지를 본다 — 「발행자가 실제로 있다」의 자동 증명이다. 그 케이스가 환경에서 불안정하면
 * (`it.skip` 으로 두지 말고) 원인을 이 파일 헤더에 적고 플랜 Task 5 의 기록 항목을 채울 것.
 */
medusaIntegrationTestRunner({
  inApp: true,
  env: { COUPON_AUTO_ISSUE_ENABLED: 'true' },
  disableAutoTeardown: true,
  testSuite: ({ api, getContainer }) => {
    let adminHeaders: { headers: Record<string, string> };
    let seq = 0;

    beforeEach(async () => {
      seq++;
      const container = getContainer();
      const config = container.resolve(ContainerRegistrationKeys.CONFIG_MODULE) as any;
      const secret = config.projectConfig.http.jwtSecret;
      const userModule = container.resolve(Modules.USER);
      const [user] = await userModule.createUsers([{ email: `admin${seq}@sub.test` }]);
      adminHeaders = {
        headers: {
          authorization: `Bearer ${jwt.sign(
            { actor_id: user.id, actor_type: 'user', auth_identity_id: 'a', app_metadata: { user_id: user.id } },
            secret,
          )}`,
        },
      };
    });

    const createTriggerPromo = async (code: string) => {
      const res = await api.post(
        '/admin/promotions',
        {
          code,
          type: 'standard',
          is_automatic: false,
          status: 'active',
          application_method: { type: 'percentage', value: 10, target_type: 'order', currency_code: 'krw' },
          rules: [],
          additional_data: { visibility: 'assigned_only', auto_issue_trigger: 'customer_registered', validity_days: 30 },
        },
        adminHeaders,
      );
      return res.data.promotion.id as string;
    };

    const grantsOf = async (customerId: string) =>
      (getContainer().resolve(PROMOTION_META_MODULE) as any).listGrantsForCustomer(customerId);

    const invoke = (customerId: string) =>
      handleCouponAutoIssueOnCustomerCreated({ event: { data: { id: customerId } }, container: getContainer() } as any);

    describe('subscriber 직접 호출', () => {
      it('has_account 고객이면 트리거 쿠폰이 한 장 생기고, 두 번 불려도 한 장이다', async () => {
        const promoId = await createTriggerPromo(`SUB${seq}A`);
        const customerModule = getContainer().resolve(Modules.CUSTOMER);
        const [cust] = await customerModule.createCustomers([{ email: `acct${seq}@sub.test`, has_account: true }]);

        await invoke(cust.id);
        await invoke(cust.id);

        const grants = await grantsOf(cust.id);
        expect(grants).toHaveLength(1);
        expect(grants[0]).toEqual(
          expect.objectContaining({ promotion_id: promoId, issued_via: 'customer_registered', issue_key: 'trigger:customer_registered' }),
        );
        expect(grants[0].expires_at).not.toBeNull();
      });

      it('has_account=false 고객(어드민 생성·게스트)에는 아무것도 생기지 않는다', async () => {
        await createTriggerPromo(`SUB${seq}B`);
        const customerModule = getContainer().resolve(Modules.CUSTOMER);
        const [guest] = await customerModule.createCustomers([{ email: `guest${seq}@sub.test` }]);

        await invoke(guest.id);

        expect(await grantsOf(guest.id)).toEqual([]);
      });

      it('플래그가 꺼져 있으면 아무것도 생기지 않는다', async () => {
        await createTriggerPromo(`SUB${seq}C`);
        const customerModule = getContainer().resolve(Modules.CUSTOMER);
        const [cust] = await customerModule.createCustomers([{ email: `off${seq}@sub.test`, has_account: true }]);
        const prev = process.env.COUPON_AUTO_ISSUE_ENABLED;
        process.env.COUPON_AUTO_ISSUE_ENABLED = 'false';
        try {
          await invoke(cust.id);
        } finally {
          process.env.COUPON_AUTO_ISSUE_ENABLED = prev;
        }
        expect(await grantsOf(cust.id)).toEqual([]);
      });
    });

    describe('층 사이 — 실제 고객 생성 워크플로가 subscriber 를 깨운다', () => {
      it('createCustomerAccountWorkflow → customer.created → coupon_grant 행 (손으로 아무것도 안 부른다)', async () => {
        const promoId = await createTriggerPromo(`SUB${seq}E2E`);
        const container = getContainer();
        const authModule = container.resolve(Modules.AUTH);
        const email = `e2e${seq}@sub.test`;
        const [identity] = await authModule.createAuthIdentities([
          { provider_identities: [{ provider: 'emailpass', entity_id: email, provider_metadata: {} }] },
        ]);

        const { result: customer } = await createCustomerAccountWorkflow(container).run({
          input: { authIdentityId: identity.id, customerData: { email } },
        });

        // 이벤트는 워크플로 커밋 뒤 비동기로 풀린다 — 짧게 폴링한다.
        const deadline = Date.now() + 10_000;
        let grants: any[] = [];
        while (Date.now() < deadline) {
          grants = await grantsOf(customer.id);
          if (grants.length > 0) break;
          await new Promise((r) => setTimeout(r, 200));
        }

        expect(grants).toHaveLength(1);
        expect(grants[0]).toEqual(expect.objectContaining({ promotion_id: promoId, issued_via: 'customer_registered' }));
      });
    });
  },
});
```

- [ ] **Step 2: 실행**

Run: `scripts/local/run-medusa-integration.sh --testPathPattern 'coupon-auto-issue-subscriber'`
Expected: 4 tests PASS. **마지막 케이스가 실패하면** 먼저 로컬 버스가 subscriber 를 로드했는지 확인한다 — Medusa 부팅 로그에 `coupon-auto-issue-customer-registered` 가 보이는지, `createCustomerAccountWorkflow` 가 `has_account: true` 로 만들었는지(`customer.has_account`). 그래도 안 되면 그 케이스를 `it.skip` 하지 말고 **실패 원인을 파일 헤더 주석에 적고 이 플랜의 아래 기록 칸을 채운 뒤** 직접 호출 3건만으로 진행한다.

기록 (실행자가 채운다): e2e 케이스 결과 = ______ (통과 / 실패 — 원인: ______).

- [ ] **Step 3: 커밋**

```bash
git add apps/medusa/integration-tests/http/coupon-auto-issue-subscriber.spec.ts
git commit -m "test(coupon): customer.created → 발급의 실 DB 통합 스펙 — 직접 호출 + 워크플로 e2e (#775)

Claude-Session: https://claude.ai/code/session_01PphKuKs3h8JdVMVakkerg1"
```

---

### Task 6: 후속 이슈 신설 + 가드 B (subscriber 이벤트 → 코어 emit 상수)

**Files:**
- Create: `apps/medusa/src/subscribers/__tests__/subscriber-events-have-emitters.unit.spec.ts`

**Interfaces:**
- Consumes: `apps/medusa/node_modules/@medusajs/utils/dist/core-flows/events.js` (엔진 상수), `src/subscribers/*.ts` 의 `config.event`.
- Produces: `KNOWN_DEAD` 예외 목록(이슈 번호 필수). Task 10 이 ADR 에서 이 스펙을 가드 규칙의 구현으로 가리킨다.

- [ ] **Step 1: 후속 이슈를 만든다 (사람 확인 후)**

Run:
```
gh issue create --repo LCNINE/almondyoung-server --title "Medusa user.updated·user.deleted subscriber 가 죽어 있다 — 이메일 동기화·탈퇴 익명화 미전파" --body-file - <<'BODY'
## 무엇

`apps/medusa/src/subscribers/user.updated.ts` · `user.deleted.ts` 가 `event: 'users.events.v1'` 을 기다리는데, **그 이름을 emit 하는 코드가 없다.**

- Medusa 는 Kafka 를 소비하지 않는다(`medusa-config.js` 모듈 6개 전부 확인, loader 없음).
- Medusa 의 BullMQ 큐(`{medusa-events}`)에 밖에서 넣는 코드 0곳(channel-adapter·user-service·membership·libs 전수 grep).
- `apps/medusa/src` 에서 `emitEventStep`/`eventBus.emit` 으로 커스텀 이벤트를 내는 곳 0.

정황이 아니라 정적 증명이다. #775 조사 중 발견(같은 실패 모드 「구독자는 있는데 발행자가 없다」).

## 영향

- `user.updated`: user-service 에서 이메일이 바뀌어도 Medusa customer email 이 안 따라간다 → 멤버십 그룹 sync 의 유령고객 가드 오작동 가능.
- `user.deleted`: **탈퇴 회원의 Medusa 고객 정보 익명화가 안 된다** → 이름·이메일이 남는다(개인정보). 쿠폰과 무관하게 우선순위 높음.

## 가드

`apps/medusa/src/subscribers/__tests__/subscriber-events-have-emitters.unit.spec.ts` 의 `KNOWN_DEAD` 에 이 이슈 번호로 올라 있다. 고치면 그 항목을 지운다(안 지우면 스펙이 «stale» 로 빨개진다).

## 선택지 (조사 필요)

1. channel-adapter 가 `UserUpdated`/`UserDeleted` inbox 에서 Medusa admin API 를 부른다(`membership-medusa-sync` 와 같은 모양).
2. Medusa 에 내부 라우트를 두고 user-service 가 직접 부른다.
BODY
```
Expected: 이슈 URL 이 출력된다. 번호를 `NNN` 으로 적어 두고 다음 스텝의 `'#NNN'` 에 넣는다.

- [ ] **Step 2: 가드 B 스펙을 쓴다 (먼저 빨개지는 것을 본다)**

`apps/medusa/src/subscribers/__tests__/subscriber-events-have-emitters.unit.spec.ts` — 처음엔 `KNOWN_DEAD` 를 **빈 객체**로 쓴다:

```ts
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * 가드 B (#775, ADR-0035): **subscriber 가 듣는 이벤트는 누군가 emit 한다.**
 *
 * 2026-09 에 같은 실패 모드가 셋 있었다 — 구독자는 있는데 발행자가 없다. 각 층의 테스트는 전부 초록이었다.
 * 깨진 곳이 층 사이라서다. 이 스펙은 그 사이를 본다: `src/subscribers/*.ts` 의 `config.event` 가
 * **Medusa 코어 이벤트 상수**(`@medusajs/utils` `core-flows/events.js`) 안에 있어야 한다. 우리 소스가 emit 하는
 * 커스텀 이벤트는 오늘 0개라(전수 grep) 그 집합으로 충분하다 — 생기면 여기에 `emitEventStep` 스캔을 더한다.
 *
 * 예외는 `KNOWN_DEAD` 뿐이고 **이슈 번호가 필수**다. 그 이슈가 닫히면 항목을 지운다 — 안 지우면 «stale» 로 빨개진다.
 */
const KNOWN_DEAD: Record<string, string> = {};

const SUBSCRIBERS_DIR = path.join(__dirname, '..');

function coreEventNames(): Set<string> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- 엔진 내부 경로를 의도적으로 참조한다
  const pkgJsonPath = require.resolve('@medusajs/utils/package.json');
  const source = readFileSync(path.join(path.dirname(pkgJsonPath), 'dist/core-flows/events.js'), 'utf8');
  return new Set([...source.matchAll(/"([a-z_-]+\.[a-z_]+)"/g)].map((m) => m[1]));
}

function subscriberFiles(): string[] {
  return readdirSync(SUBSCRIBERS_DIR)
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.spec.ts'))
    .sort();
}

function subscribedEvents(file: string): string[] {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- 설정 객체만 읽는다
  const mod = require(path.join(SUBSCRIBERS_DIR, file)) as { config?: { event?: string | string[] } };
  const event = mod.config?.event;
  if (!event) throw new Error(`${file}: export const config 에 event 가 없다`);
  return Array.isArray(event) ? event : [event];
}

describe('가드 B — subscriber 가 듣는 이벤트는 코어가 emit 한다', () => {
  const core = coreEventNames();

  it('코어 상수를 읽었다 (경로가 바뀌면 여기가 먼저 빨개진다)', () => {
    expect(core.has('customer.created')).toBe(true);
    expect(core.has('order.placed')).toBe(true);
  });

  for (const file of subscriberFiles()) {
    it(`${file}`, () => {
      const dead = subscribedEvents(file).filter((e) => !core.has(e) && !(e in KNOWN_DEAD));
      expect(dead).toEqual([]);
    });
  }

  it('KNOWN_DEAD 의 값은 이슈 번호이고, 키는 아직 실제로 구독되고 있다', () => {
    const subscribed = new Set(subscriberFiles().flatMap(subscribedEvents));
    for (const [event, issue] of Object.entries(KNOWN_DEAD)) {
      expect(issue).toMatch(/^#\d+$/);
      expect(subscribed.has(event)).toBe(true); // stale 항목 — 고쳤으면 지울 것
    }
  });
});
```

- [ ] **Step 3: 빨간 것을 확인한다 — 가드가 가족을 잡는다는 실증**

Run: `npm --prefix apps/medusa run test:unit -- --testPathPattern subscriber-events-have-emitters`
Expected: `user.deleted.ts` · `user.updated.ts` 두 케이스 FAIL(`dead` = `['users.events.v1']`), 나머지 subscriber(`coupon-auto-issue-on-customer-created.ts` 포함) PASS.

- [ ] **Step 4: 예외 목록에 이슈 번호를 단다**

```ts
const KNOWN_DEAD: Record<string, string> = {
  // Medusa 는 Kafka 를 소비하지 않는다 — user.updated.ts · user.deleted.ts 가 기다리는 이 이름을 내는 곳이 없다.
  'users.events.v1': '#NNN',
};
```
(`NNN` 은 Step 1 의 번호.)

- [ ] **Step 5: 초록 확인**

Run: `npm --prefix apps/medusa run test:unit -- --testPathPattern subscriber-events-have-emitters`
Expected: 전부 PASS.

- [ ] **Step 6: 커밋**

```bash
git add apps/medusa/src/subscribers/__tests__/subscriber-events-have-emitters.unit.spec.ts
git commit -m "test(medusa): 가드 B — subscriber 가 듣는 이벤트는 코어가 emit 한다 (#775, 죽은 둘은 #NNN)

Claude-Session: https://claude.ai/code/session_01PphKuKs3h8JdVMVakkerg1"
```

---

### Task 7: channel-adapter — `UserEmailVerified` 경로 삭제

**Files:**
- Modify: `apps/channel-adapter/src/consumers/user-event.consumer.ts` (핸들러 1개 삭제)
- Modify: `apps/channel-adapter/src/adapters/medusa/inbox-worker.service.ts:26,42,444-455`
- Modify: `apps/channel-adapter/src/services/coupon-issue-reconciliation.service.ts` (분기·상수·메서드 삭제, 반환형 축소)
- Modify: `apps/channel-adapter/src/controllers/internal-membership.controller.ts:94-106`
- Modify: `apps/channel-adapter/src/observability/coupon-issue.metrics.ts:18`
- Modify: `apps/channel-adapter/src/observability/coupon-issue.metrics.spec.ts` · `apps/channel-adapter/src/adapters/medusa/inbox-worker.service.spec.ts:534`

**Interfaces:**
- Produces: `COUPON_TRIGGER_EVENT_TYPES = ['MembershipStatusChanged']`, `CouponIssueReconciliationService.runManually(): Promise<{ reset: number; skipped: number }>`. `MedusaClient.issuePromotionsByTrigger` 의 시그니처는 **불변**.

- [ ] **Step 1: 메트릭 스펙을 먼저 고친다 (빨개지는 것을 본다)**

`coupon-issue.metrics.spec.ts` 에서:
- 「백로그 게이지는 행이 없는 타입을 0 으로 되돌린다」 케이스를 이렇게 바꾼다:
```ts
  it('백로그 게이지는 행이 없는 타입을 0 으로 되돌린다', async () => {
    recordCouponIssueBacklog([{ eventType: 'MembershipStatusChanged', count: 3 }]);
    expect(await value('coupon_issue_inbox_failed_rows', { event_type: 'MembershipStatusChanged' })).toBe(3);

    // 다음 회차에 3건이 해소되면 게이지도 내려가야 한다 — 안 그러면 알림이 영원히 켜져 있다.
    recordCouponIssueBacklog([]);
    expect(await value('coupon_issue_inbox_failed_rows', { event_type: 'MembershipStatusChanged' })).toBe(0);
  });
```
- 마지막 케이스를 이렇게 바꾼다:
```ts
  it('트리거 이벤트 타입은 MembershipStatusChanged 하나다 — customer_registered 는 Medusa 안에서 발화한다 (#775)', () => {
    expect([...COUPON_TRIGGER_EVENT_TYPES]).toEqual(['MembershipStatusChanged']);
  });
```

Run: `npx jest --testPathPattern 'coupon-issue.metrics' --maxWorkers=2`
Expected: 마지막 케이스 FAIL.

- [ ] **Step 2: 메트릭 모듈**

`coupon-issue.metrics.ts:18` 을:
```ts
/**
 * 발급 트리거를 나르는 inbox 이벤트 타입. 리컨실과 게이지가 공유한다.
 * `UserEmailVerified` 는 #775 로 빠졌다 — `customer_registered` 는 Medusa 의 `customer.created` subscriber 가
 * 발화시키고 inbox 를 지나지 않는다.
 */
export const COUPON_TRIGGER_EVENT_TYPES = ['MembershipStatusChanged'] as const;
```

Run: `npx jest --testPathPattern 'coupon-issue.metrics' --maxWorkers=2` → PASS.

- [ ] **Step 3: 소비자 핸들러 삭제**

`user-event.consumer.ts` 에서 `@On(USER_STREAM, 'UserEmailVerified')` 로 시작하는 `onUserEmailVerified` 메서드 전체(주석 포함, `@On(USER_STREAM, 'Cafe24Linked')` 직전까지)를 지운다. 클래스 docstring 은 그대로다(Cafe24 연동만 서술하고 있다).

- [ ] **Step 4: inbox 워커**

`inbox-worker.service.ts`:
- import 블록의 `UserEmailVerifiedPayload,` 줄 삭제.
- `INBOX_WORKER_EVENT_TYPES` 에서 `'UserEmailVerified',` 줄 삭제.
- `case 'UserEmailVerified': { … }` 블록 전체 삭제(`case 'Cafe24Linked'` 직전까지).
- `SlowRetryInboxError` import 는 남긴다(`:676` 이 여전히 쓴다).

- [ ] **Step 5: 리컨실 서비스**

`coupon-issue-reconciliation.service.ts`:
- `import type { UserEmailVerifiedPayload } …` 줄 삭제.
- `LOOKBACK_MS_REGISTRATION` 상수와 그 위 주석 삭제. `LOOKBACK_MS_MEMBERSHIP` 은 남긴다.
- `runManually` 의 반환형을 `Promise<{ reset: number; skipped: number }>` 로.
- `run()` 을 이렇게 바꾼다:
```ts
  private async run(): Promise<{ reset: number; skipped: number }> {
    this.logger.log('쿠폰 자동 발급 보정 시작');

    // MembershipStatusChanged 만 본다. customer_registered 는 Medusa 안(`customer.created` subscriber)에서
    // 발화하고 inbox 를 지나지 않는다 (#775) — 그쪽 실패는 Medusa 의 카운터·로그가 보인다.
    const since = new Date(Date.now() - LOOKBACK_MS_MEMBERSHIP);
    const failed = await this.dbService.db
      .select()
      .from(inboxEvents)
      .where(
        and(
          eq(inboxEvents.status, 'failed'),
          inArray(inboxEvents.eventType, [...COUPON_TRIGGER_EVENT_TYPES]),
          gte(inboxEvents.createdAt, since),
        ),
      );

    if (failed.length === 0) {
      this.logger.log('보정 대상 없음');
      await this.refreshBacklogGauge();
      return { reset: 0, skipped: 0 };
    }

    this.logger.log(`보정 대상 ${failed.length}건 발견`);
    let reset = 0;
    let skipped = 0;

    for (const event of failed) {
      try {
        // 원인이 일시적 오류일 가능성이 높으므로 재대기 — 워커가 다시 물어간다.
        await this.resetToPending(event.id);
        reset++;
      } catch (err) {
        this.logger.error(`보정 실패 (eventId=${event.id}, type=${event.eventType}): ${(err as any)?.message}`);
        skipped++;
      }
    }

    await this.refreshBacklogGauge();
    this.logger.log(`쿠폰 발급 보정 완료: reset=${reset}, skipped=${skipped}`);
    return { reset, skipped };
  }
```
- `retryUserEmailVerified` 메서드 전체 삭제. `resetToPending` 은 남긴다.

- [ ] **Step 6: 컨트롤러 docstring + 반환형**

`internal-membership.controller.ts:94-106`:
```ts
  /**
   * 쿠폰 자동 발급 보정 수동 실행
   * POST /internal/membership/run-coupon-reconciliation
   *
   * failed 상태의 MembershipStatusChanged inbox 이벤트를 pending 으로 리셋해 inbox worker 가 재시도하게 한다.
   * (customer_registered 는 Medusa 안에서 발화하고 inbox 를 지나지 않는다 — #775.)
   */
  @Post('run-coupon-reconciliation')
  @HttpCode(HttpStatus.OK)
  async runCouponReconciliation(
    @Headers('authorization') authorization: string,
  ): Promise<{ reset: number; skipped: number }> {
```

- [ ] **Step 7: 워커 스펙의 무관한 리터럴**

`inbox-worker.service.spec.ts:534` 의 `eventType: 'UserEmailVerified',` 를 `eventType: 'MembershipStatusChanged',` 로. (그 테스트는 핸들러를 목으로 막아 타입이 의미 없지만, 이제 워커가 모르는 타입을 픽스처에 두지 않는다.)

- [ ] **Step 8: 게이트**

Run:
```
npm run type-check
npx jest --testPathPattern 'apps/channel-adapter' --maxWorkers=2
npx jest --testPathPattern 'coupon-vocabulary-drift' --maxWorkers=2
grep -rn "UserEmailVerified" apps/channel-adapter/src
```
Expected: type-check 0 · channel-adapter 스펙 전부 PASS · 어휘 가드 PASS(클라이언트 시그니처 앵커 유지) · grep **0건**.

- [ ] **Step 9: 커밋**

```bash
git add apps/channel-adapter/src
git commit -m "refactor(channel-adapter): 죽은 UserEmailVerified 경로를 지운다 — customer_registered 는 Medusa 가 발화 (#775)

Claude-Session: https://claude.ai/code/session_01PphKuKs3h8JdVMVakkerg1"
```

---

### Task 8: 가드 A — 트리거마다 등록된 살아 있는 발행자 (루트 jest)

**Files:**
- Create: `packages/domain-types/coupon-auto-issue-trigger.ts`
- Create: `packages/domain-types/coupon-trigger-sources.ts`
- Create: `packages/domain-types/coupon-trigger-producers.spec.ts`
- Modify: `packages/domain-types/coupon-vocabulary-drift.spec.ts:29-30` (사본 상수를 import 로)
- Modify: `packages/domain-types/index.ts` (export 2줄)

**Interfaces:**
- Produces: `AUTO_ISSUE_TRIGGERS` · `AutoIssueTrigger` · `COUPON_TRIGGER_SOURCES: Record<AutoIssueTrigger, TriggerSource>`. Task 10 의 ADR 이 가리킨다.
- Consumes: Task 4 의 파일 경로·이벤트명·subscriberId, `apps/membership/src/services/membership-event.publisher.ts:35` 의 `enqueue({ eventType: 'MembershipStatusChanged' …`, Task 7 이후 `inbox-worker.service.ts` 의 `case 'MembershipStatusChanged'`, `membership-medusa-sync.service.ts:118` 의 `issuePromotionsByTrigger(customer.id, 'membership_activated')`.

- [ ] **Step 1: 어휘 상수를 승격한다**

`packages/domain-types/coupon-auto-issue-trigger.ts`:
```ts
/**
 * 쿠폰 자동발급 트리거 어휘. **정본은 `apps/medusa/src/modules/promotion-meta/service.ts` 의 `AutoIssueTrigger`**
 * 이고 여기는 사본이다 — ADR-0033 §7 이 공유 타입을 만들지 않기로 했다(Medusa 는 `@packages/*` 를 런타임에
 * 해석하지 못한다). 정합은 `coupon-vocabulary-drift.spec.ts` 가 지키고, 각 값의 «발행자» 는
 * `coupon-trigger-sources.ts` + `coupon-trigger-producers.spec.ts` 가 지킨다 (#775, ADR-0035).
 */
export const AUTO_ISSUE_TRIGGERS = ['customer_registered', 'membership_activated'] as const;

export type AutoIssueTrigger = (typeof AUTO_ISSUE_TRIGGERS)[number];
```

`coupon-vocabulary-drift.spec.ts` 에서 29-30행(주석 + `const AUTO_ISSUE_TRIGGERS = …`)을 지우고 import 를 더한다:
```ts
import { COUPON_VISIBILITIES } from './coupon-visibility';
import { AUTO_ISSUE_TRIGGERS } from './coupon-auto-issue-trigger';
```

`index.ts` 끝에:
```ts
export * from './coupon-auto-issue-trigger';
export * from './coupon-trigger-sources';
```

- [ ] **Step 2: 등록부**

`packages/domain-types/coupon-trigger-sources.ts`:
```ts
import type { AutoIssueTrigger } from './coupon-auto-issue-trigger';

/**
 * 트리거마다 «누가 발화시키는가» (#775, ADR-0035 가드 규칙).
 *
 * 2026-09-01 리허설에서 `customer_registered` 가 한 번도 발화할 수 없었다는 것이 드러났다 — 구독자는 있었고
 * 발행 코드도 있었는데 그 코드가 도달 불가였다. 각 층의 테스트는 전부 초록이었다. 이 표는 그 «층 사이» 를
 * 코드로 적은 것이고, `coupon-trigger-producers.spec.ts` 가 표의 각 줄이 실제 소스와 맞는지 대조한다.
 *
 * `Record<AutoIssueTrigger, …>` 라 어휘에 값을 더하고 여기를 안 채우면 루트 `type-check` 가 먼저 막는다.
 *
 * 한계: 「발행 코드가 존재한다」까지 본다. 존재하되 도달 불가한 것은 정적으로 못 잡는다 — 그것은 리허설의 몫이다.
 */
export type TriggerSource =
  | {
      kind: 'medusa_subscriber';
      /** 저장소 루트 기준 경로. */
      file: string;
      /** Medusa 코어 이벤트 이름. 코어가 emit 하는지는 가드 B(Medusa 유닛)가 본다. */
      event: string;
    }
  | {
      kind: 'kafka_inbox';
      /** `enqueue(`/`publishEvent(` 호출 안에 `eventType: '<eventType>'` 이 있어야 한다. */
      producerFile: string;
      eventType: string;
      /** `case '<eventType>'` 이 있어야 한다 (inbox 워커). */
      consumerFile: string;
      /** `issuePromotionsByTrigger(` 와 트리거 리터럴이 있어야 한다 (워커가 위임하는 서비스). */
      issuerFile: string;
    };

export const COUPON_TRIGGER_SOURCES: Record<AutoIssueTrigger, TriggerSource> = {
  customer_registered: {
    kind: 'medusa_subscriber',
    file: 'apps/medusa/src/subscribers/coupon-auto-issue-on-customer-created.ts',
    event: 'customer.created',
  },
  membership_activated: {
    kind: 'kafka_inbox',
    producerFile: 'apps/membership/src/services/membership-event.publisher.ts',
    eventType: 'MembershipStatusChanged',
    consumerFile: 'apps/channel-adapter/src/adapters/medusa/inbox-worker.service.ts',
    issuerFile: 'apps/channel-adapter/src/adapters/medusa/membership-medusa-sync.service.ts',
  },
};
```

- [ ] **Step 3: 가드 A 스펙**

`packages/domain-types/coupon-trigger-producers.spec.ts`:
```ts
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AUTO_ISSUE_TRIGGERS } from './coupon-auto-issue-trigger';
import { COUPON_TRIGGER_SOURCES } from './coupon-trigger-sources';

/**
 * 가드 A (#775, ADR-0035): **트리거 어휘의 모든 값은 등록된 살아 있는 발행자를 가진다.**
 *
 * `coupon-vocabulary-drift.spec.ts` 와 같은 기법 — 소스를 텍스트로 읽어 대조한다. 루트 jest 는
 * `modulePathIgnorePatterns` 에 `/apps/medusa/` 가 있어 그 트리를 require 할 수 없고, CI 의 루트 `npm ci` 는
 * `apps/medusa/node_modules` 를 깔지 않는다. 그래서 「이벤트를 코어가 emit 하는가」 는 여기서 보지 않고
 * Medusa 유닛의 가드 B(`subscriber-events-have-emitters.unit.spec.ts`)가 본다. 둘이 한 사슬이다:
 * 트리거 → subscriber 파일 → 이벤트명 (A) · 이벤트명 → 코어 emit 상수 (B).
 */
const REPO_ROOT = join(__dirname, '..', '..');

const read = (rel: string): string => {
  const abs = join(REPO_ROOT, rel);
  if (!existsSync(abs)) throw new Error(`[트리거 발행자 가드] 파일이 없다: ${rel}`);
  return readFileSync(abs, 'utf8');
};

describe('가드 A — 트리거마다 등록된 발행자', () => {
  it('등록부의 키 집합 = 어휘', () => {
    expect(Object.keys(COUPON_TRIGGER_SOURCES).sort()).toEqual([...AUTO_ISSUE_TRIGGERS].sort());
  });

  for (const trigger of AUTO_ISSUE_TRIGGERS) {
    const source = COUPON_TRIGGER_SOURCES[trigger];

    it(`${trigger} — ${source.kind}`, () => {
      if (source.kind === 'medusa_subscriber') {
        const src = read(source.file);
        expect(src).toMatch(new RegExp(`event:\\s*'${source.event.replace('.', '\\.')}'`));
        expect(src).toContain(`'${trigger}'`);
      } else {
        const producer = read(source.producerFile);
        expect(producer).toMatch(
          new RegExp(`(?:enqueue|publishEvent)\\(\\s*\\{[^}]*eventType:\\s*'${source.eventType}'`, 's'),
        );
        const consumer = read(source.consumerFile);
        expect(consumer).toContain(`case '${source.eventType}'`);
        const issuer = read(source.issuerFile);
        expect(issuer).toContain('issuePromotionsByTrigger(');
        expect(issuer).toContain(`'${trigger}'`);
      }
    });
  }
});
```

- [ ] **Step 4: 실행 + 타입**

Run:
```
npx jest --testPathPattern 'packages/domain-types' --maxWorkers=2
npm run type-check
```
Expected: 가드 A 3 tests PASS · 어휘 가드 PASS(import 로 바꾼 뒤에도) · type-check 0.

**빨간 것을 한 번 본다**: `coupon-trigger-sources.ts` 의 `event: 'customer.created'` 를 잠시 `'customer.registered'` 로 바꿔 돌리면 `customer_registered — medusa_subscriber` 가 FAIL 해야 한다. 되돌린다.

- [ ] **Step 5: 커밋**

```bash
git add packages/domain-types
git commit -m "test(domain-types): 가드 A — 자동발급 트리거마다 등록된 발행자가 있다 (#775)

Claude-Session: https://claude.ai/code/session_01PphKuKs3h8JdVMVakkerg1"
```

---

### Task 9: Alloy — Medusa 스크레이프

**Files:**
- Modify: `deployments/lcnine/services/observability/alloy/config.alloy` (243행 `// 옛 스크레이프 설정이 target map 에 …` 주석 **앞**에 삽입)

- [ ] **Step 1: 블록을 더한다**

`prometheus.scrape "user_service" { … }` 블록 뒤, `// 옛 스크레이프 설정이 target map 에 직접 찍던 두 라벨을 복원한다.` 주석 앞에:

```
// Medusa (#775). 다른 앱과 달리 Nest 가 아니지만 같은 규칙이다 — apps/medusa/src/observability/metrics-server.ts
// 가 PORT(9000)+10000 에 /metrics 를 연다. 쿠폰 자동발급 카운터(coupon_auto_issue_total 등)가 여기서 나온다.
// 🔴 port 는 그 파생 규칙과 같아야 한다. Medusa 는 scaling max 1 이라 target 은 항상 하나다.
discovery.dns "medusa" {
	names = ["Medusa." + sys.env("METRICS_DNS_SUFFIX_SERVICES")]
	type  = "A"
	port  = 19000
}

prometheus.scrape "medusa" {
	targets         = discovery.dns.medusa.targets
	job_name        = "medusa"
	metrics_path    = "/metrics"
	scrape_interval = "60s"
	forward_to      = [prometheus.relabel.service_labels.receiver]
}

```

들여쓰기는 파일의 기존 블록과 같이 **탭**이다.

- [ ] **Step 2: 형식 확인**

Run: `grep -n 'discovery.dns "medusa"\|prometheus.scrape "medusa"\|port  = 19000' deployments/lcnine/services/observability/alloy/config.alloy`
Expected: 세 줄이 잡힌다. 저장소에 `alloy fmt` 게이트는 없다 — 탭 들여쓰기와 `=` 정렬을 눈으로 기존 블록과 맞춘다.

- [ ] **Step 3: 커밋**

```bash
git add deployments/lcnine/services/observability/alloy/config.alloy
git commit -m "chore(alloy): Medusa :19000/metrics 스크레이프 (#775)

Claude-Session: https://claude.ai/code/session_01PphKuKs3h8JdVMVakkerg1"
```

---

### Task 10: ADR-0035 · 스펙 정정 · 이슈/플랜 갱신 · 전체 게이트 · PR

**Files:**
- Create: `docs/adr/0035-auto-issue-triggers-fire-where-the-fact-is-settled.md`
- Modify: `docs/superpowers/plans/2026-08-29-coupon-domain-master-plan.md:432-441`
- 이슈 #775 · #488 코멘트

- [ ] **Step 1: ADR-0035**

`docs/adr/0035-auto-issue-triggers-fire-where-the-fact-is-settled.md`:

```markdown
# 자동발급 트리거는 사실이 확정되는 시스템에서 발화한다 — 그리고 발행자 없는 구독자는 가드가 막는다

2026-09-01 리허설 2차에서 `customer_registered` 자동발급이 **발화할 수 없다**는 것이 드러났다(#775).
user-service 의 `UserEmailVerified` 를 기다렸는데, 그 이벤트를 내는 유일한 코드가 도달 불가였다 —
가입이 사용자를 이미 인증된 상태로 넣고, 인증 처리기는 미인증 사용자만 찾는다. 2026-04-22 부터 그랬고,
각 층의 테스트는 전부 초록이었다. 같은 모양이 Medusa 의 `user.updated`·`user.deleted` subscriber 에도
있다(`users.events.v1` 을 내는 곳이 없다).

[[0033-coupons-are-owned-by-the-sales-channel]] 을 뒤집지 않는다 — 쿠폰은 Medusa 안에 산다.
이 ADR 은 그 쿠폰을 «누가 언제» 자동으로 주는지, 그리고 그 배선이 끊겨 있음을 «무엇이» 잡는지를 정한다.
[[0034-coupon-issuance-writes-go-through-workflows]] 의 쓰기 경로는 그대로다.

## 측정 — 소스로 확인한 것 (재조사 금지)

전문은 `docs/superpowers/specs/2026-09-05-coupon-customer-registered-trigger-design.md` §2. 결정을 정한 것만:

1. Medusa 코어가 고객 생성 워크플로 끝에 `customer.created` 를 낸다. 우리 가입 경로가 그 워크플로를 지난다.
2. 그 이벤트는 어드민이 만든 고객(`has_account=false`)에도 뜬다. 게스트 결제 고객은 오늘은 이벤트 없이 생긴다.
3. Redis 이벤트버스 재시도 기본값은 `attempts: 1`, 우리 설정은 안 바꿨다.
4. Medusa 에 Prometheus `/metrics` 가 없었다. Alloy 의 OTLP 수신기는 trace·log 만 전달한다.
5. Medusa 의 BullMQ 큐에 밖에서 넣는 코드 0곳, 우리 소스의 커스텀 emit 0개 — `users.events.v1` 의 사망은 정적 증명.
6. 발급 키 `trigger:<trigger>` + `idx_coupon_grant_issue_key`(파셜 유니크) 가 재발급을 막는다.

## Decision

### 1. `customer_registered` := Medusa `customer.created` ∧ `has_account`

트리거는 **그 사실이 확정되는 시스템**에서 발화한다. 「고객이 생겼다」는 Medusa 가 아는 사실이다.
user-service 의 이메일 인증은 다른 사실이고(제품 결정이며 지금 꺼져 있다), 그것을 기다리면 Medusa 고객이
아직 없는 시점에 발화해 최대 1시간 백오프를 타야 했다. `has_account` 는 «회원가입» 의 정의다 — 어드민이
만든 고객·게스트에겐 주지 않는다.

`membership_activated` 는 그대로다 — 「멤버십이 활성화됐다」는 membership 앱이 아는 사실이고, Kafka →
channel-adapter inbox → Medusa 라우트 경로가 리허설에서 통과했다.

### 2. 메트릭은 발화시킨 쪽이 센다

`coupon_auto_issue_total{trigger,outcome}` · `coupon_auto_issue_failures_total{trigger,kind}` 를
channel-adapter(`membership_activated`)와 Medusa(`customer_registered`)가 **같은 이름·같은 라벨**로 낸다.
Medusa 는 `:PORT+10000/metrics` 를 열고 Alloy 가 긁는다 — #613 이 9개 앱에 깐 것과 같은 모양이라
대시보드·알림의 PromQL 이 job 구분 없이 합산한다. 라우트 안에서 세지 않는다(세면 전자가 두 번).

### 3. subscriber 에 재시도는 없다

같은 프로세스·같은 DB 다. channel-adapter 가 재시도를 5단 둔 이유(다른 서비스를 HTTP 로 부른다)가 없다.
실패는 `failures_total{kind="permanent"}` 와 error 로그로 **보이고**, 복구는 사람이
`POST /admin/customers/:id/issue-coupons {trigger: customer_registered}` 를 한 번 부른다 — 발급 키가
결정적이라 멱등하다. 전역 `attempts` 는 subscriber 8개 전부의 동작을 바꾸고, 스윕 잡은 「가입 20시간 뒤
새 쿠폰 소급 발급」이라는 의미 변경을 낳는다 — 둘 다 기각.

### 4. 재발급 불가의 근거는 인덱스다

멤버십을 가입·해지 반복해도 같은 쿠폰은 두 번 안 나간다 — `trigger:membership_activated` 키가 고객·프로모션당
고정이고 파셜 유니크가 막는다(`already_issued`). 사용한 장·만료된 장도 행이 남아 계속 막는다. 유일한 재발급
경로는 어드민이 미사용 장을 회수(soft delete)한 뒤이고 의도된 것이다. 나중에 새로 만든 트리거 쿠폰은
재활성화 때 한 장 나간다 — 「프로모션당 한 장」이 정의다.

### 5. 가드 규칙 — 층 사이의 전제를 기계가 검사한다

- **A. 트리거 어휘의 모든 값은 등록된 살아 있는 발행자를 가진다.**
  `packages/domain-types/coupon-trigger-sources.ts`(등록부, `Record<AutoIssueTrigger, …>`) +
  `coupon-trigger-producers.spec.ts`(루트 jest). 어휘에 값을 더하고 발행자를 안 적으면 type-check 와 jest 가 막는다.
- **B. Medusa subscriber 가 듣는 이벤트는 emit 하는 곳이 있다.**
  `apps/medusa/src/subscribers/__tests__/subscriber-events-have-emitters.unit.spec.ts`. 예외 목록엔 이슈 번호가
  필수이고, 고쳐진 뒤 안 지우면 stale 로 빨개진다.

한계: 둘 다 「발행 코드가 존재한다」까지 본다. 존재하되 도달 불가한 것(이번 결함)은 정적으로 못 잡는다 —
그것은 리허설(런타임)의 몫이고, 가드는 「발행자가 아예 없다」·「이름이 어긋났다」·「다음 사람이 발행자를 안
적었다」를 잡는다.

## 하지 않는 것

- user-service 의 이메일 인증 흐름 수정 — 제품 결정(#775 안 1).
- `UserEmailVerified` 이벤트 계약 삭제 — user-service 의 것이다. channel-adapter 의 소비 경로만 지웠다.
- Medusa `user.updated`·`user.deleted` 수정 — 후속 이슈(가드 B 예외 목록의 번호).
- A5 플립 — 리허설 3차 뒤.

## 결과

`customer_registered` 가 처음으로 발화할 수 있다. 두 트리거의 발급 결과가 한 대시보드에 보인다. 죽은
소비 경로 하나가 사라지고, 남은 둘은 이슈 번호를 달고 가드 안에 있다. 다음 트리거를 붙이는 사람은
발행자를 적지 않고는 컴파일도 테스트도 통과하지 못한다.
```

- [ ] **Step 2: 마스터플랜 체크**

`docs/superpowers/plans/2026-08-29-coupon-domain-master-plan.md:432` 의 `- [ ] 🔴 **A5 개통 차단 …` 항목을 `- [x]` 로 바꾸고, 그 항목 끝(441행 `- [ ] A5 개통 (위 결정 후)` 앞)에 한 줄을 더한다:
```
      **✅ 2026-09-05 해결 — 안 3 + b-1 (ADR-0035, 스펙 `2026-09-05-coupon-customer-registered-trigger-design.md`).**
      `customer.created` subscriber + Medusa `:19000/metrics` + channel-adapter 죽은 경로 삭제 + 가드 A/B.
      **종결 조건은 리허설 3차의 R11 재실행**(손으로 이벤트 강제하지 않고 가입 → 쿠폰).
```

- [ ] **Step 3: 전체 게이트**

Run (저장소 루트, 순서대로):
```
npm run type-check
npx jest --ci --silent --maxWorkers=2
npx tsc --noEmit -p apps/medusa/tsconfig.json
npx tsc --noEmit --project apps/medusa/tsconfig.instrumentation.json
npm --prefix apps/medusa run test:unit
scripts/local/run-medusa-integration.sh --testPathPattern 'coupon-'
```
Expected: type-check 0 · 루트 jest 실패 0 · Medusa tsc 기준선 3 · instrumentation 0 · Medusa 유닛 전부 PASS(Task 1 기준선 + 신규 5 파일) · HTTP 통합 전부 PASS. 숫자를 PR 본문에 적는다.

- [ ] **Step 4: 커밋**

```bash
git add docs/adr/0035-auto-issue-triggers-fire-where-the-fact-is-settled.md docs/superpowers/plans/2026-08-29-coupon-domain-master-plan.md
git commit -m "docs(coupon): ADR-0035 — 자동발급 트리거는 사실이 확정되는 곳에서 발화한다 + 가드 규칙 (#775)

Claude-Session: https://claude.ai/code/session_01PphKuKs3h8JdVMVakkerg1"
```

- [ ] **Step 5: 이슈 코멘트 (사람 확인 후)**

`gh issue comment 775 --repo LCNINE/almondyoung-server --body-file -` 로 아래를 단다:

```markdown
## 2026-09-05 결정 + 구현 (브랜치 `feat/coupon-customer-registered-trigger`)

| 항목 | 결정 |
|---|---|
| ⓵ 안 | **안 3** (Medusa `customer.created` subscriber) + 대가 2 = **(b)**, 구체적으로 **b-1**: Medusa 에 prom-client + `:19000/metrics` + Alloy 스크레이프 — #613 패턴. Medusa 엔 `/metrics` 가 없었고 Alloy OTLP 수신기는 metrics 를 안 넘긴다(이슈에 없던 사실) |
| ⓶ 추출 | 순수 선별기 `workflows/coupons/auto-issue-selection.ts` + 오케스트레이터 `auto-issue-coupons.ts`. 라우트 응답 불변 |
| ⓷ subscriber | `subscribers/coupon-auto-issue-on-customer-created.ts`. `has_account` 게이트(어드민 생성·게스트 배제). **재시도 없음** — 실패는 `failures_total{kind=permanent}` + 로그, 복구는 라우트 수동 호출 |
| ⓸ UserEmailVerified | channel-adapter 에서 **삭제**. 계약·user-service 발행 코드는 유지 |
| ⓹ user.updated/deleted | 런타임 확인 불필요 — 정적 증명(BullMQ 외부 producer 0, 커스텀 emit 0). 후속 이슈 #NNN |
| ⓺ 가드 | **A**(`packages/domain-types/coupon-trigger-producers.spec.ts`, 루트 jest) + **B**(`subscribers/__tests__/subscriber-events-have-emitters.unit.spec.ts`, Medusa 유닛). B 는 오늘 돌리면 user.* 둘이 즉시 빨갛다 → 예외 목록 #NNN |
| ⓻ 폼 경고 | 하지 않음 — 같은 PR 이 트리거를 살린다 |

근거: ADR-0035, 스펙 `docs/superpowers/specs/2026-09-05-coupon-customer-registered-trigger-design.md`.
**종결 조건은 그대로다** — 리허설 3차 R11 재실행(손으로 강제하지 않고 가입 → 쿠폰). 플래그는 아직 꺼져 있다.
```

#488 에는 두 줄:
```markdown
**2026-09-05** — #775 결정·구현 완료(안 3 + b-1, ADR-0035). 다음 = 리허설 3차 → A5 개통. 상세는 #775 코멘트.
```

- [ ] **Step 6: 푸시 + PR (사람 확인 후)**

```bash
git push -u origin feat/coupon-customer-registered-trigger
gh pr create --repo LCNINE/almondyoung-server --base develop --title "feat(coupon): customer_registered 트리거를 Medusa customer.created 로 — 메트릭·가드 포함 (#775)" --body-file - <<'PR'
## 무엇

`customer_registered` 자동발급의 입구를 도달 불가한 user-service `UserEmailVerified` 에서 Medusa `customer.created` subscriber 로 옮긴다 (#775 안 3). 발급 결과는 channel-adapter 와 같은 이름의 Prometheus 카운터로 Medusa `:19000/metrics` 에서 나가고 Alloy 가 긁는다 (b-1). channel-adapter 의 죽은 `UserEmailVerified` 경로는 지운다. 「구독자는 있는데 발행자가 없다」를 잡는 가드 둘(A: 루트 jest, B: Medusa 유닛)을 놓는다.

스펙 `docs/superpowers/specs/2026-09-05-coupon-customer-registered-trigger-design.md` · ADR-0035 · 플랜 `docs/superpowers/plans/2026-09-05-coupon-customer-registered-trigger.md`.

## 배포

- 마이그레이션 0 · 시크릿 0 · SST env 0. Medusa·channel-adapter·Alloy 가 한 스택 → `sst deploy` 한 번, 순서 제약 없음.
- **`COUPON_AUTO_ISSUE_ENABLED` 는 그대로 꺼져 있다.** 이 PR 은 개통이 아니다 — 리허설 3차 뒤.
- 배포 후 판정: Grafana `up{job="medusa"} == 1`. 발급 시리즈는 플래그가 꺼진 동안 **없는 게 정상**.

## 게이트

(Task 10 Step 3 의 숫자를 여기 적는다)

## 하지 않은 것

- user-service 이메일 인증 제품 결정 · `UserEmailVerified` 계약 삭제 · Medusa `user.updated`/`user.deleted` 수정(#NNN) · A5 플립 · 어드민 폼 경고(⓻).

https://claude.ai/code/session_01PphKuKs3h8JdVMVakkerg1
PR
```

---

## 이번에 검증되지 않는 것 (리허설 3차의 몫)

- **라이브 경로 실행 0회.** 로컬 통합 스펙의 e2e 케이스(Task 5)가 「워크플로 → 이벤트 → subscriber → grant」를 로컬 이벤트버스로 증명하지만, 라이브는 Redis 이벤트버스다. R11 재실행이 종결 조건이다.
- **Alloy 스크레이프 실효.** `up{job="medusa"}` 는 배포 뒤에만 볼 수 있다.
- **어드민 화면.** 이 PR 은 admin-web 을 건드리지 않는다.
