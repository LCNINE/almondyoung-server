# 쿠폰 한도 조합 해금 + 생성 페이로드 매퍼 추출 (P1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 「총 100회 선착순 AND 1인당 1회」처럼 전역 한도와 1인당 한도를 동시에 설정할 수 있게 하고, 그 과정에서 생성 페이로드 조립을 테스트 가능한 순수 함수로 분리한다.

**Architecture:** 전역 사용 한도를 `campaign.budget{type:'usage'}` 에서 **프로모션 자체의 `limit` 필드**로 옮긴다. 캠페인 예산 슬롯이 비므로 1인당 한도(`use_by_attribute`)와 공존할 수 있다. 동시에 `coupon-create-dialog.tsx`(670줄) 안에 인라인으로 박힌 페이로드 조립을 `lib/build-create-promotion-payload.ts` 순수 함수로 추출한다 — admin-web 의 `.tsx` 는 jest transform 밖이라 **순수 `.ts` 로 뽑아야만 검증된다.**

**Tech Stack:** Next.js (admin-web) · TypeScript · Jest + ts-jest · Medusa v2.13.4 Admin API

**Spec:** 이슈 [#488](https://github.com/LCNINE/almondyoung-server/issues/488) 항목 `1-2` 및 «2026-08-29 코드 대조» 절 · 로드맵 `docs/superpowers/plans/2026-08-29-coupon-domain-master-plan.md`

## Global Constraints

- **엔진 근거:** `Campaign.budget` 은 `hasOne` 이라 한 캠페인에 예산 **1개·타입 1개**뿐이다. `usage` 와 `use_by_attribute` 는 원리상 공존 불가.
- **해금의 근거:** Medusa 2.12.0 이 `Promotion.limit` / `Promotion.used` 를 추가했고, 이는 campaign budget 과 **독립적으로** 검사된다 (`node_modules/@medusajs/promotion/dist/services/promotion-module.js:146`, `:448`).
- **검증기 제약:** `limit: z.number().int().min(1).nullable().optional()` 이며, **`is_automatic: true` 인 프로모션은 `limit` 을 가질 수 없다**(`@medusajs/medusa/dist/api/admin/promotions/validators.js:121,130-139`). 이 다이얼로그는 항상 `is_automatic: false` 를 보내므로 안전하다.
- **여전히 배타인 조합:** `spend` ↔ `use_by_attribute` (둘 다 유일한 budget 슬롯을 요구). 이건 엔진 제약이므로 없앨 수 없고, UI 가 이유를 표시해야 한다.
- **타입 게이트:** 루트 `npm run type-check` 는 **admin-web 을 제외한다.** 이 플랜의 타입 검증은 반드시 `cd apps/admin-web && npx tsc --noEmit` 로 한다.
- **단위 테스트 실행:** `npm run test:admin-web` (루트에서). transform 이 `^.+\.(t|j)s$` 라 **`.tsx` 는 테스트 불가** — 판정 로직은 `.ts` 에 있어야 한다.
- **검증된 기준선 (2026-08-29 실측):** `npm run test:admin-web` → **87 suites / 715 tests 전부 통과, 2.5s**. 새 실패가 보이면 그건 이 플랜이 만든 것이다.
- `package.json:345` 에 `moduleNameMapper` 가 있어 `@/` 별칭은 jest 에서 해석된다. 다만 이 플랜의 교차 모듈 import 는 전부 `import type` 이라 런타임 해석 자체가 필요 없다.
- **마이그레이션 0건. 배포 순서 제약 없음.**
- 문구는 한국어, 기존 다이얼로그 톤을 따른다.

---

## File Structure

| 파일 | 책임 |
|---|---|
| `apps/admin-web/src/features/mall/marketing/coupons/lib/build-create-promotion-payload.ts` | **신규.** 폼 상태 → Medusa create 페이로드. 순수 함수(시각·난수 주입받음). |
| `apps/admin-web/src/features/mall/marketing/coupons/lib/build-create-promotion-payload.spec.ts` | **신규.** 위 함수의 단위 스펙. |
| `apps/admin-web/src/lib/api/domains/medusa/promotions.ts` | **수정.** `CreatePromotionPayload` 에 `limit?: number` 추가. |
| `apps/admin-web/src/features/mall/marketing/coupons/components/coupon-create-dialog.tsx` | **수정.** 인라인 조립 제거 → 매퍼 호출. 한도 입력 3개의 `disabled` 규칙 교체. |

---

### Task 1: 페이로드 매퍼 추출 (행동 변화 0)

리팩터 전용 태스크다. **현재 동작을 그대로 옮기고 스펙으로 고정한 뒤에** Task 2 에서 행동을 바꾼다. 이 순서를 지키면 Task 2 의 diff 가 «무엇이 달라졌는가»만 남는다.

**Files:**
- Create: `apps/admin-web/src/features/mall/marketing/coupons/lib/build-create-promotion-payload.ts`
- Create: `apps/admin-web/src/features/mall/marketing/coupons/lib/build-create-promotion-payload.spec.ts`
- Modify: `apps/admin-web/src/features/mall/marketing/coupons/components/coupon-create-dialog.tsx:195-268`

**Interfaces:**
- Consumes: `CreatePromotionPayload`, `PromotionTargetRule`, `PromotionRule` from `@/lib/api/domains/medusa/promotions`; `AutoIssueTrigger` from `../coupon-helpers`
- Produces: `CouponFormState` (인터페이스), `buildCreatePromotionPayload(form: CouponFormState, opts: { campaignSuffix: string }): CreatePromotionPayload`

- [ ] **Step 1: 현재 동작을 고정하는 실패 테스트를 쓴다**

`apps/admin-web/src/features/mall/marketing/coupons/lib/build-create-promotion-payload.spec.ts`

```ts
import { buildCreatePromotionPayload, type CouponFormState } from './build-create-promotion-payload';

const base: CouponFormState = {
  code: 'welcome10',
  name: '웰컴 쿠폰',
  discountType: 'percentage',
  value: 10,
  targetType: 'order',
  targetAttribute: 'product_id',
  targetItemIds: [],
  minOrderAmount: '',
  customerGroupIds: [],
  startsAt: '',
  endsAt: '',
  usageLimit: '',
  spendLimit: '',
  maxUsesPerCustomer: '',
  maxClaims: '',
  visibility: 'public',
  autoIssueTrigger: '',
  createdBy: 'admin@lcnine.kr',
};

const opts = { campaignSuffix: '1756400000000' };

describe('buildCreatePromotionPayload', () => {
  it('코드를 대문자로 정규화하고 항상 active·비자동으로 생성한다', () => {
    const p = buildCreatePromotionPayload(base, opts);
    expect(p.code).toBe('WELCOME10');
    expect(p.status).toBe('active');
    expect(p.is_automatic).toBe(false);
    expect(p.type).toBe('standard');
  });

  it('한도·기간이 없으면 campaign 을 만들지 않는다', () => {
    expect(buildCreatePromotionPayload(base, opts).campaign).toBeUndefined();
  });

  it('spend 예산에는 currency_code 를 반드시 싣는다 (1-1 회귀 방지)', () => {
    const p = buildCreatePromotionPayload({ ...base, spendLimit: 5_000_000 }, opts);
    expect(p.campaign?.budget).toEqual({ type: 'spend', limit: 5_000_000, currency_code: 'krw' });
  });

  it('items 대상은 라인아이템 경로로 매핑한다 (1-4 회귀 방지)', () => {
    const p = buildCreatePromotionPayload(
      { ...base, targetType: 'items', targetAttribute: 'product_category_id', targetItemIds: ['cat_1'] },
      opts,
    );
    expect(p.application_method.target_rules).toEqual([
      { attribute: 'items.product.categories.id', operator: 'in', values: ['cat_1'] },
    ]);
    expect(p.application_method.allocation).toBe('across');
  });

  it('최소주문금액과 고객그룹을 promotion rules 로 싣는다', () => {
    const p = buildCreatePromotionPayload(
      { ...base, minOrderAmount: 30000, customerGroupIds: ['cg_1'] },
      opts,
    );
    expect(p.rules).toEqual([
      { attribute: 'subtotal', operator: 'gte', values: ['30000'] },
      { attribute: 'customer.groups.id', operator: 'in', values: ['cg_1'] },
    ]);
  });

  it('claimable 일 때만 max_claims 를 additional_data 에 싣는다', () => {
    const withClaims = buildCreatePromotionPayload(
      { ...base, visibility: 'claimable', maxClaims: 100 }, opts);
    expect(withClaims.additional_data).toMatchObject({ visibility: 'claimable', max_claims: 100 });

    const publicOnly = buildCreatePromotionPayload({ ...base, maxClaims: 100 }, opts);
    expect(publicOnly.additional_data).not.toHaveProperty('max_claims');
  });

  it('campaign_identifier 에 주입받은 suffix 를 붙인다 (1-3 충돌 방지)', () => {
    const p = buildCreatePromotionPayload({ ...base, endsAt: '2026-12-31' }, opts);
    expect(p.campaign?.campaign_identifier).toBe('CAMP_WELCOME10_1756400000000');
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npm run test:admin-web -- build-create-promotion-payload`
Expected: FAIL — `Cannot find module './build-create-promotion-payload'`

- [ ] **Step 3: 현재 로직을 그대로 옮긴다**

`apps/admin-web/src/features/mall/marketing/coupons/lib/build-create-promotion-payload.ts`

```ts
import type {
  CreatePromotionPayload,
  PromotionRule,
  PromotionTargetRule,
} from '@/lib/api/domains/medusa/promotions';
import type { AutoIssueTrigger } from '../coupon-helpers';

export type TargetAttribute = 'product_id' | 'product_category_id' | 'product_collection_id';
export type Visibility = 'public' | 'claimable' | 'assigned_only';

// Medusa 라인아이템 컨텍스트가 노출하는 실제 경로로 매핑한다.
// 플랫 키(product_category_id 등)는 라인아이템에 없어 룰이 절대 매칭되지 않음.
const TARGET_ATTR_TO_MEDUSA: Record<TargetAttribute, PromotionTargetRule['attribute']> = {
  product_id: 'items.product.id',
  product_category_id: 'items.product.categories.id',
  product_collection_id: 'items.product.collection_id',
};

export interface CouponFormState {
  code: string;
  name: string;
  discountType: 'percentage' | 'fixed';
  value: number;
  targetType: 'order' | 'items' | 'shipping_methods';
  targetAttribute: TargetAttribute;
  targetItemIds: string[];
  minOrderAmount: number | '';
  customerGroupIds: string[];
  startsAt: string;
  endsAt: string;
  usageLimit: number | '';
  spendLimit: number | '';
  maxUsesPerCustomer: number | '';
  maxClaims: number | '';
  visibility: Visibility;
  autoIssueTrigger: AutoIssueTrigger | '';
  createdBy?: string;
}

/**
 * 폼 상태를 Medusa `POST /admin/promotions` 페이로드로 변환한다.
 *
 * 순수 함수다 — `Date.now()` 를 안에서 부르지 않고 `opts.campaignSuffix` 로 주입받는다.
 * 다이얼로그가 `.tsx` 라 jest transform 밖이므로, 판정 로직은 전부 이 파일에 있어야 검증된다.
 */
export function buildCreatePromotionPayload(
  form: CouponFormState,
  opts: { campaignSuffix: string },
): CreatePromotionPayload {
  const code = form.code.trim().toUpperCase();
  const name = form.name.trim();

  const additional_data: Record<string, unknown> = { visibility: form.visibility };
  if (name) additional_data.name = name;
  if (form.visibility === 'claimable' && form.maxClaims) {
    additional_data.max_claims = Number(form.maxClaims);
  }
  if (form.createdBy) additional_data.created_by = form.createdBy;
  if (form.autoIssueTrigger) additional_data.auto_issue_trigger = form.autoIssueTrigger;

  const target_rules: PromotionTargetRule[] | undefined =
    form.targetType === 'items' && form.targetItemIds.length > 0
      ? [{
          attribute: TARGET_ATTR_TO_MEDUSA[form.targetAttribute],
          operator: 'in',
          values: form.targetItemIds,
        }]
      : undefined;

  const rules: PromotionRule[] = [
    ...(form.minOrderAmount
      ? [{ attribute: 'subtotal', operator: 'gte' as const, values: [String(form.minOrderAmount)] }]
      : []),
    ...(form.customerGroupIds.length > 0
      ? [{ attribute: 'customer.groups.id', operator: 'in' as const, values: form.customerGroupIds }]
      : []),
  ];

  const budget = form.maxUsesPerCustomer
    ? { type: 'use_by_attribute' as const, attribute: 'customer_id', limit: Number(form.maxUsesPerCustomer) }
    : form.usageLimit
    ? { type: 'usage' as const, limit: Number(form.usageLimit) }
    : form.spendLimit
    ? { type: 'spend' as const, limit: Number(form.spendLimit), currency_code: 'krw' }
    : undefined;

  const hasCampaign = Boolean(
    form.startsAt || form.endsAt || form.usageLimit || form.spendLimit || form.maxUsesPerCustomer,
  );

  return {
    code,
    type: 'standard',
    is_automatic: false,
    status: 'active',
    application_method: {
      type: form.discountType,
      value: form.value,
      target_type: form.targetType,
      ...(form.discountType === 'fixed' ? { currency_code: 'krw' } : {}),
      ...(form.targetType === 'items' ? { allocation: 'across' as const } : {}),
      ...(target_rules ? { target_rules } : {}),
    },
    ...(hasCampaign
      ? {
          campaign: {
            name: name || code,
            campaign_identifier: `CAMP_${code}_${opts.campaignSuffix}`,
            ...(form.startsAt ? { starts_at: new Date(form.startsAt).toISOString() } : {}),
            ...(form.endsAt ? { ends_at: new Date(form.endsAt).toISOString() } : {}),
            ...(budget ? { budget } : {}),
          },
        }
      : {}),
    ...(rules.length > 0 ? { rules } : {}),
    additional_data,
  };
}
```

- [ ] **Step 4: 테스트 통과를 확인한다**

Run: `npm run test:admin-web -- build-create-promotion-payload`
Expected: PASS (7 tests)

- [ ] **Step 5: 다이얼로그를 매퍼로 배선한다**

`coupon-create-dialog.tsx` 의 `handleSubmit` 안에서 `additional_data` · `targetRules` · `promotionRules` · `allocation` · `campaignBudget` · `campaignIdentifier` 를 조립하던 구간(현재 195–268행)을 아래로 교체한다. **`Date.now()` 는 호출부에 남긴다** — 매퍼를 순수하게 유지하기 위해서다.

```tsx
const payload = buildCreatePromotionPayload(
  {
    code, name, discountType, value: value as number,
    targetType, targetAttribute,
    targetItemIds: targetItems.map((i) => i.id),
    minOrderAmount, customerGroupIds, startsAt, endsAt,
    usageLimit, spendLimit, maxUsesPerCustomer, maxClaims,
    visibility, autoIssueTrigger,
    createdBy: me?.email || me?.username,
  },
  { campaignSuffix: String(Date.now()) },
);

try {
  await createMutation.mutateAsync(payload);
```

파일 상단에 import 를 추가하고, 더 이상 쓰이지 않게 된 `TARGET_ATTR_TO_MEDUSA` 상수와 `TargetAttribute` 로컬 타입 선언(현재 48–56행)을 지운 뒤 매퍼에서 `import type { TargetAttribute }` 로 가져온다.

```tsx
import { buildCreatePromotionPayload, type TargetAttribute } from '../lib/build-create-promotion-payload';
```

- [ ] **Step 6: 타입 게이트와 테스트를 돌린다**

Run: `cd apps/admin-web && npx tsc --noEmit`
Expected: 에러 0 (루트 `type-check` 는 admin-web 을 제외하므로 이 명령이어야 한다)

Run: `npm run test:admin-web`
Expected: 기존 스펙 전부 통과 + 신규 7건 통과

- [ ] **Step 7: 커밋**

```bash
git add apps/admin-web/src/features/mall/marketing/coupons/lib/build-create-promotion-payload.ts \
        apps/admin-web/src/features/mall/marketing/coupons/lib/build-create-promotion-payload.spec.ts \
        apps/admin-web/src/features/mall/marketing/coupons/components/coupon-create-dialog.tsx
git commit -m "refactor(admin-web): 쿠폰 생성 페이로드 조립을 순수 함수로 뽑는다"
```

---

### Task 2: 전역 사용 한도를 `promotion.limit` 으로 옮겨 조합을 연다

**Files:**
- Modify: `apps/admin-web/src/lib/api/domains/medusa/promotions.ts:62-89`
- Modify: `apps/admin-web/src/features/mall/marketing/coupons/lib/build-create-promotion-payload.ts`
- Modify: `apps/admin-web/src/features/mall/marketing/coupons/lib/build-create-promotion-payload.spec.ts`

**Interfaces:**
- Consumes: Task 1 의 `buildCreatePromotionPayload`, `CouponFormState`
- Produces: 시그니처 변화 없음. 반환 페이로드에 `limit?: number` 가 실릴 수 있다. `spendLimit` 과 `maxUsesPerCustomer` 를 동시에 주면 **throw** 한다.

- [ ] **Step 1: 새 동작의 실패 테스트를 추가한다**

`build-create-promotion-payload.spec.ts` 하단에 추가한다. **기존 테스트 중 `usage` 예산을 기대하던 것은 없으므로 수정할 것이 없다** — Task 1 스펙은 의도적으로 `usage` 를 검증하지 않았다.

```ts
describe('사용 한도 조합', () => {
  it('전역 사용 한도는 campaign budget 이 아니라 promotion.limit 으로 나간다', () => {
    const p = buildCreatePromotionPayload({ ...base, usageLimit: 100 }, opts);
    expect(p.limit).toBe(100);
    expect(p.campaign).toBeUndefined();
  });

  it('전역 한도와 1인당 한도를 동시에 실을 수 있다 (1-2 해금)', () => {
    const p = buildCreatePromotionPayload(
      { ...base, usageLimit: 100, maxUsesPerCustomer: 1 }, opts);
    expect(p.limit).toBe(100);
    expect(p.campaign?.budget).toEqual({
      type: 'use_by_attribute', attribute: 'customer_id', limit: 1,
    });
  });

  it('전역 한도와 총 할인금액 한도를 동시에 실을 수 있다', () => {
    const p = buildCreatePromotionPayload(
      { ...base, usageLimit: 100, spendLimit: 5_000_000 }, opts);
    expect(p.limit).toBe(100);
    expect(p.campaign?.budget).toEqual({
      type: 'spend', limit: 5_000_000, currency_code: 'krw',
    });
  });

  it('총 할인금액 한도와 1인당 한도는 조용히 버리지 않고 throw 한다', () => {
    expect(() =>
      buildCreatePromotionPayload({ ...base, spendLimit: 5_000_000, maxUsesPerCustomer: 1 }, opts),
    ).toThrow('총 할인금액 한도와 1인당 사용 한도는 동시에 설정할 수 없습니다');
  });

  it('전역 한도만 있으면 campaign 을 만들지 않는다 (캠페인 오염 감소)', () => {
    expect(buildCreatePromotionPayload({ ...base, usageLimit: 100 }, opts).campaign).toBeUndefined();
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npm run test:admin-web -- build-create-promotion-payload`
Expected: FAIL — `expect(p.limit).toBe(100)` 이 `undefined` 로 실패, throw 테스트도 실패

- [ ] **Step 3: 타입에 `limit` 을 추가한다**

`apps/admin-web/src/lib/api/domains/medusa/promotions.ts` 의 `CreatePromotionPayload` 에서 `status?: ...` 바로 아래에 추가한다.

```ts
  /**
   * 프로모션 전역 사용 횟수 상한 (Medusa 2.12.0+).
   * campaign budget 과 독립적으로 검사되므로 1인당 한도(use_by_attribute)와 공존할 수 있다.
   * is_automatic: true 인 프로모션에는 설정할 수 없다 (Medusa 검증기 refine).
   */
  limit?: number;
```

- [ ] **Step 4: 매퍼의 한도 분기를 교체한다**

`build-create-promotion-payload.ts` 의 `budget` / `hasCampaign` 계산을 아래로 교체한다.

```ts
  // 총 할인금액(spend)과 1인당 한도(use_by_attribute)는 둘 다 캠페인의 유일한 예산 슬롯을
  // 요구한다(Campaign.budget 은 hasOne). 엔진 제약이므로 조용히 버리지 않고 알린다.
  if (form.spendLimit && form.maxUsesPerCustomer) {
    throw new Error('총 할인금액 한도와 1인당 사용 한도는 동시에 설정할 수 없습니다');
  }

  // 전역 사용 횟수는 campaign budget 이 아니라 promotion.limit 으로 보낸다.
  // 그래야 예산 슬롯이 비어 1인당 한도 또는 총 할인금액 한도와 공존할 수 있다.
  const limit = form.usageLimit ? Number(form.usageLimit) : undefined;

  const budget = form.maxUsesPerCustomer
    ? { type: 'use_by_attribute' as const, attribute: 'customer_id', limit: Number(form.maxUsesPerCustomer) }
    : form.spendLimit
    ? { type: 'spend' as const, limit: Number(form.spendLimit), currency_code: 'krw' }
    : undefined;

  const hasCampaign = Boolean(form.startsAt || form.endsAt || budget);
```

그리고 반환 객체에서 `is_automatic: false,` 다음 줄에 추가한다.

```ts
    ...(limit !== undefined ? { limit } : {}),
```

- [ ] **Step 5: 테스트 통과를 확인한다**

Run: `npm run test:admin-web -- build-create-promotion-payload`
Expected: PASS (12 tests)

Run: `cd apps/admin-web && npx tsc --noEmit`
Expected: 에러 0

- [ ] **Step 6: 커밋**

```bash
git add apps/admin-web/src/lib/api/domains/medusa/promotions.ts \
        apps/admin-web/src/features/mall/marketing/coupons/lib/build-create-promotion-payload.ts \
        apps/admin-web/src/features/mall/marketing/coupons/lib/build-create-promotion-payload.spec.ts
git commit -m "feat(admin-web): 전역 사용 한도를 promotion.limit 으로 옮겨 1인당 한도와 조합을 연다"
```

---

### Task 3: 한도 입력 3개의 배타 규칙을 교체한다

**Files:**
- Modify: `apps/admin-web/src/features/mall/marketing/coupons/components/coupon-create-dialog.tsx:477-535`

**Interfaces:**
- Consumes: Task 2 의 매퍼 동작(어떤 조합이 유효한지)
- Produces: 없음 (UI 만)

> `.tsx` 는 jest transform 밖이라 단위 테스트가 불가능하다. 이 태스크의 게이트는 **타입 체크 + 수동 확인**이며, 판정 로직은 Task 2 에서 이미 `.ts` 로 검증됐다.

- [ ] **Step 1: 「총 사용 횟수 제한」의 상호 배타를 없앤다**

`disabled` 속성과 `onChange` 안의 상호 초기화를 제거한다.

```tsx
              <Label>총 사용 횟수 제한</Label>
              <Input
                type="number"
                min={1}
                value={usageLimit}
                onChange={(e) => setUsageLimit(e.target.value ? Number(e.target.value) : '')}
                placeholder="예: 100"
              />
```

- [ ] **Step 2: 「총 할인금액 한도」는 1인당 한도와만 배타로 둔다**

```tsx
              <Label>총 할인금액 한도 (원)</Label>
              <Input
                type="number"
                min={1}
                value={spendLimit}
                onChange={(e) => {
                  setSpendLimit(e.target.value ? Number(e.target.value) : '');
                  if (e.target.value) setMaxUsesPerCustomer('');
                }}
                placeholder="예: 5000000"
                disabled={!!maxUsesPerCustomer}
              />
              {!!maxUsesPerCustomer && (
                <p className="text-xs text-muted-foreground">
                  1인당 한도와 함께 쓸 수 없습니다 (캠페인 예산은 하나만 설정 가능)
                </p>
              )}
```

- [ ] **Step 3: 「1인당 사용 횟수 제한」도 총 할인금액과만 배타로 둔다**

```tsx
            <Label>1인당 사용 횟수 제한</Label>
            <Input
              type="number"
              min={1}
              value={maxUsesPerCustomer}
              onChange={(e) => {
                setMaxUsesPerCustomer(e.target.value ? Number(e.target.value) : '');
                if (e.target.value) setSpendLimit('');
              }}
              placeholder="예: 1"
              disabled={!!spendLimit}
            />
            {!!spendLimit && (
              <p className="text-xs text-muted-foreground">
                총 할인금액 한도와 함께 쓸 수 없습니다 (캠페인 예산은 하나만 설정 가능)
              </p>
            )}
```

- [ ] **Step 4: 타입 게이트와 전체 테스트를 돌린다**

Run: `cd apps/admin-web && npx tsc --noEmit`
Expected: 에러 0

Run: `npm run test:admin-web`
Expected: 전체 통과

- [ ] **Step 5: 수동 확인 (dev 서버)**

Run: `npm run start:admin-web:dev`

쿠폰 만들기 다이얼로그를 열고 확인한다:
1. 「총 사용 횟수」 100 + 「1인당」 1 → **둘 다 입력된 채로 남는가** (전에는 하나가 지워졌다)
2. 「총 할인금액」 입력 → 「1인당」이 비활성화되고 이유 문구가 뜨는가
3. 1번 상태로 생성 → 성공하는가. 생성된 쿠폰 상세에서 두 한도가 모두 보이는가
4. 「총 사용 횟수」만 넣고 생성 → **캠페인 탭에 새 캠페인이 생기지 않는가** (오염 감소 확인)

- [ ] **Step 6: 커밋**

```bash
git add apps/admin-web/src/features/mall/marketing/coupons/components/coupon-create-dialog.tsx
git commit -m "feat(admin-web): 전역 한도와 1인당 한도를 함께 설정할 수 있게 한다"
```

---

## 완료 조건

- [ ] `npm run test:admin-web` 통과 (신규 12건 포함)
- [ ] `cd apps/admin-web && npx tsc --noEmit` 에러 0
- [ ] Task 3 Step 5 의 수동 확인 4항목 통과
- [ ] #488 의 `1-2` 를 «✅ 적용됨»으로 갱신하고, 남은 제약(`spend` ↔ `use_by_attribute` 배타는 엔진 제약)을 본문에 적는다
