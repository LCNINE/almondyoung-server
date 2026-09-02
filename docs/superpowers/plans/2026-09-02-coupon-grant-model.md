# 쿠폰 발급 그랜트 모델 구현 플랜

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 쿠폰 «한 장»을 여러 장으로 만들고, 「1장 = 1회」를 DB 제약과 게이트로 강제한다.

**Architecture:** `promotion-meta` 모듈에 `coupon_grant` 를 신설해 발급 1건 = 1행으로 만든다. 멱등성은 `issue_key` + 파셜 유니크가 담당한다(오늘은 Medusa 링크의 복합 PK upsert 가 우연히 하던 일). 판정은 컨테이너를 모르는 순수 함수로 뽑고, 강제는 카트 부착·완료 백스톱·주문 생성 세 자리에서 한다. Medusa 링크는 표시 조인용으로 남긴다.

**Tech Stack:** Medusa v2 커스텀 모듈(MedusaService + MikroORM 마이그레이션), 워크플로 훅, 이벤트 구독자, Next.js(admin-web), TanStack Query

**Spec:** `docs/superpowers/specs/2026-09-02-coupon-grant-model-design.md`

## Global Constraints

- **배포 순서는 `migrate → deploy`** (expand). 새 코드가 `coupon_grant` 를 읽고 쓴다.
- **새 어휘를 만들지 않는다.** `issued_via` 는 기존 `IssueTrigger` 5개 그대로 — `customer_registered` · `membership_activated` · `admin_manual` · `admin_force` · `customer_claim`. 늘리면 `packages/domain-types/coupon-vocabulary-drift.spec.ts` 가 빨개진다.
- **소프트삭제 + 유니크는 반드시 파셜(`WHERE deleted_at IS NULL`).** 회수 후 재발급이 여기 의존한다.
- **판정 로직은 `.ts` 로 뽑는다.** admin-web 의 jest transform 이 `^.+\.(t|j)s$` 라 `.tsx` 안의 로직은 테스트가 실행조차 되지 않는다.
- **admin-web 타입 게이트는 `cd apps/admin-web && npx tsc --noEmit`.** 루트 `npm run type-check` 는 admin-web 을 제외한다.
- **medusa HTTP/모듈 통합 스펙은 `scripts/local/run-medusa-integration.sh` 로만 돌린다.** `npm run test:integration:http` 를 직접 부르면 러너가 `DATABASE_URL` 이 아니라 `DB_HOST`/`DB_USERNAME`/`DB_PASSWORD`/`DB_PORT` 를 읽어 전 스펙이 SASL 로 죽는다. **CI 는 이 스펙들을 안 돌린다 — 로컬 실행이 유일한 방어선이다.**
- **통합 스펙에서 `.rejects.toThrow()` 를 쓰지 말 것.** 워크플로 엔진을 거친 에러는 프로토타입을 잃어 `Error` 인스턴스가 아니다. `try/catch` + `expect(err.message).toContain(...)`.
- **스펙이 자체 리스너를 띄운다면 포트를 상수로 박지 말 것** (`39100 + (process.pid % 400)`, **모듈 로드 시점**에 결정). jest 가 `Force exiting` 으로 끝나면 앞 실행 리스너가 살아남아 다음 실행 전체가 `EADDRINUSE` 로 죽는데, 증상이 「hook 타임아웃 180초 × N」이라 원인이 포트로 안 보인다. **이 플랜의 스펙들은 `inApp: true` 라 리스너를 띄우지 않는다** — 결제 스텁 같은 걸 새로 더할 때만 해당한다.
- **워크플로 훅은 워크플로당 핸들러 하나뿐이다.** 새 훅을 등록하지 말고 기존 핸들러 안에 함수를 더한다. `workflows/hooks/__tests__/no-duplicate-validate-hooks.unit.spec.ts` 가 이걸 지킨다. (이벤트 **구독자**는 개수 제한이 없다.)
- **`npx jest` 는 OOM 이 난다 — `--maxWorkers=2`.**

---

## 스펙에서 벗어난 결정 1건

스펙 §3.4 는 마이그레이션이 「테이블 생성 + 링크 행 복사」를 모두 한다고 썼다. **복사는 마이그레이션이 아니라 스크립트로 한다.**

이유: 링크 테이블의 **실제 이름이 우리 소스에 없다.** `defineLink` 가 만드는 테이블은 부팅 시 `medusa db:migrate --execute-safe-links` 가 생성하고 마이그레이션 파일이 저장소에 남지 않는다. SQL 로 `INSERT … FROM <링크테이블>` 을 쓰려면 이름을 추측해야 하는데, 그 추측이 틀리면 마이그레이션이 배포 중에 죽는다.

대신 링크 모듈 API(`getLinkModule(...).list()`)를 쓰는 백필 스크립트를 만든다. 이 저장소에 이미 같은 패턴이 둘 있다(`src/scripts/backfill-issued-count.ts`, `src/scripts/detach-coupon-campaigns.ts`) — dry-run 기본 + 확인값 요구.

---

## File Structure

### apps/medusa — 신규

| 파일 | 책임 |
|---|---|
| `src/modules/promotion-meta/models/coupon-grant.ts` | 발급 인스턴스 모델 |
| `src/modules/promotion-meta/migrations/Migration20260902100000.ts` | 테이블 + 인덱스 3개 |
| `src/modules/promotion-meta/grants.ts` | **순수 함수** — 사용 가능 판정, FEFO 선택, 표시용 만료 |
| `src/modules/promotion-meta/__tests__/grants.unit.spec.ts` | 위의 유닛 |
| `src/scripts/backfill-coupon-grants.ts` | 링크 → grant 1회 백필 |
| `src/subscribers/coupon-grant-restore.ts` | `order.canceled` → 장 복구 (A2) |
| `integration-tests/http/coupon-grant.spec.ts` | G1~G10 |

### apps/medusa — 수정

| 파일 | 바뀌는 것 |
|---|---|
| `src/modules/promotion-meta/service.ts` | `CouponGrant` 등록 + 발급/소모/복구/회수 메서드, issue-log 메서드 제거 |
| `src/api/admin/customers/[id]/promotions/route.ts` | 발급이 grant + `issue_key`, GET 이 장 목록, DELETE 가 장 단위 |
| `src/api/admin/customers/[id]/issue-coupons/route.ts` | 결정적 `issue_key`, `isAlreadyIssued` 제거 |
| `src/api/store/customers/me/promotions/[id]/claim/route.ts` | `alreadyClaimed` 선검사 제거, `issue_key='claim'` |
| `src/api/admin/promotions/[id]/customers/route.ts` | **POST 신설**(대량 발급), GET/DELETE 장 단위 |
| `src/api/store/carts/middlewares/per-customer-limit.ts` | `hasUsableGrant` 로 게이트 |
| `src/workflows/hooks/cart/complete-cart.ts` | 같은 게이트(백스톱) |
| `src/workflows/hooks/cart/record-coupon-usage.ts` · `coupon-usage.ts` | 링크 upsert → grant 1행 소모 |
| `src/api/store/customers/me/promotions/route.ts` | 장수 표시, `use_by_attribute` 소진 필터 제거 |
| `src/api/store/events/[slug]/route.ts` · `src/api/store/coupons/preview/route.ts` | 「사용 가능한 장 존재」로 판정 |

### apps/medusa — 삭제

`src/modules/promotion-meta/issued-link.ts` · `src/modules/promotion-meta/models/promotion-issue-log.ts`

### apps/admin-web

| 파일 | 바뀌는 것 |
|---|---|
| `src/features/mall/marketing/coupons/lib/parse-issue-targets.ts` (신규) + `.spec.ts` | 입력 파싱·중복 제거·`issue_key` 생성 |
| `src/features/mall/marketing/coupons/components/coupon-assign-dialog.tsx` | 여러 명 × 여러 장 재설계 |
| `src/features/mall/marketing/coupons/components/coupon-create-dialog.tsx` | 「1인당 사용 횟수 제한」 제거 |
| `src/features/mall/marketing/coupons/lib/build-create-promotion-payload.ts` (+2 spec) | `maxUsesPerCustomer` 제거, 동시설정 throw 제거 |
| `src/features/mall/marketing/coupons/components/coupon-customers-dialog.tsx` | 보유/사용 장수 표시 |
| `src/lib/api/domains/medusa/promotions.ts` · `src/lib/services/coupons/mutations.ts` | 대량 발급 호출 |

---

## Task 1: `coupon_grant` 테이블과 모듈 등록

**Files:**
- Create: `apps/medusa/src/modules/promotion-meta/models/coupon-grant.ts`
- Create: `apps/medusa/src/modules/promotion-meta/migrations/Migration20260902100000.ts`
- Modify: `apps/medusa/src/modules/promotion-meta/service.ts`
- Test: `apps/medusa/src/modules/promotion-meta/__tests__/service.integration.spec.ts` (기존 파일에 추가)

**Interfaces:**
- Produces: 모델 `CouponGrant` → `MedusaService` 가 `listCouponGrants` · `createCouponGrants` · `updateCouponGrants` · `softDeleteCouponGrants` 를 생성한다. Task 3~6 이 이 이름들을 쓴다.
- Produces: 행 타입 `CouponGrantRow` (service.ts 에서 export)

- [ ] **Step 1: 모델 파일 작성**

`apps/medusa/src/modules/promotion-meta/models/coupon-grant.ts`

```ts
import { model } from '@medusajs/framework/utils';

/**
 * 발급된 «한 장». 발급 1건 = 1행이다.
 *
 * 이 모델이 생기기 전에는 customer↔promotion 링크 행이 그 역할을 했는데, 그 테이블은
 * `(customer_id, promotion_id)` 복합 PK 라 **고객당 한 장**만 가능했다. 같은 쿠폰을 여러
 * 출처에서 여러 번 발급하려면 그 제약을 풀어야 하고, 그래서 우리 테이블로 나왔다.
 *
 * 🔴 그 복합 PK 는 동시에 **따닥 방어**이기도 했다 — `Link.create` 가 upsert 라 두 번째
 * 요청이 첫 행을 덮어썼다. 방어가 아니라 부작용이었다. 여기서는 `issue_key` + 파셜 유니크가
 * 그 일을 의도적으로 한다. 유니크를 지우면 발급 버튼 따닥이 곧 공짜 쿠폰이 된다.
 */
const CouponGrant = model
  .define(
    { name: 'CouponGrant', tableName: 'coupon_grant' },
    {
      id: model.id().primaryKey(),
      promotion_id: model.text(),
      customer_id: model.text(),
      /** 이 발급이 어떤 «사건»인가. 같은 사건은 몇 번 도착해도 한 장이다. */
      issue_key: model.text(),
      /** `IssueTrigger` 어휘 5개. 새 값 없음. */
      issued_via: model.text(),
      issued_at: model.dateTime(),
      /** 이 한 장의 만료. 발급 시점에 `computeExpiresAt` 로 계산해 박는다. null = 무기한. */
      expires_at: model.dateTime().nullable(),
      used_at: model.dateTime().nullable(),
      order_id: model.text().nullable(),
    },
  )
  .indexes([
    // 주의: 실제 DB 인덱스는 마이그레이션에서 PARTIAL(`WHERE deleted_at IS NULL`)로 생성된다.
    // DML DSL 이 partial 조건을 표현하지 못해 여기선 full 로만 선언된다.
    // 회수(soft delete) 후 재발급이 이 partial 조건에 의존한다 — 스키마를 재생성할 때
    // `WHERE deleted_at IS NULL` 을 반드시 보존할 것(full unique 로 바뀌면 재발급이 깨진다).
    { on: ['customer_id'], name: 'idx_coupon_grant_customer' },
    { on: ['promotion_id'], name: 'idx_coupon_grant_promotion' },
    { on: ['promotion_id', 'customer_id', 'issue_key'], name: 'idx_coupon_grant_issue_key', unique: true },
  ]);

export default CouponGrant;
```

- [ ] **Step 2: 마이그레이션 작성**

`apps/medusa/src/modules/promotion-meta/migrations/Migration20260902100000.ts`

