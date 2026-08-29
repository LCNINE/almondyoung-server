# 쿠폰 노출 어휘(`visibility`) 정본화 + 어휘 드리프트 가드 (P3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 세 트리에 8벌로 흩어져 있고 **컴파일러가 잡는 곳이 0곳**이던 쿠폰 `visibility` 어휘를 `@packages/domain-types` 의 정본 하나로 모으고, 컴파일러가 닿을 수 없는 트리(medusa · 마이그레이션 · storefront · channel-adapter)는 **실행되는 드리프트 가드 스펙**으로 덮는다. 부수적으로 「모르는 값을 «공개» 로 표시」하는 #488 N3 의 실제 버그를 없앤다.

**Architecture:** 어휘 정본(`COUPON_VISIBILITIES` + `CouponVisibility` + `toCouponVisibility`)을 `@packages/domain-types` 에 둔다(Task 1). 정본을 import 할 수 **없는** 트리들은 소스 리터럴을 읽어 정본과 대조하는 가드 스펙이 덮는다(Task 2). admin-web 은 실제로 import 해서 컴파일러 강제를 받고, 그 과정에서 판정·라벨 로직을 `.tsx` 밖의 `.ts` 로 옮겨 처음으로 테스트 가능해진다(Task 3·4). 마지막으로 다음 사람이 같은 곳에 다시 빠지지 않게 정본 포인터를 코드 주석과 ADR 에 남긴다(Task 5).

**Tech Stack:** TypeScript · Jest + ts-jest (루트) · Next.js 15 (admin-web) · Medusa v2.13.4 (읽기 전용 대상)

