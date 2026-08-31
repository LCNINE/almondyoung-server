# 발급 인스턴스를 두껍게 + 유효기간 두 축 (P4 + P5) — 실행 플랜

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 발급된 쿠폰 한 장이 자기 만료 시각을 갖게 하고, 쿠폰의 유효기간을 「발급 가능 기간」과 「사용 가능 기간」 두 축으로 분리한다.

**Architecture:** 만료 정책은 `promotion_meta` 3열(`starts_at`·`ends_at`·`validity_days`)에 두고, 발급 시점에 실값을 계산해 customer↔promotion **링크 행의 `extraColumns`** 에 박는다. 만료 판정은 「링크 행이 있으면 `link.expires_at`, 없으면 `meta.ends_at`」 한 줄이며, 순수 함수 3개(`validity.ts`)로 뽑아 유닛 테스트가 지킨다. 캠페인 날짜는 더 이상 쓰지 않는다 — 엔진의 `listActivePromotions_` 가 캠페인 창이 지난 프로모션을 할인 계산에서 제외해 「발급 후 N일」을 표현할 수 없기 때문이다.

**Tech Stack:** Medusa v2 (`defineLink` extraColumns · 워크플로 훅 · MikroORM 모듈 마이그레이션) · Next.js(admin-web) · Next.js(storefront) · Jest

**Spec:** `docs/superpowers/specs/2026-08-31-coupon-issuance-instance-and-validity-design.md`

## Global Constraints

- **`issued_count` 는 링크로 옮기지 않는다.** 원자적 예약(`UPDATE … WHERE issued_count < ? RETURNING`)이 목적이라 링크를 `COUNT` 하는 순간 원자성을 잃는다. #488 본문 `7-1` 의 「링크 수에서 도출」 제안은 따르지 않는다.
- **`ContainerRegistrationKeys.LINK` 만 쓴다.** `REMOTE_LINK` 는 `aliasTo(LINK)` 로 등록된 **같은 객체**이며 `@deprecated` 다. 이 플랜이 건드리는 파일에서는 전부 `LINK` 로 바꾼다.
- **`Link.create` 는 UPSERT 다** — 복합 PK `(customer_id, promotion_id)` + `upsertMany` + `deleted_at = null`. 회수된 행이 되살아나므로 **발급할 때 `data` 의 네 필드를 전부 명시**한다(`used_at: null`, `order_id: null` 포함).
- **워크플로 훅은 워크플로당 핸들러 하나뿐이다.** `completeCartWorkflow.hooks.validate` 는 이미 `workflows/hooks/cart/complete-cart.ts:15` 가 쓰고 있으므로 **거기에 함수를 더한다.** `workflows/hooks/__tests__/no-duplicate-validate-hooks.unit.spec.ts` 가 이를 지킨다.
- **판정 로직은 `.ts` 에 둔다.** admin-web 의 jest transform 이 `^.+\.(t|j)s$` 라 `.tsx` 안의 분기는 테스트가 실행조차 되지 않는다.
- **`@packages/*` 를 `apps/medusa` 에서 import 하지 않는다.** Medusa 빌드에 번들러가 없어 런타임에 해석되지 않는다. 어휘 사본의 정합은 `packages/domain-types/coupon-vocabulary-drift.spec.ts` 가 지킨다.
- **`apps/user-service` · `web/` 의 `birthday` 는 고객 프로필 생년월일이다.** 건드리지 않는다.
- 브랜치: `feat/coupon-issuance-validity` (이미 생성됨, 스펙 커밋 `74b540157` 위에 쌓는다).

### 검증 명령 (전 태스크 공통)

```bash
# medusa 유닛
cd apps/medusa && TEST_TYPE=unit NODE_OPTIONS=--experimental-vm-modules npx jest --silent --runInBand --forceExit
# medusa 모듈 통합
cd apps/medusa && npm run test:integration:modules
# medusa HTTP 통합
cd apps/medusa && npm run test:integration:http
# 루트 (admin-web·medusa·web 제외)
npm run type-check && npx jest --maxWorkers=2
# admin-web (루트가 안 보는 트리)
cd apps/admin-web && npx tsc --noEmit && npm run test:admin-web
# storefront (기준선 49 — 늘어나면 안 된다)
cd web/almondyoung-storefront && npx tsc --noEmit
```

---

## File Structure

**신규**

| 파일 | 책임 |
|---|---|
| `apps/medusa/src/modules/promotion-meta/validity.ts` | 유효기간 판정 순수 함수 3개. 컨테이너·워크플로를 모른다 |
| `apps/medusa/src/modules/promotion-meta/__tests__/validity.unit.spec.ts` | 위 함수의 유닛 스펙 |
| `apps/medusa/src/modules/promotion-meta/migrations/Migration20260831100000.ts` | `promotion_meta` 3열 + CHECK + 캠페인 백필 |
| `apps/medusa/src/modules/promotion-meta/migrations/Migration20260831110000.ts` | `birthday` 어휘 제거 (CHECK 교체) |
| `apps/medusa/src/workflows/hooks/cart/record-coupon-usage.ts` | `orderCreated` 훅 등록부(얇게) |
| `apps/medusa/src/workflows/hooks/cart/coupon-usage.ts` | 위 훅의 순수 조립 로직 |
| `apps/medusa/src/workflows/hooks/cart/__tests__/coupon-usage.unit.spec.ts` | 위 로직의 유닛 스펙 |
| `apps/medusa/src/scripts/detach-coupon-campaigns.ts` | 배포 후 1회성 — 캠페인 날짜 비우기·분리·링크 백필 |
| `apps/medusa/integration-tests/http/coupon-validity.spec.ts` | T1~T6 통합 스펙 |

**수정 — medusa**

| 파일 | 무엇을 |
|---|---|
| `src/links/customer-promotion.ts` | `extraColumns` 4개 |
| `src/modules/promotion-meta/models/promotion-meta.ts` | 3필드 |
| `src/modules/promotion-meta/service.ts` | 타입 3필드 · `upsert` 검증 · `birthday` 제거 |
| `src/api/admin/promotions/additional-data-schema.ts` | 3키 추가 · `birthday` 제거 |
| `src/api/admin/promotions/helpers.ts` | `META_KEYS` 3키 · `toMetadataShape` 3키 · `findIssuedLink`/`listIssuedLinks` |
| `src/api/admin/customers/[id]/issue-coupons/route.ts` | 창 검사 교체 · `data` 기입 · `LINK` · `birthday` 제거 |
| `src/api/admin/customers/[id]/promotions/route.ts` | 창 검사 교체 · `data` 기입 · `LINK` · GET 에 링크 컬럼 |
| `src/api/admin/promotions/[id]/customers/route.ts` | `LINK` 통일 · GET `select` 에 링크 컬럼 |
| `src/api/store/customers/me/promotions/[id]/claim/route.ts` | 창 검사 교체 · `data` 기입 · `LINK` |
| `src/api/store/carts/middlewares/per-customer-limit.ts` | 🔴 만료 검사를 `requiresIssuance` 밖으로 |
| `src/workflows/hooks/cart/complete-cart.ts` | 기존 `validate` 핸들러 안에 만료 백스톱 |
| `src/api/store/coupons/preview/route.ts` | 창·만료를 판정 함수로 |
| `src/api/store/events/[slug]/route.ts` | 창·만료를 판정 함수로 |
| `src/api/store/customers/me/promotions/route.ts` | 링크 맵 1회 조회 · 창·만료·`expired_promotions` |
| `src/api/store/customers/me/promotions/format-promotion.ts` | 최상위 `expires_at` |
| `integration-tests/http/coupon-store.spec.ts` | `campaign` 기반 만료 케이스 전환 |
| `integration-tests/http/coupon-admin.spec.ts` | `campaign` 기반 `not_started`/`expired` 케이스 전환 |

**수정 — 그 밖**

| 파일 | 무엇을 |
|---|---|
| `apps/admin-web/.../coupons/lib/build-create-promotion-payload.ts` | 날짜를 `additional_data` 로 · `hasCampaign` 을 예산만으로 |
| `apps/admin-web/.../coupons/lib/build-create-promotion-payload.spec.ts` | 위 스펙 |
| `apps/admin-web/.../coupons/components/coupon-create-dialog.tsx` | 「유효기간(일)」 입력란 · 라벨 |
| `apps/admin-web/.../coupons/coupon-helpers.tsx` | `formatPeriod` 를 metadata 기준으로 |
| `apps/admin-web/.../coupons/template/marketing-coupons-template.tsx` | 만료 판정 |
| `apps/admin-web/.../coupons/lib/coupon-meta.ts` · `.spec.ts` | `birthday` 제거 |
| `apps/admin-web/src/lib/api/domains/medusa/promotions.ts` | metadata 타입 3필드 |
| `apps/channel-adapter/src/adapters/medusa/medusa.client.ts` | `birthday` 제거 |
| `packages/domain-types/coupon-vocabulary-drift.spec.ts` | 기대 어휘에서 `birthday` 제거 |
| `web/almondyoung-storefront/src/lib/types/dto/promotion.ts` | `expires_at` |
| `web/almondyoung-storefront/src/domains/mypage/template/coupon/coupon-template.tsx` | `campaign.ends_at` → `expires_at` |

---

## Task 1: 유효기간 판정 순수 함수

만료 규칙 전체가 이 파일 하나에 산다. 이후 모든 태스크가 여기를 부른다.

**Files:**
- Create: `apps/medusa/src/modules/promotion-meta/validity.ts`
- Test: `apps/medusa/src/modules/promotion-meta/__tests__/validity.unit.spec.ts`

**Interfaces:**
- Consumes: 없음 (첫 태스크)
- Produces:
  - `type ValidityPolicy = { starts_at?: Date | string | null; ends_at?: Date | string | null; validity_days?: number | string | null }`
  - `type IssuedInstance = { expires_at?: Date | string | null } | null | undefined`
  - `type WindowState = 'ok' | 'not_started' | 'ended'`
  - `computeExpiresAt(policy: ValidityPolicy | null | undefined, issuedAt: Date): Date | null`
  - `issuanceWindowState(policy: ValidityPolicy | null | undefined, now: Date): WindowState`
  - `isWithinIssuanceWindow(policy: ValidityPolicy | null | undefined, now: Date): boolean`
  - `isUsable(instance: IssuedInstance, policy: ValidityPolicy | null | undefined, now: Date): boolean`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`apps/medusa/src/modules/promotion-meta/__tests__/validity.unit.spec.ts`:

```ts
import {
  computeExpiresAt,
  issuanceWindowState,
  isWithinIssuanceWindow,
  isUsable,
} from '../validity';

const NOW = new Date('2026-08-31T00:00:00.000Z');

describe('computeExpiresAt — 발급 시점에 링크 행에 박을 값', () => {
  it('validity_days 가 있으면 발급일 + N일', () => {
    expect(computeExpiresAt({ validity_days: 30 }, NOW)).toEqual(
      new Date('2026-09-30T00:00:00.000Z'),
    );
  });

  it('validity_days 가 문자열로 와도(숫자 컬럼의 DB 표현) 계산된다', () => {
    expect(computeExpiresAt({ validity_days: '7' }, NOW)).toEqual(
      new Date('2026-09-07T00:00:00.000Z'),
    );
  });

  it('validity_days 가 없으면 정책의 절대 만료일을 그대로 박는다', () => {
    expect(computeExpiresAt({ ends_at: '2026-12-31T23:59:59.000Z' }, NOW)).toEqual(
      new Date('2026-12-31T23:59:59.000Z'),
    );
  });

  it('validity_days 가 ends_at 보다 우선한다 — 둘 다 있으면 상대가 이긴다', () => {
    expect(
      computeExpiresAt({ validity_days: 10, ends_at: '2026-12-31T00:00:00.000Z' }, NOW),
    ).toEqual(new Date('2026-09-10T00:00:00.000Z'));
  });

  it('둘 다 없으면 무기한(null)', () => {
    expect(computeExpiresAt({}, NOW)).toBeNull();
    expect(computeExpiresAt(null, NOW)).toBeNull();
  });
});

describe('issuanceWindowState — 지금 발급할 수 있는가', () => {
  it('창이 없으면 항상 ok', () => {
    expect(issuanceWindowState({}, NOW)).toEqual('ok');
    expect(issuanceWindowState(null, NOW)).toEqual('ok');
  });

  it('시작 전이면 not_started', () => {
    expect(issuanceWindowState({ starts_at: '2999-01-01T00:00:00.000Z' }, NOW)).toEqual(
      'not_started',
    );
  });

  it('종료 후면 ended', () => {
    expect(issuanceWindowState({ ends_at: '2000-01-01T00:00:00.000Z' }, NOW)).toEqual('ended');
  });

  it('경계는 포함이다 — 시작 시각 정각과 종료 시각 정각 모두 ok', () => {
    expect(issuanceWindowState({ starts_at: NOW }, NOW)).toEqual('ok');
    expect(issuanceWindowState({ ends_at: NOW }, NOW)).toEqual('ok');
  });

  it('isWithinIssuanceWindow 는 ok 여부다', () => {
    expect(isWithinIssuanceWindow({ ends_at: '2000-01-01T00:00:00.000Z' }, NOW)).toBe(false);
    expect(isWithinIssuanceWindow({}, NOW)).toBe(true);
  });
});

describe('isUsable — 링크 행이 있으면 그 행이, 없으면 정책이 만료를 정한다', () => {
  it('발급된 장은 정책 창이 지나도 자기 만료까지 산다 — 이 작업의 존재 이유', () => {
    const policy = { ends_at: '2000-01-01T00:00:00.000Z' };
    const instance = { expires_at: '2026-09-30T00:00:00.000Z' };
    expect(isUsable(instance, policy, NOW)).toBe(true);
  });

  it('발급된 장의 만료가 지났으면 못 쓴다', () => {
    expect(isUsable({ expires_at: '2026-08-30T23:59:59.000Z' }, {}, NOW)).toBe(false);
  });

  it('링크가 없으면(=public) 정책의 ends_at 이 만료다', () => {
    expect(isUsable(null, { ends_at: '2000-01-01T00:00:00.000Z' }, NOW)).toBe(false);
    expect(isUsable(null, { ends_at: '2999-01-01T00:00:00.000Z' }, NOW)).toBe(true);
  });

  it('링크는 있는데 expires_at 이 NULL 이면 무기한이다 (옛 링크·롤링 중 발급)', () => {
    expect(isUsable({ expires_at: null }, { ends_at: '2000-01-01T00:00:00.000Z' }, NOW)).toBe(true);
  });

  it('시작 전이면 발급 여부와 무관하게 못 쓴다', () => {
    const policy = { starts_at: '2999-01-01T00:00:00.000Z' };
    expect(isUsable(null, policy, NOW)).toBe(false);
    expect(isUsable({ expires_at: '2999-12-31T00:00:00.000Z' }, policy, NOW)).toBe(false);
  });

  it('정책도 링크도 비어 있으면 무기한', () => {
    expect(isUsable(null, null, NOW)).toBe(true);
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

```bash
cd apps/medusa && TEST_TYPE=unit NODE_OPTIONS=--experimental-vm-modules npx jest validity.unit --silent=false --runInBand --forceExit
```
Expected: FAIL — `Cannot find module '../validity'`

- [ ] **Step 3: 구현한다**

`apps/medusa/src/modules/promotion-meta/validity.ts`:

```ts
/**
 * 쿠폰 유효기간의 «두 축» 판정 (#488 결정 1, P4+P5).
 *
 * - **정책 축** (`promotion_meta.starts_at`/`ends_at`/`validity_days`) — 쿠폰 자체가 살아있는 구간.
 *   `claimable`·`assigned_only` 에겐 **발급 가능 구간**, `public` 에겐 발급이라는 사건이 없으므로
 *   그대로 **사용 가능 구간**이다.
 * - **인스턴스 축** (링크 행의 `expires_at`) — 발급된 한 장의 수명. 발급 시점에 계산해 박는다.
 *   정책에서 매번 도출하면 「+30일」을 「+7일」로 바꾸는 순간 이미 발급된 쿠폰이 소급 만료된다.
 *
 * 캠페인 날짜는 쓰지 않는다 — `computeActions` 가 `listActivePromotions_` 를 타서 캠페인 창이
 * 지난 프로모션을 할인 계산에서 **제외**하므로, 「발급 후 N일」이 표현되지 않는다.
 *
 * 컨테이너도 워크플로도 모르는 순수 함수다. 라우트 안 클로저로 두면 검증 대상 밖이다(#488 P1 교훈).
 */

export type ValidityPolicy = {
  starts_at?: Date | string | null;
  ends_at?: Date | string | null;
  /** 숫자 컬럼이 DB 에서 문자열로 오는 경우가 있어 union 이다(`issued_count` 와 같은 이유). */
  validity_days?: number | string | null;
};

