# 정률 쿠폰 최대 할인금액 (P10-B / A4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 「10% 할인, 최대 3만원」을 실제로 강제한다. `promotion_meta.max_discount_amount` 를 **재계산 지점마다 워크플로 훅에서 라인 adjustment 에 반영**하고, 그 값을 읽는 표시 표면 전부에 캡을 노출한다.

**Architecture:** 캡은 **엔진 밖**에서 건다. Medusa 프로모션 엔진이 계산을 마쳐 `line_item_adjustment` / `shipping_method_adjustment` 행을 만든 **직후**, 같은 프로모션이 만든 adjustment 의 합이 캡을 넘으면 합이 정확히 캡이 되도록 **비례 축소**해서 되쓴다. 붙는 자리는 넷: ① `refreshCartItemsWorkflow.hooks.beforeRefreshingPaymentCollection`(아이템 추가·수정·삭제, 배송수단 변경, `POST /store/carts/:id` — **스토어프론트의 실제 쿠폰 적용 경로**), ② `createCartWorkflow.hooks.cartCreated`(생성 시 `promo_codes`), ③ `POST|DELETE /store/carts/:id/promotions` 라우트(훅 없음 → 우리 라우트를 같은 경로에 둔다), ④ `completeCartWorkflow.hooks.validate` **백스톱**(기존 핸들러 안에 함수를 더한다 — 새 훅을 등록하지 않는다). 판정은 전부 순수 함수로 뽑아 유닛이 닿게 한다.

**Tech Stack:** Medusa v2.13.4 · TypeScript · `apps/medusa` = Jest + `@swc/jest`(유닛) + `medusaIntegrationTestRunner`(실 DB HTTP) · `apps/admin-web` = Jest(`^.+\.(t|j)s$` — `.tsx` 는 transform 밖) · `web/almondyoung-storefront` = **Vitest**(`*.test.ts`)

