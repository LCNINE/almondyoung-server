# 쿠폰 쓰기 경로를 워크플로 훅으로 이관 (P10-A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `promotion_meta` 쓰기를 커스텀 라우트 밖에서 **워크플로 훅 안으로** 옮겨, 쿠폰 생성이 반쯤 성공했을 때 「발급 정책 없는 활성 쿠폰」이 남는 경로(`N7`)를 없앤다. 사용자에게 보이는 변화 0 · 마이그레이션 0.

**Architecture:** 세 방향으로 동시에 조인다. ① `createPromotionsWorkflow.hooks.promotionsCreated` / `promotionsUpdated` / `promotionsDeleted` (셋 다 **존재하고 비어 있다**) 안으로 메타 쓰기를 옮긴다 — 훅이 `StepResponse` 로 보상 함수를 갖고 앞 스텝도 보상되므로, 메타 쓰기가 실패하면 **프로모션 자체가 롤백된다.** ② `api/middlewares.ts` 에 `additionalDataValidator` 를 걸어 `additional_data` 안쪽을 검증한다(오늘은 코어 zod 가 `z.record(z.unknown())` 로 통과시킨다). ③ 메타가 **없을 때의 기본값을 닫힌 쪽으로** 뒤집는다. ①②만으로는 부족하다는 것이 실측으로 확인됐다(아래 「실측」 ④). 그 다음 우리 `/admin/promotions*` 에서 **쓰기 핸들러를 지우고 `GET` 만 남긴다** — Medusa 가 라우트를 메서드 단위로 병합하므로 코어 핸들러가 그대로 살아난다(실측 ①).

**Tech Stack:** Medusa v2.13.4 · TypeScript · Jest + `@swc/jest` (`apps/medusa` 자체 트리) · `medusaIntegrationTestRunner` (실 DB HTTP 통합)