export type IssuedInstance = { expires_at?: Date | string | null } | null | undefined;

export type WindowState = 'ok' | 'not_started' | 'ended';

const DAY_MS = 24 * 60 * 60 * 1000;

function toDate(value: Date | string | null | undefined): Date | null {
  if (value == null) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function toDays(value: number | string | null | undefined): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}

/**
 * 발급 시점에 링크 행 `expires_at` 에 박을 값. `null` 이면 무기한.
 *
 * `validity_days` 가 `ends_at` 보다 우선한다 — 상대 만료를 지정했다는 것은 「창과 무관하게
 * 받은 날부터 N일」이라는 뜻이기 때문이다. DB CHECK 로 둘의 공존을 막지는 않는다(정책 변경 중
 * 잠깐 둘 다 채워질 수 있다).
 */
export function computeExpiresAt(
  policy: ValidityPolicy | null | undefined,
  issuedAt: Date,
): Date | null {
  const days = toDays(policy?.validity_days);
  if (days !== null) return new Date(issuedAt.getTime() + days * DAY_MS);
  return toDate(policy?.ends_at);
}

/** 지금 이 쿠폰을 **발급**할 수 있는가. 경계 시각은 양쪽 다 포함이다. */
export function issuanceWindowState(
  policy: ValidityPolicy | null | undefined,
  now: Date,
): WindowState {
  const startsAt = toDate(policy?.starts_at);
  if (startsAt && now < startsAt) return 'not_started';
  const endsAt = toDate(policy?.ends_at);
  if (endsAt && now > endsAt) return 'ended';
  return 'ok';
}

export function isWithinIssuanceWindow(
  policy: ValidityPolicy | null | undefined,
  now: Date,
): boolean {
  return issuanceWindowState(policy, now) === 'ok';
}

/**
 * 지금 이 쿠폰을 **사용**할 수 있는가.
 *
 * 만료의 주인은 **링크 행이 있으면 링크 행**이다 — 그래야 「발급 마지막 날 받은 +30일 쿠폰이
 * 발급 창 종료와 함께 죽는」 일이 없다. 링크가 없으면(=발급 개념이 없는 `public`) 정책이 정한다.
 *
 * ⚠️ `expires_at` 이 NULL 인 링크는 **무기한**으로 읽는다. 이 변경 전에 발급된 행과, 롤링 배포
 * 중 옛 태스크가 만든 행이 그렇다. 만료 방향으로 fail-open 이고, 방향이 「고객에게 유리」다.
 * 기존 행은 `scripts/detach-coupon-campaigns.ts` 가 정책값으로 백필한다.
 */
export function isUsable(
  instance: IssuedInstance,
  policy: ValidityPolicy | null | undefined,
  now: Date,
): boolean {
  const startsAt = toDate(policy?.starts_at);
  if (startsAt && now < startsAt) return false;

  const expiresAt = instance ? toDate(instance.expires_at) : toDate(policy?.ends_at);
  if (expiresAt && now > expiresAt) return false;

  return true;
}
```

- [ ] **Step 4: 통과를 확인한다**

```bash
cd apps/medusa && TEST_TYPE=unit NODE_OPTIONS=--experimental-vm-modules npx jest validity.unit --silent=false --runInBand --forceExit
```
Expected: PASS (18 tests)

- [ ] **Step 5: 커밋**

```bash
git add apps/medusa/src/modules/promotion-meta/validity.ts \
        apps/medusa/src/modules/promotion-meta/__tests__/validity.unit.spec.ts
git commit -m "feat(coupon): 유효기간 두 축 판정을 순수 함수로 뽑는다

정책 축(promotion_meta 창)과 인스턴스 축(링크 행 expires_at)을 한 파일에 모은다.
만료의 주인은 링크 행이 있으면 링크 행이다 — 그래야 발급 창이 닫혀도 이미 발급된
쿠폰이 자기 유효기간까지 산다. expires_at NULL 은 무기한으로 읽으며, 그 fail-open 은
옛 링크와 롤링 중 발급을 위한 것이다."
```

---

## Task 2: `promotion_meta` 3열 — 마이그레이션 · 모델 · 서비스

**Files:**
- Create: `apps/medusa/src/modules/promotion-meta/migrations/Migration20260831100000.ts`
- Modify: `apps/medusa/src/modules/promotion-meta/models/promotion-meta.ts`
- Modify: `apps/medusa/src/modules/promotion-meta/service.ts`
- Test: `apps/medusa/src/modules/promotion-meta/__tests__/service.integration.spec.ts` (기존 파일에 추가)

**Interfaces:**
- Consumes: Task 1 의 `ValidityPolicy` (타입 호환만 — import 하지 않는다)
- Produces: `PromotionMetaData` 에 `starts_at?: Date | string | null` · `ends_at?: Date | string | null` · `validity_days?: number | null`. `getByPromotionId`/`getByPromotionIds` 가 이 세 필드를 실어 돌려준다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`apps/medusa/src/modules/promotion-meta/__tests__/service.integration.spec.ts` 의 `describe('PromotionMetaModuleService', ...)` 안 마지막에 추가:

```ts
      it('유효기간 3열을 저장하고 되읽는다', async () => {
        await service.upsert({
          promotion_id: 'promo_validity',
          starts_at: new Date('2026-09-01T00:00:00.000Z'),
          ends_at: new Date('2026-09-30T00:00:00.000Z'),
          validity_days: 14,
        });
        const rec = await service.getByPromotionId('promo_validity');
        expect(new Date(rec.starts_at).toISOString()).toEqual('2026-09-01T00:00:00.000Z');
        expect(new Date(rec.ends_at).toISOString()).toEqual('2026-09-30T00:00:00.000Z');
        expect(Number(rec.validity_days)).toEqual(14);
      });

      it('유효기간 3열은 선택이다 — 안 주면 null 로 남는다', async () => {
        await service.upsert({ promotion_id: 'promo_no_validity' });
        const rec = await service.getByPromotionId('promo_no_validity');
        expect(rec.starts_at).toBeNull();
        expect(rec.ends_at).toBeNull();
        expect(rec.validity_days).toBeNull();
      });

      it('validity_days 는 양의 정수만 받는다', async () => {
        await expect(
          service.upsert({ promotion_id: 'promo_bad_days', validity_days: 0 }),
        ).rejects.toThrow(/validity_days/);
        await expect(
          service.upsert({ promotion_id: 'promo_bad_days2', validity_days: 1.5 }),
        ).rejects.toThrow(/validity_days/);
      });
```

- [ ] **Step 2: 실패를 확인한다**

```bash
cd apps/medusa && npm run test:integration:modules
```
Expected: FAIL — 새 세 테스트가 `column "starts_at" does not exist` 또는 값 불일치로 죽는다

- [ ] **Step 3: 마이그레이션을 쓴다**

`apps/medusa/src/modules/promotion-meta/migrations/Migration20260831100000.ts`:

```ts
import { Migration } from '@medusajs/framework/mikro-orm/migrations';

/**
 * 유효기간 두 축 (#488 결정 1).
 *
 * `starts_at`/`ends_at` 은 오늘 `promotion_campaign.starts_at`/`ends_at` 의 **1:1 이사**다.
 * 그래서 기존 값을 백필한다 — 안 하면 이미 만든 쿠폰의 기간이 화면에서 사라진다.
 *
 * ⚠️ 백필은 코어 소유 테이블(`promotion`·`promotion_campaign`)에서 **읽기만** 한다.
 * 캠페인을 비우고 떼는 쓰기는 `src/scripts/detach-coupon-campaigns.ts` 가 배포 후에 한다 —
 * 남의 모듈 테이블을 우리 모듈 마이그레이션이 UPDATE 하면 모듈 격리를 어기고 down() 이 복원 불가다.
 */
export class Migration20260831100000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`ALTER TABLE "promotion_meta" ADD COLUMN IF NOT EXISTS "starts_at" timestamptz NULL;`);
    this.addSql(`ALTER TABLE "promotion_meta" ADD COLUMN IF NOT EXISTS "ends_at" timestamptz NULL;`);
    this.addSql(`ALTER TABLE "promotion_meta" ADD COLUMN IF NOT EXISTS "validity_days" integer NULL;`);

    this.addSql(
      `ALTER TABLE "promotion_meta" ADD CONSTRAINT "promotion_meta_validity_days_check" ` +
        `CHECK ("validity_days" IS NULL OR "validity_days" > 0);`,
    );

    this.addSql(
      `UPDATE "promotion_meta" m ` +
        `SET "starts_at" = c."starts_at", "ends_at" = c."ends_at" ` +
        `FROM "promotion" p JOIN "promotion_campaign" c ON c."id" = p."campaign_id" ` +
        `WHERE p."id" = m."promotion_id" ` +
        `AND m."deleted_at" IS NULL AND p."deleted_at" IS NULL AND c."deleted_at" IS NULL;`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(`ALTER TABLE "promotion_meta" DROP CONSTRAINT IF EXISTS "promotion_meta_validity_days_check";`);
    this.addSql(`ALTER TABLE "promotion_meta" DROP COLUMN IF EXISTS "validity_days";`);
    this.addSql(`ALTER TABLE "promotion_meta" DROP COLUMN IF EXISTS "ends_at";`);
    this.addSql(`ALTER TABLE "promotion_meta" DROP COLUMN IF EXISTS "starts_at";`);
  }
}
```

- [ ] **Step 4: 모델에 세 필드를 더한다**

`apps/medusa/src/modules/promotion-meta/models/promotion-meta.ts` — `auto_issue_trigger` 줄 아래에 추가:

```ts
      auto_issue_trigger: model.text().nullable(),
      // 유효기간 «정책 축» (#488 결정 1). 인스턴스 축은 customer↔promotion 링크 행의 expires_at 이다.
      // claimable/assigned_only 에겐 발급 가능 구간, public 에겐 사용 가능 구간으로 읽힌다.
      starts_at: model.dateTime().nullable(),
      ends_at: model.dateTime().nullable(),
      /** 발급일 + N일. null 이면 만료는 ends_at 이 정한다. */
      validity_days: model.number().nullable(),
```

- [ ] **Step 5: 서비스 타입과 검증을 고친다**

`apps/medusa/src/modules/promotion-meta/service.ts` — `PromotionMetaData` 에 세 필드 추가:

```ts
export type PromotionMetaData = {
  promotion_id: string;
  name?: string | null;
  max_discount_amount?: number | null;
  created_by?: string | null;
  visibility?: 'public' | 'claimable' | 'assigned_only' | null;
  max_claims?: number | null;
  auto_issue_trigger?: AutoIssueTrigger | null;
  starts_at?: Date | string | null;
  ends_at?: Date | string | null;
  validity_days?: number | null;
};
```

`upsert` 의 `auto_issue_trigger` 검증 바로 아래에 추가:

```ts
    if (data.validity_days != null) {
      const n = Number(data.validity_days);
      if (!Number.isInteger(n) || n <= 0) {
        throw new Error(`Invalid validity_days value: ${data.validity_days}`);
      }
    }
```

- [ ] **Step 6: 통과를 확인한다**

```bash
cd apps/medusa && npm run test:integration:modules
```
Expected: PASS — 기존 케이스 전부 + 새 3건

- [ ] **Step 7: 커밋**

```bash
git add apps/medusa/src/modules/promotion-meta/
git commit -m "feat(coupon): promotion_meta 에 유효기간 정책 3열을 더한다

starts_at/ends_at 은 campaign 날짜의 1:1 이사라 기존 값을 백필한다.
validity_days 는 발급일+N일이며 양의 정수만 받는다(DB CHECK + 서비스 검증 이중).
백필은 코어 테이블에서 읽기만 한다 — 비우고 떼는 쓰기는 배포 후 스크립트가 한다."
```

---

## Task 3: `birthday` 어휘 제거

드리프트 가드가 지목하는 7곳 + 가드 자신 + 부수 3곳을 **한 커밋으로** 없앤다. 나눠 하면 가드가 중간 상태에서 빨개진다.

**Files:**
- Create: `apps/medusa/src/modules/promotion-meta/migrations/Migration20260831110000.ts`
- Modify: `apps/medusa/src/modules/promotion-meta/service.ts:12,36`
- Modify: `apps/medusa/src/api/admin/promotions/additional-data-schema.ts:23`
- Modify: `apps/medusa/src/api/admin/customers/[id]/issue-coupons/route.ts:8`
- Modify: `apps/channel-adapter/src/adapters/medusa/medusa.client.ts:2399`
- Modify: `apps/admin-web/src/features/mall/marketing/coupons/lib/coupon-meta.ts:11,18`
- Modify: `apps/admin-web/src/features/mall/marketing/coupons/lib/coupon-meta.spec.ts:51`
- Modify: `apps/admin-web/src/features/mall/marketing/coupons/components/coupon-create-dialog.tsx:595`
- Test: `packages/domain-types/coupon-vocabulary-drift.spec.ts:30`

**Interfaces:**
- Consumes: Task 2 의 마이그레이션 순번(이 마이그레이션이 뒤에 온다)
- Produces: `AutoIssueTrigger = 'customer_registered' | 'membership_activated'`

- [ ] **Step 1: 드리프트 가드의 기대값을 먼저 바꿔 실패를 만든다**

`packages/domain-types/coupon-vocabulary-drift.spec.ts:30`:

```ts
const AUTO_ISSUE_TRIGGERS = ['customer_registered', 'membership_activated'] as const;
```

- [ ] **Step 2: 실패를 확인한다 — 가드가 고칠 곳을 이름으로 지목한다**

```bash
npx jest coupon-vocabulary-drift --maxWorkers=2
```
Expected: FAIL 7건 — 각 실패 메시지가 사이트 이름을 그대로 알려준다 (zod enum · AutoIssueTrigger 타입 · upsert 인라인 검증 · VALID_TRIGGERS · DB CHECK · channel-adapter 시그니처 · admin-web 사본)

- [ ] **Step 3: 지목된 7곳을 고친다**

`apps/medusa/src/modules/promotion-meta/service.ts:12`:
```ts
export type AutoIssueTrigger = 'customer_registered' | 'membership_activated';
```

`apps/medusa/src/modules/promotion-meta/service.ts:36`:
```ts
    if (data.auto_issue_trigger != null && !['customer_registered', 'membership_activated'].includes(data.auto_issue_trigger)) {
```

`apps/medusa/src/api/admin/promotions/additional-data-schema.ts:23`:
```ts
const autoIssueTrigger = z.enum(['customer_registered', 'membership_activated']);
```

`apps/medusa/src/api/admin/customers/[id]/issue-coupons/route.ts:8`:
```ts
const VALID_TRIGGERS: AutoIssueTrigger[] = ['customer_registered', 'membership_activated'];
```

`apps/channel-adapter/src/adapters/medusa/medusa.client.ts:2399`:
```ts
    trigger: 'customer_registered' | 'membership_activated',
```

`apps/admin-web/src/features/mall/marketing/coupons/lib/coupon-meta.ts:11`:
```ts
export const AUTO_ISSUE_TRIGGERS = ['customer_registered', 'membership_activated'] as const;
```

DB CHECK — `apps/medusa/src/modules/promotion-meta/migrations/Migration20260831110000.ts`:
```ts
import { Migration } from '@medusajs/framework/mikro-orm/migrations';

/**
 * `birthday` 트리거 폐지 (#488 마스터플랜 결정 2).
 *
 * 라이브 실측 0건이나(2026-08-31), dev/로컬 DB 에 남아 있으면 CHECK 추가가 실패하므로
 * 방어적으로 먼저 비운다. 생일 발급은 구현하지 않기로 했고 UI 에서도 disabled 였다.
 */
export class Migration20260831110000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`UPDATE "promotion_meta" SET "auto_issue_trigger" = NULL WHERE "auto_issue_trigger" = 'birthday';`);
    this.addSql(`ALTER TABLE "promotion_meta" DROP CONSTRAINT IF EXISTS "promotion_meta_auto_issue_trigger_check";`);
    this.addSql(
      `ALTER TABLE "promotion_meta" ADD CONSTRAINT "promotion_meta_auto_issue_trigger_check" ` +
        `CHECK ("auto_issue_trigger" IS NULL OR "auto_issue_trigger" IN ('customer_registered', 'membership_activated'));`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(`ALTER TABLE "promotion_meta" DROP CONSTRAINT IF EXISTS "promotion_meta_auto_issue_trigger_check";`);
    this.addSql(
      `ALTER TABLE "promotion_meta" ADD CONSTRAINT "promotion_meta_auto_issue_trigger_check" ` +
        `CHECK ("auto_issue_trigger" IS NULL OR "auto_issue_trigger" IN ('customer_registered', 'membership_activated', 'birthday'));`,
    );
  }
}
```

- [ ] **Step 4: 부수 3곳을 고친다**

`apps/admin-web/src/features/mall/marketing/coupons/lib/coupon-meta.ts:18` — 라벨 맵에서 `birthday` 줄을 **삭제**한다:
```ts
  birthday: '생일 (미구현 — 발급되지 않음)',   // ← 이 줄 삭제