**Spec:** 이슈 [#488](https://github.com/LCNINE/almondyoung-server/issues/488) — 「2026-08-31 개통 전 결정」의 **A4 절**(이 절이 본문 `A4` 항목보다 우선한다) · 「✅ P10-A 실행 완료」 절 · `N9`(재조사 금지 목록) · 로드맵 `docs/superpowers/plans/2026-08-29-coupon-domain-master-plan.md` P10-B 항목 · 선행 플랜 `docs/superpowers/plans/2026-08-31-coupon-write-path-to-hooks.md` · 경계 `docs/adr/0033-coupons-are-owned-by-the-sales-channel.md`

---

## 0. 이 플랜을 여는 실측 (2026-08-31)

> **여기 적힌 것은 전부 확인한 결과다. 재조사하지 말 것.**
> #488 이 「재조사 금지」로 못박은 것(`N9` · 캡 훅 자리 4곳 · 2.20-preview 까지 상한 필드 부재)은 이 절이 다시 적지 않는다. 아래는 **이번 세션이 새로 확인한 것**뿐이다.

| # | 질문 | 방법 | 결과 |
|---|---|---|---|
| ① | 스토어프론트는 쿠폰을 어느 API 로 붙이는가 | `web/almondyoung-storefront/src/lib/api/medusa/cart.ts:1044-1056` | **`sdk.store.cart.update(cartId, { promo_codes })` = `POST /store/carts/:id`.** `/promotions` 라우트를 **안 쓴다** → 훅 ①이 실사용 경로를 전부 덮는다 |
| ② | 「단일 seam」으로 `refreshPaymentCollectionForCartWorkflow.hooks.validate` 를 쓸 수 있나 | `core-flows/dist/cart/workflows/refresh-payment-collection.js:45-96` | **🔴 못 쓴다 — 함정이다.** `cart` 를 **훅보다 먼저** fetch 해서 그 `raw_total` 로 결제금액을 정한다. 거기서 캡하면 결제 컬렉션이 **캡 이전 금액**으로 잡힌다. #488 의 4곳 목록이 그대로 맞다 |
| ③ | 훅 ①의 시점이 실제로 adjustment 뒤인가 | `refresh-cart-items.js:161`(`updateCartPromotionsWorkflow`) vs `:179`(훅) vs `:180`(결제 갱신) | **맞다.** 그리고 `refreshPaymentCollectionForCartWorkflow` 는 `cart_id`/`cart.payment_collection` 이 있으면 **재조회**하므로(`:45-52`), 훅에서 고친 금액이 결제 컬렉션에 반영된다 |
| ④ | 훅 ②의 시점 | `create-carts.js:183`(프로모션) → `:190`(결제 갱신) → `:198`(`cartCreated`) | 프로모션 뒤다. 결제 갱신은 **새 카트에 payment_collection 이 없어 아무것도 안 한다**(`shouldExecute=false`) → 캡이 늦지 않다 |
| ⑤ | 두 훅이 비어 있는가 | `grep -rn "refreshCartItemsWorkflow\|createCartWorkflow" apps/medusa/src` | **비어 있다.** `createCartWorkflow.hooks.validate` 만 점유(`handle-validate-cart-items-inventory.ts:243`), `cartCreated` 와 `refreshCartItems` 훅 전부 미점유 |
| ⑥ | adjustment 에 프로모션 식별자가 있는가 | `@medusajs/types/dist/cart/common.d.ts:7-44` | 있다 — `AdjustmentLineDTO.promotion_id` · `code` · `amount`. **캡을 프로모션 단위로 묶을 수 있다** |
| ⑦ | 되쓰는 API | `@medusajs/types/dist/cart/service.d.ts:1814,1840` | `upsertLineItemAdjustments(data)` (`id`+`item_id` 필요) · `upsertShippingMethodAdjustments(data)`. **`set*` 는 쓰지 않는다** — 전량 교체 의미론이라 캡 대상 밖 adjustment 를 지운다 |
| ⑧ | 🔴 표시 자리는 **6곳이 아니라 8곳**이다 | `grep -rn "application_method\|discount\."` (스토어 API 3 · admin-web 2 · storefront 4) | #488 의 6곳 목록에 **`/store/coupons/preview`(claim 페이지)** 와 **`/store/events/:slug`(이벤트 페이지)** 가 빠져 있었다. 하필 **쿠폰을 받는 순간의 마케팅 화면**이라 캡 누락이 가장 오해를 부르는 자리다 |
| ⑨ | `web/**` 에 테스트 러너가 있는가 | `web/almondyoung-storefront/package.json` | **Vitest 가 있다**(`npm test` → `vitest run`, `src/**/*.test.ts` 30여 개). CI 게이트는 여전히 0개지만([[medusa-storefront-gate-topology]]) **로컬에서 검증 가능**하다 → 표시·정렬 판정을 `.ts` 로 뽑을 값어치가 있다 |
| ⑩ | admin-web 은 캡을 이미 읽고 있는가 | `features/mall/marketing/coupons/lib/coupon-meta.ts:56` | **읽는다** — `getCouponMeta().maxDiscountAmount`. 화면에 안 쓸 뿐이다. 배선을 새로 깔 필요 없다 |
| ⑪ | 쿠폰 **수정** 화면이 있는가 | `features/mall/marketing/coupons/components/` 전수 | **없다.** create·assign·detail·delete·customers 뿐이고 수정은 `updateStatus`(상태 토글) 하나다 → **캡은 생성 시에만 설정 가능**하고, 바꾸려면 삭제·재생성이다. 이 플랜은 그 상태를 바꾸지 않는다(아래 「이 플랜이 하지 않는 것」) |

---

## Global Constraints

- **마이그레이션 0건 · 시크릿 0건 · env 0건 · 이벤트 계약 0건.** `promotion_meta.max_discount_amount` 컬럼은 **이미 있다**(`models/promotion-meta.ts:14`, `Migration20260520164126`). 스키마를 손대지 않는다.
- **쓰기 배선을 새로 만들지 않는다.** P10-A 가 이미 깔았다 — `max_discount_amount` 는 `helpers.ts` 의 `META_KEYS` 와 `additional-data-schema.ts` 의 create/update 두 shape 에 **둘 다 들어 있고**(`z.number().int().positive().optional()`), 두 집합의 일치를 `__tests__/additional-data-schema.unit.spec.ts` 가 강제한다. 폼이 `additional_data.max_discount_amount` 를 보내면 `promotionsCreated` 훅이 그대로 `promotion_meta` 에 쓴다.
- **캡의 단위는 「한 카트 × 한 프로모션」이다.** 라인별이 아니다. 같은 프로모션이 만든 **라인아이템 + 배송수단 adjustment 를 모두 합쳐** 캡과 비교하고, 넘으면 비례 축소한다.
- **캡은 값이 있을 때만 건다.** `max_discount_amount` 가 `null` 이면 아무것도 하지 않는다. 정액 쿠폰에도 값이 있으면 걸리지만(무해·멱등), **폼은 정률일 때만 입력을 보낸다.**
- **워크플로 훅은 워크플로당 핸들러 1개.** 중복 등록하면 부팅이 죽는다. `src/workflows/hooks/__tests__/no-duplicate-validate-hooks.unit.spec.ts` 가 `src/workflows/hooks/**` 를 훑어 지킨다. → **백스톱은 새 훅이 아니라 기존 `complete-cart.ts` 핸들러 안에 함수를 더한다.**
- **`@packages/*` 를 `apps/medusa` 에서 import 하지 않는다.** 번들러가 없어 런타임에 해석되지 않는다. `web/almondyoung-storefront` 도 tsconfig `paths` 에 `@packages` 가 **없다**(확인함) → 세 트리는 각자 자기 헬퍼를 갖는다. 이 플랜은 새 공유 어휘를 만들지 않으므로 드리프트 가드에 새 사이트를 등록할 것이 없다.
- **표시 문구는 「기본 라벨 + 캡 접미사」 형태로만 바꾼다.** 「10%」 → 「10% (최대 30,000원)」. 기존 문구를 재작성하지 않는다.
- **배포:** 마이그레이션이 없으므로 순서 제약이 없다. 다만 **medusa 가 admin-web 보다 먼저(또는 같이) 라이브여야 캡 값이 저장된다** — P10-A 의 `additionalDataValidator` 가 아직 라이브가 아니면 프레임워크의 `z.object` **strip** 이 `max_discount_amount` 를 조용히 버린다(#488 P10-A 실측 ⑥). SST 한 스택에는 앱 간 배포 순서를 강제할 수단이 없으므로([[sst-single-stack-no-deploy-order]]) 이건 **규율이지 자동이 아니다.** 어긋나도 실패 모드는 「캡이 저장되지 않는다」이지 오류가 아니다.
- 주석·커밋 메시지는 **한국어**. 기존 파일 톤을 따른다.

### 검증 게이트 (2026-08-31 실측 기준선)

| 게이트 | 명령 | 기준선 |
|---|---|---|
| Medusa 유닛 | `cd apps/medusa && npm run test:unit` | **28 suites / 243 tests 전부 통과, 7.9s** |
| Medusa 타입 | `cd apps/medusa && npx tsc --noEmit` | **선재 에러 정확히 3건**(아래). 늘면 이 플랜이 만든 것 |
| 쿠폰 통합(HTTP, 실 DB) | `scripts/local/run-medusa-integration.sh --testPathPattern 'coupon-'` | **4 suites / 42 tests 전부 통과** |
| admin-web 유닛 | `npm run test:admin-web` | 통과 |
| admin-web 타입 | `cd apps/admin-web && npx tsc --noEmit` | 통과 — **루트 `npm run type-check` 는 admin-web 을 제외한다**([[admin-web-no-component-tests]]) |
| storefront 유닛 | `cd web/almondyoung-storefront && npm test` | 통과 |
| 루트 | `npm run type-check` | 0 |

선재 Medusa 타입 에러 3건 (이 플랜과 무관, 고치지 말 것):

```
src/admin/lib/sdk.ts(5,14): error TS1470: The 'import.meta' meta-property is not allowed …
src/admin/lib/sdk.ts(6,12): error TS1470: …
src/api/store/orders/[id]/__tests__/confirm-purchase.unit.spec.ts(11,41): error TS2307: Cannot find module '@workflows/…'
```

**🔴 통합 스펙 러너.** `medusaIntegrationTestRunner` 는 `DATABASE_URL` 을 읽지 않고 `DB_HOST`/`DB_USERNAME`/`DB_PASSWORD`/`DB_PORT` 를 읽는다. 그냥 `npm run test:integration:http` 를 부르면 전 스펙이 `SASL: client password must be a string` 로 죽는다. **반드시 `scripts/local/run-medusa-integration.sh` 를 쓸 것**(P10-A 가 커밋해 뒀다). CI 는 이 스펙을 돌리지 않는다 — 사람이 로컬에서 돌리는 것이 유일한 방어선이다.

**🔴 통합 스펙에서 `.rejects.toThrow()` 를 쓰지 말 것.** 워크플로 엔진을 거친 에러는 프로토타입을 잃어 `instanceof Error === false` 인 평범한 객체로 온다. jest 가 「Received function did not throw」라는 엉뚱한 메시지로 실패한다. `try/catch` + `expect(err.message).toContain(...)` 로 쓸 것.

---

## 이 값을 읽는 소비자 목록 (P1 교훈 — 필수 항목)

> P1 은 「누가 이 값을 읽는가」를 묻지 않아 Critical 을 냈다. 그래서 이 절이 File Structure 보다 **먼저** 온다. 근거는 전부 2026-08-31 `grep` 실측이다.
> **#488 은 표시 6곳이라고 적었으나 실제로는 8곳이다** — 실측 ⑧ 참조.

### (가) `max_discount_amount` 를 **쓰는** 곳

| 위치 | 상태 |
|---|---|
| `admin-web .../lib/build-create-promotion-payload.ts` | **없다 → Task 6 이 만든다** (`additional_data.max_discount_amount`) |
| `apps/medusa .../workflows/hooks/promotion/apply-promotion-meta.ts` | **이미 있다** — `META_KEYS` 를 통째로 옮기므로 코드 변경 0 |
| `apps/medusa .../api/admin/promotions/additional-data-schema.ts` | **이미 있다** — create/update 두 shape 모두 |

### (나) `max_discount_amount` 를 **읽어 계산에 쓰는** 곳 — 이 플랜이 만드는 전부

| 위치 | 언제 도는가 |
|---|---|
| `refreshCartItemsWorkflow.hooks.beforeRefreshingPaymentCollection` (Task 2) | 아이템 추가·수정·삭제 · 배송수단 변경 · `POST /store/carts/:id`(**스토어프론트 쿠폰 적용**) · `/store/customers/me/refresh-cart-prices` · `/admin/customers/:id/refresh-cart-prices` |
| `createCartWorkflow.hooks.cartCreated` (Task 2) | `POST /store/carts` 에 `promo_codes` 가 실렸을 때 |
| `POST\|DELETE /store/carts/:id/promotions` (Task 3) | 코어 라우트. 우리 스토어프론트는 안 쓰지만 열려 있다 |
| `completeCartWorkflow.hooks.validate` (Task 4) | 주문 확정 직전 **백스톱** — 고치지 않고 **막는다**(이유는 Task 4) |

### (다) 표시 — **8곳** (Task 5·7·8)

| # | 위치 | 오늘 보이는 것 | 트리 | 검증 |
|---|---|---|---|---|
| 1 | `apps/medusa .../store/customers/me/promotions/format-promotion.ts:79` | **명시적 allowlist — 캡이 계약에 없다.** 4·5 가 이걸 먼저 요구한다 | medusa | jest 유닛 |
| 2 | `apps/medusa .../store/coupons/preview/route.ts:86` | `discount{type,value,target_type,currency_code}` | medusa | 통합 |
| 3 | `apps/medusa .../store/events/[slug]/route.ts:116` | 같은 모양 | medusa | 통합 |
| 4 | `admin-web .../template/marketing-coupons-template.tsx:38` `formatDiscount` | `10%` | admin-web | **`.tsx` — 추출해야 검증됨** |
| 5 | `admin-web .../components/coupon-detail-dialog.tsx:60` `discountStr` | `10%` | admin-web | 동일 |
| 6 | `storefront .../mypage/template/coupon/coupon-card.tsx:52` | `10%` | web | **vitest 가능** |
| 7 | `storefront .../mypage/template/coupon/coupon-tabs.tsx:26-40` `sortItems` | 🔴 **진짜 버그** — 정률을 정액 위로 랭크하고 raw `value` 로 정렬해 「10% 최대 3천원」이 「5만원 정액」보다 위 | web | 동일 |
| 8 | `storefront .../checkout/components/sections/discount.tsx:156` `formatPromoLabel` | `10% 할인` | web | 동일 |
| 8b | `storefront .../coupons/claim/page.tsx:81` + `.../events/[slug]/page.tsx:53` | `10% 할인` — **#488 목록에 없던 두 곳** | web | 동일 |

**i18n 네임스페이스는 셋뿐이다**(확인함): `mypage.coupon`(6) · `checkout.discount`(8) · `couponClaim`(8b 두 페이지가 공유). 로케일은 `ko`·`ja`·`en` 셋 → **키 3개 × 3 로케일 = 9 항목**.

---

## File Structure

**생성**

| 파일 | 책임 |
|---|---|
| `apps/medusa/src/workflows/hooks/cart/promotion-cap.ts` | **순수.** 캡 배분 계획(`planPromotionCap`)과 위반 탐지(`findCapViolations`). 컨테이너도 워크플로도 모른다 |
| `apps/medusa/src/workflows/hooks/cart/__tests__/promotion-cap.unit.spec.ts` | 위 순수 함수의 유닛 |
| `apps/medusa/src/workflows/hooks/cart/enforce-promotion-cap.ts` | **I/O.** 카트 읽기 → 캡 맵 조립 → 순수 함수 호출 → adjustment 되쓰기. `enforcePromotionCap` · `findPromotionCapViolations` |
| `apps/medusa/src/workflows/hooks/cart/promotion-cap-hooks.ts` | 훅 등록부(전역 부수효과)만. 두 줄 |
| `apps/medusa/src/api/store/carts/[id]/promotions/route.ts` | 코어 라우트 자리에 우리 `POST`/`DELETE`. 코어와 같은 워크플로 + 캡 + 결제 갱신 |
| `apps/medusa/integration-tests/http/coupon-cap.spec.ts` | 실 DB HTTP — 캡이 실제로 걸리는지 |
| `apps/admin-web/src/features/mall/marketing/coupons/lib/format-discount-label.ts` | 어드민 할인 라벨 조립(순수, 한국어 리터럴) |
| `apps/admin-web/.../lib/format-discount-label.spec.ts` | 위의 jest 유닛 |
| `web/almondyoung-storefront/src/lib/utils/coupon-discount.ts` | 스토어프론트 공용 — 캡 표기 여부·정렬 키(순수, i18n 무관) |
| `web/almondyoung-storefront/src/lib/utils/coupon-discount.test.ts` | 위의 vitest 유닛 |

**수정**

| 파일 | 무엇을 |
|---|---|
| `apps/medusa/src/workflows/hooks/cart/complete-cart.ts` | 기존 `validate` 핸들러 **안에** 백스톱 한 블록 추가 |
| `apps/medusa/src/api/store/customers/me/promotions/format-promotion.ts` (+ `__tests__`) | `FormattedPromotion.max_discount_amount` 추가, 3번째 인자를 `meta` 객체로 |
| `apps/medusa/src/api/store/customers/me/promotions/route.ts` | 캡 맵 추가 + `format` 호출부 |
| `apps/medusa/src/api/store/coupons/preview/route.ts` | `discount.max_discount_amount` |
| `apps/medusa/src/api/store/events/[slug]/route.ts` | `discount.max_discount_amount` |
| `apps/admin-web/.../lib/build-create-promotion-payload.ts` (+ `.spec.ts`) | `CouponFormState.maxDiscountAmount` → `additional_data` |
| `apps/admin-web/.../components/coupon-create-dialog.tsx` | 입력란(정률일 때만) |
| `apps/admin-web/.../template/marketing-coupons-template.tsx` · `components/coupon-detail-dialog.tsx` | 라벨을 새 헬퍼로 |
| `web/almondyoung-storefront/src/lib/types/dto/promotion.ts` · `lib/api/medusa/store.ts` | 타입에 `max_discount_amount` |
| `web/.../coupon-card.tsx` · `coupon-tabs.tsx` · `checkout/.../discount.tsx` · `coupons/claim/page.tsx` · `events/[slug]/page.tsx` | 라벨·정렬 |
| `web/.../i18n/messages/{ko,ja,en}/{mypage,checkout,couponClaim}.json` | 캡 접미사 키 |

---

## Task 1: 캡 배분 순수 함수

**Files:**
- Create: `apps/medusa/src/workflows/hooks/cart/promotion-cap.ts`
- Test: `apps/medusa/src/workflows/hooks/cart/__tests__/promotion-cap.unit.spec.ts`

**Interfaces:**
- Consumes: 없음 (이 플랜의 첫 태스크)
- Produces:
  - `type CappableAdjustment = { id: string; promotion_id?: string | null; amount: number }`
  - `type CapWriteback = { id: string; amount: number }`
  - `type CapViolation = { promotion_id: string; total: number; cap: number }`
  - `planPromotionCap(adjustments: readonly CappableAdjustment[], capByPromotionId: ReadonlyMap<string, number>): CapWriteback[]`
  - `findCapViolations(adjustments: readonly CappableAdjustment[], capByPromotionId: ReadonlyMap<string, number>): CapViolation[]`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`apps/medusa/src/workflows/hooks/cart/__tests__/promotion-cap.unit.spec.ts`:

```ts
import { findCapViolations, planPromotionCap } from '../promotion-cap';

const caps = (entries: Array<[string, number]>) => new Map<string, number>(entries);

describe('planPromotionCap — 캡을 넘는 만큼만 줄인다', () => {
  it('캡이 없는 프로모션은 손대지 않는다', () => {
    const plan = planPromotionCap(
      [{ id: 'adj_1', promotion_id: 'promo_1', amount: 99999 }],
      caps([]),
    );
    expect(plan).toEqual([]);
  });

  it('합이 캡 이하면 손대지 않는다 (멱등)', () => {
    const plan = planPromotionCap(
      [
        { id: 'adj_1', promotion_id: 'promo_1', amount: 2000 },
        { id: 'adj_2', promotion_id: 'promo_1', amount: 1000 },
      ],
      caps([['promo_1', 3000]]),
    );
    expect(plan).toEqual([]);
  });

  it('단일 라인이 캡을 넘으면 캡으로 깎는다', () => {
    const plan = planPromotionCap(
      [{ id: 'adj_1', promotion_id: 'promo_1', amount: 50000 }],
      caps([['promo_1', 30000]]),
    );
    expect(plan).toEqual([{ id: 'adj_1', amount: 30000 }]);
  });

  it('여러 라인은 비례 배분하고, 합은 정확히 캡이다', () => {
    const plan = planPromotionCap(
      [
        { id: 'adj_a', promotion_id: 'promo_1', amount: 3333 },
        { id: 'adj_b', promotion_id: 'promo_1', amount: 3333 },
        { id: 'adj_c', promotion_id: 'promo_1', amount: 3334 },
      ],
      caps([['promo_1', 5000]]),
    );
    expect(plan.reduce((sum, p) => sum + p.amount, 0)).toBe(5000);
    // 버려진 소수부(.5, .5, .0)가 큰 순으로 1원을 되돌린다. 동률은 id 오름차순.
    expect([...plan].sort((x, y) => (x.id < y.id ? -1 : 1))).toEqual([
      { id: 'adj_a', amount: 1667 },
      { id: 'adj_b', amount: 1666 },
      { id: 'adj_c', amount: 1667 },
    ]);
  });

  it('라인아이템과 배송수단 adjustment 를 한 프로모션으로 묶어 캡한다', () => {
    const plan = planPromotionCap(
      [
        { id: 'li_1', promotion_id: 'promo_1', amount: 8000 },
        { id: 'sm_1', promotion_id: 'promo_1', amount: 2000 },
      ],
      caps([['promo_1', 5000]]),
    );
    expect(plan.reduce((sum, p) => sum + p.amount, 0)).toBe(5000);
    expect(plan).toEqual(
      expect.arrayContaining([
        { id: 'li_1', amount: 4000 },
        { id: 'sm_1', amount: 1000 },
      ]),
    );
  });

  it('프로모션이 여럿이면 각자의 캡을 독립적으로 적용한다', () => {
    const plan = planPromotionCap(
      [
        { id: 'adj_1', promotion_id: 'promo_1', amount: 50000 },
        { id: 'adj_2', promotion_id: 'promo_2', amount: 1000 },
      ],
      caps([
        ['promo_1', 30000],
        ['promo_2', 30000],
      ]),
    );
    expect(plan).toEqual([{ id: 'adj_1', amount: 30000 }]);
  });

  it('promotion_id 가 없는 adjustment 는 무시한다', () => {
    const plan = planPromotionCap(
      [
        { id: 'adj_1', promotion_id: null, amount: 50000 },
        { id: 'adj_2', amount: 50000 },
      ],
      caps([['promo_1', 100]]),
    );
    expect(plan).toEqual([]);
  });

  it('캡 0 은 「할인 없음」이다 — 무시하지 않는다', () => {
    const plan = planPromotionCap(
      [{ id: 'adj_1', promotion_id: 'promo_1', amount: 50000 }],
      caps([['promo_1', 0]]),
    );
    expect(plan).toEqual([{ id: 'adj_1', amount: 0 }]);
  });

  it('합이 0 이면 나눗셈을 하지 않는다', () => {
    const plan = planPromotionCap(
      [{ id: 'adj_1', promotion_id: 'promo_1', amount: 0 }],
      caps([['promo_1', 0]]),
    );
    expect(plan).toEqual([]);
  });
});

describe('findCapViolations — 백스톱이 묻는 질문', () => {
  it('캡 이하면 위반이 없다', () => {
    expect(
      findCapViolations(
        [{ id: 'adj_1', promotion_id: 'promo_1', amount: 3000 }],
        caps([['promo_1', 3000]]),
      ),
    ).toEqual([]);
  });

  it('캡을 넘으면 프로모션·합·캡을 돌려준다', () => {
    expect(
      findCapViolations(
        [
          { id: 'adj_1', promotion_id: 'promo_1', amount: 3000 },
          { id: 'adj_2', promotion_id: 'promo_1', amount: 1 },
        ],
        caps([['promo_1', 3000]]),
      ),
    ).toEqual([{ promotion_id: 'promo_1', total: 3001, cap: 3000 }]);
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

```bash
cd apps/medusa && npx jest src/workflows/hooks/cart/__tests__/promotion-cap.unit.spec.ts
```

Expected: FAIL — `Cannot find module '../promotion-cap'`

- [ ] **Step 3: 최소 구현**

`apps/medusa/src/workflows/hooks/cart/promotion-cap.ts`:

```ts
/**
 * 정률 쿠폰 최대 할인금액(`promotion_meta.max_discount_amount`)의 **순수 로직** (#488 A4 / P10-B).
 *
 * Medusa 프로모션 엔진은 금액 상한 개념이 없다(2.13.4 · 2.19.0 · 2.20-preview 전부 확인).
 * 그래서 엔진이 만든 adjustment 를 **뒤에서 깎는다.** 이 파일은 「얼마로 깎을지」만 정하고
 * 어디서 읽고 어디에 쓰는지는 모른다 — 컨테이너를 아는 순간 유닛이 안 닿는다(#488 P1 교훈).
 *
 * 캡의 단위는 **「한 카트 × 한 프로모션」**이다. 라인별이 아니다. 같은 `promotion_id` 가 만든
 * 라인아이템·배송수단 adjustment 를 전부 합쳐 캡과 비교한다.
 */

export interface CappableAdjustment {
  id: string;
  promotion_id?: string | null;
  amount: number;
}

/** 되써야 하는 adjustment 만. 안 바뀌는 것은 담기지 않는다. */
export interface CapWriteback {
  id: string;
  amount: number;
}

/** 백스톱이 보는 것 — 「이 프로모션이 캡보다 얼마나 더 깎고 있는가」. */
export interface CapViolation {
  promotion_id: string;
  total: number;
  cap: number;
}

/** 캡이 걸린 프로모션별로 adjustment 를 모은다. 캡 밖·음수·0 은 애초에 안 담는다. */
function groupCapped(
  adjustments: readonly CappableAdjustment[],
  capByPromotionId: ReadonlyMap<string, number>,
): Map<string, CappableAdjustment[]> {
  const grouped = new Map<string, CappableAdjustment[]>();
  for (const adjustment of adjustments) {
    const promotionId = adjustment.promotion_id;
    if (!promotionId) continue;
    const cap = capByPromotionId.get(promotionId);
    if (cap == null || !Number.isFinite(cap) || cap < 0) continue;
    if (!Number.isFinite(adjustment.amount) || adjustment.amount <= 0) continue;
    grouped.set(promotionId, [...(grouped.get(promotionId) ?? []), adjustment]);
  }
  return grouped;
}

function sumAmount(adjustments: readonly CappableAdjustment[]): number {
  return adjustments.reduce((sum, adjustment) => sum + adjustment.amount, 0);
}

/**
 * 캡을 넘는 프로모션의 adjustment 를 **합이 정확히 캡이 되도록** 비례 축소한다.
 *
 * 원 단위(정수)로 내림한 뒤 남는 잔돈을 **버려진 소수부가 큰 순**으로 1원씩 되돌린다.
 * 동률은 금액 큰 순 → `id` 오름차순으로 깨서 **같은 입력이 항상 같은 출력**을 내게 한다
 * (카트 재계산이 잦아 결정성이 없으면 금액이 미세하게 진동한다).
 */
export function planPromotionCap(
  adjustments: readonly CappableAdjustment[],
  capByPromotionId: ReadonlyMap<string, number>,
): CapWriteback[] {
  const writebacks: CapWriteback[] = [];

  for (const [promotionId, group] of groupCapped(adjustments, capByPromotionId)) {
    const cap = capByPromotionId.get(promotionId) as number;
    const total = sumAmount(group);
    if (total <= 0 || total <= cap) continue;

    const shares = group.map((adjustment) => {
      const exact = (adjustment.amount * cap) / total;
      const floored = Math.floor(exact);
      return { adjustment, floored, fraction: exact - floored };
    });

    shares.sort(
      (a, b) =>
        b.fraction - a.fraction ||
        b.adjustment.amount - a.adjustment.amount ||
        (a.adjustment.id < b.adjustment.id ? -1 : 1),
    );

    let remainder = cap - shares.reduce((sum, share) => sum + share.floored, 0);
    for (const share of shares) {
      const bonus = remainder > 0 ? 1 : 0;
      remainder -= bonus;
      const next = share.floored + bonus;
      if (next !== share.adjustment.amount) {
        writebacks.push({ id: share.adjustment.id, amount: next });
      }
    }
  }

  return writebacks;
}

/**
 * 캡이 지켜지고 있는지 본다. **고치지 않는다** — 주문 확정 백스톱이 쓴다(Task 4 참조).
 */
export function findCapViolations(
  adjustments: readonly CappableAdjustment[],
  capByPromotionId: ReadonlyMap<string, number>,
): CapViolation[] {
  const violations: CapViolation[] = [];
  for (const [promotionId, group] of groupCapped(adjustments, capByPromotionId)) {
    const cap = capByPromotionId.get(promotionId) as number;
    const total = sumAmount(group);
    if (total > cap) violations.push({ promotion_id: promotionId, total, cap });
  }
  return violations;
}
```

- [ ] **Step 4: 테스트가 통과하는지 확인한다**

```bash
cd apps/medusa && npx jest src/workflows/hooks/cart/__tests__/promotion-cap.unit.spec.ts
```

Expected: PASS (11 tests)

- [ ] **Step 5: 커밋**

```bash
git add apps/medusa/src/workflows/hooks/cart/promotion-cap.ts apps/medusa/src/workflows/hooks/cart/__tests__/promotion-cap.unit.spec.ts
git commit -m "feat(medusa): 정률 쿠폰 캡 배분 순수 함수 (#488 A4 · P10-B)"
```

---

## Task 2: 캡 적용 I/O + 훅 2개 등록

**Files:**
- Create: `apps/medusa/src/workflows/hooks/cart/enforce-promotion-cap.ts`
- Create: `apps/medusa/src/workflows/hooks/cart/promotion-cap-hooks.ts`
- Create: `apps/medusa/integration-tests/http/coupon-cap.spec.ts`

**Interfaces:**
- Consumes: Task 1 의 `planPromotionCap` · `findCapViolations` · `CappableAdjustment` · `CapViolation`
- Produces:
  - `enforcePromotionCap(container: any, cartId: string): Promise<void>` — 캡을 실제로 적용
  - `findPromotionCapViolations(container: any, cartId: string): Promise<CapViolation[]>` — Task 4 백스톱이 쓴다

- [ ] **Step 1: 실패하는 통합 테스트를 쓴다**

`apps/medusa/integration-tests/http/coupon-cap.spec.ts`:

```ts
import { medusaIntegrationTestRunner } from '@medusajs/test-utils';
import { Modules, ContainerRegistrationKeys } from '@medusajs/framework/utils';
import jwt from 'jsonwebtoken';
import {
  createRegionsWorkflow,
  createSalesChannelsWorkflow,
  createProductsWorkflow,
  createApiKeysWorkflow,
  linkSalesChannelsToApiKeyWorkflow,
} from '@medusajs/core-flows';

jest.setTimeout(180 * 1000);

/**
 * #488 A4 / P10-B — 정률 쿠폰 최대 할인금액이 **실제로 강제되는가**.
 *
 * 엔진에는 상한 개념이 없으므로 이 스펙이 빨개지면 「캡이 안 걸린다」가 아니라
 * 「캡을 거는 자리가 사라졌다」는 뜻이다(Medusa 업그레이드가 재계산 경로를 옮겼을 때).
 */
medusaIntegrationTestRunner({
  inApp: true,
  env: {},
  disableAutoTeardown: true,
  testSuite: ({ api, getContainer }) => {
    let adminHeaders: { headers: Record<string, string> };
    let storeHeaders: { headers: Record<string, string> };
    let regionId: string;
    let salesChannelId: string;
    let variantId: string;
    let seq = 0;

    beforeAll(async () => {
      const container = getContainer();
      const config = container.resolve(ContainerRegistrationKeys.CONFIG_MODULE) as any;
      const secret = config.projectConfig.http.jwtSecret;
      const userModule = container.resolve(Modules.USER);
      const [user] = await userModule.createUsers([{ email: 'admin@cap.test' }]);
      adminHeaders = {
        headers: {
          authorization: `Bearer ${jwt.sign(
            { actor_id: user.id, actor_type: 'user', auth_identity_id: 'a', app_metadata: { user_id: user.id } },
            secret,
          )}`,
        },
      };

      const { result: scRes } = await createSalesChannelsWorkflow(container).run({
        input: { salesChannelsData: [{ name: 'Cap SC' }] },
      });
      salesChannelId = scRes[0].id;

      const { result: regionRes } = await createRegionsWorkflow(container).run({
        input: { regions: [{ name: 'KR', currency_code: 'krw', countries: ['kr'] }] },
      });
      regionId = regionRes[0].id;

      const fulfillment = container.resolve(Modules.FULFILLMENT);
      const profiles = await fulfillment.listShippingProfiles({});
      const shippingProfileId =
        profiles[0]?.id ??
        (await fulfillment.createShippingProfiles([{ name: 'default', type: 'default' }]))[0].id;

      const { result: prodRes } = await createProductsWorkflow(container).run({
        input: {
          products: [
            {
              title: 'Cap Product',
              status: 'published',
              shipping_profile_id: shippingProfileId,
              sales_channels: [{ id: salesChannelId }],
              options: [{ title: 'Size', values: ['M'] }],
              variants: [
                {
                  title: 'M',
                  sku: 'CAP-M',
                  manage_inventory: false,
                  options: { Size: 'M' },
                  prices: [{ amount: 10000, currency_code: 'krw' }],
                },
              ],
            },
          ],
        },
      });
      variantId = prodRes[0].variants[0].id;

      const { result: keyRes } = await createApiKeysWorkflow(container).run({
        input: { api_keys: [{ title: 'pk-cap', type: 'publishable', created_by: user.id }] },
      });
      await linkSalesChannelsToApiKeyWorkflow(container).run({
        input: { id: keyRes[0].id, add: [salesChannelId] },
      });
      storeHeaders = { headers: { 'x-publishable-api-key': keyRes[0].token } };
    });

    /** 정률 쿠폰 + 캡. `additional_data.max_discount_amount` 는 P10-A 배선을 그대로 탄다. */
    const createCappedPromo = async (code: string, percent: number, cap: number | null) => {
      const res = await api.post(
        '/admin/promotions',
        {
          code,
          type: 'standard',
          is_automatic: false,
          status: 'active',
          application_method: { type: 'percentage', value: percent, target_type: 'order', currency_code: 'krw' },
          additional_data: {
            visibility: 'public',
            ...(cap != null ? { max_discount_amount: cap } : {}),
          },
        },
        adminHeaders,
      );
      return res.data.promotion.id as string;
    };

    const newCart = async (quantity: number, promoCodes?: string[]) => {
      const res = await api.post(
        '/store/carts',
        {
          region_id: regionId,
          sales_channel_id: salesChannelId,
          items: [{ variant_id: variantId, quantity }],
          ...(promoCodes ? { promo_codes: promoCodes } : {}),
        },
        storeHeaders,
      );
      return res.data.cart;
    };

    it('캡이 저장된다 (P10-A 쓰기 배선 확인)', async () => {
      seq++;
      const promotionId = await createCappedPromo(`CAP_SAVE_${seq}`, 10, 3000);
      const metaService = getContainer().resolve('promotion_meta') as any;
      const meta = await metaService.getByPromotionId(promotionId);
      expect(Number(meta.max_discount_amount)).toBe(3000);
    });

    it('캡 미만이면 할인이 그대로다', async () => {
      seq++;
      await createCappedPromo(`CAP_UNDER_${seq}`, 10, 3000);
      // 10,000원 × 1개 → 10% = 1,000원. 캡 3,000원 미만.
      const cart = await newCart(1);
      const res = await api.post(
        `/store/carts/${cart.id}`,
        { promo_codes: [`CAP_UNDER_${seq}`] },
        storeHeaders,
      );
      expect(res.data.cart.discount_total).toBe(1000);
    });

    it('캡을 넘으면 할인이 정확히 캡이다 (POST /store/carts/:id — 스토어프론트 경로)', async () => {
      seq++;
      await createCappedPromo(`CAP_OVER_${seq}`, 50, 3000);
      // 10,000원 × 5개 = 50,000원 → 50% = 25,000원. 캡 3,000원.
      const cart = await newCart(5);
      const res = await api.post(
        `/store/carts/${cart.id}`,
        { promo_codes: [`CAP_OVER_${seq}`] },
        storeHeaders,
      );
      expect(res.data.cart.discount_total).toBe(3000);
    });

    it('캡이 없는 정률 쿠폰은 깎이지 않는다 (음성 대조)', async () => {
      seq++;
      await createCappedPromo(`CAP_NONE_${seq}`, 50, null);
      const cart = await newCart(5);
      const res = await api.post(
        `/store/carts/${cart.id}`,
        { promo_codes: [`CAP_NONE_${seq}`] },
        storeHeaders,
      );
      expect(res.data.cart.discount_total).toBe(25000);
    });

    it('카트 생성 시 promo_codes 로 붙여도 캡이 걸린다 (createCartWorkflow.cartCreated)', async () => {
      seq++;
      await createCappedPromo(`CAP_CREATE_${seq}`, 50, 3000);
      const cart = await newCart(5, [`CAP_CREATE_${seq}`]);
      const res = await api.get(`/store/carts/${cart.id}`, storeHeaders);
      expect(res.data.cart.discount_total).toBe(3000);
    });

    it('캡 적용 뒤 카트를 또 건드려도 금액이 진동하지 않는다 (멱등)', async () => {
      seq++;
      await createCappedPromo(`CAP_IDEM_${seq}`, 50, 3000);
      const cart = await newCart(5);
      await api.post(`/store/carts/${cart.id}`, { promo_codes: [`CAP_IDEM_${seq}`] }, storeHeaders);
      const again = await api.post(`/store/carts/${cart.id}`, { email: 'idem@cap.test' }, storeHeaders);
      expect(again.data.cart.discount_total).toBe(3000);
    });
  },
});
```

- [ ] **Step 2: 실패를 확인한다**

```bash
scripts/local/run-medusa-integration.sh --testPathPattern 'coupon-cap'
```

Expected: 「캡이 저장된다」는 PASS(P10-A 배선), 「캡을 넘으면…」·「카트 생성 시…」·「멱등」은 **FAIL** — `discount_total` 이 25000 으로 나온다.

- [ ] **Step 3: I/O 층을 구현한다**

`apps/medusa/src/workflows/hooks/cart/enforce-promotion-cap.ts`:

```ts
import { ContainerRegistrationKeys, Modules } from '@medusajs/framework/utils';
import { PROMOTION_META_MODULE } from '../../../modules/promotion-meta';
import {
  findCapViolations,
  planPromotionCap,
  type CapViolation,
  type CappableAdjustment,
} from './promotion-cap';

/**
 * 캡 계산에 필요한 최소 필드. 카트 전체를 끌어오면 재계산마다 비용이 붙는다.
 */
const CART_CAP_FIELDS = [
  'id',
  'promotions.id',
  'items.id',
  'items.adjustments.id',
  'items.adjustments.amount',
  'items.adjustments.promotion_id',
  'shipping_methods.id',
  'shipping_methods.adjustments.id',
  'shipping_methods.adjustments.amount',
  'shipping_methods.adjustments.promotion_id',
];

type LineAdjustment = CappableAdjustment & { item_id: string };
type ShippingAdjustment = CappableAdjustment & { shipping_method_id: string };

interface CapState {
  lineAdjustments: LineAdjustment[];
  shippingAdjustments: ShippingAdjustment[];
  capByPromotionId: Map<string, number>;
}

/**
 * 카트의 adjustment 와 「캡이 걸린 프로모션」 목록을 읽는다.
 *
 * 캡이 하나도 없으면 `null` — 호출부가 곧바로 빠져나가 재계산 비용을 0 으로 만든다.
 * 쿠폰 없는 카트가 절대다수이므로 이 조기 반환이 이 기능의 실질 비용이다.
 */
async function readCapState(container: any, cartId: string): Promise<CapState | null> {
  if (!cartId) return null;

  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const { data: carts } = await query.graph({
    entity: 'cart',
    fields: CART_CAP_FIELDS,
    filters: { id: cartId },
  });

  const cart: any = carts?.[0];
  if (!cart) return null;

  const promotionIds: string[] = (cart.promotions ?? [])
    .map((promotion: any) => promotion?.id)
    .filter(Boolean);
  if (!promotionIds.length) return null;

  const metaService: any = container.resolve(PROMOTION_META_MODULE);
  const metas: any[] = await metaService.getByPromotionIds([...new Set(promotionIds)]);

  const capByPromotionId = new Map<string, number>();
  for (const meta of metas ?? []) {
    const cap = Number(meta?.max_discount_amount);
    if (meta?.max_discount_amount != null && Number.isFinite(cap)) {
      capByPromotionId.set(meta.promotion_id, cap);
    }
  }
  if (!capByPromotionId.size) return null;

  const lineAdjustments: LineAdjustment[] = [];
  for (const item of cart.items ?? []) {
    for (const adjustment of item?.adjustments ?? []) {
      lineAdjustments.push({
        id: adjustment.id,
        promotion_id: adjustment.promotion_id,
        amount: Number(adjustment.amount),
        item_id: item.id,
      });
    }
  }

  const shippingAdjustments: ShippingAdjustment[] = [];
  for (const shippingMethod of cart.shipping_methods ?? []) {
    for (const adjustment of shippingMethod?.adjustments ?? []) {
      shippingAdjustments.push({
        id: adjustment.id,
        promotion_id: adjustment.promotion_id,
        amount: Number(adjustment.amount),
        shipping_method_id: shippingMethod.id,
      });
    }
  }

  return { lineAdjustments, shippingAdjustments, capByPromotionId };
}

/**
 * 캡을 넘는 할인을 **깎아서 되쓴다** (#488 A4).
 *
 * 엔진이 adjustment 를 만든 **뒤**에 불려야 한다. 프로모션이 다시 계산될 때마다 adjustment 도
 * 새로 만들어지므로(`updateCartPromotionsWorkflow` 가 REPLACE 다) 이 함수는 매번 **캡 이전
 * 금액**을 보고, 두 번 깎이는 일이 없다.
 *
 * `set*Adjustments` 가 아니라 `upsert*Adjustments` 를 쓰는 것은 의도다 — `set` 은 전량 교체
 * 의미론이라 캡 대상이 아닌 adjustment(다른 프로모션·프로바이더)가 사라진다.
 */
export async function enforcePromotionCap(container: any, cartId: string): Promise<void> {
  const state = await readCapState(container, cartId);
  if (!state) return;

  const plan = planPromotionCap(
    [...state.lineAdjustments, ...state.shippingAdjustments],
    state.capByPromotionId,
  );
  if (!plan.length) return;

  const nextAmountById = new Map(plan.map((entry) => [entry.id, entry.amount]));
  const cartModule: any = container.resolve(Modules.CART);

  const lineWrites = state.lineAdjustments
    .filter((adjustment) => nextAmountById.has(adjustment.id))
    .map((adjustment) => ({
      id: adjustment.id,
      item_id: adjustment.item_id,
      amount: nextAmountById.get(adjustment.id) as number,
    }));
  if (lineWrites.length) {
    await cartModule.upsertLineItemAdjustments(lineWrites);
  }

  const shippingWrites = state.shippingAdjustments
    .filter((adjustment) => nextAmountById.has(adjustment.id))
    .map((adjustment) => ({
      id: adjustment.id,
      shipping_method_id: adjustment.shipping_method_id,
      amount: nextAmountById.get(adjustment.id) as number,
    }));
  if (shippingWrites.length) {
    await cartModule.upsertShippingMethodAdjustments(shippingWrites);
  }
}

/**
 * 캡이 지켜지고 있는지만 본다. 고치지 않는다 — 주문 확정 백스톱이 쓴다.
 */
export async function findPromotionCapViolations(
  container: any,
  cartId: string,
): Promise<CapViolation[]> {
  const state = await readCapState(container, cartId);
  if (!state) return [];
  return findCapViolations(
    [...state.lineAdjustments, ...state.shippingAdjustments],
    state.capByPromotionId,
  );
}
```

- [ ] **Step 4: 훅 등록부를 만든다**

`apps/medusa/src/workflows/hooks/cart/promotion-cap-hooks.ts`:

```ts
import { createCartWorkflow, refreshCartItemsWorkflow } from '@medusajs/medusa/core-flows';
import { enforcePromotionCap } from './enforce-promotion-cap';

/**
 * 정률 쿠폰 캡을 **재계산 지점마다** 건다 (#488 A4 / P10-B).
 *
 * 등록은 전역 부수효과라 유닛이 닿지 않는다. 그래서 이 파일은 **배선만** 갖고 판정은
 * `promotion-cap.ts`(순수) · `enforce-promotion-cap.ts`(I/O) 가 갖는다.
 *
 * ⚠️ 훅은 워크플로당 핸들러 **하나**다. 여기 둘은 2026-08-31 기준 저장소 전체에서 미점유였다
 * (`createCartWorkflow.hooks.validate` 만 `handle-validate-cart-items-inventory.ts` 가 쓴다).
 * `__tests__/no-duplicate-validate-hooks.unit.spec.ts` 가 이걸 계속 지킨다.
 *
 * 여기 없는 경로가 둘 있다 — 이유가 다르다:
 *  - `POST|DELETE /store/carts/:id/promotions` 는 **훅이 없어** 라우트로 덮는다
 *    (`api/store/carts/[id]/promotions/route.ts`).
 *  - `refreshPaymentCollectionForCartWorkflow.hooks.validate` 는 **쓰면 안 된다.** 그 워크플로는
 *    카트를 훅보다 **먼저** fetch 해서 그 `raw_total` 로 결제금액을 정한다. 거기서 깎으면
 *    결제 컬렉션이 캡 이전 금액으로 잡힌다(2026-08-31 소스 확인).
 */
refreshCartItemsWorkflow.hooks.beforeRefreshingPaymentCollection(async ({ input }, { container }) => {
  await enforcePromotionCap(container, (input as any)?.cart_id);
});

createCartWorkflow.hooks.cartCreated(async ({ cart }, { container }) => {
  await enforcePromotionCap(container, (cart as any)?.id);
});
```

- [ ] **Step 5: 통합 테스트를 다시 돌린다**

```bash
scripts/local/run-medusa-integration.sh --testPathPattern 'coupon-cap'
```

Expected: 6 tests 전부 PASS

- [ ] **Step 6: 훅 중복 가드와 유닛 전체를 돌린다**

```bash
cd apps/medusa && npm run test:unit && npx tsc --noEmit
```

Expected: 29 suites / 254 tests PASS (Task 1 이 1 suite/11 tests 를 더했다) · tsc 는 선재 3건 그대로

- [ ] **Step 7: 커밋**

```bash
git add apps/medusa/src/workflows/hooks/cart/enforce-promotion-cap.ts \
        apps/medusa/src/workflows/hooks/cart/promotion-cap-hooks.ts \
        apps/medusa/integration-tests/http/coupon-cap.spec.ts
git commit -m "feat(medusa): 카트 재계산 훅에서 정률 쿠폰 캡을 강제한다 (#488 A4 · P10-B)"
```

---

## Task 3: `/store/carts/:id/promotions` 를 캡이 도는 경로로 만든다

> **왜 라우트인가.** 이 경로는 `updateCartPromotionsWorkflow` 를 직접 부르는데 그 워크플로의 훅은
> `validate` 하나뿐이고 **adjustment 계산 앞**에 있다. 뒤에 붙을 자리가 없다.
> **왜 다른 경로에 「복제」하지 않고 같은 경로에 두는가.** 다른 경로에 복제하면 원본이 열린 채로 남고,
> 그 원본을 부르는 클라이언트가 캡 없는 할인을 받는다. 우리 스토어프론트는 이 라우트를 **안 쓰므로**
> (실측 ①) 복제본을 만들어도 부르는 사람이 없다. 코어 zod 검증은 matcher 단위로 붙어 우리 핸들러에도
> 그대로 먹는다(P10-A 실측 ③). **읽기 override 가 아니라 쓰기 경로를 닫는 override 다.**

**Files:**
- Create: `apps/medusa/src/api/store/carts/[id]/promotions/route.ts`
- Modify: `apps/medusa/integration-tests/http/coupon-cap.spec.ts`

**Interfaces:**
- Consumes: Task 2 의 `enforcePromotionCap`
- Produces: 없음 (HTTP 표면)

- [ ] **Step 1: 실패하는 테스트를 더한다**

`coupon-cap.spec.ts` 의 마지막 `it` 뒤에 추가:

```ts
    it('POST /store/carts/:id/promotions 로 붙여도 캡이 걸린다 (코어 라우트 자리)', async () => {
      seq++;
      await createCappedPromo(`CAP_ROUTE_${seq}`, 50, 3000);
      const cart = await newCart(5);
      const res = await api.post(
        `/store/carts/${cart.id}/promotions`,
        { promo_codes: [`CAP_ROUTE_${seq}`] },
        storeHeaders,
      );
      expect(res.data.cart.discount_total).toBe(3000);
    });

    it('DELETE /store/carts/:id/promotions 는 쿠폰을 떼고 할인을 0 으로 돌린다', async () => {
      seq++;
      await createCappedPromo(`CAP_DEL_${seq}`, 50, 3000);
      const cart = await newCart(5);
      await api.post(
        `/store/carts/${cart.id}/promotions`,
        { promo_codes: [`CAP_DEL_${seq}`] },
        storeHeaders,
      );
      const res = await api.delete(
        `/store/carts/${cart.id}/promotions`,
        { ...storeHeaders, data: { promo_codes: [`CAP_DEL_${seq}`] } },
      );
      expect(res.data.cart.discount_total).toBe(0);
    });
```

- [ ] **Step 2: 실패를 확인한다**

```bash
scripts/local/run-medusa-integration.sh --testPathPattern 'coupon-cap'
```

Expected: 「POST /store/carts/:id/promotions …」 FAIL — `discount_total` 이 25000

- [ ] **Step 3: 라우트를 만든다**

`apps/medusa/src/api/store/carts/[id]/promotions/route.ts`:

```ts
import { MedusaRequest, MedusaResponse } from '@medusajs/framework/http';
import { PromotionActions } from '@medusajs/framework/utils';
import {
  refreshPaymentCollectionForCartWorkflow,
  updateCartPromotionsWorkflow,
} from '@medusajs/medusa/core-flows';
import { refetchCart } from '../../helpers';
import { defaultStoreCartFields } from '../../query-config';
import { enforcePromotionCap } from '../../../../../workflows/hooks/cart/enforce-promotion-cap';

/**
 * 코어 `POST|DELETE /store/carts/:id/promotions` 자리에 우리 핸들러를 둔다 (#488 A4 / P10-B).
 *
 * **왜.** 이 경로는 `updateCartPromotionsWorkflow` 를 직접 부르는데, 그 워크플로의 훅은
 * `validate` 하나뿐이고 **adjustment 가 만들어지기 전**이라 캡을 걸 자리가 없다.
 * 다른 경로에 «복제»하면 원본이 캡 없이 남는다 — 그건 돈이 걸린 통제에는 못 쓴다.
 *
 * **코어와 다른 점은 한 줄뿐이다.** 코어는 `force_refresh_payment_collection: true` 로 워크플로
 * 안에서 결제 컬렉션을 갱신한다. 우리는 그걸 `false` 로 두고 **캡을 건 뒤에** 직접 갱신한다.
 * 순서를 바꾸면 결제 컬렉션이 캡 이전 금액으로 잡힌다.
 *
 * ⚠️ 코어 zod 검증(`req.validatedBody`)은 matcher 단위로 붙어 이 핸들러에도 그대로 먹는다
 * (2026-08-31 P10-A 실측). `api/middlewares.ts` 의 `perCustomerLimitMiddleware` 도 그대로다.
 */
async function applyPromotions(
  req: MedusaRequest,
  res: MedusaResponse,
  action: (typeof PromotionActions)[keyof typeof PromotionActions],
) {
  const cartId = req.params.id;
  const payload = req.validatedBody as { promo_codes: string[] };

  await updateCartPromotionsWorkflow(req.scope).run({
    input: {
      cart_id: cartId,
      promo_codes: payload.promo_codes,
      action,
      force_refresh_payment_collection: false,
    },
  });

  await enforcePromotionCap(req.scope, cartId);

  await refreshPaymentCollectionForCartWorkflow(req.scope).run({
    input: { cart_id: cartId },
  });

  const fields = req.queryConfig?.fields?.length ? req.queryConfig.fields : defaultStoreCartFields;
  const cart = await refetchCart(cartId, req.scope, fields);
  return res.status(200).json({ cart });
}

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const payload = req.validatedBody as { promo_codes: string[] };
  return applyPromotions(
    req,
    res,
    payload.promo_codes.length > 0 ? PromotionActions.ADD : PromotionActions.REPLACE,
  );
}

export async function DELETE(req: MedusaRequest, res: MedusaResponse) {
  return applyPromotions(req, res, PromotionActions.REMOVE);
}
```

- [ ] **Step 4: 통합 테스트를 다시 돌린다 — 기존 쿠폰 스펙까지 함께**

```bash
scripts/local/run-medusa-integration.sh --testPathPattern 'coupon-'
```

Expected: 5 suites 전부 PASS. **`coupon-cart.spec.ts` 가 이 라우트를 쓰고 있으므로**(`applyAndGetDiscount`) 그 11개가 그대로 초록이어야 한다 — 하나라도 빨개지면 우리 핸들러가 코어와 달라진 것이다.

- [ ] **Step 5: 커밋**

```bash
git add apps/medusa/src/api/store/carts/\[id\]/promotions/route.ts apps/medusa/integration-tests/http/coupon-cap.spec.ts
git commit -m "feat(medusa): 카트 프로모션 라우트를 캡이 도는 경로로 만든다 (#488 A4 · P10-B)"
```

---

## Task 4: 주문 확정 백스톱

> **왜 고치지 않고 막는가.** 이 시점엔 결제 컬렉션 금액이 이미 잡혀 있다. 여기서 할인을 줄이면
> 주문 총액이 **올라가** 승인된 결제액과 어긋난다 — 「덜 받고 출고」가 된다. 정상 경로는 Task 2·3 이
> 전부 덮으므로 이 백스톱이 켜지는 것은 **비정상 상태**이고, 그때 옳은 답은 조정이 아니라 중단이다.
> #488 이 「최악은 『어떤 경로로는 쿠폰이 안 먹는다』이고 『돈이 나갔다』가 아니다」라고 적은 것이 이것이다.

**Files:**
- Modify: `apps/medusa/src/workflows/hooks/cart/complete-cart.ts`
- Modify: `apps/medusa/integration-tests/http/coupon-cap.spec.ts`

**Interfaces:**
- Consumes: Task 2 의 `findPromotionCapViolations`
- Produces: 없음

- [ ] **Step 1: 실패하는 테스트를 더한다**

`coupon-cap.spec.ts` 에 추가. **adjustment 를 직접 부풀려** 「캡이 안 걸린 카트」를 만든 뒤 완료를 시도한다 — 정상 경로로는 이 상태를 못 만들기 때문이다.

```ts
    it('백스톱: 캡을 넘은 카트는 주문이 만들어지지 않는다', async () => {
      seq++;
      await createCappedPromo(`CAP_BACKSTOP_${seq}`, 50, 3000);
      const cart = await newCart(5);
      await api.post(
        `/store/carts/${cart.id}`,
        { promo_codes: [`CAP_BACKSTOP_${seq}`], email: 'backstop@cap.test' },
        storeHeaders,
      );

      // 캡을 우회한 상태를 인위적으로 만든다 — adjustment 를 캡 이전 금액으로 되돌린다.
      const container = getContainer();
      const query = container.resolve(ContainerRegistrationKeys.QUERY);
      const { data: carts } = await query.graph({
        entity: 'cart',
        fields: ['id', 'items.id', 'items.adjustments.id'],
        filters: { id: cart.id },
      });
      const adjustmentId = (carts[0] as any).items[0].adjustments[0].id;
      const itemId = (carts[0] as any).items[0].id;
      const cartModule: any = container.resolve(Modules.CART);
      await cartModule.upsertLineItemAdjustments([
        { id: adjustmentId, item_id: itemId, amount: 25000 },
      ]);

      // 🔴 워크플로 엔진을 거친 에러는 Error 인스턴스가 아니다 — .rejects.toThrow() 를 쓰지 말 것.
      let message = '';
      try {
        await api.post(`/store/carts/${cart.id}/complete`, {}, storeHeaders);
      } catch (error: any) {
        message = error?.response?.data?.message ?? error?.message ?? '';
      }
      expect(message).toContain('쿠폰 할인 한도');
    });
```

- [ ] **Step 2: 실패를 확인한다**

```bash
scripts/local/run-medusa-integration.sh --testPathPattern 'coupon-cap'
```

Expected: FAIL — 주문이 만들어지거나 다른 메시지가 온다

- [ ] **Step 3: 기존 `validate` 핸들러 안에 백스톱을 더한다**

`apps/medusa/src/workflows/hooks/cart/complete-cart.ts` 의 import 에 추가:

```ts
import { findPromotionCapViolations } from './enforce-promotion-cap';
```

같은 파일에서 쿠폰 정책 재검증 블록(`if (cartPromos.length) { … }`)이 **끝난 직후**에 삽입:

```ts
  // 정률 쿠폰 최대 할인금액 백스톱 (#488 A4 / P10-B).
  //
  // 정상 경로(카트 생성·수정·프로모션 라우트)는 전부 캡을 걸고 지나간다. 여기가 켜진다는 것은
  // Medusa 업그레이드가 재계산 경로를 옮겼거나 누군가 adjustment 를 직접 건드렸다는 뜻이다.
  //
  // ⚠️ **여기서 고치지 않는다.** 이 시점엔 결제 컬렉션 금액이 이미 잡혀 있어, 할인을 줄이면
  // 주문 총액이 올라가 승인된 결제액과 어긋난다("덜 받고 출고"). 막는 쪽이 옳다 —
  // 최악이 "이 경로로는 쿠폰이 안 먹는다"가 되고 "돈이 나갔다"가 되지 않는다.
  const capViolations = await findPromotionCapViolations(container, cart.id);
  if (capViolations.length) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      '쿠폰 할인 한도가 초과되었습니다. 장바구니를 새로고침한 뒤 다시 시도해주세요.',
    );
  }