```ts
import { Migration } from '@medusajs/framework/mikro-orm/migrations';

/**
 * `coupon_grant` — 발급 인스턴스 테이블 (설계 §3.1).
 *
 * 기존 링크 행의 이관은 여기서 하지 않는다 — 링크 테이블의 실제 이름이 우리 소스에 없고
 * (부팅 시 `--execute-safe-links` 가 만든다) 추측한 이름으로 INSERT 를 쓰면 배포 중에 죽는다.
 * 이관은 `src/scripts/backfill-coupon-grants.ts` 가 링크 모듈 API 로 한다.
 */
export class Migration20260902100000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      CREATE TABLE IF NOT EXISTS "coupon_grant" (
        "id" text NOT NULL,
        "promotion_id" text NOT NULL,
        "customer_id" text NOT NULL,
        "issue_key" text NOT NULL,
        "issued_via" text NOT NULL,
        "issued_at" timestamptz NOT NULL DEFAULT now(),
        "expires_at" timestamptz NULL,
        "used_at" timestamptz NULL,
        "order_id" text NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "deleted_at" timestamptz NULL,
        CONSTRAINT "coupon_grant_pkey" PRIMARY KEY ("id")
      );
    `);
    this.addSql(
      `CREATE INDEX IF NOT EXISTS "idx_coupon_grant_customer" ON "coupon_grant" ("customer_id") WHERE "deleted_at" IS NULL;`,
    );
    this.addSql(
      `CREATE INDEX IF NOT EXISTS "idx_coupon_grant_promotion" ON "coupon_grant" ("promotion_id") WHERE "deleted_at" IS NULL;`,
    );
    // 🔴 파셜이어야 한다 — 회수(soft delete) 후 재발급이 이 조건에 의존한다.
    this.addSql(
      `CREATE UNIQUE INDEX IF NOT EXISTS "idx_coupon_grant_issue_key" ` +
        `ON "coupon_grant" ("promotion_id", "customer_id", "issue_key") WHERE "deleted_at" IS NULL;`,
    );
    // 발급 경로 어휘를 DB 로도 닫는다 (promotion_meta 의 CHECK 제약과 같은 규약).
    this.addSql(
      `ALTER TABLE "coupon_grant" ADD CONSTRAINT "coupon_grant_issued_via_check" ` +
        `CHECK ("issued_via" IN ('customer_registered', 'membership_activated', ` +
        `'admin_manual', 'admin_force', 'customer_claim'));`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(`DROP TABLE IF EXISTS "coupon_grant";`);
  }
}
```

- [ ] **Step 3: 서비스에 모델 등록 + 행 타입 export**

`service.ts` 를 수정한다. import 를 더하고:

```ts
import CouponGrant from './models/coupon-grant';
```

`MedusaService({...})` 목록에 `CouponGrant` 를 추가한다 (`PromotionIssueLog` 는 Task 9 에서 지운다 — 지금은 그대로 둔다):

```ts
class PromotionMetaModuleService extends MedusaService({
  PromotionMeta,
  PromotionIssueLog,
  CouponEvent,
  CouponEventItem,
  CouponGrant,
}) {
```

파일 상단(타입 선언들 옆)에 행 타입을 더한다:

```ts
/** `coupon_grant` 한 행. 숫자·날짜가 DB 에서 문자열로 오는 경우가 있어 union 이다. */
export type CouponGrantRow = {
  id: string;
  promotion_id: string;
  customer_id: string;
  issue_key: string;
  issued_via: IssueTrigger;
  issued_at: Date | string;
  expires_at: Date | string | null;
  used_at: Date | string | null;
  order_id: string | null;
};
```

- [ ] **Step 4: 실패하는 통합 테스트 작성**

`src/modules/promotion-meta/__tests__/service.integration.spec.ts` 의 기존 `describe` 옆에 추가한다. (파일 상단의 `moduleIntegrationTestRunner` 설정은 그대로 쓴다.)

```ts
describe('coupon_grant', () => {
  it('같은 (쿠폰, 고객) 에 issue_key 가 다르면 여러 장이 생긴다', async () => {
    const base = {
      promotion_id: 'promo_multi',
      customer_id: 'cus_multi',
      issued_via: 'admin_manual' as const,
      issued_at: new Date(),
    };
    await service.createCouponGrants([
      { ...base, issue_key: 'sub-1:1' },
      { ...base, issue_key: 'sub-1:2' },
    ]);

    const rows = await service.listCouponGrants({ promotion_id: 'promo_multi' });
    expect(rows).toHaveLength(2);
  });

  it('같은 issue_key 는 두 번째가 유니크 위반이다', async () => {
    const row = {
      promotion_id: 'promo_dup',
      customer_id: 'cus_dup',
      issue_key: 'claim',
      issued_via: 'customer_claim' as const,
      issued_at: new Date(),
    };
    await service.createCouponGrants([row]);

    let caught: any = null;
    try {
      await service.createCouponGrants([row]);
    } catch (e) {
      caught = e;
    }

    expect(caught).not.toBeNull();
    expect(String(caught.message).toLowerCase()).toMatch(/unique|duplicate|already exists/);
    expect(await service.listCouponGrants({ promotion_id: 'promo_dup' })).toHaveLength(1);
  });

  it('회수(soft delete) 후 같은 issue_key 로 재발급된다 — 파셜 유니크', async () => {
    const row = {
      promotion_id: 'promo_revoke',
      customer_id: 'cus_revoke',
      issue_key: 'claim',
      issued_via: 'customer_claim' as const,
      issued_at: new Date(),
    };
    const [created] = await service.createCouponGrants([row]);
    await service.softDeleteCouponGrants([created.id]);

    await service.createCouponGrants([row]);

    const alive = await service.listCouponGrants({ promotion_id: 'promo_revoke' });
    expect(alive).toHaveLength(1);
    expect(alive[0].id).not.toBe(created.id);
  });
});
```

- [ ] **Step 5: 테스트를 돌려 실패를 확인한다**

Run: `scripts/local/run-medusa-integration.sh --modules --testPathPattern 'promotion-meta'`
Expected: FAIL — `service.createCouponGrants is not a function` 또는 `relation "coupon_grant" does not exist`

- [ ] **Step 6: 다시 돌려 통과를 확인한다**

Step 1~3 이 이미 구현이다. 마이그레이션이 테스트 DB 에 반영되는지 확인한다.

Run: `scripts/local/run-medusa-integration.sh --modules --testPathPattern 'promotion-meta'`
Expected: PASS (3 신규 포함)

세 번째 테스트가 실패하면 유니크가 **파셜이 아니다** — Step 2 의 `WHERE deleted_at IS NULL` 을 확인한다.

- [ ] **Step 7: 커밋**

```bash
git add apps/medusa/src/modules/promotion-meta/models/coupon-grant.ts \
        apps/medusa/src/modules/promotion-meta/migrations/Migration20260902100000.ts \
        apps/medusa/src/modules/promotion-meta/service.ts \
        apps/medusa/src/modules/promotion-meta/__tests__/service.integration.spec.ts
git commit -m "feat(coupon): coupon_grant 테이블 — 발급 1건 = 1행 (#488)"
```

---

## Task 2: 판정 순수 함수

**Files:**
- Create: `apps/medusa/src/modules/promotion-meta/grants.ts`
- Test: `apps/medusa/src/modules/promotion-meta/__tests__/grants.unit.spec.ts`

**Interfaces:**
- Consumes: `CouponGrantRow` (Task 1)
- Produces: `usableGrants(grants, now)` · `hasUsableGrant(grants, now)` · `selectGrantToConsume(grants, now)` · `nextExpiryAt(grants, now)` · `grantsFor(grants, promotionId)`. Task 4·6·7 이 전부 이 이름을 쓴다.

- [ ] **Step 1: 실패하는 유닛 테스트 작성**

`apps/medusa/src/modules/promotion-meta/__tests__/grants.unit.spec.ts`

```ts
import {
  usableGrants,
  hasUsableGrant,
  selectGrantToConsume,
  nextExpiryAt,
  grantsFor,
} from '../grants';
import type { CouponGrantRow } from '../service';

const NOW = new Date('2026-09-02T00:00:00.000Z');

function grant(over: Partial<CouponGrantRow> & { id: string }): CouponGrantRow {
  return {
    promotion_id: 'promo_1',
    customer_id: 'cus_1',
    issue_key: over.id,
    issued_via: 'admin_manual',
    issued_at: new Date('2026-09-01T00:00:00.000Z'),
    expires_at: null,
    used_at: null,
    order_id: null,
    ...over,
  };
}

describe('usableGrants', () => {
  it('사용된 장을 제외한다', () => {
    const g = [grant({ id: 'a' }), grant({ id: 'b', used_at: NOW })];
    expect(usableGrants(g, NOW).map((x) => x.id)).toEqual(['a']);
  });

  it('만료된 장을 제외한다', () => {
    const g = [
      grant({ id: 'a', expires_at: new Date('2026-09-01T23:59:59.000Z') }),
      grant({ id: 'b', expires_at: new Date('2026-09-03T00:00:00.000Z') }),
    ];
    expect(usableGrants(g, NOW).map((x) => x.id)).toEqual(['b']);
  });

  it('만료 시각이 정확히 now 면 아직 쓸 수 있다 — 경계는 포함이다', () => {
    const g = [grant({ id: 'a', expires_at: NOW })];
    expect(usableGrants(g, NOW)).toHaveLength(1);
  });

  it('expires_at 이 null 이면 무기한이다', () => {
    expect(usableGrants([grant({ id: 'a' })], NOW)).toHaveLength(1);
  });

  it('문자열로 온 날짜도 읽는다', () => {
    const g = [grant({ id: 'a', expires_at: '2026-09-01T00:00:00.000Z' })];
    expect(usableGrants(g, NOW)).toHaveLength(0);
  });
});

describe('selectGrantToConsume — FEFO', () => {
  it('만료가 이른 장을 먼저 고른다', () => {
    const g = [
      grant({ id: 'late', expires_at: new Date('2026-09-30T00:00:00.000Z') }),
      grant({ id: 'soon', expires_at: new Date('2026-09-05T00:00:00.000Z') }),
    ];
    expect(selectGrantToConsume(g, NOW)?.id).toBe('soon');
  });

  it('무기한 장은 맨 뒤다', () => {
    const g = [
      grant({ id: 'forever', expires_at: null }),
      grant({ id: 'dated', expires_at: new Date('2026-12-31T00:00:00.000Z') }),
    ];
    expect(selectGrantToConsume(g, NOW)?.id).toBe('dated');
  });

  it('만료가 같으면 먼저 발급된 장을 고른다', () => {
    const exp = new Date('2026-09-10T00:00:00.000Z');
    const g = [
      grant({ id: 'new', expires_at: exp, issued_at: new Date('2026-09-02T00:00:00.000Z') }),
      grant({ id: 'old', expires_at: exp, issued_at: new Date('2026-08-01T00:00:00.000Z') }),
    ];
    expect(selectGrantToConsume(g, NOW)?.id).toBe('old');
  });

  it('만료도 발급시각도 같으면 id 오름차순 — 결정적이어야 한다', () => {
    const exp = new Date('2026-09-10T00:00:00.000Z');
    const at = new Date('2026-08-01T00:00:00.000Z');
    const g = [
      grant({ id: 'b', expires_at: exp, issued_at: at }),
      grant({ id: 'a', expires_at: exp, issued_at: at }),
    ];
    expect(selectGrantToConsume(g, NOW)?.id).toBe('a');
  });

  it('쓸 수 있는 장이 없으면 null 이다', () => {
    expect(selectGrantToConsume([grant({ id: 'a', used_at: NOW })], NOW)).toBeNull();
    expect(selectGrantToConsume([], NOW)).toBeNull();
  });
});

describe('hasUsableGrant', () => {
  it('한 장이라도 쓸 수 있으면 true', () => {
    const g = [grant({ id: 'a', used_at: NOW }), grant({ id: 'b' })];
    expect(hasUsableGrant(g, NOW)).toBe(true);
  });

  it('전부 소모됐으면 false', () => {
    expect(hasUsableGrant([grant({ id: 'a', used_at: NOW })], NOW)).toBe(false);
  });

  it('빈 배열은 false — 발급받지 않았다는 뜻이다', () => {
    expect(hasUsableGrant([], NOW)).toBe(false);
  });
});

describe('nextExpiryAt', () => {
  it('사용 가능한 장 중 가장 이른 만료를 돌려준다', () => {
    const g = [
      grant({ id: 'a', expires_at: new Date('2026-09-20T00:00:00.000Z') }),
      grant({ id: 'b', expires_at: new Date('2026-09-10T00:00:00.000Z') }),
    ];
    expect(nextExpiryAt(g, NOW)?.toISOString()).toBe('2026-09-10T00:00:00.000Z');
  });

  it('무기한 장만 있으면 null 이다', () => {
    expect(nextExpiryAt([grant({ id: 'a' })], NOW)).toBeNull();
  });

  it('사용 가능한 장이 없으면 null 이다', () => {
    expect(nextExpiryAt([grant({ id: 'a', used_at: NOW })], NOW)).toBeNull();
  });
});

describe('grantsFor', () => {
  it('프로모션으로 좁힌다', () => {
    const g = [grant({ id: 'a' }), grant({ id: 'b', promotion_id: 'promo_2' })];
    expect(grantsFor(g, 'promo_2').map((x) => x.id)).toEqual(['b']);
  });
});
```

- [ ] **Step 2: 테스트를 돌려 실패를 확인한다**

Run: `cd apps/medusa && npx jest --config jest.config.js --testPathPattern 'grants.unit' --maxWorkers=2`
Expected: FAIL — `Cannot find module '../grants'`

- [ ] **Step 3: 순수 함수 구현**

`apps/medusa/src/modules/promotion-meta/grants.ts`

```ts
import type { CouponGrantRow } from './service';

/**
 * 발급된 «장» 들에 대한 판정 — 컨테이너도 워크플로도 모르는 순수 함수다.
 *
 * `validity.ts` 와 같은 자리에 두는 이유(P1 교훈): 라우트 안 클로저로 두면 검증 대상 밖이다.
 * 카트 미들웨어·체크아웃 백스톱·주문 생성 훅·표시 라우트 5곳이 전부 여기에 의존한다.
 *
 * ⚠️ 「사용 가능」의 정의는 `validity.ts` 의 `isUsable` 과 **경계가 같아야 한다** — 만료
 * 시각은 양쪽 다 포함이다. 두 곳이 어긋나면 카트에는 붙는데 주문에서 거절되는 창이 생긴다.
 */

function toDate(value: Date | string | null | undefined): Date | null {
  if (value == null) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** 이 프로모션의 장만 추린다. */
export function grantsFor(grants: CouponGrantRow[], promotionId: string): CouponGrantRow[] {
  return grants.filter((g) => g.promotion_id === promotionId);
}

/** 지금 쓸 수 있는 장 — 미사용이고 만료 전(경계 포함). */
export function usableGrants(grants: CouponGrantRow[], now: Date): CouponGrantRow[] {
  return grants.filter((g) => {
    if (g.used_at != null) return false;
    const expiresAt = toDate(g.expires_at);
    if (expiresAt && now > expiresAt) return false;
    return true;
  });
}

export function hasUsableGrant(grants: CouponGrantRow[], now: Date): boolean {
  return usableGrants(grants, now).length > 0;
}

/**
 * 소모할 장 하나를 고른다 — **만료 임박순(FEFO)**.
 *
 * 무기한(`expires_at == null`) 장은 맨 뒤다. 그러지 않으면 기한 있는 장이 놀다가 죽는다.
 * 동률은 `issued_at` → `id` 로 깬다. **결정적이어야 테스트가 선다.**
 */
export function selectGrantToConsume(grants: CouponGrantRow[], now: Date): CouponGrantRow | null {
  const candidates = usableGrants(grants, now);
  if (candidates.length === 0) return null;

  const sorted = [...candidates].sort((a, b) => {
    const ax = toDate(a.expires_at);
    const bx = toDate(b.expires_at);
    if (ax && bx) {
      if (ax.getTime() !== bx.getTime()) return ax.getTime() - bx.getTime();
    } else if (ax) {
      return -1; // 기한 있는 쪽이 먼저
    } else if (bx) {
      return 1;
    }
    const ai = toDate(a.issued_at)?.getTime() ?? 0;
    const bi = toDate(b.issued_at)?.getTime() ?? 0;
    if (ai !== bi) return ai - bi;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  return sorted[0];
}

/** 표시용 — 사용 가능한 장 중 가장 이른 만료. 무기한만 남았으면 null. */
export function nextExpiryAt(grants: CouponGrantRow[], now: Date): Date | null {
  const dated = usableGrants(grants, now)
    .map((g) => toDate(g.expires_at))
    .filter((d): d is Date => d !== null);
  if (dated.length === 0) return null;
  return dated.reduce((min, d) => (d < min ? d : min));
}
```

- [ ] **Step 4: 테스트를 돌려 통과를 확인한다**

Run: `cd apps/medusa && npx jest --config jest.config.js --testPathPattern 'grants.unit' --maxWorkers=2`
Expected: PASS (18 tests)

- [ ] **Step 5: 커밋**

```bash
git add apps/medusa/src/modules/promotion-meta/grants.ts \
        apps/medusa/src/modules/promotion-meta/__tests__/grants.unit.spec.ts
git commit -m "feat(coupon): 장 판정 순수 함수 — FEFO 소모·사용가능·표시만료 (#488)"
```

---

## Task 3: 서비스에 발급/소모/복구/회수 메서드

**Files:**
- Modify: `apps/medusa/src/modules/promotion-meta/service.ts`
- Test: `apps/medusa/src/modules/promotion-meta/__tests__/service.integration.spec.ts`

**Interfaces:**
- Consumes: `listCouponGrants` · `createCouponGrants` · `updateCouponGrants` · `softDeleteCouponGrants` (Task 1), `selectGrantToConsume` (Task 2)
- Produces: `issueGrant(input): Promise<'created' | 'duplicate'>` · `listGrantsForCustomer(customerId)` · `consumeGrant(grantId, orderId, usedAt)` · `restoreGrantsByOrder(orderId, now)` · `revokeGrants(promotionId, customerId)`. Task 4~8 이 전부 이 이름을 쓴다.

- [ ] **Step 1: 실패하는 통합 테스트 작성**

`service.integration.spec.ts` 의 `describe('coupon_grant', …)` 안에 추가한다.

```ts
  it('issueGrant 는 같은 issue_key 두 번째에 duplicate 를 돌려준다 — 던지지 않는다', async () => {
    const input = {
      promotion_id: 'promo_idem',
      customer_id: 'cus_idem',
      issue_key: 'sub-9:1',
      issued_via: 'admin_manual' as const,
      expires_at: null,
      now: new Date(),
    };

    expect(await service.issueGrant(input)).toBe('created');
    expect(await service.issueGrant(input)).toBe('duplicate');
    expect(await service.listCouponGrants({ promotion_id: 'promo_idem' })).toHaveLength(1);
  });

  it('consumeGrant 는 그 한 장에만 사용 기록을 남긴다', async () => {
    const base = {
      promotion_id: 'promo_use',
      customer_id: 'cus_use',
      issued_via: 'admin_manual' as const,
      issued_at: new Date(),
    };
    await service.createCouponGrants([
      { ...base, issue_key: 'k1' },
      { ...base, issue_key: 'k2' },
    ]);
    const grants = await service.listGrantsForCustomer('cus_use');
    const usedAt = new Date();

    await service.consumeGrant(grants[0].id, 'order_1', usedAt);

    const after = await service.listGrantsForCustomer('cus_use');
    expect(after.filter((g) => g.used_at != null)).toHaveLength(1);
    expect(after.find((g) => g.id === grants[0].id)?.order_id).toBe('order_1');
  });

  it('restoreGrantsByOrder 는 만료되지 않은 장만 되살린다', async () => {
    const past = new Date('2020-01-01T00:00:00.000Z');
    const future = new Date('2099-01-01T00:00:00.000Z');
    const base = {
      promotion_id: 'promo_restore',
      customer_id: 'cus_restore',
      issued_via: 'admin_manual' as const,
      issued_at: past,
      used_at: past,
      order_id: 'order_cancel',
    };
    await service.createCouponGrants([
      { ...base, issue_key: 'alive', expires_at: future },
      { ...base, issue_key: 'dead', expires_at: past },
    ]);

    const restored = await service.restoreGrantsByOrder('order_cancel', new Date());

    expect(restored).toBe(1);
    const rows = await service.listGrantsForCustomer('cus_restore');
    expect(rows.find((g) => g.issue_key === 'alive')?.used_at).toBeNull();
    expect(rows.find((g) => g.issue_key === 'dead')?.used_at).not.toBeNull();
  });

  it('restoreGrantsByOrder 는 두 번 불려도 결과가 같다', async () => {
    const base = {
      promotion_id: 'promo_restore2',
      customer_id: 'cus_restore2',
      issue_key: 'k',
      issued_via: 'admin_manual' as const,
      issued_at: new Date(),
      used_at: new Date(),
      order_id: 'order_twice',
      expires_at: null,
    };
    await service.createCouponGrants([base]);

    expect(await service.restoreGrantsByOrder('order_twice', new Date())).toBe(1);
    expect(await service.restoreGrantsByOrder('order_twice', new Date())).toBe(0);
  });

  it('revokeGrants 는 회수한 장수를 돌려준다', async () => {
    const base = {
      promotion_id: 'promo_rev',
      customer_id: 'cus_rev',
      issued_via: 'admin_manual' as const,
      issued_at: new Date(),
    };
    await service.createCouponGrants([
      { ...base, issue_key: 'k1' },
      { ...base, issue_key: 'k2' },
    ]);

    expect(await service.revokeGrants('promo_rev', 'cus_rev')).toBe(2);
    expect(await service.listGrantsForCustomer('cus_rev')).toHaveLength(0);
    expect(await service.revokeGrants('promo_rev', 'cus_rev')).toBe(0);
  });
```

- [ ] **Step 2: 테스트를 돌려 실패를 확인한다**

Run: `scripts/local/run-medusa-integration.sh --modules --testPathPattern 'promotion-meta'`
Expected: FAIL — `service.issueGrant is not a function`

- [ ] **Step 3: 서비스 메서드 구현**

`service.ts` 의 클래스 안에 추가한다. `isUniqueViolation` 은 기존 `recordIssue` 가 쓰던 판정을 뽑아낸 것이다 — **`MedusaService` 가 unique 위반을 "... already exists" 로 감싸므로 pg 코드 `23505` 매칭만으론 부족하다.**

```ts
  /**
   * 유니크 위반인가. 🔴 `e.code === '23505'` 만 보면 안 된다 — `MedusaService` 가 위반을
   * "... already exists" 메시지로 감싸 코드를 잃어버리는 경로가 있다(기존 `recordIssue` 가
   * 같은 이유로 이 판정을 갖고 있었다).
   */
  private isUniqueViolation(e: any): boolean {
    const msg = String(e?.message ?? '').toLowerCase();
    return (
      e?.code === '23505' ||
      msg.includes('unique') ||
      msg.includes('duplicate') ||
      msg.includes('already exists')
    );
  }

  /**
   * 한 장을 발급한다. **같은 `issue_key` 의 재도착은 예외가 아니라 `'duplicate'` 다.**
   *
   * 이것이 따닥·재시도 방어의 전부다. 호출부는 `'duplicate'` 를 「이미 처리됨」으로 다루고,
   * 예약해 둔 claim 슬롯이 있으면 반환해야 한다(슬롯을 잡은 쪽이 반환 책임을 진다).
   */
  async issueGrant(input: {
    promotion_id: string;
    customer_id: string;
    issue_key: string;
    issued_via: IssueTrigger;
    expires_at: Date | null;
    now: Date;
  }): Promise<'created' | 'duplicate'> {
    try {
      await (this as any).createCouponGrants([
        {
          promotion_id: input.promotion_id,
          customer_id: input.customer_id,
          issue_key: input.issue_key,
          issued_via: input.issued_via,
          issued_at: input.now,
          expires_at: input.expires_at,
          used_at: null,
          order_id: null,
        },
      ]);
      return 'created';
    } catch (e: any) {
      if (this.isUniqueViolation(e)) return 'duplicate';
      throw e;
    }
  }

  /** 이 고객이 가진 모든 장. 호출부가 프로모션마다 조회하지 않도록 한 번에 가져온다. */
  async listGrantsForCustomer(customerId: string): Promise<CouponGrantRow[]> {
    return (await (this as any).listCouponGrants({ customer_id: customerId })) as CouponGrantRow[];
  }

  /** 이 프로모션이 발급된 모든 장. 발급 현황·회수가 쓴다. */
  async listGrantsForPromotion(promotionId: string): Promise<CouponGrantRow[]> {
    return (await (this as any).listCouponGrants({ promotion_id: promotionId })) as CouponGrantRow[];
  }

  /** 고른 한 장을 소모한다. */
  async consumeGrant(grantId: string, orderId: string, usedAt: Date): Promise<void> {
    await (this as any).updateCouponGrants({ id: grantId, used_at: usedAt, order_id: orderId });
  }

  /**
   * 이 주문에 쓰인 장들을 되돌린다 (A2). 되살린 장수를 돌려준다.
   *
   * **이미 만료된 장은 되살리지 않는다** — 되살려도 못 쓰고, 「돌아왔는데 못 쓴다」가 더 나쁘다.
   * 이미 되돌려진 장은 `used_at` 이 null 이라 대상에서 빠지므로 두 번 불려도 안전하다.
   */
  async restoreGrantsByOrder(orderId: string, now: Date): Promise<number> {
    const rows = (await (this as any).listCouponGrants({ order_id: orderId })) as CouponGrantRow[];
    const targets = rows.filter((g) => {
      if (g.used_at == null) return false;
      if (g.expires_at == null) return true;
      const expiresAt = g.expires_at instanceof Date ? g.expires_at : new Date(g.expires_at);
      return !(now > expiresAt);
    });
    if (targets.length === 0) return 0;
    await (this as any).updateCouponGrants(
      targets.map((g) => ({ id: g.id, used_at: null, order_id: null })),
    );
    return targets.length;
  }

  /** 이 고객의 이 쿠폰을 전량 회수한다. 회수한 장수를 돌려준다. */
  async revokeGrants(promotionId: string, customerId: string): Promise<number> {
    const rows = (await (this as any).listCouponGrants({
      promotion_id: promotionId,
      customer_id: customerId,
    })) as CouponGrantRow[];
    if (rows.length === 0) return 0;
    await (this as any).softDeleteCouponGrants(rows.map((g) => g.id));
    return rows.length;
  }
```

- [ ] **Step 4: 테스트를 돌려 통과를 확인한다**

Run: `scripts/local/run-medusa-integration.sh --modules --testPathPattern 'promotion-meta'`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add apps/medusa/src/modules/promotion-meta/service.ts \
        apps/medusa/src/modules/promotion-meta/__tests__/service.integration.spec.ts
git commit -m "feat(coupon): 그랜트 발급·소모·복구·회수 서비스 메서드 (#488)"
```

---

## Task 4: 발급 3경로를 그랜트로 — 멱등성 (G1~G4)

**Files:**
- Modify: `apps/medusa/src/api/admin/customers/[id]/promotions/route.ts` (POST)
- Modify: `apps/medusa/src/api/admin/customers/[id]/issue-coupons/route.ts`
- Modify: `apps/medusa/src/api/store/customers/me/promotions/[id]/claim/route.ts`
- Test: `apps/medusa/integration-tests/http/coupon-grant.spec.ts` (신규)

**Interfaces:**
- Consumes: `issueGrant` (Task 3), `computeExpiresAt` (`modules/promotion-meta/validity`)
- Produces: `POST /admin/customers/:id/promotions` 요청 본문에 `submit_id?: string` 추가. 응답 형태 불변(`{issued, skipped}`).

**세 경로가 공유하는 규약:**

| 경로 | `issue_key` |
|---|---|
| 관리자 수동 | `` `${submit_id}:${n}` `` (`submit_id` 없으면 서버가 UUID 생성 — 그 요청은 멱등하지 않다) |
| 트리거 자동 | `` `trigger:${trigger}` `` |
| 셀프 클레임 | `'claim'` |

**세 경로 모두 링크도 계속 만든다.** 링크는 `customer.promotions` 조인(표시용)으로 남기기 때문이다. **단 `data` 는 더 이상 싣지 않는다** — 만료·사용의 정본은 grant 이고, 링크 컬럼에 옛 값이 남으면 두 정본이 어긋난다.

- [ ] **Step 1: 실패하는 통합 테스트 작성**

`apps/medusa/integration-tests/http/coupon-grant.spec.ts` 를 만든다.

⚠️ **픽스처는 공유 헬퍼가 아니라 `testSuite` 클로저 안의 인라인 함수다** — 이 저장소의 쿠폰 스펙 전부가 그렇게 돼 있다(`coupon-admin.spec.ts:17-62`, `coupon-store.spec.ts:14-95`). 새 헬퍼 모듈을 만들지 말고 아래 형태를 그대로 쓴다.

⚠️ **러너 옵션 3개가 필수다.** `inApp: true`(별도 프로세스를 안 띄운다), `disableAutoTeardown: true`(매 테스트 DB teardown 이 redis/BullMQ 커넥션을 닫아 async 워크플로와 레이스가 난다 — 대신 `seq` 로 테스트마다 식별자를 격리한다), `env: { COUPON_AUTO_ISSUE_ENABLED: 'true' }`(트리거 발급은 프로덕션 기본 OFF).

```ts
import { medusaIntegrationTestRunner } from '@medusajs/test-utils';
import { Modules, ContainerRegistrationKeys } from '@medusajs/framework/utils';
import jwt from 'jsonwebtoken';
import { PROMOTION_META_MODULE } from '../../src/modules/promotion-meta';

jest.setTimeout(120 * 1000);

medusaIntegrationTestRunner({
  inApp: true,
  env: { COUPON_AUTO_ISSUE_ENABLED: 'true' },
  disableAutoTeardown: true,
  testSuite: ({ api, getContainer }) => {
    let adminHeaders: { headers: Record<string, string> };
    let storeHeaders: { headers: Record<string, string> };
    let customerId: string;
    let seq = 0;

    const svc = () => getContainer().resolve(PROMOTION_META_MODULE) as any;

    beforeEach(async () => {
      seq++;
      const container = getContainer();
      const config = container.resolve(ContainerRegistrationKeys.CONFIG_MODULE) as any;
      const secret = config.projectConfig.http.jwtSecret;

      const userModule = container.resolve(Modules.USER);
      const [user] = await userModule.createUsers([{ email: `admin${seq}@grant.test` }]);
      adminHeaders = {
        headers: {
          authorization: `Bearer ${jwt.sign(
            { actor_id: user.id, actor_type: 'user', auth_identity_id: 'test-admin-auth', app_metadata: { user_id: user.id } },
            secret,
          )}`,
        },
      };

      const customerModule = container.resolve(Modules.CUSTOMER);
      const [cust] = await customerModule.createCustomers([
        { email: `buyer${seq}@grant.test`, first_name: 'B', last_name: 'Uyer' },
      ]);
      customerId = cust.id;
      storeHeaders = {
        headers: {
          authorization: `Bearer ${jwt.sign(
            { actor_id: cust.id, actor_type: 'customer', auth_identity_id: 'c', app_metadata: { customer_id: cust.id } },
            secret,
          )}`,
        },
      };
    });

    /** 쿠폰 하나를 만든다. `additional_data` 로 visibility·발급창·수량한도를 준다. */
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

    /** 관리자 수동 발급. `submitId` 를 명시해 멱등성을 검사할 수 있게 한다. */
    const issue = (promotionId: string, submitId: string, quantity = 1) =>
      api.post(
        `/admin/customers/${customerId}/promotions`,
        { promotion_ids: [promotionId], submit_id: submitId, quantity },
        adminHeaders,
      );

    describe('여러 장과 멱등성', () => {
      it('G1: 같은 고객에게 같은 쿠폰 2장이 발급된다', async () => {
        const promotionId = await createPromo(`G1${seq}`, { visibility: 'assigned_only' });

        await issue(promotionId, 'sub-a');
        await issue(promotionId, 'sub-b');

        expect(await svc().listGrantsForCustomer(customerId)).toHaveLength(2);
      });

      it('G2: 같은 submit_id 로 두 번 보내면 한 장이다 — 따닥', async () => {
        const promotionId = await createPromo(`G2${seq}`, { visibility: 'assigned_only' });

        const first = await issue(promotionId, 'sub-same');
        const second = await issue(promotionId, 'sub-same');

        expect(first.status).toBe(200);
        expect(second.status).toBe(200);
        expect(await svc().listGrantsForCustomer(customerId)).toHaveLength(1);
      });

      it('quantity 만큼 한 번에 발급된다', async () => {
        const promotionId = await createPromo(`GQ${seq}`, { visibility: 'assigned_only' });

        await issue(promotionId, 'sub-q', 3);

        expect(await svc().listGrantsForCustomer(customerId)).toHaveLength(3);
      });

      it('G4: 트리거 자동발급을 두 번 불러도 한 장이다', async () => {
        const promotionId = await createPromo(`G4${seq}`, {
          visibility: 'assigned_only',
          auto_issue_trigger: 'customer_registered',
        });
        const body = { trigger: 'customer_registered' };

        await api.post(`/admin/customers/${customerId}/issue-coupons`, body, adminHeaders);
        await api.post(`/admin/customers/${customerId}/issue-coupons`, body, adminHeaders);

        const grants = await svc().listGrantsForCustomer(customerId);
        expect(grants.filter((g: any) => g.promotion_id === promotionId)).toHaveLength(1);
      });

      it('G3: 동시 클레임 2회 → 장 1개, 그리고 issued_count 는 +1 이다', async () => {
        // 🔴 장수만 검사하면 안 된다. 오늘 새고 있는 것은 장수가 아니라 «카운터» 다 —
        //    claim 라우트의 read-then-write 경합이 reserveClaimSlot 을 두 번 돌리는데,
        //    링크의 복합 PK 가 장수만 1로 막아 증상이 안 보였다. max_claims 가 있어야 재현된다.
        const promotionId = await createPromo(`G3${seq}`, {
          visibility: 'claimable',
          max_claims: 10,
        });
        const claim = () =>
          api
            .post(`/store/customers/me/promotions/${promotionId}/claim`, {}, storeHeaders)
            .catch((e: any) => e.response);

        await Promise.all([claim(), claim()]);

        expect(await svc().listGrantsForCustomer(customerId)).toHaveLength(1);
        const meta = await svc().getByPromotionId(promotionId);
        expect(Number(meta.issued_count)).toBe(1);
      });
    });
  },
});
```

이 파일의 `beforeEach` · `createPromo` · `issue` · `svc` 는 **Task 5·6·7·9 의 테스트가 그대로 재사용한다** — 각 태스크는 새 `describe` 블록만 더한다.

- [ ] **Step 2: 테스트를 돌려 실패를 확인한다**

Run: `scripts/local/run-medusa-integration.sh --testPathPattern 'coupon-grant'`
Expected: FAIL — G1 은 1장(링크 upsert), G2 는 2장, G3 는 `issued_count === 2`, G4 는 grant 0장

- [ ] **Step 3: 관리자 수동 발급을 그랜트로 옮긴다**

`api/admin/customers/[id]/promotions/route.ts` 의 POST 를 고친다.

본문 타입에 `submit_id` 를 더한다:

```ts
interface AssignPromotionsBody {
  promotion_ids: string[];
  /** true = 정책 검증 우회. 감사 로그에 admin_force로 기록됩니다. */
  force?: boolean;
  /**
   * 이 «제출» 의 식별자. 같은 제출이 재도착하면(따닥·타임아웃 재시도) 한 장만 남는다.
   * 없으면 서버가 만들어 쓰지만 **그 요청은 멱등하지 않다** — 클라이언트가 보내야 한다.
   */
  submit_id?: string;
  /** 1인당 발급 장수. 기본 1. */
  quantity?: number;
}
```

`alreadyIssuedIds` 로 skip 하던 블록(`existingCustomers` 조회와 `alreadyIssuedIds.has(promo.id)` 분기)을 **삭제한다** — 여러 장이 정상이므로 「이미 발급됨」이 더 이상 skip 사유가 아니다. `already_issued` 를 skip 사유로 쓰던 자리도 함께 없앤다.

발급 루프의 링크 생성/`recordIssue` 부분을 다음으로 바꾼다:

```ts
    const quantity = Math.max(1, Math.min(Number(body.quantity ?? 1), 50));
    const submitId = body.submit_id ?? randomUUID();

    // …promo 루프 안…
    let granted = 0;
    for (let n = 1; n <= quantity; n++) {
      const issueKey = `${submitId}:${n}`;

      let slotReserved = false;
      if (!force && maxClaims !== null) {
        const slot = await promotionMetaService.reserveClaimSlot(promo.id, maxClaims);
        if (slot === 'exhausted') {
          skipped.push({ promotion_id: promo.id, reason: 'max_claims_exceeded' });
          break;
        }
        slotReserved = true;
      }

      let result: 'created' | 'duplicate';
      try {
        result = await promotionMetaService.issueGrant({
          promotion_id: promo.id,
          customer_id: customerId,
          issue_key: issueKey,
          issued_via: issueTrigger,
          expires_at: computeExpiresAt(meta, now),
          now,
        });
      } catch (e: any) {
        if (slotReserved) await promotionMetaService.releaseClaimSlot(promo.id).catch(() => {});
        skipped.push({ promotion_id: promo.id, reason: 'grant_error' });
        break;
      }

      if (result === 'duplicate') {
        // 같은 제출의 재도착이다. 슬롯을 잡았다면 되돌린다 — 잡은 쪽이 반환 책임을 진다.
        if (slotReserved) await promotionMetaService.releaseClaimSlot(promo.id).catch(() => {});
        continue;
      }

      if (force && maxClaims !== null) {
        // force 발급도 총 발급 수량에 포함 (issued_count SoT 유지)
        await promotionMetaService.incrementIssuedCount(promo.id).catch(() => {});
      }
      granted++;
    }

    // 링크는 표시 조인용으로만 유지한다 — `data` 는 싣지 않는다(만료·사용의 정본은 grant 다).
    if (granted > 0) {
      await (link as any).create([{
        [Modules.CUSTOMER]: { customer_id: customerId },
        [Modules.PROMOTION]: { promotion_id: promo.id },
      }]).catch(() => {});
      issued.push(promo.id);
    }
```

파일 상단에 `import { randomUUID } from 'crypto';` 를 더한다.

- [ ] **Step 4: 트리거 자동발급을 그랜트로 옮긴다**

`api/admin/customers/[id]/issue-coupons/route.ts` 에서 `isAlreadyIssued` 분기를 삭제하고(그 skip 사유 `already_issued` 는 유지 — 이제 `issueGrant` 의 `'duplicate'` 가 그 자리를 채운다), 링크 생성 + `recordIssue` 블록을 다음으로 바꾼다:

```ts
    let result: 'created' | 'duplicate';
    try {
      result = await promotionMetaService.issueGrant({
        promotion_id: promo.id,
        customer_id: customerId,
        // 트리거당 한 장. 결정적 키라 channel-adapter 재시도가 멱등하다.
        issue_key: `trigger:${trigger}`,
        issued_via: trigger,
        expires_at: computeExpiresAt(meta, now),
        now,
      });
    } catch (e: any) {
      if (meta.max_claims != null) {
        await promotionMetaService.releaseClaimSlot(promo.id).catch(() => {});
      }
      // Transient DB 에러 → 500 으로 올려 channel-adapter 가 재시도하게 한다.
      // 재시도는 위 결정적 issue_key 덕에 멱등하다.
      throw e;
    }

    if (result === 'duplicate') {
      if (meta.max_claims != null) {
        await promotionMetaService.releaseClaimSlot(promo.id).catch(() => {});
      }
      skipped.push({ promotion_id: promo.id, reason: 'already_issued' });
      continue;
    }

    await (link as any).create([{
      [Modules.CUSTOMER]: { customer_id: customerId },
      [Modules.PROMOTION]: { promotion_id: promo.id },
    }]).catch(() => {});
    issued.push({ promotion_id: promo.id, code: promo.code });
```

⚠️ **`reserveClaimSlot` 호출을 `issueGrant` 앞으로 옮기지 말 것** — 이미 그 순서다. 순서를 바꾸면 슬롯을 잡기 전에 행이 생겨 카운터가 뒤처진다.

- [ ] **Step 5: 셀프 클레임의 경합을 닫는다**

`api/store/customers/me/promotions/[id]/claim/route.ts` 에서:

1. `alreadyClaimed` 계산(`:88`)과 그 early-return 블록(`:90-92`)을 **삭제한다.** 「이미 받았음」은 이제 유니크가 알려준다. 🔴 이 선검사가 read-then-write 경합의 원인이었다.
2. `customers` 조회는 그룹 룰 평가에 계속 필요하므로 `fields` 에서 `'promotions.id'` 만 뺀다.
3. `link.create` + `recordIssue` 블록을 다음으로 바꾼다:

```ts
  let result: 'created' | 'duplicate';
  try {
    result = await promotionMetaService.issueGrant({
      promotion_id: promotionId,
      customer_id: customerId,
      issue_key: 'claim', // 클레임은 영구 1장 — 따닥 방어가 DB 레벨이다.
      issued_via: 'customer_claim',
      expires_at: computeExpiresAt(meta, now),
      now,
    });
  } catch (e: any) {
    if (maxClaims !== null) await promotionMetaService.releaseClaimSlot(promotionId).catch(() => {});
    throw e;
  }

  if (result === 'duplicate') {
    // 이미 받았다. 슬롯을 잡았다면 반환한다 — 이게 없으면 따닥 한 번에 2명분이 소진된다.
    if (maxClaims !== null) await promotionMetaService.releaseClaimSlot(promotionId).catch(() => {});
    return res.status(200).json({ success: true, promotion_id: promotionId });
  }

  await link.create([{
    [Modules.CUSTOMER]: { customer_id: customerId },
    [Modules.PROMOTION]: { promotion_id: promotionId },
  }]).catch(() => {});

  return res.status(200).json({ success: true, promotion_id: promotionId });
```

`allLinks` 를 쓰던 fast-check(`allLinks.length >= maxClaims`)는 **남긴다** — 소진된 쿠폰을 싸게 거절하는 자리다. 단 `linkModule.list` 대신 `promotionMetaService.listGrantsForPromotion(promotionId)` 의 길이를 쓴다.

- [ ] **Step 6: 테스트를 돌려 통과를 확인한다**

Run: `scripts/local/run-medusa-integration.sh --testPathPattern 'coupon-grant'`
Expected: PASS (G1·G2·G3·G4)

Run: `scripts/local/run-medusa-integration.sh --testPathPattern 'coupon-'`
Expected: 기존 쿠폰 스펙 중 「이미 발급된 고객에게 재발급하면 skip」을 단언하는 케이스가 빨개진다. **그건 의도된 계약 변경이다** — 해당 단언을 「2장이 된다」로 고친다. 그 외 실패는 회귀다.

- [ ] **Step 7: 커밋**

```bash
git add apps/medusa/src/api/admin/customers apps/medusa/src/api/store/customers \
        apps/medusa/integration-tests/http/coupon-grant.spec.ts
git commit -m "feat(coupon): 발급 3경로를 그랜트로 — issue_key 멱등성 (#488 G1~G4)"
```

---

## Task 5: 「1장 = 1회」 강제 — 게이트·백스톱·소모 (G5~G7)

**Files:**
- Modify: `apps/medusa/src/api/store/carts/middlewares/per-customer-limit.ts`
- Modify: `apps/medusa/src/workflows/hooks/cart/complete-cart.ts`
- Modify: `apps/medusa/src/workflows/hooks/cart/record-coupon-usage.ts`
- Modify: `apps/medusa/src/workflows/hooks/cart/coupon-usage.ts`
- Modify: `apps/medusa/src/workflows/hooks/cart/__tests__/coupon-usage.unit.spec.ts`
- Test: `apps/medusa/integration-tests/http/coupon-grant.spec.ts`

**Interfaces:**
- Consumes: `hasUsableGrant` · `selectGrantToConsume` · `grantsFor` (Task 2), `listGrantsForCustomer` · `consumeGrant` (Task 3)
- Produces: `coupon-usage.ts` 가 링크 페이로드 대신 `selectGrantIdsToConsume(grants, promotionIds, now): string[]` 를 export 한다.

🔴 **이 세 자리가 「1장 = 1회」의 전부다. 하나라도 빠지면 오늘 상태(무제한 사용)로 돌아간다.**

- [ ] **Step 1: 실패하는 통합 테스트 작성 (G5·G6)**

⚠️ **이 테스트는 `coupon-grant.spec.ts` 가 아니라 `coupon-cart.spec.ts` 에 넣는다.** 카트에 상품을 담으려면 region · sales channel · product · publishable key 픽스처가 필요한데, 그게 이미 그 파일에 있다(`coupon-cart.spec.ts:28-137` 의 `newCustomerCart` · `applyAndGetDiscount`). 100줄짜리 픽스처를 복제하지 말 것.

> 🔴 **주문 «완료» 는 이 플랜의 자동 테스트가 덮지 않는다.** 결제 세션이 필요해
> (`validateCartPaymentsStep`) 결제 스텁 없이는 `completeCartWorkflow` 가 끝나지 않는다.
> 그래서 «주문이 생기면 장이 줄어든다» 의 자동 검증은 **두 조각으로 나눠 덮는다**:
> ① 어느 장을 고르는가 = `selectGrantIdsToConsume` 유닛(Step 6) ② 고른 장이 어떻게 되는가 =
> `consumeGrant` 모듈 통합(Task 3). **둘을 잇는 실제 체크아웃은 리허설 2차의 몫이다** —
> 플랜 끝의 「남는 것」 표에 적혀 있다. 여기서 체크아웃 하네스를 새로 만들지 말 것.

`coupon-cart.spec.ts` 의 `describe` 안에 추가한다. `newCustomerCart` 와 `createPromo` 는 그 파일에 이미 있는 헬퍼다.

```ts
    it('G6: 쓸 수 있는 장이 없으면 카트에 붙지 않는다', async () => {
      const { cartId, custHeaders, customerId } = await newCustomerCart();
      const promotionId = await createPromo(`SPENT_${seq}`, { visibility: 'assigned_only' });
      const service = getContainer().resolve(PROMOTION_META_MODULE) as any;

      // 한 장 발급한 뒤 그 장을 소모시킨다 — 체크아웃 없이 「다 쓴 상태」를 만든다.
      await service.issueGrant({
        promotion_id: promotionId, customer_id: customerId, issue_key: 'k1',
        issued_via: 'admin_manual', expires_at: null, now: new Date(),
      });
      const [grant] = await service.listGrantsForCustomer(customerId);
      await service.consumeGrant(grant.id, 'order_spent', new Date());

      const res = await api
        .post(`/store/carts/${cartId}/promotions`, { promo_codes: [`SPENT_${seq}`] }, custHeaders)
        .catch((e: any) => e.response);

      expect(res.status).toBe(400);
      expect(res.data.message).toBe('COUPON_EXPIRED');
    });

    it('G5: 2장 중 1장을 써도 남은 장으로 계속 붙는다', async () => {
      const { cartId, custHeaders, customerId } = await newCustomerCart();
      const promotionId = await createPromo(`TWO_${seq}`, { visibility: 'assigned_only' });
      const service = getContainer().resolve(PROMOTION_META_MODULE) as any;

      for (const key of ['k1', 'k2']) {
        await service.issueGrant({
          promotion_id: promotionId, customer_id: customerId, issue_key: key,
          issued_via: 'admin_manual', expires_at: null, now: new Date(),
        });
      }
      const grants = await service.listGrantsForCustomer(customerId);
      await service.consumeGrant(grants[0].id, 'order_one', new Date());

      const res = await api.post(
        `/store/carts/${cartId}/promotions`,
        { promo_codes: [`TWO_${seq}`] },
        custHeaders,
      );

      expect(res.status).toBe(200);
      expect(res.data.cart.discount_total).toBeGreaterThan(0);
    });

    it('발급받지 않은 assigned_only 쿠폰은 여전히 거절된다 — 회귀 방지', async () => {
      const { cartId, custHeaders } = await newCustomerCart();
      await createPromo(`NONE_${seq}`, { visibility: 'assigned_only' });

      const res = await api
        .post(`/store/carts/${cartId}/promotions`, { promo_codes: [`NONE_${seq}`] }, custHeaders)
        .catch((e: any) => e.response);

      expect(res.status).toBe(400);
      expect(res.data.message).toBe('COUPON_NOT_ASSIGNED');
    });
```

파일 상단에 `import { PROMOTION_META_MODULE } from '../../src/modules/promotion-meta';` 가 없으면 더한다.

**G7(FEFO)은 Step 6 의 유닛 테스트가 덮는다** — 정렬 규칙에 DB 가 필요 없다.

- [ ] **Step 2: 테스트를 돌려 실패를 확인한다**

Run: `scripts/local/run-medusa-integration.sh --testPathPattern 'coupon-cart'`
Expected: FAIL — G6 는 200(다 쓴 쿠폰이 붙는다), G5 는 `service.issueGrant is not a function` 이 아니라 게이트가 링크만 봐서 통과. 세 번째는 이미 통과해야 정상이다(회귀 감시용).

- [ ] **Step 3: 카트 부착 게이트를 그랜트로**

`api/store/carts/middlewares/per-customer-limit.ts` 를 고친다.

import 를 바꾼다:

```ts
import { grantsFor, hasUsableGrant } from '../../../../modules/promotion-meta/grants';
import type { CouponGrantRow } from '../../../../modules/promotion-meta/service';
```

`listIssuedLinks` 호출을 바꾼다:

```ts
  const grants: CouponGrantRow[] = customerId
    ? await promotionMetaService.listGrantsForCustomer(customerId)
    : [];
```

루프 안의 만료 검사와 발급 검사를 하나로 합친다:

```ts
    const mine = grantsFor(grants, promotion.id);
    const now = new Date();

    // 🔴 만료는 visibility 와 무관하다 — public 쿠폰도 대상이다.
    // 발급된 장이 있으면 그 장들이, 없으면(=발급 개념이 없는 public) 정책이 만료를 정한다.
    if (mine.length > 0) {
      if (!hasUsableGrant(mine, now)) {
        // 쓸 수 있는 장이 없다. 만료됐거나 다 썼거나 — 고객에겐 같은 얘기다.
        return res.status(400).json({ message: 'COUPON_EXPIRED', code: 'COUPON_EXPIRED' });
      }
    } else if (!isUsable(null, meta, now)) {
      return res.status(400).json({ message: 'COUPON_EXPIRED', code: 'COUPON_EXPIRED' });
    }

    // 메타가 없으면 «발급 필요» 다(닫힌 기본값 — #488 N7).
    if (requiresIssuance(meta)) {
      if (!customerId || mine.length === 0) {
        return res.status(400).json({
          message: 'COUPON_NOT_ASSIGNED',
          code: 'COUPON_NOT_ASSIGNED',
        });
      }
      // 발급은 받았는데 쓸 장이 없는 경우는 위에서 이미 걸렀다.
    }
```

`query.graph({entity:'customer', fields:['id','promotions.id']})` 조회(`:66`)를 **삭제한다** — 링크는 「가진 적 있다」만 말하므로 다 쓴 쿠폰을 통과시킨다.

- [ ] **Step 4: 체크아웃 백스톱을 같은 판정으로**

`workflows/hooks/cart/complete-cart.ts` 의 쿠폰 블록에서 `listIssuedLinks` 를 `promotionMetaService.listGrantsForCustomer(cart.customer_id)` 로 바꾸고, Step 3 과 **같은 판정**을 쓴다. 에러 토큰은 지금 그대로 유지한다(`COUPON_EXPIRED` / `'이 쿠폰은 발급된 고객만 사용할 수 있습니다.'`).

`:62` 의 `customer.promotions` 조회도 삭제한다.

⚠️ **이 훅은 `validate` 이고 이미 우리 핸들러가 점유 중이다.** 새 훅을 등록하지 말고 기존 핸들러 안에서 고칠 것.

- [ ] **Step 5: 사용 기록을 «장 소모» 로**

`workflows/hooks/cart/coupon-usage.ts` 를 다시 쓴다. 링크 페이로드를 만들던 순수 함수가 **소모할 grant id 목록**을 만드는 순수 함수가 된다.

```ts
import { selectGrantToConsume, grantsFor } from '../../../modules/promotion-meta/grants';
import type { CouponGrantRow } from '../../../modules/promotion-meta/service';

/**
 * 「이 주문에 쓰인 쿠폰」마다 소모할 장을 하나씩 고른다 (#488 A2 의 선행).
 *
 * 🔴 옛 구현(링크 upsert)은 **없는 쌍에 행을 만들어 버리는** 위험이 있었다 — `Link.create` 가
 * upsert 라 `public` 쿠폰을 결제한 고객에게 만료 NULL 인 «영구 쿠폰» 이 생겼다(C1, 2026-08-31).
 * grant 로 옮기면서 그 위험 자체가 사라졌다 — **여기서는 id 로 UPDATE 만 한다.** 발급받지
 * 않은 쿠폰은 고를 장이 없어 자연히 건너뛴다. 그래서 「이미 발급된 것만」 필터가 필요 없다.
 */
export function selectGrantIdsToConsume(
  grants: CouponGrantRow[],
  promotionIds: string[],
  now: Date,
): string[] {
  const ids: string[] = [];
  for (const promotionId of promotionIds ?? []) {
    const chosen = selectGrantToConsume(grantsFor(grants, promotionId), now);
    if (chosen) ids.push(chosen.id);
  }
  return ids;
}
```

`workflows/hooks/cart/record-coupon-usage.ts` 의 훅 본문에서 `listIssuedLinks` + `buildUsageLinks` + `link.create` 를 다음으로 바꾼다:

```ts
      const promotionMetaService = container.resolve(PROMOTION_META_MODULE);
      const grants = found?.customer_id
        ? await promotionMetaService.listGrantsForCustomer(found.customer_id)
        : [];
      const now = new Date();
      const promotionIds = (found?.promotions ?? []).map((p) => p.id);
      const grantIds = selectGrantIdsToConsume(grants, promotionIds, now);

      for (const grantId of grantIds) {
        await promotionMetaService.consumeGrant(grantId, order_id, now);
      }
```

⚠️ 이 훅은 실패해도 주문을 되돌리지 않는다(기존 판단 유지). **그래서 기록이 유실되면 장이 안 줄어든다.** catch 안의 로그를 `logger.error` 로 올려 그 창이 눈에 보이게 한다.

- [ ] **Step 6: `coupon-usage.unit.spec.ts` 를 새 함수에 맞춘다**

기존 `buildUsageLinks` 테스트를 `selectGrantIdsToConsume` 테스트로 바꾼다.

```ts
import { selectGrantIdsToConsume } from '../coupon-usage';

const NOW = new Date('2026-09-02T00:00:00.000Z');

function g(over: any) {
  return {
    id: over.id, promotion_id: over.promotion_id ?? 'p1', customer_id: 'c1',
    issue_key: over.id, issued_via: 'admin_manual',
    issued_at: new Date('2026-09-01T00:00:00.000Z'),
    expires_at: over.expires_at ?? null, used_at: over.used_at ?? null, order_id: null,
  };
}

describe('selectGrantIdsToConsume', () => {
  it('프로모션마다 한 장씩 고른다', () => {
    const grants = [g({ id: 'a', promotion_id: 'p1' }), g({ id: 'b', promotion_id: 'p2' })];
    expect(selectGrantIdsToConsume(grants, ['p1', 'p2'], NOW)).toEqual(['a', 'b']);
  });

  it('발급받지 않은 쿠폰은 건너뛴다 — 없는 장을 만들지 않는다', () => {
    expect(selectGrantIdsToConsume([], ['p_public'], NOW)).toEqual([]);
  });

  it('한 프로모션에 2장이 있어도 하나만 고른다', () => {
    const grants = [g({ id: 'a' }), g({ id: 'b' })];
    expect(selectGrantIdsToConsume(grants, ['p1'], NOW)).toHaveLength(1);
  });

  it('이미 소모된 장만 있으면 아무것도 안 고른다', () => {
    expect(selectGrantIdsToConsume([g({ id: 'a', used_at: NOW })], ['p1'], NOW)).toEqual([]);
  });
});
```

- [ ] **Step 7: 유닛과 통합을 돌려 통과를 확인한다**

Run: `cd apps/medusa && npx jest --config jest.config.js --testPathPattern 'coupon-usage.unit' --maxWorkers=2`
Expected: PASS

Run: `scripts/local/run-medusa-integration.sh --testPathPattern 'coupon-'`
Expected: PASS (G1~G7 포함)

- [ ] **Step 8: 커밋**

```bash
git add apps/medusa/src/api/store/carts/middlewares/per-customer-limit.ts \
        apps/medusa/src/workflows/hooks/cart \
        apps/medusa/integration-tests/http/coupon-cart.spec.ts
git commit -m "feat(coupon): 1장=1회를 게이트·백스톱·소모 세 자리에서 강제 (#488 G5~G7)"
```

---

## Task 6: 취소 시 장 복구 — A2 종결 (G8·G9)

**Files:**
- Create: `apps/medusa/src/subscribers/coupon-grant-restore.ts`
- Test: `apps/medusa/integration-tests/http/coupon-grant.spec.ts`

**Interfaces:**
- Consumes: `restoreGrantsByOrder` (Task 3)

- [ ] **Step 1: 실패하는 유닛 테스트 작성**

> 🔴 **실제 주문 취소로는 자동 테스트하지 않는다.** 그러려면 완료된 주문이 필요하고, 그건
> 결제 세션을 요구한다(Task 5 의 같은 이유). 대신 **두 조각**으로 나눈다 —
> ① 「무엇을 되살리는가」 = `restoreGrantsByOrder` 모듈 통합(**Task 3 에서 이미 작성했다.
> G9 는 그 «만료된 장은 안 되살린다» 케이스다**) ② 「언제 부르는가」 = 아래 구독자 유닛.
> 실주문 취소는 리허설 2차의 몫이다.

`apps/medusa/src/subscribers/__tests__/coupon-grant-restore.unit.spec.ts`

```ts
import handleCouponGrantRestore, { config } from '../coupon-grant-restore';

function makeContainer(service: any) {
  return {
    resolve: (key: string) => (key === 'promotionMeta' ? service : { info: jest.fn(), error: jest.fn() }),
  };
}

describe('coupon-grant-restore 구독자', () => {
  it('order.canceled 에 등록된다', () => {
    expect(config.event).toBe('order.canceled');
  });

  it('주문 id 로 복구를 부른다', async () => {
    const service = { restoreGrantsByOrder: jest.fn().mockResolvedValue(2) };
    await handleCouponGrantRestore({
      event: { data: { id: 'order_1' } },
      container: makeContainer(service),
    } as any);

    expect(service.restoreGrantsByOrder).toHaveBeenCalledWith('order_1', expect.any(Date));
  });

  it('주문 id 가 없으면 아무것도 하지 않는다', async () => {
    const service = { restoreGrantsByOrder: jest.fn() };
    await handleCouponGrantRestore({ event: { data: {} }, container: makeContainer(service) } as any);

    expect(service.restoreGrantsByOrder).not.toHaveBeenCalled();
  });

  it('복구가 실패해도 던지지 않는다 — 취소를 막으면 안 된다', async () => {
    const service = { restoreGrantsByOrder: jest.fn().mockRejectedValue(new Error('db down')) };

    await expect(
      handleCouponGrantRestore({
        event: { data: { id: 'order_2' } },
        container: makeContainer(service),
      } as any),
    ).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: 테스트를 돌려 실패를 확인한다**

Run: `cd apps/medusa && npx jest --config jest.config.js --testPathPattern 'coupon-grant-restore' --maxWorkers=2`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: 구독자 구현**

`apps/medusa/src/subscribers/coupon-grant-restore.ts`

```ts
import { ContainerRegistrationKeys } from '@medusajs/framework/utils';
import { type SubscriberConfig, type SubscriberArgs } from '@medusajs/medusa';
import { PROMOTION_META_MODULE } from '../modules/promotion-meta';
import type PromotionMetaModuleService from '../modules/promotion-meta/service';

/**
 * 주문이 취소되면 그 주문에 쓰인 쿠폰 «장» 을 되돌린다 (#488 A2).
 *
 * A2 는 추상적 서술이 아니었다 — 1인당 한도 2/2 를 쓴 뒤 두 주문 모두 취소+전액 환불했는데
 * `campaign_budget_usage` 가 2 그대로라 고객 목록에서 쿠폰이 영구히 사라졌다(리허설 1차 실측).
 * 그 한도를 안 쓰게 되면서(설계 §5.3) 복구 대상이 우리 테이블로 내려왔다.
 *
 * ⚠️ 이 워크플로 훅이 아니라 **구독자**인 이유: `order.canceled` 에는 이미 구독자가 둘 붙어
 * 있고(welcome-membership-order · membership-benefit-order), 구독자는 훅과 달리 개수 제한이 없다.
 *
 * ⚠️ 만료된 장은 되살리지 않는다 — 되살려도 못 쓰고 「돌아왔는데 못 쓴다」가 더 나쁘다.
 * `restoreGrantsByOrder` 가 그 판정을 갖고 있다.
 */
export default async function handleCouponGrantRestore({
  event: { data },
  container,
}: SubscriberArgs<{ id: string }>) {
  const orderId = data?.id;
  if (!orderId) return;

  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const promotionMetaService = container.resolve<PromotionMetaModuleService>(PROMOTION_META_MODULE);

  try {
    const restored = await promotionMetaService.restoreGrantsByOrder(orderId, new Date());
    if (restored > 0) {
      logger.info(`[coupon] 주문 취소로 쿠폰 ${restored}장 복구 (order_id=${orderId})`);
    }
  } catch (e: any) {
    // 복구 실패가 취소를 막아서는 안 된다. 다만 조용히 넘기면 고객이 쿠폰을 잃은 채 남는다.
    logger.error(
      `[coupon] 쿠폰 장 복구 실패 (order_id=${orderId}): ${e?.message ?? e}. ` +
        'coupon_grant 에서 이 order_id 를 찾아 used_at/order_id 를 수동으로 비울 것.',
    );
  }
}

export const config: SubscriberConfig = {
  event: 'order.canceled',
  context: { subscriberId: 'coupon-grant-restore-handler' },
};
```

- [ ] **Step 4: 테스트를 돌려 통과를 확인한다**

Run: `cd apps/medusa && npx jest --config jest.config.js --testPathPattern 'coupon-grant-restore' --maxWorkers=2`
Expected: PASS (4 tests)

Run: `scripts/local/run-medusa-integration.sh --modules --testPathPattern 'promotion-meta'`
Expected: PASS — Task 3 의 `restoreGrantsByOrder` 케이스(G9 포함)가 여전히 초록

- [ ] **Step 5: 커밋**

```bash
git add apps/medusa/src/subscribers
git commit -m "feat(coupon): 주문 취소 시 쿠폰 장 복구 — A2 종결 (#488 G8·G9)"
```

---

## Task 7: 회수와 발급 현황을 장 단위로 (G10)

**Files:**
- Modify: `apps/medusa/src/api/admin/promotions/[id]/customers/route.ts` (GET·DELETE)
- Modify: `apps/medusa/src/api/admin/customers/[id]/promotions/route.ts` (GET·DELETE)
- Test: `apps/medusa/integration-tests/http/coupon-grant.spec.ts`

**Interfaces:**
- Consumes: `listGrantsForPromotion` · `listGrantsForCustomer` · `revokeGrants` (Task 3), `usableGrants` · `nextExpiryAt` (Task 2)
- Produces: `GET /admin/promotions/:id/customers` 응답의 고객 항목에 `granted_count` · `used_count` · `usable_count` · `next_expires_at` 추가, `max_uses_per_customer` **제거**.

- [ ] **Step 1: 실패하는 통합 테스트 작성**

`coupon-grant.spec.ts` 에 새 `describe` 를 더한다. `createPromo` · `issue` · `svc` 는 Task 4 Step 1 이 만든 헬퍼다.

```ts
    describe('회수와 발급 현황', () => {
      it('G10: 회수는 장수만큼 issued_count 를 되돌린다', async () => {
        const promotionId = await createPromo(`G10${seq}`, {
          visibility: 'assigned_only',
          max_claims: 100,
        });
        await issue(promotionId, 'sub-rev', 3);
        const before = Number((await svc().getByPromotionId(promotionId)).issued_count);
        expect(before).toBe(3);

        await api.delete(`/admin/promotions/${promotionId}/customers`, {
          ...adminHeaders,
          data: { customer_ids: [customerId] },
        });

        expect(await svc().listGrantsForCustomer(customerId)).toHaveLength(0);
        expect(Number((await svc().getByPromotionId(promotionId)).issued_count)).toBe(0);
      });

      it('발급 현황이 고객별 보유·사용 장수를 돌려준다', async () => {
        const promotionId = await createPromo(`GST${seq}`, { visibility: 'assigned_only' });
        await issue(promotionId, 'sub-stat', 2);

        const res = await api.get(`/admin/promotions/${promotionId}/customers`, adminHeaders);

        const row = res.data.customers.find((c: any) => c.id === customerId);
        expect(row.granted_count).toBe(2);
        expect(row.used_count).toBe(0);
        expect(row.usable_count).toBe(2);
        expect(res.data.max_uses_per_customer).toBeUndefined();
      });
    });
```

- [ ] **Step 2: 테스트를 돌려 실패를 확인한다**

Run: `scripts/local/run-medusa-integration.sh --testPathPattern 'coupon-grant'`
Expected: FAIL — `granted_count` 가 undefined, 회수 후 `issued_count` 가 1만 줄어듦

- [ ] **Step 3: 발급 현황 GET 을 그랜트로**

`admin/promotions/[id]/customers/route.ts` 의 GET 을 고친다. 링크 조회를 grant 조회로 바꾸고, 고객별로 집계한다.

```ts
  const grants = await promotionMetaService.listGrantsForPromotion(promotionId);
  const now = new Date();

  const byCustomer = new Map<string, CouponGrantRow[]>();
  for (const g of grants) {
    const list = byCustomer.get(g.customer_id) ?? [];
    list.push(g);
    byCustomer.set(g.customer_id, list);
  }

  const customerIds = [...byCustomer.keys()];
  const count = customerIds.length;
  const paginatedIds = customerIds.slice(offset, offset + limit);
```

`customersWithUsage` 조립을 바꾼다:

```ts
  const customersWithUsage = customers.map((c) => {
    const mine = byCustomer.get(c.id) ?? [];
    const usable = usableGrants(mine, now);
    return {
      ...c,
      granted_count: mine.length,
      used_count: mine.filter((g) => g.used_at != null).length,
      usable_count: usable.length,
      next_expires_at: nextExpiryAt(mine, now),
      // 가장 최근 발급의 경로 — 어느 출처에서 왔는지 한눈에 보이게.
      issued_via: mine[mine.length - 1]?.issued_via ?? null,
      issued_at: mine[0]?.issued_at ?? c.created_at,
    };
  });
```

`max_uses_per_customer` 를 계산하던 블록(`budget?.type === 'use_by_attribute'`)과 응답 필드를 **삭제한다**. `promotion` 조회의 `fields` 에서 `campaign.budget.*` 도 뺀다.

주문 수를 세던 `query.graph({entity:'order', …})` 블록도 **삭제한다** — `used_count` 를 이제 grant 가 직접 안다(그게 더 정확하다. 옛 방식은 `take: 100_000` 상한을 안고 있었다).

- [ ] **Step 4: 회수 DELETE 를 장 단위로**

같은 파일의 DELETE 를 고친다:

```ts
  const removed: { customer_id: string; grants: number }[] = [];
  for (const cid of customer_ids) {
    const n = await promotionMetaService.revokeGrants(promotionId, cid);
    if (n === 0) continue;
    removed.push({ customer_id: cid, grants: n });

    // 회수한 장수만큼 발급 카운트를 되돌린다 — 1회 고정이면 여러 장 회수 시 카운터가 남는다.
    for (let i = 0; i < n; i++) {
      await promotionMetaService.releaseClaimSlot(promotionId).catch(() => {});
    }

    // 남은 장이 없으면 표시용 링크도 걷는다.
    await link.dismiss([{
      [Modules.CUSTOMER]: { customer_id: cid },
      [Modules.PROMOTION]: { promotion_id: promotionId },
    }]).catch(() => {});
  }

  return res.status(200).json({
    success: true,
    message: `${removed.length} customer(s) revoked from promotion`,
    promotion_id: promotionId,
    customer_ids: removed.map((r) => r.customer_id),
    revoked_grants: removed.reduce((s, r) => s + r.grants, 0),
  });
```

`removeIssueLog` 호출은 삭제한다(Task 9 가 그 메서드를 지운다).

- [ ] **Step 5: 고객축 GET·DELETE 도 같은 모양으로**

`admin/customers/[id]/promotions/route.ts` 의 GET 은 `listIssuedLinks` 를 `listGrantsForCustomer` 로 바꾸고, 프로모션마다 `granted_count`·`used_count`·`usable_count`·`next_expires_at` 을 싣는다. DELETE 는 Step 4 와 같은 회수 로직을 프로모션 축으로 돌린다.

- [ ] **Step 6: 테스트를 돌려 통과를 확인한다**

Run: `scripts/local/run-medusa-integration.sh --testPathPattern 'coupon-'`
Expected: PASS

- [ ] **Step 7: 커밋**

```bash
git add apps/medusa/src/api/admin
git commit -m "feat(coupon): 회수·발급현황을 장 단위로 (#488 G10)"
```

---

## Task 8: 표시 경로 3곳

**Files:**
- Modify: `apps/medusa/src/api/store/customers/me/promotions/route.ts`
- Modify: `apps/medusa/src/api/store/events/[slug]/route.ts`
- Modify: `apps/medusa/src/api/store/coupons/preview/route.ts`
- Modify: `apps/medusa/src/api/store/customers/me/promotions/format-promotion.ts` (+ 유닛 spec)

**Interfaces:**
- Consumes: `usableGrants` · `nextExpiryAt` · `grantsFor` (Task 2), `listGrantsForCustomer` (Task 3)
- Produces: 마이페이지 응답의 각 쿠폰에 `usable_count: number` 추가. `expires_at` 의 의미는 「사용 가능한 장 중 가장 이른 만료」.

- [ ] **Step 1: `format-promotion.ts` 의 실패하는 유닛 테스트 작성**

`__tests__/format-promotion.unit.spec.ts` 에 추가한다.

```ts
  it('보유 장수를 싣는다', () => {
    const grants = [
      { id: 'a', promotion_id: 'p1', customer_id: 'c1', issue_key: 'k1',
        issued_via: 'admin_manual', issued_at: new Date(), expires_at: null,
        used_at: null, order_id: null },
      { id: 'b', promotion_id: 'p1', customer_id: 'c1', issue_key: 'k2',
        issued_via: 'admin_manual', issued_at: new Date(), expires_at: null,
        used_at: new Date(), order_id: 'o1' },
    ];
    const out = formatPromotion(promotion, meta, grants, new Date());
    expect(out.usable_count).toBe(1);
  });

  it('사용 가능한 장이 없으면 usable_count 가 0 이다', () => {
    const out = formatPromotion(promotion, meta, [], new Date());
    expect(out.usable_count).toBe(0);
  });
```

- [ ] **Step 2: 테스트를 돌려 실패를 확인한다**

Run: `cd apps/medusa && npx jest --config jest.config.js --testPathPattern 'format-promotion' --maxWorkers=2`
Expected: FAIL

- [ ] **Step 3: `format-promotion.ts` 와 세 라우트를 고친다**

`format-promotion.ts` 의 시그니처를 「한 장」에서 「장 배열」로 바꾸고 `usable_count` 를 더한다. 만료 표시는 `nextExpiryAt` 을 쓴다.

🔴 **`displayExpiresAt`(`validity.ts`)의 계약을 유지할 것** — 그 함수 헤더가 설명하는 함정(`link.expires_at ?? policy.ends_at` 로 합치면 «발급된 무기한 장»이 정책값으로 샌다)은 여러 장이 되어도 그대로다. 인자를 「가장 이른 사용 가능 장」으로 바꾸되 `??` 로 합치지 말고 `?:` 분기를 유지한다.

`me/promotions/route.ts`:
- `listIssuedLinks` → `listGrantsForCustomer`
- `use_by_attribute` 소진 필터(`:145-178`)를 **삭제**하고 `usableGrants(...).length === 0` 으로 대체
- `assignedPromotions` 를 「사용 가능한 장이 있는 쿠폰」으로 좁힌다

`events/[slug]/route.ts` · `coupons/preview/route.ts`:
- 「보유 여부」 판정을 `hasUsableGrant` 로 바꾼다
- `customer.promotions` 조회에서 `'promotions.id'` 를 뺀다(그룹 룰 평가에 쓰는 `'groups.id'` 는 남긴다)

- [ ] **Step 4: 테스트를 돌려 통과를 확인한다**

Run: `cd apps/medusa && npx jest --config jest.config.js --testPathPattern 'format-promotion' --maxWorkers=2`
Expected: PASS

Run: `scripts/local/run-medusa-integration.sh --testPathPattern 'coupon-'`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add apps/medusa/src/api/store
git commit -m "feat(coupon): 스토어 표시 3경로를 장 단위로 (#488)"
```

---

## Task 9: 대량 발급 라우트

**Files:**
- Modify: `apps/medusa/src/api/admin/promotions/[id]/customers/route.ts` (POST 신설)
- Test: `apps/medusa/integration-tests/http/coupon-grant.spec.ts`

**Interfaces:**
- Consumes: `issueGrant` · `reserveClaimSlot` (Task 3)
- Produces: `POST /admin/promotions/:id/customers` — 본문 `{ customer_ids: string[], quantity?: number, submit_id: string, force?: boolean }`, 응답 `{ issued: [{customer_id, granted}], skipped: [{customer_id, reason}] }`. Task 11 의 admin-web 이 이 계약을 쓴다.

- [ ] **Step 1: 실패하는 통합 테스트 작성**

`coupon-grant.spec.ts` 에 새 `describe` 를 더한다. 두 번째 고객이 필요하므로 그 안에서 만든다.

```ts
    describe('대량 발급', () => {
      let customerId2: string;

      beforeEach(async () => {
        const [c2] = await getContainer()
          .resolve(Modules.CUSTOMER)
          .createCustomers([{ email: `buyer2_${seq}@grant.test` }]);
        customerId2 = c2.id;
      });

      it('한 쿠폰을 여러 고객에게 발급한다', async () => {
        const promotionId = await createPromo(`BULK${seq}`, { visibility: 'assigned_only' });

        const res = await api.post(
          `/admin/promotions/${promotionId}/customers`,
          { customer_ids: [customerId, customerId2], quantity: 2, submit_id: 'bulk-1' },
          adminHeaders,
        );

        expect(res.status).toBe(200);
        expect(res.data.issued).toHaveLength(2);
        expect(res.data.issued[0].granted).toBe(2);
        expect(await svc().listGrantsForCustomer(customerId)).toHaveLength(2);
        expect(await svc().listGrantsForCustomer(customerId2)).toHaveLength(2);
      });

      it('같은 submit_id 로 두 번 보내도 장수가 늘지 않는다', async () => {
        const promotionId = await createPromo(`BULKI${seq}`, { visibility: 'assigned_only' });
        const body = { customer_ids: [customerId], quantity: 2, submit_id: 'bulk-same' };

        await api.post(`/admin/promotions/${promotionId}/customers`, body, adminHeaders);
        await api.post(`/admin/promotions/${promotionId}/customers`, body, adminHeaders);

        expect(await svc().listGrantsForCustomer(customerId)).toHaveLength(2);
      });

      it('한 고객의 실패가 나머지를 막지 않는다', async () => {
        const promotionId = await createPromo(`BULKM${seq}`, { visibility: 'assigned_only' });

        const res = await api.post(
          `/admin/promotions/${promotionId}/customers`,
          { customer_ids: ['cus_does_not_exist', customerId], submit_id: 'bulk-mixed' },
          adminHeaders,
        );

        expect(res.data.issued.map((i: any) => i.customer_id)).toEqual([customerId]);
        expect(res.data.skipped[0]).toEqual({
          customer_id: 'cus_does_not_exist',
          reason: 'customer_not_found',
        });
      });

      it('submit_id 가 없으면 400 이다 — 멱등성을 포기할 수 없다', async () => {
        const promotionId = await createPromo(`BULKN${seq}`, { visibility: 'assigned_only' });

        const res = await api
          .post(
            `/admin/promotions/${promotionId}/customers`,
            { customer_ids: [customerId] },
            adminHeaders,
          )
          .catch((e: any) => e.response);

        expect(res.status).toBe(400);
      });
    });
```

- [ ] **Step 2: 테스트를 돌려 실패를 확인한다**

Run: `scripts/local/run-medusa-integration.sh --testPathPattern 'coupon-grant'`
Expected: FAIL — 404 (POST 없음)

- [ ] **Step 3: POST 구현**

`admin/promotions/[id]/customers/route.ts` 에 추가한다. 쿠폰 축으로 한 번만 검증하고(상태·창·메타) 고객 루프를 돈다 — Task 4 의 고객축 라우트와 검증 순서가 같아야 한다.

```ts
interface BulkIssueBody {
  customer_ids: string[];
  quantity?: number;
  /** 이 «제출» 의 식별자. 재도착(따닥·타임아웃 재시도)이 장수를 늘리지 않게 한다. */
  submit_id: string;
  force?: boolean;
}

export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const promotionId = req.params.id;
  const { customer_ids, quantity = 1, submit_id, force = false } = req.body as BulkIssueBody;

  if (!Array.isArray(customer_ids) || customer_ids.length === 0) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, 'customer_ids is required');
  }
  if (!submit_id) {
    // 🔴 없으면 따닥이 곧 두 배 발급이다. 서버가 만들어 주지 않는다 — 재시도가 같은 값을
    //    보낼 수 있는 쪽은 클라이언트뿐이다.
    throw new MedusaError(MedusaError.Types.INVALID_DATA, 'submit_id is required');
  }
  const qty = Math.max(1, Math.min(Number(quantity), 50));
  if (customer_ids.length > 500) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, 'customer_ids must be 500 or fewer');
  }

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);
  const link = req.scope.resolve(ContainerRegistrationKeys.LINK);
  const promotionMetaService = req.scope.resolve<PromotionMetaModuleService>(PROMOTION_META_MODULE);
  const logger = req.scope.resolve(ContainerRegistrationKeys.LOGGER);

  const { data: promotions } = await query.graph({
    entity: 'promotion',
    fields: ['id', 'code', 'status', 'is_automatic', 'rules.attribute', 'rules.operator', 'rules.values.value'],
    filters: { id: promotionId },
  });
  const promo = promotions?.[0];
  if (!promo) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, `Promotion ${promotionId} not found`);
  }

  const meta = await promotionMetaService.getByPromotionId(promotionId);
  const now = new Date();
  const issueTrigger = force ? 'admin_force' : 'admin_manual';

  const issued: { customer_id: string; granted: number }[] = [];
  const skipped: { customer_id: string; reason: string }[] = [];

  // 쿠폰 축 검증은 루프 밖에서 한 번만 — 고객마다 같은 답이 나온다.
  if (!force) {
    if (promo.status !== 'active') {
      return res.status(200).json({
        issued: [],
        skipped: customer_ids.map((id) => ({ customer_id: id, reason: 'inactive' })),
      });
    }
    const window = issuanceWindowState(meta, now);
    if (window !== 'ok') {
      const reason = window === 'not_started' ? 'not_started' : 'expired';
      return res.status(200).json({
        issued: [],
        skipped: customer_ids.map((id) => ({ customer_id: id, reason })),
      });
    }
  }

  const maxClaims = meta?.max_claims != null ? Number(meta.max_claims) : null;

  for (const customerId of customer_ids) {
    const { data: customers } = await query.graph({
      entity: 'customer',
      fields: ['id', 'groups.id'],
      filters: { id: customerId },
    });
    if (!customers?.length) {
      skipped.push({ customer_id: customerId, reason: 'customer_not_found' });
      continue;
    }

    if (!force) {
      const groupIds = new Set<string>((customers[0].groups ?? []).map((g: any) => g.id));
      const eligibility = evaluateIssuanceRules(promo.rules, groupIds);
      if (!eligibility.eligible) {
        if (eligibility.reason === 'unsupported_rule') {
          logger.warn(
            `[coupon] 대량발급 skip — 발급 시점에 평가할 수 없는 룰 (promotion_id=${promotionId}, ` +
              `attribute=${eligibility.attribute}, operator=${eligibility.operator}, ` +
              `customer_id=${customerId}). issuance-rules.ts 의 분류표를 채우는 것이 정답이다.`,
          );
        }
        skipped.push({ customer_id: customerId, reason: eligibility.reason });
        continue;
      }
    }

    let granted = 0;
    for (let n = 1; n <= qty; n++) {
      let slotReserved = false;
      if (!force && maxClaims !== null) {
        const slot = await promotionMetaService.reserveClaimSlot(promotionId, maxClaims);
        if (slot === 'exhausted') {
          skipped.push({ customer_id: customerId, reason: 'max_claims_exceeded' });
          break;
        }
        slotReserved = true;
      }

      let result: 'created' | 'duplicate';
      try {
        result = await promotionMetaService.issueGrant({
          promotion_id: promotionId,
          customer_id: customerId,
          issue_key: `${submit_id}:${n}`,
          issued_via: issueTrigger,
          expires_at: computeExpiresAt(meta, now),
          now,
        });
      } catch (e: any) {
        if (slotReserved) await promotionMetaService.releaseClaimSlot(promotionId).catch(() => {});
        // 배치 resilient — 한 고객의 장애가 나머지를 막지 않는다.
        skipped.push({ customer_id: customerId, reason: 'grant_error' });
        break;
      }

      if (result === 'duplicate') {
        if (slotReserved) await promotionMetaService.releaseClaimSlot(promotionId).catch(() => {});
        continue;
      }
      if (force && maxClaims !== null) {
        await promotionMetaService.incrementIssuedCount(promotionId).catch(() => {});
      }
      granted++;
    }

    if (granted > 0) {
      await (link as any).create([{
        [Modules.CUSTOMER]: { customer_id: customerId },
        [Modules.PROMOTION]: { promotion_id: promotionId },
      }]).catch(() => {});
      issued.push({ customer_id: customerId, granted });
    }
  }

  return res.status(200).json({ promotion_id: promotionId, issued, skipped, force });
}
```

파일 상단에 필요한 import 를 더한다: `evaluateIssuanceRules`, `computeExpiresAt`, `issuanceWindowState`.

- [ ] **Step 4: 테스트를 돌려 통과를 확인한다**

Run: `scripts/local/run-medusa-integration.sh --testPathPattern 'coupon-grant'`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add apps/medusa/src/api/admin/promotions apps/medusa/integration-tests/http/coupon-grant.spec.ts
git commit -m "feat(coupon): 쿠폰 1개를 고객 N명에게 발급하는 라우트 (#488)"
```

---

## Task 10: 죽은 코드 제거 + 백필 스크립트

**Files:**
- Delete: `apps/medusa/src/modules/promotion-meta/issued-link.ts`
- Delete: `apps/medusa/src/modules/promotion-meta/models/promotion-issue-log.ts`
- Modify: `apps/medusa/src/modules/promotion-meta/service.ts`
- Modify: `apps/medusa/src/scripts/detach-coupon-campaigns.ts`
- Create: `apps/medusa/src/scripts/backfill-coupon-grants.ts`

**Interfaces:**
- Produces: `medusa exec ./src/scripts/backfill-coupon-grants.ts` — 배포 절차가 이 이름을 쓴다.

⚠️ **테이블은 DROP 하지 않는다.** 모델 파일을 지우는 것과 테이블을 지우는 것은 다르다 — 이 모듈의 마이그레이션은 전부 손으로 쓰므로 모델 제거가 DDL 을 만들지 않는다. `promotion_issue_log` 는 고아로 남고, 삭제는 별도 PR 이다(ADR-0005 §5 expand-contract).

- [ ] **Step 1: 남은 참조를 전부 찾는다**

Run: `grep -rn "issued-link\|listIssuedLinks\|findIssuedLink\|IssuedLinkRow\|PromotionIssueLog\|isAlreadyIssued\|recordIssue\|removeIssueLog\|removeAllIssueLogs" apps/medusa/src apps/medusa/integration-tests`

Expected: Task 4~9 를 마쳤다면 남은 것은 `service.ts` 의 정의부와 `detach-coupon-campaigns.ts` 뿐이다. 라우트에 아직 남아 있으면 **그 라우트가 아직 안 고쳐진 것이다** — 앞 태스크로 돌아간다.

- [ ] **Step 2: 파일과 메서드를 지운다**

- `rm apps/medusa/src/modules/promotion-meta/issued-link.ts`
- `rm apps/medusa/src/modules/promotion-meta/models/promotion-issue-log.ts`
- `service.ts` — `PromotionIssueLog` import 와 `MedusaService({...})` 목록에서 제거, `isAlreadyIssued`·`recordIssue`·`removeIssueLog`·`removeAllIssueLogs` 메서드 제거
- `detach-coupon-campaigns.ts` — `removeAllIssueLogs` 등을 부르는 자리가 있으면 grant 기준으로 바꾸거나 제거

- [ ] **Step 3: 백필 스크립트 작성**

`apps/medusa/src/scripts/backfill-coupon-grants.ts`

```ts
import type { ExecArgs } from '@medusajs/framework/types';
import { ContainerRegistrationKeys, Modules } from '@medusajs/framework/utils';
import { PROMOTION_META_MODULE } from '../modules/promotion-meta';
import type PromotionMetaModuleService from '../modules/promotion-meta/service';
import type { IssueTrigger } from '../modules/promotion-meta/service';

const CONFIRM_VALUE = 'backfill-coupon-grants';

/**
 * 기존 customer↔promotion 링크 행을 `coupon_grant` 1장씩으로 이관한다 (1회용).
 *
 * 왜 마이그레이션이 아닌가: 링크 테이블의 **실제 이름이 우리 소스에 없다.** 부팅 시
 * `medusa db:migrate --execute-safe-links` 가 만들고 마이그레이션 파일이 남지 않는다.
 * 추측한 이름으로 SQL 을 쓰면 배포 중에 죽는다. 링크 «모듈 API» 를 쓰면 이름을 몰라도 된다
 * (`backfill-issued-count.ts` 와 같은 패턴).
 *
 * `issue_key` 는 결정적으로 만든다 — 원본이 복합 PK 라 (쿠폰, 고객) 쌍마다 정확히 한 행이고
 * 유니크는 그 쌍에 키를 더한 삼중이므로, 관리자 발급분은 `'legacy'` 고정으로 충분하다.
 * 이후 관리자 발급은 제출 UUID 키를 쓰므로 `'legacy'` 와 절대 충돌하지 않는다.
 *
 * 멱등하다 — 같은 키로 두 번 돌리면 유니크가 막아 `duplicate` 로 건너뛴다.
 *
 * 사용:
 *   dry-run(기본):  medusa exec ./src/scripts/backfill-coupon-grants.ts
 *   실제 반영:      GRANT_BACKFILL_DRY_RUN=false GRANT_BACKFILL_CONFIRM=backfill-coupon-grants \
 *                   medusa exec ./src/scripts/backfill-coupon-grants.ts
 */
export default async function backfillCouponGrants({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const link = container.resolve(ContainerRegistrationKeys.LINK);
  const promotionMetaService = container.resolve<PromotionMetaModuleService>(PROMOTION_META_MODULE);

  const dryRun = process.env.GRANT_BACKFILL_DRY_RUN !== 'false';
  if (!dryRun && process.env.GRANT_BACKFILL_CONFIRM !== CONFIRM_VALUE) {
    throw new Error(`Set GRANT_BACKFILL_CONFIRM=${CONFIRM_VALUE} when GRANT_BACKFILL_DRY_RUN=false`);
  }

  const linkModule = (link as any).getLinkModule(
    Modules.CUSTOMER,
    'customer_id',
    Modules.PROMOTION,
    'promotion_id',
  );

  const rows = (await linkModule.list(
    {},
    { select: ['customer_id', 'promotion_id', 'created_at', 'expires_at', 'used_at', 'order_id', 'issued_via'] },
  )) as any[];

  logger.info(`[grant-backfill] mode=${dryRun ? 'dry-run' : 'write'} links=${rows.length}`);

  let created = 0;
  let duplicate = 0;
  for (const l of rows) {
    const issuedVia: IssueTrigger = (l.issued_via as IssueTrigger) ?? 'admin_manual';
    const issueKey =
      issuedVia === 'customer_claim'
        ? 'claim'
        : issuedVia === 'customer_registered' || issuedVia === 'membership_activated'
        ? `trigger:${issuedVia}`
        : 'legacy';

    if (dryRun) {
      logger.info(
        `[grant-backfill] would create promotion=${l.promotion_id} customer=${l.customer_id} key=${issueKey}`,
      );
      created++;
      continue;
    }

    const result = await promotionMetaService.issueGrant({
      promotion_id: l.promotion_id,
      customer_id: l.customer_id,
      issue_key: issueKey,
      issued_via: issuedVia,
      expires_at: l.expires_at ? new Date(l.expires_at) : null,
      now: l.created_at ? new Date(l.created_at) : new Date(),
    });
    if (result === 'duplicate') {
      duplicate++;
      continue;
    }
    created++;

    // 옛 링크가 이미 사용된 장이었다면 사용 기록도 옮긴다.
    if (l.used_at) {
      const mine = await promotionMetaService.listCouponGrants({
        promotion_id: l.promotion_id,
        customer_id: l.customer_id,
        issue_key: issueKey,
      });
      if (mine[0]) {
        await promotionMetaService.consumeGrant(mine[0].id, l.order_id ?? 'legacy', new Date(l.used_at));
      }
    }
  }

  logger.info(
    `[grant-backfill] done mode=${dryRun ? 'dry-run' : 'write'} created=${created} duplicate=${duplicate}`,
  );
}
```

- [ ] **Step 4: 게이트를 돌려 참조가 없음을 확인한다**

Run: `npm run type-check`
Expected: 에러 0

Run: `scripts/local/run-medusa-integration.sh --testPathPattern 'coupon-'`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add -A apps/medusa/src/modules/promotion-meta apps/medusa/src/scripts
git commit -m "refactor(coupon): issued-link·promotion_issue_log 코드 철거 + 그랜트 백필 스크립트 (#488)"
```

---

## Task 11: admin-web — 발급 대상 파싱 순수 함수

**Files:**
- Create: `apps/admin-web/src/features/mall/marketing/coupons/lib/parse-issue-targets.ts`
- Test: `apps/admin-web/src/features/mall/marketing/coupons/lib/parse-issue-targets.spec.ts`

**Interfaces:**
- Produces: `parseIssueTargets(raw: string): string[]` · `summarizeIssueResult(result, resolved): IssueSummary`. Task 12 의 다이얼로그가 이 이름을 쓴다.

🔴 **다이얼로그가 `.tsx` 라 그 안의 로직은 jest transform 밖이다.** 판정을 여기 두지 않으면 검증되지 않는다.

- [ ] **Step 1: 실패하는 유닛 테스트 작성**

```ts
import { parseIssueTargets, summarizeIssueResult } from './parse-issue-targets';

describe('parseIssueTargets', () => {
  it('개행과 쉼표로 나눈다', () => {
    expect(parseIssueTargets('alice\nbob, carol')).toEqual(['alice', 'bob', 'carol']);
  });

  it('공백을 다듬고 빈 줄을 버린다', () => {
    expect(parseIssueTargets('  alice  \n\n\n bob \n')).toEqual(['alice', 'bob']);
  });

  it('중복을 제거하되 순서를 지킨다', () => {
    expect(parseIssueTargets('bob\nalice\nbob')).toEqual(['bob', 'alice']);
  });

  it('대소문자가 다른 같은 값은 다른 값으로 둔다 — 로그인아이디는 대소문자를 구분할 수 있다', () => {
    expect(parseIssueTargets('Alice\nalice')).toEqual(['Alice', 'alice']);
  });

  it('빈 입력은 빈 배열이다', () => {
    expect(parseIssueTargets('   \n  ')).toEqual([]);
  });
});

describe('summarizeIssueResult', () => {
  const resolved = [
    { input: 'alice', customerId: 'cus_1', label: 'alice@x.com' },
    { input: 'bob', customerId: 'cus_2', label: 'bob@x.com' },
  ];

  it('발급된 장수를 합산한다', () => {
    const s = summarizeIssueResult(
      { issued: [{ customer_id: 'cus_1', granted: 2 }], skipped: [] },
      resolved,
    );
    expect(s.grantedTotal).toBe(2);
    expect(s.succeeded).toEqual([{ label: 'alice@x.com', granted: 2 }]);
  });

  it('실패를 사유와 함께 라벨로 되돌린다', () => {
    const s = summarizeIssueResult(
      { issued: [], skipped: [{ customer_id: 'cus_2', reason: 'group_mismatch' }] },
      resolved,
    );
    expect(s.failed).toEqual([{ label: 'bob@x.com', reason: 'group_mismatch' }]);
  });

  it('응답에 없는 고객은 unknown 으로 남긴다 — 조용히 성공으로 세지 않는다', () => {
    const s = summarizeIssueResult({ issued: [], skipped: [] }, resolved);
    expect(s.failed).toEqual([
      { label: 'alice@x.com', reason: 'unknown' },
      { label: 'bob@x.com', reason: 'unknown' },
    ]);
  });
});
```

- [ ] **Step 2: 테스트를 돌려 실패를 확인한다**

Run: `cd apps/admin-web && npx jest --testPathPattern 'parse-issue-targets'`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: 구현**

```ts
/**
 * 발급 다이얼로그의 입력 파싱과 결과 집계 — **순수 함수**.
 *
 * 다이얼로그(`.tsx`)는 admin-web 의 jest transform(`^.+\.(t|j)s$`) 밖이라 그 안에 둔 로직은
 * 테스트가 실행조차 되지 않는다. 판정은 반드시 여기 있어야 한다.
 */

export type ResolvedTarget = { input: string; customerId: string; label: string };

export type IssueResponse = {
  issued: { customer_id: string; granted: number }[];
  skipped: { customer_id: string; reason: string }[];
};

export type IssueSummary = {
  grantedTotal: number;
  succeeded: { label: string; granted: number }[];
  failed: { label: string; reason: string }[];
};

/** 여러 줄 입력을 대상 목록으로. 개행·쉼표 구분, 공백 제거, 중복 제거(순서 유지). */
export function parseIssueTargets(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const token of (raw ?? '').split(/[\n,]/)) {
    const t = token.trim();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

/**
 * 서버 응답을 사람이 읽는 표로. **응답에 없는 고객은 `unknown` 으로 남긴다** —
 * 조용히 성공으로 세면 「발급됐다고 했는데 안 됐다」가 된다.
 */
export function summarizeIssueResult(
  result: IssueResponse,
  resolved: ResolvedTarget[],
): IssueSummary {
  const grantedById = new Map(result.issued.map((i) => [i.customer_id, i.granted]));
  const reasonById = new Map(result.skipped.map((s) => [s.customer_id, s.reason]));

  const succeeded: IssueSummary['succeeded'] = [];
  const failed: IssueSummary['failed'] = [];

  for (const target of resolved) {
    const granted = grantedById.get(target.customerId);
    if (granted != null) {
      succeeded.push({ label: target.label, granted });
      continue;
    }
    failed.push({ label: target.label, reason: reasonById.get(target.customerId) ?? 'unknown' });
  }

  return {
    grantedTotal: succeeded.reduce((s, x) => s + x.granted, 0),
    succeeded,
    failed,
  };
}
```

- [ ] **Step 4: 테스트를 돌려 통과를 확인한다**

Run: `cd apps/admin-web && npx jest --testPathPattern 'parse-issue-targets'`
Expected: PASS (9 tests)

- [ ] **Step 5: 커밋**

```bash
git add apps/admin-web/src/features/mall/marketing/coupons/lib/parse-issue-targets.ts \
        apps/admin-web/src/features/mall/marketing/coupons/lib/parse-issue-targets.spec.ts
git commit -m "feat(admin-web): 발급 대상 파싱·결과 집계 순수 함수 (#488)"
```

---

## Task 12: admin-web — 발급 다이얼로그 재설계

**Files:**
- Modify: `apps/admin-web/src/lib/api/domains/medusa/promotions.ts`
- Modify: `apps/admin-web/src/lib/services/coupons/mutations.ts`
- Modify: `apps/admin-web/src/features/mall/marketing/coupons/components/coupon-assign-dialog.tsx`
- Modify: `apps/admin-web/src/features/mall/marketing/coupons/components/coupon-customers-dialog.tsx`

**Interfaces:**
- Consumes: `POST /admin/promotions/:id/customers` (Task 9), `parseIssueTargets` · `summarizeIssueResult` (Task 11)
- Consumes: `GET {USER_SERVICE}/admin/users?q=` (기존), `GET /admin/customers/by-almond-user/:id` (기존)

- [ ] **Step 1: API 클라이언트에 대량 발급을 더한다**

`lib/api/domains/medusa/promotions.ts`:

```ts
  /** 쿠폰 1개를 고객 N명에게. `submitId` 가 따닥·재시도를 멱등하게 만든다. */
  bulkIssue: async (
    promotionId: string,
    customerIds: string[],
    quantity: number,
    submitId: string,
    force = false,
  ): Promise<BulkIssueResult> => {
    const res = await client.post<BulkIssueResult>(
      `${MEDUSA_BASE_URL}/admin/promotions/${promotionId}/customers`,
      { customer_ids: customerIds, quantity, submit_id: submitId, force },
    );
    return res.data;
  },
```

타입도 같은 파일에 더한다:

```ts
export interface BulkIssueResult {
  promotion_id: string;
  issued: { customer_id: string; granted: number }[];
  skipped: { customer_id: string; reason: string }[];
  force: boolean;
}
```

`lib/services/coupons/mutations.ts` 에 훅을 더한다 (`useAssignCoupon` 은 남긴다 — 고객 상세 축에서 계속 쓸 수 있다):

```ts
export const useBulkIssueCoupon = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ promotionId, customerIds, quantity, submitId, force }: {
      promotionId: string; customerIds: string[]; quantity: number; submitId: string; force?: boolean;
    }) => medusaPromotionsApi.bulkIssue(promotionId, customerIds, quantity, submitId, force),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: couponQueryKeys.all });
    },
  });
};
```

- [ ] **Step 2: 다이얼로그를 다시 쓴다**

`coupon-assign-dialog.tsx` 의 상태와 흐름:

```tsx
  const [raw, setRaw] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [resolved, setResolved] = useState<ResolvedTarget[]>([]);
  const [unresolved, setUnresolved] = useState<{ input: string; reason: string }[]>([]);
  const [summary, setSummary] = useState<IssueSummary | null>(null);

  // 🔴 제출 식별자는 «제출 시작» 때 만들어 ref 에 보관한다. 실패 재시도는 같은 값을 쓰고,
  //    성공하면 버린다. 이게 없으면 타임아웃 후 재제출이 곧 두 배 발급이다.
  //    (버튼 disabled 는 방어가 아니다 — 렌더 사이 연타도, 네트워크 재시도도 못 막는다.)
  const submitIdRef = useRef<string | null>(null);
```

조회 단계:

```tsx
  const handleResolve = async () => {
    const targets = parseIssueTargets(raw);
    const ok: ResolvedTarget[] = [];
    const bad: { input: string; reason: string }[] = [];

    for (const input of targets) {
      try {
        // 🔴 새 엔드포인트를 만들지 말 것 — `q` 하나가 loginId·email·username·nickname·전화를
        //    모두 ilike 검색한다(user-service `users.service.ts:66-70`). 이 클라이언트도 이미 있다.
        const users = await customerApi.getCustomersWithPagination({ q: input, limit: 2 });
        if (!users.data?.length) { bad.push({ input, reason: '회원을 찾을 수 없습니다' }); continue; }
        if (users.data.length > 1) { bad.push({ input, reason: '두 명 이상 일치합니다' }); continue; }

        const user = users.data[0];
        // `medusaCustomerApi.getCustomerByAlmondUserId` 도 이미 있다 — 새로 만들지 말 것.
        // almond_user_id 가 없는 계정은 여기서 404 다(연동 안 된 계정). 이메일로 다시
        // 시도하면 잡히는 경우가 있으므로 사유를 그렇게 안내한다.
        const customer = await medusaCustomerApi.getCustomerByAlmondUserId(user.id);
        ok.push({ input, customerId: customer.id, label: `${user.loginId} (${user.email})` });
      } catch {
        bad.push({ input, reason: '쇼핑몰 계정과 연결되지 않았습니다 (이메일로 다시 시도해 보세요)' });
      }
    }
    setResolved(ok);
    setUnresolved(bad);
    setSummary(null);
  };
```

제출 단계:

```tsx
  const handleIssue = async (force = false) => {
    if (resolved.length === 0) return;
    if (!submitIdRef.current) submitIdRef.current = crypto.randomUUID();

    try {
      const result = await bulkIssue.mutateAsync({
        promotionId,
        customerIds: resolved.map((r) => r.customerId),
        quantity,
        submitId: submitIdRef.current,
        force,
      });
      const s = summarizeIssueResult(result, resolved);
      setSummary(s);
      if (s.failed.length === 0) {
        toast.success(`${s.succeeded.length}명에게 ${s.grantedTotal}장 발급했습니다.`);
        submitIdRef.current = null; // 다음 제출은 새 키
      }
    } catch (e: any) {
      // 🔴 재시도는 같은 submitIdRef 를 쓴다 — 여기서 초기화하지 말 것.
      toast.error(e?.response?.data?.message ?? '쿠폰 발급에 실패했습니다.');
    }
  };
```

UI 는 ① 여러 줄 textarea + 「조회」 버튼 ② 수량 입력 ③ 해석 결과(성공/미해결) 표 ④ 「발급」 버튼 ⑤ 결과 표(성공 장수 / 실패 사유는 기존 `skipReasonLabel` 로 라벨링) 순으로 둔다.

- [ ] **Step 3: 발급 현황 다이얼로그에 장수를 싣는다**

`coupon-customers-dialog.tsx` 의 테이블에 `granted_count` · `used_count` · `usable_count` · `next_expires_at` 열을 더한다. 회수 확인 문구는 「N장을 회수합니다」로 바꾼다.

- [ ] **Step 4: 게이트를 돌린다**

Run: `cd apps/admin-web && npx tsc --noEmit`
Expected: 에러 0 (🔴 루트 `npm run type-check` 는 admin-web 을 제외한다 — 이 명령이 유일한 타입 게이트다)

Run: `cd apps/admin-web && npx jest`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add apps/admin-web/src
git commit -m "feat(admin-web): 로그인아이디로 여러 명·여러 장 발급 (#488)"
```

---

## Task 13: admin-web — 「1인당 사용 횟수 제한」 제거

**Files:**
- Modify: `apps/admin-web/src/features/mall/marketing/coupons/lib/build-create-promotion-payload.ts`
- Modify: `apps/admin-web/src/features/mall/marketing/coupons/lib/build-create-promotion-payload.spec.ts`
- Modify: `apps/admin-web/src/features/mall/marketing/coupons/lib/build-create-promotion-payload.integration.spec.ts`
- Modify: `apps/admin-web/src/features/mall/marketing/coupons/components/coupon-create-dialog.tsx`

**Interfaces:**
- Produces: `CouponFormState` 에서 `maxUsesPerCustomer` 제거. 이 타입을 쓰는 곳은 다이얼로그와 두 spec 뿐이다.

- [ ] **Step 1: 실패하는 테스트로 계약을 바꾼다**

`build-create-promotion-payload.spec.ts` 에서 `maxUsesPerCustomer` 를 쓰는 케이스를 지우고, 대신 추가한다:

```ts
  it('총 할인금액 한도만으로 캠페인 예산을 만든다 — 이제 1인당 한도와 다투지 않는다', () => {
    const payload = buildCreatePromotionPayload(
      { ...baseForm, spendLimit: 5_000_000, discountType: 'percentage', value: 10 },
      { campaignSuffix: 'x' },
    );
    expect(payload.campaign?.budget).toEqual({
      type: 'spend', limit: 5_000_000, currency_code: 'krw',
    });
    // 정률이라도 spend 예산을 쓰면 엔진이 통화 일치를 요구한다.
    expect(payload.application_method.currency_code).toBe('krw');
  });

  it('총 할인금액 한도와 전역 사용 횟수는 함께 설정된다', () => {
    const payload = buildCreatePromotionPayload(
      { ...baseForm, spendLimit: 1_000_000, usageLimit: 100 },
      { campaignSuffix: 'x' },
    );
    expect(payload.limit).toBe(100);
    expect(payload.campaign?.budget?.type).toBe('spend');
  });
```

- [ ] **Step 2: 테스트를 돌려 실패를 확인한다**

Run: `cd apps/admin-web && npx jest --testPathPattern 'build-create-promotion-payload'`
Expected: FAIL — `maxUsesPerCustomer` 가 없는 폼 상태가 타입 에러

- [ ] **Step 3: 구현**

`build-create-promotion-payload.ts`:
- `CouponFormState` 에서 `maxUsesPerCustomer` 필드 제거
- 「총 할인금액 한도와 1인당 사용 한도는 동시에 설정할 수 없습니다」 throw 제거
- `budget` 계산에서 `use_by_attribute` 분기 제거:

```ts
  // 1장 = 1회는 이제 coupon_grant 가 강제한다(설계 §5.3) — 캠페인 예산의 use_by_attribute 를
  // 쓰지 않으므로 예산 슬롯이 「총 할인금액 한도」 하나에게 온전히 돌아간다.
  const budget = form.spendLimit
    ? { type: 'spend' as const, limit: Number(form.spendLimit), currency_code: 'krw' }
    : undefined;
```

`coupon-create-dialog.tsx`:
- `maxUsesPerCustomer` 상태와 입력란 블록(`:513-522` 부근) 제거
- 폼 제출 payload 에서 그 필드 제거
- 그 자리에 안내를 둔다: 「쿠폰은 한 장당 1회만 사용됩니다. 여러 번 주려면 같은 쿠폰을 여러 장 발급하세요.」

- [ ] **Step 4: 테스트와 게이트를 돌린다**

Run: `cd apps/admin-web && npx jest --testPathPattern 'coupons'`
Expected: PASS

Run: `cd apps/admin-web && npx tsc --noEmit`
Expected: 에러 0

- [ ] **Step 5: 커밋**

```bash
git add apps/admin-web/src/features/mall/marketing/coupons
git commit -m "feat(admin-web): 1인당 사용 횟수 입력란 제거 — 1장=1회는 그랜트가 강제한다 (#488)"
```

---

## Task 14: 전체 게이트 + 배포 노트

**Files:**
- Create: `docs/superpowers/reports/2026-09-02-coupon-grant-deploy.md`

- [ ] **Step 1: 게이트 전량**

```bash
npm run type-check                    # 0
npx jest --maxWorkers=2               # 실패 0
cd apps/admin-web && npx tsc --noEmit # 0
cd apps/admin-web && npx jest         # 실패 0
cd apps/medusa && npx tsc --noEmit    # 선재 3건 외 증가 0
```

Run: `cd apps/medusa && npm run test:unit`
Expected: PASS

Run: `scripts/local/run-medusa-integration.sh --modules --testPathPattern 'promotion-meta'`
Expected: PASS

Run: `scripts/local/run-medusa-integration.sh --testPathPattern 'coupon-'`
Expected: PASS — **CI 는 이걸 안 돌린다. 여기가 유일한 방어선이다.**

- [ ] **Step 2: 어휘 드리프트 가드 확인**

Run: `npx jest --testPathPattern 'coupon-vocabulary-drift' --maxWorkers=2`
Expected: PASS — 어휘를 안 늘렸으므로 통과해야 정상이다. 빨개졌다면 `issued_via` 에 새 값을 넣은 것이다.

- [ ] **Step 3: 배포 노트 작성**

`docs/superpowers/reports/2026-09-02-coupon-grant-deploy.md` 에 아래를 적는다.

**배포 전 실측 (SQL 은 #488 코멘트에 남길 것):**

```sql
-- ① use_by_attribute 예산을 가진 활성 프로모션. 0이면 아무 조치도 필요 없다.
SELECT count(*) FROM promotion p
  JOIN campaign c ON c.id = p.campaign_id
  JOIN campaign_budget b ON b.campaign_id = c.id
 WHERE p.status = 'active' AND b.type = 'use_by_attribute';
```

0이 아니면 그 프로모션들은 엔진 예산과 grant 가 이중으로 제약한다(더 엄격한 쪽이 이긴다). 기능상 안전하나 관리자에게 설명되지 않는 거절이 생기므로 detach 를 검토한다.

**순서 (`migrate → deploy`, expand):**

1. `npm run db:migrate` — Medusa 는 컨테이너 CMD 가 자체 migrate 를 부르므로 별도 조치 불필요. **다만 `coupon_grant` 는 모듈 마이그레이션이라 새 태스크가 뜰 때 적용된다** — 즉 이 경우는 deploy 가 곧 migrate 다. 롤링 중 옛 태스크는 새 테이블을 모르고 링크만 보므로 안전하다.
2. `sst deploy`
3. **백필 1회** — dry-run 먼저:
   ```
   medusa exec ./src/scripts/backfill-coupon-grants.ts
   GRANT_BACKFILL_DRY_RUN=false GRANT_BACKFILL_CONFIRM=backfill-coupon-grants \
     medusa exec ./src/scripts/backfill-coupon-grants.ts
   ```
4. 백필 후 검증: `SELECT count(*) FROM coupon_grant;` 가 링크 행 수와 같은지

**배포 후 확인:**
- 발급 → 마이페이지에 장수 표시 → 주문 → 장 1개 소모 → 취소 → 장 복구
- 발급 버튼 따닥 → 장수가 안 늘어남

**남은 미지수(설계 §11):** 전액 환불이 `order.canceled` 없이 끝나는 경로 존재 여부 · `almond_user_id` 없는 라이브 고객 수 · `promotion_issue_log` DROP 은 별도 PR

- [ ] **Step 4: 커밋**

```bash
git add docs/superpowers/reports/2026-09-02-coupon-grant-deploy.md
git commit -m "docs(coupon): 그랜트 모델 배포 노트 (#488)"
```

---

## 이 플랜이 끝나도 남는 것

| 남는 것 | 이유 |
|---|---|
| `promotion_issue_log` **테이블** | expand-contract — 별도 PR |
| Medusa 링크 테이블과 그 `extraColumns` | 표시 조인으로 남긴다. 컬럼은 쓰지 않지만 drop 은 별도 PR |
| 발급 시 고객 알림 | 발급 3경로 전부 알림 0. 설계 범위 밖 — 별도 이슈 |
| 브라우저 수동 확인 | 새 발급 다이얼로그. #488 리허설 2차 몫 |
| **주문 완료·취소의 end-to-end 자동 테스트** | 결제 세션이 필요해 체크아웃 하네스를 새로 만들어야 한다. 대신 «어느 장을 고르나»(유닛)와 «고른 장이 어떻게 되나»(모듈 통합)를 각각 덮었다. **둘을 잇는 구간이 미검증이다** — 리허설 2차에 「2장 보유 → 주문 → 1장 소모 → 취소 → 복구」를 반드시 넣을 것 |