**Spec:** 이슈 [#488](https://github.com/LCNINE/almondyoung-server/issues/488) 항목 `N3` (부분적으로 `7-3` 의 어휘 축) · 로드맵 `docs/superpowers/plans/2026-08-29-coupon-domain-master-plan.md` · 경계 `docs/adr/0033-coupons-are-owned-by-the-sales-channel.md` §7

---

## Global Constraints

- **마이그레이션 0건 · 시크릿 0건 · env 0건 · 이벤트 계약 0건 · npm 의존성 0건.**
- **런타임 동작 변화는 셋이고, 그중 사람 눈에 보이는 것은 둘이다** (2026-08-30 최종 리뷰가 전수로 셈):

  | # | 변화 | 보이는가 | 라이브 도달 |
  |---|---|---|---|
  | 1 | 어휘 밖 `visibility` 의 표시가 «공개» → «알 수 없음» (목록 배지·상세·이벤트 폼 3곳) | 보임 | DB CHECK 제약이 막음 |
  | 2 | 어휘 밖 `auto_issue_trigger` → `null` — 상세의 「자동 발급」 행이 **빈 값 렌더 대신 사라진다** | 보임 | DB CHECK 제약이 막음 |
  | 3 | `visibility: ''` 가 `'public'` 으로 정규화 (옛 `?? 'public'` 은 `''` 를 nullish 로 안 봐 그대로 실었다) | **안 보임** — 세 표시 표면의 옛 폴백이 전부 «공개» 였고 `=== 'claimable'` 분기도 양쪽 false | DB CHECK 제약이 막음 |

  셋 다 `promotion_meta_visibility_check` / `promotion_meta_auto_issue_trigger_check` 가 막고 있어 **오늘 라이브 화면은 픽셀 하나도 안 바뀐다.** 이 변경은 「4번째 값이 생기는 날」을 위한 것이다.
- **배포 순서 제약 없음.** 바뀌는 것은 admin-web 하나뿐이고, 그것이 부르는 API 계약은 그대로다. 애초에 SST 한 스택엔 앱 간 배포 순서를 강제할 수단이 없다(메모리 「SST 한 스택엔 배포 순서가 없다」).
- **`apps/medusa` 소스는 주석 1줄 외에 고치지 않는다.** 이유는 아래 «왜 medusa 는 정본을 import 하지 않는가».
- **`web/almondyoung-storefront` 는 주석 1줄 외에 고치지 않는다.** 이유는 아래 «왜 storefront 는 정본을 import 하지 않는가».
- **`auto_issue_trigger` 어휘는 공유 타입으로 만들지 않는다.** ADR-0033 §7 이 「실사용이 0인 지금 그 추상화는 이르다」로 이미 판단했다. **그러나 §7 의 「컴파일러가 잡아주는 것은 하나도 없다」는 Task 2 의 가드가 닫는다** — 가드는 공유 타입이 아니라 검사이므로 §7 의 결정과 충돌하지 않는다.
- **1-6(`birthday` 존폐)은 이 플랜의 범위가 아니다.** 값을 지우지도, 살리지도 않는다. 가드는 오늘의 3값을 그대로 고정할 뿐이다.
- **검증 게이트 (2026-08-30 실측 기준선 — 전부 초록):**

  | 게이트 | 명령 | 기준선 |
  |---|---|---|
  | 루트 타입 | `npm run type-check` | **에러 0** |
  | 어휘 패키지 유닛 | `npx jest packages/domain-types --maxWorkers=2` | **2 suites / 6 tests 통과, 0.12s** |
  | admin-web 유닛 | `npm run test:admin-web` | **89 suites / 737 tests 통과, 1.5s** |
  | admin-web 타입 | `cd apps/admin-web && npx tsc --noEmit` | **에러 0** |

  **어느 게이트가 CI 에 있는가 (2026-08-30 실측):**
  - ✅ **드리프트 가드는 CI 차단 게이트다.** 루트 jest 의 `roots` 에 `packages/domain-types/` 가 있고 `.github/workflows/verification-gates.yml` 이 `npx jest --ci` 를 돈다. 루트 jest 는 **admin-web 의 `.spec.ts` 도 수집**하므로 `coupon-labels.spec.ts` 의 「세 맵이 어휘 전체를 덮는다」도 CI 에 있다.
  - 🔴 **`cd apps/admin-web && npx tsc --noEmit` 는 CI 에 없다.** 루트 `tsconfig.json:exclude` 에 `apps/admin-web` 이 있고 `.github/workflows/` 어디에도 admin-web tsc 가 없다. 즉 **어휘 확장을 막는 CI 방어선은 `Record<CouponVisibility,…>` 의 타입 에러가 아니라 스펙이다.** 그래서 라벨 맵마다 키 커버리지 스펙을 둔 것이 장식이 아니다 — 그게 유일하게 CI 에서 도는 방어선이다.

  **`npm run type-check` 는 admin-web 을 제외한다** (루트 `tsconfig.json:exclude`). admin-web 의 타입 게이트는 반드시 `cd apps/admin-web && npx tsc --noEmit` 를 따로 부를 것 — 메모리 「admin-web 은 컴포넌트 테스트 불가」 항목이 기록한 함정이다.
  **`npx jest` 전체는 OOM 이 난다** — 이 플랜에서는 위 두 스코프 명령만 쓴다(`--maxWorkers=2` 유지).
- 주석·커밋 메시지는 한국어. 기존 파일 톤을 따른다. 커밋 접두는 `refactor(...)` / `test(...)` / `docs(...)`.
- **워크트리를 만들지 않는다.** `develop` 에서 딴 일반 브랜치에서 작업한다. 이 저장소의 워크트리 경로는 `.claude/worktrees/feat+foo` 꼴이고 `+` 가 jest 무시 패턴(정규식)을 조용히 무력화한다 — 이 플랜의 게이트가 전부 jest 라 그 위험을 감수할 이유가 없다(메모리 「서브에이전트 워크트리 오염」·CLAUDE.md 「jest 설정의 무시 패턴은 정규식이다」).

---

## 이 값을 읽는 소비자 목록 (P1 교훈 1 — 필수 항목)

> P1 은 File Structure 표에 **쓰기 경로만** 적고 「지금 이 값을 읽는 코드는 어디인가」를 묻지 않아 Critical 을 냈다. 그래서 이 절이 File Structure 보다 **먼저** 온다.
> 이번에 옮기는 것은 저장 위치가 아니라 **어휘의 선언 위치**다. 따라서 「읽는 곳」은 **이 값으로 분기하거나 이 값을 선언하는 모든 지점**이다. 근거는 전부 2026-08-30 `grep` 실측.

### `visibility` 어휘를 **선언**하는 곳 (전수 8곳 — 오늘 컴파일러가 잡는 곳 0)

| # | 위치 | 형태 | P3 의 조치 |
|---|---|---|---|
| 1 | `apps/medusa/src/modules/promotion-meta/service.ts:16` | `PromotionMetaData.visibility` 유니온 | **가드가 덮는다** (import 불가) |
| 2 | `apps/medusa/src/modules/promotion-meta/service.ts:28` | `upsert()` 안의 인라인 배열 (1번과 무관) | **가드가 덮는다** |
| 3 | `apps/medusa/src/modules/promotion-meta/migrations/Migration20260526140000.ts:6` | DB CHECK 제약 | **가드가 덮는다** (어떤 import 로도 못 덮는다) |
| 4 | `apps/admin-web/.../coupons/coupon-helpers.tsx:44,56` | `CouponMeta.visibility` 유니온 + `as` 캐스팅 | **정본 import 로 교체** (Task 3) |
| 5 | `apps/admin-web/.../coupons/components/coupon-create-dialog.tsx:169` | `useState` 인라인 유니온 | **정본 import 로 교체** (Task 4) |
| 6 | `apps/admin-web/.../coupons/components/coupon-create-dialog.tsx:486` | `onValueChange` 안 인라인 유니온 (5번과 별개 벌) | **정본 import 로 교체** (Task 4) |
| 7 | `apps/admin-web/.../coupons/template/marketing-coupons-template.tsx:43` | `VISIBILITY_LABEL: Record<string,…>` | **`Record<CouponVisibility,…>` 로** (Task 3·4) |
| 8 | `web/almondyoung-storefront/src/lib/types/dto/promotion.ts:31` | `PromotionDto.visibility` 유니온 | **가드가 덮는다** (import 불가) |

**+ 9번째 (P1 이 만든 것, #488 본문에는 없다):** `apps/admin-web/.../coupons/lib/build-create-promotion-payload.ts:9` `export type Visibility`. **정본 import 로 교체** (Task 4).

### `visibility` **값으로 분기**하는 곳 (전수)

| 위치 | 분기 | P3 의 조치 |
|---|---|---|
| `marketing-coupons-template.tsx:50-51` | `VISIBILITY_LABEL[v] ?? VISIBILITY_LABEL.public` | **← 이것이 N3 의 버그다.** 모르는 값이 «공개» 로 렌더된다. Task 4 에서 제거 |
| `coupon-detail-dialog.tsx:127` | 삼항 연쇄, 폴백 `'공개'` | **← 같은 버그.** Task 4 에서 맵 조회로 |
| `event-form-dialog.tsx:262` | 삼항 연쇄, 폴백 `'공개'` | **← 같은 버그.** Task 4 에서 맵 조회로 |
| `coupon-detail-dialog.tsx:129,134,161` | `=== 'claimable'` | 그대로 (동등 비교라 어휘 확장에 안전) |
| `coupon-create-dialog.tsx:496,501,518` | `=== 'claimable'` / `=== 'assigned_only'` | 그대로 |
| `build-create-promotion-payload.ts:62` | `=== 'claimable'` | 그대로 |
| **medusa 런타임 6곳** — `store/coupons/preview/route.ts:101,136,145` · `store/events/[slug]/route.ts:92,99` · `store/customers/me/promotions/route.ts:187,198` · `store/customers/me/promotions/[id]/claim/route.ts:36` · `store/carts/middlewares/per-customer-limit.ts:33` · `workflows/hooks/cart/complete-cart.ts:33` | 전부 문자열 동등 비교 | **손대지 않는다.** 동등 비교는 어휘가 늘어도 안전하고, medusa 는 정본을 import 할 수 없다 |

**결론: 하위 호환 요구사항 (P1 교훈 3) 은 「어휘 밖 값을 만나도 화면이 죽지 않아야 한다」 하나다.** 옛 데이터가 옛 자리에 남는 형태의 하위 호환은 없다 — 저장 위치가 안 바뀌기 때문이다. 그 하나의 요구사항은 `toCouponVisibility` 가 `null` 을 돌려주고 라벨 헬퍼가 «알 수 없음» 을 렌더하는 것으로 만족하며, **Task 1·3 의 스펙이 그것을 덮는다.**

### `auto_issue_trigger` 어휘를 선언하는 곳 (ADR-0033 §7 의 여섯 곳 — 가드만 붙인다)

| # | 위치 | 형태 |
|---|---|---|
| 1 | `apps/medusa/src/modules/promotion-meta/service.ts:7` | `AutoIssueTrigger` 타입 |
| 2 | `apps/medusa/src/modules/promotion-meta/service.ts:31` | `upsert()` 안 인라인 배열 |
| 3 | `apps/medusa/src/api/admin/customers/[id]/issue-coupons/route.ts:8` | `VALID_TRIGGERS` |
| 4 | `apps/medusa/.../migrations/Migration20260527100000.ts:10` | DB CHECK 제약 |
| 5 | `apps/admin-web/.../coupons/coupon-helpers.tsx:30` | admin-web 자체 타입 + 라벨 맵 → **Task 3 에서 `lib/coupon-meta.ts` 로 이동** |
| 6 | `apps/channel-adapter/.../medusa.client.ts:2377` | 메서드 시그니처의 인라인 유니온 |

---

## 왜 medusa 는 정본을 import 하지 않는가 (2026-08-30 실측)

이 결정은 플랜의 뼈대이므로 근거를 남긴다. **`apps/medusa` 는 `@packages/*` 를 런타임에 해석할 수 없다.**

1. `apps/medusa/tsconfig.json` 에 `paths: { "@packages/*": [...] }` 가 **있다**. 그래서 타입체크는 통과한다.
2. 그러나 **`apps/medusa/src` 전체에서 `@packages/` import 는 0건**이고, 트리 밖으로 나가는 상대경로 import 도 0건이다. 즉 이 별칭은 **한 번도 런타임에서 검증된 적이 없다.**
3. ~~별칭을 쓰는 유일한 파일이 tsc 에러라는 것이 «별칭이 동작하지 않는 증거»~~ — **2026-08-30 최종 리뷰에서 반증됐다.** 그 파일이 쓰는 `@workflows/*` 는 medusa `tsconfig.json` 의 `paths` 에 애초에 없고(거기엔 `@packages/*` 하나뿐) jest `moduleNameMapper` 전용 별칭이라, `@packages/*` 에 대해 아무것도 말해주지 않는다.
4. `apps/medusa/jest.config.js` 의 `moduleNameMapper` 에도 `@packages` 매핑이 없다.
5. **core·channel-adapter 가 `@packages/domain-types` 를 쓸 수 있는 이유는 Nest 가 webpack 으로 번들하기 때문이다** (`nest-cli.json: "webpack": true`). webpack 이 빌드타임에 별칭을 해소한다. **Medusa 빌드에는 번들러가 없다** — `tsc` 계열은 별칭을 emit 결과에 그대로 남기므로 `require('@packages/domain-types')` 가 런타임 `MODULE_NOT_FOUND` 가 된다.
6. node_modules 심볼릭 링크로 우회하는 길도 막혀 있다: `@packages/domain-types` 의 `main` 은 **빌드되지 않은 `index.ts`** 라 Node 가 직접 require 할 수 없고, medusa Dockerfile 은 `yarn install` 을 `COPY packages` **앞에서** 수행한다.

→ **값으로 import 하면 컨테이너가 부팅에서 죽는다.** `import type` 은 emit 에서 지워져 안전하고 실제로 타입이 강제된다(2026-08-30 실측 — 위 6개 근거 중 3번은 그래서 반증됐다). 그럼에도 type-only import 로 바꾸지 않는 이유는 **이득이 0**이기 때문이다: `apps/medusa` 는 루트 `type-check` 의 `exclude` 에 있고 `medusa-unit-tests.yml` 도 전체 tsc 를 돌리지 않아 CI 가 그 타입을 안 보며, `medusa build` 는 타입 에러로 실패하지도 않는다. 그리고 검증이 필요한 두 지점(`upsert()` 의 런타임 배열, 마이그레이션 CHECK)은 타입으로 못 덮는다. 가드가 엄밀히 넓다 — 마이그레이션의 CHECK 제약까지 덮으므로.

## 왜 storefront 는 정본을 import 하지 않는가

기술적으로는 가능하다 — `web/almondyoung-storefront/package.json` 에 `"@packages/domain-types": "file:../../packages/domain-types"` 를 더하고 `npm install` 로 심볼릭 링크를 만들면 된다(`@packages/web-observability` 가 이미 그 방식이다). **하지 않는 이유는 이익이 0이기 때문이다:**

- `PromotionDto.visibility` 를 **읽는 코드가 storefront 에 0곳**이다 (전수 grep, 2026-08-30). 선언만 있다.
- 대가는 storefront 자체 `package-lock.json` 재생성 + `transpilePackages` 수정이고, 그 빌드가 깨지면 **쇼핑몰이 내려간다**.
- `web/**` 은 **어떤 CI 워크플로도 덮지 않는다** (메모리 「medusa·storefront 게이트 위치」). 즉 깨져도 머지 전에 아무도 모른다.

읽는 코드가 0곳인 선언에 그 위험을 지불하지 않는다. 가드가 리터럴 정합을 지키고, 주석이 정본을 가리킨다.

---

## File Structure

| 파일 | 책임 |
|---|---|
| `packages/domain-types/coupon-visibility.ts` | **신규.** 어휘 정본. 상수 배열 · 파생 유니온 · 좁히기 함수. 「없음 → public」과 「어휘 밖 → null」을 가르는 유일한 자리. |
| `packages/domain-types/coupon-visibility.spec.ts` | **신규.** 위 함수의 유닛 스펙. |
| `packages/domain-types/index.ts` | **수정.** `export * from './coupon-visibility'` 한 줄. |
| `packages/domain-types/coupon-vocabulary-drift.spec.ts` | **신규.** 컴파일러가 못 닿는 트리(medusa ×5 · 마이그레이션 ×2 · storefront ×1 · channel-adapter ×1 · admin-web 트리거 ×1)의 소스 리터럴을 읽어 정본과 대조. **ADR-0033 §7 의 체크리스트를 실행 가능한 것으로 바꾼다.** |
| `apps/admin-web/src/features/mall/marketing/coupons/lib/coupon-meta.ts` | **신규.** `getCouponMeta` (판정) + 트리거 어휘·라벨. `.tsx` 밖으로 나와야 jest 가 실행한다. |
| `apps/admin-web/src/features/mall/marketing/coupons/lib/coupon-meta.spec.ts` | **신규.** 위 판정의 스펙. 「어휘 밖 → null」 회귀 방어선. |
| `apps/admin-web/src/features/mall/marketing/coupons/lib/coupon-labels.ts` | **신규.** 세 표시 표면(배지·상세·생성 드롭다운)의 라벨 맵. 셋 다 `Record<CouponVisibility,…>` 라 어휘가 늘면 **여기서 타입 에러가 난다.** |
| `apps/admin-web/src/features/mall/marketing/coupons/lib/coupon-labels.spec.ts` | **신규.** 세 맵이 어휘 전체를 덮는지 + 어휘 밖 폴백이 «공개» 가 **아닌지**. P1 교훈 2 의 핵심 — 이 판정을 브라우저 수동 확인에 두지 않는다. |
| `apps/admin-web/.../coupons/coupon-helpers.tsx` | **수정.** 이동한 것들을 재수출(Task 3) → 재수출 제거(Task 4). |
| `apps/admin-web/.../coupons/template/marketing-coupons-template.tsx` | **수정.** 자체 `VISIBILITY_LABEL` 제거, 정본 배지 헬퍼 사용. |
| `apps/admin-web/.../coupons/components/coupon-detail-dialog.tsx` | **수정.** 삼항 연쇄 → 맵 조회. |
| `apps/admin-web/.../coupons/components/coupon-create-dialog.tsx` | **수정.** 인라인 유니온 2벌 → `CouponVisibility`, `<SelectItem>` 을 어휘에서 생성. |
| `apps/admin-web/.../marketing/events/components/event-form-dialog.tsx` | **수정.** 삼항 연쇄 → 맵 조회. |
| `apps/admin-web/.../coupons/lib/build-create-promotion-payload.ts` | **수정.** 로컬 `Visibility` 제거 → 정본. |
| `apps/medusa/src/modules/promotion-meta/service.ts` | **수정 (주석 2줄).** 정본과 가드를 가리키는 포인터. |
| `web/almondyoung-storefront/src/lib/types/dto/promotion.ts` | **수정 (주석 2줄).** 같은 포인터. |
| `docs/adr/0033-coupons-are-owned-by-the-sales-channel.md` | **수정.** §7 에 `visibility` 축 추가 + 가드의 존재를 기록. 영구 기록은 여기뿐이다. |
| `docs/superpowers/plans/2026-08-29-coupon-domain-master-plan.md` | **수정.** 웨이브 A 표의 P3 행 + 진행 상황 체크박스. |

---

## 준비: 브랜치

- [ ] **Step 0: `develop` 최신에서 브랜치를 딴다**

```bash
cd /home/pauseb/workspace/almondyoung-server
git checkout develop && git pull --ff-only
git checkout -b refactor/coupon-visibility-vocabulary
```

---

### Task 1: 어휘 정본을 `@packages/domain-types` 에 만든다

`packages/domain-types/listing-resolution-cause.ts` 가 이 저장소의 선례다 — 상수 배열 + 파생 유니온 + 좁히기 함수 + 「각 값이 무엇을 뜻하는가」 표. 같은 모양으로 만든다.

**Files:**
- Create: `packages/domain-types/coupon-visibility.ts`
- Create: `packages/domain-types/coupon-visibility.spec.ts`
- Modify: `packages/domain-types/index.ts`

**Interfaces:**
- Produces: `COUPON_VISIBILITIES: readonly ['public','claimable','assigned_only']`
- Produces: `type CouponVisibility = 'public' | 'claimable' | 'assigned_only'`
- Produces: `isCouponVisibility(value: unknown): value is CouponVisibility`
- Produces: `toCouponVisibility(value: unknown): CouponVisibility | null`
- Consumes: 없음 (순수 TypeScript, import 0)

- [ ] **Step 1: 실패하는 스펙을 먼저 쓴다**

`packages/domain-types/coupon-visibility.spec.ts`

```ts
import {
  COUPON_VISIBILITIES,
  isCouponVisibility,
  toCouponVisibility,
} from './coupon-visibility';

describe('COUPON_VISIBILITIES', () => {
  it('어휘는 오늘 세 값이다 — 늘리려면 드리프트 가드가 가리키는 곳을 함께 고쳐야 한다', () => {
    expect([...COUPON_VISIBILITIES]).toEqual(['public', 'claimable', 'assigned_only']);
  });
});

describe('isCouponVisibility', () => {
  it('어휘 안의 값은 전부 true', () => {
    for (const v of COUPON_VISIBILITIES) {
      expect(isCouponVisibility(v)).toBe(true);
    }
  });

  it('어휘 밖의 값은 전부 false', () => {
    const outsiders: unknown[] = ['members_only', '', 'PUBLIC', null, undefined, 42, {}, ['public']];
    for (const v of outsiders) {
      expect(isCouponVisibility(v)).toBe(false);
    }
  });
});

describe('toCouponVisibility', () => {
  it('값이 없으면 컬럼 기본값과 같은 public 이다', () => {
    expect(toCouponVisibility(null)).toBe('public');
    expect(toCouponVisibility(undefined)).toBe('public');
    expect(toCouponVisibility('')).toBe('public');
  });

  it('어휘 안의 값은 그대로 돌려준다', () => {
    expect(toCouponVisibility('public')).toBe('public');
    expect(toCouponVisibility('claimable')).toBe('claimable');
    expect(toCouponVisibility('assigned_only')).toBe('assigned_only');
  });

  it('어휘 밖의 값은 public 으로 접지 않고 null 로 돌려준다 — #488 N3 의 회귀 방어선', () => {
    expect(toCouponVisibility('members_only')).toBeNull();
    expect(toCouponVisibility('PUBLIC')).toBeNull();
    expect(toCouponVisibility(3)).toBeNull();
    expect(toCouponVisibility({ visibility: 'public' })).toBeNull();
  });
});
```

- [ ] **Step 2: 스펙이 실패하는 것을 확인한다**

Run: `npx jest packages/domain-types/coupon-visibility.spec.ts --maxWorkers=2`
Expected: FAIL — `Cannot find module './coupon-visibility'`

- [ ] **Step 3: 정본을 만든다**

`packages/domain-types/coupon-visibility.ts`

```ts
/**
 * 쿠폰이 고객에게 닿는 경로 (#488 N3).
 *
 * 가르는 기준은 «누가 쓸 수 있는가» 가 아니라 **«고객이 이 쿠폰을 어떻게 갖게 되는가»** 다.
 *
 * | visibility      | 갖게 되는 경로              | 목록 노출                       |
 * |-----------------|-----------------------------|---------------------------------|
 * | `public`        | 발급 없이 누구나            | 로그인 고객 전원                |
 * | `claimable`     | 고객이 «발급받기» 를 누른다 | 미발급자에게 별도 목록으로      |
 * | `assigned_only` | 관리자가 직권 발급한다      | 발급받은 고객에게만             |
 *
 * 정본을 여기 두는 이유는 이 값이 **세 트리에 여덟 벌로 흩어져 있었고, 그중 컴파일러가
 * 잡아주는 곳이 0곳**이었기 때문이다. 네 번째 값을 더하면서 admin-web 을 놓치면 제한 쿠폰이
 * 관리자 눈에 «공개» 로 보였다.
 *
 * ⚠️ **`apps/medusa` 와 `web/almondyoung-storefront` 는 이 파일을 import 하지 않는다.**
 * medusa 는 빌드에 번들러가 없어 `@packages/*` 별칭이 런타임에 해석되지 않고, storefront 는
 * 이 값을 읽는 코드가 0곳이라 의존성을 더할 이익이 없다. 두 트리의 사본과 DB CHECK 제약과의
 * 정합은 `coupon-vocabulary-drift.spec.ts` 가 대신 지킨다.
 */
export const COUPON_VISIBILITIES = ['public', 'claimable', 'assigned_only'] as const;

export type CouponVisibility = (typeof COUPON_VISIBILITIES)[number];

/** 값이 어휘 안에 있는가. */
export function isCouponVisibility(value: unknown): value is CouponVisibility {
  return typeof value === 'string' && (COUPON_VISIBILITIES as readonly string[]).includes(value);
}

/**
 * 저장된 값을 어휘로 좁힌다. **두 실패를 구분한다.**
 *
 * - **없음(`null` · `undefined` · `''`) → `'public'`.** `promotion_meta.visibility` 컬럼이
 *   `NOT NULL DEFAULT 'public'` 이고 Medusa 읽기 경로도 전부 `?? 'public'` 이다. 즉 비어
 *   있는 것은 정상이고 «공개» 를 뜻한다.
 * - **어휘 밖 → `null`.** 여기서 `'public'` 으로 접으면 안 된다. 그것이 #488 N3 이 지적한
 *   바로 그 버그다(모르는 값이 «공개» 로 렌더된다). 호출부가 «모른다» 를 눈에 보이게
 *   렌더할 수 있도록 두 경우를 다른 값으로 돌려준다.
 */
export function toCouponVisibility(value: unknown): CouponVisibility | null {
  if (value == null || value === '') return 'public';
  return isCouponVisibility(value) ? value : null;
}
```

- [ ] **Step 4: 패키지 배럴에 붙인다**

`packages/domain-types/index.ts` — 마지막 `export * from './listing-resolution-cause';` 아래에 한 줄 추가:

```ts
export * from './coupon-visibility';
```

- [ ] **Step 5: 스펙이 통과하는 것을 확인한다**

Run: `npx jest packages/domain-types --maxWorkers=2`
Expected: PASS — 3 suites (기존 2 + 신규 1), 기존 6 tests + 신규 6 tests

- [ ] **Step 6: 루트 타입 게이트**

Run: `npm run type-check`
Expected: 에러 0 (기준선과 동일). `libs/shared/src/index.ts:24` 가 `@packages/domain-types` 를 통째로 재수출하므로 이름 충돌이 나면 여기서 잡힌다 — 2026-08-30 사전 grep 기준 `CouponVisibility`·`COUPON_VISIBILITIES` 는 저장소 전체에서 0건이었다.

- [ ] **Step 7: 커밋**

```bash
git add packages/domain-types/coupon-visibility.ts packages/domain-types/coupon-visibility.spec.ts packages/domain-types/index.ts
git commit -m "feat(packages): 쿠폰 노출 어휘 정본을 domain-types 에 둔다 (#488 N3, P3)"
```

---

### Task 2: 컴파일러가 못 닿는 곳을 드리프트 가드로 덮는다

정본을 import 할 수 없는 트리(medusa · 마이그레이션 SQL · storefront · channel-adapter)의 **소스 리터럴을 읽어 정본과 대조**한다. 앵커 정규식이 안 맞으면 **그것도 실패**로 다룬다 — 선언이 리팩터로 옮겨졌는데 가드가 조용히 통과하는 것이 가장 나쁜 결과이기 때문이다.

이 가드는 `visibility` 뿐 아니라 `auto_issue_trigger` 도 덮는다. 트리거는 **공유 타입을 만들지 않는다**(ADR-0033 §7 의 결정) — 그러나 §7 이 스스로 적은 「컴파일러가 잡아주는 것은 하나도 없다」는 가드로 닫을 수 있고, 가드는 타입이 아니라 검사이므로 §7 과 충돌하지 않는다.

**Files:**
- Create: `packages/domain-types/coupon-vocabulary-drift.spec.ts`

**Interfaces:**
- Consumes: `COUPON_VISIBILITIES` (Task 1)
- Produces: 없음 (스펙 전용). **admin-web 의 트리거 어휘 사본은 Task 3 에서 이 파일에 한 항목으로 추가된다** — 그 파일이 아직 없으므로 여기서는 넣지 않는다.

- [ ] **Step 1: 가드 스펙을 쓴다**

`packages/domain-types/coupon-vocabulary-drift.spec.ts`

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { COUPON_VISIBILITIES } from './coupon-visibility';

/**
 * 어휘 드리프트 가드 (#488 N3 · ADR-0033 §7).
 *
 * 쿠폰의 두 어휘(`visibility` · `auto_issue_trigger`)는 컴파일러가 닿을 수 없는 곳에도
 * 산다 — Medusa 트리(번들러가 없어 `@packages/*` 를 런타임에 해석하지 못한다), 마이그레이션의
 * DB CHECK 제약(애초에 TypeScript 가 아니다), storefront DTO(읽는 코드가 0곳이라 의존성을
 * 더할 이유가 없다), channel-adapter 의 인라인 시그니처.
 *
 * 그래서 **소스의 리터럴을 읽어 정본과 대조한다.** 값을 하나 늘리면 이 스펙이 그 값을 아직
 * 안 고친 곳을 전부 이름으로 지목한다 — ADR-0033 §7 의 체크리스트를 사람이 지키는 표에서
 * 기계가 지키는 검사로 바꾼 것이다.
 *
 * ⚠️ 이 가드는 **파일 경로와 앵커 정규식에 의존한다.** 선언을 옮기면 앵커가 안 맞아 실패하는데,
 * 그것은 버그가 아니라 의도다 — 조용히 통과하는 가드보다 시끄럽게 죽는 가드가 낫다.
 * 옮겼다면 아래 표의 경로·앵커를 같이 고칠 것.
 */

const REPO_ROOT = join(__dirname, '..', '..');

/** `auto_issue_trigger` 어휘. 정본은 `apps/medusa/.../promotion-meta/service.ts` 이고 여기는 사본이다 — ADR-0033 §7 이 공유 타입을 아직 만들지 않기로 했기 때문이다. */
const AUTO_ISSUE_TRIGGERS = ['customer_registered', 'membership_activated', 'birthday'] as const;

interface Site {
  /** 실패 메시지에 그대로 나가는 사람이 읽는 이름. */
  readonly name: string;
  readonly path: string;
  /** 선언 한 덩어리를 잡는 앵커. 캡처그룹 1번 안의 문자열 리터럴만 본다. */
  readonly anchor: RegExp;
}

function extractVocabulary(site: Site): string[] {
  const source = readFileSync(join(REPO_ROOT, site.path), 'utf8');
  const matched = source.match(site.anchor);
  if (!matched) {
    throw new Error(
      `[어휘 가드] 앵커를 찾지 못했다: ${site.name} (${site.path})\n` +
        `선언이 옮겨졌거나 형태가 바뀌었다. packages/domain-types/coupon-vocabulary-drift.spec.ts 의 앵커를 갱신할 것.`,
    );
  }
  const literals = [...matched[1].matchAll(/['"]([a-zA-Z_]+)['"]/g)].map((m) => m[1]);
  return [...new Set(literals)].sort();
}

const VISIBILITY_SITES: Site[] = [
  {
    name: 'medusa PromotionMetaData.visibility 유니온',
    path: 'apps/medusa/src/modules/promotion-meta/service.ts',
    anchor: /visibility\?:\s*([^;]+);/,
  },
  {
    name: 'medusa upsert() 인라인 검증 배열',
    path: 'apps/medusa/src/modules/promotion-meta/service.ts',
    anchor: /\[([^\]]*)\]\.includes\(data\.visibility\)/,
  },
  {
    name: 'DB CHECK 제약 (Migration20260526140000)',
    path: 'apps/medusa/src/modules/promotion-meta/migrations/Migration20260526140000.ts',
    anchor: /visibility IN \(([^)]*)\)/,
  },
  {
    name: 'storefront PromotionDto.visibility 유니온',
    path: 'web/almondyoung-storefront/src/lib/types/dto/promotion.ts',
    anchor: /visibility\?:\s*([^\n]+)/,
  },
];

const TRIGGER_SITES: Site[] = [
  {
    name: 'medusa AutoIssueTrigger 타입',
    path: 'apps/medusa/src/modules/promotion-meta/service.ts',
    anchor: /export type AutoIssueTrigger = ([^;]+);/,
  },
  {
    name: 'medusa upsert() 인라인 검증 배열',
    path: 'apps/medusa/src/modules/promotion-meta/service.ts',
    anchor: /\[([^\]]*)\]\.includes\(data\.auto_issue_trigger\)/,
  },
  {
    name: 'medusa issue-coupons 라우트 VALID_TRIGGERS',
    path: 'apps/medusa/src/api/admin/customers/[id]/issue-coupons/route.ts',
    anchor: /VALID_TRIGGERS[^=]*=\s*\[([^\]]*)\]/,
  },
  {
    name: 'DB CHECK 제약 (Migration20260527100000)',
    path: 'apps/medusa/src/modules/promotion-meta/migrations/Migration20260527100000.ts',
    anchor: /auto_issue_trigger IN \(([^)]*)\)/,
  },
  {
    name: 'channel-adapter issuePromotionsByTrigger 시그니처',
    path: 'apps/channel-adapter/src/adapters/medusa/medusa.client.ts',
    anchor: /issuePromotionsByTrigger\([^)]*?trigger:\s*([^,)]+),/s,
  },
];