```

- [ ] **Step 4: 테스트를 다시 돌린다**

```bash
scripts/local/run-medusa-integration.sh --testPathPattern 'coupon-'
```

Expected: 5 suites 전부 PASS (coupon-cap 은 9 tests)

- [ ] **Step 5: 훅 중복 가드를 확인한다**

```bash
cd apps/medusa && npx jest src/workflows/hooks/__tests__/no-duplicate-validate-hooks.unit.spec.ts
```

Expected: PASS — 새 훅을 등록하지 않고 **기존 핸들러 안에** 넣었으므로

- [ ] **Step 6: 커밋**

```bash
git add apps/medusa/src/workflows/hooks/cart/complete-cart.ts apps/medusa/integration-tests/http/coupon-cap.spec.ts
git commit -m "feat(medusa): 주문 확정 직전 캡 백스톱을 더한다 (#488 A4 · P10-B)"
```

---

## Task 5: 스토어 읽기 계약 3곳에 캡을 싣는다

> 스토어프론트 표시(Task 8)가 **이것 없이는 불가능하다.** `format-promotion.ts` 는 명시적 allowlist 라
> 캡 필드가 계약에 없으면 값이 나가지 않는다.

**Files:**
- Modify: `apps/medusa/src/api/store/customers/me/promotions/format-promotion.ts`
- Modify: `apps/medusa/src/api/store/customers/me/promotions/__tests__/format-promotion.unit.spec.ts`
- Modify: `apps/medusa/src/api/store/customers/me/promotions/route.ts`
- Modify: `apps/medusa/src/api/store/coupons/preview/route.ts`
- Modify: `apps/medusa/src/api/store/events/[slug]/route.ts`

**Interfaces:**
- Consumes: 없음
- Produces:
  - `FormattedPromotion.max_discount_amount: number | null`
  - `formatPromotion(promo: PromotionLike, isAssigned: boolean, meta: { visibility: string; maxDiscountAmount: number | null }): FormattedPromotion` — **3번째 인자가 문자열에서 객체로 바뀐다**
  - `GET /store/coupons/preview` 의 `discount.max_discount_amount: number | null`
  - `GET /store/events/:slug` 의 `coupons[].discount.max_discount_amount: number | null`

- [ ] **Step 1: 실패하는 유닛 테스트를 더한다**

`apps/medusa/src/api/store/customers/me/promotions/__tests__/format-promotion.unit.spec.ts` 에 추가:

```ts
describe('최대 할인금액(#488 A4)', () => {
  const basePromo = {
    id: 'promo_1',
    code: 'TEN',
    type: 'standard',
    status: 'active',
    is_automatic: false,
    application_method: {
      id: 'am_1',
      type: 'percentage',
      value: 10,
      target_type: 'order',
      max_quantity: null,
      currency_code: 'krw',
    },
    campaign: null,
  };

  it('캡이 있으면 응답에 실린다', () => {
    const result = formatPromotion(basePromo as any, true, {
      visibility: 'public',
      maxDiscountAmount: 30000,
    });
    expect(result.max_discount_amount).toBe(30000);
  });

  it('캡이 없으면 null 이다 — 키를 빼지 않는다(클라가 optional 분기를 안 타게)', () => {
    const result = formatPromotion(basePromo as any, true, {
      visibility: 'public',
      maxDiscountAmount: null,
    });
    expect(result.max_discount_amount).toBeNull();
  });
});
```

기존 테스트의 `formatPromotion(promo, isAssigned, 'public')` 호출을 전부
`formatPromotion(promo, isAssigned, { visibility: 'public', maxDiscountAmount: null })` 로 바꾼다.

- [ ] **Step 2: 실패를 확인한다**

```bash
cd apps/medusa && npx jest src/api/store/customers/me/promotions
```

Expected: FAIL — 타입/런타임 모두 3번째 인자가 안 맞는다

- [ ] **Step 3: `format-promotion.ts` 를 고친다**

`FormattedPromotion` 에 필드를 더한다:

```ts
export type FormattedPromotion = {
  id: string;
  code: string;
  type: string;
  status: string;
  is_automatic: boolean;
  is_assigned: boolean;
  min_order_amount: number | null;
  /**
   * 정률 쿠폰 최대 할인금액 (#488 A4). `promotion_meta` 에서 온다 — 엔진에는 이 개념이 없다.
   * `visibility` 와 같은 이유로 **최상위**에 둔다: `application_method` 는 엔진 필드를 그대로
   * 옮기는 자리이고, 여기 우리 확장을 섞으면 「엔진이 준 것」과 「우리가 붙인 것」이 안 갈린다.
   */
  max_discount_amount: number | null;
  visibility: string;
  application_method: ApplicationMethodLike | null;
  campaign: CampaignLike | null;
};
```

`formatPromotion` 시그니처와 본문:

```ts
/** `promotion_meta` 에서 온 값들. 호출부가 프로모션마다 조회하지 않도록 묶어서 받는다. */
export type PromotionMetaView = {
  visibility: string;
  maxDiscountAmount: number | null;
};

