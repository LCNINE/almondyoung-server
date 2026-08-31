# 발급 인스턴스를 두껍게 + 유효기간 두 축 — 설계 (P4 + P5)

> **SoT:** 이슈 [#488](https://github.com/LCNINE/almondyoung-server/issues/488)
> **로드맵:** `docs/superpowers/plans/2026-08-29-coupon-domain-master-plan.md`
> **경계:** `docs/adr/0033-coupons-are-owned-by-the-sales-channel.md`
> **담는 항목:** `N4` → `7-1` · `7-7` · `A2`(준비까지) · `1-3`(종결) · 결정 2(`birthday` 폐지)

P4 와 P5 는 한 몸이다. 「발급일 + delta」는 **발급 인스턴스마다 만료가 다르다**는 뜻이고, 그러면 만료
실값은 프로모션이 아니라 **발급 링크 행의 속성**이다 — 그게 정확히 P4 가 만드는 `extraColumns` 다.
따로 하면 마이그레이션을 두 번 친다.

---

## 1. 이 설계가 서 있는 결정들

상위 결정 6건은 마스터플랜의 「✅ 결정 6건 확정 (2026-08-31, 2차)」 절이 정본이다. 이 문서가
전제로만 삼는 것:

- **결정 1** — 유효기간은 두 축. 캠페인 창 = 발급 가능 기간, 쿠폰별 유효기간 = 사용 가능 기간.
  `computeActions` 가 `listActivePromotions_` 를 타서 캠페인 창이 지난 프로모션을 계산에서
  **제외**하므로, `campaign.ends_at` 을 채워두면 두 축이 표현되지 않는다 → **캠페인 날짜를 안 쓴다.**
- **결정 2** — `birthday` 트리거 폐지. 구현하지 않고 어휘에서 제거.
- **`4-2` 는 버그가 아니다.** 세 경로가 같은 값(`campaign.ends_at`)을 본 것이고, 진짜 사실은
  **`Promotion` 모델에 만료 필드가 없다**는 것이다.

### 이 세션에서 새로 정한 것 3건

| # | 결정 | 결론 |
|---|---|---|
| **①** | 유효기간 정책의 저장 모양 | **`promotion_meta` 3열** (`starts_at` · `ends_at` · `validity_days`). mode 컬럼 없음 |
| **②** | `campaign` 날짜가 채워진 기존 프로모션 | **마이그레이션은 백필만**, 비우기·분리는 `medusa exec` 1회성 스크립트 |
| **③** | `used_at`/`order_id` 쓰기 범위 | **이번에 쓴다** — `completeCartWorkflow.hooks.orderCreated` 신설 |

#### ① 왜 3열인가

`starts_at`/`ends_at` 은 오늘 `campaign.starts_at`/`ends_at` 의 **1:1 이사**다. 의미가 안 바뀌므로
소비자 12곳이 기계적 치환으로 끝난다. 의미는 visibility 에 따라 이렇게 읽힌다:

- `claimable` · `assigned_only` → **발급 가능 구간**
- `public` → **사용 가능 구간** (발급이라는 사건이 없으므로 창이 곧 사용 창이다)

**기각 — `validity_mode` 컬럼.** mode 는 `validity_days` 의 null 여부에서 파생된다. 저장하면
`mode='days'` 인데 `validity_days IS NULL` 인 행이 DB 상 가능해지고, 그건 마스터플랜이
「`campaign.ends_at` 을 발급종료일+유효기간으로 늘려잡기」를 기각한 것과 **같은 실패 유형**이다
(두 값이 어긋나는 순간 조용히 틀린다).

**기각 — `valid_from`/`valid_until` 두 벌(절대 4열).** 발급된 장의 사용 창은 발급일마다 다르므로
절대값 한 쌍으로 못 적는다. 두 벌은 결국 `validity_days` 를 더해 5열이 되거나, 결정 1의
「발급일+delta」를 포기해야 한다.

**포기하는 것:** 「발급은 12/1~12/31, 사용은 1/15부터」 같은 **사용 시작일 지연**. 오늘도 표현
못 하고 요구도 없다. 필요해지면 nullable 1열 추가 = expand 1 PR.

#### ② 왜 마이그레이션이 비우지 않는가

`promotion_campaign` 과 `promotion` 은 **코어 프로모션 모듈 소유 테이블**이다. `promotion-meta`
모듈의 마이그레이션이 그것을 UPDATE 하면 모듈 격리를 어기고, 코어 스키마가 바뀌면 조용히 깨지며,
`down()` 이 복원 불가다. 읽기 백필만 마이그레이션에 두고 쓰기는 밖으로 뺀다(선례:
`apps/medusa/src/scripts/backfill-issued-count.ts`).

스크립트 실행 전에는 옛 쿠폰이 여전히 엔진 필터에 걸린다 — 그건 **오늘과 같은 동작**이라 회귀가 아니다.

---

## 2. 소스에서 확정한 사실 7건 — 설계가 여기 의존한다

재조사하지 말 것. 근거 파일·라인을 같이 적는다.

### ⓐ `LINK` 와 `REMOTE_LINK` 는 같은 객체다

`@medusajs/framework/dist/medusa-app-loader.js:219,237` 이 `REMOTE_LINK` 를 `aliasTo(LINK)` 로
등록한다. `@medusajs/utils/dist/common/container.js:12-18` 에서 `REMOTE_LINK` 는
`@deprecated use LINK instead`.

→ `data`(extraColumns) 쓰기는 **어느 쪽에서든 동일하게 된다.** 통일은 기능이 아니라 정리이고,
남길 쪽은 `LINK` 다. 현재 11곳(LINK 6 / REMOTE_LINK 5)이며
`api/admin/promotions/[id]/customers/route.ts:100-101` 은 한 함수에서 둘 다 resolve 한다.

### ⓑ 🔴 `Link.create` 는 INSERT 가 아니라 UPSERT 다

`@medusajs/link-modules/dist/repositories/link.js:21-29` 가 `link.deleted_at = null` 을 박고
`manager.upsertMany(model, links)` 를 부른다. 링크 엔티티의 PK 는 `id` 가 아니라
**`(customer_id, promotion_id)` 복합키**다 (`link-modules/dist/utils/generate-entity.js:16-25` —
두 FK 가 `primary: true`, `id` 는 평범한 인덱스). `Link.create` 는 `link.data` 를 세 번째
필드로 실어 보낸다 (`@medusajs/modules-sdk/dist/link.js:319-323`).

**귀결 셋 — 전부 설계에 반영된다:**

1. **재발급이 `expires_at` 을 덮어쓴다.** 발급 3경로의 `alreadyIssued` 선검사가 이제
   편의가 아니라 **정합성 방어선**이다.
2. **회수(dismiss = soft delete) 후 재발급이 같은 행을 되살린다.** 새 행이 아니다.
   `used_at`/`order_id` 를 명시적으로 `null` 로 덮지 않으면 **오염된 채 부활한다.**
3. 발급 3경로의 `23505 duplicate` catch 분기는 **도달 불가로 확인됐다.** 같은 `(customer_id,
   promotion_id)` 쌍으로 `Link.create` 를 두 번 불러도 두 번째 호출은 예외 없이 성공하고
   `23505` 는 한 번도 나지 않으며, 행 수는 계속 1이다 — `integration-tests/http/coupon-validity.spec.ts`
   의 T3(「Link.create 의 의미론」)가 실측했다. 이 결과에 따라 발급 3경로의 해당 분기는
   제거됐다.

### ⓒ 링크 스키마 변경은 배포가 자동 적용한다 — 수동 마이그레이션이 아니다

`apps/medusa/Dockerfile:84` — `CMD ... medusa db:migrate --execute-safe-links && yarn start`.
`--execute-safe` 는 `notify`·`delete` 액션만 건너뛴다
(`@medusajs/medusa/dist/commands/db/sync-links.js:86-119`). `notify` 판정 기준은
**업데이트 SQL 에 `alter column` 또는 `drop column` 이 들어있는지**다
(`@medusajs/link-modules/dist/migration/index.js:40`, `:254-258`).

nullable 컬럼 **추가**는 `add column` 이라 `update` 로 분류 → **적용된다.**

→ 마스터플랜의 「마이그 1건 · `migrate → deploy`」는 **drizzle 서비스 규약이고 Medusa 엔
해당 없다**(CLAUDE.md: 「Medusa 만 예외로 container CMD 가 자체 migrate 를 부른다」).
`sst deploy` 한 번이 곧 마이그레이션이다. `promotion_meta` 모듈 마이그레이션도 같은 명령의
`runModulesMigrations` 로 함께 돈다.

### ⓓ 캠페인 날짜와 연결은 둘 다 끊을 수 있다

`@medusajs/promotion/dist/models/campaign.js:14-15` — `starts_at`/`ends_at` 모두 `.nullable()`.
`promotion.campaign_id` 도 nullable. 비우기·떼어내기 둘 다 가능.

### ⓔ `campaign.{starts_at,ends_at}` 소비자 전수 12파일

**P1 교훈(「누가 이 값을 읽는가를 묻지 않아 Critical 이 났다」)에 따른 필수 항목.**

| 트리 | 파일 | 라인 |
|---|---|---|
| medusa | `api/admin/customers/[id]/issue-coupons/route.ts` | 60, 70-71 |
| medusa | `api/admin/customers/[id]/promotions/route.ts` | 42-43, 104, 152-153 |
| medusa | `api/store/events/[slug]/route.ts` | 48, 80-81, 126 |
| medusa | `api/store/customers/me/promotions/route.ts` | 51-52, 101-102, 229, 233 |
| medusa | `api/store/customers/me/promotions/format-promotion.ts` | 118-119 |
| medusa | `api/store/customers/me/promotions/[id]/claim/route.ts` | 23, 46-47 |
| medusa | `api/store/coupons/preview/route.ts` | 27, 54-55, 97 |
| admin-web | `features/mall/marketing/coupons/coupon-helpers.tsx` | 21-23 |
| admin-web | `features/mall/marketing/coupons/template/marketing-coupons-template.tsx` | 210 |
| storefront | `domains/mypage/template/coupon/coupon-template.tsx` | 9-10 |

`features/mall/marketing/campaigns/template/marketing-campaigns-template.tsx:55-56,140` 은
**캠페인 화면 자신**이라 대상이 아니다(캠페인은 예산이 필요할 때 계속 쓴다).

### ⓕ 🔴 엔진이 대신 해주던 만료 강제가 통째로 사라진다

`listActivePromotions_` 의 캠페인 창 필터가 **`public` 쿠폰의 유일한 만료 방어선**이었다.
`campaign.ends_at` 을 비우면 public 쿠폰은 링크 행이 없어 `expires_at` 도 없다 → **만료가 아예
없어진다.**

→ 그래서 정책 축(절대 창)이 `promotion_meta` 에 반드시 있어야 하고, **`per-customer-limit.ts`
(현재 `requiresIssuance` 일 때만 돈다)와 `complete-cart` 백스톱이 그것을 검사해야 한다.**
**이 작업에서 가장 조용히 틀릴 수 있는 자리이며, §8 의 T5 가 그것을 지키는 유일한 검사다.**

### ⓖ 쓸 수 있는 훅 자리

`completeCartWorkflow.hooks.orderCreated` (`@medusajs/core-flows/dist/cart/workflows/complete-cart.js:522`)
가 **비어 있다** → `used_at`/`order_id` 를 쓸 자리.
`cancelOrderWorkflow.hooks.orderCanceled` (`.../order/workflows/cancel-order.js:137`) 도 비어 있다
— **A2 의 자리이나 이번 범위 밖**이다.

⚠️ 워크플로 훅은 워크플로당 핸들러 하나뿐이다. `completeCartWorkflow.hooks.validate` 는 이미
`workflows/hooks/cart/complete-cart.ts:15` 가 쓰고 있으므로 **거기에 함수를 더한다.**
`workflows/hooks/__tests__/no-duplicate-validate-hooks.unit.spec.ts` 가 이를 지킨다.

---

## 3. 스키마

### 3.1 `promotion_meta` — 모듈 마이그레이션 1건

```sql
ALTER TABLE "promotion_meta" ADD COLUMN IF NOT EXISTS "starts_at" timestamptz NULL;
ALTER TABLE "promotion_meta" ADD COLUMN IF NOT EXISTS "ends_at" timestamptz NULL;
ALTER TABLE "promotion_meta" ADD COLUMN IF NOT EXISTS "validity_days" integer NULL;

ALTER TABLE "promotion_meta" ADD CONSTRAINT "promotion_meta_validity_days_check"
  CHECK ("validity_days" IS NULL OR "validity_days" > 0);

-- 백필: 코어 테이블에서 «읽기만» 한다
UPDATE "promotion_meta" m
   SET "starts_at" = c."starts_at", "ends_at" = c."ends_at"
  FROM "promotion" p
  JOIN "promotion_campaign" c ON c."id" = p."campaign_id"
 WHERE p."id" = m."promotion_id"
   AND m."deleted_at" IS NULL AND p."deleted_at" IS NULL AND c."deleted_at" IS NULL;

-- 결정 2: birthday 어휘 제거. 라이브는 0건이나 dev DB 대비 방어적으로 먼저 비운다.
UPDATE "promotion_meta" SET "auto_issue_trigger" = NULL WHERE "auto_issue_trigger" = 'birthday';
ALTER TABLE "promotion_meta" DROP CONSTRAINT IF EXISTS "promotion_meta_auto_issue_trigger_check";
ALTER TABLE "promotion_meta" ADD CONSTRAINT "promotion_meta_auto_issue_trigger_check"
  CHECK ("auto_issue_trigger" IS NULL
     OR "auto_issue_trigger" IN ('customer_registered', 'membership_activated'));
```

모델(`models/promotion-meta.ts`)에도 세 필드를 더한다 — `model.dateTime().nullable()` ×2 +
`model.number().nullable()`.

### 3.2 링크 `extraColumns` — 마이그레이션 파일 없음

```ts
// apps/medusa/src/links/customer-promotion.ts
export default defineLink(
  { linkable: CustomerModule.linkable.customer, isList: true },
  { linkable: PromotionModule.linkable.promotion, isList: true },
  {
    database: {
      extraColumns: {
        expires_at: { type: 'datetime', nullable: true }, // 발급 시점 계산값. null = 무기한
        used_at:    { type: 'datetime', nullable: true },
        order_id:   { type: 'string',   nullable: true },
        issued_via: { type: 'string',   nullable: true }, // IssueTrigger 어휘
      },
    },
  },
);
```

⚠️ **`issued_count` 는 옮기지 않는다.** 원자적 예약(`UPDATE … WHERE issued_count < ? RETURNING`)이
목적이라 링크를 `COUNT` 하는 순간 원자성을 잃는다. #488 본문 `7-1` 의 「링크 수에서 도출」 제안은
따르지 않는다.

---

## 4. 판정은 순수 함수 셋으로 뽑는다

`apps/medusa/src/modules/promotion-meta/validity.ts` (신규, 컨테이너를 모른다):

```ts
/** 발급 시점에 링크 행에 박을 만료 시각. null = 무기한. */
computeExpiresAt(meta, issuedAt: Date): Date | null
//   validity_days ? issuedAt + N일 : (meta.ends_at ?? null)

/** 지금 이 쿠폰을 «발급»할 수 있는가 (starts_at/ends_at). */
isWithinIssuanceWindow(meta, now: Date): boolean

/** 지금 이 쿠폰을 «사용»할 수 있는가. */
isUsable(link: { expires_at } | null, meta, now: Date): boolean
//   링크 행이 있으면 link.expires_at, 없으면(=public) meta.ends_at.
//   둘 다 null = 무기한. meta.starts_at 이 미래면 아직 못 쓴다.
```

**만료 판정 규칙 한 줄:** *링크 행이 있으면 `link.expires_at`, 없으면 `meta.ends_at`.*

라우트 안 클로저로 두면 검증 대상 밖이라는 P1 교훈 그대로, 판정은 전부 이 `.ts` 에 산다.

---

## 5. 쓰기 경로

### 5.1 발급 3경로

| 경로 | 파일 |
|---|---|
| 자동(트리거) | `api/admin/customers/[id]/issue-coupons/route.ts` |
| 관리자 수동·force | `api/admin/customers/[id]/promotions/route.ts` (POST) |
| 고객 셀프 클레임 | `api/store/customers/me/promotions/[id]/claim/route.ts` |

각각 세 가지를 한다:

1. `campaign.starts_at/ends_at` 검사 → **`isWithinIssuanceWindow(meta, now)`** 로 교체.
   `query.graph` 의 `campaign.*` 필드도 같이 뺀다.
2. 링크 생성에 `data` 를 싣는다 — **네 필드 모두 명시**한다:
   ```ts
   await link.create([{
     [Modules.CUSTOMER]: { customer_id },
     [Modules.PROMOTION]: { promotion_id },
     data: {
       expires_at: computeExpiresAt(meta, now),
       issued_via: trigger,
       used_at: null,    // 🔴 upsert 라 회수된 행이 되살아난다 (§2 ⓑ)
       order_id: null,   // 🔴 같은 이유
     },
   }]);
   ```
3. `REMOTE_LINK` → `LINK` 로 통일.

`issued_via` 값은 기존 `IssueTrigger` 어휘를 그대로 쓴다(`admin_manual` · `admin_force` ·
`customer_claim` · `customer_registered` · `membership_activated`) — `promotion_issue_log.trigger`
와 한 어휘를 공유한다.

### 5.2 사용 기록 — `orderCreated` 훅 신설

`apps/medusa/src/workflows/hooks/cart/record-coupon-usage.ts` (신규):
`completeCartWorkflow.hooks.orderCreated` → 주문에 붙은 프로모션들의 링크 행에
`used_at = now`, `order_id = order.id` 를 `link.create` 로 upsert 한다(같은 행 갱신).

판정·조립은 `.ts` 순수 함수로 뽑고 훅 등록부는 얇게 둔다(`apply-promotion-meta.ts` 와 같은 모양).

> `A2`(취소·환불 시 복구)는 이번 범위 밖이다. 이 두 컬럼이 그 후속의 **유일한 선행**이고,
> 후속은 `cancelOrderWorkflow.hooks.orderCanceled` 하나로 끝난다.

---

## 6. 읽기·강제 경로

### 6.1 강제 (돈이 걸린 자리)

| 자리 | 바뀌는 것 |
|---|---|
| `api/store/carts/middlewares/per-customer-limit.ts` (카트 3경로) | 🔴 **만료 검사를 `requiresIssuance` 블록 밖으로 꺼낸다** — `public` 쿠폰도 검사 대상. 새 머신 토큰 `COUPON_EXPIRED` (기존 `COUPON_NOT_ASSIGNED` 와 같은 방식으로 `message` 에 싣는다) |
| `workflows/hooks/cart/complete-cart.ts` | 같은 판정을 **기존 `validate` 핸들러 안에** 추가. 새 훅을 등록하지 않는다 |

⚠️ 캡(P10-B)과 달리 만료는 **금액 조정이 아니라 거부**다. 백스톱에서 던져도 결제금액 불일치가
생기지 않으므로 「막는 쪽」이 안전하다.

### 6.2 표시

| 파일 | 바뀌는 것 |
|---|---|
| `api/store/coupons/preview/route.ts` | `expires_at: promotion.campaign?.ends_at` → 판정 함수. 창 검사도 meta 기준 |
| `api/store/events/[slug]/route.ts` | 동일 (`:126` 의 `expires_at`, `:80-81` 의 창 검사) |
| `api/store/customers/me/promotions/route.ts` | 🔴 **링크 행을 한 번 조회해 `expires_at` 을 맵으로 들고 온다**(프로모션마다 조회하지 않는다 — `metas` 와 같은 방식). `isValidPromotion` 의 창 검사 + `expired_promotions` 산출 기준을 그 맵으로 |
| `api/store/customers/me/promotions/format-promotion.ts` | 최상위 `expires_at` 신설. 호출부가 `PromotionMetaView` 에 실어 넘긴다(`maxDiscountAmount` 와 같은 방식). `campaign` 블록은 형태 유지(값은 null 이 된다) |
| `api/admin/customers/[id]/promotions/route.ts` (GET) | 링크 컬럼(`expires_at`·`used_at`·`issued_via`) 노출 |
| `api/admin/promotions/[id]/customers/route.ts` (GET) | `select` 에 링크 컬럼 추가 (`created_at` 옆) |
| admin-web `coupon-helpers.tsx` `formatPeriod` | `coupon.campaign` → `metadata.starts_at/ends_at`. **`coupon-detail-dialog.tsx:166` 은 이 함수를 부르므로 자동으로 따라온다** — 별도 수정 없음 |
| admin-web `marketing-coupons-template.tsx:210` | 만료 판정을 meta 기준으로 |
| storefront `coupon-template.tsx:9-10` | `promo.campaign?.ends_at` → `promo.expires_at` |
| storefront `lib/types/dto/promotion.ts` | `expires_at?: string \| null` 추가 |

**링크 컬럼 읽는 법**은 저장소에 이미 선례가 있다 —
`link.getLinkModule(Modules.CUSTOMER, 'customer_id', Modules.PROMOTION, 'promotion_id').list(filter, { select: [...] })`
(`api/admin/promotions/[id]/customers/route.ts:24-25`). 이 방식을 쓴다. 링크 정의의
`entryPoint` 를 통한 `query.graph` 도 가능하나(문서 Method 2), 저장소에 선례가 없어 채택하지 않는다.

---

## 7. 어드민 쓰기 (P5) 와 `1-3` 종결

| 파일 | 바뀌는 것 |
|---|---|
| `api/admin/promotions/additional-data-schema.ts` | create·update 두 shape 에 `starts_at`·`ends_at`(ISO 문자열) · `validity_days`(양의 정수) 추가. `autoIssueTrigger` 에서 `birthday` 제거 |
| `api/admin/promotions/helpers.ts` | `META_KEYS` 에 3키 추가 (검증 스키마와 **같은 집합**이어야 하고 `__tests__/additional-data-schema.unit.spec.ts` 가 강제한다), `toMetadataShape` 에 3키 추가 |
| `modules/promotion-meta/service.ts` | `PromotionMetaData` 타입 3필드, `upsert` 검증 |
| admin-web `lib/build-create-promotion-payload.ts` | `startsAt`/`endsAt` 를 `campaign` 이 아니라 `additional_data` 로. **`hasCampaign` 판정을 `budget` 유무로만** 바꾼다 |
| admin-web `components/coupon-create-dialog.tsx` | 「유효기간(일)」 입력란 추가. 라벨을 「시작일/만료일」 → 발급 정책이 드러나게 조정 |

**`hasCampaign` 을 `budget` 만으로 판정하는 것이 `1-3` 의 남은 절반이다** — 날짜만 넣은 쿠폰이
더 이상 `CAMP_<code>_<ts>` 캠페인을 만들지 않으므로 캠페인 탭이 기계 생성 행으로 오염되지 않는다.

⚠️ 판정 로직은 전부 `.ts`(`build-create-promotion-payload.ts`)에 둔다. admin-web 의 jest
transform 이 `^.+\.(t|j)s$` 라 `.tsx` 안의 분기는 **테스트가 실행조차 되지 않는다.**

---

## 8. `birthday` 어휘 제거 (결정 2)

드리프트 가드(`packages/domain-types/coupon-vocabulary-drift.spec.ts`)의 `TRIGGER_SITES` 가
지목하는 7곳 + 가드 자신 + 부수 3곳:

1. `apps/medusa/.../additional-data-schema.ts:23` — zod enum
2. `apps/medusa/.../promotion-meta/service.ts:12` — `AutoIssueTrigger` 타입
3. `apps/medusa/.../promotion-meta/service.ts:36` — `upsert` 인라인 검증 배열
4. `apps/medusa/.../issue-coupons/route.ts:8` — `VALID_TRIGGERS`
5. DB CHECK — **새 마이그레이션**(§3.1)
6. `apps/channel-adapter/src/adapters/medusa/medusa.client.ts:2399` — 인라인 union
7. `apps/admin-web/.../lib/coupon-meta.ts:11` — `AUTO_ISSUE_TRIGGERS`
8. `packages/domain-types/coupon-vocabulary-drift.spec.ts:30` — 가드 자신의 기대값
9. `apps/admin-web/.../lib/coupon-meta.ts:18` — 라벨 `'생일 (미구현 — 발급되지 않음)'`
10. `apps/admin-web/.../lib/coupon-meta.spec.ts:51` — 스펙
11. `apps/admin-web/.../coupon-create-dialog.tsx:595` — `disabled={key === 'birthday'}` 분기 자체가 사라진다

⚠️ `apps/user-service` · `web/` 의 `birthday` 는 **고객 프로필 생년월일**이다. 건드리지 않는다.

---

## 9. 검증

### 9.1 유닛 (`.ts` 순수 함수)

- `validity.ts` 3함수 — 상대/절대/무기한 × 경계값(정확히 만료 시각, 1ms 전후)
- `build-create-promotion-payload` — 날짜만 넣으면 캠페인이 **안 생기는지**, 날짜가
  `additional_data` 로 가는지, 예산이 있으면 캠페인이 생기는지
- `additional-data-schema` ↔ `META_KEYS` 집합 일치 (기존 스펙이 자동으로 잡는다)
- 드리프트 가드 (자동)

### 9.2 통합 (쿠폰 통합 스펙에 추가)

| # | 무엇을 |
|---|---|
| **T1** | 발급 3경로 각각이 링크 행에 `expires_at` 을 **실제로** 박는가 (상대·절대·무기한 3케이스) |
| **T2** | 회수 → 재발급이 `used_at`/`order_id` 를 **null 로 덮는가** (§2 ⓑ 2번) |
| **T3** | `Link.create` 가 정말 upsert 인가 — 같은 쌍을 두 번 create 해서 행이 1개인지, `23505` 가 안 나는지 (§2 ⓑ 3번의 미확정을 닫는다) |
| **T4** | 만료된 발급 쿠폰이 카트 3경로에서 거부되고 `complete-cart` 백스톱도 막는가 |
| **T5** | 🔴 **`public` 쿠폰이 `meta.ends_at` 만료로 거부되는가** — §2 ⓕ 를 지키는 유일한 검사 |
| **T6** | ⛔ `orderCreated` 훅이 `used_at`/`order_id` 를 쓰는가 — **건너뜀, 아래 참고** |

**T6 은 실행되지 않았다.** 카트를 실제 주문으로 완결하려면 결제 세션/프로바이더 플로우가
필요한데, 이 저장소의 쿠폰 통합 스펙 어디에도 그 픽스처가 없다(P10-B 가 같은 이유로 배송수단
캡 경로를 못 덮은 것과 같은 벽). 새로 지어내는 건 범위 밖으로 판단해 스킵했다. 대신 이 자리를
덮는 건: (1) `buildUsageLinks` 순수 함수에 대한 유닛 4건 — 회원/비회원, 쿠폰 유무, `expires_at`
불변까지 실측한다, (2) 쿠폰 통합 스펙 전체(6 suite)가 앱을 부팅한다는 사실 자체 — 새 훅 등록이
부팅을 깨지 않는다는 것은 이걸로 증명된다. 이후 Task 8 이 `coupon-cap.spec.ts` 에 체크아웃
완결 경로를 타는 테스트를 하나 추가했지만, 그건 **만료 백스톱**(`complete-cart.ts` 의
`'유효기간이 지난 쿠폰입니다.'` throw)을 지키는 것이지 이 `used_at`/`order_id` 기입 경로를
지키는 게 아니다 — 여전히 별개의 구멍이다.

### 9.3 게이트

```
npm run type-check                      # 루트 (admin-web 제외됨)
npx jest --maxWorkers=2                 # 전체 유닛. OOM 방지로 워커 제한
cd apps/admin-web && npx tsc --noEmit   # 루트가 안 보는 트리
cd web/almondyoung-storefront && npx tsc --noEmit   # 기준선 51(develop 상속, 이 작업과 무관 — Task 14 에서 49→51 로 정정), 늘어나면 안 됨
cd apps/medusa && <medusa 유닛 + 쿠폰 통합>
```

---

## 10. 배포

**`sst deploy` 한 번이 곧 마이그레이션이다** (§2 ⓒ). 컨테이너 부팅이
`medusa db:migrate --execute-safe-links` 를 돌려 모듈 마이그레이션 + 링크 sync 를 함께 적용한다.
**별도 `db:migrate` 호출은 없다.** 마스터플랜의 `migrate → deploy` 표기는 drizzle 서비스 규약이다.

배포 **후** 사람이 1회:

```bash
# apps/medusa 에서 — dry-run 이 기본, 반영은 확인값을 줘야 한다
medusa exec ./src/scripts/detach-coupon-campaigns.ts
DETACH_CAMPAIGNS_DRY_RUN=false DETACH_CAMPAIGNS_CONFIRM=detach-coupon-campaigns \
  medusa exec ./src/scripts/detach-coupon-campaigns.ts
```

스크립트가 하는 일: `promotion_meta` 행이 있는 프로모션에 대해 ① `campaign.starts_at/ends_at` 을
비우고 ② `promotion.campaign_id` 를 떼고 ③ 예산 없는 기계 생성 `CAMP_%` 캠페인을 지운다.
**예산(`budget`)이 있는 캠페인은 건드리지 않는다.**

dry-run 기본 + 확인 환경변수 패턴은 `src/scripts/backfill-issued-count.ts` 의 것을 그대로 따른다
(같은 파일 상단 주석 참조).

### 감수하는 창 둘

- **ⓐ 롤링 배포 중**, 아직 안 바뀐 옛 태스크가 발급하면 `expires_at` 이 NULL(무기한)로 박힌다.
  수 분짜리 창이고 방향이 「고객에게 유리」쪽이다.
- **ⓑ 캐시된 옛 storefront 번들**이 만료 쿠폰을 「무기한」으로 **표시**할 수 있다
  (`campaign.ends_at` 이 null 이 되므로). SST 한 스택이라 배포 순서를 못 정하는 데서 오는 것이고
  (`docs` 메모: SST 한 스택엔 배포 순서가 없다), **강제는 서버가 하므로 금액은 새지 않는다.**

---

## 11. 이번에 하지 않는 것

- **`A2` 실제 복구 배선** — `cancelOrderWorkflow.hooks.orderCanceled`. 컬럼과 `used_at`/`order_id`
  기입까지만 준비한다.
- **`7-3`** (발급 계약이 3개 서비스에 새는 얕은 seam) — 별도 트랙(마스터플랜 결정 5).
- **쿠폰 수정 화면** — 저장소에 없다. 유효기간도 생성 시에만 정할 수 있고, 바꾸려면 삭제·재생성이다
  (P10-B 의 캡과 같은 제약).
- **사용 시작일 지연** — §1 ① 참조.
- **`issued_count` 를 링크 수에서 도출** — §3.2 참조. 따르지 않는다.

---

## 12. ⛔ 아직 안 잰 것 — 개통 전에 재야 한다

이 세션에서 라이브 DB 접근이 차단돼 **②의 대상 건수를 측정하지 못했다.** 건수는 위 설계를 바꾸지
않는다(0이면 스크립트가 무해한 no-op). 다만 스크립트를 돌리기 전에 무엇이 지워지는지는 봐야 한다.

```sql
-- ① 캠페인 날짜가 채워진 프로모션 수
SELECT count(*) AS with_dates
  FROM promotion p JOIN promotion_campaign c ON c.id = p.campaign_id
 WHERE p.deleted_at IS NULL AND c.deleted_at IS NULL
   AND (c.starts_at IS NOT NULL OR c.ends_at IS NOT NULL);

-- ② 기계 생성 캠페인 수 (스크립트가 지울 후보)
SELECT count(*) AS machine_campaigns
  FROM promotion_campaign
 WHERE deleted_at IS NULL AND campaign_identifier LIKE 'CAMP\_%';

-- ③ 그중 예산이 붙은 것 — 스크립트가 «건드리지 않아야» 하는 행
SELECT c.id, c.campaign_identifier
  FROM promotion_campaign c JOIN promotion_campaign_budget b ON b.campaign_id = c.id
 WHERE c.deleted_at IS NULL AND b.deleted_at IS NULL
   AND c.campaign_identifier LIKE 'CAMP\_%';
```

접속: `./scripts/sst-tunnel.sh deployments/lcnine/services live` 를 별도 창에 띄운 뒤 `medusa` DB.