describe('쿠폰 visibility 어휘는 저장소 전체에서 하나다', () => {
  const expected = [...COUPON_VISIBILITIES].sort();

  // `it.each` 대신 평범한 루프인 것은 의도다 — 타입 추론이 개입하지 않아 루트 `tsc --noEmit`
  // 에서 터질 여지가 없고, 실패 메시지에 사이트 이름이 그대로 나온다.
  for (const site of VISIBILITY_SITES) {
    it(site.name, () => {
      expect(extractVocabulary(site)).toEqual(expected);
    });
  }
});

describe('쿠폰 auto_issue_trigger 어휘는 저장소 전체에서 하나다 (ADR-0033 §7)', () => {
  const expected = [...AUTO_ISSUE_TRIGGERS].sort();

  for (const site of TRIGGER_SITES) {
    it(site.name, () => {
      expect(extractVocabulary(site)).toEqual(expected);
    });
  }
});
```

- [ ] **Step 2: 가드가 오늘의 소스에 대해 초록인 것을 확인한다**

Run: `npx jest packages/domain-types/coupon-vocabulary-drift.spec.ts --maxWorkers=2`
Expected: PASS — 9 tests (visibility 4 + trigger 5)

만약 한 항목이라도 빨갛다면 그것은 **오늘 이미 드리프트가 있다는 뜻**이다. 가드를 느슨하게 고치지 말고, 실패가 가리키는 파일을 열어 실제 리터럴을 확인한 뒤 보고할 것.

- [ ] **Step 3: 가드가 실제로 드리프트를 잡는지 확인한다 (가드의 가드)**

가드가 앵커를 잘못 잡아 항상 통과하는 것이 가장 위험하다. **일시적으로 소스를 오염시켜 빨개지는 것을 눈으로 확인하고 되돌린다.**

```bash
# storefront DTO 에 4번째 값을 넣어 본다
sed -i 's/"public" | "claimable" | "assigned_only"/"public" | "claimable" | "assigned_only" | "members_only"/' \
  web/almondyoung-storefront/src/lib/types/dto/promotion.ts