```

`apps/admin-web/src/features/mall/marketing/coupons/lib/coupon-meta.spec.ts:51` — 해당 `expect` 줄을 삭제한다:
```ts
    expect(getCouponMeta(promo({ auto_issue_trigger: 'birthday' })).autoIssueTrigger).toBe('birthday');  // ← 삭제
```

`apps/admin-web/src/features/mall/marketing/coupons/components/coupon-create-dialog.tsx:595` — `disabled` 를 뺀다(어휘에 없으므로 항목 자체가 안 나온다):
```tsx
                  <SelectItem key={key} value={key}>{label}</SelectItem>
```

- [ ] **Step 5: 전부 통과를 확인한다**

```bash
npx jest coupon-vocabulary-drift --maxWorkers=2
cd apps/medusa && npm run test:integration:modules
cd apps/admin-web && npx tsc --noEmit && npm run test:admin-web
```
Expected: 셋 다 PASS

- [ ] **Step 6: 커밋**

```bash
git add apps/medusa/src/modules/promotion-meta/ \
        apps/medusa/src/api/admin/promotions/additional-data-schema.ts \
        "apps/medusa/src/api/admin/customers/[id]/issue-coupons/route.ts" \
        apps/channel-adapter/src/adapters/medusa/medusa.client.ts \
        apps/admin-web/src/features/mall/marketing/coupons/ \
        packages/domain-types/coupon-vocabulary-drift.spec.ts
git commit -m "refactor(coupon): birthday 트리거를 어휘에서 제거한다 (결정 2)

구현하지 않기로 했고 UI 에서도 disabled 였다. 라이브 실측 0건이나 dev DB 대비
마이그레이션이 먼저 NULL 로 비운 뒤 CHECK 를 교체한다.
고칠 곳은 드리프트 가드가 이름으로 지목했다 — 가드 기대값을 먼저 바꿔 실패를 만들고 따라갔다."
```

---

## Task 4: 링크 `extraColumns` — 그리고 upsert 의미론 실측

스펙 §2 ⓑ 3번의 미확정(「`23505` 분기가 닿는가」)을 여기서 닫는다.

**Files:**
- Modify: `apps/medusa/src/links/customer-promotion.ts`
- Create: `apps/medusa/integration-tests/http/coupon-validity.spec.ts`

**Interfaces:**
- Consumes: 없음
- Produces: 링크 행이 `expires_at`(datetime) · `used_at`(datetime) · `order_id`(string) · `issued_via`(string) 를 갖는다. 전부 nullable.

- [ ] **Step 1: 실패하는 테스트를 쓴다 (T3)**

`apps/medusa/integration-tests/http/coupon-validity.spec.ts`:

```ts
import { medusaIntegrationTestRunner } from '@medusajs/test-utils';
import { Modules, ContainerRegistrationKeys } from '@medusajs/framework/utils';
import jwt from 'jsonwebtoken';

jest.setTimeout(180 * 1000);

/**
 * 유효기간 두 축 (#488 P4+P5) 의 통합 스펙.
 * T1~T6 은 플랜 문서의 번호와 같다.
 */
medusaIntegrationTestRunner({
  inApp: true,
  env: {},
  disableAutoTeardown: true,
  testSuite: ({ api, getContainer }) => {
    let adminHeaders: { headers: Record<string, string> };
    let customerId: string;
    let seq = 0;

    const linkModule = () =>
      (getContainer().resolve(ContainerRegistrationKeys.LINK) as any).getLinkModule(
        Modules.CUSTOMER,
        'customer_id',
        Modules.PROMOTION,
        'promotion_id',
      );

    const listLinks = (promotionId: string) =>
      linkModule().list(
        { promotion_id: promotionId },
        { select: ['customer_id', 'promotion_id', 'expires_at', 'used_at', 'order_id', 'issued_via'] },
      ) as Promise<any[]>;

    beforeEach(async () => {
      seq++;
      const container = getContainer();
      const config = container.resolve(ContainerRegistrationKeys.CONFIG_MODULE) as any;
      const secret = config.projectConfig.http.jwtSecret;
      const userModule = container.resolve(Modules.USER);
      const [user] = await userModule.createUsers([{ email: `admin${seq}@validity.test` }]);
      adminHeaders = {
        headers: {
          authorization: `Bearer ${jwt.sign(
            { actor_id: user.id, actor_type: 'user', auth_identity_id: 'a', app_metadata: { user_id: user.id } },
            secret,
          )}`,
        },
      };
      const customerModule = container.resolve(Modules.CUSTOMER);
      const [cust] = await customerModule.createCustomers([{ email: `buyer${seq}@validity.test` }]);
      customerId = cust.id;
    });

    const createPromo = async (code: string, additional_data: Record<string, unknown>) => {
      const res = await api.post(
        '/admin/promotions',
        {
          code,
          type: 'standard',
          is_automatic: false,
          status: 'active',
          application_method: { type: 'percentage', value: 10, target_type: 'order', currency_code: 'krw' },
          additional_data,
        },
        adminHeaders,
      );
      return res.data.promotion.id as string;
    };

    describe('T3: Link.create 의 의미론', () => {
      it('같은 쌍을 두 번 create 해도 행은 하나이고 예외가 나지 않는다 (upsert)', async () => {
        const id = await createPromo(`UPSERT${seq}`, { visibility: 'assigned_only' });
        const link = getContainer().resolve(ContainerRegistrationKeys.LINK) as any;
        const pair = {
          [Modules.CUSTOMER]: { customer_id: customerId },
          [Modules.PROMOTION]: { promotion_id: id },
        };

        await link.create([pair]);
        await expect(link.create([pair])).resolves.toBeDefined();

        const rows = await listLinks(id);
        expect(rows).toHaveLength(1);
      });

      it('data 로 준 extraColumns 가 실제로 저장되고, 재create 가 그것을 덮는다', async () => {
        const id = await createPromo(`EXTRA${seq}`, { visibility: 'assigned_only' });
        const link = getContainer().resolve(ContainerRegistrationKeys.LINK) as any;
        const base = {
          [Modules.CUSTOMER]: { customer_id: customerId },
          [Modules.PROMOTION]: { promotion_id: id },
        };

        await link.create([{
          ...base,
          data: {
            expires_at: new Date('2026-12-31T00:00:00.000Z'),
            issued_via: 'admin_manual',
            used_at: null,
            order_id: null,
          },
        }]);
        const [first] = await listLinks(id);
        expect(new Date(first.expires_at).toISOString()).toEqual('2026-12-31T00:00:00.000Z');
        expect(first.issued_via).toEqual('admin_manual');

        await link.create([{
          ...base,
          data: {
            expires_at: new Date('2027-01-31T00:00:00.000Z'),
            issued_via: 'customer_claim',
            used_at: null,
            order_id: null,
          },
        }]);
        const rows = await listLinks(id);
        expect(rows).toHaveLength(1);
        expect(new Date(rows[0].expires_at).toISOString()).toEqual('2027-01-31T00:00:00.000Z');
        expect(rows[0].issued_via).toEqual('customer_claim');
      });

      it('dismiss 후 create 는 같은 행을 되살린다 — 옛 extraColumns 가 남는다', async () => {
        const id = await createPromo(`REVIVE${seq}`, { visibility: 'assigned_only' });
        const link = getContainer().resolve(ContainerRegistrationKeys.LINK) as any;
        const base = {
          [Modules.CUSTOMER]: { customer_id: customerId },
          [Modules.PROMOTION]: { promotion_id: id },
        };

        await link.create([{ ...base, data: { used_at: new Date(), order_id: 'order_old' } }]);
        await link.dismiss([base]);
        // data 없이 되살리면 옛 값이 그대로 남는다 — 그래서 발급 경로가 네 필드를 명시한다
        await link.create([base]);

        const rows = await listLinks(id);
        expect(rows).toHaveLength(1);
        expect(rows[0].order_id).toEqual('order_old');
      });

      it('스칼라 필터로 한 쌍만 조회할 수 있다 (카트 게이트가 이 조회를 쓴다)', async () => {
        const id = await createPromo(`SCALAR${seq}`, { visibility: 'assigned_only' });
        const link = getContainer().resolve(ContainerRegistrationKeys.LINK) as any;
        await link.create([{
          [Modules.CUSTOMER]: { customer_id: customerId },
          [Modules.PROMOTION]: { promotion_id: id },
          data: { issued_via: 'admin_manual' },
        }]);

        const rows = (await linkModule().list(
          { customer_id: customerId, promotion_id: id },
          { select: ['customer_id', 'promotion_id', 'issued_via'] },
        )) as any[];
        expect(rows).toHaveLength(1);
        expect(rows[0].issued_via).toEqual('admin_manual');
      });
    });
  },
});
```

- [ ] **Step 2: 실패를 확인한다**

```bash
cd apps/medusa && TEST_TYPE=integration:http NODE_OPTIONS=--experimental-vm-modules npx jest coupon-validity --silent=false --runInBand --forceExit
```
Expected: FAIL — `expires_at` 등 컬럼이 없어 `select` 나 `data` 기입이 죽는다

- [ ] **Step 3: `extraColumns` 를 더한다**

`apps/medusa/src/links/customer-promotion.ts` 전문:

```ts
import { defineLink } from '@medusajs/framework/utils';
import CustomerModule from '@medusajs/medusa/customer';
import PromotionModule from '@medusajs/medusa/promotion';

// isList: true on both sides = many-to-many
// 한 쿠폰을 여러 고객에게 발급하고, 한 고객이 여러 쿠폰을 가질 수 있음
//
// `extraColumns` 로 발급된 «한 장»의 상태를 링크 행에 싣는다 (#488 N4 → 7-1 · 7-7 · A2).
// 그전까지 인스턴스가 못 하던 일을 클래스(`promotion_meta.issued_count`)와
// 사이드테이블(`promotion_issue_log`)이 나눠 하고 있었다.
//
// ⚠️ `issued_count` 는 옮기지 않는다 — 원자적 예약이 목적이라 링크를 COUNT 하는 순간
//    원자성을 잃는다. #488 본문 7-1 의 「링크 수에서 도출」 제안은 따르지 않는다.
//
// ⚠️ 이 스키마 변경에는 **마이그레이션 파일이 없다.** 컨테이너 CMD 의
//    `medusa db:migrate --execute-safe-links` 가 적용한다 — `--execute-safe` 는 SQL 에
//    `alter column`/`drop column` 이 있는 변경만 건너뛰고, nullable 컬럼 «추가»는
//    `add column` 이라 안전 목록에 든다
//    (`@medusajs/link-modules/dist/migration/index.js:40,254-258`).
export default defineLink(
  { linkable: CustomerModule.linkable.customer, isList: true },
  { linkable: PromotionModule.linkable.promotion, isList: true },
  {
    database: {
      extraColumns: {
        /** 이 «한 장»의 만료 시각. 발급 시점에 계산해 박는다. null = 무기한. */
        expires_at: { type: 'datetime', nullable: true },
        /** 이 «한 장»이 주문에 쓰인 시각. */
        used_at: { type: 'datetime', nullable: true },
        /** 이 «한 장»이 쓰인 주문. A2(취소·환불 시 복구)가 여기서 시작한다. */
        order_id: { type: 'string', nullable: true },
        /** 발급 경로. `IssueTrigger` 어휘(`promotion_issue_log.trigger` 와 같은 어휘). */
        issued_via: { type: 'string', nullable: true },
      },
    },
  },
);
```

- [ ] **Step 4: 통과를 확인한다**

```bash
cd apps/medusa && TEST_TYPE=integration:http NODE_OPTIONS=--experimental-vm-modules npx jest coupon-validity --silent=false --runInBand --forceExit
```
Expected: PASS (4 tests)

> **여기서 나온 사실을 스펙에 반영한다.** 세 번째 테스트(`23505` 가 나지 않는다)가 통과하면
> 발급 3경로의 duplicate catch 분기는 도달 불가다 — Task 6 에서 그 분기를 지운다.
> 만약 예상과 달리 `23505` 가 난다면 Task 6 의 catch 분기를 **남기고**, 스펙 §2 ⓑ 3번을 정정한다.

- [ ] **Step 5: 커밋**

```bash
git add apps/medusa/src/links/customer-promotion.ts \
        apps/medusa/integration-tests/http/coupon-validity.spec.ts
git commit -m "feat(coupon): 발급 링크 행에 expires_at·used_at·order_id·issued_via 를 싣는다

defineLink 의 extraColumns 다. 마이그레이션 파일은 없다 — 컨테이너 부팅의
db:migrate --execute-safe-links 가 add column 을 안전 변경으로 분류해 적용한다.

같은 스펙이 Link.create 의 의미론도 실측한다: 복합 PK 기반 upsert 라 재create 가
행을 늘리지 않고 extraColumns 를 덮으며, dismiss 후 create 는 같은 행을 되살려
옛 값이 남는다. 그래서 발급 경로가 네 필드를 전부 명시해야 한다."
```

---

## Task 5: 어드민 쓰기 표면 — 3키를 `additional_data` 로 받는다

**Files:**
- Modify: `apps/medusa/src/api/admin/promotions/additional-data-schema.ts`
- Modify: `apps/medusa/src/api/admin/promotions/helpers.ts`
- Test: `apps/medusa/src/api/admin/promotions/__tests__/additional-data-schema.unit.spec.ts`

**Interfaces:**
- Consumes: Task 2 의 `PromotionMetaData` 3필드
- Produces: `META_KEYS` 가 `['name','max_discount_amount','created_by','visibility','max_claims','auto_issue_trigger','starts_at','ends_at','validity_days']`. `toMetadataShape` 가 세 값을 실어 돌려준다.

> ⚠️ `META_KEYS` 와 검증 스키마의 키 집합은 **같아야 한다.** 프레임워크가 shape 을 `z.object(...)`
> 로 감싸는데 기본이 **strip** 이라, 스키마에 없는 키는 400 이 아니라 조용히 버려져 훅까지
> 도달하지 못한다. 기존 스펙이 그 일치를 강제한다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`apps/medusa/src/api/admin/promotions/__tests__/additional-data-schema.unit.spec.ts` 의 `describe` 안 마지막에 추가:

```ts
  it('유효기간 3키를 받는다', () => {
    const schema = z.object(promotionAdditionalDataUpdateShape);
    expect(schema.safeParse({ starts_at: '2026-09-01T00:00:00.000Z' }).success).toBe(true);
    expect(schema.safeParse({ ends_at: '2026-09-30T00:00:00.000Z' }).success).toBe(true);
    expect(schema.safeParse({ validity_days: 30 }).success).toBe(true);
  });

  it('validity_days 는 양의 정수만, 날짜는 파싱 가능한 문자열만 받는다', () => {
    const schema = z.object(promotionAdditionalDataUpdateShape);
    expect(schema.safeParse({ validity_days: 0 }).success).toBe(false);
    expect(schema.safeParse({ validity_days: 1.5 }).success).toBe(false);
    expect(schema.safeParse({ ends_at: '언젠가' }).success).toBe(false);
  });
```

(첫 케이스 「생성·수정 둘 다 `META_KEYS` 를 전부 받는다」는 자동으로 실패한다 — 그것이 진짜 게이트다.)

- [ ] **Step 2: 실패를 확인한다**

```bash
cd apps/medusa && TEST_TYPE=unit NODE_OPTIONS=--experimental-vm-modules npx jest additional-data-schema --silent=false --runInBand --forceExit
```
Expected: FAIL — 키 집합 불일치 + 새 3케이스

- [ ] **Step 3: 검증 스키마에 3키를 더한다**

`apps/medusa/src/api/admin/promotions/additional-data-schema.ts` — 상수 정의 아래에 추가하고 두 shape 에 넣는다:

```ts
const maxDiscountAmount = z.number().int().positive();
/** ISO 8601 문자열. 폼의 `datetime-local` 값을 `toISOString()` 한 것이 온다. */
const isoDateTime = z.string().refine((v) => !Number.isNaN(new Date(v).getTime()), {
  message: 'must be a parseable ISO date-time string',
});
const validityDays = z.number().int().positive();
```

`promotionAdditionalDataCreateShape` 에 추가:
```ts
  starts_at: isoDateTime.optional(),
  ends_at: isoDateTime.optional(),
  validity_days: validityDays.optional(),