**Spec:** 이슈 [#488](https://github.com/LCNINE/almondyoung-server/issues/488) — `N7` · `N8`(쓰기분) · `7-8` · 「2026-08-31 작업 순서」 절 · 로드맵 `docs/superpowers/plans/2026-08-29-coupon-domain-master-plan.md` · 경계 `docs/adr/0033-coupons-are-owned-by-the-sales-channel.md`

---

## 0. 이 플랜을 여는 실측 (2026-08-31, 로컬 스택)

> #488 이 「PR 모양이 달라지므로 먼저 닫아라」고 지목한 질문과, 그것을 닫는 과정에서 함께 나온 것들.
> **여기 적힌 것은 전부 실행 결과다. 재조사하지 말 것.**

| # | 질문 | 방법 | 결과 |
|---|---|---|---|
| ① | 우리 파일이 `GET` 만 export 하면 코어 `POST` 가 살아나는가 | 임시 디렉터리 2개로 실제 `RoutesLoader` 구동 + 우리 `route.ts` 에서 POST 제거 후 :9001 실부팅 | **살아난다. 메서드 단위 병합이다.** `POST /admin/promotions` → HTTP 200, 프로모션 생성, 응답에 `metadata` 없음(= 코어 핸들러) |
| ② | 왜 메서드 단위인가 | `@medusajs/framework/dist/http/routes-loader.js` `registerRoute` | `#routes[matcher][method] = route` — 키가 **파일이 아니라 (경로, 메서드)** 다. 프로젝트 `src/api` 는 마지막에 스캔된다(`medusa/dist/loaders/api.js:41` + `utils/dist/common/get-resolved-plugins.js` 가 프로젝트를 마지막 플러그인으로 push) → 나중이 이긴다 |
| ③ | 코어 validator 가 우리 라우트에도 붙는가 | 최상위 `max_discount_amount` 를 실제 POST | **붙는다.** `Invalid request: Unrecognized fields: 'max_discount_amount'` **400** (`N8` 재확인) |
| ④ | `additionalDataValidator` 를 우리 `middlewares.ts` 에 걸면 코어 POST 에 먹는가 | 임시 등록 후 4발 | `visibility:"bogus_value"` → **400 이고 `promotion` 행이 남지 않는다**(`N7` 회귀 테스트가 그대로 성립) |
| ⑤ | 🔴 그 validator 가 **못 막는 것** | 같은 부팅에서 `additional_data` 자체를 생략 | **200, `promotion_meta` 0행.** 프레임워크가 `z.object(shape).nullish()` 로 감싸므로(`middleware-file-loader.js:153`) **객체 자체가 선택**이다. 안쪽 `visibility` 를 required 로 둬도 「메타 없는 쿠폰」은 계속 만들어진다 |
| ⑥ | 미지 키 처리 | `additional_data:{visibility:"public", totally_unknown:123}` | **200, 조용히 strip.** `z.object` 기본이 strip 이고 `.strict()` 를 끼워넣을 API 표면이 없다 → **validator 스키마에 안 적은 키는 훅까지 도달하지 못한다** |

**⑤가 이 플랜의 형태를 정한다.** 「닫힌 기본값」은 곁다리 청소가 아니라 ⑤를 막는 **유일한** 장치다.
**⑥은 P10-B 로 넘어간다** — `max_discount_amount` 를 validator 스키마에 안 적으면 폼이 보낸 값이 조용히 사라진다. Task 3 이 그걸 **테스트로** 막는다(스키마 키 집합 ⊇ `META_KEYS`).

프로브로 만든 프로모션 4건은 삭제했고, 임시 편집 2파일은 되돌렸다(트리 클린 확인).

---

## Global Constraints

- **마이그레이션 0건 · 시크릿 0건 · env 0건 · 이벤트 계약 0건.** `promotion_meta` 스키마는 손대지 않는다.
- **사용자에게 보이는 변화 0.** 어드민 화면·스토어프론트 화면·API 응답 스키마가 그대로여야 한다. 유일한 의도된 행동 변화는 **「메타가 없는 프로모션」의 취급**이며, 그런 프로모션은 라이브에 0건이다(아래 「라이브 상태」).
- **배포 순서 제약 없음.** admin-web 은 create/update/delete **응답 본문을 읽지 않는다**(`lib/services/coupons/mutations.ts` 가 `invalidateQueries` 만 한다 — 2026-08-31 확인). 응답 모양이 코어 것으로 바뀌어도 옛 admin-web 이 깨지지 않는다. 애초에 SST 한 스택에는 앱 간 배포 순서를 강제할 수단이 없다(메모리 「SST 한 스택엔 배포 순서가 없다」).
- **라이브 상태 = 지금이 가장 싸다.** 쿠폰이 적용된 주문 0건, active 프로모션 0개(ADR-0033 측정, 2026-08-28). **백필이 없다.**
- **`GET` override 는 남긴다.** `/admin/promotions` · `/admin/promotions/:id` 의 `GET` 은 admin-web 이 `metadata`(=`visibility`·`issued_count`)를 받는 유일한 통로다. 읽기 override 의 위험은 「코어 개선을 못 받는다」뿐이고 원자성·검증과 무관하다(`N8` 범위 결정).
- **쿠폰 밖 코어 라우트 override 9개는 건드리지 않는다** — `N8` 이 별건으로 남겼다.
- **`@packages/domain-types` 를 `apps/medusa` 에서 import 하지 않는다.** Medusa 빌드에는 번들러가 없어 `@packages/*` 별칭이 **런타임에 해석되지 않는다**(`modules/promotion-meta/service.ts:10-11` 주석이 이미 못 박았다). 새 zod enum 은 **사본**이고, 정합은 `packages/domain-types/coupon-vocabulary-drift.spec.ts` 가 지킨다 — Task 3 이 그 가드에 새 사이트를 등록한다.
- **워크플로 훅은 워크플로당 핸들러 1개.** 중복 등록하면 부팅이 죽는다. `src/workflows/hooks/__tests__/no-duplicate-validate-hooks.unit.spec.ts` 가 `src/workflows/hooks/**` 전체를 훑어 이걸 지킨다. 이 플랜이 새로 등록하는 셋은 **아직 아무도 안 쓰는 훅**이므로 충돌이 없다(2026-08-31 확인: 저장소 전체에서 `promotionsCreated`/`promotionsUpdated`/`promotionsDeleted` 등록 0건).
- **`api/admin/promotions/helpers.ts` 는 P7 과의 리베이스 지점이다.** 이 플랜은 `META_KEYS` · `toMetadataShape` · 신규 `resolveVisibility` 를, P7 은 같은 파일의 `meetsGroupRule` 을 건드린다. **같은 파일 다른 함수** — 충돌이 아니라 리베이스다. 먼저 머지되는 쪽이 이기고 다른 쪽이 리베이스한다.
- 주석·커밋 메시지는 **한국어**. 기존 파일 톤을 따른다.

### 검증 게이트 (2026-08-31 실측 기준선)

| 게이트 | 명령 | 기준선 |
|---|---|---|
| Medusa 유닛 | `cd apps/medusa && npm run test:unit` (루트에선 `npm run test:medusa`) | **25 suites / 225 tests 전부 통과, 12.4s** |
| Medusa 타입 | `cd apps/medusa && npx tsc --noEmit` | **선재 에러 정확히 3건** (아래). 늘면 이 플랜이 만든 것 |
| 쿠폰 통합(HTTP, 실 DB) | `scripts/local/run-medusa-integration.sh --testPathPattern 'coupon-'` | **4 suites / 38 tests 전부 통과** (admin 11 · cart/store/event 27) |
| 어휘 드리프트 | 루트 `npx jest packages/domain-types` | 통과 |

선재 Medusa 타입 에러 3건 (이 플랜과 무관, 고치지 말 것):

```
src/admin/lib/sdk.ts(5,14): error TS1470: The 'import.meta' meta-property is not allowed …
src/admin/lib/sdk.ts(6,12): error TS1470: …
src/api/store/orders/[id]/__tests__/confirm-purchase.unit.spec.ts(11,41): error TS2307: Cannot find module '@workflows/…'
```

**🔴 통합 스펙 러너의 함정 (Task 0 가 이걸 고친다).** `medusaIntegrationTestRunner` 는 `DATABASE_URL` 을 **읽지 않는다** — `@medusajs/test-utils/dist/database.js:12-15` 가 `DB_HOST`/`DB_USERNAME`/`DB_PASSWORD`/`DB_PORT` 를 따로 읽고 `pg-god` 로 임시 DB 를 만든다. `apps/medusa/.env` 에는 그 넷이 없어서 **`npm run test:integration:http` 를 그냥 부르면 38건 전부 `SASL: client password must be a string` 로 죽는다.** 이걸 「develop 이 원래 빨갛다」로 읽으면 안 된다 — **환경 문제이고, 넷을 넘겨주면 전부 통과한다**(실측).

**🔴 CI 는 이 플랜의 통합 스펙을 돌리지 않는다.** `.github/workflows/medusa-unit-tests.yml` 은 `npm run test:unit` 만 돌린다(DB 가 없다). 루트 `verification-gates.yml` 은 `tsconfig.json:exclude` 와 `modulePathIgnorePatterns` 로 `apps/medusa` 를 아예 제외한다. → **통합 스펙은 사람이 로컬에서 돌리는 것이 유일한 방어선이다.** Task 0 가 그 명령을 저장소에 커밋해 「돌릴 수 있는데 안 돌리는 것」과 「어떻게 돌리는지 몰라서 못 도는 것」을 가른다.

---

## 이 값을 읽는 소비자 목록 (P1 교훈 — 필수 항목)

> P1 은 File Structure 표에 **쓰기 경로만** 적고 「지금 이 값을 읽는 코드는 어디인가」를 묻지 않아 Critical 을 냈다. 그래서 이 절이 File Structure 보다 **먼저** 온다. 근거는 전부 2026-08-31 `grep` 실측이다.

### (가) `promotion_meta` 를 **쓰는** 곳 — 이 플랜이 옮기는 전부

| 위치 | 무엇을 | 이동 후 |
|---|---|---|
| `api/admin/promotions/route.ts:66-69` | `upsert` (생성) | → `promotionsCreated` 훅 |
| `api/admin/promotions/[id]/route.ts:27-30` | `upsert` (수정) | → `promotionsUpdated` 훅 |
| `api/admin/promotions/[id]/route.ts:41-44` | `deleteByPromotionId` + `removeAllIssueLogs` | → `promotionsDeleted` 훅 |

`createPromotionsWorkflow` / `updatePromotionsWorkflow` / `deletePromotionsWorkflow` 의 **호출자는 저 셋뿐**이다(2026-08-31 grep). 네이티브 대시보드(`/app/promotions`, 로컬 200)도 **같은 워크플로를 도는 코어 라우트**를 타므로 훅이 그것까지 덮는다 — 오늘은 안 덮는다.

발급/회수 경로(`issue-coupons` · `promotions/:id/customers` · `me/promotions/:id/claim`)가 만지는 `issued_count`/`issue_log` 는 **이 플랜의 대상이 아니다**(그건 P4 의 것이다). 훅이 만지는 것은 **프로모션의 라이프사이클에 묶인 메타 행 자체**뿐이다.

### (나) `visibility` 를 **읽는** 곳 — 닫힌 기본값이 닿는 전부

| # | 위치 | 오늘 | 메타가 없을 때 오늘 결과 |
|---|---|---|---|
| 1 | `api/admin/promotions/helpers.ts:43` | `record.visibility ?? 'public'` | **도달 불가** — 이 줄은 `record` 가 non-null 일 때만 돌고, 컬럼은 `NOT NULL DEFAULT 'public'` 이다. **바꾸지 않는다**(아래 Task 4 주석) |
| 2 | `api/store/customers/me/promotions/route.ts:120` | 맵 구축 `toMetadataShape(m)?.visibility ?? 'public'` | 맵에 **키 자체가 없다**(메타 행이 없으면 `metas` 에 안 들어온다) |
| 3 | `api/store/customers/me/promotions/route.ts:124` | `visibilityById.get(id) ?? 'public'` | 표시가 「공개」 |
| 4 | `api/store/customers/me/promotions/route.ts:187` | `(… ?? 'public') === 'public'` | **공개 목록에 뜬다** |
| 5 | `api/store/coupons/preview/route.ts:75` | `metaShape?.visibility ?? 'public'` | preview 가 「공개」로 응답 |
| 6 | `api/store/events/[slug]/route.ts:85` | `toMetadataShape(meta)?.visibility ?? 'public'` | 이벤트 쿠폰이 `kind:'usable'` |
| 7 | `api/store/carts/middlewares/per-customer-limit.ts:33` | `metaShape?.visibility === 'assigned_only' \|\| === 'claimable'` | `undefined` → **게이트 통과** |
| 8 | `workflows/hooks/cart/complete-cart.ts:33` | 같은 모양 | **주문 확정도 통과** |

→ **2·5·6·7·8 (그리고 그로부터 파생되는 3·4) 이 닫힌 기본값의 대상이다.** 1은 도달 불가라 남긴다.

### (다) 라우트 **응답 본문**을 읽는 곳 — 쓰기 핸들러 제거의 위험 면적

| 호출 | 응답을 읽는가 | 근거 |
|---|---|---|
| `medusaPromotionsApi.create` | **안 읽는다** | `lib/services/coupons/mutations.ts:9-14` 가 `onSuccess: () => invalidateQueries` 만. 다이얼로그도 `await mutateAsync(payload)` 후 반환값 미사용(`coupon-create-dialog.tsx:207`) |
| `medusaPromotionsApi.updateStatus` | **안 읽는다** | `mutations.ts:17-26` 동일 |
| `medusaPromotionsApi.delete` | **안 읽는다** | `mutations.ts:28-33` 동일 |
| `medusaPromotionsApi.list` / `get` | **읽는다 (`metadata`)** | → 그래서 **`GET` override 는 남긴다** |

즉 쓰기 3개를 코어 핸들러에 넘겨 응답에서 `metadata` 가 사라져도 **읽는 코드가 0곳**이다.

---

## File Structure

**생성**

| 파일 | 책임 |
|---|---|
| `apps/medusa/src/workflows/hooks/promotion/apply-promotion-meta.ts` | 훅 **본문의 순수 로직**. 컨테이너·워크플로를 모르고 `PromotionMetaWriter` 인터페이스만 안다 → 유닛 테스트가 닿는다 |
| `apps/medusa/src/workflows/hooks/promotion/promotion-meta.ts` | 훅 **등록 3개**. 얇다 — `resolve` 하고 위 함수를 부르고 `StepResponse` 로 감싸는 것뿐 |
| `apps/medusa/src/api/admin/promotions/additional-data-schema.ts` | `additional_data` 의 zod shape 2벌(생성·수정). `middlewares.ts` 가 소비 |
| `apps/medusa/src/workflows/hooks/promotion/__tests__/apply-promotion-meta.unit.spec.ts` | 위 순수 로직 |
| `apps/medusa/src/api/admin/promotions/__tests__/additional-data-schema.unit.spec.ts` | 스키마 키 집합이 `META_KEYS` 를 덮는가 + enum 값 |
| `apps/medusa/src/api/admin/promotions/__tests__/visibility-default.unit.spec.ts` | 닫힌 기본값 |
| `scripts/local/run-medusa-integration.sh` | 통합 스펙 러너(위 「함정」 참조) |

**수정**

| 파일 | 무엇을 |
|---|---|
| `apps/medusa/src/api/admin/promotions/helpers.ts` | `META_KEYS` export · `resolveVisibility` · `requiresIssuance` 추가 |
| `apps/medusa/src/api/admin/promotions/route.ts:55-93` | `POST` **삭제** (`GET` 만 남긴다) |
| `apps/medusa/src/api/admin/promotions/[id]/route.ts:17-48` | `POST`·`DELETE` **삭제** (`GET` 만 남긴다) |
| `apps/medusa/src/api/middlewares.ts` | `additionalDataValidator` 2건 등록 |
| `apps/medusa/src/api/store/customers/me/promotions/route.ts:120,124,187` | 닫힌 기본값 |
| `apps/medusa/src/api/store/coupons/preview/route.ts:75` | 닫힌 기본값 |
| `apps/medusa/src/api/store/events/[slug]/route.ts:85` | 닫힌 기본값 |
| `apps/medusa/src/api/store/carts/middlewares/per-customer-limit.ts:33` | `requiresIssuance` 로 교체 |
| `apps/medusa/src/workflows/hooks/cart/complete-cart.ts:33` | `requiresIssuance` 로 교체 |
| `packages/domain-types/coupon-vocabulary-drift.spec.ts` | 새 zod enum 2개를 드리프트 사이트로 등록 |
| `apps/medusa/integration-tests/http/coupon-admin.spec.ts` | 회귀 3건 추가 |
| `docs/local-dev.md` | 통합 스펙 러너 절 |

---

## Task 0: 통합 스펙을 «돌릴 수 있는 명령» 으로 만든다

> **왜 이게 Task 0 인가.** 이 플랜의 진짜 검증(코어 POST 로의 이관이 안 깨졌는가 · `N7` 회귀)은 전부
> HTTP 통합 스펙이다. 그런데 오늘 그 스펙은 **부르는 법을 아는 사람만** 돌릴 수 있다(`DB_*` 4개).
> P1 의 교훈은 「검증되려면 `.ts` 여야 한다」였고, 그 일반형은 **「검증되려면 실행 가능한 명령이어야
> 한다」** 다. 이 태스크가 없으면 나머지 태스크의 검증 단계가 전부 「환경 문제로 스킵」된다.

**Files:**
- Create: `scripts/local/run-medusa-integration.sh`
- Modify: `docs/local-dev.md` (「전체 스택 로컬 구동」 절 뒤에 새 소절)

**Interfaces:**
- Produces: `scripts/local/run-medusa-integration.sh [jest 인자…]` — `apps/medusa` 의 HTTP 통합 스펙을 로컬 postgres 로 돌린다. 이후 모든 Task 의 검증 단계가 이 명령을 쓴다.

- [ ] **Step 1: 러너 스크립트를 만든다**

`scripts/local/run-medusa-integration.sh`:

```bash
#!/usr/bin/env bash
#
# apps/medusa 의 HTTP 통합 스펙(integration-tests/http/*.spec.ts) 러너.
#
# 왜 별도 스크립트인가: `medusaIntegrationTestRunner` 는 DATABASE_URL 을 **읽지 않는다**.
# @medusajs/test-utils/dist/database.js:12-15 가 DB_HOST / DB_USERNAME / DB_PASSWORD / DB_PORT 를
# 따로 읽어 pg-god 로 임시 DB 를 만들었다 지운다. apps/medusa/.env 에는 그 넷이 없어서
# `npm run test:integration:http` 를 그냥 부르면 전 스펙이
#   SASL: SCRAM-SERVER-FIRST-MESSAGE: client password must be a string
# 로 죽는다. 이건 스펙이 빨간 게 아니라 환경이 안 넘어간 것이다.
#
# 사용: scripts/local/run-medusa-integration.sh --testPathPattern 'coupon-'
#
# 전제: docker compose 의 postgres 가 떠 있고, apps/medusa/.env 의 DATABASE_URL 이 그것을 가리킨다.
#       임시 DB 를 CREATE/DROP 하므로 그 계정에 권한이 있어야 한다(로컬 postgres 는 superuser).
set -euo pipefail

MEDUSA_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../apps/medusa" && pwd)"
cd "$MEDUSA_DIR"

if [ ! -f .env ]; then
  echo "apps/medusa/.env 가 없다. docs/local-dev.md 「전체 스택 로컬 구동」 §2 를 먼저 하라." >&2
  exit 1
fi

# DATABASE_URL 하나에서 러너가 요구하는 넷을 파생시킨다. 값은 출력하지 않는다.
eval "$(python3 - <<'PY'
import shlex, urllib.parse
url = None
for line in open('.env'):
    if line.startswith('DATABASE_URL='):
        url = line.split('=', 1)[1].strip().strip('"').strip("'")
if not url:
    raise SystemExit("apps/medusa/.env 에 DATABASE_URL 이 없다")
u = urllib.parse.urlparse(url)
print(f"export DB_HOST={shlex.quote(u.hostname or 'localhost')}")
print(f"export DB_PORT={u.port or 5432}")
print(f"export DB_USERNAME={shlex.quote(u.username or 'postgres')}")
print(f"export DB_PASSWORD={shlex.quote(urllib.parse.unquote(u.password or ''))}")
PY
)"

exec npm run test:integration:http -- "$@"
```

- [ ] **Step 2: 실행 권한을 주고 쿠폰 스펙 전체를 돌려 기준선을 재현한다**

Run:
```bash
chmod +x scripts/local/run-medusa-integration.sh
scripts/local/run-medusa-integration.sh --testPathPattern 'coupon-' 2>&1 | grep -E "^(PASS|FAIL)|^Tests:|^Test Suites:"
```
Expected:
```
PASS integration-tests/http/coupon-admin.spec.ts
PASS integration-tests/http/coupon-cart.spec.ts
PASS integration-tests/http/coupon-store.spec.ts
PASS integration-tests/http/coupon-event.spec.ts
Test Suites: 4 passed, 4 total
Tests:       38 passed, 38 total
```

- [ ] **Step 3: `docs/local-dev.md` 에 소절을 더한다**

「전체 스택 로컬 구동」 절의 **끝**(§5 뒤, 「부팅 중 실제로 걸린 것들」 앞)에 삽입:

```markdown
### 6. Medusa HTTP 통합 스펙

```bash
scripts/local/run-medusa-integration.sh --testPathPattern 'coupon-'
```

`docker compose` 의 postgres 만 있으면 된다(Medusa 서버는 안 떠 있어도 된다 — 러너가 in-app 으로
띄운다). 스펙마다 임시 DB 를 만들었다 지우므로 `medusa` DB 는 건드리지 않는다.

**`npm run test:integration:http` 를 직접 부르지 말 것.** 러너는 `DATABASE_URL` 이 아니라
`DB_HOST`/`DB_USERNAME`/`DB_PASSWORD`/`DB_PORT` 를 읽는데 `.env` 에 그 넷이 없어서 전 스펙이
`SASL: client password must be a string` 으로 죽는다 — 스펙이 빨간 게 아니라 환경이 안 넘어간 것이다.
위 스크립트가 `DATABASE_URL` 에서 넷을 파생시켜 넘긴다.

**CI 는 이걸 돌리지 않는다.** `medusa-unit-tests.yml` 은 DB 가 없어 `test:unit` 만 돌린다.
쿠폰 도메인을 건드렸으면 **로컬에서 이 명령을 돌리는 것이 유일한 방어선이다.**
```

- [ ] **Step 4: 커밋**

```bash
git add scripts/local/run-medusa-integration.sh docs/local-dev.md
git commit -m "test(medusa): HTTP 통합 스펙 러너를 저장소에 넣는다 (#488 P10-A)"
```

---

## Task 1: 순수 메타 동기화 로직

> 훅 등록은 전역 부수효과라 유닛 테스트가 닿지 않는다. **판정을 먼저 순수 함수로 뽑고**(P1 교훈 2)
> Task 2 에서 그것을 훅에 붙인다. 이 태스크는 아직 아무 배선도 바꾸지 않는다 — 행동 변화 0.

**Files:**
- Create: `apps/medusa/src/workflows/hooks/promotion/apply-promotion-meta.ts`
- Create: `apps/medusa/src/workflows/hooks/promotion/__tests__/apply-promotion-meta.unit.spec.ts`
- Modify: `apps/medusa/src/api/admin/promotions/helpers.ts:17` (`META_KEYS` 를 export 로)

**Interfaces:**
- Consumes: `extractMetaFromAdditionalData(additional_data)` — `helpers.ts` 의 기존 export. `additional_data` 에서 `META_KEYS` 중 `!= null` 인 것만 골라 객체로, 하나도 없으면 `null`.
- Produces:
  - `export const META_KEYS: readonly string[]` (`helpers.ts`)
  - `export interface PromotionMetaWriter { getByPromotionId(id: string): Promise<any | null>; upsert(data: Record<string, unknown> & { promotion_id: string }): Promise<unknown>; deleteByPromotionId(id: string): Promise<void>; removeAllIssueLogs(id: string): Promise<void>; }`
  - `export async function applyMetaOnCreate(writer, promotions, additional_data): Promise<string[]>` — 메타를 쓴 `promotion_id` 목록
  - `export async function applyMetaOnUpdate(writer, promotions, additional_data): Promise<MetaSnapshot[]>` — 되돌리기용 이전 상태
  - `export async function applyMetaOnDelete(writer, ids): Promise<MetaSnapshot[]>`
  - `export async function restoreMetaSnapshots(writer, snapshots): Promise<void>`
  - `export type MetaSnapshot = { promotion_id: string; before: Record<string, unknown> | null }`

- [ ] **Step 1: `META_KEYS` 를 export 한다**

`apps/medusa/src/api/admin/promotions/helpers.ts:17` 의 `const META_KEYS = [` 를 다음으로 바꾼다:

```typescript
/**
 * `additional_data` ↔ `promotion_meta` 사이를 오가는 키 전부.
 *
 * ⚠️ 이 배열은 **`api/middlewares.ts` 의 `additionalDataValidator` 스키마와 같은 집합**이어야 한다.
 * 프레임워크가 검증기를 `z.object(shape)` 로 감싸는데 그 기본이 **strip** 이라, 스키마에 없는 키는
 * 400 이 아니라 **조용히 버려져** 훅까지 도달하지 못한다(2026-08-31 실측). 그 정합은
 * `api/admin/promotions/__tests__/additional-data-schema.unit.spec.ts` 가 지킨다.
 */
export const META_KEYS = [
```

- [ ] **Step 2: 실패하는 테스트를 쓴다**

`apps/medusa/src/workflows/hooks/promotion/__tests__/apply-promotion-meta.unit.spec.ts`:

```typescript
import {
  applyMetaOnCreate,
  applyMetaOnDelete,
  applyMetaOnUpdate,
  restoreMetaSnapshots,
  type PromotionMetaWriter,
} from '../apply-promotion-meta';

/** 호출을 기록하는 최소 writer. 실제 모듈 서비스의 계약만 흉내낸다. */
function fakeWriter(seed: Record<string, Record<string, unknown>> = {}) {
  const rows: Record<string, Record<string, unknown>> = { ...seed };
  const calls: string[] = [];
  const writer: PromotionMetaWriter = {
    async getByPromotionId(id) {
      calls.push(`get:${id}`);
      return rows[id] ?? null;
    },
    async upsert(data) {
      calls.push(`upsert:${data.promotion_id}`);
      rows[data.promotion_id] = { ...(rows[data.promotion_id] ?? {}), ...data };
      return rows[data.promotion_id];
    },
    async deleteByPromotionId(id) {
      calls.push(`delete:${id}`);
      delete rows[id];
    },
    async removeAllIssueLogs(id) {
      calls.push(`logs:${id}`);
    },
  };
  return { writer, rows, calls };
}

describe('applyMetaOnCreate', () => {
  it('additional_data 의 메타 키를 생성된 프로모션마다 쓴다', async () => {
    const { writer, rows } = fakeWriter();
    const written = await applyMetaOnCreate(writer, [{ id: 'promo_1' }], {
      visibility: 'assigned_only',
      name: '가을 쿠폰',
    });
    expect(written).toEqual(['promo_1']);
    expect(rows.promo_1).toMatchObject({
      promotion_id: 'promo_1',
      visibility: 'assigned_only',
      name: '가을 쿠폰',
    });
  });

  it('메타 키가 하나도 없으면 아무것도 쓰지 않는다', async () => {
    const { writer, calls } = fakeWriter();
    expect(await applyMetaOnCreate(writer, [{ id: 'promo_1' }], undefined)).toEqual([]);
    expect(await applyMetaOnCreate(writer, [{ id: 'promo_1' }], {})).toEqual([]);
    expect(await applyMetaOnCreate(writer, [{ id: 'promo_1' }], { unrelated: 1 })).toEqual([]);
    expect(calls).toEqual([]);
  });
});

describe('applyMetaOnUpdate', () => {
  it('이전 상태를 스냅샷으로 돌려주고 부분 갱신한다', async () => {
    const { writer, rows } = fakeWriter({
      promo_1: { promotion_id: 'promo_1', visibility: 'public', name: '옛 이름' },
    });
    const snapshots = await applyMetaOnUpdate(writer, [{ id: 'promo_1' }], { name: '새 이름' });
    expect(snapshots).toEqual([
      { promotion_id: 'promo_1', before: { promotion_id: 'promo_1', visibility: 'public', name: '옛 이름' } },
    ]);
    expect(rows.promo_1).toMatchObject({ visibility: 'public', name: '새 이름' });
  });

  it('메타 키가 없으면 조회조차 하지 않는다 — 상태 토글이 메타를 건드리면 안 된다', async () => {
    const { writer, calls } = fakeWriter({ promo_1: { promotion_id: 'promo_1', visibility: 'claimable' } });
    expect(await applyMetaOnUpdate(writer, [{ id: 'promo_1' }], undefined)).toEqual([]);
    expect(calls).toEqual([]);
  });
});

describe('applyMetaOnDelete', () => {
  it('메타와 발급 로그를 지우고 메타 스냅샷을 돌려준다', async () => {
    const { writer, rows, calls } = fakeWriter({
      promo_1: { promotion_id: 'promo_1', visibility: 'claimable' },
    });
    const snapshots = await applyMetaOnDelete(writer, ['promo_1']);
    expect(snapshots).toEqual([
      { promotion_id: 'promo_1', before: { promotion_id: 'promo_1', visibility: 'claimable' } },
    ]);
    expect(rows.promo_1).toBeUndefined();
    expect(calls).toEqual(['get:promo_1', 'delete:promo_1', 'logs:promo_1']);
  });

  it('발급 로그 정리가 실패해도 삭제 전체를 실패시키지 않는다', async () => {
    const { writer } = fakeWriter({ promo_1: { promotion_id: 'promo_1' } });
    writer.removeAllIssueLogs = async () => {
      throw new Error('boom');
    };
    await expect(applyMetaOnDelete(writer, ['promo_1'])).resolves.toEqual([
      { promotion_id: 'promo_1', before: { promotion_id: 'promo_1' } },
    ]);
  });
});

describe('restoreMetaSnapshots', () => {
  it('이전에 있었으면 되살리고, 없었으면 지운다', async () => {
    const { writer, rows } = fakeWriter({ promo_2: { promotion_id: 'promo_2', visibility: 'public' } });
    await restoreMetaSnapshots(writer, [
      { promotion_id: 'promo_1', before: { promotion_id: 'promo_1', visibility: 'claimable' } },
      { promotion_id: 'promo_2', before: null },
    ]);
    expect(rows.promo_1).toMatchObject({ visibility: 'claimable' });
    expect(rows.promo_2).toBeUndefined();
  });
});
```

- [ ] **Step 3: 실패를 확인한다**

Run: `cd apps/medusa && npx jest --config jest.config.js src/workflows/hooks/promotion`
Expected: FAIL — `Cannot find module '../apply-promotion-meta'`

> ⚠️ `npm run test:unit` 은 `TEST_TYPE=unit` 이 있어야 `testMatch` 가 걸린다. 개별 실행은
> `TEST_TYPE=unit npx jest <경로>` 로 부르거나, 그냥 `npm run test:unit` 전체를 돌린다.

- [ ] **Step 4: 구현한다**

`apps/medusa/src/workflows/hooks/promotion/apply-promotion-meta.ts`:

```typescript
import { extractMetaFromAdditionalData } from '../../../api/admin/promotions/helpers';

/**
 * `promotion_meta` 쓰기의 **순수 로직**. 컨테이너도 워크플로도 모른다.
 *
 * 훅 등록(`promotion-meta.ts`)은 전역 부수효과라 유닛 테스트가 닿지 않는다. 그래서 판정을
 * 여기로 뽑고 등록부는 얇게 둔다 — 「검증되려면 `.ts` 여야 한다」(#488 P1 교훈).
 */

/** 훅이 필요로 하는 `PromotionMetaModuleService` 의 최소 표면. */
export interface PromotionMetaWriter {
  getByPromotionId(id: string): Promise<any | null>;
  upsert(data: Record<string, unknown> & { promotion_id: string }): Promise<unknown>;
  deleteByPromotionId(id: string): Promise<void>;
  removeAllIssueLogs(id: string): Promise<void>;
}

/** 보상(compensation)에 쓸 이전 상태. `before: null` 은 「원래 없었다」는 뜻이다. */
export type MetaSnapshot = {
  promotion_id: string;
  before: Record<string, unknown> | null;
};

type PromotionLike = { id: string };

/**
 * 생성된 프로모션들에 메타를 쓴다. 메타를 쓴 `promotion_id` 목록을 돌려준다(보상 입력).
 *
 * `additional_data` 는 워크플로 단위 값이라 프로모션이 여럿이면 전부에 같은 메타가 간다.
 * 어드민 라우트는 항상 1건만 만들므로 실제로는 1:1 이다.
 */
export async function applyMetaOnCreate(
  writer: PromotionMetaWriter,
  promotions: PromotionLike[],
  additional_data: Record<string, unknown> | undefined | null,
): Promise<string[]> {
  const meta = extractMetaFromAdditionalData(additional_data);
  if (!meta) return [];

  const written: string[] = [];
  for (const promotion of promotions ?? []) {
    await writer.upsert({ promotion_id: promotion.id, ...meta });
    written.push(promotion.id);
  }
  return written;
}

/**
 * 수정된 프로모션들의 메타를 부분 갱신한다.
 *
 * ⚠️ `additional_data` 에 메타 키가 없으면 **조회조차 하지 않는다.** 어드민의 상태 토글
 * (`{ status }` 만 보낸다)이 메타를 건드리면 안 되기 때문이다.
 */
export async function applyMetaOnUpdate(
  writer: PromotionMetaWriter,
  promotions: PromotionLike[],
  additional_data: Record<string, unknown> | undefined | null,
): Promise<MetaSnapshot[]> {
  const meta = extractMetaFromAdditionalData(additional_data);
  if (!meta) return [];

  const snapshots: MetaSnapshot[] = [];
  for (const promotion of promotions ?? []) {
    const before = await writer.getByPromotionId(promotion.id);
    snapshots.push({ promotion_id: promotion.id, before: before ? { ...before } : null });
    await writer.upsert({ promotion_id: promotion.id, ...meta });
  }
  return snapshots;
}

/**
 * 삭제된 프로모션들의 메타와 발급 로그를 정리한다.
 *
 * 발급 로그 정리는 **best-effort** 다 — 실패해도 삭제 전체를 되돌리지 않는다(옛 라우트의
 * `.catch(() => {})` 와 같은 판단이다. 로그는 이미 고아이고, 그것 때문에 프로모션 삭제를
 * 롤백하면 관리자가 지울 수 없는 쿠폰이 생긴다).
 */
export async function applyMetaOnDelete(
  writer: PromotionMetaWriter,
  ids: string[],
): Promise<MetaSnapshot[]> {
  const snapshots: MetaSnapshot[] = [];
  for (const id of ids ?? []) {
    const before = await writer.getByPromotionId(id);
    snapshots.push({ promotion_id: id, before: before ? { ...before } : null });
    await writer.deleteByPromotionId(id);
    await writer.removeAllIssueLogs(id).catch(() => {});
  }
  return snapshots;
}

/**
 * 스냅샷대로 되돌린다. 보상 함수의 본체다.
 *
 * ⚠️ 발급 로그는 되돌리지 않는다 — 삭제된 로그를 복원할 재료가 없다. 이 경로는 프로모션
 * 삭제가 롤백되는 경우에만 도는데, 그때 로그가 비어 있는 것은 「이미 지워진 쿠폰의 로그」와
 * 구분되지 않는 상태이고 fail-closed 쪽이다.
 */
export async function restoreMetaSnapshots(
  writer: PromotionMetaWriter,
  snapshots: MetaSnapshot[],
): Promise<void> {
  for (const snapshot of snapshots ?? []) {
    if (snapshot.before) {
      await writer.upsert(snapshot.before as Record<string, unknown> & { promotion_id: string });
    } else {
      await writer.deleteByPromotionId(snapshot.promotion_id);
    }
  }
}
```

- [ ] **Step 5: 통과를 확인한다**

Run: `cd apps/medusa && npm run test:unit`
Expected: **26 suites / 233 tests 통과** (기준선 25/225 + 새 1 suite / 8 tests)

- [ ] **Step 6: 타입 게이트**

Run: `cd apps/medusa && npx tsc --noEmit 2>&1 | grep -c "error TS"`
Expected: `3` (선재분 그대로)

- [ ] **Step 7: 커밋**

```bash
git add apps/medusa/src/workflows/hooks/promotion apps/medusa/src/api/admin/promotions/helpers.ts
git commit -m "refactor(medusa): promotion_meta 동기화 판정을 순수 함수로 뽑는다 (#488 P10-A)"
```

---

## Task 2: 훅 3개 등록 — 메타 쓰기를 워크플로 안으로

> 이 태스크가 끝나면 **메타가 두 번 쓰인다**(라우트 + 훅). `upsert` 가 멱등이고 같은 데이터라
> 안전한 중간 상태다. 그래서 이 태스크는 **단독으로 배포 가능**하고, 그 자체로 `N7` 을 반쯤 닫는다
> — 워크플로 안의 쓰기가 실패하면 이미 프로모션이 롤백되기 때문이다.

**Files:**
- Create: `apps/medusa/src/workflows/hooks/promotion/promotion-meta.ts`
- Modify: `apps/medusa/integration-tests/http/coupon-admin.spec.ts` (회귀 1건 추가)

**Interfaces:**
- Consumes: Task 1 의 `applyMetaOnCreate` / `applyMetaOnUpdate` / `applyMetaOnDelete` / `restoreMetaSnapshots` / `PromotionMetaWriter` / `MetaSnapshot`
- Produces: 훅 등록 3개. 이후 Task 3 이 라우트에서 같은 쓰기를 지운다.

- [ ] **Step 1: 실패하는 통합 테스트를 쓴다**

`apps/medusa/integration-tests/http/coupon-admin.spec.ts` 의 마지막 `it(...)` 뒤에 추가한다.
(`createPromo` · `adminHeaders` · `getContainer` 는 그 파일에 이미 있다.)

```typescript
    it('메타 쓰기가 실패하면 프로모션이 롤백된다 (N7 — 워크플로 안으로 옮긴 이유)', async () => {
      const container = getContainer();
      const { createPromotionsWorkflow } = require('@medusajs/core-flows');

      // HTTP validator 를 우회해 워크플로를 직접 돌린다 — 훅 안의 쓰기가 던졌을 때
      // 앞 스텝이 보상되는가만 본다. `visibility` 어휘 밖 값은 모듈 서비스 upsert 가 던진다.
      const code = `ROLLBACK${seq}`;
      await expect(
        createPromotionsWorkflow(container).run({
          input: {
            promotionsData: [
              {
                code,
                type: 'standard',
                status: 'active',
                application_method: { type: 'percentage', value: 10, target_type: 'order' },
              },
            ],
            additional_data: { visibility: 'bogus_value' },
          },
        }),
      ).rejects.toThrow();

      // 프로모션이 남아 있으면 안 된다. 남으면 그게 바로 «전체공개 활성 쿠폰» 이다.
      const promotionModule = container.resolve(Modules.PROMOTION);
      const found = await promotionModule.listPromotions({ code });
      expect(found).toHaveLength(0);
    });
```

- [ ] **Step 2: 실패를 확인한다**

Run: `scripts/local/run-medusa-integration.sh --testPathPattern 'coupon-admin'`
Expected: FAIL — 훅이 없으니 워크플로가 성공해 `rejects.toThrow()` 가 깨진다
(`Received function did not throw`), 그리고 프로모션이 1건 남는다.

- [ ] **Step 3: 훅 3개를 등록한다**

`apps/medusa/src/workflows/hooks/promotion/promotion-meta.ts`:

```typescript
import {
  createPromotionsWorkflow,
  updatePromotionsWorkflow,
  deletePromotionsWorkflow,
} from '@medusajs/core-flows';
import { StepResponse } from '@medusajs/framework/workflows-sdk';
import { PROMOTION_META_MODULE } from '../../../modules/promotion-meta';
import type PromotionMetaModuleService from '../../../modules/promotion-meta/service';
import {
  applyMetaOnCreate,
  applyMetaOnDelete,
  applyMetaOnUpdate,
  restoreMetaSnapshots,
  type MetaSnapshot,
  type PromotionMetaWriter,
} from './apply-promotion-meta';

/**
 * `promotion_meta` 를 프로모션 라이프사이클에 **묶는다** (#488 N7 · N8 쓰기분 · 7-8).
 *
 * 옛 배선은 커스텀 `/admin/promotions` 라우트가 워크플로를 돌린 **뒤** `upsert` 를 불렀다.
 * 즉 메타 쓰기가 보상(compensation) 밖이라, 두 쓰기 사이에서 실패하면
 * **«발급 정책 없는 활성 쿠폰»** 이 남았다 — 그리고 메타가 없을 때의 기본값이 전부 「전체공개」였다.
 * 실측으로 재현했다: `additional_data.visibility` 에 어휘 밖 값 → HTTP 500 → 프로모션은 active 로
 * 살아남고 `promotion_meta` 0행.
 *
 * 훅 안으로 들어오면 던지는 순간 `createPromotionsStep` 의 보상이 프로모션을 지운다.
 * 훅은 **워크플로당 핸들러 1개**만 허용되므로 여기 셋이 유일한 등록이어야 한다
 * (`workflows/hooks/__tests__/no-duplicate-validate-hooks.unit.spec.ts` 가 지킨다).
 * 새 검증이 필요하면 **새 훅을 등록하지 말고 아래 핸들러 안에 함수를 더할 것.**
 */

function writerFrom(container: any): PromotionMetaWriter {
  return container.resolve<PromotionMetaModuleService>(PROMOTION_META_MODULE) as PromotionMetaWriter;
}

createPromotionsWorkflow.hooks.promotionsCreated(
  async ({ promotions, additional_data }, { container }) => {
    const written = await applyMetaOnCreate(
      writerFrom(container),
      promotions as { id: string }[],
      additional_data as Record<string, unknown> | undefined,
    );
    return new StepResponse(written, written);
  },
  async (written: string[] | undefined, { container }) => {
    if (!written?.length) return;
    const writer = writerFrom(container);
    for (const id of written) {
      await writer.deleteByPromotionId(id);
    }
  },
);

updatePromotionsWorkflow.hooks.promotionsUpdated(
  async ({ promotions, additional_data }, { container }) => {
    const snapshots = await applyMetaOnUpdate(
      writerFrom(container),
      promotions as { id: string }[],
      additional_data as Record<string, unknown> | undefined,
    );
    return new StepResponse(snapshots, snapshots);
  },
  async (snapshots: MetaSnapshot[] | undefined, { container }) => {
    if (!snapshots?.length) return;
    await restoreMetaSnapshots(writerFrom(container), snapshots);
  },
);

deletePromotionsWorkflow.hooks.promotionsDeleted(
  async ({ ids }, { container }) => {
    const snapshots = await applyMetaOnDelete(writerFrom(container), ids as string[]);
    return new StepResponse(snapshots, snapshots);
  },
  async (snapshots: MetaSnapshot[] | undefined, { container }) => {
    if (!snapshots?.length) return;
    await restoreMetaSnapshots(writerFrom(container), snapshots);
  },
);
```

- [ ] **Step 4: 통합 테스트 통과를 확인한다**

Run: `scripts/local/run-medusa-integration.sh --testPathPattern 'coupon-admin'`
Expected: **12 tests 통과** (기준선 11 + 새 1). 특히 기존
`creates a promotion with meta via admin API` 와 `DELETE promotion purges issue-logs (P3-6)` 가
계속 통과해야 한다 — 이 시점엔 라우트와 훅이 **둘 다** 쓰기 때문에 멱등성이 검증된다.

- [ ] **Step 5: 중복 훅 가드와 유닛 전체를 돌린다**

Run: `cd apps/medusa && npm run test:unit`
Expected: 26 suites 전부 통과. 특히 `no-duplicate-validate-hooks.unit.spec.ts` 가 통과해야 한다
(새 훅 3개가 각각 1회 등록).

- [ ] **Step 6: 커밋**

```bash
git add apps/medusa/src/workflows/hooks/promotion/promotion-meta.ts apps/medusa/integration-tests/http/coupon-admin.spec.ts
git commit -m "feat(medusa): promotion_meta 쓰기를 워크플로 훅으로 옮긴다 (#488 N7)"
```

---

## Task 3: `additional_data` 검증 + 어휘 드리프트 가드

> 실측 ④ 가 확인한 것: 이 검증이 있으면 어휘 밖 `visibility` 는 **400 이고 프로모션 행이 남지 않는다.**
> 실측 ⑥ 이 확인한 것: 스키마에 안 적은 키는 **조용히 사라진다** → 키 집합을 테스트로 못 박는다.

**Files:**
- Create: `apps/medusa/src/api/admin/promotions/additional-data-schema.ts`
- Create: `apps/medusa/src/api/admin/promotions/__tests__/additional-data-schema.unit.spec.ts`
- Modify: `apps/medusa/src/api/middlewares.ts`
- Modify: `packages/domain-types/coupon-vocabulary-drift.spec.ts`
- Modify: `apps/medusa/integration-tests/http/coupon-admin.spec.ts` (회귀 2건 추가)

**Interfaces:**
- Consumes: `META_KEYS` (Task 1 이 export 로 바꿈)
- Produces:
  - `export const promotionAdditionalDataCreateShape` — `defineMiddlewares` 의 `additionalDataValidator` 에 그대로 넘길 `{ [key]: ZodType }`
  - `export const promotionAdditionalDataUpdateShape` — 같은 모양이나 전부 optional

- [ ] **Step 1: 실패하는 유닛 테스트를 쓴다**

`apps/medusa/src/api/admin/promotions/__tests__/additional-data-schema.unit.spec.ts`:

```typescript
import { z } from '@medusajs/framework/zod';
import { META_KEYS } from '../helpers';
import {
  promotionAdditionalDataCreateShape,
  promotionAdditionalDataUpdateShape,
} from '../additional-data-schema';

/**
 * 프레임워크는 이 shape 을 `z.object(shape).nullish()` 로 감싼다
 * (`@medusajs/framework/dist/http/middleware-file-loader.js:153`). `z.object` 기본이 **strip** 이라
 * 스키마에 없는 키는 400 이 아니라 **조용히 버려지고 훅까지 못 간다**(2026-08-31 실측).
 * 그래서 「키 집합이 META_KEYS 를 덮는가」가 실제 방어선이다.
 */
describe('additional_data 스키마', () => {
  it('생성·수정 둘 다 META_KEYS 를 전부 받는다 — 빠지면 그 값은 조용히 사라진다', () => {
    expect(Object.keys(promotionAdditionalDataCreateShape).sort()).toEqual([...META_KEYS].sort());
    expect(Object.keys(promotionAdditionalDataUpdateShape).sort()).toEqual([...META_KEYS].sort());
  });

  it('생성은 visibility 를 요구하고 어휘 밖 값을 거부한다', () => {
    const schema = z.object(promotionAdditionalDataCreateShape);
    expect(schema.safeParse({ visibility: 'assigned_only' }).success).toBe(true);
    expect(schema.safeParse({ visibility: 'bogus_value' }).success).toBe(false);
    expect(schema.safeParse({ name: '이름만' }).success).toBe(false);
  });

  it('수정은 부분 갱신이라 visibility 없이도 통과한다 — 상태 토글이 400 나면 안 된다', () => {
    const schema = z.object(promotionAdditionalDataUpdateShape);
    expect(schema.safeParse({ name: '새 이름' }).success).toBe(true);
    expect(schema.safeParse({}).success).toBe(true);
    expect(schema.safeParse({ visibility: 'bogus_value' }).success).toBe(false);
  });

  it('auto_issue_trigger 어휘도 닫혀 있다', () => {
    const schema = z.object(promotionAdditionalDataUpdateShape);
    expect(schema.safeParse({ auto_issue_trigger: 'customer_registered' }).success).toBe(true);
    expect(schema.safeParse({ auto_issue_trigger: 'never_heard_of_it' }).success).toBe(false);
  });

  it('max_claims 는 양의 정수만 받는다', () => {
    const schema = z.object(promotionAdditionalDataUpdateShape);
    expect(schema.safeParse({ max_claims: 100 }).success).toBe(true);
    expect(schema.safeParse({ max_claims: 0 }).success).toBe(false);
    expect(schema.safeParse({ max_claims: 1.5 }).success).toBe(false);
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `cd apps/medusa && npm run test:unit`
Expected: FAIL — `Cannot find module '../additional-data-schema'`

- [ ] **Step 3: 스키마를 구현한다**

`apps/medusa/src/api/admin/promotions/additional-data-schema.ts`:

```typescript
import { z } from '@medusajs/framework/zod';

/**
 * `POST /admin/promotions*` 의 `additional_data` 검증 스키마 (#488 N7).
 *
 * **왜 필요한가.** 코어 zod 는 `additional_data` **안쪽을 보지 않는다** —
 * `WithAdditionalData` 가 검증기 없을 때 `z.record(z.unknown()).nullish()` 로 열어둔다
 * (`@medusajs/medusa/dist/api/utils/validators.js:12-15`). 그 결과 어휘 밖 `visibility` 가
 * DB CHECK 까지 가서 500 이 나고, 그 시점에 프로모션은 이미 active 로 만들어져 있었다.
 * 여기 검증기를 걸면 워크플로 이전에 **400** 이 나고 프로모션 행이 남지 않는다(실측).
 *
 * ⚠️ **`@packages/domain-types` 의 `COUPON_VISIBILITIES` 를 import 하지 않는다.** Medusa 빌드에는
 * 번들러가 없어 `@packages/*` 별칭이 런타임에 해석되지 않는다. 아래 리터럴은 **의도된 사본**이고,
 * 정본과의 정합은 `packages/domain-types/coupon-vocabulary-drift.spec.ts` 가 지킨다.
 *
 * ⚠️ **키를 더하려면 `helpers.ts` 의 `META_KEYS` 와 함께 더할 것.** 프레임워크가 이 shape 을
 * `z.object(...)` 로 감싸는데 그 기본이 strip 이라, 여기 없는 키는 400 이 아니라 조용히 버려진다.
 * `__tests__/additional-data-schema.unit.spec.ts` 가 두 집합의 일치를 강제한다.
 */

const visibility = z.enum(['public', 'claimable', 'assigned_only']);
const autoIssueTrigger = z.enum(['customer_registered', 'membership_activated', 'birthday']);
const maxClaims = z.number().int().positive();
const maxDiscountAmount = z.number().int().positive();

/**
 * 생성용. `visibility` 만 **필수**다 — 이 값이 없으면 「발급 정책 없는 쿠폰」이 되고
 * 그 기본값 판단을 읽기 계층이 떠안게 된다.
 *
 * 🔴 이 필수 지정이 막지 **못하는** 것: `additional_data` **객체 자체의 생략**. 프레임워크가
 * `z.object(shape).nullish()` 로 감싸기 때문이다(실측). 그 구멍은 검증이 아니라
 * **닫힌 기본값**(`helpers.ts` 의 `resolveVisibility`)이 막는다.
 */
export const promotionAdditionalDataCreateShape = {
  visibility,
  name: z.string().optional(),
  created_by: z.string().optional(),
  max_claims: maxClaims.optional(),
  max_discount_amount: maxDiscountAmount.optional(),
  auto_issue_trigger: autoIssueTrigger.optional(),
};

/**
 * 수정용. 전부 optional 이다 — 어드민의 상태 토글은 `{ status }` 만 보내고, 메타 부분 갱신도
 * 보내는 키만 덮는 것이 옛 라우트의 의미론이었다.
 */
export const promotionAdditionalDataUpdateShape = {
  visibility: visibility.optional(),
  name: z.string().optional(),
  created_by: z.string().optional(),
  max_claims: maxClaims.optional(),
  max_discount_amount: maxDiscountAmount.optional(),
  auto_issue_trigger: autoIssueTrigger.optional(),
};
```

- [ ] **Step 4: 유닛 통과를 확인한다**

Run: `cd apps/medusa && npm run test:unit`
Expected: 27 suites 전부 통과

- [ ] **Step 5: 미들웨어에 등록한다**

`apps/medusa/src/api/middlewares.ts` — import 를 더하고:

```typescript
import {
  promotionAdditionalDataCreateShape,
  promotionAdditionalDataUpdateShape,
} from './admin/promotions/additional-data-schema';
```

`routes` 배열의 `...adminRouteMiddlewares,` **바로 뒤**에 삽입한다:

```typescript
    // additional_data 안쪽 검증 (#488 N7). 코어 zod 는 여기를 z.record(z.unknown()) 로 열어두므로
    // 어휘 밖 값이 워크플로까지 갔다가 DB CHECK 에서 500 이 났고, 그 시점엔 프로모션이 이미
    // active 로 만들어져 있었다. 검증기를 걸면 400 이고 프로모션 행이 남지 않는다(실측).
    // 코어 라우트가 이 값을 그대로 쓰므로 우리 라우트에 POST 핸들러가 없어도 걸린다.
    {
      matcher: '/admin/promotions',
      method: 'POST',
      additionalDataValidator: promotionAdditionalDataCreateShape,
    },
    {
      matcher: '/admin/promotions/:id',
      method: 'POST',
      additionalDataValidator: promotionAdditionalDataUpdateShape,
    },
```

- [ ] **Step 6: 실패하는 통합 회귀를 쓴다**

`apps/medusa/integration-tests/http/coupon-admin.spec.ts` 에 추가:

```typescript
    it('어휘 밖 visibility 는 400 이고 프로모션이 남지 않는다 (N7 회귀)', async () => {
      const code = `BADVIS${seq}`;
      const err = await api
        .post(
          '/admin/promotions',
          {
            code,
            type: 'standard',
            is_automatic: false,
            status: 'active',
            application_method: { type: 'percentage', value: 10, target_type: 'order' },
            additional_data: { visibility: 'bogus_value' },
          },
          adminHeaders,
        )
        .catch((e: any) => e);

      expect(err.response.status).toBe(400);

      const promotionModule = getContainer().resolve(Modules.PROMOTION);
      expect(await promotionModule.listPromotions({ code })).toHaveLength(0);
    });

    it('상태 토글은 additional_data 없이도 200 이고 메타를 지우지 않는다', async () => {
      const code = `TOGGLE${seq}`;
      const id = await createPromo(code, { visibility: 'assigned_only', name: '토글 대상' });

      const res = await api.post(`/admin/promotions/${id}`, { status: 'inactive' }, adminHeaders);
      expect(res.status).toBe(200);

      const detail = await api.get(`/admin/promotions/${id}`, adminHeaders);
      expect(detail.data.promotion.metadata).toMatchObject({
        visibility: 'assigned_only',
        name: '토글 대상',
      });
    });
```

- [ ] **Step 7: 통합 통과를 확인한다**

Run: `scripts/local/run-medusa-integration.sh --testPathPattern 'coupon-'`
Expected: **4 suites / 41 tests 통과** (기준선 38 + Task 2 의 1 + 여기 2)

- [ ] **Step 8: 드리프트 가드에 새 사이트를 등록한다**

`packages/domain-types/coupon-vocabulary-drift.spec.ts` 의 `VISIBILITY_SITES` 배열에 추가:

```typescript
  {
    name: 'medusa additional_data zod enum (visibility)',
    path: 'apps/medusa/src/api/admin/promotions/additional-data-schema.ts',
    anchor: /const visibility = z\.enum\(\[([^\]]*)\]\)/,
  },