npx jest packages/domain-types/coupon-vocabulary-drift.spec.ts --maxWorkers=2
```
Expected: FAIL — `storefront PromotionDto.visibility 유니온` 한 건만 빨갛고, 메시지에 `members_only` 가 보인다.

```bash
git checkout -- web/almondyoung-storefront/src/lib/types/dto/promotion.ts
npx jest packages/domain-types/coupon-vocabulary-drift.spec.ts --maxWorkers=2
```
Expected: PASS — 9 tests. `git status --short` 가 깨끗해야 한다.

- [ ] **Step 4: 앵커 소실도 잡는지 확인한다**

```bash
# medusa 유니온 선언의 이름을 바꿔 앵커를 깨뜨린다
sed -i 's/export type AutoIssueTrigger = /export type AutoIssueTriggerX = /' \
  apps/medusa/src/modules/promotion-meta/service.ts
npx jest packages/domain-types/coupon-vocabulary-drift.spec.ts --maxWorkers=2
```
Expected: FAIL — `[어휘 가드] 앵커를 찾지 못했다: medusa AutoIssueTrigger 타입` 메시지

```bash
git checkout -- apps/medusa/src/modules/promotion-meta/service.ts
npx jest packages/domain-types/coupon-vocabulary-drift.spec.ts --maxWorkers=2
```
Expected: PASS — 9 tests. `git status --short` 가 깨끗해야 한다.

- [ ] **Step 5: 게이트**

Run: `npx jest packages/domain-types --maxWorkers=2` → PASS (4 suites)
Run: `npm run type-check` → 에러 0

- [ ] **Step 6: 커밋**

```bash
git add packages/domain-types/coupon-vocabulary-drift.spec.ts
git commit -m "test(packages): 쿠폰 어휘 드리프트를 가드로 잡는다 (#488 N3, ADR-0033 §7, P3)"
```

---

### Task 3: admin-web 의 판정·라벨을 `.ts` 로 뽑고 어휘 전체를 덮게 만든다

**P1 교훈 2 를 정면으로 적용하는 태스크다.** 오늘 `getCouponMeta` 와 라벨 맵은 `.tsx` 안에 있고, `npm run test:admin-web` 의 transform 은 `^.+\.(t|j)s$` 라 **`.tsx` 는 테스트가 실행조차 되지 않는다.** 「관리자가 무엇을 보는가」의 판정이 검증 밖에 있다는 뜻이다. 이 태스크가 그것을 `.ts` 로 옮긴다.

이 태스크는 **행동을 바꾸는 태스크다** — 어휘 밖 값의 표시가 «공개» 에서 «알 수 없음» 으로 바뀐다. 그것이 N3 의 수정 자체다.

**Files:**
- Create: `apps/admin-web/src/features/mall/marketing/coupons/lib/coupon-meta.ts`
- Create: `apps/admin-web/src/features/mall/marketing/coupons/lib/coupon-meta.spec.ts`
- Create: `apps/admin-web/src/features/mall/marketing/coupons/lib/coupon-labels.ts`
- Create: `apps/admin-web/src/features/mall/marketing/coupons/lib/coupon-labels.spec.ts`
- Modify: `apps/admin-web/src/features/mall/marketing/coupons/coupon-helpers.tsx:29-59`
- Modify: `packages/domain-types/coupon-vocabulary-drift.spec.ts` (`TRIGGER_SITES` 에 항목 1개 추가)

**Interfaces:**
- Consumes: `COUPON_VISIBILITIES`, `CouponVisibility`, `toCouponVisibility` (Task 1)
- Produces: `getCouponMeta(coupon: MedusaPromotion): CouponMeta` — 기존과 **같은 이름·같은 시그니처**, `visibility` 필드 타입만 `CouponVisibility | null` 로 넓어진다
- Produces: `interface CouponMeta`
- Produces: `AUTO_ISSUE_TRIGGERS: readonly ['customer_registered','membership_activated','birthday']`, `type AutoIssueTrigger`, `AUTO_ISSUE_TRIGGER_LABELS: Record<AutoIssueTrigger,string>`, `toAutoIssueTrigger(value: unknown): AutoIssueTrigger | null`
- Produces: `VISIBILITY_BADGE`, `VISIBILITY_DETAIL_LABEL`, `VISIBILITY_SELECT_LABEL` (셋 다 `Record<CouponVisibility,…>`), `UNKNOWN_VISIBILITY`, `visibilityBadge(v)`, `visibilityDetailLabel(v)`

- [ ] **Step 1: 판정 스펙을 먼저 쓴다**

`apps/admin-web/src/features/mall/marketing/coupons/lib/coupon-meta.spec.ts`

```ts
import type { MedusaPromotion } from '@/lib/api/domains/medusa/promotions';
import { getCouponMeta, toAutoIssueTrigger, AUTO_ISSUE_TRIGGER_LABELS, AUTO_ISSUE_TRIGGERS } from './coupon-meta';