```

`promotionAdditionalDataUpdateShape` 에도 같은 세 줄을 추가한다.

- [ ] **Step 4: `META_KEYS` 와 `toMetadataShape` 를 맞춘다**

`apps/medusa/src/api/admin/promotions/helpers.ts` — `META_KEYS` 에 추가:

```ts
export const META_KEYS = [
  'name',
  'max_discount_amount',
  'created_by',
  'visibility',
  'max_claims',
  'auto_issue_trigger',
  // 유효기간 «정책 축» (#488 결정 1). 인스턴스 축(링크 행 expires_at)은 발급 경로가 계산해 박는다.
  'starts_at',
  'ends_at',
  'validity_days',
] as const;
```

`toMetadataShape` 의 `issued_count` 줄 **앞**에 추가:

```ts
  if (record.starts_at != null) result.starts_at = record.starts_at;
  if (record.ends_at != null) result.ends_at = record.ends_at;
  if (record.validity_days != null) result.validity_days = record.validity_days;
```

- [ ] **Step 5: 통과를 확인한다**

```bash
cd apps/medusa && TEST_TYPE=unit NODE_OPTIONS=--experimental-vm-modules npx jest additional-data-schema --silent=false --runInBand --forceExit
cd apps/medusa && npm run test:integration:http
```
Expected: 둘 다 PASS

- [ ] **Step 6: 커밋**

```bash
git add apps/medusa/src/api/admin/promotions/
git commit -m "feat(coupon): additional_data 가 유효기간 3키를 받는다

META_KEYS 와 검증 스키마는 같은 집합이어야 한다 — 프레임워크의 z.object 가 strip 이라
스키마에 없는 키는 400 이 아니라 조용히 사라져 훅까지 못 간다. 기존 스펙이 그것을 강제한다."
```

---

## Task 6: 🔴 발급 3경로 — 창 검사 교체 · 인스턴스 기입 · `LINK` 통일

**Files:**
- Modify: `apps/medusa/src/api/admin/promotions/helpers.ts` (링크 조회 헬퍼 2개 추가)
- Modify: `apps/medusa/src/api/admin/customers/[id]/issue-coupons/route.ts`
- Modify: `apps/medusa/src/api/admin/customers/[id]/promotions/route.ts` (POST · DELETE)
- Modify: `apps/medusa/src/api/admin/promotions/[id]/customers/route.ts` (DELETE 의 `REMOTE_LINK`)
- Modify: `apps/medusa/src/api/store/customers/me/promotions/[id]/claim/route.ts`
- Modify: `apps/medusa/integration-tests/http/coupon-admin.spec.ts:174-192`
- Test: `apps/medusa/integration-tests/http/coupon-validity.spec.ts` (T1 · T2 추가)

**Interfaces:**
- Consumes: Task 1 `computeExpiresAt`/`issuanceWindowState`, Task 4 의 링크 컬럼
- Produces:
  - `findIssuedLink(scope: any, customerId: string, promotionId: string): Promise<IssuedLinkRow | null>`
  - `listIssuedLinks(scope: any, customerId: string): Promise<IssuedLinkRow[]>`
  - `type IssuedLinkRow = { customer_id: string; promotion_id: string; expires_at: string | Date | null; used_at: string | Date | null; order_id: string | null; issued_via: string | null }`

- [ ] **Step 1: 실패하는 테스트를 쓴다 (T1 · T2)**

`apps/medusa/integration-tests/http/coupon-validity.spec.ts` 의 `T3` describe **뒤**에 추가:

```ts
    describe('T1: 발급이 인스턴스 만료를 박는다', () => {
      it('관리자 수동 발급 — validity_days 가 발급일 + N일로 박힌다', async () => {
        const id = await createPromo(`MANUALREL${seq}`, {
          visibility: 'assigned_only',
          validity_days: 30,
        });
        const before = Date.now();
        await api.post(`/admin/customers/${customerId}/promotions`, { promotion_ids: [id] }, adminHeaders);

        const [row] = await listLinks(id);
        expect(row.issued_via).toEqual('admin_manual');
        const delta = new Date(row.expires_at).getTime() - before;
        expect(delta).toBeGreaterThan(29.9 * 24 * 3600 * 1000);
        expect(delta).toBeLessThan(30.1 * 24 * 3600 * 1000);
      });

      it('관리자 수동 발급 — validity_days 가 없으면 정책의 ends_at 이 박힌다', async () => {
        const id = await createPromo(`MANUALABS${seq}`, {
          visibility: 'assigned_only',
          ends_at: '2027-06-30T00:00:00.000Z',
        });
        await api.post(`/admin/customers/${customerId}/promotions`, { promotion_ids: [id] }, adminHeaders);

        const [row] = await listLinks(id);
        expect(new Date(row.expires_at).toISOString()).toEqual('2027-06-30T00:00:00.000Z');
      });

      it('둘 다 없으면 무기한(NULL)으로 박힌다', async () => {
        const id = await createPromo(`MANUALINF${seq}`, { visibility: 'assigned_only' });
        await api.post(`/admin/customers/${customerId}/promotions`, { promotion_ids: [id] }, adminHeaders);

        const [row] = await listLinks(id);
        expect(row.expires_at).toBeNull();
      });

      it('발급 창이 지난 쿠폰은 expired 로 skip 된다 — 캠페인이 아니라 meta 가 기준이다', async () => {
        const id = await createPromo(`WINDOWEND${seq}`, {
          visibility: 'assigned_only',
          ends_at: '2000-01-01T00:00:00.000Z',
        });
        const res = await api.post(
          `/admin/customers/${customerId}/promotions`,
          { promotion_ids: [id] },
          adminHeaders,
        );
        expect(res.data.skipped.find((s: any) => s.promotion_id === id)?.reason).toEqual('expired');
        expect(await listLinks(id)).toHaveLength(0);
      });

      it('발급 창이 아직인 쿠폰은 not_started 로 skip 된다', async () => {
        const id = await createPromo(`WINDOWSTART${seq}`, {
          visibility: 'assigned_only',
          starts_at: '2999-01-01T00:00:00.000Z',
        });
        const res = await api.post(
          `/admin/customers/${customerId}/promotions`,
          { promotion_ids: [id] },
          adminHeaders,
        );
        expect(res.data.skipped.find((s: any) => s.promotion_id === id)?.reason).toEqual('not_started');
      });
    });

    describe('T2: 회수 후 재발급이 옛 사용기록을 지운다', () => {
      it('used_at·order_id 가 null 로 덮인다 (upsert 라 같은 행이 되살아나므로)', async () => {
        const id = await createPromo(`REISSUE${seq}`, { visibility: 'assigned_only', validity_days: 7 });
        const link = getContainer().resolve(ContainerRegistrationKeys.LINK) as any;

        await api.post(`/admin/customers/${customerId}/promotions`, { promotion_ids: [id] }, adminHeaders);
        // 사용된 것처럼 만든다
        await link.create([{
          [Modules.CUSTOMER]: { customer_id: customerId },
          [Modules.PROMOTION]: { promotion_id: id },
          data: { used_at: new Date(), order_id: 'order_stale' },
        }]);
        // 회수
        await api.delete(`/admin/customers/${customerId}/promotions`, {
          ...adminHeaders,
          data: { promotion_ids: [id] },
        });
        // 재발급
        await api.post(`/admin/customers/${customerId}/promotions`, { promotion_ids: [id] }, adminHeaders);

        const [row] = await listLinks(id);
        expect(row.used_at).toBeNull();
        expect(row.order_id).toBeNull();
        expect(row.expires_at).not.toBeNull();
      });
    });
```

- [ ] **Step 2: 실패를 확인한다**

```bash
cd apps/medusa && TEST_TYPE=integration:http NODE_OPTIONS=--experimental-vm-modules npx jest coupon-validity --silent=false --runInBand --forceExit
```
Expected: FAIL — `expires_at` 이 NULL, `issued_via` 가 NULL, 창 검사가 캠페인만 봐서 skip 이 안 됨

- [ ] **Step 3: 링크 조회 헬퍼를 만든다**

`apps/medusa/src/api/admin/promotions/helpers.ts` 끝에 추가:

```ts
/** 발급된 «한 장». 링크 행의 우리 컬럼들이다. */
export type IssuedLinkRow = {
  customer_id: string;
  promotion_id: string;
  expires_at: string | Date | null;
  used_at: string | Date | null;
  order_id: string | null;
  issued_via: string | null;
};

const ISSUED_LINK_FIELDS = [
  'customer_id',
  'promotion_id',
  'expires_at',
  'used_at',
  'order_id',
  'issued_via',
];

function customerPromotionLinkModule(scope: any) {
  return (scope.resolve(ContainerRegistrationKeys.LINK) as any).getLinkModule(
    Modules.CUSTOMER,
    'customer_id',
    Modules.PROMOTION,
    'promotion_id',
  );
}

/**
 * 이 고객이 이 쿠폰을 발급받았는가 — 받았다면 그 «한 장»의 상태를 돌려준다.
 *
 * 스칼라 필터 한 쌍으로 조회한다. (배열 필터는 이 링크 모듈에서 신뢰하지 않는 것이 저장소
 * 관례라 `listIssuedLinks` 도 고객 하나로만 좁힌다. 스칼라 조회가 도는 것은
 * `integration-tests/http/coupon-validity.spec.ts` 의 T3 마지막 케이스가 확인한다.)
 */
export async function findIssuedLink(
  scope: any,
  customerId: string,
  promotionId: string,
): Promise<IssuedLinkRow | null> {
  const rows = (await customerPromotionLinkModule(scope).list(
    { customer_id: customerId, promotion_id: promotionId },
    { select: ISSUED_LINK_FIELDS },
  )) as IssuedLinkRow[];
  return rows?.[0] ?? null;
}

/** 이 고객이 가진 모든 «한 장». 목록 화면이 프로모션마다 조회하지 않도록 한 번에 가져온다. */
export async function listIssuedLinks(scope: any, customerId: string): Promise<IssuedLinkRow[]> {
  return (await customerPromotionLinkModule(scope).list(
    { customer_id: customerId },
    { select: ISSUED_LINK_FIELDS },
  )) as IssuedLinkRow[];
}
```

`helpers.ts` 상단 import 에 `Modules` 를 추가한다:
```ts
import { ContainerRegistrationKeys, MedusaError, Modules, remoteQueryObjectFromString } from '@medusajs/framework/utils';
```

- [ ] **Step 4: 관리자 수동 발급 경로를 고친다**

`apps/medusa/src/api/admin/customers/[id]/promotions/route.ts`:

import 에 추가:
```ts
import { computeExpiresAt, issuanceWindowState } from '../../../../../modules/promotion-meta/validity';
```

`POST` 안 — `const remoteLink = req.scope.resolve(ContainerRegistrationKeys.REMOTE_LINK);` 를 바꾼다:
```ts
  const link = req.scope.resolve(ContainerRegistrationKeys.LINK);
```

`query.graph` 의 프로모션 필드에서 캠페인 두 줄을 **뺀다**:
```ts
    fields: [
      'id', 'code', 'status', 'is_automatic',
      'rules.attribute', 'rules.operator', 'rules.values.value',
    ],
```

`for` 루프 안 — 캠페인 창 검사 블록을 통째로 교체한다. `const meta = ...` 를 창 검사 **앞**으로 끌어올린다:
```ts
    const meta = metaRecords.find((m: any) => m.promotion_id === promo.id);
    const metaShape = toMetadataShape(meta);

    // 검증 실패는 throw 대신 skip — 배치의 다른 쿠폰까지 막지 않는다. force로 우회 가능.
    if (!force) {
      if (promo.status !== 'active') {
        skipped.push({ promotion_id: promo.id, reason: 'inactive' });
        continue;
      }
      if (promo.is_automatic) {
        skipped.push({ promotion_id: promo.id, reason: 'automatic' });
        continue;
      }
      // 발급 창은 캠페인이 아니라 promotion_meta 가 정한다 (#488 결정 1).
      const window = issuanceWindowState(meta, now);
      if (window === 'not_started') {
        skipped.push({ promotion_id: promo.id, reason: 'not_started' });
        continue;
      }
      if (window === 'ended') {
        skipped.push({ promotion_id: promo.id, reason: 'expired' });
        continue;
      }
      if (!meetsGroupRule(promo, customerGroupIds)) {
        skipped.push({ promotion_id: promo.id, reason: 'group_mismatch' });
        continue;
      }
    }

    const maxClaims = metaShape?.max_claims != null ? Number(metaShape.max_claims) : null;
