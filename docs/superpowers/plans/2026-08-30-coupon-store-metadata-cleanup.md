# 스토어 쿠폰 응답 `metadata` 정리 + 응답 매퍼 추출 (P2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 스토어 쿠폰 목록 응답에서 **항상 `null` 이던 `metadata` 필드를 제거**하고, 그 응답을 만드는 로직을 순수 `.ts` 로 뽑아 「무엇이 나가는가」를 유닛 테스트로 고정한다.

**Architecture:** `GET /store/customers/me/promotions` 의 인라인 클로저 `formatPromotion` 을 `format-promotion.ts` 순수 함수로 추출한다(Task 1, 행동 변화 0). 그 다음 그 함수와 그래프 필드 목록에서 `metadata` 를 빼고, 스토어프론트 DTO 의 같은 필드를 함께 지운다(Task 2). 추출이 먼저인 이유는 Medusa 의 유닛 게이트가 `src/**/__tests__/*.unit.spec.ts` 만 돌리기 때문이다 — **라우트 핸들러 안에 있는 한 응답 모양은 검증 대상이 아니다.**

**Tech Stack:** Medusa v2.13.4 · TypeScript · Jest + `@swc/jest` (apps/medusa 자체 트리) · Next.js 15 (storefront — 타입만 변경)