function promo(metadata: Record<string, unknown> | null): MedusaPromotion {
  return {
    id: 'promo_1',
    code: 'WELCOME10',
    type: 'standard',
    status: 'active',
    is_automatic: false,
    campaign_id: null,
    metadata,
  } as MedusaPromotion;
}

describe('getCouponMeta', () => {
  it('메타가 없으면 전부 비어 있고 visibility 는 컬럼 기본값인 public 이다', () => {
    expect(getCouponMeta(promo(null))).toEqual({
      name: undefined,
      maxDiscountAmount: null,
      maxClaims: null,
      issuedCount: null,
      createdBy: undefined,
      visibility: 'public',
      autoIssueTrigger: null,
    });
  });

  it('숫자 필드는 문자열로 와도 숫자로 옮긴다', () => {
    const meta = getCouponMeta(promo({ max_discount_amount: '30000', max_claims: '100', issued_count: '7' }));
    expect(meta.maxDiscountAmount).toBe(30000);
    expect(meta.maxClaims).toBe(100);
    expect(meta.issuedCount).toBe(7);
  });

  it('0 은 없음이 아니다 — issued_count 0 이 null 로 접히면 발급 현황이 사라진다', () => {
    expect(getCouponMeta(promo({ issued_count: 0 })).issuedCount).toBe(0);
  });

  it('어휘 안의 visibility 는 그대로 싣는다', () => {
    expect(getCouponMeta(promo({ visibility: 'claimable' })).visibility).toBe('claimable');
    expect(getCouponMeta(promo({ visibility: 'assigned_only' })).visibility).toBe('assigned_only');
  });

  it('어휘 밖의 visibility 는 null 이다 — public 으로 접지 않는다 (#488 N3)', () => {
    expect(getCouponMeta(promo({ visibility: 'members_only' })).visibility).toBeNull();
  });

  it('어휘 밖의 auto_issue_trigger 는 null 이다 — 라벨 조회가 undefined 를 렌더하지 않게', () => {
    expect(getCouponMeta(promo({ auto_issue_trigger: 'first_purchase' })).autoIssueTrigger).toBeNull();
    expect(getCouponMeta(promo({ auto_issue_trigger: 'birthday' })).autoIssueTrigger).toBe('birthday');
  });
});

describe('toAutoIssueTrigger', () => {
  it('어휘 안의 값만 통과한다', () => {
    for (const t of AUTO_ISSUE_TRIGGERS) {
      expect(toAutoIssueTrigger(t)).toBe(t);
    }
    for (const v of ['first_purchase', '', null, undefined, 7] as unknown[]) {
      expect(toAutoIssueTrigger(v)).toBeNull();
    }
  });
});

describe('AUTO_ISSUE_TRIGGER_LABELS', () => {
  it('트리거 어휘 전체를 덮는다', () => {
    expect(Object.keys(AUTO_ISSUE_TRIGGER_LABELS).sort()).toEqual([...AUTO_ISSUE_TRIGGERS].sort());
  });
});
```

- [ ] **Step 2: 라벨 스펙을 쓴다**

`apps/admin-web/src/features/mall/marketing/coupons/lib/coupon-labels.spec.ts`

```ts
import { COUPON_VISIBILITIES } from '@packages/domain-types';
import {
  VISIBILITY_BADGE,
  VISIBILITY_DETAIL_LABEL,
  VISIBILITY_SELECT_LABEL,
  UNKNOWN_VISIBILITY,
  visibilityBadge,
  visibilityDetailLabel,
} from './coupon-labels';

const vocabulary = [...COUPON_VISIBILITIES].sort();

describe('세 라벨 표면은 어휘 전체를 덮는다', () => {
  it('목록 배지', () => {
    expect(Object.keys(VISIBILITY_BADGE).sort()).toEqual(vocabulary);
  });
  it('상세 다이얼로그', () => {
    expect(Object.keys(VISIBILITY_DETAIL_LABEL).sort()).toEqual(vocabulary);
  });
  it('생성 드롭다운', () => {
    expect(Object.keys(VISIBILITY_SELECT_LABEL).sort()).toEqual(vocabulary);
  });
});

describe('오늘의 문구를 그대로 유지한다 — 이 태스크는 표시 문구를 바꾸는 작업이 아니다', () => {
  it('배지', () => {
    expect(VISIBILITY_BADGE.public.label).toBe('공개');
    expect(VISIBILITY_BADGE.claimable.label).toBe('발급받기');
    expect(VISIBILITY_BADGE.assigned_only.label).toBe('지정발급');
  });

  it('상세는 assigned_only 만 문구가 다르다', () => {
    expect(VISIBILITY_DETAIL_LABEL.public).toBe('공개');
    expect(VISIBILITY_DETAIL_LABEL.claimable).toBe('발급받기');
    expect(VISIBILITY_DETAIL_LABEL.assigned_only).toBe('발급 고객 전용');
  });
});