```

같은 파일의 `TRIGGER_SITES` 배열에 추가:

```typescript
  {
    name: 'medusa additional_data zod enum (auto_issue_trigger)',
    path: 'apps/medusa/src/api/admin/promotions/additional-data-schema.ts',
    anchor: /const autoIssueTrigger = z\.enum\(\[([^\]]*)\]\)/,
  },
```

- [ ] **Step 9: 드리프트 가드를 돌린다**

Run: 루트에서 `npx jest packages/domain-types`
Expected: 통과. (일부러 `additional-data-schema.ts` 의 `'public'` 을 `'publik'` 으로 고쳐
빨개지는지 한 번 확인하고 되돌릴 것 — 가드가 실제로 그 파일을 보는지 증명한다.)

- [ ] **Step 10: 커밋**

```bash
git add apps/medusa/src/api/admin/promotions/additional-data-schema.ts \
        apps/medusa/src/api/admin/promotions/__tests__/additional-data-schema.unit.spec.ts \
        apps/medusa/src/api/middlewares.ts \
        apps/medusa/integration-tests/http/coupon-admin.spec.ts \
        packages/domain-types/coupon-vocabulary-drift.spec.ts
git commit -m "feat(medusa): additional_data 를 검증하고 어휘를 드리프트 가드에 등록한다 (#488 N7)"
```

---

## Task 4: 메타가 없을 때의 기본값을 닫는다

> 실측 ⑤ — validator 가 있어도 `additional_data` **자체를 생략**하면 메타 0행 쿠폰이 만들어진다.
> 오늘 그 상태의 기본값은 전부 「전체공개」이고 카트 게이트도 통과한다. 그걸 뒤집는다.
>
> 부수 효과가 하나 있고 **의도한 것이다**: 네이티브 Medusa 대시보드(`/app/promotions`, 아직 켜져 있다)로
> 만든 쿠폰은 메타가 없으므로 **아무도 못 쓰게 된다.** 감사되지 않은 쓰기 경로가 위험한 것에서
> 무해한 것으로 바뀐다 — 「네이티브 대시보드는 쓰지 않는다」는 원칙과 같은 방향이다.

**Files:**
- Modify: `apps/medusa/src/api/admin/promotions/helpers.ts`
- Create: `apps/medusa/src/api/admin/promotions/__tests__/visibility-default.unit.spec.ts`
- Modify: `apps/medusa/src/api/store/customers/me/promotions/route.ts:120,124,187`
- Modify: `apps/medusa/src/api/store/coupons/preview/route.ts:75`
- Modify: `apps/medusa/src/api/store/events/[slug]/route.ts:85`
- Modify: `apps/medusa/src/api/store/carts/middlewares/per-customer-limit.ts:33`
- Modify: `apps/medusa/src/workflows/hooks/cart/complete-cart.ts:33`

**Interfaces:**
- Produces:
  - `export const VISIBILITY_WHEN_META_MISSING = 'assigned_only'`
  - `export function resolveVisibility(metaRecord: unknown): 'public' | 'claimable' | 'assigned_only'`
  - `export function requiresIssuance(metaRecord: unknown): boolean`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`apps/medusa/src/api/admin/promotions/__tests__/visibility-default.unit.spec.ts`:

```typescript
import { requiresIssuance, resolveVisibility, VISIBILITY_WHEN_META_MISSING } from '../helpers';