**Spec:** 이슈 [#488](https://github.com/LCNINE/almondyoung-server/issues/488) 신규 항목 `N2` · 로드맵 `docs/superpowers/plans/2026-08-29-coupon-domain-master-plan.md` · 경계 `docs/adr/0033-coupons-are-owned-by-the-sales-channel.md`

## Global Constraints

- **마이그레이션 0건 · 시크릿 0건 · env 0건 · 이벤트 계약 0건.**
- **배포 순서 제약 없음.** 제거되는 필드를 **읽는 코드가 0곳**이므로(아래 소비자 목록) 옛 스토어프론트가 새 Medusa 를 만나도, 그 반대도 무해하다. 애초에 SST 한 스택에는 앱 간 배포 순서를 강제할 수단이 없다(`docs/…` 아닌 실측 결론 — 메모리 「SST 한 스택엔 배포 순서가 없다」).
- **어드민 응답의 `metadata` 는 건드리지 않는다.** `admin/promotions/route.ts:44,89` 가 내리는 `metadata` 는 우리가 `promotion_meta` 에서 합성한 것이고 admin-web 이 실제로 읽는다(`coupon-helpers.tsx:49`). 이 플랜의 대상은 **스토어 응답의 네이티브 컬럼 통과분**뿐이다.
- **`visibility` 의 타입은 이 플랜에서 손대지 않는다.** 값 유니온 단일화는 `N3` → **P3 의 소유**다. 여기서는 `string` 으로 둔다. (`'public' | 'claimable' | 'assigned_only'` 로 좁히고 싶어지면 그건 P3 의 diff 다.)
- **`promotion_meta` 리네임 금지** — `N6` 은 P6 소유이고 ADR 이 「리네임 비권장」으로 이미 판단했다.
- **네이티브 `promotion.metadata` 컬럼에 쓰는 코드는 0곳이다** (2026-08-30 grep 실측: `apps/medusa/src` 전체에서 promotion 대상 metadata write 0건). 그래서 값이 항상 `null` 이었다. 이름을 비워두는 편이 안전하다는 N2 의 처방을 그대로 따른다 — **네이티브 컬럼을 앞으로 쓸 수 있게 남긴다.**
- **검증 게이트 (2026-08-30 실측 기준선):**

  | 게이트 | 명령 | 기준선 |
  |---|---|---|
  | Medusa 유닛 | `npm run test:medusa` (루트) | **24 suites / 216 tests 전부 통과, 12.2s** |
  | Medusa 타입 | `cd apps/medusa && npx tsc --noEmit` | **선재 에러 정확히 3건** (아래 목록). 늘면 이 플랜이 만든 것 |
  | 스토어프론트 타입 | `cd web/almondyoung-storefront && npx tsc --noEmit 2>&1 \| grep -c "error TS"` | **49** (선재). 늘면 이 플랜이 만든 것 |
  | 스토어프론트 유닛 | `cd web/almondyoung-storefront && npm test` (vitest) | **22 files / 202 tests 전부 통과** |

  선재 Medusa 타입 에러 3건 (이 플랜과 무관, 고치지 말 것):
  ```
  src/admin/lib/sdk.ts(5,14): error TS1470: The 'import.meta' meta-property is not allowed …
  src/admin/lib/sdk.ts(6,12): error TS1470: …
  src/api/store/orders/[id]/__tests__/confirm-purchase.unit.spec.ts(11,41): error TS2307: Cannot find module '@workflows/…'
  ```
- **루트 게이트는 이 변경을 보지 않는다.** 루트 `npm run type-check` 의 `tsconfig.json:exclude` 에 `apps/medusa` 와 `web` 이 둘 다 있고, 루트 `npx jest` 는 `modulePathIgnorePatterns: ["/apps/medusa/"]` 로 제외한다. **`npm run test:medusa` 를 직접 부르지 않으면 새 스펙은 한 번도 실행되지 않는다.**
- **CI:** `apps/medusa/**` 변경은 `.github/workflows/medusa-unit-tests.yml` 이 PR 에서 `npm run test:unit` 을 돌린다 → 새 스펙은 CI 가 지킨다. **`web/**` 은 어떤 워크플로도 덮지 않는다** → 스토어프론트 타입 확인은 로컬에서 사람이 돌리는 것이 유일한 방어선이다.
- 주석·커밋 메시지는 한국어. 기존 파일 톤을 따른다.

---

## 이 값을 읽는 소비자 목록 (P1 교훈 1 — 필수 항목)

> P1 은 File Structure 표에 **쓰기 경로만** 적고 「지금 이 값을 읽는 코드는 어디인가」를 묻지 않아 Critical 을 냈다. 그래서 이 절이 File Structure 보다 **먼저** 온다. 근거는 전부 2026-08-30 `grep` 실측이다.

### `metadata` 를 스토어로 내보내는 곳 (발행처 전수)

| 엔드포인트 | 내보내는가 | 근거 |
|---|---|---|
| `GET /store/customers/me/promotions` | **✅ 내보낸다 — 이번에 제거할 유일한 지점** | `route.ts:129` `metadata: promo.metadata ?? null` (그래프 필드 `route.ts:41`) |
| `POST /store/customers/me/promotions/:id/claim` | ❌ | 응답이 `{ success, promotion_id }` 뿐 (`claim/route.ts` 마지막 줄) |
| `GET /store/coupons/preview` | ❌ | `baseInfo` 에 최상위 `visibility` 만 (`preview/route.ts:80-92`) |
| `GET /store/events/:slug` | ❌ | 파생 `state.kind/reason` 만 (`events/[slug]/route.ts:105-118`) |
| `GET /admin/promotions`, `GET /admin/promotions/:id` | ✅ (**대상 아님**) | `toMetadataShape(promotion_meta)` — 합성물이고 admin-web 이 읽는다 |

**즉 «스토어 응답의 `metadata`» 는 이 한 곳뿐이다.** 다른 스토어 라우트는 이미 N2 가 권하는 모양(최상위 `visibility`)으로 되어 있다.

### 그 필드를 읽는 곳 (소비자 전수)

| 소비자 | 읽는가 | 근거 / 조치 |
|---|---|---|
| `web/almondyoung-storefront/src/lib/types/dto/promotion.ts:35` | **타입 선언만** | `metadata: Record<string, unknown> \| null` — **Task 2 에서 제거** |
| 스토어프론트 런타임 (`coupon-template.tsx`·`coupon-card.tsx`·`coupon-tabs.tsx`·`checkout/sections/discount.tsx`·`coupons/claim/*`·`lib/api/medusa/promotion.ts`) | **❌ 0곳** | 쿠폰 경로 전체 grep 에서 `promo.metadata` / `coupon.metadata` 참조 0건 |
| `apps/medusa/integration-tests/http/coupon-store.spec.ts` | ❌ | `me/promotions` 를 4회 호출하나 `code` 배열만 단언. `metadata` 단언 0건 |
| admin-web | ❌ | 스토어 엔드포인트를 부르지 않는다. admin-web 이 읽는 `coupon.metadata`(`coupon-helpers.tsx:49`)는 **어드민 응답**이라 이 변경과 무관 |
| `HttpTypes.StorePromotion` 을 쓰는 장바구니 화면 | ❌ | Medusa 네이티브 카트 응답의 프로모션이라 우리 라우트와 다른 shape |
| core · channel-adapter · analytics · wallet | ❌ | 「`customers/me/promotions`」 문자열 grep 결과 저장소 전체에서 스토어프론트 2건 + Medusa 라우트/미들웨어뿐 |

**결론: 하위 호환 요구사항이 없다.** 이번 제거는 옛 데이터를 계속 읽어야 하는 P1 형태의 이전이 **아니다** — 옛 자리에 데이터가 존재한 적이 없다(네이티브 컬럼 writer 0곳). P1 교훈 3(「하위 호환을 명시적 요구사항으로」)은 **여기선 «없음»이 정답이며, 그 근거가 위 표다.**

---

## File Structure

| 파일 | 책임 |
|---|---|
| `apps/medusa/src/api/store/customers/me/promotions/format-promotion.ts` | **신규.** 프로모션 1건 → 스토어 응답 항목. 순수 함수. `metadata` 를 **의도적으로 내리지 않는다**는 계약을 주석과 타입으로 못 박는 자리. |
| `apps/medusa/src/api/store/customers/me/promotions/__tests__/format-promotion.unit.spec.ts` | **신규.** 위 함수의 유닛 스펙. 회귀 방어선 — `metadata` 가 다시 새면 여기서 빨개진다. |
| `apps/medusa/src/api/store/customers/me/promotions/route.ts` | **수정.** 인라인 `minOrderAmount`·`formatPromotion` 제거(111–149) → import. 그래프 필드에서 `'metadata'` 제거(41). |
| `web/almondyoung-storefront/src/lib/types/dto/promotion.ts` | **수정.** `PromotionDto.metadata` 필드 제거(35). |
| `docs/adr/0033-coupons-are-owned-by-the-sales-channel.md` | **수정.** 결정 5 끝에 「응답 표면의 `metadata` 규약」 한 블록. 다음 사람이 같은 함정에 다시 빠지지 않게 하는 유일한 영구 기록. |
| `docs/superpowers/plans/2026-08-29-coupon-domain-master-plan.md` | **수정.** 웨이브 A 표의 P2 행 + 진행 상황 체크박스. |

---

### Task 1: 응답 매퍼 추출 (행동 변화 0)

리팩터 전용 태스크다. **현재 응답 모양을 그대로 옮기고 스펙으로 고정한 뒤에** Task 2 에서 필드를 뺀다. 이 순서를 지키면 Task 2 의 diff 가 「무엇이 달라졌는가」만 남고, 추출이 충실했는지를 Task 1 의 초록이 증명한다.

**Files:**
- Create: `apps/medusa/src/api/store/customers/me/promotions/format-promotion.ts`
- Create: `apps/medusa/src/api/store/customers/me/promotions/__tests__/format-promotion.unit.spec.ts`
- Modify: `apps/medusa/src/api/store/customers/me/promotions/route.ts:111-149`(인라인 두 함수 제거), `:159-162`(`format` 클로저 추가)

**Interfaces:**
- Produces: `formatPromotion(promo: PromotionLike, isAssigned: boolean, visibility: string): FormattedPromotion` — Task 2 가 같은 시그니처로 반환 타입만 좁힌다.
- Produces: `type PromotionLike`, `type FormattedPromotion` (둘 다 export)
- Consumes: 없음 (순수 함수, 프레임워크 import 0)

- [ ] **Step 1: 실패하는 스펙을 먼저 쓴다**

`apps/medusa/src/api/store/customers/me/promotions/__tests__/format-promotion.unit.spec.ts`

```ts
import { formatPromotion, type PromotionLike } from '../format-promotion';

const basePromo: PromotionLike = {
  id: 'promo_1',
  code: 'WELCOME10',
  type: 'standard',
  status: 'active',
  is_automatic: false,
  metadata: null,
  rules: [],
  application_method: {
    id: 'am_1',
    type: 'percentage',
    value: 10,
    target_type: 'order',
    max_quantity: null,
    currency_code: null,
  },
  campaign: {
    campaign_identifier: 'CAMP_WELCOME10_1756400000000',
    starts_at: '2026-08-01T00:00:00.000Z',
    ends_at: '2026-09-01T00:00:00.000Z',
  },
};

describe('formatPromotion', () => {
  it('식별 필드를 그대로 옮기고, 발급 여부와 visibility 는 인자를 싣는다', () => {
    const out = formatPromotion(basePromo, true, 'claimable');
    expect(out).toMatchObject({
      id: 'promo_1',
      code: 'WELCOME10',
      type: 'standard',
      status: 'active',
      is_automatic: false,
      is_assigned: true,
      visibility: 'claimable',
    });
  });

  it('application_method 는 지정한 6개 필드만 싣는다', () => {
    const out = formatPromotion(basePromo, false, 'public');
    expect(out.application_method).toEqual({
      id: 'am_1',
      type: 'percentage',
      value: 10,
      target_type: 'order',
      max_quantity: null,
      currency_code: null,
    });
  });

  it('application_method 가 없으면 null 이다', () => {
    const out = formatPromotion({ ...basePromo, application_method: null }, false, 'public');
    expect(out.application_method).toBeNull();
  });

  it('campaign 은 식별자와 기간 3개 필드만 싣고, 없으면 null 이다', () => {
    expect(formatPromotion(basePromo, false, 'public').campaign).toEqual({
      campaign_identifier: 'CAMP_WELCOME10_1756400000000',
      starts_at: '2026-08-01T00:00:00.000Z',
      ends_at: '2026-09-01T00:00:00.000Z',
    });
    expect(formatPromotion({ ...basePromo, campaign: null }, false, 'public').campaign).toBeNull();
  });

  it('min_order_amount 를 subtotal gte 룰에서 뽑는다 — 값이 문자열이든 {value} 객체든', () => {
    const asString = formatPromotion(
      { ...basePromo, rules: [{ attribute: 'subtotal', operator: 'gte', values: ['30000'] }] },
      false,
      'public',
    );
    const asObject = formatPromotion(
      { ...basePromo, rules: [{ attribute: 'subtotal', operator: 'gte', values: [{ value: '30000' }] }] },
      false,
      'public',
    );
    expect(asString.min_order_amount).toBe(30000);
    expect(asObject.min_order_amount).toBe(30000);
  });

  it('subtotal gte 룰이 없거나 값이 숫자가 아니면 min_order_amount 는 null 이다', () => {
    expect(formatPromotion(basePromo, false, 'public').min_order_amount).toBeNull();
    expect(
      formatPromotion(
        { ...basePromo, rules: [{ attribute: 'customer.groups.id', operator: 'in', values: ['cg_1'] }] },
        false,
        'public',
      ).min_order_amount,
    ).toBeNull();
    expect(
      formatPromotion(
        { ...basePromo, rules: [{ attribute: 'subtotal', operator: 'gte', values: ['이만원'] }] },
        false,
        'public',
      ).min_order_amount,
    ).toBeNull();
  });

  // ⚠️ 이 테스트는 Task 2 에서 정반대로 뒤집힌다. 지금은 **현행 동작을 고정**하는 것이 목적이다 —
  // 추출이 충실했는지를 증명하고 나서 필드를 뺀다.
  it('[현행 고정] 네이티브 metadata 를 그대로 싣는다', () => {
    expect(formatPromotion({ ...basePromo, metadata: { k: 1 } }, false, 'public').metadata).toEqual({ k: 1 });
    expect(formatPromotion(basePromo, false, 'public').metadata).toBeNull();
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npm run test:medusa -- format-promotion`
Expected: FAIL — `Cannot find module '../format-promotion'`

- [ ] **Step 3: 매퍼를 만든다 (현재 라우트 코드를 그대로 옮긴다)**

`apps/medusa/src/api/store/customers/me/promotions/format-promotion.ts`

```ts
/**
 * 스토어 쿠폰 목록 응답의 한 항목을 만든다.
 *
 * 라우트 핸들러가 아니라 이 파일에 사는 이유: Medusa 의 유닛 게이트가
 * `src/**\/__tests__/*.unit.spec.ts` 만 돌리므로, 클로저로 두면 「무엇이 나가는가」가
 * 검증 대상 밖이다. 응답 모양은 계약이고, 계약은 테스트가 지켜야 한다.
 */

export type PromotionRuleValue = string | { value?: string | null } | null | undefined;

export type PromotionRuleLike = {
  attribute?: string | null;
  operator?: string | null;
  values?: PromotionRuleValue[] | null;
};

// 그래프 필드 목록(`route.ts` 의 `promotionFields`)이 항상 선택하는 것들이라 optional 로 두지
// 않는다 — optional 로 두면 매퍼가 `as` 캐스팅으로 되돌려야 한다.
export type ApplicationMethodLike = {
  id: string;
  type: string;
  value: number;
  target_type: string;
  max_quantity: number | null;
  currency_code: string | null;
};

export type CampaignLike = {
  campaign_identifier: string;
  starts_at: string | Date | null;
  ends_at: string | Date | null;
};

export type PromotionLike = {
  id: string;
  code: string;
  type: string;
  status: string;
  is_automatic: boolean;
  metadata?: Record<string, unknown> | null;
  rules?: PromotionRuleLike[] | null;
  application_method?: ApplicationMethodLike | null;
  campaign?: CampaignLike | null;
};

export type FormattedPromotion = {
  id: string;
  code: string;
  type: string;
  status: string;
  is_automatic: boolean;
  is_assigned: boolean;
  metadata: Record<string, unknown> | null;
  min_order_amount: number | null;
  visibility: string;
  application_method: ApplicationMethodLike | null;
  campaign: CampaignLike | null;
};

/**
 * 최소 주문 금액(subtotal gte rule) 추출 — 마이페이지 "최소주문금액 낮은순" 정렬용.
 * 룰 값은 그래프 결과에 따라 문자열이거나 `{ value }` 객체다.
 */
function minOrderAmount(promo: PromotionLike): number | null {
  const rule = (promo.rules ?? []).find(
    (r) => r?.attribute === 'subtotal' && r?.operator === 'gte',
  );
  if (!rule) return null;
  const raw = rule.values?.[0];
  const val = Number(typeof raw === 'string' ? raw : raw?.value);
  return Number.isFinite(val) ? val : null;
}

export function formatPromotion(
  promo: PromotionLike,
  isAssigned: boolean,
  visibility: string,
): FormattedPromotion {
  return {
    id: promo.id,
    code: promo.code,
    type: promo.type,
    status: promo.status,
    is_automatic: promo.is_automatic,
    is_assigned: isAssigned,
    metadata: promo.metadata ?? null,
    min_order_amount: minOrderAmount(promo),
    visibility,
    application_method: promo.application_method
      ? {
          // 필드를 하나씩 옮긴다 — 그래프가 더 실어 보내도 스토어 응답에 새지 않게.
          id: promo.application_method.id,
          type: promo.application_method.type,
          value: promo.application_method.value,
          target_type: promo.application_method.target_type,
          max_quantity: promo.application_method.max_quantity ?? null,
          currency_code: promo.application_method.currency_code ?? null,
        }
      : null,
    campaign: promo.campaign
      ? {
          campaign_identifier: promo.campaign.campaign_identifier,
          starts_at: promo.campaign.starts_at,
          ends_at: promo.campaign.ends_at,
        }
      : null,
  };
}
```

- [ ] **Step 4: 스펙이 통과하는지 확인한다**

Run: `npm run test:medusa -- format-promotion`
Expected: PASS — 7 tests

- [ ] **Step 5: 라우트를 매퍼에 배선한다 (호출부 4곳의 모양은 그대로)**

`route.ts` 상단 import 에 추가:

```ts
import { formatPromotion } from './format-promotion';
```

`route.ts:111-149` 의 인라인 `minOrderAmount` 주석·함수와 `formatPromotion` 클로저를 **통째로 삭제**한다. 그리고 `visibilityById` 선언(`:159-161`) **바로 뒤**에 얇은 클로저를 둔다 — 이러면 호출부 4곳(`:213`·`:227`·`:241`·`:256`)을 건드리지 않는다:

```ts
  // visibility 는 promotion_meta 에서 온다. 호출부가 매번 조회하지 않도록 여기서 묶는다.
  const format = (promo: any, isAssigned: boolean) =>
    formatPromotion(promo, isAssigned, visibilityById.get(promo.id) ?? 'public');
```

그리고 호출부 4곳의 이름만 `formatPromotion(...)` → `format(...)` 으로 바꾼다.

- [ ] **Step 6: 게이트를 돌린다**

```bash
npm run test:medusa
cd apps/medusa && npx tsc --noEmit
```
Expected: 유닛 **25 suites / 223 tests 전부 통과** (기준선 24/216 + 신규 1 suite/7 tests). 타입 에러는 **선재 3건 그대로** — 새 파일·라우트에서 나온 에러가 있으면 그건 이 태스크가 만든 것이다.

- [ ] **Step 7: 커밋**

```bash
git add apps/medusa/src/api/store/customers/me/promotions/format-promotion.ts \
        apps/medusa/src/api/store/customers/me/promotions/__tests__/format-promotion.unit.spec.ts \
        apps/medusa/src/api/store/customers/me/promotions/route.ts
git commit -m "refactor(medusa): 스토어 쿠폰 응답 매퍼를 순수 함수로 추출한다 (#488 N2 준비)"
```

---

### Task 2: 스토어 응답에서 `metadata` 제거 (Medusa + 스토어프론트 계약 한 커밋)

**Medusa 응답과 스토어프론트 DTO 를 한 커밋에 담는다.** 한쪽만 바꾸면 「서버는 안 주는데 타입은 있다고 말하는」 중간 상태가 남고, 그 상태는 정확히 N2 가 고치려는 «진단 고장»의 재현이다.

**Files:**
- Modify: `apps/medusa/src/api/store/customers/me/promotions/format-promotion.ts` (`metadata` 필드·타입 제거 + 계약 주석)
- Modify: `apps/medusa/src/api/store/customers/me/promotions/route.ts:41` (그래프 필드에서 `'metadata'` 제거)
- Modify: `apps/medusa/src/api/store/customers/me/promotions/__tests__/format-promotion.unit.spec.ts` (고정 테스트를 회귀 방어 테스트로 교체)
- Modify: `web/almondyoung-storefront/src/lib/types/dto/promotion.ts:35` (`metadata` 필드 제거)

**Interfaces:**
- Produces: `FormattedPromotion` 에서 `metadata` 키가 사라진다. `formatPromotion` 시그니처(3인자)는 Task 1 과 동일하게 유지.

- [ ] **Step 1: 테스트를 먼저 뒤집는다**

스펙의 `[현행 고정]` 테스트를 **삭제하고** 그 자리에 아래를 넣는다:

```ts
  // #488 N2. 스토어 응답의 `metadata` 는 어드민의 합성 metadata 와 이름만 같고 정체가 달랐다 —
  // Medusa 네이티브 json 컬럼이라 쓰는 코드가 0곳이고 값이 항상 null 이었다. 「스토어에 메타가
  // 없다」는 잘못된 진단을 유도했으므로 이름 자체를 비운다. 스토어가 필요로 하는 메타 정보는
  // 최상위 `visibility` 로 이미 나간다.
  it('metadata 를 내리지 않는다 — 네이티브 값이 채워져 있어도 응답에 새지 않는다', () => {
    const out = formatPromotion({ ...basePromo, metadata: { internal: 'x' } }, false, 'public');
    expect(out).not.toHaveProperty('metadata');
    expect(JSON.stringify(out)).not.toContain('internal');
  });

  it('visibility 는 스토어가 받는 유일한 메타 정보다 — 항상 최상위 필드로 나간다', () => {
    expect(formatPromotion(basePromo, false, 'assigned_only').visibility).toBe('assigned_only');
  });
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npm run test:medusa -- format-promotion`
Expected: FAIL — `expected object not to have property "metadata"` (1 failed, 7 passed)

- [ ] **Step 3: 매퍼에서 필드와 타입을 뺀다**

`format-promotion.ts` 에서:
1. `FormattedPromotion` 의 `metadata: Record<string, unknown> | null;` 줄 삭제
2. `formatPromotion` 반환 객체의 `metadata: promo.metadata ?? null,` 줄 삭제
3. `PromotionLike` 의 `metadata?: …` 는 **남긴다** — 그래프가 실어 보내도 조용히 버려진다는 것을 타입으로 표현하고, 스펙이 「채워져 있어도 안 샌다」를 검사할 수 있게 한다
4. 파일 상단 주석에 계약을 못 박는다:

```ts
/**
 * 스토어 쿠폰 목록 응답의 한 항목을 만든다.
 *
 * 라우트 핸들러가 아니라 이 파일에 사는 이유: Medusa 의 유닛 게이트가
 * `src/**\/__tests__/*.unit.spec.ts` 만 돌리므로, 클로저로 두면 「무엇이 나가는가」가
 * 검증 대상 밖이다. 응답 모양은 계약이고, 계약은 테스트가 지켜야 한다.
 *
 * **`metadata` 를 내리지 않는 것은 의도다 (#488 N2).** 어드민 응답의 `metadata` 는 우리가
 * `promotion_meta` 에서 합성한 것이고, 여기서 같은 이름으로 나가던 것은 Medusa 네이티브 json
 * 컬럼이었다. 그 컬럼에 쓰는 코드가 0곳이라 값은 늘 `null` 이었고, 「스토어엔 메타가 없다」는
 * 정반대 진단을 유도했다. 스토어에 필요한 메타 정보는 최상위 `visibility` 하나뿐이므로 그것만
 * 내보내고, 네이티브 컬럼은 나중에 쓸 수 있게 이름을 비워 둔다.
 */
```

- [ ] **Step 4: 그래프 필드 목록에서도 뺀다**

`route.ts:41` 의 `'metadata',` 한 줄을 삭제한다. 이 목록은 두 `query.graph` 호출(고객 발급분·전체 공개분)이 공유하며, `promo.metadata` 를 읽는 코드는 매퍼가 유일했으므로 남길 이유가 없다.

- [ ] **Step 5: Medusa 게이트를 돌린다**

```bash
npm run test:medusa
cd apps/medusa && npx tsc --noEmit
```
Expected: **25 suites / 224 tests 전부 통과** (Task 1 의 223 에서 고정 테스트 1개 제거 + 신규 2개). 타입 에러 선재 3건 그대로.

- [ ] **Step 6: 스토어프론트 DTO 에서 같은 필드를 지운다**

`web/almondyoung-storefront/src/lib/types/dto/promotion.ts` 의 `PromotionDto` 에서 아래 한 줄을 삭제한다:

```ts
  metadata: Record<string, unknown> | null
```

`visibility?: "public" | "claimable" | "assigned_only"` 는 **그대로 둔다** — 값 유니온 단일화는 P3(`N3`) 의 몫이다.

- [ ] **Step 7: 스토어프론트 게이트를 돌린다**

```bash
cd web/almondyoung-storefront && npx tsc --noEmit 2>&1 | grep -c "error TS"
cd web/almondyoung-storefront && npm test
```
Expected: 타입 에러 **49** (기준선과 동일 — 하나라도 늘면 이 필드를 실제로 읽는 코드가 있다는 뜻이므로 **멈추고 보고할 것**). vitest **22 files / 202 tests 전부 통과**.

- [ ] **Step 8: 커밋**

```bash
git add apps/medusa/src/api/store/customers/me/promotions/ \
        web/almondyoung-storefront/src/lib/types/dto/promotion.ts
git commit -m "fix(medusa): 스토어 쿠폰 응답에서 항상 null 이던 metadata 를 제거한다 (#488 N2)"
```

---

### Task 3: 정본 갱신 — ADR·로드맵·이슈

코드가 아니라 **다음 사람이 같은 오진을 하지 않게 하는 부분**이다. N2 의 피해는 기능 고장이 아니라 진단 고장이었으므로, 기록이 곧 수정의 절반이다.

**Files:**
- Modify: `docs/adr/0033-coupons-are-owned-by-the-sales-channel.md` (결정 5 끝)
- Modify: `docs/superpowers/plans/2026-08-29-coupon-domain-master-plan.md` (웨이브 A 표 + 진행 상황)
- 이슈 #488 에 실행 기록 코멘트 1건

**Interfaces:** 없음 (문서 전용)

- [ ] **Step 1: ADR-0033 결정 5 끝에 응답 표면 규약을 적는다**

`### 6. 명시적 예외 — 분석용 파생은 밖에 둔다` **바로 앞**에 아래 블록을 넣는다:

```markdown
**응답 표면의 `metadata` 규약 (2026-08-30, #488 N2).** 어드민 응답의 `metadata` 는 우리가 `promotion_meta` 에서 **합성한 것**이다(`api/admin/promotions/route.ts:44,89` → `toMetadataShape`). 스토어 응답은 **`metadata` 를 내리지 않는다** — 예전에 같은 이름으로 나가던 것은 Medusa 네이티브 json 컬럼이었고, 그 컬럼에 쓰는 코드가 0곳이라 값이 늘 `null` 이었다. 이름이 같고 정체가 다른 두 필드는 「스토어엔 메타가 없다」는 정반대 진단을 유도했다. 스토어가 필요로 하는 메타 정보는 **최상위 `visibility` 하나**이고, 다른 스토어 라우트(`coupons/preview`·`events/:slug`)도 이미 그 모양이다. 네이티브 컬럼은 앞으로 쓸 수 있게 이름을 비워 뒀으므로, **새로 `metadata` 를 내보내려는 코드는 그것이 합성물인지 네이티브인지부터 밝힐 것.**
```

- [ ] **Step 2: 로드맵의 P2 행과 진행 상황을 갱신한다**

`2026-08-29-coupon-domain-master-plan.md` 웨이브 A 표의 P2 행을 바꾼다:

```markdown
| **P2** 스토어 응답 `metadata` 정리 | `N2` | medusa | `2026-08-30-coupon-store-metadata-cleanup.md` ✅ 실행됨 |
```

진행 상황 절의 해당 줄을 아래 두 줄로 가른다:

```markdown
- [x] **P2 플랜 작성·실행 (2026-08-30)** — `2026-08-30-coupon-store-metadata-cleanup.md`
- [ ] P3 플랜 작성 및 실행  ← **다음 차례**
```

- [ ] **Step 3: 이슈 #488 에 실행 기록을 남긴다**

```bash
gh issue comment 488 --body "$(cat <<'EOF'
## 2026-08-30 실행 기록 — `N2` 종결 (P2)

**플랜:** `docs/superpowers/plans/2026-08-30-coupon-store-metadata-cleanup.md`

스토어 응답(`GET /store/customers/me/promotions`)에서 `metadata` 를 제거했다. 그 필드는 Medusa 네이티브 json 컬럼을 통과시키던 것이고, 쓰는 코드가 0곳이라 값이 항상 `null` 이었다. 어드민이 내리는 동명의 `metadata`(우리가 `promotion_meta` 에서 합성)와 정체가 달라 「스토어엔 메타가 없다」는 정반대 진단을 유도했다.

**함께 한 것**
- 응답 매퍼를 `format-promotion.ts` 순수 함수로 추출 — Medusa 유닛 게이트가 `src/**/__tests__/*.unit.spec.ts` 만 돌려서, 라우트 클로저인 동안에는 응답 모양이 검증 대상 밖이었다. 이제 「metadata 가 채워져 있어도 새지 않는다」가 테스트로 고정된다
- `query.graph` 필드 목록에서도 `metadata` 제거
- 스토어프론트 `PromotionDto.metadata` 제거 (런타임 읽기 0곳이었음 — 타입 선언만 있었다)
- ADR-0033 결정 5 에 「응답 표면의 `metadata` 규약」 기록

**발행처·소비자 전수 확인 (P1 교훈 반영)**
- 스토어 라우트 중 `metadata` 를 내보내던 곳은 이 한 곳뿐. `coupons/preview`·`events/:slug`·`claim` 은 이미 최상위 `visibility`/파생 상태만 내보낸다
- 읽는 곳: 스토어프론트 DTO 선언 1곳(제거), 런타임 참조 0곳, 통합 테스트 단언 0곳, 다른 서비스 0곳 → **하위 호환 요구사항 없음**

**마이그레이션 0건 · 배포 순서 제약 없음.** 어드민 응답의 `metadata` 는 그대로 두었다(admin-web 이 읽는 합성물). `visibility` 타입 단일화는 `N3`(P3), `promotion_meta` 이름 문제는 `N6`(P6) 소유로 남는다.
EOF
)"
```

- [ ] **Step 4: 커밋**

```bash
git add docs/adr/0033-coupons-are-owned-by-the-sales-channel.md \
        docs/superpowers/plans/2026-08-29-coupon-domain-master-plan.md \
        docs/superpowers/plans/2026-08-30-coupon-store-metadata-cleanup.md
git commit -m "docs: 스토어 응답 metadata 규약을 ADR-0033 에 적고 P2 를 종결한다 (#488 N2)"
```

---

## 최종 검증 (브랜치 전체)

플랜 실행 후, PR 을 올리기 전에 네 게이트를 **전부** 돌리고 기준선과 대조한다. 「돌렸다」가 아니라 **숫자를 적어** 보고할 것.

```bash
npm run test:medusa                                                   # 25 suites / 224 tests, 0 fail
cd apps/medusa && npx tsc --noEmit                                    # 선재 3건 그대로
cd web/almondyoung-storefront && npx tsc --noEmit 2>&1 | grep -c "error TS"   # 49
cd web/almondyoung-storefront && npm test                             # 22 files / 202 tests, 0 fail
```

루트 `npm run type-check` / `npx jest` 는 **이 변경을 보지 않는다**(exclude·ignore). 돌려도 무해하지만 이 플랜의 증거는 되지 못한다.

## 이 플랜이 검증하지 않는 것

- **실 서버 응답을 눈으로 본 적 없다.** 유닛 스펙이 증명하는 것은 「매퍼가 그 키를 만들지 않는다」까지다. `apps/medusa/integration-tests/http/coupon-store.spec.ts` 가 실제 HTTP 응답을 보지만 DB 를 요구해 기본 게이트에서 돌지 않는다 — **개통 리허설 1차에서 `me/promotions` 응답 본문을 한 번 찍어 `metadata` 키 부재와 `visibility` 존재를 확인할 것.**
- **스토어프론트 화면은 바뀌지 않는다.** 읽는 코드가 0곳이므로 화면 확인 항목이 없다. 이 사실이 틀렸다면 Task 2 Step 7 의 타입 에러 수가 49 를 넘겼을 것이다 — 그것이 이 플랜에서 「아무도 안 읽는다」를 검사하는 자리다.