describe('어휘 밖 값은 «공개» 로 렌더되지 않는다 — #488 N3 의 회귀 방어선', () => {
  it('배지', () => {
    expect(visibilityBadge(null)).toEqual(UNKNOWN_VISIBILITY);
    expect(visibilityBadge(null).label).not.toBe('공개');
  });

  it('상세', () => {
    expect(visibilityDetailLabel(null)).toBe(UNKNOWN_VISIBILITY.label);
    expect(visibilityDetailLabel(null)).not.toBe('공개');
  });

  it('어휘 안의 값은 각자의 맵을 그대로 돌려준다', () => {
    for (const v of COUPON_VISIBILITIES) {
      expect(visibilityBadge(v)).toBe(VISIBILITY_BADGE[v]);
      expect(visibilityDetailLabel(v)).toBe(VISIBILITY_DETAIL_LABEL[v]);
    }
  });
});
```

- [ ] **Step 3: 두 스펙이 실패하는 것을 확인한다**

Run: `npx jest --roots ./apps/admin-web --transform '{"^.+\\.(t|j)s$":["ts-jest",{"tsconfig":"apps/admin-web/tsconfig.jest.json"}]}' coupons/lib`
Expected: FAIL — `Cannot find module './coupon-meta'` / `'./coupon-labels'`

- [ ] **Step 4: `coupon-meta.ts` 를 만든다**

`apps/admin-web/src/features/mall/marketing/coupons/lib/coupon-meta.ts`

```ts
import type { MedusaPromotion } from '@/lib/api/domains/medusa/promotions';
import { type CouponVisibility, toCouponVisibility } from '@packages/domain-types';

/**
 * 쿠폰 자동발급 트리거 어휘.
 *
 * 정본은 Medusa 의 `apps/medusa/src/modules/promotion-meta/service.ts` 이고 여기는 **사본**이다
 * — 공유 타입으로 합치지 않기로 한 것은 ADR-0033 §7 의 결정이다(실사용 0). 사본이 정본과
 * 어긋나면 `packages/domain-types/coupon-vocabulary-drift.spec.ts` 가 빨개진다.
 */
export const AUTO_ISSUE_TRIGGERS = ['customer_registered', 'membership_activated', 'birthday'] as const;

export type AutoIssueTrigger = (typeof AUTO_ISSUE_TRIGGERS)[number];

export const AUTO_ISSUE_TRIGGER_LABELS: Record<AutoIssueTrigger, string> = {
  customer_registered: '회원가입 완료',
  membership_activated: '멤버십 가입',
  birthday: '생일 (미구현 — 발급되지 않음)',
};

/** 어휘 밖 값은 `null`. 그대로 통과시키면 라벨 조회가 `undefined` 를 렌더한다. */
export function toAutoIssueTrigger(value: unknown): AutoIssueTrigger | null {
  return typeof value === 'string' && (AUTO_ISSUE_TRIGGERS as readonly string[]).includes(value)
    ? (value as AutoIssueTrigger)
    : null;
}

export interface CouponMeta {
  name: string | undefined;
  maxDiscountAmount: number | null;
  maxClaims: number | null;
  issuedCount: number | null;
  createdBy: string | undefined;
  /**
   * `null` = 서버가 우리 어휘 밖의 값을 보냈다. **«공개» 로 접지 않는다** — 제한 쿠폰이
   * 관리자 눈에 공개로 보이던 것이 #488 N3 이다. 표시는 `visibilityBadge` 가 맡는다.
   */
  visibility: CouponVisibility | null;
  autoIssueTrigger: AutoIssueTrigger | null;
}

/**
 * 어드민 프로모션 응답의 `metadata`(우리가 `promotion_meta` 에서 **합성한 것**)를 화면이 쓰는
 * 모양으로 옮긴다. 스토어 응답의 `metadata` 와는 다른 물건이다 — ADR-0033 결정 5 참조.
 *
 * `.tsx` 가 아니라 `.ts` 에 사는 이유: admin-web 의 jest transform 이 `^.+\.(t|j)s$` 라
 * `.tsx` 안의 판정은 테스트가 실행조차 되지 않는다.
 */
export function getCouponMeta(coupon: MedusaPromotion): CouponMeta {
  const meta = (coupon.metadata ?? {}) as Record<string, unknown>;
  return {
    name: meta.name as string | undefined,
    maxDiscountAmount: meta.max_discount_amount != null ? Number(meta.max_discount_amount) : null,
    maxClaims: meta.max_claims != null ? Number(meta.max_claims) : null,
    issuedCount: meta.issued_count != null ? Number(meta.issued_count) : null,
    createdBy: meta.created_by as string | undefined,
    visibility: toCouponVisibility(meta.visibility),
    autoIssueTrigger: toAutoIssueTrigger(meta.auto_issue_trigger),
  };
}
```

- [ ] **Step 5: `coupon-labels.ts` 를 만든다**

`apps/admin-web/src/features/mall/marketing/coupons/lib/coupon-labels.ts`

```ts
import type { CouponVisibility } from '@packages/domain-types';

/**
 * 발급 방식(`visibility`)의 표시 문구.
 *
 * 세 벌인 것은 중복이 아니라 **세 표면의 문구가 실제로 다르기 때문**이다 — 목록 배지는
 * 좁아서 «지정발급», 상세는 넓어서 «발급 고객 전용», 생성 드롭다운은 설명까지 붙는다.
 * 셋 다 `Record<CouponVisibility, …>` 라 어휘가 늘면 **여기서 타입 에러가 난다.** 그 전에는
 * `Record<string, …>` 이었고, 그래서 네 번째 값이 생겨도 아무 데서도 에러가 나지 않았다(#488 N3).
 */
export const VISIBILITY_BADGE: Record<CouponVisibility, { label: string; cls: string }> = {
  public: { label: '공개', cls: 'bg-slate-100 text-slate-600' },
  claimable: { label: '발급받기', cls: 'bg-blue-100 text-blue-700' },
  assigned_only: { label: '지정발급', cls: 'bg-purple-100 text-purple-700' },
};

export const VISIBILITY_DETAIL_LABEL: Record<CouponVisibility, string> = {
  public: '공개',
  claimable: '발급받기',
  assigned_only: '발급 고객 전용',
};

export const VISIBILITY_SELECT_LABEL: Record<CouponVisibility, string> = {
  public: '공개 — 모든 로그인 고객에게 노출',
  claimable: '발급받기 — 고객이 직접 발급받아야 사용 가능',
  assigned_only: '발급 고객 전용 — 관리자가 발급한 고객만 사용 가능',
};

/**
 * 어휘 밖 값의 표시.
 *
 * 예전에는 `?? VISIBILITY_LABEL.public` 이라 **모르는 값이 «공개» 로 보였다.** 발급이 제한된
 * 쿠폰을 관리자가 공개로 오인하는 경로였다(#488 N3). 모르면 모른다고 표시한다.
 */
export const UNKNOWN_VISIBILITY = { label: '알 수 없음', cls: 'bg-amber-100 text-amber-700' } as const;

export function visibilityBadge(v: CouponVisibility | null): { label: string; cls: string } {
  return v == null ? UNKNOWN_VISIBILITY : VISIBILITY_BADGE[v];
}

export function visibilityDetailLabel(v: CouponVisibility | null): string {
  return v == null ? UNKNOWN_VISIBILITY.label : VISIBILITY_DETAIL_LABEL[v];
}
```

- [ ] **Step 6: `coupon-helpers.tsx` 에서 옮긴 것들을 지우고 재수출로 잇는다**

`apps/admin-web/src/features/mall/marketing/coupons/coupon-helpers.tsx` — `export type AutoIssueTrigger …` 부터 `getCouponMeta` 함수 끝(`}` 포함, 오늘 29–59행)까지를 통째로 지우고 그 자리에 아래를 넣는다. 다른 export(`formatCouponDate`·`formatCouponDateTime`·`formatPeriod`·`StatusBadge`·`TARGET_ATTR_LABEL`)와 `import` 블록은 그대로 둔다.

```tsx
// 판정과 트리거 어휘는 `lib/coupon-meta.ts` 로 옮겼다 — `.tsx` 는 admin-web 의 jest
// transform(`^.+\.(t|j)s$`) 밖이라 여기 있으면 테스트가 실행되지 않는다.
// 아래 재수출은 Task 4 에서 호출부를 새 경로로 옮긴 뒤 제거한다.
export {
  AUTO_ISSUE_TRIGGERS,
  AUTO_ISSUE_TRIGGER_LABELS,
  getCouponMeta,
  toAutoIssueTrigger,
  type AutoIssueTrigger,
  type CouponMeta,
} from './lib/coupon-meta';
```

`import type { MedusaPromotion } …` 가 `formatPeriod` 때문에 계속 필요한지 확인하고, 안 쓰이면 지운다(`formatPeriod(coupon: MedusaPromotion)` 이 쓰므로 남는다).

- [ ] **Step 7: 드리프트 가드에 admin-web 사본을 추가한다**

`packages/domain-types/coupon-vocabulary-drift.spec.ts` 의 `TRIGGER_SITES` 배열 마지막에 항목 하나를 더한다:

```ts
  {
    name: 'admin-web AUTO_ISSUE_TRIGGERS 사본',
    path: 'apps/admin-web/src/features/mall/marketing/coupons/lib/coupon-meta.ts',
    anchor: /AUTO_ISSUE_TRIGGERS\s*=\s*\[([^\]]*)\]/,
  },
```

- [ ] **Step 8: 스펙이 통과하는 것을 확인한다**

Run: `npm run test:admin-web`
Expected: PASS — **91 suites / 753 tests** (기준선 89/737 + 신규 2 suites / 16 tests: `coupon-meta` 8 + `coupon-labels` 8). 실패 0.

Run: `npx jest packages/domain-types --maxWorkers=2`
Expected: PASS — 4 suites, 트리거 항목이 5 → 6 으로 늘어난다

- [ ] **Step 9: 타입 게이트 두 개를 모두 돌린다**

Run: `cd apps/admin-web && npx tsc --noEmit`
Expected: 에러 0

Run: `npm run type-check` (루트로 돌아와서)
Expected: 에러 0

- [ ] **Step 10: 커밋**

```bash
git add apps/admin-web/src/features/mall/marketing/coupons/lib/coupon-meta.ts \
        apps/admin-web/src/features/mall/marketing/coupons/lib/coupon-meta.spec.ts \
        apps/admin-web/src/features/mall/marketing/coupons/lib/coupon-labels.ts \
        apps/admin-web/src/features/mall/marketing/coupons/lib/coupon-labels.spec.ts \
        apps/admin-web/src/features/mall/marketing/coupons/coupon-helpers.tsx \
        packages/domain-types/coupon-vocabulary-drift.spec.ts