describe('resolveVisibility — 메타가 없을 때의 기본값', () => {
  it('메타 행이 없으면 닫힌 쪽이다', () => {
    expect(VISIBILITY_WHEN_META_MISSING).toBe('assigned_only');
    expect(resolveVisibility(null)).toBe('assigned_only');
    expect(resolveVisibility(undefined)).toBe('assigned_only');
  });

  it('어휘 밖 값도 닫힌 쪽으로 접는다 — «모르는 값이 공개» 가 #488 N3 의 버그였다', () => {
    expect(resolveVisibility({ visibility: 'bogus_value' })).toBe('assigned_only');
    expect(resolveVisibility({})).toBe('public'); // 컬럼이 NOT NULL DEFAULT 'public' 이라 행이 있으면 공개
  });

  it('어휘 안의 값은 그대로 돌려준다', () => {
    expect(resolveVisibility({ visibility: 'public' })).toBe('public');
    expect(resolveVisibility({ visibility: 'claimable' })).toBe('claimable');
    expect(resolveVisibility({ visibility: 'assigned_only' })).toBe('assigned_only');
  });
});

describe('requiresIssuance — 카트 게이트가 묻는 것', () => {
  it('공개가 아니면 발급이 필요하다', () => {
    expect(requiresIssuance({ visibility: 'public' })).toBe(false);
    expect(requiresIssuance({ visibility: 'claimable' })).toBe(true);
    expect(requiresIssuance({ visibility: 'assigned_only' })).toBe(true);
  });

  it('메타가 없으면 발급이 필요하다 — 오늘은 여기서 게이트가 통과했다', () => {
    expect(requiresIssuance(null)).toBe(true);
    expect(requiresIssuance(undefined)).toBe(true);
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `cd apps/medusa && npm run test:unit`
Expected: FAIL — `resolveVisibility is not a function`

- [ ] **Step 3: `helpers.ts` 에 구현한다**

`apps/medusa/src/api/admin/promotions/helpers.ts` 의 `toMetadataShape` 함수 **바로 뒤**에 추가한다.
같은 파일 `:43` 의 `record.visibility ?? 'public'` 은 **그대로 둔다** — 아래 주석이 이유다.

```typescript
/**
 * `promotion_meta` **행이 없을 때** 의 `visibility`.
 *
 * 오늘 이 자리의 기본값은 전부 `'public'` 이었고, 그것이 #488 `N7` 의 손해를 키웠다 —
 * 메타 쓰기가 실패해 행이 안 남으면 「발급받은 사람만」 쿠폰이 **아무나 쓰는 쿠폰**이 됐다.
 * 검증기(`additional-data-schema.ts`)를 걸어도 `additional_data` **객체 자체를 생략**하면
 * 메타 0행 쿠폰은 계속 만들어진다(2026-08-31 실측) — 그 구멍을 막는 것이 이 상수다.
 *
 * 부수 효과는 의도한 것이다: 네이티브 Medusa 대시보드로 만든 쿠폰은 메타가 없으므로
 * 아무도 못 쓴다. 감사되지 않은 쓰기 경로가 **위험**에서 **무해**로 바뀐다.
 */
export const VISIBILITY_WHEN_META_MISSING = 'assigned_only' as const;

export type CouponVisibilityValue = 'public' | 'claimable' | 'assigned_only';

const KNOWN_VISIBILITIES: readonly CouponVisibilityValue[] = ['public', 'claimable', 'assigned_only'];

/**
 * 메타 레코드에서 `visibility` 를 꺼낸다. **행이 없거나 어휘 밖이면 닫힌 쪽으로 접는다.**
 *
 * 행이 **있고** 컬럼이 비어 있는 경우만 `'public'` 이다 — 그 컬럼은
 * `NOT NULL DEFAULT 'public'`(`Migration20260526140000`) 이라 「비어 있음 = 공개」가 맞다.
 * `toMetadataShape` 안의 `?? 'public'` 이 그 의미론이고, 그래서 그 줄은 바꾸지 않는다.
 */
export function resolveVisibility(metaRecord: unknown): CouponVisibilityValue {
  const shape = toMetadataShape(metaRecord);
  if (!shape) return VISIBILITY_WHEN_META_MISSING;
  const value = shape.visibility as CouponVisibilityValue | undefined;
  return value && KNOWN_VISIBILITIES.includes(value) ? value : VISIBILITY_WHEN_META_MISSING;
}

/**
 * 「이 쿠폰은 발급받은 고객만 쓸 수 있는가」. 카트 게이트와 주문 확정 백스톱이 묻는 질문이다.
 *
 * 옛 코드는 `visibility === 'assigned_only' || === 'claimable'` 였는데, 메타가 없으면
 * `undefined` 라 **게이트를 통과**했다. 「공개가 아니면 발급 필요」로 뒤집으면 그 구멍이 닫힌다.
 */
export function requiresIssuance(metaRecord: unknown): boolean {
  return resolveVisibility(metaRecord) !== 'public';
}
```

- [ ] **Step 4: 유닛 통과를 확인한다**

Run: `cd apps/medusa && npm run test:unit`
Expected: 28 suites 전부 통과

- [ ] **Step 5: 읽기 사이트 5곳을 교체한다**

**(a)** `apps/medusa/src/api/store/carts/middlewares/per-customer-limit.ts`
import 를 `import { toMetadataShape } from '../../../admin/promotions/helpers';` →
`import { requiresIssuance } from '../../../admin/promotions/helpers';` 로 바꾸고,

```typescript
    const meta = await promotionMetaService.getByPromotionId(promotion.id);
    const metaShape = toMetadataShape(meta);

    if (metaShape?.visibility === 'assigned_only' || metaShape?.visibility === 'claimable') {
```
를
```typescript
    const meta = await promotionMetaService.getByPromotionId(promotion.id);

    // 메타가 없으면 «발급 필요» 다(닫힌 기본값). 옛 코드는 undefined 라 게이트를 통과했다.
    if (requiresIssuance(meta)) {
```
로 바꾼다.

**(b)** `apps/medusa/src/workflows/hooks/cart/complete-cart.ts`
import 를 `import { toMetadataShape } from '../../../api/admin/promotions/helpers';` →
`import { requiresIssuance } from '../../../api/admin/promotions/helpers';` 로 바꾸고,

```typescript
      const meta = await promotionMetaService.getByPromotionId(promo.id);
      const metaShape = toMetadataShape(meta);

      if (metaShape?.visibility === 'assigned_only' || metaShape?.visibility === 'claimable') {
```
를
```typescript
      const meta = await promotionMetaService.getByPromotionId(promo.id);

      // 메타가 없으면 «발급 필요» 다(닫힌 기본값). 옛 코드는 undefined 라 백스톱도 통과했다.
      if (requiresIssuance(meta)) {
```
로 바꾼다.

**(c)** `apps/medusa/src/api/store/coupons/preview/route.ts:74-75`

```typescript
  const meta = await promotionMetaService.getByPromotionId(promotion.id);
  const metaShape = toMetadataShape(meta);
  const visibility = (metaShape?.visibility as string) ?? 'public';
```
를
```typescript
  const meta = await promotionMetaService.getByPromotionId(promotion.id);
  const metaShape = toMetadataShape(meta);
  const visibility: string = resolveVisibility(meta);
```
로 바꾸고 import 에 `resolveVisibility` 를 더한다. (`metaShape` 는 같은 파일에서 계속 쓰이면 남긴다.
쓰이지 않으면 지운다 — `npx tsc --noEmit` 이 알려준다.)

**(d)** `apps/medusa/src/api/store/events/[slug]/route.ts:85`

```typescript
    const visibility = (toMetadataShape(meta)?.visibility as string) ?? 'public';
```
를
```typescript
    const visibility: string = resolveVisibility(meta);
```
로 바꾸고 import 를 `toMetadataShape` → `resolveVisibility` 로 조정한다.

**(e)** `apps/medusa/src/api/store/customers/me/promotions/route.ts:119-124,187`

```typescript
  const visibilityById = new Map<string, string>(
    metas.map((m: any) => [m.promotion_id, toMetadataShape(m)?.visibility as string ?? 'public'])
  );
  // visibility 는 promotion_meta 에서 온다. 호출부가 매번 조회하지 않도록 여기서 묶는다.
  const format = (promo: any, isAssigned: boolean) =>
    formatPromotion(promo, isAssigned, visibilityById.get(promo.id) ?? 'public');
```
를
```typescript
  const visibilityById = new Map<string, string>(
    metas.map((m: any) => [m.promotion_id, resolveVisibility(m) as string])
  );
  // 메타 행이 아예 없는 프로모션은 맵에 키가 없다 → 닫힌 기본값으로 떨어진다.
  const visibilityOf = (promotionId: string): string =>
    visibilityById.get(promotionId) ?? VISIBILITY_WHEN_META_MISSING;
  // visibility 는 promotion_meta 에서 온다. 호출부가 매번 조회하지 않도록 여기서 묶는다.
  const format = (promo: any, isAssigned: boolean) =>
    formatPromotion(promo, isAssigned, visibilityOf(promo.id));
```
로 바꾸고, `:187` 의

```typescript
      (visibilityById.get(promo.id) ?? 'public') === 'public' &&
```
를
```typescript
      visibilityOf(promo.id) === 'public' &&
```
로 바꾼다. import 에 `resolveVisibility`, `VISIBILITY_WHEN_META_MISSING` 을 더한다.

- [ ] **Step 6: `?? 'public'` 이 하나만 남았는지 확인한다**

Run: `cd apps/medusa && grep -rn "?? 'public'" src/`
Expected: **정확히 1줄** — `src/api/admin/promotions/helpers.ts:43`
(행이 있을 때의 컬럼 기본값. 위 주석이 이유다.)

- [ ] **Step 7: 게이트 전체를 돌린다**

Run:
```bash
cd apps/medusa && npm run test:unit && npx tsc --noEmit 2>&1 | grep -c "error TS"
```
Expected: 28 suites 통과 · 타입 에러 `3`

Run: `scripts/local/run-medusa-integration.sh --testPathPattern 'coupon-'`
Expected: **41 tests 전부 통과.** 특히 `coupon-cart.spec.ts` 와 `coupon-store.spec.ts` 는 게이트와
목록 노출을 직접 덮으므로, 여기서 빨개지면 닫힌 기본값이 정상 쿠폰까지 막은 것이다.

- [ ] **Step 8: 커밋**

```bash
git add apps/medusa/src/api apps/medusa/src/workflows/hooks/cart/complete-cart.ts
git commit -m "fix(medusa): 메타 없는 쿠폰의 기본값을 닫는다 (#488 N7)"
```

---

## Task 5: 쓰기 핸들러를 지우고 `GET` 만 남긴다

> 실측 ① 이 성립을 확인했다. 이 태스크가 `N8`(쓰기분)과 `7-8` 을 닫는다 —
> `req.validatedBody ?? req.body` 폴백이 사라지므로 **코어 미들웨어가 안 붙으면 조용히 무검증으로
> 도는** 대신 아예 우리 코드가 없어진다.

**Files:**
- Modify: `apps/medusa/src/api/admin/promotions/route.ts` — `POST` 삭제(`:55-93`)
- Modify: `apps/medusa/src/api/admin/promotions/[id]/route.ts` — `POST`·`DELETE` 삭제(`:17-48`)

**Interfaces:**
- Consumes: Task 2 의 훅 3개 (이제 유일한 메타 쓰기 경로), Task 3 의 검증기
- Produces: 없음 — 삭제만 한다

- [ ] **Step 1: `route.ts` 의 `POST` 를 지운다**

`apps/medusa/src/api/admin/promotions/route.ts` 에서 `export async function POST` 부터 파일 끝까지 삭제한다.
남는 파일 머리의 import 를 정리하고(`createPromotionsWorkflow` · `MedusaError` ·
`extractMetaFromAdditionalData` 가 안 쓰이면 지운다), 파일 상단에 주석을 더한다:

```typescript
/**
 * `GET /admin/promotions` **만** override 한다 (#488 N8).
 *
 * 쓰기(`POST`)는 코어 핸들러가 처리한다. Medusa 는 라우트를 **메서드 단위로 병합**하므로
 * (`framework/dist/http/routes-loader.js` 의 `#routes[matcher][method]`), 이 파일이 `GET` 만
 * export 하면 코어의 `POST` 가 그대로 살아난다 — 2026-08-31 실측(우리 파일에서 POST 를 지우고
 * 부팅 → `POST /admin/promotions` 200).
 *
 * `promotion_meta` 쓰기는 `workflows/hooks/promotion/promotion-meta.ts` 로 옮겼다. 그래야 실패 시
 * 프로모션이 함께 롤백된다.
 *
 * `GET` 을 남기는 이유: admin-web 이 `metadata`(=`visibility`·`issued_count`)를 여기서 받는다.
 * 읽기 override 의 위험은 「코어 개선을 못 받는다」뿐이고 원자성·검증과 무관하다.
 */
```

- [ ] **Step 2: `[id]/route.ts` 의 `POST`·`DELETE` 를 지운다**

`apps/medusa/src/api/admin/promotions/[id]/route.ts` 에서 `export async function POST` 부터 파일 끝까지
삭제한다. 남는 것은 import + `GET` 뿐이다. 파일 상단에 같은 취지의 주석을 더한다:

```typescript
/**
 * `GET /admin/promotions/:id` **만** override 한다 (#488 N8).
 *
 * `POST`(수정)·`DELETE` 는 코어 핸들러가 처리하고, `promotion_meta` 정리는
 * `workflows/hooks/promotion/promotion-meta.ts` 의 `promotionsUpdated` · `promotionsDeleted` 훅이 한다.
 * 메서드 단위 병합이라 이 파일이 `GET` 만 export 해도 나머지 둘이 살아난다(2026-08-31 실측).
 */
```

- [ ] **Step 3: 남은 참조가 없는지 확인한다**

Run:
```bash
cd apps/medusa && npx tsc --noEmit 2>&1 | grep -c "error TS"
grep -rn "extractMetaFromAdditionalData" src/ | grep -v __tests__
```
Expected: 타입 에러 `3` · `extractMetaFromAdditionalData` 는 `helpers.ts`(정의)와
`workflows/hooks/promotion/apply-promotion-meta.ts`(유일한 사용처) 두 줄만

- [ ] **Step 4: 통합 스펙 전체를 돌린다 — 이게 이 태스크의 진짜 검증이다**

Run: `scripts/local/run-medusa-integration.sh --testPathPattern 'coupon-'`
Expected: **41 tests 전부 통과.** 여기서 통과한다는 것은:
- `creates a promotion with meta via admin API` → **코어 POST + 훅**으로 메타가 여전히 써진다
- `GET promotion exposes issued_count in metadata (P2-10)` → 우리 `GET` 이 살아 있다
- `DELETE promotion purges issue-logs (P3-6)` → **코어 DELETE + 훅**이 로그를 정리한다
- `상태 토글은 …` → 코어 `[id]` POST 가 200 이고 메타를 안 지운다

- [ ] **Step 5: 실 스택으로 끝단 확인**

로컬 Medusa 를 재기동한 뒤(`cd apps/medusa && npx medusa develop`):

```bash
TOK=$(curl -s -X POST http://localhost:9000/auth/user/emailpass -H 'content-type: application/json' \
  -d '{"email":"<관리자메일>","password":"<비밀번호>"}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["token"])')

# ① 정상 생성 → 200 이고 GET 에 metadata 가 실린다
curl -s -X POST http://localhost:9000/admin/promotions -H "authorization: Bearer $TOK" \
  -H 'content-type: application/json' \
  -d '{"code":"P10A_OK","type":"standard","status":"active","is_automatic":false,
       "application_method":{"type":"percentage","value":10,"target_type":"order"},
       "additional_data":{"visibility":"assigned_only","name":"검증"}}' -w '\n%{http_code}\n'
curl -s "http://localhost:9000/admin/promotions/P10A_OK" -H "authorization: Bearer $TOK" \
  | python3 -c 'import sys,json;print(json.load(sys.stdin)["promotion"]["metadata"])'
# → {'name': '검증', 'visibility': 'assigned_only', 'issued_count': 0}

# ② 어휘 밖 → 400 이고 행이 안 남는다
curl -s -X POST http://localhost:9000/admin/promotions -H "authorization: Bearer $TOK" \
  -H 'content-type: application/json' \
  -d '{"code":"P10A_BAD","type":"standard","status":"active",
       "application_method":{"type":"percentage","value":10,"target_type":"order"},
       "additional_data":{"visibility":"bogus_value"}}' -w '\n%{http_code}\n'
curl -s "http://localhost:9000/admin/promotions?q=P10A_BAD" -H "authorization: Bearer $TOK" \
  | python3 -c 'import sys,json;print("count:", json.load(sys.stdin)["count"])'   # → 0

# ③ 정리
ID=$(curl -s "http://localhost:9000/admin/promotions/P10A_OK" -H "authorization: Bearer $TOK" \
     | python3 -c 'import sys,json;print(json.load(sys.stdin)["promotion"]["id"])')
curl -s -X DELETE "http://localhost:9000/admin/promotions/$ID" -H "authorization: Bearer $TOK" -w '\n%{http_code}\n'
```

Expected: ① `200` + metadata 3키 · ② `400` + count `0` · ③ `200`

- [ ] **Step 6: 커밋**

```bash
git add apps/medusa/src/api/admin/promotions
git commit -m "refactor(medusa): 쿠폰 쓰기 라우트 override 를 걷고 GET 만 남긴다 (#488 N8, 7-8)"
```

---

## Task 6: 정본 갱신

**Files:**
- Modify: `docs/superpowers/plans/2026-08-29-coupon-domain-master-plan.md` (「진행 상황」)
- 이슈 #488 본문 갱신 (`gh issue edit`)

- [ ] **Step 1: 마스터플랜 「진행 상황」을 고친다**

```markdown
- [x] **P10-A 플랜 작성·실행 (2026-08-31)** — `2026-08-31-coupon-write-path-to-hooks.md`.
      ⛔ 첫 실측 완료: **Medusa 는 라우트를 메서드 단위로 병합한다** — 우리 파일이 `GET` 만
      export 하면 코어 `POST` 가 살아난다(라이브러리 프로브 + 실부팅 둘 다). 그래서 PR 모양은
      계획대로 「쓰기 핸들러 제거, `GET` 만 남김」이 성립.
      함께 나온 것: `additionalDataValidator` 는 코어 POST 에 먹지만 **`additional_data` 객체
      자체의 생략은 못 막는다**(프레임워크가 `.nullish()` 로 감싼다) → 닫힌 기본값이 필수.
      `z.object` 가 strip 이라 **스키마에 없는 키는 조용히 사라진다** → P10-B 의
      `max_discount_amount` 는 스키마에 함께 넣어야 하고, 그 정합을 유닛 테스트가 지킨다.
```

`- [ ] P10-B 플랜 작성·실행` 줄에 다음을 덧붙인다:

```markdown
      **P10-A 가 남긴 선행조건**: `max_discount_amount` 는 이미 `META_KEYS` 와
      `additional-data-schema.ts` 에 들어 있다(스키마 키 집합 테스트가 강제). 폼에서 값을 보내면
      훅이 그대로 `promotion_meta` 에 쓴다 — **P10-B 는 쓰기 배선을 새로 만들 필요가 없다.**
```

- [ ] **Step 2: 이슈 #488 을 갱신한다**

`N7` · `N8` · `7-8` 항목 머리에 「✅ 해결 (2026-08-31, P10-A)」를 붙이고, 「2026-08-31 작업 순서」 절의
「⛔ P10-A 의 첫 작업」 블록을 실측 결과로 바꾼다(위 「0. 이 플랜을 여는 실측」 표를 그대로 옮긴다).

```bash
gh issue view 488 --json body -q .body > /tmp/488.md
# 편집 후
gh issue edit 488 --body-file /tmp/488.md
```

- [ ] **Step 3: 커밋**

```bash
git add docs/superpowers/plans/2026-08-29-coupon-domain-master-plan.md
git commit -m "docs(coupon): P10-A 실행 결과와 실측을 정본에 반영한다 (#488)"
```

---

## 최종 게이트 (PR 올리기 전에 전부)

```bash
# 1. Medusa 유닛 — 28 suites 전부 통과 (기준선 25 + 신규 3)
cd apps/medusa && npm run test:unit

# 2. Medusa 타입 — 정확히 3건 (선재분)
cd apps/medusa && npx tsc --noEmit 2>&1 | grep -c "error TS"

# 3. 쿠폰 통합(실 DB) — 41 tests 전부 통과 (기준선 38 + 신규 3)
scripts/local/run-medusa-integration.sh --testPathPattern 'coupon-'

# 4. 어휘 드리프트 + 루트 게이트
npm run type-check && npx jest packages/domain-types

# 5. `?? 'public'` 은 딱 한 줄만 남는다
cd apps/medusa && grep -rn "?? 'public'" src/     # → helpers.ts:43 하나
```

## 이 플랜이 **하지 않는** 것

- **`GET` override 제거** — `N8` 이 남기기로 결정했다.
- **쿠폰 밖 코어 라우트 override 9개** — `N8` 이 별건으로 남겼다.
- **네이티브 `/app` 대시보드 비활성화** — #488 「못 정한 것」. 다만 Task 4 의 닫힌 기본값이 그 경로의
  **위험을 무해로** 바꾼다(대시보드로 만든 쿠폰은 아무도 못 쓴다).
- **`A4` 정률 캡** — P10-B. 이 플랜은 그 값이 탈 배선(`META_KEYS` + 검증 스키마 + 훅)만 준비한다.
- **`7-1` 발급 카운트 원자성 · `7-7` 이중 dedup** — P4 소유.
- **`promotion_meta` 리네임(`N6`)** — P6 소유이고 ADR 이 「리네임 비권장」으로 판단했다.
- **`upsert` 를 `ON CONFLICT` 로 바꾸기(`7-10` 잔여)** — 훅 안으로 들어와도 list-then-insert 는 그대로다.
  생성 동시성이 낮아 순위가 낮고, 이 플랜의 주제(원자성 = 프로모션과 메타가 함께 살고 죽는가)와 다른 축이다.