```

(원래 `const meta`/`const metaShape`/`const maxClaims` 세 줄은 위로 옮겼으므로 아래에서 **삭제**한다.)

링크 생성을 바꾼다:
```ts
    try {
      await (link as any).create([{
        [Modules.CUSTOMER]: { customer_id: customerId },
        [Modules.PROMOTION]: { promotion_id: promo.id },
        data: {
          expires_at: computeExpiresAt(meta, now),
          issued_via: issueTrigger,
          // 🔴 Link.create 는 upsert 라 회수된 행이 되살아난다. 옛 사용기록을 반드시 지운다.
          used_at: null,
          order_id: null,
        },
      }]);
```

`DELETE` 안의 `remoteLink` 도 `link` 로 바꾼다:
```ts
  const link = req.scope.resolve(ContainerRegistrationKeys.LINK);
  ...
    await link.dismiss(
```

- [ ] **Step 5: 자동 발급 경로를 고친다**

`apps/medusa/src/api/admin/customers/[id]/issue-coupons/route.ts`:

import 에 추가:
```ts
import { computeExpiresAt, isWithinIssuanceWindow } from '../../../../../modules/promotion-meta/validity';
```

`const remoteLink = ...REMOTE_LINK` → `const link = req.scope.resolve(ContainerRegistrationKeys.LINK);`

프로모션 `query.graph` 에서 캠페인 두 줄을 뺀다:
```ts
    fields: [
      'id', 'code', 'status', 'is_automatic',
      'rules.attribute', 'rules.operator', 'rules.values.value',
    ],
```

`validPromotions` 필터를 교체한다:
```ts
  const now = new Date();
  const metaById = new Map<string, any>(metaRecords.map((m: any) => [m.promotion_id, m]));
  const validPromotions = (promotions as any[]).filter((p) => {
    if (!meetsGroupRule(p, customerGroupIds)) return false;
    // 발급 창은 캠페인이 아니라 promotion_meta 가 정한다 (#488 결정 1).
    return isWithinIssuanceWindow(metaById.get(p.id), now);
  });
```

루프 안 `const meta = metaRecords.find(...)` 를 `const meta = metaById.get(promo.id);` 로 바꾸고, 링크 생성을 바꾼다:
```ts
      await (link as any).create([{
        [Modules.CUSTOMER]: { customer_id: customerId },
        [Modules.PROMOTION]: { promotion_id: promo.id },
        data: {
          expires_at: computeExpiresAt(meta, now),
          issued_via: trigger,
          used_at: null,
          order_id: null,
        },
      }]);
```

- [ ] **Step 6: 셀프 클레임 경로를 고친다**

`apps/medusa/src/api/store/customers/me/promotions/[id]/claim/route.ts`:

import 에 추가:
```ts
import { computeExpiresAt, issuanceWindowState } from '../../../../../../../modules/promotion-meta/validity';
```

`const remoteLink = ...REMOTE_LINK` 줄을 **삭제**한다(아래 `linkModule` 이 쓰는 `LINK` resolve 를 하나로 합친다). `linkModule` 선언 부분을 다음으로 바꾼다:
```ts
  const link = req.scope.resolve(ContainerRegistrationKeys.LINK) as any;
  const linkModule = link.getLinkModule(
    Modules.CUSTOMER, 'customer_id', Modules.PROMOTION, 'promotion_id',
  );
```
(이 선언을 `const meta = await promotionMetaService.getByPromotionId(promotionId);` **아래**로 옮겨야 아래 창 검사가 `meta` 를 쓸 수 있다. 원래 위치의 `linkModule` 선언은 삭제한다.)

프로모션 `query.graph` 에서 캠페인 두 줄을 뺀다:
```ts
    fields: ['id', 'code', 'status', 'is_automatic',
      'rules.attribute', 'rules.operator', 'rules.values.value'],
```

캠페인 창 검사 블록을 교체한다:
```ts
  const now = new Date();
  // 발급 창은 캠페인이 아니라 promotion_meta 가 정한다 (#488 결정 1).
  const window = issuanceWindowState(meta, now);
  if (window === 'not_started') {
    throw new MedusaError(MedusaError.Types.NOT_ALLOWED, '아직 발급받을 수 없는 쿠폰입니다.');
  }
  if (window === 'ended') {
    throw new MedusaError(MedusaError.Types.NOT_ALLOWED, '발급 기간이 끝난 쿠폰입니다.');
  }
```

링크 생성을 바꾼다:
```ts
  try {
    await link.create([{
      [Modules.CUSTOMER]: { customer_id: customerId },
      [Modules.PROMOTION]: { promotion_id: promotionId },
      data: {
        expires_at: computeExpiresAt(meta, now),
        issued_via: 'customer_claim',
        used_at: null,
        order_id: null,
      },
    }]);
```

- [ ] **Step 7: `promotions/[id]/customers` 의 `REMOTE_LINK` 를 없앤다**

`apps/medusa/src/api/admin/promotions/[id]/customers/route.ts` 의 `DELETE` 안:
```ts
  const link = req.scope.resolve(ContainerRegistrationKeys.LINK);
```
(`:101` 의 `const remoteLink = ...` 줄을 삭제하고, `remoteLink.dismiss` 를 `link.dismiss` 로 바꾼다.)

- [ ] **Step 8: 기존 통합 스펙의 캠페인 기반 케이스를 전환한다**

`apps/medusa/integration-tests/http/coupon-admin.spec.ts:174-192` 의 두 프로모션 생성을 바꾼다:

```ts
      const futureId = await createPromo('FUTURE', {
        visibility: 'assigned_only',
        starts_at: '2999-01-01T00:00:00.000Z',
      });
      const pastId = await createPromo('PAST', {
        visibility: 'assigned_only',
        ends_at: '2000-01-01T00:00:00.000Z',
      });
```
(세 번째 인자 `{ campaign: ... }` 는 통째로 없앤다.)

- [ ] **Step 9: 통과를 확인한다**

```bash
cd apps/medusa && npm run test:integration:http
cd apps/medusa && TEST_TYPE=unit NODE_OPTIONS=--experimental-vm-modules npx jest --silent --runInBand --forceExit
```
Expected: 둘 다 PASS. Task 4 Step 4 의 실측대로 `23505` 가 안 나면, 이 단계에서 세 경로의 duplicate catch 분기가 **도달 불가**임이 확인된다 — 지우지 말고 다음 스텝에서 정리한다.

- [ ] **Step 10: 도달 불가 분기를 정리한다**

Task 4 의 T3 첫 케이스가 「예외가 나지 않는다」로 통과했다면, 세 경로의 `isDuplicate` 분기는 죽은 코드다. 각 `catch` 에서 duplicate 판정을 지우고 주석을 남긴다. 예 — `claim/route.ts`:

```ts
  } catch (e: any) {
    // Link.create 는 복합 PK upsert 라 중복이 예외가 되지 않는다
    // (integration-tests/http/coupon-validity.spec.ts T3 로 실측). 여기 오는 것은 진짜 장애다.
    if (maxClaims !== null) await promotionMetaService.releaseClaimSlot(promotionId).catch(() => {});
    throw e;
  }
```

`issue-coupons/route.ts` 와 `customers/[id]/promotions/route.ts` 도 같은 방식으로 정리한다.

> **T3 가 예상과 달리 `23505` 를 냈다면 이 스텝을 건너뛰고**, 스펙 §2 ⓑ 3번을 「도달한다」로 정정한 뒤 커밋 메시지에 적는다.

- [ ] **Step 11: 통과를 다시 확인하고 커밋**

```bash
cd apps/medusa && npm run test:integration:http
git add apps/medusa/src/api apps/medusa/integration-tests
git commit -m "feat(coupon): 발급이 인스턴스 만료를 링크 행에 박는다

발급 3경로(자동·관리자 수동·셀프 클레임)가 캠페인 창 대신 promotion_meta 창을 보고,
링크 행에 expires_at·issued_via 를 계산해 박는다. used_at·order_id 를 null 로 명시하는
것은 Link.create 가 upsert 라 회수된 행이 되살아나기 때문이다(T2 가 지킨다).

ContainerRegistrationKeys.LINK 로 통일한다 — REMOTE_LINK 는 aliasTo(LINK) 로 등록된
같은 객체이고 deprecated 다."
```

---

## Task 7: 사용 기록 — `orderCreated` 훅

**Files:**
- Create: `apps/medusa/src/workflows/hooks/cart/coupon-usage.ts`
- Create: `apps/medusa/src/workflows/hooks/cart/record-coupon-usage.ts`
- Create: `apps/medusa/src/workflows/hooks/cart/__tests__/coupon-usage.unit.spec.ts`
- Test: `apps/medusa/integration-tests/http/coupon-validity.spec.ts` (T6)

**Interfaces:**
- Consumes: Task 4 의 링크 컬럼
- Produces: `buildUsageLinks(customerId: string | null | undefined, promotionIds: string[], orderId: string, usedAt: Date): LinkDefinitionLike[]`

- [ ] **Step 1: 실패하는 유닛 테스트를 쓴다**

`apps/medusa/src/workflows/hooks/cart/__tests__/coupon-usage.unit.spec.ts`:

```ts
import { Modules } from '@medusajs/framework/utils';
import { buildUsageLinks } from '../coupon-usage';

const USED_AT = new Date('2026-08-31T12:00:00.000Z');

describe('buildUsageLinks', () => {
  it('고객이 쓴 쿠폰마다 링크 갱신 페이로드를 만든다', () => {
    expect(buildUsageLinks('cus_1', ['promo_a', 'promo_b'], 'order_1', USED_AT)).toEqual([
      {
        [Modules.CUSTOMER]: { customer_id: 'cus_1' },
        [Modules.PROMOTION]: { promotion_id: 'promo_a' },
        data: { used_at: USED_AT, order_id: 'order_1' },
      },
      {
        [Modules.CUSTOMER]: { customer_id: 'cus_1' },
        [Modules.PROMOTION]: { promotion_id: 'promo_b' },
        data: { used_at: USED_AT, order_id: 'order_1' },
      },
    ]);
  });

  it('비회원 주문은 기록할 대상이 없다 — 링크는 고객에게만 붙는다', () => {
    expect(buildUsageLinks(null, ['promo_a'], 'order_1', USED_AT)).toEqual([]);
  });

  it('쿠폰 없는 주문은 빈 배열', () => {
    expect(buildUsageLinks('cus_1', [], 'order_1', USED_AT)).toEqual([]);
  });

  it('expires_at 은 건드리지 않는다 — 사용했다고 만료가 바뀌지 않는다', () => {
    const [payload] = buildUsageLinks('cus_1', ['promo_a'], 'order_1', USED_AT);
    expect(Object.keys((payload as any).data).sort()).toEqual(['order_id', 'used_at']);
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

```bash
cd apps/medusa && TEST_TYPE=unit NODE_OPTIONS=--experimental-vm-modules npx jest coupon-usage --silent=false --runInBand --forceExit
```
Expected: FAIL — `Cannot find module '../coupon-usage'`

- [ ] **Step 3: 순수 로직을 쓴다**

`apps/medusa/src/workflows/hooks/cart/coupon-usage.ts`:

```ts
import { Modules } from '@medusajs/framework/utils';

/**
 * 「이 주문에 어떤 쿠폰이 쓰였나」를 링크 행에 남기는 **순수 조립 로직** (#488 N4 → A2).
 *
 * 훅 등록(`record-coupon-usage.ts`)은 전역 부수효과라 유닛 테스트가 닿지 않는다. 그래서
 * 판정을 여기로 뽑고 등록부는 얇게 둔다(`apply-promotion-meta.ts` 와 같은 모양).
 *
 * ⚠️ `expires_at` 은 `data` 에 넣지 않는다 — `Link.create` 는 upsert 라 넣으면 덮인다.
 *    사용했다고 만료가 바뀌어서는 안 된다.
 */
export type UsageLinkPayload = {
  [key: string]: unknown;
  data: { used_at: Date; order_id: string };
};

export function buildUsageLinks(
  customerId: string | null | undefined,
  promotionIds: string[],
  orderId: string,
  usedAt: Date,
): UsageLinkPayload[] {
  // 링크는 고객에게만 붙는다. 비회원 주문은 기록할 «한 장»이 없다.
  if (!customerId) return [];
  return (promotionIds ?? []).map((promotionId) => ({
    [Modules.CUSTOMER]: { customer_id: customerId },
    [Modules.PROMOTION]: { promotion_id: promotionId },
    data: { used_at: usedAt, order_id: orderId },
  }));
}
```

- [ ] **Step 4: 통과를 확인한다**

```bash
cd apps/medusa && TEST_TYPE=unit NODE_OPTIONS=--experimental-vm-modules npx jest coupon-usage --silent=false --runInBand --forceExit
```
Expected: PASS (4 tests)

- [ ] **Step 5: 훅 등록부를 쓴다**

`apps/medusa/src/workflows/hooks/cart/record-coupon-usage.ts`:

```ts
import { ContainerRegistrationKeys } from '@medusajs/framework/utils';
import { completeCartWorkflow } from '@medusajs/medusa/core-flows';
import { buildUsageLinks } from './coupon-usage';

/**
 * 주문이 생기면 「이 주문에 쓰인 쿠폰」을 링크 행에 남긴다 (#488 N4 → A2 의 선행).
 *
 * `completeCartWorkflow.hooks.orderCreated` 는 이 저장소에서 아직 아무도 쓰지 않던 자리다
 * (`validate` 는 `complete-cart.ts` 가 이미 쓴다 — 워크플로당 핸들러는 하나뿐이므로 새 훅을
 * 등록할 때는 반드시 빈 자리인지 확인할 것).
 *
 * 실패해도 주문을 되돌리지 않는다 — 기록은 부가정보이고, 그것 때문에 결제된 주문을 롤백하면
 * 손해가 훨씬 크다. (`apply-promotion-meta` 의 발급 로그 정리와 같은 판단이다.)
 */
completeCartWorkflow.hooks.orderCreated(async ({ order }, { container }) => {
  try {
    const query = container.resolve(ContainerRegistrationKeys.QUERY);
    const link = container.resolve(ContainerRegistrationKeys.LINK) as any;

    const { data: orders } = await query.graph({
      entity: 'order',
      fields: ['id', 'customer_id', 'promotions.id'],
      filters: { id: (order as any).id },
    });
    const found = orders?.[0] as any;
    const promotionIds: string[] = (found?.promotions ?? []).map((p: any) => p.id);

    const payloads = buildUsageLinks(found?.customer_id, promotionIds, found.id, new Date());
    if (payloads.length) await link.create(payloads);
  } catch (e) {
    const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
    logger.error(`[coupon] 사용 기록 실패 (주문은 유지): ${(e as Error)?.message}`);
  }
});
```

- [ ] **Step 6: 통합 테스트를 쓴다 (T6)**

`apps/medusa/integration-tests/http/coupon-validity.spec.ts` 에 T6 describe 를 추가한다. 주문 완료에는 지역·판매채널·상품·배송이 필요하므로 **`coupon-cart.spec.ts` 의 `beforeAll` 픽스처를 그 파일 안에서** 재사용하는 편이 싸다. `apps/medusa/integration-tests/http/coupon-cart.spec.ts` 마지막 `it` 뒤에 추가:

```ts
    it('주문이 생기면 링크 행에 used_at·order_id 가 남는다 (#488 A2 선행)', async () => {
      const promoId = await createPromo('USAGE1', { visibility: 'assigned_only' });
      await assignToCustomer(promoId);

      const cartId = await createCartWithPromo('USAGE1');
      const orderId = await completeCart(cartId);

      const linkModule = (getContainer().resolve(ContainerRegistrationKeys.LINK) as any).getLinkModule(
        Modules.CUSTOMER, 'customer_id', Modules.PROMOTION, 'promotion_id',
      );
      const rows = (await linkModule.list(
        { promotion_id: promoId },
        { select: ['customer_id', 'used_at', 'order_id'] },
      )) as any[];

      expect(rows).toHaveLength(1);
      expect(rows[0].order_id).toEqual(orderId);
      expect(rows[0].used_at).not.toBeNull();
    });
```

> `createPromo` · `assignToCustomer` · `createCartWithPromo` · `completeCart` 헬퍼가
> `coupon-cart.spec.ts` 에 이미 있는지 먼저 확인한다. 없는 것은 그 파일의 기존 게이트 테스트
> (`:225-247`)가 쓰는 카트 생성 코드를 헬퍼로 뽑아 만든다. **완료까지 가려면 배송옵션 픽스처가
> 필요하고 저장소에 없다** — 없으면 이 통합 케이스는 **건너뛰고 §「이번에 검증되지 않는 것」에
> 적는다.** 유닛 4건은 그대로 유지한다.

- [ ] **Step 7: 통과를 확인하고 커밋**

```bash
cd apps/medusa && TEST_TYPE=unit NODE_OPTIONS=--experimental-vm-modules npx jest --silent --runInBand --forceExit
cd apps/medusa && npm run test:integration:http
git add apps/medusa/src/workflows/hooks/cart/ apps/medusa/integration-tests/
git commit -m "feat(coupon): 주문이 생기면 쓰인 쿠폰을 링크 행에 기록한다

completeCartWorkflow.hooks.orderCreated 는 비어 있던 자리다. 「이 주문에 쓰인 쿠폰」이
한 줄이 되어 A2(취소·환불 시 복구)가 후속에서 orderCanceled 훅 하나로 끝난다.
expires_at 은 data 에 넣지 않는다 — upsert 라 넣으면 덮이고, 사용했다고 만료가 바뀌면 안 된다.
기록 실패가 결제된 주문을 롤백하지 않도록 삼킨다."
```

---

## Task 8: 🔴 강제 — 카트 3경로 + 주문 완료 백스톱

**이 작업에서 가장 조용히 틀릴 수 있는 자리다.** 캠페인 날짜를 안 쓰기 시작하면 엔진의
`listActivePromotions_` 가 해주던 `public` 쿠폰 만료 차단이 사라진다.

**Files:**
- Modify: `apps/medusa/src/api/store/carts/middlewares/per-customer-limit.ts`
- Modify: `apps/medusa/src/workflows/hooks/cart/complete-cart.ts`
- Test: `apps/medusa/integration-tests/http/coupon-validity.spec.ts` (T4 · T5)

**Interfaces:**
- Consumes: Task 1 `isUsable`, Task 6 `findIssuedLink`
- Produces: 카트 3경로가 만료 쿠폰에 `400 { message: 'COUPON_EXPIRED', code: 'COUPON_EXPIRED' }`

- [ ] **Step 1: 실패하는 테스트를 쓴다 (T4 · T5)**

`apps/medusa/integration-tests/http/coupon-validity.spec.ts` 에 추가. 카트 생성은
`coupon-cart.spec.ts:225-247` 의 게이트 테스트와 같은 모양이다 — 이 파일에서는 **카트 생성 시
`promo_codes` 를 붙이는 최소 경로**만 쓴다(지역·판매채널 픽스처가 필요하므로 `beforeEach` 에
`createRegionsWorkflow`/`createSalesChannelsWorkflow`/`createApiKeysWorkflow` 를 추가한다.
`coupon-cart.spec.ts:36-90` 의 코드를 그대로 옮긴다):

```ts
    describe('T4·T5: 만료 강제', () => {
      it('T5 🔴 public 쿠폰도 meta.ends_at 만료면 카트에 못 붙는다', async () => {
        await createPromo(`PUBEXP${seq}`, {
          visibility: 'public',
          ends_at: '2000-01-01T00:00:00.000Z',
        });
        await expect(
          api.post('/store/carts', { region_id: regionId, promo_codes: [`PUBEXP${seq}`] }, storeHeaders),
        ).rejects.toMatchObject({ response: { status: 400, data: { code: 'COUPON_EXPIRED' } } });
      });

      it('T5 대조군: 만료되지 않은 public 쿠폰은 붙는다', async () => {
        await createPromo(`PUBOK${seq}`, {
          visibility: 'public',
          ends_at: '2999-01-01T00:00:00.000Z',
        });
        const res = await api.post(
          '/store/carts',
          { region_id: regionId, promo_codes: [`PUBOK${seq}`] },
          storeHeaders,
        );
        expect(res.status).toEqual(200);
      });

      it('T4 발급된 쿠폰은 «링크 행»의 만료가 기준이다 — 정책 창이 지나도 산다', async () => {
        const id = await createPromo(`ISSUEDLIVE${seq}`, {
          visibility: 'assigned_only',
          ends_at: '2000-01-01T00:00:00.000Z',
        });
        const link = getContainer().resolve(ContainerRegistrationKeys.LINK) as any;
        await link.create([{
          [Modules.CUSTOMER]: { customer_id: customerId },
          [Modules.PROMOTION]: { promotion_id: id },
          data: {
            expires_at: new Date('2999-01-01T00:00:00.000Z'),
            issued_via: 'admin_manual', used_at: null, order_id: null,
          },
        }]);

        const res = await api.post(
          '/store/carts',
          { region_id: regionId, promo_codes: [`ISSUEDLIVE${seq}`] },
          storeHeaders,
        );
        expect(res.status).toEqual(200);
      });

      it('T4 발급된 쿠폰의 링크 만료가 지났으면 못 붙는다 — 정책 창이 열려 있어도', async () => {
        const id = await createPromo(`ISSUEDDEAD${seq}`, {
          visibility: 'assigned_only',
          ends_at: '2999-01-01T00:00:00.000Z',
        });
        const link = getContainer().resolve(ContainerRegistrationKeys.LINK) as any;
        await link.create([{
          [Modules.CUSTOMER]: { customer_id: customerId },
          [Modules.PROMOTION]: { promotion_id: id },
          data: {
            expires_at: new Date('2000-01-01T00:00:00.000Z'),
            issued_via: 'admin_manual', used_at: null, order_id: null,
          },
        }]);

        await expect(
          api.post('/store/carts', { region_id: regionId, promo_codes: [`ISSUEDDEAD${seq}`] }, storeHeaders),
        ).rejects.toMatchObject({ response: { status: 400, data: { code: 'COUPON_EXPIRED' } } });
      });

      it('T4 /store/carts/:id/promotions 경로도 막는다', async () => {
        await createPromo(`PROMOPATH${seq}`, {
          visibility: 'public',
          ends_at: '2000-01-01T00:00:00.000Z',
        });
        const cart = await api.post('/store/carts', { region_id: regionId }, storeHeaders);
        await expect(
          api.post(
            `/store/carts/${cart.data.cart.id}/promotions`,
            { promo_codes: [`PROMOPATH${seq}`] },
            storeHeaders,
          ),
        ).rejects.toMatchObject({ response: { status: 400, data: { code: 'COUPON_EXPIRED' } } });
      });
    });
```

- [ ] **Step 2: 실패를 확인한다**

```bash
cd apps/medusa && TEST_TYPE=integration:http NODE_OPTIONS=--experimental-vm-modules npx jest coupon-validity --silent=false --runInBand --forceExit
```
Expected: FAIL — 만료 쿠폰이 200 으로 붙는다

- [ ] **Step 3: 미들웨어를 고친다**

`apps/medusa/src/api/store/carts/middlewares/per-customer-limit.ts` 의 `for` 루프 안, `const meta = ...` 아래에 만료 검사를 넣는다. **`requiresIssuance` 블록 밖**이어야 한다:

```ts
    const meta = await promotionMetaService.getByPromotionId(promotion.id);

    // 🔴 만료는 visibility 와 무관하다 — public 쿠폰도 대상이다.
    //
    // 캠페인 날짜를 안 쓰기 시작하면서 엔진의 `listActivePromotions_` 가 해주던 만료 차단이
    // 사라졌다(#488 결정 1). 그 방어선을 여기서 넘겨받는다. `requiresIssuance` 안에 두면
    // public 쿠폰이 영원히 안 죽는다.
    //
    // 발급된 «한 장»이면 그 행의 expires_at 이, 아니면 정책의 ends_at 이 기준이다.
    const issuedLink = customerId
      ? await findIssuedLink(req.scope, customerId, promotion.id)
      : null;
    if (!isUsable(issuedLink, meta, new Date())) {
      // message는 머신 토큰 — 스토어프론트가 로케일별 문구로 매핑한다.
      return res.status(400).json({ message: 'COUPON_EXPIRED', code: 'COUPON_EXPIRED' });
    }

    // 메타가 없으면 «발급 필요» 다(닫힌 기본값 — #488 N7). 옛 코드는 undefined 라 게이트를 통과했다.
    if (requiresIssuance(meta)) {
```

import 를 고친다:
```ts
import { requiresIssuance, findIssuedLink } from '../../../admin/promotions/helpers';
import { isUsable } from '../../../../modules/promotion-meta/validity';
```

- [ ] **Step 4: 주문 완료 백스톱을 고친다**

`apps/medusa/src/workflows/hooks/cart/complete-cart.ts` 의 `for (const promo of cartPromos)` 루프 안, `const meta = ...` 아래에 넣는다:

```ts
      const meta = await promotionMetaService.getByPromotionId(promo.id);

      // 만료 백스톱 — 카트에 붙은 뒤 주문 완료 사이에 만료된 쿠폰을 막는다.
      // 캡(P10-B)과 달리 만료는 금액 조정이 아니라 «거부» 라 여기서 던져도 결제금액이 어긋나지 않는다.
      const issuedLink = cart.customer_id
        ? await findIssuedLink(container, cart.customer_id, promo.id)
        : null;
      if (!isUsable(issuedLink, meta, new Date())) {
        throw new MedusaError(MedusaError.Types.INVALID_DATA, '유효기간이 지난 쿠폰입니다.');
      }

      // 메타가 없으면 «발급 필요» 다(닫힌 기본값 — #488 N7).
      if (requiresIssuance(meta)) {
```

import 를 고친다:
```ts
import { requiresIssuance, findIssuedLink } from '../../../api/admin/promotions/helpers';
import { isUsable } from '../../../modules/promotion-meta/validity';
```

> `findIssuedLink` 의 첫 인자는 `scope` 인데 여기서는 `container` 를 넘긴다 — 둘 다 `resolve`
> 를 갖는 awilix 컨테이너라 같은 인터페이스다(`enforce-promotion-cap.ts` 가 이미 같은 방식이다).

- [ ] **Step 5: 통과를 확인한다**

```bash
cd apps/medusa && npm run test:integration:http
```
Expected: PASS — 기존 케이스 전부 + T4/T5 5건

- [ ] **Step 6: 커밋**

```bash
git add apps/medusa/src/api/store/carts/middlewares/per-customer-limit.ts \
        apps/medusa/src/workflows/hooks/cart/complete-cart.ts \
        apps/medusa/integration-tests/http/coupon-validity.spec.ts
git commit -m "fix(coupon): 만료 강제를 우리가 넘겨받는다 — public 쿠폰 포함

캠페인 날짜를 안 쓰기 시작하면 엔진의 listActivePromotions_ 가 해주던 만료 차단이
사라진다. 그 자리를 카트 3경로 미들웨어와 complete-cart 백스톱이 대신한다.
만료 검사는 requiresIssuance 블록 «밖»이다 — 안에 두면 public 쿠폰이 영원히 안 죽는다.

발급된 한 장은 링크 행의 expires_at 이 기준이라 정책 창이 지나도 살고,
반대로 링크 만료가 지나면 정책 창이 열려 있어도 죽는다. T5 가 그 방어선이다."
```

---

## Task 9: 스토어 읽기 — preview · events · me/promotions

**Files:**
- Modify: `apps/medusa/src/api/store/coupons/preview/route.ts`
- Modify: `apps/medusa/src/api/store/events/[slug]/route.ts`
- Modify: `apps/medusa/src/api/store/customers/me/promotions/route.ts`
- Modify: `apps/medusa/src/api/store/customers/me/promotions/format-promotion.ts`
- Modify: `apps/medusa/src/api/store/customers/me/promotions/__tests__/format-promotion.unit.spec.ts`
- Modify: `apps/medusa/integration-tests/http/coupon-store.spec.ts:174-186`

**Interfaces:**
- Consumes: Task 1 `isUsable`/`issuanceWindowState`, Task 6 `listIssuedLinks`
- Produces: `FormattedPromotion` 에 `expires_at: string | Date | null`. `PromotionMetaView` 에 `expiresAt: string | Date | null`.

- [ ] **Step 1: 실패하는 유닛 테스트를 쓴다**

`apps/medusa/src/api/store/customers/me/promotions/__tests__/format-promotion.unit.spec.ts` 에 추가:

```ts
  it('expires_at 을 최상위로 내린다 — 발급된 장이면 링크 행 값이다', () => {
    const out = formatPromotion(basePromo(), true, {
      visibility: 'assigned_only',
      maxDiscountAmount: null,
      expiresAt: '2026-12-31T00:00:00.000Z',
    });
    expect(out.expires_at).toEqual('2026-12-31T00:00:00.000Z');
  });

  it('무기한이면 null 이다', () => {
    const out = formatPromotion(basePromo(), false, {
      visibility: 'public',
      maxDiscountAmount: null,
      expiresAt: null,
    });
    expect(out.expires_at).toBeNull();
  });
```

> `basePromo()` 가 그 스펙에 없으면, 파일 안 기존 테스트가 쓰는 프로모션 리터럴을 그대로 인라인한다.

- [ ] **Step 2: 실패를 확인한다**

```bash
cd apps/medusa && TEST_TYPE=unit NODE_OPTIONS=--experimental-vm-modules npx jest format-promotion --silent=false --runInBand --forceExit
```
Expected: FAIL — `expiresAt` 가 타입에 없고 `expires_at` 가 출력에 없다

- [ ] **Step 3: `format-promotion.ts` 를 고친다**

`PromotionMetaView` 에 추가:
```ts
export type PromotionMetaView = {
  visibility: string;
  maxDiscountAmount: number | null;
  /**
   * 이 고객에게 이 쿠폰이 언제까지인가. **발급된 장이면 링크 행의 값**, 아니면 정책의 `ends_at`.
   * 호출부가 링크를 한 번에 조회해 넣는다 — 프로모션마다 조회하지 않는다.
   */
  expiresAt: string | Date | null;
};
```

`FormattedPromotion` 에 추가:
```ts
  /**
   * 이 쿠폰이 언제까지 쓸 수 있는가 (#488 결정 1). `campaign.ends_at` 을 대체한다 —
   * 캠페인 날짜는 더 이상 쓰지 않는다. `null` 이면 무기한.
   */
  expires_at: string | Date | null;
```

`formatPromotion` 반환에 `visibility` 아래 추가:
```ts
    expires_at: meta.expiresAt,
```

> ⚠️ `expiresAt` 을 **필수**로 두면 그 스펙의 기존 `formatPromotion(...)` 호출이 전부 타입 에러가
> 난다. 그것이 의도다 — optional 로 두면 호출부가 값을 안 넘겨도 조용히 `undefined` 가 되어
> 「무기한」으로 표시된다(#488 P1 이 겪은 「조건이 조용히 사라진다」의 재현). **기존 호출 전부에
> `expiresAt` 을 명시**하고, 그 과정에서 `cd apps/medusa && npx tsc --noEmit` 이 빠뜨린 곳을
> 알려주게 한다.

- [ ] **Step 4: `me/promotions` 라우트를 고친다**

import 에 추가:
```ts
import { listIssuedLinks } from '../../../../admin/promotions/helpers';
import { isUsable, issuanceWindowState } from '../../../../../modules/promotion-meta/validity';
```

`promotionFields` 에서 캠페인 날짜 두 줄(`'campaign.starts_at'`, `'campaign.ends_at'`)을 **뺀다**(`campaign.campaign_identifier` 와 budget 필드는 남긴다 — 예산 표시가 아직 쓴다).

`metas` 조회 아래에 링크 맵을 만든다:
```ts
  const metaById = new Map<string, any>(metas.map((m: any) => [m.promotion_id, m]));
  // 발급된 «한 장»들을 한 번에 가져온다 — 프로모션마다 조회하지 않는다.
  const issuedLinks = await listIssuedLinks(req.scope, customerId);
  const linkByPromotionId = new Map(issuedLinks.map((l) => [l.promotion_id, l]));
  const expiresAtOf = (promotionId: string): string | Date | null => {
    const link = linkByPromotionId.get(promotionId);
    return link ? link.expires_at : (metaById.get(promotionId)?.ends_at ?? null);
  };
```

`format` 을 고친다:
```ts
  const format = (promo: any, isAssigned: boolean) =>
    formatPromotion(promo, isAssigned, {
      visibility: visibilityOf(promo.id),
      maxDiscountAmount: maxDiscountById.get(promo.id) ?? null,
      expiresAt: expiresAtOf(promo.id),
    });
```

`isValidPromotion` 의 캠페인 블록을 교체한다.

> 🔴 **선언 위치를 옮겨야 한다.** 현재 `isValidPromotion` 은 `const now = new Date();` 바로 뒤
> (`:97` 부근)에 있는데, 이제 `metaById`·`linkByPromotionId` 에 의존하므로 **그 두 맵을 만드는
> 코드 뒤로 내려야 한다.** 안 옮기면 `ReferenceError: Cannot access before initialization` 이
> 아니라 — `const` TDZ 라 런타임에 죽는다. 원래 자리의 함수는 삭제하고 아래로 옮긴다.

```ts
  const isValidPromotion = (promo: any): boolean => {
    if (promo.status !== 'active') return false;
    if (promo.is_automatic) return false;
    // 사용 가능 여부는 «링크 행이 있으면 링크 행» 이 정한다 (#488 결정 1).
    return isUsable(linkByPromotionId.get(promo.id) ?? null, metaById.get(promo.id), now);
  };
```

`claimablePromotions` 필터에는 **발급 창** 조건을 더한다(아직 발급 안 받은 쿠폰이므로):
```ts
      issuanceWindowState(metaById.get(promo.id), now) === 'ok' &&
```
(`isValidPromotion(promo)` 호출은 그대로 두되, claimable 목록에서만 이 줄을 `!isClaimExhausted` 앞에 추가한다.)

`expiredPromotions` 를 교체한다:
```ts
  // 만료 쿠폰: 고객에게 발급됐던 쿠폰 중 만료가 지난 것, 최근 30일 이내. 최근 만료순, 최대 50개.
  const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
  const expiredCutoff = new Date(now.getTime() - THIRTY_DAYS_MS);
  const expiredPromotions = (customer?.promotions ?? [])
    .filter((promo: any) => {
      if (promo.is_automatic) return false;
      const raw = expiresAtOf(promo.id);
      if (!raw) return false;
      const endsAt = new Date(raw);
      return endsAt < now && endsAt >= expiredCutoff;
    })
    .sort((a: any, b: any) =>
      new Date(expiresAtOf(b.id) as any).getTime() - new Date(expiresAtOf(a.id) as any).getTime())
    .slice(0, 50)
    .map((promo: any) => format(promo, true));
```

- [ ] **Step 5: `preview` 라우트를 고친다**

import 에 추가:
```ts
import { resolveVisibility, meetsGroupRule, findIssuedLink } from '../../../admin/promotions/helpers';
import { isUsable, issuanceWindowState } from '../../../../modules/promotion-meta/validity';
```

프로모션 `query.graph` 에서 `'campaign.starts_at', 'campaign.ends_at',` 줄을 뺀다.

`const meta = ...` 를 캠페인 창 검사 **앞**으로 옮기고, 캠페인 블록 전체를 교체한다:

```ts
  const meta = await promotionMetaService.getByPromotionId(promotion.id);
  // 메타가 없으면 닫힌 쪽이다(#488 N7).
  const visibility: string = resolveVisibility(meta);
  const customerId: string | null = (req as any).auth_context?.actor_id ?? null;

  const now = new Date();
  const issuedLink = customerId ? await findIssuedLink(req.scope, customerId, promotion.id) : null;
  const expiresAt = issuedLink ? issuedLink.expires_at : (meta?.ends_at ?? null);

  if (issuanceWindowState(meta, now) === 'not_started' && !issuedLink) {
    return res.status(200).json({
      valid: false,
      reason: 'COUPON_NOT_STARTED',
      message: '아직 사용 기간이 아닌 쿠폰입니다.',
    });
  }
  if (!isUsable(issuedLink, meta, now)) {
    return res.status(200).json({
      valid: false,
      reason: 'COUPON_EXPIRED',
      message: '기간이 만료된 쿠폰입니다.',
      expired_at: expiresAt ? new Date(expiresAt).toISOString() : null,
    });
  }
```

(원래 `const meta` / `const visibility` / `const customerId` 선언이 아래에 남아 있으므로 **삭제**한다.)

`baseInfo` 의 `expires_at` 을 바꾼다:
```ts
    expires_at: expiresAt,
```

- [ ] **Step 6: `events/[slug]` 라우트를 고친다**

import 에 추가:
```ts
import { resolveVisibility, meetsGroupRule, listIssuedLinks } from '../../../admin/promotions/helpers';
import { isUsable, issuanceWindowState } from '../../../../modules/promotion-meta/validity';
```

프로모션 `query.graph` 에서 `'campaign.starts_at', 'campaign.ends_at',` 줄을 뺀다.

`metaById` 아래에 링크 맵을 추가한다(고객이 있을 때만):
```ts
  const linkByPromotionId = new Map(
    (customerId ? await listIssuedLinks(req.scope, customerId) : []).map((l) => [l.promotion_id, l]),
  );
```
(`customerId` 를 구하는 기존 코드보다 **뒤**에 둔다.)

`resolveState` 안의 캠페인 창 검사(`:80-81` 부근)를 교체한다:
```ts
    if (!isUsable(linkByPromotionId.get(promo.id) ?? null, meta, now)) {
      return { kind: 'blocked', reason: 'expired' };
    }
    if (issuanceWindowState(meta, now) === 'not_started') {
      return { kind: 'blocked', reason: 'not_started' };
    }
```
(원래 반환하던 `reason` 문자열이 다르면 그 값을 그대로 유지한다 — 스토어프론트가 매핑한다.)

`coupons` 매핑의 `expires_at` 을 바꾼다:
```ts
        expires_at: linkByPromotionId.get(promo.id)?.expires_at ?? meta?.ends_at ?? null,
```

- [ ] **Step 7: 기존 통합 스펙의 캠페인 케이스를 전환한다**

`apps/medusa/integration-tests/http/coupon-store.spec.ts:176-178`:
```ts
      await createPromoRaw('EXPIREDC', {
        visibility: 'public',
        ends_at: '2000-01-01T00:00:00.000Z',
      });
```
(세 번째 인자 `{ campaign: ... }` 를 없앤다.)

- [ ] **Step 8: 통과를 확인하고 커밋**

```bash
cd apps/medusa && TEST_TYPE=unit NODE_OPTIONS=--experimental-vm-modules npx jest --silent --runInBand --forceExit
cd apps/medusa && npm run test:integration:http
git add apps/medusa/src/api/store apps/medusa/integration-tests/http/coupon-store.spec.ts
git commit -m "feat(coupon): 스토어 응답의 만료를 링크 행 기준으로 내린다

preview·events·me/promotions 셋 다 campaign.ends_at 대신 «링크 행이 있으면 링크 행»
규칙을 쓴다. 응답에는 최상위 expires_at 을 새로 내린다 — campaign 블록은 형태만 남고
값이 null 이 되므로 스토어프론트가 이 필드로 옮겨야 한다(Task 12).

me/promotions 는 링크를 한 번에 모아 조회한다 — metas·maxDiscountById 와 같은 방식이다."
```

---

## Task 10: 어드민 읽기 — 라우트 2곳 + admin-web 표시

**Files:**
- Modify: `apps/medusa/src/api/admin/customers/[id]/promotions/route.ts` (GET)
- Modify: `apps/medusa/src/api/admin/promotions/[id]/customers/route.ts` (GET)
- Modify: `apps/admin-web/src/lib/api/domains/medusa/promotions.ts`
- Modify: `apps/admin-web/src/features/mall/marketing/coupons/coupon-helpers.tsx`
- Modify: `apps/admin-web/src/features/mall/marketing/coupons/template/marketing-coupons-template.tsx:210`
- Test: `apps/admin-web/src/features/mall/marketing/coupons/lib/coupon-period.spec.ts` (신규)

**Interfaces:**
- Consumes: Task 5 의 `toMetadataShape` 3필드, Task 6 의 `listIssuedLinks`
- Produces (신규 `lib/coupon-period.ts`):
  - `couponPeriodText(coupon: Pick<MedusaPromotion, 'metadata'>): string`
  - `isCouponExpired(coupon: Pick<MedusaPromotion, 'metadata'>, now: Date): boolean`
  - 기존 `formatPeriod(coupon: MedusaPromotion): string` 은 시그니처를 유지한 채 `couponPeriodText` 를 부르기만 하는 얇은 껍데기가 된다 — 호출부(`coupon-detail-dialog.tsx:166` 등)를 안 건드리기 위해서다.

> ⚠️ `coupon-helpers.tsx` 는 `.tsx` 라 jest transform 밖이다. **판정은 새 `.ts` 파일로 뽑고**
> `.tsx` 는 그것을 부르기만 한다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`apps/admin-web/src/features/mall/marketing/coupons/lib/coupon-period.ts` 를 만들 것을 전제로
`apps/admin-web/src/features/mall/marketing/coupons/lib/coupon-period.spec.ts`:

```ts
import { couponPeriodText, isCouponExpired } from './coupon-period';

const NOW = new Date('2026-08-31T00:00:00.000Z');

const promo = (metadata: Record<string, unknown> | null) => ({ metadata }) as any;

describe('couponPeriodText', () => {
  it('시작·종료가 다 있으면 범위로 쓴다', () => {
    expect(
      couponPeriodText(promo({ starts_at: '2026-09-01T00:00:00Z', ends_at: '2026-09-30T00:00:00Z' })),
    ).toMatch(/~/);
  });

  it('종료만 있으면 "~ 종료"', () => {
    expect(couponPeriodText(promo({ ends_at: '2026-09-30T00:00:00Z' })).startsWith('~')).toBe(true);
  });

  it('메타가 없거나 비어 있으면 무기한', () => {
    expect(couponPeriodText(promo(null))).toEqual('무기한');
    expect(couponPeriodText(promo({}))).toEqual('무기한');
  });

  it('유효기간(일)이 있으면 그것을 함께 알린다 — 발급일 기준이라 범위와 다르다', () => {
    expect(couponPeriodText(promo({ ends_at: '2026-09-30T00:00:00Z', validity_days: 30 }))).toMatch(
      /발급 후 30일/,
    );
  });
});

describe('isCouponExpired', () => {
  it('메타의 ends_at 이 지났으면 만료', () => {
    expect(isCouponExpired(promo({ ends_at: '2000-01-01T00:00:00Z' }), NOW)).toBe(true);
  });

  it('아직이면 만료 아님', () => {
    expect(isCouponExpired(promo({ ends_at: '2999-01-01T00:00:00Z' }), NOW)).toBe(false);
  });

  it('ends_at 이 없으면 만료 아님', () => {
    expect(isCouponExpired(promo({}), NOW)).toBe(false);
    expect(isCouponExpired(promo(null), NOW)).toBe(false);
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

```bash
cd apps/admin-web && npx jest coupon-period
```
Expected: FAIL — `Cannot find module './coupon-period'`

- [ ] **Step 3: 판정을 `.ts` 로 만든다**

`apps/admin-web/src/features/mall/marketing/coupons/lib/coupon-period.ts`:

```ts
import type { MedusaPromotion } from '@/lib/api/domains/medusa/promotions';

/**
 * 쿠폰 기간 표시·판정 (#488 결정 1).
 *
 * 정본은 `promotion_meta` 의 `starts_at`/`ends_at`/`validity_days` 다 — 캠페인 날짜는 더 이상
 * 쓰지 않는다. `.tsx` 는 jest transform 밖이라 판정을 여기 `.ts` 에 둔다(#488 P1 교훈).
 */

function fmt(iso: unknown): string | null {
  if (typeof iso !== 'string' || !iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('ko-KR', { year: '2-digit', month: '2-digit', day: '2-digit' });
}

function meta(coupon: Pick<MedusaPromotion, 'metadata'>): Record<string, unknown> {
  return (coupon.metadata ?? {}) as Record<string, unknown>;
}

/** 「25. 09. 01. ~ 25. 09. 30. · 발급 후 30일」 꼴. 아무것도 없으면 「무기한」. */
export function couponPeriodText(coupon: Pick<MedusaPromotion, 'metadata'>): string {
  const m = meta(coupon);
  const start = fmt(m.starts_at);
  const end = fmt(m.ends_at);
  const days = Number(m.validity_days);

  let range: string;
  if (start && end) range = `${start} ~ ${end}`;
  else if (end) range = `~ ${end}`;
  else if (start) range = `${start} ~`;
  else range = '무기한';

  return Number.isFinite(days) && days > 0 ? `${range} · 발급 후 ${days}일` : range;
}

/** 발급 창이 끝났는가. 목록의 「만료」 필터가 묻는 질문이다. */
export function isCouponExpired(coupon: Pick<MedusaPromotion, 'metadata'>, now: Date): boolean {
  const raw = meta(coupon).ends_at;
  if (typeof raw !== 'string' || !raw) return false;
  const d = new Date(raw);
  return !Number.isNaN(d.getTime()) && d < now;
}
```

- [ ] **Step 4: `.tsx` 를 얇게 만든다**

`apps/admin-web/src/features/mall/marketing/coupons/coupon-helpers.tsx` 의 `formatPeriod` 를 교체한다:

```tsx
import { couponPeriodText } from './lib/coupon-period';

export function formatPeriod(coupon: MedusaPromotion): string {
  return couponPeriodText(coupon);
}
```

`apps/admin-web/src/features/mall/marketing/coupons/template/marketing-coupons-template.tsx:210` 의 만료 판정을 교체한다:

```tsx
            isCouponExpired(c, new Date())
```
(import 를 추가하고, 원래 `(c.campaign?.ends_at != null && new Date(c.campaign.ends_at) < new Date())` 표현을 대체한다.)

- [ ] **Step 5: 타입에 3필드를 더한다**

`apps/admin-web/src/lib/api/domains/medusa/promotions.ts` 의 `metadata` 타입에 세 필드를 추가한다(파일의 기존 metadata 선언 형태를 그대로 따른다):

```ts
    starts_at?: string | null;
    ends_at?: string | null;
    validity_days?: number | null;
```

- [ ] **Step 6: 어드민 라우트 2곳에 링크 컬럼을 노출한다**

`apps/medusa/src/api/admin/promotions/[id]/customers/route.ts` 의 GET — `select` 와 매핑을 바꾼다:

```ts
    (link.getLinkModule(Modules.CUSTOMER, 'customer_id', Modules.PROMOTION, 'promotion_id') as any)
      .list({ promotion_id: promotionId }, {
        select: ['customer_id', 'created_at', 'expires_at', 'used_at', 'order_id', 'issued_via'],
      }) as Promise<any[]>,
```

```ts
  const linkByCustomerId = new Map<string, any>(
    (allLinks as any[]).map((l) => [l.customer_id, l]),
  );
```
(기존 `issuedAtMap` 을 이 맵으로 대체하고, `customersWithUsage` 를 바꾼다:)
```ts
  const customersWithUsage = customers.map((c) => {
    const l = linkByCustomerId.get(c.id);
    return {
      ...c,
      issued_at: l?.created_at ?? c.created_at,
      expires_at: l?.expires_at ?? null,
      used_at: l?.used_at ?? null,
      order_id: l?.order_id ?? null,
      issued_via: l?.issued_via ?? null,
      used_count: usageMap.get(c.id) ?? 0,
    };
  });
```

`apps/medusa/src/api/admin/customers/[id]/promotions/route.ts` 의 GET — 캠페인 두 줄을 빼고 링크를 붙인다:

```ts
      'promotions.campaign_id',
      'promotions.campaign.campaign_identifier',
```
(`promotions.campaign.starts_at`·`ends_at` 두 줄 삭제)

`paginatedPromotions` 계산 앞에 추가:
```ts
  const linkByPromotionId = new Map(
    (await listIssuedLinks(req.scope, customerId)).map((l) => [l.promotion_id, l]),
  );
```
그리고 매핑:
```ts
  const paginatedPromotions = promotions.slice(offset, offset + limit).map((p: any) => ({
    ...p,
    expires_at: linkByPromotionId.get(p.id)?.expires_at ?? null,
    used_at: linkByPromotionId.get(p.id)?.used_at ?? null,
    issued_via: linkByPromotionId.get(p.id)?.issued_via ?? null,
  }));
```
import 에 `listIssuedLinks` 를 추가한다.

- [ ] **Step 7: 통과를 확인하고 커밋**

```bash
cd apps/admin-web && npx jest coupon-period && npx tsc --noEmit && npm run test:admin-web
cd apps/medusa && npm run test:integration:http
git add apps/admin-web/src apps/medusa/src/api/admin
git commit -m "feat(coupon): 어드민이 발급된 한 장의 상태를 본다

두 GET 라우트가 링크 행의 expires_at·used_at·order_id·issued_via 를 노출하고,
admin-web 의 기간 표시·만료 판정이 campaign 대신 metadata 를 읽는다.

판정은 .tsx 가 아니라 새 lib/coupon-period.ts 에 있다 — admin-web 의 jest transform 이
^.+\\.(t|j)s$ 라 .tsx 안의 분기는 테스트가 실행조차 되지 않는다."
```

---

## Task 11: admin-web 쓰기 — 날짜를 `additional_data` 로 (`1-3` 종결)

**Files:**
- Modify: `apps/admin-web/.../coupons/lib/build-create-promotion-payload.ts`
- Modify: `apps/admin-web/.../coupons/lib/build-create-promotion-payload.spec.ts`
- Modify: `apps/admin-web/.../coupons/components/coupon-create-dialog.tsx`

**Interfaces:**
- Consumes: Task 5 의 `additional_data` 3키
- Produces: `CouponFormState` 에 `validityDays: number | ''`. 날짜만 넣은 쿠폰은 `campaign` 을 만들지 않는다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`build-create-promotion-payload.spec.ts` 에 추가:

```ts
  it('날짜는 campaign 이 아니라 additional_data 로 간다 (#488 결정 1)', () => {
    const out = buildCreatePromotionPayload(
      form({ startsAt: '2026-09-01T00:00', endsAt: '2026-09-30T00:00' }),
      { campaignSuffix: 'X' },
    );
    expect(out.additional_data.starts_at).toEqual(new Date('2026-09-01T00:00').toISOString());
    expect(out.additional_data.ends_at).toEqual(new Date('2026-09-30T00:00').toISOString());
  });

  it('🔴 날짜만 넣으면 캠페인을 만들지 않는다 — 캠페인 탭 오염 종결 (#488 1-3)', () => {
    const out = buildCreatePromotionPayload(
      form({ startsAt: '2026-09-01T00:00', endsAt: '2026-09-30T00:00' }),
      { campaignSuffix: 'X' },
    );
    expect(out.campaign).toBeUndefined();
  });

  it('예산이 있으면 캠페인을 만든다 — 예산은 캠페인에만 있다', () => {
    const out = buildCreatePromotionPayload(form({ spendLimit: 100000 }), { campaignSuffix: 'X' });
    expect(out.campaign).toBeDefined();
    expect(out.campaign?.starts_at).toBeUndefined();
    expect(out.campaign?.ends_at).toBeUndefined();
  });

  it('유효기간(일)은 additional_data 로 간다', () => {
    const out = buildCreatePromotionPayload(form({ validityDays: 30 }), { campaignSuffix: 'X' });
    expect(out.additional_data.validity_days).toEqual(30);
  });

  it('유효기간(일)을 안 넣으면 키 자체가 없다', () => {
    const out = buildCreatePromotionPayload(form({}), { campaignSuffix: 'X' });
    expect('validity_days' in out.additional_data).toBe(false);
  });
```

> `form(overrides)` 헬퍼가 그 스펙에 없으면, 파일의 기존 테스트가 쓰는 폼 리터럴을 헬퍼로 뽑는다.
> `validityDays: 0` 을 기본값으로 넣지 말 것 — `CouponFormState.validityDays` 의 기본은 `''` 다.

- [ ] **Step 2: 실패를 확인한다**

```bash
cd apps/admin-web && npx jest build-create-promotion-payload
```
Expected: FAIL — 날짜가 여전히 `campaign` 으로 가고 `validityDays` 가 타입에 없다

- [ ] **Step 3: 페이로드 빌더를 고친다**

`CouponFormState` 에 추가:
```ts
  /**
   * 발급된 한 장의 수명(일). #488 결정 1 의 «인스턴스 축». 비우면 만료는 `endsAt` 이 정한다.
   */
  validityDays: number | '';
```

`additional_data` 조립에 추가(`autoIssueTrigger` 줄 아래):
```ts
  // 유효기간 두 축 (#488 결정 1): 창은 promotion_meta 가 갖고, 캠페인 날짜는 쓰지 않는다.
  // 엔진의 listActivePromotions_ 가 캠페인 창이 지난 프로모션을 할인 계산에서 제외하기 때문에
  // 캠페인에 날짜를 실으면 「발급 후 N일」이 표현되지 않는다.
  if (form.startsAt) additional_data.starts_at = new Date(form.startsAt).toISOString();
  if (form.endsAt) additional_data.ends_at = new Date(form.endsAt).toISOString();
  if (form.validityDays) additional_data.validity_days = Number(form.validityDays);
```

`hasCampaign` 을 예산만으로 판정한다:
```ts
  // 캠페인은 «예산이 필요할 때만» 만든다. 날짜만으로 만들면 CAMP_<code> 가 캠페인 탭을
  // 기계 생성 행으로 오염시킨다(#488 1-3).
  const hasCampaign = Boolean(budget);
```

캠페인 블록에서 날짜 두 줄을 **삭제**한다:
```ts
    ...(hasCampaign
      ? {
          campaign: {
            name: name || code,
            // 코드 재사용(삭제 후 재생성) 시 campaign_identifier 충돌 방지
            campaign_identifier: `CAMP_${code}_${opts.campaignSuffix}`,
            ...(budget ? { budget } : {}),
          },
        }
      : {}),
```

- [ ] **Step 4: 폼에 입력란을 더한다**

`coupon-create-dialog.tsx`:

상태 추가(`endsAt` 아래):
```tsx
  const [validityDays, setValidityDays] = useState<number | ''>('');
```

`buildCreatePromotionPayload` 호출 인자에 추가:
```tsx
          minOrderAmount, customerGroupIds, startsAt, endsAt, validityDays,
```

날짜 그리드(`:404-421`)를 다음으로 교체한다:
```tsx
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>발급 시작일</Label>
              <Input
                type="datetime-local"
                value={startsAt}
                onChange={(e) => setStartsAt(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>발급 종료일</Label>
              <Input
                type="datetime-local"
                value={endsAt}
                onChange={(e) => setEndsAt(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>유효기간 (일)</Label>
            <Input
              type="number"
              min={1}
              value={validityDays}
              onChange={(e) => setValidityDays(e.target.value === '' ? '' : Number(e.target.value))}
              placeholder="예: 30 (발급받은 날부터 30일)"
            />
            <p className="text-xs text-muted-foreground">
              {validityDays
                ? `발급받은 날부터 ${validityDays}일간 사용할 수 있습니다. 발급 종료일이 지나도 유효합니다.`
                : '비워두면 «발급 종료일»까지 사용할 수 있습니다. 전체공개 쿠폰은 항상 이 방식입니다.'}
            </p>
          </div>
```

폼 초기화(`reset` 계열 함수가 있으면) 에 `setValidityDays('')` 를 추가한다.

- [ ] **Step 5: 통과를 확인하고 커밋**

```bash
cd apps/admin-web && npx jest build-create-promotion-payload && npx tsc --noEmit && npm run test:admin-web
git add apps/admin-web/src/features/mall/marketing/coupons/
git commit -m "feat(coupon): 어드민이 발급 창과 유효기간을 따로 입력한다 (1-3 종결)

날짜가 campaign 이 아니라 additional_data 로 간다. 그 귀결로 hasCampaign 이 예산
유무만 보게 되고, 날짜만 넣은 쿠폰이 더 이상 CAMP_<code> 캠페인을 만들지 않는다 —
#488 1-3 의 «캠페인 탭 오염» 이 여기서 닫힌다.

「유효기간(일)」 입력란이 인스턴스 축이다. 비우면 발급 종료일이 만료가 된다."
```

---

## Task 12: storefront — `expires_at` 로 옮긴다

**Files:**
- Modify: `web/almondyoung-storefront/src/lib/types/dto/promotion.ts`
- Modify: `web/almondyoung-storefront/src/domains/mypage/template/coupon/coupon-template.tsx:9-10`

**Interfaces:**
- Consumes: Task 9 의 최상위 `expires_at`
- Produces: `PromotionDto.expires_at?: string | null`

- [ ] **Step 1: DTO 에 필드를 더한다**

`web/almondyoung-storefront/src/lib/types/dto/promotion.ts` 의 `PromotionDto` 에 추가:

```ts
  /**
   * 이 쿠폰이 언제까지 쓸 수 있는가 (#488 결정 1). 발급된 쿠폰이면 «받은 한 장»의 만료이고,
   * 아니면 정책의 종료일이다. `null` 이면 무기한.
   *
   * ⚠️ `campaign.ends_at` 을 대체한다 — 캠페인 날짜는 서버가 더 이상 채우지 않는다.
   */
  expires_at?: string | null
```

- [ ] **Step 2: 표시를 옮긴다**

`web/almondyoung-storefront/src/domains/mypage/template/coupon/coupon-template.tsx:9-10`:

```tsx
  if (!promo.expires_at) return t("unlimited")
  return `~ ${formatDate(promo.expires_at, DATE_FORMATS.KO_DOT)}`
```

- [ ] **Step 3: 다른 소비자가 없는지 확인한다**

```bash
grep -rn "campaign?\.ends_at\|campaign\.ends_at\|campaign?\.starts_at" web/almondyoung-storefront/src
```
Expected: 출력 없음. 남아 있으면 그것도 `expires_at` 으로 옮긴다.

- [ ] **Step 4: 타입 게이트와 테스트를 돌리고 커밋**

```bash
cd web/almondyoung-storefront && npx tsc --noEmit 2>&1 | tail -3   # 기준선 49 — 늘어나면 안 된다
cd web/almondyoung-storefront && npx vitest run
git add web/almondyoung-storefront/src
git commit -m "feat(coupon): 스토어프론트가 expires_at 을 읽는다

campaign.ends_at 은 서버가 더 이상 채우지 않는다. 마이페이지 쿠폰 카드의 기간 표시를
새 최상위 필드로 옮긴다."
```

---

## Task 13: 배포 후 1회성 스크립트

**Files:**
- Create: `apps/medusa/src/scripts/detach-coupon-campaigns.ts`

**Interfaces:**
- Consumes: Task 2 의 `promotion_meta` 3열, Task 4 의 링크 `expires_at`
- Produces: 없음 (운영 도구)

- [ ] **Step 1: 스크립트를 쓴다**

`apps/medusa/src/scripts/detach-coupon-campaigns.ts`:

```ts
import type { ExecArgs } from '@medusajs/framework/types';
import { ContainerRegistrationKeys, Modules } from '@medusajs/framework/utils';
import { PROMOTION_META_MODULE } from '../modules/promotion-meta';
import type PromotionMetaModuleService from '../modules/promotion-meta/service';

const CONFIRM_VALUE = 'detach-coupon-campaigns';

/**
 * 캠페인 날짜를 쓰던 옛 쿠폰을 새 모델로 넘긴다 (#488 결정 1, 배포 후 1회).
 *
 * 하는 일 셋:
 *  ① `promotion_meta` 행이 있는 프로모션의 `campaign.starts_at`/`ends_at` 을 비운다.
 *     (값은 마이그레이션 `Migration20260831100000` 이 이미 `promotion_meta` 로 백필했다.)
 *  ② 그 프로모션의 `campaign_id` 를 뗀다.
 *  ③ 아무 프로모션도 안 붙었고 예산도 없는 기계 생성 `CAMP_%` 캠페인을 지운다.
 *  ④ `expires_at` 이 비어 있는 기존 링크 행을 정책값으로 백필한다 — 안 하면 이 변경 전에
 *     발급된 쿠폰이 영원히 무기한이 된다(`validity.ts` 의 fail-open).
 *
 * **예산(`budget`)이 붙은 캠페인은 건드리지 않는다** — 캠페인은 예산이 필요할 때 계속 쓴다.
 *
 * 이 쓰기가 마이그레이션이 아니라 스크립트인 이유: `promotion`·`promotion_campaign` 은
 * 코어 프로모션 모듈 소유 테이블이고, 우리 모듈 마이그레이션이 그것을 UPDATE 하면 모듈
 * 격리를 어기며 `down()` 이 복원 불가다.
 *
 * 사용:
 *   dry-run(기본):  medusa exec ./src/scripts/detach-coupon-campaigns.ts
 *   실제 반영:      DETACH_CAMPAIGNS_DRY_RUN=false DETACH_CAMPAIGNS_CONFIRM=detach-coupon-campaigns \
 *                   medusa exec ./src/scripts/detach-coupon-campaigns.ts
 */
export default async function detachCouponCampaigns({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const link = container.resolve(ContainerRegistrationKeys.LINK) as any;
  const promotionModule = container.resolve<any>(Modules.PROMOTION);
  const metaService = container.resolve<PromotionMetaModuleService>(PROMOTION_META_MODULE);

  const dryRun = process.env.DETACH_CAMPAIGNS_DRY_RUN !== 'false';
  if (!dryRun && process.env.DETACH_CAMPAIGNS_CONFIRM !== CONFIRM_VALUE) {
    logger.error(`반영하려면 DETACH_CAMPAIGNS_CONFIRM=${CONFIRM_VALUE} 를 함께 주십시오.`);
    return;
  }
  logger.info(dryRun ? '[dry-run] 아무것도 바꾸지 않습니다.' : '[반영] 실제로 씁니다.');

  // ── ①② 메타가 있는 프로모션의 캠페인을 비우고 뗀다 ──
  const { data: promotions } = await query.graph({
    entity: 'promotion',
    fields: ['id', 'code', 'campaign_id', 'campaign.id', 'campaign.campaign_identifier',
             'campaign.starts_at', 'campaign.ends_at', 'campaign.budget.id'],
    filters: {},
  });

  const metas = await metaService.getByPromotionIds((promotions as any[]).map((p) => p.id));
  const metaByPromotionId = new Map(metas.map((m: any) => [m.promotion_id, m]));

  const toDetach = (promotions as any[]).filter(
    (p) => p.campaign_id && metaByPromotionId.has(p.id),
  );
  logger.info(`캠페인이 붙은 메타 보유 프로모션: ${toDetach.length}건`);
  for (const p of toDetach) {
    logger.info(`  - ${p.code} → campaign ${p.campaign.campaign_identifier} ` +
      `(starts=${p.campaign.starts_at ?? '-'}, ends=${p.campaign.ends_at ?? '-'}, ` +
      `budget=${p.campaign.budget?.id ? 'Y' : 'N'})`);
  }

  if (!dryRun) {
    for (const p of toDetach) {
      await promotionModule.updateCampaigns([{ id: p.campaign.id, starts_at: null, ends_at: null }]);
      await promotionModule.updatePromotions([{ id: p.id, campaign_id: null }]);
    }
  }

  // ── ③ 고아가 된 기계 생성 캠페인 삭제 (예산 있는 것은 남긴다) ──
  const detachedCampaignIds = new Set(toDetach.map((p) => p.campaign.id));
  const orphans = (promotions as any[])
    .map((p) => p.campaign)
    .filter((c) => c && detachedCampaignIds.has(c.id))
    .filter((c) => String(c.campaign_identifier ?? '').startsWith('CAMP_') && !c.budget?.id);
  const uniqueOrphans = [...new Map(orphans.map((c) => [c.id, c])).values()];
  logger.info(`삭제 대상 기계 생성 캠페인(예산 없음): ${uniqueOrphans.length}건`);
  if (!dryRun && uniqueOrphans.length) {
    await promotionModule.deleteCampaigns(uniqueOrphans.map((c) => c.id));
  }

  // ── ④ expires_at 이 비어 있는 링크 행 백필 ──
  const linkModule = link.getLinkModule(
    Modules.CUSTOMER, 'customer_id', Modules.PROMOTION, 'promotion_id',
  );
  const allLinks = (await linkModule.list(
    {}, { select: ['customer_id', 'promotion_id', 'expires_at'] },
  )) as any[];
  const needBackfill = allLinks.filter((l) => l.expires_at == null);
  const backfillable = needBackfill
    .map((l) => ({ l, endsAt: metaByPromotionId.get(l.promotion_id)?.ends_at ?? null }))
    .filter((x) => x.endsAt != null);
  logger.info(`expires_at 이 빈 링크 ${needBackfill.length}건 중 정책값으로 채울 수 있는 것 ${backfillable.length}건`);
  if (!dryRun) {
    for (const { l, endsAt } of backfillable) {
      await link.create([{
        [Modules.CUSTOMER]: { customer_id: l.customer_id },
        [Modules.PROMOTION]: { promotion_id: l.promotion_id },
        data: { expires_at: new Date(endsAt) },
      }]);
    }
  }

  logger.info(dryRun ? '[dry-run] 끝. 반영하려면 환경변수를 주십시오.' : '[반영] 끝.');
}
```

- [ ] **Step 2: dry-run 이 도는지 확인한다**

로컬 스택이 떠 있어야 한다(`docs/local-dev.md` 「전체 스택 로컬 구동」).

```bash
cd apps/medusa && npx medusa exec ./src/scripts/detach-coupon-campaigns.ts
```
Expected: 예외 없이 끝나고 대상 건수가 로그로 나온다(로컬은 대부분 0건)

- [ ] **Step 3: 타입 게이트와 커밋**

```bash
npm run type-check
git add apps/medusa/src/scripts/detach-coupon-campaigns.ts
git commit -m "chore(coupon): 배포 후 캠페인 분리·링크 백필 스크립트

코어 소유 테이블(promotion·promotion_campaign) 쓰기를 모듈 마이그레이션 밖으로 뺀 것이다.
dry-run 이 기본이고 반영에는 확인 환경변수가 필요하다(backfill-issued-count 와 같은 패턴).

④ 링크 백필이 없으면 이 변경 전에 발급된 쿠폰이 영원히 무기한이 된다 —
validity.ts 가 expires_at NULL 을 무기한으로 읽기 때문이다."
```

---

## Task 14: 전체 게이트 + 남은 캠페인 참조 청소

**Files:**
- Modify: 앞선 태스크가 놓친 잔여 참조 (있으면)

- [ ] **Step 1: 캠페인 날짜 참조가 남았는지 전수 확인한다**

```bash
grep -rn "campaign?\.\(ends_at\|starts_at\)\|campaign\.\(ends_at\|starts_at\)" \
  apps/medusa/src apps/admin-web/src web/almondyoung-storefront/src apps/channel-adapter/src \
  | grep -v "marketing-campaigns-template"
```
Expected: 출력 없음. `marketing-campaigns-template.tsx` 는 **캠페인 화면 자신**이라 대상이 아니다.
남은 것이 있으면 그 파일을 `promotion_meta` 기준으로 옮기고 이 태스크에서 커밋한다.

- [ ] **Step 2: `REMOTE_LINK` 가 남았는지 확인한다**

```bash
grep -rn "REMOTE_LINK" apps/medusa/src apps/medusa/integration-tests
```
Expected: `integration-tests/http/coupon-store.spec.ts:35` 만 남아 있을 수 있다 — 그것도 `LINK` 로 바꾼다.

- [ ] **Step 3: 게이트 6종을 전부 돌린다**

```bash
npm run type-check
npx jest --maxWorkers=2
cd apps/admin-web && npx tsc --noEmit && npm run test:admin-web
cd apps/medusa && TEST_TYPE=unit NODE_OPTIONS=--experimental-vm-modules npx jest --silent --runInBand --forceExit
cd apps/medusa && npm run test:integration:modules
cd apps/medusa && npm run test:integration:http
cd web/almondyoung-storefront && npx tsc --noEmit 2>&1 | tail -3
```

**기준선:** 루트 `type-check` 0 · 루트 jest 실패 0 · admin-web tsc 0 · storefront tsc **49**(늘어나면 안 된다) · medusa 3종 실패 0.

- [ ] **Step 4: 스펙의 열린 항목을 실측 결과로 닫는다**

`docs/superpowers/specs/2026-08-31-coupon-issuance-instance-and-validity-design.md` 를 고친다:
- §2 ⓑ 3번 — Task 4 의 T3 결과대로 「도달 불가로 확인, 분기 제거」 또는 「도달함, 분기 유지」로 확정한다.
- §9.2 T6 — Task 7 Step 6 에서 배송옵션 픽스처가 없어 통합 케이스를 건너뛰었다면 그 사실을 적는다.

- [ ] **Step 5: 최종 커밋**

```bash
git add -A
git commit -m "chore(coupon): 캠페인 날짜·REMOTE_LINK 잔여 참조 청소 + 게이트 6종 초록

스펙의 열린 항목 둘을 실측 결과로 닫았다."
```

---

## 이번에 검증되지 않는 것

플랜을 다 돌려도 아래는 자동 테스트가 닿지 않는다. **리허설 2차에 넣는다.**

- **어드민 생성 화면의 실제 입력** — 「발급 시작일/종료일」과 「유효기간(일)」을 채워 만든 쿠폰이
  의도대로 저장되는지. 다이얼로그는 `.tsx` 라 렌더 테스트가 없다.
- **마이페이지 쿠폰 카드의 기간 표시** — storefront 에 렌더 테스트가 없다.
- **주문 완료까지 가는 `used_at`/`order_id` 기입** — 배송옵션 픽스처가 저장소에 없다
  (P10-B 가 같은 이유로 배송수단 캡 경로를 못 덮었다).
- **배포 후 스크립트의 실제 반영** — dry-run 만 자동으로 돈다.

## 배포 (플랜 밖, 사람이 한다)

1. `sst deploy` **한 번**. 컨테이너 부팅이 `medusa db:migrate --execute-safe-links` 를 돌려
   모듈 마이그레이션 2건 + 링크 컬럼 4개를 함께 적용한다. **별도 `db:migrate` 호출은 없다.**
2. 스펙 §12 의 SQL 3건으로 대상 건수를 잰다.
3. `medusa exec ./src/scripts/detach-coupon-campaigns.ts` (먼저 dry-run, 출력 확인 후 반영).

**감수하는 창 둘** (스펙 §10): ⓐ 롤링 중 옛 태스크가 발급하면 `expires_at` 이 NULL(무기한),
ⓑ 캐시된 옛 storefront 번들이 만료 쿠폰을 「무기한」으로 표시. 강제는 서버가 하므로 금액은 안 샌다.