export function formatPromotion(
  promo: PromotionLike,
  isAssigned: boolean,
  meta: PromotionMetaView,
): FormattedPromotion {
  return {
    id: promo.id,
    code: promo.code,
    type: promo.type,
    status: promo.status,
    is_automatic: promo.is_automatic,
    is_assigned: isAssigned,
    min_order_amount: minOrderAmount(promo),
    max_discount_amount: meta.maxDiscountAmount,
    visibility: meta.visibility,
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

- [ ] **Step 4: 호출부(라우트)를 고친다**

`apps/medusa/src/api/store/customers/me/promotions/route.ts` — `visibilityById` 아래에 캡 맵을 더하고 `format` 을 바꾼다:

```ts
  const visibilityById = new Map<string, string>(
    metas.map((m: any) => [m.promotion_id, resolveVisibility(m) as string])
  );
  // 정률 캡(#488 A4)도 같은 메타 조회에서 나온다 — 프로모션마다 재조회하지 않는다.
  const maxDiscountById = new Map<string, number>(
    metas
      .filter((m: any) => m.max_discount_amount != null && Number.isFinite(Number(m.max_discount_amount)))
      .map((m: any) => [m.promotion_id, Number(m.max_discount_amount)])
  );
  // 메타 행이 아예 없는 프로모션은 맵에 키가 없다 → 닫힌 기본값으로 떨어진다(#488 N7).
  const visibilityOf = (promotionId: string): string =>
    visibilityById.get(promotionId) ?? VISIBILITY_WHEN_META_MISSING;
  // visibility 는 promotion_meta 에서 온다. 호출부가 매번 조회하지 않도록 여기서 묶는다.
  const format = (promo: any, isAssigned: boolean) =>
    formatPromotion(promo, isAssigned, {
      visibility: visibilityOf(promo.id),
      maxDiscountAmount: maxDiscountById.get(promo.id) ?? null,
    });
```

`apps/medusa/src/api/store/coupons/preview/route.ts` — `baseInfo.discount` 에 한 줄:

```ts
    discount: promotion.application_method
      ? {
          type: promotion.application_method.type,
          value: promotion.application_method.value,
          target_type: promotion.application_method.target_type,
          currency_code: promotion.application_method.currency_code,
          // 정률 캡(#488 A4). 클레임 화면이 「10%」만 보여주면 캡을 모르는 채로 받게 된다.
          max_discount_amount: meta?.max_discount_amount != null ? Number(meta.max_discount_amount) : null,
        }
      : null,
```

`apps/medusa/src/api/store/events/[slug]/route.ts` — `coupons` 매퍼의 `discount` 에 한 줄:

```ts
        discount: am
          ? {
              type: am.type,
              value: am.value,
              target_type: am.target_type,
              currency_code: am.currency_code,
              // 정률 캡(#488 A4). 이벤트 페이지도 쿠폰을 받는 자리다.
              max_discount_amount: meta?.max_discount_amount != null ? Number(meta.max_discount_amount) : null,
            }
          : null,
```

- [ ] **Step 5: 유닛과 통합을 돌린다**

```bash
cd apps/medusa && npm run test:unit && npx tsc --noEmit
scripts/local/run-medusa-integration.sh --testPathPattern 'coupon-'
```

Expected: 유닛 전부 PASS · tsc 선재 3건 · 통합 5 suites PASS

- [ ] **Step 6: 커밋**

```bash
git add apps/medusa/src/api/store
git commit -m "feat(medusa): 스토어 쿠폰 응답에 최대 할인금액을 싣는다 (#488 A4 · P10-B)"
```

---

## Task 6: 어드민 생성 폼에 최대 할인금액 입력란

**Files:**
- Modify: `apps/admin-web/src/features/mall/marketing/coupons/lib/build-create-promotion-payload.ts`
- Modify: `apps/admin-web/src/features/mall/marketing/coupons/lib/build-create-promotion-payload.spec.ts`
- Modify: `apps/admin-web/src/features/mall/marketing/coupons/components/coupon-create-dialog.tsx`

**Interfaces:**
- Consumes: 없음
- Produces: `CouponFormState.maxDiscountAmount: number | ''`

- [ ] **Step 1: 실패하는 테스트를 더한다**

`build-create-promotion-payload.spec.ts` 에 추가 (기존 파일의 폼 픽스처 헬퍼 이름을 그대로 쓴다):

```ts
describe('최대 할인금액 (#488 A4)', () => {
  it('정률 쿠폰이면 additional_data 에 실린다', () => {
    const payload = buildCreatePromotionPayload(
      { ...baseForm, discountType: 'percentage', value: 10, maxDiscountAmount: 30000 },
      { campaignSuffix: 'X' },
    );
    expect(payload.additional_data).toMatchObject({ max_discount_amount: 30000 });
  });

  it('정액 쿠폰이면 싣지 않는다 — 정액에 상한은 무의미하다', () => {
    const payload = buildCreatePromotionPayload(
      { ...baseForm, discountType: 'fixed', value: 5000, maxDiscountAmount: 30000 },
      { campaignSuffix: 'X' },
    );
    expect(payload.additional_data).not.toHaveProperty('max_discount_amount');
  });

  it('비어 있으면 싣지 않는다', () => {
    const payload = buildCreatePromotionPayload(
      { ...baseForm, discountType: 'percentage', value: 10, maxDiscountAmount: '' },
      { campaignSuffix: 'X' },
    );
    expect(payload.additional_data).not.toHaveProperty('max_discount_amount');
  });
});
```

기존 스펙에 `baseForm` 같은 픽스처가 없으면 그 파일의 기존 폼 리터럴을 복사해 `baseForm` 상수를 파일 상단에 만들고, **새 필드 `maxDiscountAmount: ''` 를 거기 넣는다.**

- [ ] **Step 2: 실패를 확인한다**

```bash
npm run test:admin-web -- build-create-promotion-payload
```

Expected: FAIL — `maxDiscountAmount` 가 `CouponFormState` 에 없다(타입) / `additional_data` 에 키가 없다

- [ ] **Step 3: 폼 상태와 매퍼를 고친다**

`build-create-promotion-payload.ts` 의 `CouponFormState` 에 추가:

```ts
export interface CouponFormState {
  code: string;
  name: string;
  discountType: 'percentage' | 'fixed';
  value: number;
  /**
   * 정률 쿠폰 최대 할인금액 (#488 A4). 엔진에는 이 개념이 없어 `promotion_meta` 에 싣고
   * 카트 재계산 훅이 강제한다(`apps/medusa/src/workflows/hooks/cart/promotion-cap-hooks.ts`).
   */
  maxDiscountAmount: number | '';
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
  visibility: CouponVisibility;
  autoIssueTrigger: AutoIssueTrigger | '';
  createdBy?: string;
}
```

`additional_data` 조립부(`if (form.createdBy) …` 앞)에 추가:

```ts
  // 정률에만 싣는다 — 정액 쿠폰의 상한은 할인액 자신이라 의미가 없고,
  // 검증 스키마도 양수 정수만 받는다(`additional-data-schema.ts`).
  if (form.discountType === 'percentage' && form.maxDiscountAmount) {
    additional_data.max_discount_amount = Number(form.maxDiscountAmount);
  }
```

- [ ] **Step 4: 테스트가 통과하는지 확인한다**

```bash
npm run test:admin-web -- build-create-promotion-payload
```

Expected: PASS

- [ ] **Step 5: 다이얼로그에 입력란을 붙인다**

`coupon-create-dialog.tsx`:
1. 초기 폼 상태 객체에 `maxDiscountAmount: ''` 를 더한다(`value: 0` 근처).
2. 할인 값 입력 바로 아래에 정률일 때만 보이는 입력란을 넣는다. 기존 숫자 입력란의 마크업 관례를 그대로 따른다:

```tsx
{form.discountType === 'percentage' && (
  <div className="space-y-1.5">
    <Label htmlFor="maxDiscountAmount">최대 할인금액 (선택)</Label>
    <Input
      id="maxDiscountAmount"
      type="number"
      min={1}
      value={form.maxDiscountAmount}
      onChange={(e) =>
        setForm((prev) => ({
          ...prev,
          maxDiscountAmount: e.target.value === '' ? '' : Number(e.target.value),
        }))
      }
      placeholder="예: 30000"
    />
    <p className="text-xs text-muted-foreground">
      비워두면 상한 없음. 「10% 최대 3만원」처럼 정률 할인의 상한을 정합니다.
    </p>
  </div>
)}
```

> ⚠️ `setForm` · `Label` · `Input` 의 실제 이름은 이 파일이 이미 쓰는 것을 따른다. 상태 갱신 방식이
> `setForm((prev) => …)` 가 아니면 파일의 관례에 맞춘다.

- [ ] **Step 6: 게이트를 돌린다**

```bash
npm run test:admin-web
cd apps/admin-web && npx tsc --noEmit
```

Expected: 둘 다 통과. **루트 `npm run type-check` 는 admin-web 을 제외하므로 위 `tsc` 가 유일한 타입 게이트다.**

- [ ] **Step 7: 커밋**

```bash
git add apps/admin-web/src/features/mall/marketing/coupons
git commit -m "feat(admin-web): 쿠폰 생성 폼에 최대 할인금액 입력란 (#488 A4 · P10-B)"
```

---

## Task 7: 어드민 표시 2곳

**Files:**
- Create: `apps/admin-web/src/features/mall/marketing/coupons/lib/format-discount-label.ts`
- Create: `apps/admin-web/src/features/mall/marketing/coupons/lib/format-discount-label.spec.ts`
- Modify: `apps/admin-web/.../template/marketing-coupons-template.tsx`
- Modify: `apps/admin-web/.../components/coupon-detail-dialog.tsx`

**Interfaces:**
- Consumes: `getCouponMeta(coupon).maxDiscountAmount` (이미 있다 — 실측 ⑩)
- Produces: `formatDiscountLabel(applicationMethod, maxDiscountAmount): string`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`format-discount-label.spec.ts`:

```ts
import { formatDiscountLabel } from './format-discount-label';

const percentage = { type: 'percentage' as const, value: 10 };
const fixed = { type: 'fixed' as const, value: 5000 };

describe('formatDiscountLabel', () => {
  it('application_method 가 없으면 대시', () => {
    expect(formatDiscountLabel(null, null)).toBe('-');
  });

  it('정률은 퍼센트로', () => {
    expect(formatDiscountLabel(percentage, null)).toBe('10%');
  });

  it('정액은 원화로', () => {
    expect(formatDiscountLabel(fixed, null)).toBe('5,000원');
  });

  it('정률 + 캡이면 상한을 덧붙인다', () => {
    expect(formatDiscountLabel(percentage, 30000)).toBe('10% (최대 30,000원)');
  });

  it('정액에 캡이 있어도 덧붙이지 않는다 — 정액의 상한은 할인액 자신이다', () => {
    expect(formatDiscountLabel(fixed, 30000)).toBe('5,000원');
  });

  it('캡 0 은 상한이 있다는 뜻이다 — falsy 로 흘리지 않는다', () => {
    expect(formatDiscountLabel(percentage, 0)).toBe('10% (최대 0원)');
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

```bash
npm run test:admin-web -- format-discount-label
```

Expected: FAIL — 모듈이 없다

- [ ] **Step 3: 구현한다**

`format-discount-label.ts`:

```ts
/**
 * 쿠폰 목록·상세의 「할인」 칸 문구를 조립한다 (#488 A4).
 *
 * 목록과 상세가 각자 `.tsx` 안에서 같은 문자열을 만들고 있었고, `.tsx` 는 admin-web 의 jest
 * transform(`^.+\.(t|j)s$`) 밖이라 **테스트가 실행조차 되지 않았다.** 그래서 `.ts` 로 뽑는다.
 */

export interface DiscountApplicationMethodLike {
  type: string;
  value: number;
}

export function formatDiscountLabel(
  applicationMethod: DiscountApplicationMethodLike | null | undefined,
  maxDiscountAmount: number | null | undefined,
): string {
  if (!applicationMethod) return '-';

  if (applicationMethod.type !== 'percentage') {
    return `${applicationMethod.value.toLocaleString('ko-KR')}원`;
  }

  const base = `${applicationMethod.value}%`;
  // `0` 도 상한이다 — falsy 판정으로 흘리면 「상한 0원」이 「상한 없음」으로 보인다.
  if (maxDiscountAmount == null || !Number.isFinite(maxDiscountAmount)) return base;
  return `${base} (최대 ${maxDiscountAmount.toLocaleString('ko-KR')}원)`;
}
```

- [ ] **Step 4: 테스트가 통과하는지 확인한다**

```bash
npm run test:admin-web -- format-discount-label
```

Expected: PASS (6 tests)

- [ ] **Step 5: 두 화면을 새 헬퍼로 바꾼다**

`marketing-coupons-template.tsx`:
- 파일 상단 로컬 `function formatDiscount(coupon) { … }` 를 **삭제**한다.
- import 에 추가: `import { formatDiscountLabel } from '../lib/format-discount-label';`
- 목록 셀(`{formatDiscount(coupon)}`)을 바꾼다. 그 행은 이미 `getCouponMeta` 를 부르고 있으므로 그 결과를 쓴다:

```tsx
<span className="font-medium">
  {formatDiscountLabel(coupon.application_method, meta.maxDiscountAmount)}
</span>
```

> ⚠️ 그 컴포넌트 안에서 `getCouponMeta(coupon)` 결과를 담은 변수명이 `meta` 가 아니면 그 이름을 쓴다
> (`visibility` · `issuedCount` · `maxClaims` 를 이미 거기서 꺼내 쓰고 있다).

`coupon-detail-dialog.tsx`:
- import 에 추가: `import { formatDiscountLabel } from '../lib/format-discount-label';`
- `const discountStr = m ? … : '-';` 를 아래로 교체 (`getCouponMeta` 결과 변수명은 그 파일 것을 따른다):

```tsx
const discountStr = formatDiscountLabel(m, meta.maxDiscountAmount);
```

- [ ] **Step 6: 게이트를 돌린다**

```bash
npm run test:admin-web
cd apps/admin-web && npx tsc --noEmit
```

Expected: 둘 다 통과

- [ ] **Step 7: 커밋**

```bash
git add apps/admin-web/src/features/mall/marketing/coupons
git commit -m "feat(admin-web): 쿠폰 할인 라벨에 최대 할인금액을 표시한다 (#488 A4 · P10-B)"
```

---

## Task 8: 스토어프론트 표시 4곳 + 마이페이지 정렬 버그

**Files:**
- Create: `web/almondyoung-storefront/src/lib/utils/coupon-discount.ts`
- Create: `web/almondyoung-storefront/src/lib/utils/coupon-discount.test.ts`
- Modify: `web/almondyoung-storefront/src/lib/types/dto/promotion.ts`
- Modify: `web/almondyoung-storefront/src/lib/api/medusa/store.ts`
- Modify: `web/.../domains/mypage/template/coupon/coupon-card.tsx`
- Modify: `web/.../domains/mypage/template/coupon/coupon-tabs.tsx`
- Modify: `web/.../domains/checkout/components/sections/discount.tsx`
- Modify: `web/.../app/[countryCode]/(main)/coupons/claim/page.tsx`
- Modify: `web/.../app/[countryCode]/(main)/events/[slug]/page.tsx`
- Modify: `web/.../i18n/messages/{ko,ja,en}/{mypage,checkout,couponClaim}.json`

**Interfaces:**
- Consumes: Task 5 의 `max_discount_amount`(promotions 응답 최상위 · preview/events 는 `discount` 안)
- Produces:
  - `type CouponDiscountLike = { type: string; value: number }`
  - `shouldShowCap(discount: CouponDiscountLike | null | undefined, maxDiscountAmount: number | null | undefined): boolean`
  - `maxPossibleDiscount(discount: CouponDiscountLike | null | undefined, maxDiscountAmount: number | null | undefined): number`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`web/almondyoung-storefront/src/lib/utils/coupon-discount.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { maxPossibleDiscount, shouldShowCap } from "./coupon-discount"

const percentage = { type: "percentage", value: 10 }
const fixed = { type: "fixed", value: 50000 }

describe("shouldShowCap", () => {
  it("정률 + 캡이면 표기한다", () => {
    expect(shouldShowCap(percentage, 3000)).toBe(true)
  })
  it("캡이 없으면 표기하지 않는다", () => {
    expect(shouldShowCap(percentage, null)).toBe(false)
  })
  it("정액에는 캡이 있어도 표기하지 않는다", () => {
    expect(shouldShowCap(fixed, 3000)).toBe(false)
  })
  it("할인 정보 자체가 없으면 표기하지 않는다", () => {
    expect(shouldShowCap(null, 3000)).toBe(false)
  })
  it("캡 0 도 캡이다", () => {
    expect(shouldShowCap(percentage, 0)).toBe(true)
  })
})

describe("maxPossibleDiscount — 「할인 큰 순」 정렬 키", () => {
  it("정액은 할인액 자신이다", () => {
    expect(maxPossibleDiscount(fixed, null)).toBe(50000)
  })
  it("상한 있는 정률은 상한이다", () => {
    expect(maxPossibleDiscount(percentage, 3000)).toBe(3000)
  })
  it("상한 없는 정률은 무한이다 — 장바구니가 커질수록 커진다", () => {
    expect(maxPossibleDiscount(percentage, null)).toBe(Number.POSITIVE_INFINITY)
  })
  it("할인 정보가 없으면 0 이다", () => {
    expect(maxPossibleDiscount(null, null)).toBe(0)
  })

  it("🔴 회귀: 「10% 최대 3천원」은 「5만원 정액」보다 작다", () => {
    expect(maxPossibleDiscount(percentage, 3000)).toBeLessThan(
      maxPossibleDiscount(fixed, null)
    )
  })
})
```

- [ ] **Step 2: 실패를 확인한다**

```bash
cd web/almondyoung-storefront && npm test -- coupon-discount
```

Expected: FAIL — 모듈이 없다

- [ ] **Step 3: 구현한다**

`web/almondyoung-storefront/src/lib/utils/coupon-discount.ts`:

```ts
/**
 * 쿠폰 할인 표기·정렬의 공통 판정 (#488 A4).
 *
 * 라벨 자체는 화면마다 i18n 네임스페이스가 달라(`mypage.coupon` · `checkout.discount` ·
 * `couponClaim`) 여기서 만들지 않는다. **번역이 필요 없는 판정만** 여기 둔다 — 그래야
 * vitest 가 닿는다(`.tsx` 안의 삼항 연산자는 어떤 러너도 안 본다).
 */

export type CouponDiscountLike = {
  type: string
  value: number
}

/**
 * 「최대 N원」을 붙여야 하는가.
 *
 * 정액 쿠폰의 상한은 할인액 자신이라 표기가 중복이다. 정률일 때만 의미가 있다.
 * `0` 도 상한이므로 falsy 판정으로 흘리지 않는다.
 */
export function shouldShowCap(
  discount: CouponDiscountLike | null | undefined,
  maxDiscountAmount: number | null | undefined
): boolean {
  if (!discount || discount.type !== "percentage") return false
  return maxDiscountAmount != null && Number.isFinite(maxDiscountAmount)
}

/**
 * 「이 쿠폰이 낼 수 있는 최대 할인액」 — 서로 다른 종류의 쿠폰을 한 줄에 세우는 유일한 기준.
 *
 * 옛 정렬은 정률을 무조건 정액 위로 올리고 raw `value` 로 비교해서, 「10% 최대 3천원」이
 * 「5만원 정액」보다 위에 왔다(#488 A4 표시 목록의 «진짜 버그»). 상한 없는 정률만 무한이다.
 */
export function maxPossibleDiscount(
  discount: CouponDiscountLike | null | undefined,
  maxDiscountAmount: number | null | undefined
): number {
  if (!discount) return 0
  if (discount.type !== "percentage") return discount.value
  if (maxDiscountAmount != null && Number.isFinite(maxDiscountAmount)) {
    return maxDiscountAmount
  }
  return Number.POSITIVE_INFINITY
}
```

- [ ] **Step 4: 테스트가 통과하는지 확인한다**

```bash
cd web/almondyoung-storefront && npm test -- coupon-discount
```

Expected: PASS (10 tests)

- [ ] **Step 5: 타입에 필드를 더한다**

`src/lib/types/dto/promotion.ts` 의 `PromotionDto` 에 추가:

```ts
  /** 정률 쿠폰 최대 할인금액 (#488 A4). 상한이 없으면 `null`. */
  max_discount_amount?: number | null
```

`src/lib/api/medusa/store.ts` — `CouponPreviewResult.discount` 와 `CouponEventCoupon.discount` 두 곳의 객체 타입에 각각 추가:

```ts
    max_discount_amount?: number | null
```

- [ ] **Step 6: i18n 키를 9개 더한다**

세 네임스페이스 × 세 로케일. 키 이름은 **`maxCap`** 으로 통일한다.

`src/i18n/messages/ko/mypage.json` 의 `coupon` 객체, `ko/checkout.json` 의 `discount` 객체, `ko/couponClaim.json` 최상위:

```json
"maxCap": "최대 {amount}원"
```

`ja/*`:

```json
"maxCap": "最大{amount}ウォン"
```

`en/*`:

```json
"maxCap": "up to {amount} KRW"
```

- [ ] **Step 7: 표시 4곳을 고친다**

**(a) `domains/mypage/template/coupon/coupon-card.tsx`** — `discountLabel` 을 교체:

```tsx
  const capSuffix = shouldShowCap(promo.application_method, promo.max_discount_amount)
    ? ` (${t("maxCap", { amount: formatPrice(promo.max_discount_amount as number) })})`
    : ""

  const discountLabel =
    (promo.application_method?.type === "percentage"
      ? t("percentValue", { value: promo.application_method.value })
      : t("amountValue", {
          amount: formatPrice(promo.application_method?.value ?? 0),
        })) + capSuffix
```

import 에 `import { shouldShowCap } from "@/lib/utils/coupon-discount"` 추가.

> 캡 접미사는 카드 왼쪽의 큰 금액 블록에 들어간다. 두 줄이 되면 `text-2xl` 이 넘칠 수 있으니
> 접미사는 **작은 글씨 별도 줄**로 뺀다 — `discountLabel` 은 기존대로 두고 그 아래에:
>
> ```tsx
> {shouldShowCap(promo.application_method, promo.max_discount_amount) && (
>   <span className={`mt-0.5 text-[10px] ${expired ? "text-stone-400" : "text-amber-600/70"}`}>
>     {t("maxCap", { amount: formatPrice(promo.max_discount_amount as number) })}
>   </span>
> )}
> ```
>
> **둘 중 하나만 쓴다.** 큰 금액 블록이 좁으므로(`w-28`) **별도 줄 쪽을 채택한다.**

**(b) `domains/mypage/template/coupon/coupon-tabs.tsx`** — `sortItems` 의 `discount` 분기를 교체:

```tsx
// 할인 큰 순: 「이 쿠폰이 낼 수 있는 최대 할인액」으로 비교한다.
// 옛 구현은 정률을 무조건 정액 위로 올리고 raw value 로 비교해서
// 「10% 최대 3천원」이 「5만원 정액」보다 위에 왔다(#488 A4).
if (key === "discount") {
  sorted.sort(
    (a, b) =>
      maxPossibleDiscount(b.promo.application_method, b.promo.max_discount_amount) -
      maxPossibleDiscount(a.promo.application_method, a.promo.max_discount_amount)
  )
}
```

import 에 `import { maxPossibleDiscount } from "@/lib/utils/coupon-discount"` 추가.

> ⚠️ `Infinity - Infinity = NaN` 이다. 상한 없는 정률이 둘 이상이면 비교가 `NaN` 이 되어 순서가
> 정의되지 않는다. 아래처럼 **뺄셈 대신 비교**로 쓸 것:
>
> ```tsx
> sorted.sort((a, b) => {
>   const left = maxPossibleDiscount(a.promo.application_method, a.promo.max_discount_amount)
>   const right = maxPossibleDiscount(b.promo.application_method, b.promo.max_discount_amount)
>   if (left === right) return 0
>   return right > left ? 1 : -1
> })
> ```
>
> **이쪽을 채택한다.**

정렬 드롭다운 라벨이 「할인율 높은순」이면 「할인 큰 순」으로 바꾼다
(`i18n/messages/{ko,ja,en}/mypage.json` 의 해당 키 — 파일에서 「할인율」을 찾아 고친다).

**(c) `domains/checkout/components/sections/discount.tsx`** — `formatPromoLabel` 교체:

```tsx
  const formatPromoLabel = (promo: Promotion) => {
    const base =
      promo.application_method?.type === "percentage"
        ? t("percentDiscount", { value: promo.application_method.value })
        : t("amountDiscount", {
            amount: formatPrice(promo.application_method?.value ?? 0),
          })
    return shouldShowCap(promo.application_method, promo.max_discount_amount)
      ? `${base} (${t("maxCap", { amount: formatPrice(promo.max_discount_amount as number) })})`
      : base
  }
```

import 에 `import { shouldShowCap } from "@/lib/utils/coupon-discount"` 추가.

**(d) `app/[countryCode]/(main)/coupons/claim/page.tsx`** — `discountLabel` 교체:

```tsx
  const capSuffix =
    discount && shouldShowCap(discount, discount.max_discount_amount)
      ? ` (${t("maxCap", { amount: (discount.max_discount_amount as number).toLocaleString("ko-KR") })})`
      : ""

  const discountLabel = discount
    ? (discount.type === "percentage"
        ? t("discountPercent", { value: discount.value })
        : t("discountAmount", { amount: discount.value.toLocaleString("ko-KR") })) + capSuffix
    : null
```

**(e) `app/[countryCode]/(main)/events/[slug]/page.tsx`** — `discountLabel` 교체:

```tsx
  const discountLabel = (c: CouponEventCoupon) => {
    if (!c.discount) return null
    const base =
      c.discount.type === "percentage"
        ? t("discountPercent", { value: c.discount.value })
        : t("discountAmount", { amount: c.discount.value.toLocaleString("ko-KR") })
    return shouldShowCap(c.discount, c.discount.max_discount_amount)
      ? `${base} (${t("maxCap", { amount: (c.discount.max_discount_amount as number).toLocaleString("ko-KR") })})`
      : base
  }
```

(d)·(e) 모두 import 에 `import { shouldShowCap } from "@/lib/utils/coupon-discount"` 추가.

- [ ] **Step 8: 게이트를 돌린다**

```bash
cd web/almondyoung-storefront && npm test && npx tsc --noEmit
```

Expected: vitest 전부 PASS · 타입 에러 0

- [ ] **Step 9: 커밋**

```bash
git add web/almondyoung-storefront
git commit -m "feat(storefront): 쿠폰 최대 할인금액 표시 + 마이페이지 정렬 버그 수정 (#488 A4 · P10-B)"
```

---

## 마무리: 전체 게이트

- [ ] **Step 1: 네 트리의 게이트를 전부 돌린다**

```bash
npm run type-check
cd apps/medusa && npm run test:unit && npx tsc --noEmit && cd -
scripts/local/run-medusa-integration.sh --testPathPattern 'coupon-'
npm run test:admin-web
cd apps/admin-web && npx tsc --noEmit && cd -
cd web/almondyoung-storefront && npm test && npx tsc --noEmit && cd -
```

기대치:

| 게이트 | 기준선 → 기대 |
|---|---|
| 루트 `type-check` | 0 → 0 |
| Medusa 유닛 | 28 suites / 243 → **29 / 254** (Task 1 이 +1 suite / +11) |
| Medusa 타입 | 선재 3건 → 선재 3건 |
| 쿠폰 통합 | 4 suites / 42 → **5 / 51** (Task 2·3·4 가 +1 suite / +9) |
| admin-web 유닛 | 통과 → 통과 (+6, Task 7) · (+3, Task 6) |
| storefront vitest | 통과 → 통과 (+10, Task 8) |

- [ ] **Step 2: 이 플랜이 하지 않은 것을 문서에 남긴다**

`docs/superpowers/plans/2026-08-29-coupon-domain-master-plan.md` 의 진행 상황에서 P10-B 항목을 `[x]` 로 바꾸고, 아래를 그 아래 줄에 적는다:

```markdown
- [x] **P10-B 실행 (2026-08-31)** — `2026-08-31-coupon-percentage-cap.md`. 마이그 0.
      캡 훅 2개 + 라우트 1개 + 백스톱 1개, 표시 **8곳**(#488 의 6곳 목록에 `/store/coupons/preview`
      와 `/store/events/:slug` 가 빠져 있었다). 마이페이지 정렬 버그 동봉.
      **하지 않은 것**: 쿠폰 «수정» 화면이 없어 캡은 생성 시에만 정할 수 있다(바꾸려면 삭제·재생성).
      `refreshPaymentCollectionForCartWorkflow.hooks.validate` 는 **쓰면 안 되는 자리**임을 확인 —
      카트를 훅보다 먼저 fetch 해 그 `raw_total` 로 결제금액을 정한다.
```

- [ ] **Step 3: 커밋**

```bash
git add docs/superpowers/plans
git commit -m "docs(coupon): P10-B 실행 기록 (#488 A4)"
```

---

## 이 플랜이 **하지 않는** 것

- **쿠폰 수정 화면** — 없다(실측 ⑪). 캡은 생성 시에만 설정되고, 바꾸려면 삭제·재생성이다. `additional-data-schema.ts` 의 update shape 에는 이미 키가 있으므로 화면만 생기면 동작한다.
- **`GET /admin/promotions` override 제거 · 쿠폰 밖 코어 override 9개** — `N8` 이 남기기로 한 그대로.
- **네이티브 `/app` 비활성화** — 여전히 미결. 그 경로로 만든 쿠폰은 메타가 없어 캡도 없지만, P10-A 의 닫힌 기본값 때문에 **아무도 못 쓴다**.
- **`A2`(환불 시 쿠폰 복구) · `7-1`/`7-7`(P4) · `1-5`(P7)** — 다른 플랜의 것.
- **리허설 2차** — 이 플랜의 통합 스펙은 캡이 걸리는지를 보지, 「개통해도 되는가」에 답하지 않는다.

## Self-Review

- **스펙 커버리지.** #488 A4 절이 요구한 것: (b) 훅 방식 ✅ Task 2 · 백스톱 «선택이 아니라 필수» ✅ Task 4 · 표시 6곳 ✅ Task 5·7·8 (+2곳 추가) · 폼 입력란 ✅ Task 6 · 「캡 분배·표시 판정은 순수 함수로 뽑아 유닛으로」 ✅ Task 1·7·8 · 마이페이지 정렬 버그 ✅ Task 8. 마이그레이션 0 ✅.
- **타입 정합.** `planPromotionCap`/`findCapViolations`(Task 1) → `enforcePromotionCap`/`findPromotionCapViolations`(Task 2) → Task 3·4 소비. `formatPromotion` 3번째 인자 변경(Task 5)의 호출자는 `route.ts` 한 곳 + 스펙뿐(2026-08-31 grep 확인).
- **알려진 취약점 둘.**
  ① Task 2 의 훅은 `StepResponse` 보상을 갖지 않는다 — 뒤 스텝이 실패해도 깎인 금액이 남지만, 다음 재계산이 프로모션을 REPLACE 로 다시 만들어 자기수복된다. 의도한 트레이드오프다.
  ② 🔴 **배송수단 되쓰기 경로는 이 플랜의 자동 테스트가 안 지난다.** 통합 스펙에 배송옵션 픽스처가 필요한데(fulfillment set → service zone → shipping option → price) **저장소의 어느 통합 스펙에도 그 픽스처가 없다**(2026-08-31 확인). 라인아이템 경로만 실행된다. 완화책 둘을 **Task 2 안에서** 밟을 것:
  - Task 2 Step 3 을 마친 직후 `node_modules/@medusajs/cart/dist/services/cart-module-service.js` 에서 `upsertShippingMethodAdjustments` 의 실제 구현을 읽어 **update 분기가 `id` 만으로 도는지, `shipping_method_id` 를 요구하는지**를 확인한다. 타입 선언(`(Create|Update)ShippingMethodAdjustmentDTO[]`)은 둘 다 받아들이게 생겨서 타입만으로는 안 갈린다.
  - **배송비 쿠폰 + 캡** 조합을 리허설 2차 항목에 명시적으로 넣는다(`target_type: shipping_methods` · `type: percentage` · 캡 설정 → 체크아웃에서 배송비 할인이 캡을 안 넘는지).