git commit -m "refactor(admin-web): 쿠폰 판정·라벨을 .ts 로 뽑고 어휘 전체를 덮게 한다 (#488 N3, P3)"
```

---

### Task 4: 표시·입력 경로 다섯 곳을 정본에 붙인다

여기서 **삼항 연쇄 2곳과 `Record<string,…>` 1곳이 사라진다** — N3 가 지목한 실제 결함이다. 그리고 인라인 유니온 3벌(`create-dialog` 2 + `build-create-promotion-payload` 1)이 정본으로 교체된다.

**Files:**
- Modify: `apps/admin-web/.../coupons/template/marketing-coupons-template.tsx:29,43-56,119`
- Modify: `apps/admin-web/.../coupons/components/coupon-detail-dialog.tsx:14-21,127`
- Modify: `apps/admin-web/.../coupons/components/coupon-create-dialog.tsx:39,169,486-494`
- Modify: `apps/admin-web/.../marketing/events/components/event-form-dialog.tsx:33,262`
- Modify: `apps/admin-web/.../coupons/lib/build-create-promotion-payload.ts:6,9,35`
- Modify: `apps/admin-web/.../coupons/coupon-helpers.tsx` (Task 3 이 넣은 재수출 제거)

**Interfaces:**
- Consumes: Task 3 의 `getCouponMeta`·`AUTO_ISSUE_TRIGGER_LABELS`·`AutoIssueTrigger` (`../lib/coupon-meta`), `visibilityBadge`·`visibilityDetailLabel`·`VISIBILITY_SELECT_LABEL` (`../lib/coupon-labels`), Task 1 의 `COUPON_VISIBILITIES`·`CouponVisibility`
- Produces: 없음 (호출부 배선만)

- [ ] **Step 1: 목록 배지 — `Record<string,…>` 와 `?? public` 폴백을 없앤다**

`marketing-coupons-template.tsx`

① 29행 import 를 둘로 나눈다:
```tsx
import { formatPeriod, StatusBadge } from '../coupon-helpers';
import { getCouponMeta } from '../lib/coupon-meta';
import { visibilityBadge } from '../lib/coupon-labels';
import type { CouponVisibility } from '@packages/domain-types';
```

② 43–56행의 `VISIBILITY_LABEL` 상수와 `VisibilityBadge` 함수를 통째로 아래로 교체한다:
```tsx
function VisibilityBadge({ visibility }: { visibility: CouponVisibility | null }) {
  const v = visibilityBadge(visibility);
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${v.cls}`}>
      {v.label}
    </span>
  );
}
```

③ 119행 호출부(`<VisibilityBadge visibility={visibility} />`)는 그대로 둔다 — `getCouponMeta` 가 이미 `CouponVisibility | null` 을 준다.

- [ ] **Step 2: 상세 다이얼로그 — 삼항 연쇄를 없앤다**

`coupon-detail-dialog.tsx`

① 14–21행 import 블록을 아래로 교체:
```tsx
import {
  formatCouponDateTime,
  formatPeriod,
  StatusBadge,
  TARGET_ATTR_LABEL,
} from '../coupon-helpers';
import { getCouponMeta, AUTO_ISSUE_TRIGGER_LABELS } from '../lib/coupon-meta';
import { visibilityDetailLabel } from '../lib/coupon-labels';
```

② 127행:
```tsx
            {visibilityDetailLabel(visibility)}
```

- [ ] **Step 3: 이벤트 폼 — 삼항 연쇄를 없앤다**

`event-form-dialog.tsx`

① 33행:
```tsx
import { getCouponMeta } from '../../coupons/lib/coupon-meta';
import { visibilityBadge } from '../../coupons/lib/coupon-labels';
```

② 262행:
```tsx
                          {visibilityBadge(visibility).label}
```

- [ ] **Step 4: 생성 다이얼로그 — 인라인 유니온 2벌을 없애고 드롭다운을 어휘에서 생성한다**

`coupon-create-dialog.tsx`

① 39행 아래에 import 를 더한다(39행의 `../coupon-helpers` import 는 `../lib/coupon-meta` 로 옮긴다):
```tsx
import { type AutoIssueTrigger, AUTO_ISSUE_TRIGGER_LABELS } from '../lib/coupon-meta';
import { VISIBILITY_SELECT_LABEL } from '../lib/coupon-labels';
import { COUPON_VISIBILITIES, type CouponVisibility } from '@packages/domain-types';
```

② 169행:
```tsx
  const [visibility, setVisibility] = useState<CouponVisibility>('public');
```

③ 486–494행의 `<Select>` 블록을 아래로 교체한다. **`<SelectItem>` 을 손으로 나열하지 않고 어휘에서 생성한다** — 네 번째 값이 생기면 드롭다운에 자동으로 나타나고, 라벨을 안 적으면 `VISIBILITY_SELECT_LABEL` 에서 타입 에러가 난다:
```tsx
            <Select value={visibility} onValueChange={(v) => setVisibility(v as CouponVisibility)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {COUPON_VISIBILITIES.map((v) => (
                  <SelectItem key={v} value={v}>{VISIBILITY_SELECT_LABEL[v]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
```

- [ ] **Step 5: 페이로드 빌더의 로컬 `Visibility` 를 정본으로 바꾼다**

`build-create-promotion-payload.ts`

① 6행:
```ts
import type { AutoIssueTrigger } from './coupon-meta';
import type { CouponVisibility } from '@packages/domain-types';
```
(`.ts` 가 `.tsx` 를 import 하던 사슬이 여기서 끊긴다 — `import type` 이라 오늘도 동작하지만, 값 import 로 바뀌는 순간 jest 가 죽을 자리였다.)

② 9행의 `export type Visibility = 'public' | 'claimable' | 'assigned_only';` 를 **삭제**한다. 저장소 전체에서 이 타입을 import 하는 곳은 0곳이다(2026-08-30 grep).

③ 35행:
```ts
  visibility: CouponVisibility;
```

- [ ] **Step 6: `coupon-helpers.tsx` 의 재수출을 제거한다**

Task 3 Step 6 에서 넣은 `export { … } from './lib/coupon-meta';` 블록을 지운다. 위 다섯 파일이 새 경로를 직접 부르므로 더 필요 없다.

- [ ] **Step 7: 옛 심볼이 남아 있지 않은지 확인한다**

```bash
grep -rn "VISIBILITY_LABEL\b" apps/admin-web/src | grep -v node_modules
grep -rn "'public' | 'claimable' | 'assigned_only'" apps/admin-web/src | grep -v node_modules
grep -rn "coupon-helpers" apps/admin-web/src | grep -v node_modules
```
Expected: 앞의 둘은 **0건**. 세 번째는 `formatPeriod`·`StatusBadge`·`TARGET_ATTR_LABEL`·`formatCouponDateTime` 을 쓰는 파일만 남는다(`getCouponMeta`·`AUTO_ISSUE_TRIGGER_LABELS` 를 `coupon-helpers` 에서 가져오는 줄은 0건이어야 한다).

- [ ] **Step 8: 게이트 네 개를 전부 돌린다**

Run: `npm run test:admin-web` → **91 suites / 753 tests 통과** (Task 3 과 동일 — 이 태스크는 스펙을 늘리지 않는다)
Run: `cd apps/admin-web && npx tsc --noEmit` → 에러 0
Run: `npm run type-check` → 에러 0
Run: `npx jest packages/domain-types --maxWorkers=2` → 4 suites 통과

- [ ] **Step 9: 커밋**

```bash
git add apps/admin-web/src/features/mall/marketing
git commit -m "refactor(admin-web): 쿠폰 노출 방식 표시·입력을 어휘 정본에 붙인다 (#488 N3, P3)"
```

---

### Task 5: 정본 포인터를 남긴다 — 주석 · ADR · 로드맵

가드는 어긋났을 때 **사후에** 소리를 낸다. 값을 늘리려는 사람이 **사전에** 정본과 절차를 만나게 하는 것은 주석과 ADR 이다. P1 의 교훈이 「검증되지 않을 자리에 검사를 두지 말라」였다면, 이 태스크는 그 짝인 「기록되지 않은 규약은 다음 사람에게 존재하지 않는다」다.

**Files:**
- Modify: `apps/medusa/src/modules/promotion-meta/service.ts:7,16` 앞 (주석만)
- Modify: `web/almondyoung-storefront/src/lib/types/dto/promotion.ts:31` 앞 (주석만)
- Modify: `docs/adr/0033-coupons-are-owned-by-the-sales-channel.md` §7
- Modify: `docs/superpowers/plans/2026-08-29-coupon-domain-master-plan.md`

**Interfaces:**
- Consumes: 없음
- Produces: 없음

- [ ] **Step 1: medusa 쪽 주석**

`apps/medusa/src/modules/promotion-meta/service.ts` — `export type AutoIssueTrigger` (7행) 바로 위에 넣는다:

```ts
// 쿠폰 어휘(`AutoIssueTrigger` · `PromotionMetaData.visibility`)는 이 트리 밖에도 사본이 있다.
// 값을 늘리거나 줄이면 `packages/domain-types/coupon-vocabulary-drift.spec.ts` 가 빨개지며
// 함께 고쳐야 할 곳을 전부 이름으로 지목한다(마이그레이션 CHECK 제약 포함).
// `visibility` 의 타입 정본은 `@packages/domain-types` 에 있으나 **여기서 import 할 수 없다**
// — Medusa 빌드에는 번들러가 없어 `@packages/*` 별칭이 런타임에 해석되지 않는다.
```

- [ ] **Step 2: storefront 쪽 주석**

`web/almondyoung-storefront/src/lib/types/dto/promotion.ts` — `visibility?:` 줄 바로 위에 넣는다:

```ts
  /**
   * 어휘 정본은 `@packages/domain-types` 의 `CouponVisibility` 다. 여기서 import 하지 않는 것은
   * 이 필드를 읽는 코드가 storefront 에 0곳이라 의존성을 더할 이익이 없어서다.
   * 정본과 어긋나면 `packages/domain-types/coupon-vocabulary-drift.spec.ts` 가 잡는다.
   */
```

- [ ] **Step 3: ADR-0033 §7 을 갱신한다**

`docs/adr/0033-coupons-are-owned-by-the-sales-channel.md` 의 §7 마지막 두 문단(「5번의 라벨 맵만 …」 문단과 「따라서 트리거를 추가할 때는 …」 문단) 사이에, 그리고 표 아래에 아래를 반영한다.

① §7 의 제목 줄 아래 첫 문단은 그대로 두고, **표 다음에 다음 절을 통째로 삽입**한다:

```markdown
#### 2026-08-30 갱신 — 어휘가 두 축이고, 드리프트는 이제 테스트가 잡는다 (#488 N3, P3)

`auto_issue_trigger` 만의 문제가 아니었다. **`visibility` 도 정확히 같은 병을 앓고 있었고 사본이
여덟 벌이었다**(#488 N3). 두 축을 다르게 처리했다.

| 축 | 처방 | 이유 |
|---|---|---|
| `visibility` | **`@packages/domain-types` 의 공유 타입**(`CouponVisibility`). admin-web 이 실제로 import 한다 | 표시 버그가 이미 나 있었다 — 라벨 맵이 `Record<string,…>` 이고 삼항 연쇄 2곳이 **모르는 값을 «공개» 로 렌더**했다 |
| `auto_issue_trigger` | **공유 타입을 만들지 않는다.** 위 표대로 사본을 유지한다 | 실사용이 0이라는 이 절의 판단은 그대로 유효하다 |

**두 축 모두 `packages/domain-types/coupon-vocabulary-drift.spec.ts` 가 덮는다.** 이 스펙은
사본들의 **소스 리터럴을 읽어** 정본과 대조하며, 앵커를 못 찾아도 실패한다. 그래서 위 표는
이제 사람이 지키는 체크리스트가 아니라 **기계가 지키는 검사**다 — 값을 하나 늘리면 아직 안 고친
곳이 전부 이름으로 지목된다. DB CHECK 제약(4번)까지 덮으므로, 어떤 공유 타입보다 커버리지가 넓다.

**`apps/medusa` 와 `web/almondyoung-storefront` 는 공유 타입을 import 하지 않으며, 앞으로도
그럴 것이다.** medusa 는 빌드에 번들러가 없어(`nest build` 와 달리) `@packages/*` 별칭이 런타임에
해석되지 않는다 — import 하면 컨테이너가 부팅에서 죽는다. storefront 는 이 값을 읽는 코드가
0곳이라 `file:` 의존성과 lockfile 재생성의 위험을 지불할 이익이 없다. **두 트리에서 이 어휘를
「공유 타입으로 합치자」는 제안이 다시 나오면 이 문단을 근거로 기각할 것.**
```

② 마지막 문단의 「여섯 곳을 하나로 합치는 것은 이 ADR 의 범위가 아니다 — …」 문장을 아래로 교체한다:

```markdown
트리거 여섯 곳을 **하나의 타입으로** 합치는 것은 여전히 이 ADR 의 범위가 아니다(실사용 0). 다만
「컴파일러가 잡아주는 것은 하나도 없다」는 위 갱신의 드리프트 가드가 닫았다 — 가드는 공유 타입이
아니라 검사이므로 이 결정과 충돌하지 않는다.
```

- [ ] **Step 4: 마스터 플랜을 갱신한다**

`docs/superpowers/plans/2026-08-29-coupon-domain-master-plan.md`

① 웨이브 A 표의 P3 행을 교체:
```markdown
| **P3** `visibility` 타입 단일화 | `N3` (+ `7-3` 의 어휘 축) | `@packages` → admin-web | `2026-08-30-coupon-visibility-vocabulary.md` ✅ 실행됨 |
```

② 「진행 상황」 절:
```markdown
- [x] **P3 플랜 작성·실행 (2026-08-30)** — `2026-08-30-coupon-visibility-vocabulary.md`. `visibility` 는 `@packages/domain-types` 공유 타입으로, 트리거는 ADR-0033 §7 의 결정대로 사본 유지 + **두 축 모두 드리프트 가드로 덮음**. medusa·storefront 는 의도적으로 import 하지 않는다(근거는 플랜 본문)
- [ ] 리허설 1차  ← **다음 차례**
```

- [ ] **Step 5: 게이트 (주석·문서만 바뀌었으니 회귀가 없는지 확인)**

Run: `npx jest packages/domain-types --maxWorkers=2` → 4 suites 통과 (**주석 추가가 앵커를 깨지 않았는지** 여기서 드러난다 — medusa `service.ts` 주석이 앵커 앞에 붙으므로 실제 위험이 있다)
Run: `npm run type-check` → 에러 0
Run: `cd apps/medusa && npx tsc --noEmit` → **선재 에러 정확히 3건** (P2 가 기록한 목록: `admin/lib/sdk.ts` 2건 + `confirm-purchase.unit.spec.ts` 1건). 늘면 이 태스크가 만든 것

- [ ] **Step 6: 커밋**

```bash
git add apps/medusa/src/modules/promotion-meta/service.ts \
        web/almondyoung-storefront/src/lib/types/dto/promotion.ts \
        docs/adr/0033-coupons-are-owned-by-the-sales-channel.md \
        docs/superpowers/plans/2026-08-29-coupon-domain-master-plan.md
git commit -m "docs(coupon): 어휘 정본과 드리프트 가드를 ADR-0033 §7 에 기록한다 (#488 N3, P3)"
```

---

## 최종 검증 (전 태스크 종료 후, 한 번에)

- [ ] **모든 게이트를 순서대로 돌리고 출력을 붙인다**

> ⚠️ 루트·admin-web tsconfig 둘 다 `incremental: true` 다. 타입 게이트가 **너무 쉽게** 초록이면
> 캐시가 에러를 가린 것일 수 있다(메모리 「lint 스코프 주의」). 의심되면
> `find . -name '*.tsbuildinfo' -not -path '*/node_modules/*' -delete` 후 다시 돌린다.

```bash
cd /home/pauseb/workspace/almondyoung-server
npm run type-check                                    # 기준선: 에러 0
npx jest packages/domain-types --maxWorkers=2         # 기준선 2 suites → 4 suites
npm run test:admin-web                                # 기준선 89/737 → 91/753
(cd apps/admin-web && npx tsc --noEmit)               # 기준선: 에러 0
(cd apps/medusa && npx tsc --noEmit)                  # 기준선: 선재 3건, 늘지 않을 것
git status --short                                    # Task 2 의 오염 실험이 남아 있지 않을 것
```

- [ ] **의도한 것만 바뀌었는지 diff 로 확인한다**

```bash
git diff develop... --stat
```
Expected: `apps/medusa` 는 **`promotion-meta/service.ts` 한 파일 · 주석만**. `web/` 은 **`dto/promotion.ts` 한 파일 · 주석만**. `apps/channel-adapter` 는 **0 파일**.

- [ ] **PR 을 연다**

```bash
git push -u origin refactor/coupon-visibility-vocabulary
gh pr create --base develop --title "refactor: 쿠폰 노출 어휘를 정본 하나로 모으고 드리프트를 가드로 잡는다 (#488 N3, P3)" --body "..."
```

PR 본문에 반드시 담을 것:
- **런타임 동작 변화 3건(보이는 것 2건)**: 위 Global Constraints 의 표를 그대로 붙일 것. 셋 다 DB CHECK 제약이 막고 있어 **오늘 라이브 화면 변화 0.**
- **마이그레이션 0 · 시크릿 0 · env 0 · 이벤트 계약 0 · npm 의존성 0. 배포 순서 제약 없음.**
- **`apps/medusa` 와 `web/` 은 주석만 바뀌었다.** 근거는 플랜의 «왜 medusa 는 정본을 import 하지 않는가».
- 게이트 5개의 실제 출력.

---

## 이 플랜이 하지 않는 것 (범위 밖임을 명시)

- **`7-3` 의 본체** — 「발급 정책 평가를 Medusa 엔드포인트 뒤로 완전히 이동, channel-adapter 는 얇은 호출자로」. P3 는 7-3 이 지적한 **어휘 중복만** 다룬다. 정책 이동은 P7 (`1-5` 의 룰 분류 결정과 한 세트).
- **`1-6` (`birthday` 존폐)** — 값을 지우지도 살리지도 않는다. 마스터 플랜의 «결정 2건» 에 남는다.
- **`N6` (`promotion_meta` 리네임)** — ADR 이 「비권장」으로 이미 판단했고 P6 소유다.
- **medusa 런타임의 `visibility` 동등 비교 6곳** — 어휘가 늘어도 안전하고, 정본을 import 할 수 없다.
- **storefront 를 `@packages` 소비자로 만드는 것** — 이익 0, 위험 있음. 근거는 위 절.
