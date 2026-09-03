# 쿠폰 소모 seam 이전 (PR-3) — 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 쿠폰 «소모»를 미문서 훅 `completeCartWorkflow.hooks.orderCreated` 에서 문서화된 `validate` 훅으로 옮기되, 소모가 곧 «검사»가 되게 하고(검사와 소모 사이 창 제거), 되돌림은 훅 보상으로, 소모의 키는 주문이 아니라 카트로 한다.

**Architecture:** `PromotionMetaModuleService` 에 `consumeOneUsableGrantForCart`(결과 `consumed|already|none`) · `restoreGrants(ids)`(되돌림의 유일한 본체) · `restoreGrantsByCart` · `listStuckConsumptions` 를 두고, `hooks/cart/complete-cart.ts` 의 `validate` 핸들러 **끝**에서 소모하고 두 번째 인자(보상)로 되돌린다. 취소 복원 구독자는 `order_cart` 링크로 카트를 찾는다. 프로세스 사망 창은 스케줄 잡(스위퍼)이 닫는다. `coupon_grant.cart_id` 컬럼 1개를 추가하고(additive), `order_id` 는 읽기·쓰기를 모두 끊되 컬럼은 남긴다(DROP 은 다음 배포 뒤 별도 PR).

**Tech Stack:** Medusa 2.13.4 (모듈 서비스 `MedusaService`, workflows-sdk 훅 보상 `hooks.validate(invoke, compensate)`, `StepResponse`), MikroORM `em.execute` 원시 SQL, Postgres, `@medusajs/test-utils` 모듈/HTTP 통합 러너(postgres+redis 필수), Medusa scheduled jobs.

**Spec:** `docs/adr/0034-coupon-issuance-writes-go-through-workflows.md` 의 **「2026-09-04 개정」 절** — 측정 1~8 · 결정 5~7 · 기각 · 증명 · 이행 순서가 이 계획의 경계다. 상위 이슈 #782.

## Global Constraints

- **마이그레이션은 additive 1건뿐** (`cart_id` 컬럼 + 파셜 인덱스). `order_id` 컬럼·인덱스·`idx_coupon_grant_issue_key` 는 건드리지 않는다. DROP 은 이 PR 에 넣지 않는다 — Medusa 컨테이너가 부팅하며 스스로 migrate 하므로 같은 PR 의 DROP 은 롤링 중 옛 태스크가 만난다.
- **`order_id` 는 어디서도 읽거나 쓰지 않는다** — 핫패스·복원·백필 스크립트·스펙 픽스처 전부. 폴백 없음(라이브에서 이 기능이 돈 적 없음, 2026-09-04 확인).
- **새 훅 등록 없음.** `completeCartWorkflow.hooks.validate(` 등록은 `complete-cart.ts` 의 한 줄뿐이다. `no-duplicate-validate-hooks.unit.spec.ts` 가 `/(\w+Workflow)\.hooks\.(\w+)\s*\(/g` 로 소스를 스캔한다 — 새 파일의 **주석에도** 그 패턴(식별자 + `.hooks.` + 훅이름 + `(`)을 적지 말 것.
- **훅 안에서 소모는 마지막이다.** 통관부호·멤버십·웰컴·캡 백스톱 등 다른 거절이 전부 지난 뒤에 소모 루프가 돈다. 소모 루프 안의 거절은 이번 호출이 잡은 장을 먼저 놓고 던진다(실패한 스텝 자신의 보상은 invoke 출력을 못 받는다 — ADR 측정 2).
- **훅 입력 카트의 고객 id 는 `cart.customer?.id ?? cart.customer_id ?? null`** 로 읽는다(`completeCartFields` 에 최상위 `customer_id` 가 없다 — ADR 측정 4).
- **소모 실패는 삼키지 않는다.** `try/catch` 로 감싸 로그만 남기던 옛 I1 정책은 결제 뒤 훅의 것이었다. `validate` 는 돈이 움직이기 전이다.
- **머신 토큰 그대로:** `COUPON_EXPIRED` · `COUPON_NOT_STARTED` · `'이 쿠폰은 발급된 고객만 사용할 수 있습니다.'`. 스토어프론트가 정확 일치로 본다.
- **게이트 명령(워크트리 루트에서, 단순 명령으로 — 세션 격리 검사기가 변수 치환·복합형을 거부한다):**
  - `npx tsc --noEmit -p apps/medusa/tsconfig.json` → **에러 3 이 기준선**(`src/admin/lib/sdk.ts` 2 · `src/api/store/orders/[id]/__tests__/confirm-purchase.unit.spec.ts` 1, 이 브랜치 무관). Task 1 Step 1 에서 재측정한다. 🔴 `npm --prefix apps/medusa exec -- tsc --noEmit` 은 루트 tsconfig 를 집어 0 을 낸다 — 쓰지 말 것. 🔴 `integration-tests/` 는 이 게이트 **밖**이다 — HTTP 스펙의 타입 오류는 실행에서만 드러난다.
  - `npm --prefix apps/medusa run test:unit` → Task 1 Step 1 에서 기준선(suites/tests) 기록.
  - `scripts/local/run-medusa-integration.sh --modules --testPathPattern promotion-meta` → 모듈 통합 스펙. Task 1 Step 1 에서 기준선 기록.
  - `scripts/local/run-medusa-integration.sh --testPathPattern coupon-consume` → HTTP 통합 스펙(패턴을 줘도 실제로는 전 스펙이 돈다 — 그대로 둔다).
  - docker compose 의 postgres(5432)·redis(6379) 가 떠 있어야 한다(현재 떠 있음). `apps/medusa/.env` 는 메인 체크아웃으로 심볼릭 링크돼 있다.
- **커밋 메시지 끝에** `Claude-Session: https://claude.ai/code/session_01WMT9N3JF3JeZr8p93Cxbtn` 트레일러. 브랜치 `feat/coupon-consume-seam`.
- 코드 주석은 주변 밀도를 따른다 — 이 모듈은 「왜」를 길게 적는 관례다. 🔴 표기는 어기면 실사고인 것에만.

---

### Task 1: `coupon_grant.cart_id` — 모델 · 마이그레이션 · 행 타입

**Files:**
- Modify: `apps/medusa/src/modules/promotion-meta/models/coupon-grant.ts`
- Create: `apps/medusa/src/modules/promotion-meta/migrations/Migration20260904120000.ts`
- Modify: `apps/medusa/src/modules/promotion-meta/service.ts` (`CouponGrantRow`)
- Modify: `apps/medusa/src/modules/promotion-meta/__tests__/grants.unit.spec.ts:22` · `apps/medusa/src/api/store/customers/me/promotions/__tests__/format-promotion.unit.spec.ts:215,227,251` (픽스처에 `cart_id: null` 추가)

**Interfaces:**
- Produces: `CouponGrantRow.cart_id: string | null` — Task 2~8 전부가 읽는다. DB 컬럼 `coupon_grant.cart_id text NULL` + 파셜 인덱스 `idx_coupon_grant_cart`.

- [ ] **Step 1: 기준선을 잰다**

Run (워크트리 루트):
```
npx tsc --noEmit -p apps/medusa/tsconfig.json
npm --prefix apps/medusa run test:unit
scripts/local/run-medusa-integration.sh --modules --testPathPattern promotion-meta
```
세 숫자(tsc 에러 수 · unit suites/tests · 모듈 통합 tests)를 커밋 메시지나 PR 본문 초안에 적어 둔다. tsc 는 3 이 기대값이다(전부 이 브랜치 무관 파일). 다르면 원인 파일을 먼저 적고 진행한다.

- [ ] **Step 2: 모델에 `cart_id` 와 인덱스를 더한다**

`models/coupon-grant.ts` 의 `used_at` 줄 아래를 이렇게 바꾼다:

```ts
      used_at: model.dateTime().nullable(),
      /**
       * 이 장을 소모한 «카트». 소모는 `completeCartWorkflow` 의 `validate` 훅에서 일어나고 그 시점엔
       * 주문이 없다 — 결정이 내려지는 순간에 존재하는 것이 키다 (ADR-0034 2026-09-04 개정, 결정 6).
       * 주문은 Medusa 의 `order_cart` 링크로 닿는다. 백필된 옛 장은 null 이다(카트가 없었다).
       */
      cart_id: model.text().nullable(),
      /** 옛 키. 읽기·쓰기 모두 끊겼다 — DROP 은 다음 배포 뒤 별도 PR (ADR-0034 결정 6, expand-contract). */
      order_id: model.text().nullable(),
```

인덱스 배열의 `idx_coupon_grant_order` 항목과 그 주석을 이렇게 바꾼다:

```ts
    // 옛 키의 인덱스. 컬럼과 함께 다음 배포 뒤 별도 PR 에서 지운다.
    { on: ['order_id'], name: 'idx_coupon_grant_order' },
    // `restoreGrantsByCart`(주문 취소) 와 스위퍼(`listStuckConsumptions`) 가 이 컬럼으로 조회한다.
    // 테이블은 발급 1건당 1행으로 자란다 — 인덱스 없이는 취소마다 풀스캔이다.
    { on: ['cart_id'], name: 'idx_coupon_grant_cart' },
```

- [ ] **Step 3: 마이그레이션을 만든다**

`migrations/Migration20260904120000.ts`:

```ts
import { Migration } from '@medusajs/framework/mikro-orm/migrations';

/**
 * `coupon_grant.cart_id` — 소모의 키를 주문에서 카트로 (ADR-0034 2026-09-04 개정, 결정 6).
 *
 * 소모가 `completeCartWorkflow` 의 `validate` 훅으로 옮겨가면 그 시점엔 주문 id 가 없다. 결정이
 * 내려지는 순간에 존재하는 것이 키다 — 카트. 취소 복원과 스위퍼가 이 컬럼으로 조회하므로
 * 인덱스를 같이 만든다(다른 인덱스와 같은 파셜 규약 — 모델의 DML 인덱스와 같은 인덱스다).
 *
 * `order_id` 는 여기서 건드리지 않는다 — expand 단계다. DROP 은 다음 배포 뒤 별도 PR.
 * Medusa 컨테이너는 부팅하며 스스로 migrate 하므로, 같은 PR 의 DROP 은 롤링 중 옛 태스크가 만난다.
 */
export class Migration20260904120000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`ALTER TABLE "coupon_grant" ADD COLUMN IF NOT EXISTS "cart_id" text NULL;`);
    this.addSql(
      `CREATE INDEX IF NOT EXISTS "idx_coupon_grant_cart" ON "coupon_grant" ("cart_id") WHERE "deleted_at" IS NULL;`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(`DROP INDEX IF EXISTS "idx_coupon_grant_cart";`);
    this.addSql(`ALTER TABLE "coupon_grant" DROP COLUMN IF EXISTS "cart_id";`);
  }
}
```

- [ ] **Step 4: 행 타입에 `cart_id` 를 더한다**

`service.ts` 의 `CouponGrantRow` 에서 `used_at` 줄 아래에 한 줄:

```ts
  used_at: Date | string | null;
  /** 이 장을 소모한 카트. 백필된 옛 장은 null. */
  cart_id: string | null;
  order_id: string | null;
```

- [ ] **Step 5: 타입체크로 깨진 픽스처를 찾고 고친다**

Run: `npx tsc --noEmit -p apps/medusa/tsconfig.json`
Expected: 기준선 3 + `grants.unit.spec.ts` · `format-promotion.unit.spec.ts` 의 `cart_id` 누락 에러.

`grants.unit.spec.ts:22` 의 `order_id: null,` 바로 위에 `cart_id: null,` 을, `format-promotion.unit.spec.ts` 의 `order_id: null,`(215·251) · `order_id: 'o1',`(227) 각각 바로 위에 `cart_id: null,` 을 넣는다(227 은 사용된 장이지만 옛 픽스처라 카트가 없다 — null 이 맞다).

Run: `npx tsc --noEmit -p apps/medusa/tsconfig.json`
Expected: 기준선 3.

- [ ] **Step 6: 모듈 통합 스펙이 그대로 초록인지 본다**

Run: `scripts/local/run-medusa-integration.sh --modules --testPathPattern promotion-meta`
Expected: Step 1 기준선과 같은 수, 전부 PASS(러너는 모델에서 스키마를 만들므로 새 컬럼이 자동으로 생긴다).

- [ ] **Step 7: 커밋**

```bash
git add apps/medusa/src/modules/promotion-meta/models/coupon-grant.ts apps/medusa/src/modules/promotion-meta/migrations/Migration20260904120000.ts apps/medusa/src/modules/promotion-meta/service.ts apps/medusa/src/modules/promotion-meta/__tests__/grants.unit.spec.ts apps/medusa/src/api/store/customers/me/promotions/__tests__/format-promotion.unit.spec.ts
git commit -m "feat(coupon): coupon_grant.cart_id — 소모의 키를 카트로 (PR-3 Task 1, additive 마이그)

Claude-Session: https://claude.ai/code/session_01WMT9N3JF3JeZr8p93Cxbtn"
```

---

### Task 2: 되돌림 본체 하나 — `restoreGrants(ids)` · `restoreGrantsByCart` · `consumeGrantIfUnused(id, cartId, usedAt)`

**Files:**
- Modify: `apps/medusa/src/modules/promotion-meta/service.ts` (`consumeGrantIfUnused` 서명 변경, `restoreGrantsByOrder` 삭제, `restoreGrants`·`restoreGrantsByCart` 추가, `revokeGrants` 독스트링의 `restoreGrantsByOrder` 언급 교체)
- Modify: `apps/medusa/src/modules/promotion-meta/__tests__/service.integration.spec.ts` (호출부 전부 + `restoreGrantsByOrder` 스펙 3개 이식 + `restoreGrants` 스펙 2개 신설)
- Modify: `apps/medusa/src/scripts/backfill-coupon-grants.ts:151-155`
- Modify (호출부 문자열만): `apps/medusa/integration-tests/http/coupon-admin.spec.ts` · `coupon-cart.spec.ts` · `coupon-store.spec.ts` · `coupon-grant.spec.ts`

**Interfaces:**
- Consumes: Task 1 의 `cart_id` 컬럼, `txEm(sharedContext)`, `(this as any).listCouponGrants`
- Produces:
  - `consumeGrantIfUnused(grantId: string, cartId: string | null, usedAt: Date, sharedContext?): Promise<boolean>` — 백필·스펙 픽스처의 원시 연산. `cartId` null = 카트가 없는 옛 장(백필).
  - `restoreGrants(ids: string[], sharedContext?): Promise<number>` — Task 5 훅 보상 · Task 6 구독자 · Task 7 스위퍼가 전부 이것을 지난다.
  - `restoreGrantsByCart(cartId: string, now: Date): Promise<number>` — Task 6 구독자가 부른다.

- [ ] **Step 1: 실패하는 스펙 — `restoreGrantsByCart` 셋과 `restoreGrants` 둘**

`service.integration.spec.ts` 의 `describe('coupon_grant', …)` 안에서 `it('restoreGrantsByOrder 는 만료되지 않은 장만 되살린다'`, `it('restoreGrantsByOrder 는 두 번 불려도 결과가 같다'` 두 개를 **통째로 지우고** 그 자리에 아래를 넣는다:

```ts
      it('restoreGrantsByCart 는 만료되지 않은 장만 되살린다', async () => {
        const past = new Date('2020-01-01T00:00:00.000Z');
        const future = new Date('2099-01-01T00:00:00.000Z');
        const base = {
          promotion_id: 'promo_restore',
          customer_id: 'cus_restore',
          issued_via: 'admin_manual' as const,
          issued_at: past,
          used_at: past,
          cart_id: 'cart_cancel',
        };
        await service.createCouponGrants([
          { ...base, issue_key: 'alive', expires_at: future },
          { ...base, issue_key: 'dead', expires_at: past },
        ]);

        const restored = await service.restoreGrantsByCart('cart_cancel', new Date());

        expect(restored).toBe(1);
        const rows = await service.listGrantsForCustomer('cus_restore');
        expect(rows.find((g) => g.issue_key === 'alive')?.used_at).toBeNull();
        expect(rows.find((g) => g.issue_key === 'alive')?.cart_id).toBeNull();
        expect(rows.find((g) => g.issue_key === 'dead')?.used_at).not.toBeNull();
      });

      it('restoreGrantsByCart 는 두 번 불려도 결과가 같다', async () => {
        const base = {
          promotion_id: 'promo_restore2',
          customer_id: 'cus_restore2',
          issue_key: 'k',
          issued_via: 'admin_manual' as const,
          issued_at: new Date(),
          used_at: new Date(),
          cart_id: 'cart_twice',
          expires_at: null,
        };
        await service.createCouponGrants([base]);

        expect(await service.restoreGrantsByCart('cart_twice', new Date())).toBe(1);
        expect(await service.restoreGrantsByCart('cart_twice', new Date())).toBe(0);
      });

      // ── ADR-0034 결정 6: 되돌림 본체는 하나다 ─────────────────────────────────────
      // 훅 보상(이번 실행이 잡은 id) · 취소 구독자(카트로 고른 id) · 스위퍼(조건으로 고른 id) 가
      // 전부 `restoreGrants(ids)` 를 지난다. 정책(만료·회수)은 고르는 쪽의 일이고 여기엔 없다.
      it('restoreGrants 는 id 목록 중 «사용된» 장만 되돌리고 그 수를 돌려준다 — 만료·회수는 보지 않는다', async () => {
        const past = new Date('2020-01-01T00:00:00.000Z');
        const base = {
          promotion_id: 'promo_undo',
          customer_id: 'cus_undo',
          issued_via: 'admin_manual' as const,
          issued_at: past,
        };
        await service.createCouponGrants([
          { ...base, issue_key: 'used', used_at: past, cart_id: 'cart_u' },
          { ...base, issue_key: 'expired_used', used_at: past, cart_id: 'cart_u', expires_at: past },
          { ...base, issue_key: 'unused' },
        ]);
        const rows = await service.listGrantsForCustomer('cus_undo');
        const ids = rows.map((g) => g.id);

        // 보상은 undo 다 — 만료된 장도 잡았던 그대로 놓는다(「사용됨」보다 「만료」가 진실에 가깝다).
        expect(await service.restoreGrants(ids)).toBe(2);

        const after = await service.listGrantsForCustomer('cus_undo');
        expect(after.every((g) => g.used_at == null && g.cart_id == null)).toBe(true);
        expect(await service.restoreGrants(ids)).toBe(0);
        expect(await service.restoreGrants([])).toBe(0);
      });

      it('restoreGrants 는 soft delete 된 장은 건드리지 않는다', async () => {
        await service.upsert({ promotion_id: 'promo_undo_del', max_claims: null });
        await issue('promo_undo_del', 'cus_undo_del', 'k1', null);
        const [g] = await service.listGrantsForPromotion('promo_undo_del');
        await service.revokeGrants('promo_undo_del', 'cus_undo_del'); // 미사용 → soft delete

        expect(await service.restoreGrants([g.id])).toBe(0);
      });
```

- [ ] **Step 2: 옛 호출부의 «주문» 문자열을 «카트» 로 바꾼다 (기계적)**

Run (워크트리 루트):
```
perl -pi -e "s/(consumeGrantIfUnused\([^,]+,\s*)(['\`])order_/\$1\$2cart_/g; s/restoreGrantsByOrder\((['\`])order_/restoreGrantsByCart(\$1cart_/g" apps/medusa/src/modules/promotion-meta/__tests__/service.integration.spec.ts apps/medusa/integration-tests/http/coupon-admin.spec.ts apps/medusa/integration-tests/http/coupon-cart.spec.ts apps/medusa/integration-tests/http/coupon-store.spec.ts apps/medusa/integration-tests/http/coupon-grant.spec.ts
```

그 다음 `service.integration.spec.ts` 에서 손으로 셋:
- `it('consumeGrantIfUnused 는 그 한 장에만 사용 기록을 남긴다'` 의 마지막 단언 `?.order_id).toBe('order_1')` → `?.cart_id).toBe('cart_1')`.
- `it('revokeGrants 는 이미 쓴 장을 남기고 remaining 으로 알린다'` 의 `expect(left[0].order_id).toBe('order_kept')` → `expect(left[0].cart_id).toBe('cart_kept')`.
- `describe('consumeGrantIfUnused'` 의 첫 it 마지막 단언 `expect(after.order_id).toBe('order_first')` → `expect(after.cart_id).toBe('cart_first')`.

Run: `grep -n "order_" apps/medusa/src/modules/promotion-meta/__tests__/service.integration.spec.ts`
Expected: `describe('consumeOneUsableGrant …')` 블록(Task 3 이 통째로 바꾼다) 안의 것만 남는다.

- [ ] **Step 3: 스펙이 실패하는지 본다**

Run: `scripts/local/run-medusa-integration.sh --modules --testPathPattern promotion-meta`
Expected: FAIL — `service.restoreGrantsByCart is not a function` · `service.restoreGrants is not a function`.

- [ ] **Step 4: 서비스를 고친다**

`service.ts` 에서 `consumeGrantIfUnused` 를 이렇게 바꾼다(독스트링의 「`order_id` 가 대롱대롱」 문장은 `cart_id` 로):

```ts
  /**
   * 고른 한 장을 소모한다 — **아직 미사용일 때만.** 실제로 소모했으면 `true`.
   *
   * 🔴 술어를 SQL 에 적는 것이 요점이다. 이전 구현은 조건 없는 `updateCouponGrants` 라,
   * 같은 고객이 두 카트를 동시에 완료하면 두 훅이 같은 장을 골라(선택은 결정적이다) 둘 다
   * 덮어썼다 — 한 장으로 할인 주문 두 건. 「1장 = 1회」는 애플리케이션 읽기-후-쓰기가 아니라
   * **한 문장**으로 집행한다(ADR-0034 결정 1).
   *
   * `cartId` 가 null 인 호출자는 백필뿐이다 — 옛 링크 행에는 카트가 없었다. 스위퍼는
   * `cart_id IS NOT NULL` 만 보므로 그런 장은 「주문 없는 소모」로 오판되지 않는다.
   *
   * 핫패스는 이 메서드가 아니라 `consumeOneUsableGrantForCart` 다 — 이건 id 를 아는 호출자
   * (백필·스펙)의 원시 연산이다.
   */
  async consumeGrantIfUnused(
    grantId: string,
    cartId: string | null,
    usedAt: Date,
    sharedContext?: Context<EntityManager>,
  ): Promise<boolean> {
    const rows = await this.txEm(sharedContext).execute(
      `UPDATE "coupon_grant" SET "used_at" = ?, "cart_id" = ?, "updated_at" = now()
       WHERE "id" = ? AND "used_at" IS NULL AND "deleted_at" IS NULL
       RETURNING "id"`,
      [usedAt, cartId, grantId],
    );
    return (rows?.length ?? 0) > 0;
  }
```

`restoreGrantsByOrder` 메서드(독스트링 포함)를 **지우고** 그 자리에:

```ts
  /**
   * 되돌림의 **유일한 본체** (ADR-0034 결정 6). id 목록 중 «사용된» 장만 미사용으로 되돌리고
   * 실제로 되돌린 장수를 돌려준다.
   *
   * 정책은 여기 없다 — 고르는 쪽의 일이다. 훅 보상은 이번 실행이 잡은 id 를 무조건 놓고(undo),
   * 취소 구독자는 `restoreGrantsByCart` 가 만료·회수를 걸러 넘기고, 스위퍼는
   * `listStuckConsumptions` 가 고른다. 셋이 각자 UPDATE 를 들면 PR-2 가 걷어낸 쌍둥이가 되돌아온다.
   *
   * `used_at IS NOT NULL` 술어 덕에 두 번 불려도 두 번째는 0 이다. `order_id` 는 만지지 않는다 —
   * 읽는 곳이 없고, 컬럼은 다음 배포 뒤 지운다.
   */
  async restoreGrants(ids: string[], sharedContext?: Context<EntityManager>): Promise<number> {
    if (ids.length === 0) return 0;
    const rows = await this.txEm(sharedContext).execute(
      `UPDATE "coupon_grant" SET "used_at" = NULL, "cart_id" = NULL, "updated_at" = now()
        WHERE "id" IN (?) AND "used_at" IS NOT NULL AND "deleted_at" IS NULL
        RETURNING "id"`,
      [ids],
    );
    return rows?.length ?? 0;
  }

  /**
   * 이 카트가 소모한 장들을 되돌린다 (A2 — 주문 취소). 되살린 장수.
   *
   * 주문 → 카트는 호출자(`subscribers/coupon-grant-restore.ts`)가 Medusa 의 `order_cart` 링크로
   * 푼다. 여기서는 고르기만 하고 되돌리는 것은 `restoreGrants` 다.
   * - **이미 만료된 장은 되살리지 않는다** — 되살려도 못 쓰고, 「돌아왔는데 못 쓴다」가 더 나쁘다.
   * - **회수된 장도 되살리지 않는다** — 어드민이 명시적으로 뺏은 쿠폰이 주문 취소로 돌아오면
   *   안 된다(설계 결정 3, `revoked_at`).
   */
  async restoreGrantsByCart(cartId: string, now: Date): Promise<number> {
    const rows = (await (this as any).listCouponGrants({ cart_id: cartId })) as CouponGrantRow[];
    const targets = rows.filter((g) => {
      if (g.used_at == null) return false;
      if (g.revoked_at != null) return false;
      if (g.expires_at == null) return true;
      const expiresAt = g.expires_at instanceof Date ? g.expires_at : new Date(g.expires_at);
      return !(now > expiresAt);
    });
    return this.restoreGrants(targets.map((g) => g.id));
  }
```

`revokeGrants` 독스트링의 「그 주문이 나중에 취소될 때 `restoreGrantsByOrder` 가」 → 「`restoreGrantsByCart` 가」로 바꾼다. 파일 안에 `restoreGrantsByOrder` 가 남지 않아야 한다.

- [ ] **Step 5: 백필 스크립트의 호출부를 고친다**

`scripts/backfill-coupon-grants.ts:151-155`:

```ts
        const consumed = await promotionMetaService.consumeGrantIfUnused(
          grant.id,
          // 옛 링크 행에는 카트가 없다 — null 로 둔다. 스위퍼는 cart_id 가 있는 장만 본다.
          null,
          new Date(l.used_at),
        );
```

바로 위 주석 블록의 마지막 문장 뒤에 한 줄을 더한다: `// \`order_id\` 는 옮기지 않는다 — 읽는 곳이 없고 컬럼은 다음 배포 뒤 지운다(ADR-0034 결정 6).`

- [ ] **Step 6: 스펙 통과 + 타입체크**

Run: `scripts/local/run-medusa-integration.sh --modules --testPathPattern promotion-meta`
Expected: 전부 PASS — Task 1 기준선 + 2. 옛 `consumeOneUsableGrant`(와 그 describe)는 이 Task 가 건드리지 않는다(Task 3 이 바꾼다).

Run: `npx tsc --noEmit -p apps/medusa/tsconfig.json`
Expected: 기준선 3.

- [ ] **Step 7: 커밋**

```bash
git add apps/medusa/src/modules/promotion-meta/service.ts apps/medusa/src/modules/promotion-meta/__tests__/service.integration.spec.ts apps/medusa/src/scripts/backfill-coupon-grants.ts apps/medusa/integration-tests/http/coupon-admin.spec.ts apps/medusa/integration-tests/http/coupon-cart.spec.ts apps/medusa/integration-tests/http/coupon-store.spec.ts apps/medusa/integration-tests/http/coupon-grant.spec.ts
git commit -m "refactor(coupon): 되돌림 본체 하나 restoreGrants(ids) — 취소 복원은 카트로, order_id 쓰기 중단 (PR-3 Task 2)

Claude-Session: https://claude.ai/code/session_01WMT9N3JF3JeZr8p93Cxbtn"
```

---

### Task 3: `consumeOneUsableGrantForCart` — 소모가 곧 검사다 (`consumed | already | none`)

**Files:**
- Modify: `apps/medusa/src/modules/promotion-meta/service.ts` (`consumeOneUsableGrant` 를 지우고 `ConsumeOutcome` 타입 + 새 메서드)
- Modify: `apps/medusa/src/modules/promotion-meta/__tests__/service.integration.spec.ts` (`describe('consumeOneUsableGrant …')` 블록 교체)

**Interfaces:**
- Consumes: Task 1 의 `cart_id`
- Produces:
  ```ts
  export type ConsumeOutcome =
    | { outcome: 'consumed'; grant_id: string }
    | { outcome: 'already'; grant_id: string }
    | { outcome: 'none' };
  consumeOneUsableGrantForCart(
    input: { promotion_id: string; customer_id: string; cart_id: string; now: Date },
    sharedContext?: Context<EntityManager>,
  ): Promise<ConsumeOutcome>
  ```
  Task 5 의 훅이 부른다. **옛 `consumeOneUsableGrant` 는 사라진다** — 유일한 호출자(`record-coupon-usage.ts`)는 Task 5 가 지운다(그때까지 tsc 에 그 파일 에러가 하나 뜬다).

- [ ] **Step 1: 실패하는 스펙 — describe 블록을 통째로 교체한다**

`service.integration.spec.ts` 에서 `// ── PR-2 결정 1: 소모는 모듈 안에서 …` 주석 네 줄부터 `describe('consumeOneUsableGrant — …', () => { … });` 의 닫힘까지를 아래로 바꾼다:

```ts
      // ── PR-2 결정 1 → PR-3 결정 5: 소모는 모듈 안에서 「고르기 + CAS」 한 문장이고, 그 문장이 곧 «검사»다 ──
      // 옛 구조는 훅이 장을 «읽어서 검사»하고(hasUsableGrant) 열 스텝 뒤 다른 훅이 «썼다». 그 사이가
      // 같은 고객의 두 카트가 장 하나로 둘 다 통과하는 창이었다. 이제 소모 결과가 판정이다:
      // consumed(잡았다) · already(이 카트가 이미 잡았다 — 재완료·재호출) · none(잡을 장이 없다 — 거절).
      describe('consumeOneUsableGrantForCart — 소모가 곧 검사다 (ADR-0034 결정 5)', () => {
        const NOW = new Date('2026-09-10T00:00:00.000Z');
        const seed = (
          promotionId: string,
          customerId: string,
          rows: Array<{ key: string; expires_at?: Date | null; issued_at?: Date; used_at?: Date | null; cart_id?: string | null }>,
        ) =>
          service.createCouponGrants(
            rows.map((r) => ({
              promotion_id: promotionId,
              customer_id: customerId,
              issue_key: r.key,
              issued_via: 'admin_manual' as const,
              issued_at: r.issued_at ?? new Date('2026-09-01T00:00:00.000Z'),
              expires_at: r.expires_at ?? null,
              used_at: r.used_at ?? null,
              cart_id: r.cart_id ?? null,
            })),
          );
        const consume = (promotionId: string, customerId: string, cartId: string, now = NOW) =>
          service.consumeOneUsableGrantForCart({ promotion_id: promotionId, customer_id: customerId, cart_id: cartId, now });
        const byKey = async (customerId: string) =>
          new Map((await service.listGrantsForCustomer(customerId)).map((g) => [g.issue_key, g]));

        it('FEFO — 만료가 이른 장을 먼저, 무기한은 맨 뒤', async () => {
          await seed('p_fefo', 'c_fefo', [
            { key: 'forever', expires_at: null },
            { key: 'late', expires_at: new Date('2026-12-31T00:00:00.000Z') },
            { key: 'soon', expires_at: new Date('2026-09-20T00:00:00.000Z') },
          ]);
          const grants = await byKey('c_fefo');
          expect(await consume('p_fefo', 'c_fefo', 'cart_1')).toEqual({ outcome: 'consumed', grant_id: grants.get('soon')!.id });
          expect(await consume('p_fefo', 'c_fefo', 'cart_2')).toEqual({ outcome: 'consumed', grant_id: grants.get('late')!.id });
          expect(await consume('p_fefo', 'c_fefo', 'cart_3')).toEqual({ outcome: 'consumed', grant_id: grants.get('forever')!.id });
          expect(await consume('p_fefo', 'c_fefo', 'cart_4')).toEqual({ outcome: 'none' });
        });

        it('FEFO 동률 — expires_at 이 같으면 issued_at 이 이른 장, 그것도 같으면 id 오름차순', async () => {
          const exp = new Date('2026-10-01T00:00:00.000Z');
          await seed('p_tie', 'c_tie', [
            { key: 'later_issued', expires_at: exp, issued_at: new Date('2026-09-02T00:00:00.000Z') },
            { key: 'earlier_issued', expires_at: exp, issued_at: new Date('2026-09-01T00:00:00.000Z') },
          ]);
          const grants = await byKey('c_tie');
          expect(await consume('p_tie', 'c_tie', 'cart_1')).toEqual({ outcome: 'consumed', grant_id: grants.get('earlier_issued')!.id });

          await seed('p_tie2', 'c_tie2', [
            { key: 'a', expires_at: exp },
            { key: 'b', expires_at: exp },
          ]);
          const same = await byKey('c_tie2');
          const [first] = [same.get('a')!.id, same.get('b')!.id].sort();
          expect(await consume('p_tie2', 'c_tie2', 'cart_1')).toEqual({ outcome: 'consumed', grant_id: first });
        });

        it('만료 경계는 포함이다 — expires_at == now 는 쓸 수 있고, 지난 장은 고르지 않는다', async () => {
          await seed('p_edge', 'c_edge', [
            { key: 'past', expires_at: new Date('2026-09-09T23:59:59.000Z') },
            { key: 'at_now', expires_at: NOW },
          ]);
          const grants = await byKey('c_edge');
          expect(await consume('p_edge', 'c_edge', 'cart_1')).toEqual({ outcome: 'consumed', grant_id: grants.get('at_now')!.id });
          expect(await consume('p_edge', 'c_edge', 'cart_2')).toEqual({ outcome: 'none' });
        });

        it('같은 카트로 다시 부르면 already 이고 같은 장이다 — 여분 장이 있어도 (재완료·재호출 멱등성)', async () => {
          // 완료된 카트의 재완료와 엔진의 재호출은 validate 를 다시 지난다(ADR 측정 1-②). 거절이 아니라 통과여야 한다.
          await seed('p_idem', 'c_idem', [{ key: 'a' }, { key: 'b' }]);
          const first = await consume('p_idem', 'c_idem', 'cart_same');
          expect(first.outcome).toBe('consumed');
          expect(await consume('p_idem', 'c_idem', 'cart_same')).toEqual({ outcome: 'already', grant_id: (first as { grant_id: string }).grant_id });
          expect((await consume('p_idem', 'c_idem', 'cart_other')).outcome).toBe('consumed');
          expect(await consume('p_idem', 'c_idem', 'cart_third')).toEqual({ outcome: 'none' });
        });

        it('발급받지 않은 프로모션·회수된 장·이미 쓴 장은 none', async () => {
          await seed('p_none', 'c_none', [
            { key: 'used', used_at: new Date('2026-09-02T00:00:00.000Z'), cart_id: 'cart_old' },
            { key: 'rev' },
          ]);
          await service.revokeGrantsByIssueKeys('p_none', 'c_none', ['rev']); // soft delete
          expect(await consume('p_none', 'c_none', 'cart_1')).toEqual({ outcome: 'none' });
          expect(await consume('p_never', 'c_none', 'cart_1')).toEqual({ outcome: 'none' });
        });

        it('소모한 장에만 used_at·cart_id 가 찍힌다', async () => {
          await seed('p_one', 'c_one', [{ key: 'a' }, { key: 'b' }]);
          const result = await consume('p_one', 'c_one', 'cart_one');
          const id = (result as { grant_id: string }).grant_id;
          const grants = await service.listGrantsForCustomer('c_one');
          const hit = grants.find((g) => g.id === id)!;
          const miss = grants.find((g) => g.id !== id)!;
          expect(hit.cart_id).toBe('cart_one');
          expect(hit.used_at).not.toBeNull();
          expect(miss.cart_id).toBeNull();
          expect(miss.used_at).toBeNull();
        });

        it('다른 트랜잭션이 잡은 장은 건너뛰고 다음 장을 소모한다 — SKIP LOCKED', async () => {
          // 두 카트 동시 완료의 결정적 재현: FEFO 만 보면 first 다. first 를 밖에서 잠가 두면
          // second 를 잡아야 하고, 락을 기다리지도 않아야 한다(300ms 안에 끝난다).
          await seed('p_lock', 'c_lock', [
            { key: 'first', expires_at: new Date('2026-09-15T00:00:00.000Z') },
            { key: 'second', expires_at: new Date('2026-09-16T00:00:00.000Z') },
          ]);
          const grants = await byKey('c_lock');
          const em = (service as any).baseRepository_.manager_;
          const holder = em.fork();
          await holder.begin();
          try {
            await holder.execute(`SELECT 1 FROM "coupon_grant" WHERE "id" = ? FOR UPDATE`, [grants.get('first')!.id]);
            let done = false;
            const consuming = consume('p_lock', 'c_lock', 'cart_race').then((r) => {
              done = true;
              return r;
            });
            await new Promise((r) => setTimeout(r, 300));
            expect(done).toBe(true); // 🔴 false 면 SKIP LOCKED 가 빠져 락을 기다리고 있다
            expect(await consuming).toEqual({ outcome: 'consumed', grant_id: grants.get('second')!.id });
          } finally {
            await holder.rollback();
          }
          // 락이 풀리면 first 는 여전히 미사용이라 다음 카트가 가져간다.
          expect(await consume('p_lock', 'c_lock', 'cart_next')).toEqual({ outcome: 'consumed', grant_id: grants.get('first')!.id });
        });
      });
```

- [ ] **Step 2: 실패 확인**

Run: `scripts/local/run-medusa-integration.sh --modules --testPathPattern promotion-meta`
Expected: 이 describe 7건 FAIL — `service.consumeOneUsableGrantForCart is not a function`.

- [ ] **Step 3: 서비스 — 옛 메서드를 새 메서드로 바꾼다**

`service.ts` 상단 타입 선언부(`IssueGrantWithSlotInput` 아래)에:

```ts
/** `consumeOneUsableGrantForCart` 의 결과. 소모가 곧 검사라 세 값이 곧 판정이다 (ADR-0034 결정 5). */
export type ConsumeOutcome =
  | { outcome: 'consumed'; grant_id: string }
  | { outcome: 'already'; grant_id: string }
  | { outcome: 'none' };
```

`consumeOneUsableGrant` 메서드(독스트링 포함)를 **지우고** 그 자리에:

```ts
  /**
   * 「이 카트에 쓸 장 한 장」을 **고르고 소모한다 — 한 문장으로.** 그리고 그 결과가 곧 판정이다.
   *
   * - `consumed` — 잡았다. 훅은 id 를 모아 보상의 입력으로 돌려준다.
   * - `already` — 이 카트가 이미 잡은 장이 있다. 완료된 카트의 재완료·엔진의 재호출이 여기로 온다
   *   (`completeCartWorkflow` 는 주문이 있어도 `validate` 를 다시 지난다). **통과**다.
   * - `none` — 잡을 장이 없다. 장이 사용을 지배하는 쿠폰이면 훅이 `COUPON_EXPIRED` 로 거절한다.
   *   늦은 카트가 여기로 온다 — 같은 고객의 두 카트가 장 하나로 둘 다 통과하던 창(재리뷰 F1)이
   *   이 값으로 닫힌다.
   *
   * 문장 둘이다. ① UPDATE 가 잡기(FEFO · 만료 경계 포함 · `FOR UPDATE SKIP LOCKED` — PR-2 그대로,
   * 키만 `cart_id`) ② 0행이면 «이 카트가 이미 잡은 장» 을 읽어 `already` 와 `none` 을 가른다.
   * ②가 읽기-후-판정인데도 안전한 이유: 같은 카트의 동시 호출은 워크플로가 카트 id 로 잡는
   * 락(`acquireLockStep`)이 직렬화한다. 다른 카트와의 경합은 ①이 정한다.
   *
   * 키가 주문이 아니라 카트인 이유: `validate` 시점엔 주문이 없다. 주문 → 카트는 Medusa 의
   * `order_cart` 링크가 안다(ADR-0034 결정 6).
   *
   * `sharedContext` 는 형제 원시 SQL 헬퍼와 같은 이유로 열어 둔다. `consumeGrantIfUnused(id)` 는
   * id 로 찍는 원시 연산으로 남는다(백필·스펙 픽스처). **핫패스(validate 훅)는 이 메서드만 부른다.**
   */
  async consumeOneUsableGrantForCart(
    input: { promotion_id: string; customer_id: string; cart_id: string; now: Date },
    sharedContext?: Context<EntityManager>,
  ): Promise<ConsumeOutcome> {
    const em = this.txEm(sharedContext);
    const consumed = await em.execute(
      `UPDATE "coupon_grant" SET "used_at" = ?, "cart_id" = ?, "updated_at" = now()
        WHERE "id" = (
          SELECT "id" FROM "coupon_grant"
           WHERE "promotion_id" = ? AND "customer_id" = ?
             AND "deleted_at" IS NULL AND "used_at" IS NULL
             AND ("expires_at" IS NULL OR "expires_at" >= ?)
             AND NOT EXISTS (
               SELECT 1 FROM "coupon_grant" o
                WHERE o."promotion_id" = ? AND o."customer_id" = ?
                  AND o."cart_id" = ? AND o."deleted_at" IS NULL)
           ORDER BY "expires_at" ASC NULLS LAST, "issued_at" ASC, "id" ASC
           LIMIT 1
           FOR UPDATE SKIP LOCKED)
        RETURNING "id"`,
      [
        input.now,
        input.cart_id,
        input.promotion_id,
        input.customer_id,
        input.now,
        input.promotion_id,
        input.customer_id,
        input.cart_id,
      ],
    );
    const consumedId = consumed?.[0]?.id;
    if (consumedId != null) return { outcome: 'consumed', grant_id: String(consumedId) };

    const already = await em.execute(
      `SELECT "id" FROM "coupon_grant"
        WHERE "promotion_id" = ? AND "customer_id" = ? AND "cart_id" = ?
          AND "used_at" IS NOT NULL AND "deleted_at" IS NULL
        ORDER BY "id" ASC
        LIMIT 1`,
      [input.promotion_id, input.customer_id, input.cart_id],
    );
    const alreadyId = already?.[0]?.id;
    if (alreadyId != null) return { outcome: 'already', grant_id: String(alreadyId) };

    return { outcome: 'none' };
  }
```

- [ ] **Step 4: 스펙 통과**

Run: `scripts/local/run-medusa-integration.sh --modules --testPathPattern promotion-meta`
Expected: 전부 PASS. 총 tests = Task 1 기준선 + 2(Task 2 의 `restoreGrants` 둘) + 1(이 describe 는 6 → 7).

Run: `npx tsc --noEmit -p apps/medusa/tsconfig.json`
Expected: 기준선 3 + `record-coupon-usage.ts` 의 `consumeOneUsableGrant` 없음 에러 1 (Task 5 가 그 파일을 지운다).

- [ ] **Step 5: 커밋**

```bash
git add apps/medusa/src/modules/promotion-meta/service.ts apps/medusa/src/modules/promotion-meta/__tests__/service.integration.spec.ts
git commit -m "feat(coupon): consumeOneUsableGrantForCart — 소모 결과가 곧 판정 consumed|already|none (PR-3 Task 3)

Claude-Session: https://claude.ai/code/session_01WMT9N3JF3JeZr8p93Cxbtn"
```

---

### Task 4: `listStuckConsumptions` — 스위퍼가 고를 후보

**Files:**
- Modify: `apps/medusa/src/modules/promotion-meta/service.ts` (`restoreGrantsByCart` 아래에 추가)
- Modify: `apps/medusa/src/modules/promotion-meta/__tests__/service.integration.spec.ts` (`restoreGrants` 스펙 둘 아래에 추가)

**Interfaces:**
- Produces: `listStuckConsumptions(usedBefore: Date, limit: number): Promise<Array<{ id: string; cart_id: string }>>` — Task 7 의 스위퍼가 부른다. 「주문이 있는가」 는 모듈 밖(`order_cart` 링크)의 질문이라 여기서는 후보만 고른다.

- [ ] **Step 1: 실패하는 스펙**

`it('restoreGrants 는 soft delete 된 장은 건드리지 않는다'` 바로 아래에:

```ts
      it('listStuckConsumptions 는 «카트가 있고, 쓰였고, 오래된» 장만 고른다 — 옛 장(cart_id null) 은 빼고', async () => {
        const old = new Date('2026-09-01T00:00:00.000Z');
        const recent = new Date('2026-09-10T00:00:00.000Z');
        const base = {
          promotion_id: 'promo_stuck',
          customer_id: 'cus_stuck',
          issued_via: 'admin_manual' as const,
          issued_at: old,
        };
        await service.createCouponGrants([
          { ...base, issue_key: 'old_with_cart', used_at: old, cart_id: 'cart_stuck_old' },
          { ...base, issue_key: 'recent_with_cart', used_at: recent, cart_id: 'cart_stuck_recent' },
          { ...base, issue_key: 'legacy_no_cart', used_at: old, cart_id: null },
          { ...base, issue_key: 'unused' },
        ]);
        const rows = await service.listGrantsForCustomer('cus_stuck');
        const oldId = rows.find((g) => g.issue_key === 'old_with_cart')!.id;

        const stuck = await service.listStuckConsumptions(new Date('2026-09-05T00:00:00.000Z'), 100);

        expect(stuck.filter((s) => s.cart_id.startsWith('cart_stuck_'))).toEqual([{ id: oldId, cart_id: 'cart_stuck_old' }]);
        expect(await service.listStuckConsumptions(new Date('2026-09-05T00:00:00.000Z'), 0)).toEqual([]);
      });
```

- [ ] **Step 2: 실패 확인**

Run: `scripts/local/run-medusa-integration.sh --modules --testPathPattern promotion-meta`
Expected: 1 FAIL — `service.listStuckConsumptions is not a function`.

- [ ] **Step 3: 구현**

`service.ts` 의 `restoreGrantsByCart` 아래에:

```ts
  /**
   * 스위퍼의 후보 — 카트가 잡았는데(`cart_id`) `usedBefore` 보다 오래된 «사용된» 장 (ADR-0034 결정 7).
   *
   * 훅이 커밋한 뒤 워크플로가 끝나기 전에 프로세스가 죽으면 «주문 없는 소모» 가 남는다. 보상은
   * 살아 있는 프로세스만 돌리므로 잡이 훑는다. 「주문이 있는가」 는 모듈 밖의 질문
   * (`order_cart` 링크·카트 `completed_at`)이라 여기서는 후보만 고르고, 판정과 되돌림은
   * `scripts/restore-stuck-coupon-consumptions.ts` 가 한다.
   *
   * `cart_id IS NOT NULL` — 백필된 옛 장은 카트가 없어 「주문 없는 소모」로 오판될 수 없다.
   */
  async listStuckConsumptions(usedBefore: Date, limit: number): Promise<Array<{ id: string; cart_id: string }>> {
    if (limit <= 0) return [];
    const rows = await this.txEm().execute(
      `SELECT "id", "cart_id" FROM "coupon_grant"
        WHERE "used_at" IS NOT NULL AND "cart_id" IS NOT NULL AND "deleted_at" IS NULL
          AND "used_at" < ?
        ORDER BY "used_at" ASC
        LIMIT ?`,
      [usedBefore, limit],
    );
    return (rows ?? []).map((r: { id: string; cart_id: string }) => ({ id: String(r.id), cart_id: String(r.cart_id) }));
  }
```

`txEm` 은 `sharedContext?` 가 선택 인자라(`service.ts:254`) 인자 없이 불러도 된다 — 기본 매니저로 떨어진다.

- [ ] **Step 4: 통과 확인 + 커밋**

Run: `scripts/local/run-medusa-integration.sh --modules --testPathPattern promotion-meta`
Expected: 전부 PASS.

```bash
git add apps/medusa/src/modules/promotion-meta/service.ts apps/medusa/src/modules/promotion-meta/__tests__/service.integration.spec.ts
git commit -m "feat(coupon): listStuckConsumptions — 주문 없는 소모의 후보 (PR-3 Task 4)

Claude-Session: https://claude.ai/code/session_01WMT9N3JF3JeZr8p93Cxbtn"
```

---

### Task 5: 훅 — `validate` 의 마지막에서 소모, 보상으로 되돌림, `orderCreated` 등록 삭제

**Files:**
- Create: `apps/medusa/src/workflows/hooks/cart/consume-coupon-grants.ts`
- Create: `apps/medusa/src/workflows/hooks/cart/__tests__/consume-coupon-grants.unit.spec.ts`
- Modify: `apps/medusa/src/workflows/hooks/cart/complete-cart.ts`
- Delete: `apps/medusa/src/workflows/hooks/cart/record-coupon-usage.ts`
- Modify (주석): `apps/medusa/src/modules/promotion-meta/grants.ts` 헤더, `apps/medusa/integration-tests/http/deferred-approval-checkout.spec.ts:539` 근처 주석

**Interfaces:**
- Consumes: Task 3 `consumeOneUsableGrantForCart` · Task 2 `restoreGrants`
- Produces:
  ```ts
  export type ConsumedCouponGrants = { cart_id: string; grant_ids: string[] };
  export type ConsumeRequest = { promotion_id: string; grants_govern: boolean };
  consumeCouponGrantsForCart(service, input: { cart_id; customer_id: string | null; now }, requests: ConsumeRequest[]): Promise<ConsumedCouponGrants>
  restoreConsumedCouponGrants(service, consumed: ConsumedCouponGrants | undefined): Promise<number>
  ```
  훅 보상 입력의 모양(`ConsumedCouponGrants`)은 Task 8 스펙이 간접 검증한다.

- [ ] **Step 1: 실패하는 단위 스펙**

`__tests__/consume-coupon-grants.unit.spec.ts`:

```ts
import { consumeCouponGrantsForCart, restoreConsumedCouponGrants } from '../consume-coupon-grants';

type Outcome = { outcome: 'consumed'; grant_id: string } | { outcome: 'already'; grant_id: string } | { outcome: 'none' };

function fakeService(script: Record<string, Outcome>) {
  const restored: string[][] = [];
  return {
    restored,
    consumeOneUsableGrantForCart: jest.fn(async ({ promotion_id }: { promotion_id: string }) => script[promotion_id] ?? { outcome: 'none' }),
    restoreGrants: jest.fn(async (ids: string[]) => {
      restored.push(ids);
      return ids.length;
    }),
  };
}

const input = { cart_id: 'cart_1', customer_id: 'cus_1', now: new Date('2026-09-10T00:00:00.000Z') };

describe('consumeCouponGrantsForCart — 훅의 마지막 문장', () => {
  it('잡은 장의 id 를 보상 입력으로 돌려준다', async () => {
    const service = fakeService({ p1: { outcome: 'consumed', grant_id: 'g1' }, p2: { outcome: 'consumed', grant_id: 'g2' } });
    const result = await consumeCouponGrantsForCart(service, input, [
      { promotion_id: 'p1', grants_govern: true },
      { promotion_id: 'p2', grants_govern: true },
    ]);
    expect(result).toEqual({ cart_id: 'cart_1', grant_ids: ['g1', 'g2'] });
    expect(service.restoreGrants).not.toHaveBeenCalled();
  });

  it('already 는 통과이고 보상 목록에 넣지 않는다 — 남의 실행이 잡은 장을 이번 실행이 놓으면 안 된다', async () => {
    const service = fakeService({ p1: { outcome: 'already', grant_id: 'g_prev' } });
    const result = await consumeCouponGrantsForCart(service, input, [{ promotion_id: 'p1', grants_govern: true }]);
    expect(result.grant_ids).toEqual([]);
  });

  it('장이 지배하는 쿠폰에 none 이면 이미 잡은 장을 먼저 놓고 COUPON_EXPIRED 로 던진다', async () => {
    const service = fakeService({ p1: { outcome: 'consumed', grant_id: 'g1' }, p2: { outcome: 'none' } });
    await expect(
      consumeCouponGrantsForCart(service, input, [
        { promotion_id: 'p1', grants_govern: true },
        { promotion_id: 'p2', grants_govern: true },
      ]),
    ).rejects.toMatchObject({ message: 'COUPON_EXPIRED' });
    expect(service.restored).toEqual([['g1']]);
  });

  it('장이 지배하지 않는(public) 쿠폰의 none 은 그냥 지나간다', async () => {
    const service = fakeService({ p1: { outcome: 'none' } });
    const result = await consumeCouponGrantsForCart(service, input, [{ promotion_id: 'p1', grants_govern: false }]);
    expect(result.grant_ids).toEqual([]);
  });

  it('비회원 카트는 소모하지 않는다', async () => {
    const service = fakeService({ p1: { outcome: 'consumed', grant_id: 'g1' } });
    const result = await consumeCouponGrantsForCart(service, { ...input, customer_id: null }, [{ promotion_id: 'p1', grants_govern: false }]);
    expect(result.grant_ids).toEqual([]);
    expect(service.consumeOneUsableGrantForCart).not.toHaveBeenCalled();
  });
});

describe('restoreConsumedCouponGrants — 훅 보상', () => {
  it('보상 입력의 id 를 전부 놓는다', async () => {
    const service = fakeService({});
    expect(await restoreConsumedCouponGrants(service, { cart_id: 'cart_1', grant_ids: ['g1', 'g2'] })).toBe(2);
    expect(service.restored).toEqual([['g1', 'g2']]);
  });

  it('입력이 없거나 비면(실패한 스텝 자신의 보상) 아무것도 하지 않는다', async () => {
    const service = fakeService({});
    expect(await restoreConsumedCouponGrants(service, undefined)).toBe(0);
    expect(await restoreConsumedCouponGrants(service, { cart_id: 'cart_1', grant_ids: [] })).toBe(0);
    expect(service.restoreGrants).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npm --prefix apps/medusa run test:unit -- --testPathPattern consume-coupon-grants`
Expected: FAIL — 모듈을 찾지 못한다.

- [ ] **Step 3: 헬퍼 구현**

`consume-coupon-grants.ts`:

```ts
import { MedusaError } from '@medusajs/framework/utils';
import type PromotionMetaModuleService from '../../../modules/promotion-meta/service';

/**
 * `completeCartWorkflow` 의 `validate` 훅 «마지막 문장» — 쿠폰 장의 소모 (ADR-0034 2026-09-04 개정, 결정 5·7).
 *
 * 소모가 곧 검사다. 옛 구조는 훅이 장을 «읽어서 검사»하고(`hasUsableGrant`) 열 스텝 뒤 미문서 훅이
 * «썼다». 그 사이가 같은 고객의 두 카트가 장 하나로 둘 다 통과하는 창이었다. 이제
 * `consumeOneUsableGrantForCart` 의 결과가 판정이다 — `none` 이고 장이 사용을 지배하면 거절.
 *
 * 🔴 **이 함수는 훅 핸들러의 마지막에 불려야 한다.** 다른 거절(통관부호·멤버십·캡 …)이 전부 지난
 * 뒤여야, 여기서 잡은 장을 놓아야 하는 경우가 «이 함수 안의 거절» 하나로 좁혀진다.
 *
 * 🔴 **거절할 때는 이번 호출이 잡은 장을 먼저 놓는다.** 실패한 스텝 자신의 보상은 invoke 출력을
 * 받지 못한다(`workflows-sdk` `create-step-handler.js` — `stepArguments.invoke[stepName]?.output`
 * 이 없으면 `undefined` 로 부른다). 뒤 스텝(주문 생성·재고예약·결제 승인)이 실패할 때만 훅
 * 보상(`restoreConsumedCouponGrants`)이 id 목록을 받아 되돌린다.
 *
 * 소모 실패(DB 오류)는 삼키지 않는다 — `validate` 는 돈이 움직이기 전이라 실패 = 주문 거절이고,
 * 그건 이미 `COUPON_EXPIRED` 가 하는 일이다. 옛 `orderCreated` 훅의 I1(「기록 실패로 결제된
 * 주문을 되돌리지 않는다」)은 결제 뒤 훅에 맞는 정책이었다.
 */
export type ConsumedCouponGrants = { cart_id: string; grant_ids: string[] };

/** 훅이 앞에서 모아 두는 판정 — 어느 쿠폰을, 장이 사용을 지배하는지(`grantsGovernUsage`)와 함께. */
export type ConsumeRequest = { promotion_id: string; grants_govern: boolean };

type ConsumeService = Pick<PromotionMetaModuleService, 'consumeOneUsableGrantForCart' | 'restoreGrants'>;

export async function consumeCouponGrantsForCart(
  service: ConsumeService,
  input: { cart_id: string; customer_id: string | null; now: Date },
  requests: ConsumeRequest[],
): Promise<ConsumedCouponGrants> {
  const grantIds: string[] = [];
  // 비회원 주문엔 발급 개념이 없다 — 소모할 장도 없다. 발급이 필요한 쿠폰은 훅 앞쪽이 이미 거절했다.
  if (!input.customer_id) return { cart_id: input.cart_id, grant_ids: grantIds };

  for (const request of requests) {
    const result = await service.consumeOneUsableGrantForCart({
      promotion_id: request.promotion_id,
      customer_id: input.customer_id,
      cart_id: input.cart_id,
      now: input.now,
    });
    if (result.outcome === 'consumed') {
      grantIds.push(result.grant_id);
      continue;
    }
    // `already` 는 이전 실행(완료된 카트의 재완료·엔진 재호출)이 잡은 장이다 — 통과이되 이번
    // 실행의 보상 목록엔 넣지 않는다. 남의 실행이 잡은 장을 이번 실행의 실패가 놓으면 안 된다.
    if (result.outcome === 'already') continue;
    if (request.grants_govern) {
      // 카트 미들웨어(`per-customer-limit`)와 같은 토큰 — 스토어프론트가 정확 일치로 본다.
      await service.restoreGrants(grantIds);
      throw new MedusaError(MedusaError.Types.INVALID_DATA, 'COUPON_EXPIRED');
    }
    // `public` 쿠폰(장이 지배하지 않음)의 `none` 은 소모할 장이 없을 뿐이다 — 정책이 정한다.
  }
  return { cart_id: input.cart_id, grant_ids: grantIds };
}

/** 훅 보상 — 뒤 스텝이 실패하면 이번 실행이 잡은 장을 전부 놓는다. 입력이 없으면(실패한 스텝 자신) 할 일이 없다. */
export async function restoreConsumedCouponGrants(
  service: Pick<PromotionMetaModuleService, 'restoreGrants'>,
  consumed: ConsumedCouponGrants | undefined,
): Promise<number> {
  if (!consumed || consumed.grant_ids.length === 0) return 0;
  return service.restoreGrants(consumed.grant_ids);
}
```

Run: `npm --prefix apps/medusa run test:unit -- --testPathPattern consume-coupon-grants`
Expected: 7 PASS.

- [ ] **Step 4: `complete-cart.ts` 를 고친다**

(a) import 를 더한다:

```ts
import { StepResponse } from '@medusajs/framework/workflows-sdk';
import { grantsFor, grantsGovernUsage } from '../../../modules/promotion-meta/grants';
import { consumeCouponGrantsForCart, restoreConsumedCouponGrants, type ConsumeRequest } from './consume-coupon-grants';
```

기존 `import { grantsFor, hasUsableGrant, grantsGovernUsage } from '../../../modules/promotion-meta/grants';` 줄은 위 줄로 **대체**한다(`hasUsableGrant` 는 더 쓰지 않는다).

(b) 핸들러 첫 줄 `const query = …` 바로 아래에:

```ts
  // 훅 입력 카트의 정본은 `customer.*` 다(`completeCartFields` 엔 최상위 `customer_id` 가 없다 —
  // ADR-0034 측정 4). 워크플로 자신도 `cart.customer?.id` 로 읽는다.
  const customerId: string | null = cart.customer?.id ?? cart.customer_id ?? null;
  const promotionMetaService = container.resolve<PromotionMetaModuleService>(PROMOTION_META_MODULE);
  // 소모는 훅의 «마지막» 이다(ADR-0034 결정 5). 앞에서는 판정만 모은다.
  const consumeRequests: ConsumeRequest[] = [];
```

(c) 쿠폰 블록을 이렇게 바꾼다 — `if (cartPromos.length) {` 부터 그 블록의 닫힘 `}` 까지 전체를 대체:

```ts
  if (cartPromos.length) {
    // 발급된 «한 장»들을 한 번에 가져온다 — 카트에 붙은 프로모션마다 조회하지 않는다.
    // 여기서 읽는 것은 «발급받았는가»(requiresIssuance) 와 «장이 사용을 지배하는가» 뿐이다.
    // «쓸 장이 있는가» 는 읽지 않는다 — 훅 끝의 소모가 그 검사다(읽고 검사한 뒤 쓰지 않는다, 결정 1).
    const grants: CouponGrantRow[] = customerId ? await promotionMetaService.listGrantsForCustomer(customerId) : [];

    for (const promo of cartPromos) {
      const meta = await promotionMetaService.getByPromotionId(promo.id);

      const mine = grantsFor(grants, promo.id);
      const now = new Date();

      // 🔴 정책 시작(`starts_at`)은 **장 유무 분기 밖**이다 — 장을 가진 고객에게만 `starts_at` 이
      // 사라지면 안 된다. 사유가 다르므로 토큰도 다르다(`COUPON_NOT_STARTED`) — 카트 미들웨어·preview
      // 와 같은 토큰이라 세 표면의 라벨이 일치한다.
      if (!hasPolicyStarted(meta, now)) {
        throw new MedusaError(MedusaError.Types.INVALID_DATA, 'COUPON_NOT_STARTED');
      }

      // 🔴 `public` 쿠폰은 장이 있어도 정책이 정한다 (#488 A2) — 카트 미들웨어와 «같은» 판정이어야
      // 한다. 장이 지배하면 만료·소모 판정은 훅 끝의 소모(`none` → COUPON_EXPIRED)가 한다.
      const grantsGovern = grantsGovernUsage(mine, resolveVisibility(meta));
      if (!grantsGovern && !isUsable(null, meta, now)) {
        throw new MedusaError(MedusaError.Types.INVALID_DATA, 'COUPON_EXPIRED');
      }

      // 메타가 없으면 «발급 필요» 다(닫힌 기본값 — #488 N7). 옛 코드는 undefined 라 백스톱도 통과했다.
      if (requiresIssuance(meta)) {
        if (!customerId || mine.length === 0) {
          throw new MedusaError(MedusaError.Types.INVALID_DATA, '이 쿠폰은 발급된 고객만 사용할 수 있습니다.');
        }
        // 발급은 받았는데 쓸 장이 없는 경우는 훅 끝의 소모가 거른다.
      }

      consumeRequests.push({ promotion_id: promo.id, grants_govern: grantsGovern });
    }
  }
```

(d) 핸들러의 나머지(캡 백스톱 · 이메일 백필 · 통관부호 · 멤버십 · 웰컴)는 그대로 두되, `cart.customer_id` 읽기 넷(이메일 백필 `if (!cart.email && cart.customer_id)` 와 `filters: { id: cart.customer_id }`, 멤버십 `if (cart.customer_id && membershipGroupId)` 와 `filters: { id: cart.customer_id }`, 웰컴 `if (cartHasWelcome && cart.customer_id)` 와 `filters: { customer_id: cart.customer_id }`)을 전부 `customerId` 로 바꾼다 — 같은 값이어야 하고, 측정 4 에 따라 `customerId` 쪽이 정본이다.

(e) 핸들러 끝 — 주석 처리된 옛 재고 블록(`// TEMP: 재고 부족 …` 부터 `// // 재고 부족이 없으면 통과` 까지)은 그대로 두고, 그 **아래·핸들러 닫힘 `}` 바로 앞**에:

```ts
  // ── 소모: 훅의 마지막 문장 (ADR-0034 결정 5). 위의 어떤 거절도 장을 잡은 뒤에 일어나지 않는다. ──
  const consumed = await consumeCouponGrantsForCart(
    promotionMetaService,
    { cart_id: cart.id, customer_id: customerId, now: new Date() },
    consumeRequests,
  );
  // 두 번째 인자(보상)의 입력이다 — 뒤 스텝이 실패하면 이번 실행이 잡은 장을 놓는다.
  return new StepResponse(undefined, consumed);
```

(f) 핸들러 등록의 닫힘 `});` 를 보상 인자를 받도록 바꾼다:

```ts
}, async (consumed, { container }) => {
  // 훅 보상 — 주문 생성·재고예약·결제 승인 중 어느 것이 실패해도 여기로 온다. 실패한 스텝이 이 훅
  // 자신이면 `consumed` 는 undefined 다(그 경우는 invoke 가 스스로 놓고 던졌다).
  const promotionMetaService = container.resolve<PromotionMetaModuleService>(PROMOTION_META_MODULE);
  await restoreConsumedCouponGrants(promotionMetaService, consumed);
});
```

(g) 옛 `const promotionMetaService = container.resolve<…>(PROMOTION_META_MODULE);` 가 `if (cartPromos.length) {` 블록 안에 남아 있으면 지운다(위 (b)에서 위로 올렸다). 파일 안에 `hasUsableGrant` 가 남지 않아야 한다.

- [ ] **Step 5: `record-coupon-usage.ts` 를 지우고 주석 둘을 고친다**

```bash
git rm apps/medusa/src/workflows/hooks/cart/record-coupon-usage.ts
```

`grants.ts` 헤더 주석의 「소비자는 6곳이다(2026-09-03, PR-2 가 소모 훅을 뺐다 — 소모는 `service.ts::consumeOneUsableGrant` 가 SQL 로 한다)」 를 「소비자는 6곳이다(2026-09-04, PR-3 — 체크아웃 백스톱은 `hasUsableGrant` 를 더 읽지 않는다: 소모(`service.ts::consumeOneUsableGrantForCart`)가 곧 검사다. `grantsFor`·`grantsGovernUsage` 는 여전히 쓴다)」 로 바꾼다.

`deferred-approval-checkout.spec.ts:539` 근처 주석의 `record-coupon-usage.ts` 언급을 `hooks/cart/complete-cart.ts 의 validate 훅(consume-coupon-grants.ts)` 로 바꾼다(문장 뜻이 「소모가 coupon_grant 로 옮겨갔다」 인지 확인하고 그 뜻을 유지).

- [ ] **Step 6: 게이트 셋**

Run: `npx tsc --noEmit -p apps/medusa/tsconfig.json`
Expected: 기준선 3(`record-coupon-usage.ts` 에러가 파일과 함께 사라진다). `complete-cart.ts` 의 보상 인자 타입이 안 맞으면 `StepResponse<undefined, ConsumedCouponGrants>` 를 명시한다 — `hooks.validate` 의 타입은 `<TCompensateInput>(invoke: InvokeFn<Input, Output, TCompensateInput>, compensate?: CompensateFn<TCompensateInput>)` 다.

Run: `npm --prefix apps/medusa run test:unit`
Expected: Task 1 기준선 + 7(consume-coupon-grants) − 0, 전부 PASS. `no-duplicate-validate-hooks.unit.spec.ts` 가 초록인지 특히 본다.

Run: `grep -rn "orderCreated\|consumeOneUsableGrant(" apps/medusa/src --include=*.ts`
Expected: 0건.

- [ ] **Step 7: 커밋**

```bash
git add apps/medusa/src/workflows/hooks/cart/consume-coupon-grants.ts apps/medusa/src/workflows/hooks/cart/__tests__/consume-coupon-grants.unit.spec.ts apps/medusa/src/workflows/hooks/cart/complete-cart.ts apps/medusa/src/modules/promotion-meta/grants.ts apps/medusa/integration-tests/http/deferred-approval-checkout.spec.ts
git commit -m "feat(coupon): 소모를 validate 훅의 마지막 문장으로 — 보상으로 되돌림, 미문서 orderCreated 등록 삭제 (PR-3 Task 5)

Claude-Session: https://claude.ai/code/session_01WMT9N3JF3JeZr8p93Cxbtn"
```

---

### Task 6: 취소 복원 구독자 — `order_cart` 링크 경유

**Files:**
- Modify: `apps/medusa/src/subscribers/coupon-grant-restore.ts`
- Modify: `apps/medusa/src/subscribers/__tests__/coupon-grant-restore.unit.spec.ts`

**Interfaces:**
- Consumes: Task 2 `restoreGrantsByCart(cartId, now)`; `query.graph({ entity: 'order_cart', fields: ['cart_id', 'order_id'], filters: { order_id } })`

- [ ] **Step 1: 단위 스펙을 새 계약으로 바꾼다**

`coupon-grant-restore.unit.spec.ts` 전체를 아래로 교체:

```ts
import handleCouponGrantRestore, { config } from '../coupon-grant-restore';

function makeContainer(service: any, links: Array<{ cart_id: string; order_id: string }> = []) {
  const logger = { info: jest.fn(), error: jest.fn() };
  const query = { graph: jest.fn().mockResolvedValue({ data: links }) };
  return {
    container: {
      resolve: (key: string) => {
        if (key === 'promotionMeta') return service;
        if (key === 'query') return query;
        return logger;
      },
    },
    logger,
    query,
  };
}

describe('coupon-grant-restore 구독자', () => {
  it('order.canceled 에 등록된다', () => {
    expect(config.event).toBe('order.canceled');
  });

  it('주문 → order_cart 링크 → 카트로 복구를 부른다', async () => {
    const service = { restoreGrantsByCart: jest.fn().mockResolvedValue(2) };
    const { container, query } = makeContainer(service, [{ cart_id: 'cart_1', order_id: 'order_1' }]);
    await handleCouponGrantRestore({ event: { data: { id: 'order_1' } }, container } as any);

    expect(query.graph).toHaveBeenCalledWith({
      entity: 'order_cart',
      fields: ['cart_id', 'order_id'],
      filters: { order_id: 'order_1' },
    });
    expect(service.restoreGrantsByCart).toHaveBeenCalledWith('cart_1', expect.any(Date));
  });

  it('링크가 없는 주문(옛 주문)은 복구 대상이 없다 — order_id 폴백은 없다', async () => {
    const service = { restoreGrantsByCart: jest.fn() };
    const { container, logger } = makeContainer(service, []);
    await handleCouponGrantRestore({ event: { data: { id: 'order_legacy' } }, container } as any);

    expect(service.restoreGrantsByCart).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('주문 id 가 없으면 아무것도 하지 않는다', async () => {
    const service = { restoreGrantsByCart: jest.fn() };
    const { container, query } = makeContainer(service);
    await handleCouponGrantRestore({ event: { data: {} }, container } as any);

    expect(query.graph).not.toHaveBeenCalled();
    expect(service.restoreGrantsByCart).not.toHaveBeenCalled();
  });

  it('복구가 실패해도 던지지 않는다 — 취소를 막으면 안 된다', async () => {
    const service = { restoreGrantsByCart: jest.fn().mockRejectedValue(new Error('db down')) };
    const { container, logger } = makeContainer(service, [{ cart_id: 'cart_2', order_id: 'order_2' }]);

    await expect(
      handleCouponGrantRestore({ event: { data: { id: 'order_2' } }, container } as any),
    ).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('cart_2'));
  });
});
```

Run: `npm --prefix apps/medusa run test:unit -- --testPathPattern coupon-grant-restore`
Expected: 3 FAIL(링크 조회·카트 복구·에러 메시지).

- [ ] **Step 2: 구독자 구현**

`coupon-grant-restore.ts` 전체를 아래로 교체:

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
 * 소모의 키는 주문이 아니라 **카트**다(ADR-0034 2026-09-04 개정, 결정 6) — 소모가 `validate` 훅에서
 * 일어나 그 시점엔 주문이 없다. 주문 → 카트는 Medusa 의 `order_cart` 링크가 안다. 링크가 없는
 * 주문(이 기능 개통 전의 옛 주문)은 되돌릴 장도 없다 — `order_id` 폴백은 두지 않는다(라이브에서
 * 이 기능이 돈 적 없음, 2026-09-04 확인).
 *
 * ⚠️ 이 워크플로 훅이 아니라 **구독자**인 이유: `order.canceled` 에는 이미 구독자가 둘 붙어
 * 있고(welcome-membership-order · membership-benefit-order), 구독자는 훅과 달리 개수 제한이 없다.
 *
 * ⚠️ 만료된 장·회수된 장은 되살리지 않는다 — `restoreGrantsByCart` 가 그 판정을 갖고 있다.
 */
export default async function handleCouponGrantRestore({
  event: { data },
  container,
}: SubscriberArgs<{ id: string }>) {
  const orderId = data?.id;
  if (!orderId) return;

  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const promotionMetaService = container.resolve<PromotionMetaModuleService>(PROMOTION_META_MODULE);

  let cartId: string | undefined;
  try {
    const { data: links } = await query.graph({
      entity: 'order_cart',
      fields: ['cart_id', 'order_id'],
      filters: { order_id: orderId },
    });
    cartId = (links?.[0] as { cart_id?: string } | undefined)?.cart_id;
    if (!cartId) {
      logger.info(`[coupon] 주문 취소 — 카트 링크 없음, 복구할 장 없음 (order_id=${orderId})`);
      return;
    }

    const restored = await promotionMetaService.restoreGrantsByCart(cartId, new Date());
    if (restored > 0) {
      logger.info(`[coupon] 주문 취소로 쿠폰 ${restored}장 복구 (order_id=${orderId}, cart_id=${cartId})`);
    }
  } catch (e: any) {
    // 복구 실패가 취소를 막아서는 안 된다. 다만 조용히 넘기면 고객이 쿠폰을 잃은 채 남는다.
    logger.error(
      `[coupon] 쿠폰 장 복구 실패 (order_id=${orderId}, cart_id=${cartId ?? '?'}): ${e?.message ?? e}. ` +
        'coupon_grant 에서 이 cart_id 를 찾아 used_at/cart_id 를 수동으로 비울 것.',
    );
  }
}

export const config: SubscriberConfig = {
  event: 'order.canceled',
  context: { subscriberId: 'coupon-grant-restore-handler' },
};
```

Run: `npm --prefix apps/medusa run test:unit -- --testPathPattern coupon-grant-restore`
Expected: 5 PASS.

- [ ] **Step 3: 커밋**

```bash
git add apps/medusa/src/subscribers/coupon-grant-restore.ts apps/medusa/src/subscribers/__tests__/coupon-grant-restore.unit.spec.ts
git commit -m "refactor(coupon): 취소 복원은 order_cart 링크 경유 — order_id 폴백 없음 (PR-3 Task 6)

Claude-Session: https://claude.ai/code/session_01WMT9N3JF3JeZr8p93Cxbtn"
```

---

### Task 7: 스위퍼 — 주문 없는 소모를 되돌리는 스크립트 + 매시 잡

**Files:**
- Create: `apps/medusa/src/scripts/restore-stuck-coupon-consumptions.ts`
- Create: `apps/medusa/src/scripts/__tests__/restore-stuck-coupon-consumptions.unit.spec.ts`
- Create: `apps/medusa/src/jobs/restore-stuck-coupon-consumptions.ts`

**Interfaces:**
- Consumes: Task 4 `listStuckConsumptions(usedBefore, limit)` · Task 2 `restoreGrants(ids)` · `query.graph` (`order_cart` by `cart_id[]`, `cart` by `id[]`)
- Produces: `restoreStuckCouponConsumptions(container, opts?: { minAgeMs?: number; limit?: number; now?: Date }): Promise<{ scanned: number; restored: number; kept: number }>` — Task 8 스펙 ⑥ 이 직접 부른다.

- [ ] **Step 1: 실패하는 단위 스펙**

`scripts/__tests__/restore-stuck-coupon-consumptions.unit.spec.ts` (디렉터리가 이미 있다 — `ls apps/medusa/src/scripts/__tests__` 로 확인):

```ts
import { restoreStuckCouponConsumptions } from '../restore-stuck-coupon-consumptions';

function makeContainer(opts: {
  stuck: Array<{ id: string; cart_id: string }>;
  links: Array<{ cart_id: string }>;
  carts: Array<{ id: string; completed_at: Date | null }>;
}) {
  const service = {
    listStuckConsumptions: jest.fn().mockResolvedValue(opts.stuck),
    restoreGrants: jest.fn(async (ids: string[]) => ids.length),
  };
  const query = {
    graph: jest.fn(async ({ entity }: { entity: string }) =>
      entity === 'order_cart' ? { data: opts.links } : { data: opts.carts },
    ),
  };
  const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  const container = {
    resolve: (key: string) => (key === 'promotionMeta' ? service : key === 'query' ? query : logger),
  } as any;
  return { container, service, query, logger };
}

describe('restoreStuckCouponConsumptions — 주문 없는 소모만 되돌린다', () => {
  it('order_cart 링크도 없고 카트도 완료되지 않은 소모만 되돌린다', async () => {
    const { container, service } = makeContainer({
      stuck: [
        { id: 'g_stuck', cart_id: 'cart_abandoned' },
        { id: 'g_ordered', cart_id: 'cart_with_order' },
        { id: 'g_completed', cart_id: 'cart_completed_no_link' },
      ],
      links: [{ cart_id: 'cart_with_order' }],
      carts: [
        { id: 'cart_abandoned', completed_at: null },
        { id: 'cart_with_order', completed_at: new Date() },
        { id: 'cart_completed_no_link', completed_at: new Date() },
      ],
    });

    const summary = await restoreStuckCouponConsumptions(container, { minAgeMs: 0 });

    expect(service.restoreGrants).toHaveBeenCalledWith(['g_stuck']);
    expect(summary).toEqual({ scanned: 3, restored: 1, kept: 2 });
  });

  it('카트 행이 아예 없어도(지워짐) 링크가 없으면 되돌린다', async () => {
    const { container, service } = makeContainer({
      stuck: [{ id: 'g_gone', cart_id: 'cart_gone' }],
      links: [],
      carts: [],
    });
    await restoreStuckCouponConsumptions(container, { minAgeMs: 0 });
    expect(service.restoreGrants).toHaveBeenCalledWith(['g_gone']);
  });

  it('후보가 없으면 조회도 되돌림도 하지 않는다', async () => {
    const { container, service, query } = makeContainer({ stuck: [], links: [], carts: [] });
    const summary = await restoreStuckCouponConsumptions(container, { minAgeMs: 0 });
    expect(summary).toEqual({ scanned: 0, restored: 0, kept: 0 });
    expect(query.graph).not.toHaveBeenCalled();
    expect(service.restoreGrants).not.toHaveBeenCalled();
  });

  it('usedBefore 는 now − minAgeMs 다 (기본 60분)', async () => {
    const { container, service } = makeContainer({ stuck: [], links: [], carts: [] });
    const now = new Date('2026-09-10T12:00:00.000Z');
    await restoreStuckCouponConsumptions(container, { now });
    expect(service.listStuckConsumptions).toHaveBeenCalledWith(new Date('2026-09-10T11:00:00.000Z'), 500);
  });
});
```

Run: `npm --prefix apps/medusa run test:unit -- --testPathPattern restore-stuck-coupon`
Expected: FAIL — 모듈 없음.

- [ ] **Step 2: 스크립트 구현**

`scripts/restore-stuck-coupon-consumptions.ts`:

```ts
import type { ExecArgs, MedusaContainer } from '@medusajs/framework/types';
import { ContainerRegistrationKeys } from '@medusajs/framework/utils';
import { PROMOTION_META_MODULE } from '../modules/promotion-meta';
import type PromotionMetaModuleService from '../modules/promotion-meta/service';

/**
 * «주문 없는 소모» 스위퍼 (ADR-0034 2026-09-04 개정, 결정 7).
 *
 * 소모는 `completeCartWorkflow` 의 `validate` 훅에서 커밋된다. 그 뒤 워크플로가 끝나기 전(수 초)에
 * Medusa 프로세스가 죽으면 장은 «카트가 잡았는데 주문은 없는» 채로 남는다 — 보상은 살아 있는
 * 프로세스만 돌린다. 같은 카트의 재시도는 `already` 로 스스로 낫지만, 고객이 카트를 버리면
 * 이 잡이 유일한 복구 경로다. 옛 구조(주문 뒤 훅)의 같은 창은 고객에게 유리한 방향이었고 새
 * 구조는 불리한 방향이라, 이 잡은 선택이 아니라 결정의 일부다.
 *
 * 판정: 후보(`listStuckConsumptions` — 카트가 잡았고 `minAge` 보다 오래된 사용된 장) 중
 * `order_cart` 링크가 **없고** 카트가 **완료되지 않은**(또는 카트 행이 없는) 것만 되돌린다. 둘 중
 * 하나라도 «주문이 있다» 고 말하면 놓지 않는다.
 *
 * 환경변수: COUPON_STUCK_MIN_AGE_MINUTES (기본 60) — 이보다 최근 소모는 진행 중일 수 있어 건드리지 않는다.
 * `completeCartWorkflow` 의 카트 락 TTL 은 2분이고 완료는 수 초라 60분은 넉넉하다.
 *
 * 중복 실행 주의(`orphan-payment-reconcile` 과 같다): 다중 인스턴스면 인스턴스마다 돈다.
 * `restoreGrants` 는 `used_at IS NOT NULL` 술어라 두 번 돌아도 결과가 같다.
 */
export type StuckSweepSummary = { scanned: number; restored: number; kept: number };

/** 한 회차에 훑는 후보 상한. 상한에 걸리면 경고를 남긴다 — 다음 회차가 이어서 훑는다. */
const SCAN_LIMIT = 500;

function minAgeMs(): number {
  const raw = Number(process.env.COUPON_STUCK_MIN_AGE_MINUTES);
  return (Number.isFinite(raw) && raw > 0 ? raw : 60) * 60_000;
}

export async function restoreStuckCouponConsumptions(
  container: MedusaContainer,
  opts: { minAgeMs?: number; limit?: number; now?: Date } = {},
): Promise<StuckSweepSummary> {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const service = container.resolve<PromotionMetaModuleService>(PROMOTION_META_MODULE);

  const now = opts.now ?? new Date();
  const limit = opts.limit ?? SCAN_LIMIT;
  const usedBefore = new Date(now.getTime() - (opts.minAgeMs ?? minAgeMs()));

  const candidates = await service.listStuckConsumptions(usedBefore, limit);
  if (candidates.length === 0) return { scanned: 0, restored: 0, kept: 0 };

  const cartIds = [...new Set(candidates.map((c) => c.cart_id))];
  const { data: links } = await query.graph({
    entity: 'order_cart',
    fields: ['cart_id', 'order_id'],
    filters: { cart_id: cartIds },
  });
  const withOrder = new Set((links ?? []).map((l: { cart_id: string }) => l.cart_id));

  const { data: carts } = await query.graph({
    entity: 'cart',
    fields: ['id', 'completed_at'],
    filters: { id: cartIds },
  });
  const completed = new Set(
    (carts ?? []).filter((c: { completed_at: Date | null }) => c.completed_at != null).map((c: { id: string }) => c.id),
  );

  const stuck = candidates.filter((c) => !withOrder.has(c.cart_id) && !completed.has(c.cart_id));
  const restored = await service.restoreGrants(stuck.map((c) => c.id));

  if (restored > 0) {
    const stuckCarts = [...new Set(stuck.map((c) => c.cart_id))].join(',');
    logger.warn(`[coupon] 주문 없는 소모 ${restored}장 되돌림 (cart_id=${stuckCarts})`);
  }
  if (candidates.length >= limit) {
    logger.warn(`[coupon] 스위퍼 후보가 상한(${limit})에 걸렸다 — 다음 회차가 이어서 훑는다`);
  }
  return { scanned: candidates.length, restored, kept: candidates.length - stuck.length };
}

/** `medusa exec ./src/scripts/restore-stuck-coupon-consumptions.ts` — 잡과 같은 동작을 손으로 돌린다. */
export default async function ({ container }: ExecArgs) {
  const summary = await restoreStuckCouponConsumptions(container);
  container.resolve(ContainerRegistrationKeys.LOGGER).info(`[coupon] 스위퍼 ${JSON.stringify(summary)}`);
}
```

`jobs/restore-stuck-coupon-consumptions.ts`:

```ts
import type { MedusaContainer } from '@medusajs/framework/types';
import { restoreStuckCouponConsumptions } from '../scripts/restore-stuck-coupon-consumptions';

// «주문 없는 소모» 백스톱 (ADR-0034 결정 7). 동작은 `medusa exec ./src/scripts/restore-stuck-coupon-consumptions` 와 동일.
// 정상 경로에서는 0건이어야 한다 — 0 이 아니면 프로세스가 워크플로 중간에 죽었다는 뜻이라 warn 으로 남긴다.
export default async function restoreStuckCouponConsumptionsJob(container: MedusaContainer) {
  await restoreStuckCouponConsumptions(container);
}

export const config = {
  name: 'restore-stuck-coupon-consumptions',
  // 매 시각 23분 — 정시 배치·orphan-payment-reconcile(17분)과 겹치지 않게.
  schedule: '23 * * * *',
};
```

Run: `npm --prefix apps/medusa run test:unit -- --testPathPattern restore-stuck-coupon`
Expected: 4 PASS.

Run: `npx tsc --noEmit -p apps/medusa/tsconfig.json`
Expected: 기준선 3.

- [ ] **Step 3: 커밋**

```bash
git add apps/medusa/src/scripts/restore-stuck-coupon-consumptions.ts apps/medusa/src/scripts/__tests__/restore-stuck-coupon-consumptions.unit.spec.ts apps/medusa/src/jobs/restore-stuck-coupon-consumptions.ts
git commit -m "feat(coupon): 주문 없는 소모 스위퍼 — 스크립트 + 매시 잡 (PR-3 Task 7)

Claude-Session: https://claude.ai/code/session_01WMT9N3JF3JeZr8p93Cxbtn"
```

---

### Task 8: HTTP 통합 스펙 `coupon-consume.spec.ts` — 소모 경로의 첫 커버리지

**Files:**
- Create: `apps/medusa/integration-tests/http/coupon-consume.spec.ts`

**Interfaces:**
- Consumes: 전 Task. wallet 스텁은 `coupon-cap.spec.ts` 의 것을 확장(GET intent · capture · cancel 추가). 고객 카트 헬퍼는 `coupon-cart.spec.ts` 의 `newCustomerCart` 관례.

증명할 것(ADR 「증명 — 스펙」): ① 완료 시 소모 ② 같은 고객 두 카트 → 늦은 쪽 `COUPON_EXPIRED`, 주문 없음 ③ `validate` 뒤 스텝(결제 승인) 실패 → 되돌아옴 ④ 완료된 카트 재완료 → 200 · 같은 주문 · 장 그대로 ⑤ 취소 구독자 → 링크 경유 복원 ⑥ 스위퍼 → 주문 없는 소모만 되돌림.

- [ ] **Step 1: 스펙을 쓴다**

```ts
import { createServer, type Server } from 'http';
import jwt from 'jsonwebtoken';
import { medusaIntegrationTestRunner } from '@medusajs/test-utils';
import { ContainerRegistrationKeys, Modules } from '@medusajs/framework/utils';
import {
  createApiKeysWorkflow,
  createProductsWorkflow,
  createRegionsWorkflow,
  createSalesChannelsWorkflow,
  linkSalesChannelsToApiKeyWorkflow,
} from '@medusajs/core-flows';
import { PROMOTION_META_MODULE } from '../../src/modules/promotion-meta';
import handleCouponGrantRestore from '../../src/subscribers/coupon-grant-restore';
import { restoreStuckCouponConsumptions } from '../../src/scripts/restore-stuck-coupon-consumptions';

jest.setTimeout(180 * 1000);

/**
 * 쿠폰 «소모» 경로의 HTTP 커버리지 (ADR-0034 2026-09-04 개정 「증명 — 스펙」). 이 파일 이전엔
 * 카트를 완료하면서 장의 상태를 단언하는 스펙이 없었다.
 *
 * wallet 스텁: `coupon-cap.spec.ts` 의 최소 스텁에 GET intent(승인 판정)·capture·cancel 을 더한 것.
 * `intentStatus` 로 승인 결과를 조종한다 — 'AUTHORIZED' 면 주문이 서고, 'FAILED' 면
 * `authorizePaymentSessionStep` 이 던져 워크플로가 보상된다(③).
 */
// 🔴 포트를 상수로 박으면 안 된다 — 앞 실행의 리스너가 잠깐 살아남아 EADDRINUSE 로 전 스펙이 죽는다.
const WALLET_PORT = 39500 + (process.pid % 400);
const WALLET_BASE_URL = `http://127.0.0.1:${WALLET_PORT}`;
process.env.WALLET_BASE_URL = WALLET_BASE_URL;
process.env.WALLET_API_KEY = 'test-wallet-key';

let walletStub: Server | undefined;
let intentSeq = 0;
/** GET /v1/payment-intents/:id 가 돌려줄 상태. almond-payment 의 mapStatus 가 'authorized' | 'error' 로 접는다. */
let intentStatus: 'AUTHORIZED' | 'FAILED' = 'AUTHORIZED';

const startWalletStub = () =>
  new Promise<void>((resolve, reject) => {
    walletStub = createServer((req, res) => {
      const url = req.url ?? '';
      const json = (status: number, body: unknown) => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(body));
      };
      if (req.method === 'POST' && url === '/v1/payment-intents') {
        intentSeq += 1;
        return json(200, { id: `pi_consume_${intentSeq}`, status: 'REQUIRES_ACTION' });
      }
      const match = /^\/v1\/payment-intents\/([^/?]+)(\/[^?]*)?/.exec(url);
      if (match && req.method === 'GET' && !match[2]) {
        return json(200, { id: match[1], status: intentStatus, payableAmount: 0, currency: 'KRW' });
      }
      if (match && match[2] === '/capture') return json(200, { status: 'CAPTURED' });
      if (match && match[2] === '/cancel') return json(200, { status: 'CANCELED' });
      return json(404, { error: 'NOT_FOUND', message: `not stubbed: ${req.method} ${url}` });
    });
    walletStub.once('error', reject);
    walletStub.listen(WALLET_PORT, '127.0.0.1', resolve);
  });

const stopWalletStub = () =>
  new Promise<void>((resolve) => {
    if (!walletStub) return resolve();
    walletStub.close(() => resolve());
  });

medusaIntegrationTestRunner({
  inApp: true,
  env: {},
  disableAutoTeardown: true,
  testSuite: ({ api, getContainer }) => {
    let adminHeaders: { headers: Record<string, string> };
    let jwtSecret: string;
    let pk: string;
    let regionId: string;
    let salesChannelId: string;
    let variantId: string;
    let seq = 0;
    /** 고객 이메일 유니크용 — 한 테스트(⑥)가 고객을 둘 만든다. */
    let custSeq = 0;

    afterAll(async () => {
      await stopWalletStub();
    });

    beforeAll(async () => {
      await startWalletStub();

      const container = getContainer();
      const config = container.resolve(ContainerRegistrationKeys.CONFIG_MODULE) as any;
      jwtSecret = config.projectConfig.http.jwtSecret;
      const userModule = container.resolve(Modules.USER);
      const [user] = await userModule.createUsers([{ email: 'admin@consume.test' }]);
      adminHeaders = {
        headers: {
          authorization: `Bearer ${jwt.sign(
            { actor_id: user.id, actor_type: 'user', auth_identity_id: 'a', app_metadata: { user_id: user.id } },
            jwtSecret,
          )}`,
        },
      };

      const { result: scRes } = await createSalesChannelsWorkflow(container).run({
        input: { salesChannelsData: [{ name: 'Consume SC' }] },
      });
      salesChannelId = scRes[0].id;

      const { result: regionRes } = await createRegionsWorkflow(container).run({
        input: { regions: [{ name: 'KR-consume', currency_code: 'krw', countries: ['kr'] }] },
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
              title: 'Consume Product',
              status: 'published',
              shipping_profile_id: shippingProfileId,
              sales_channels: [{ id: salesChannelId }],
              options: [{ title: 'Size', values: ['M'] }],
              variants: [
                {
                  title: 'M',
                  sku: 'CONSUME-M',
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
        input: { api_keys: [{ title: 'pk-consume', type: 'publishable', created_by: user.id }] },
      });
      await linkSalesChannelsToApiKeyWorkflow(container).run({
        input: { id: keyRes[0].id, add: [salesChannelId] },
      });
      pk = keyRes[0].token;
    });

    const metaService = () => getContainer().resolve(PROMOTION_META_MODULE) as any;

    /** 고객 하나 + 그 고객으로 인증된 스토어 헤더. */
    const newCustomer = async () => {
      custSeq++;
      const customerModule = getContainer().resolve(Modules.CUSTOMER);
      const [cust] = await customerModule.createCustomers([{ email: `consume${custSeq}@consume.test` }]);
      const custHeaders = {
        headers: {
          'x-publishable-api-key': pk,
          authorization: `Bearer ${jwt.sign(
            { actor_id: cust.id, actor_type: 'customer', auth_identity_id: 'c', app_metadata: { customer_id: cust.id } },
            jwtSecret,
          )}`,
        },
      };
      return { customerId: cust.id as string, custHeaders };
    };

    /** 발급형(assigned_only) 정률 쿠폰. 장이 사용을 지배한다 — `grantsGovernUsage` 가 true 인 쪽. */
    const createAssignedPromo = async (code: string) => {
      const res = await api.post(
        '/admin/promotions',
        {
          code, type: 'standard', is_automatic: false, status: 'active',
          application_method: { type: 'percentage', value: 10, target_type: 'order', currency_code: 'krw' },
          additional_data: { visibility: 'assigned_only' },
        },
        adminHeaders,
      );
      return res.data.promotion.id as string;
    };

    const issueGrant = (promotionId: string, customerId: string, key: string) =>
      metaService().issueGrantWithSlot({
        promotion_id: promotionId, customer_id: customerId, issue_key: key,
        issued_via: 'admin_manual', expires_at: null, now: new Date(),
        max_claims: null, enforce_cap: false,
      });

    const grantsOf = async (customerId: string) => (await metaService().listGrantsForCustomer(customerId)) as Array<any>;

    /** 고객 카트 + 쿠폰 부착 + 결제 세션까지 — `POST /store/carts/:id/complete` 직전 상태. */
    const cartReadyToComplete = async (custHeaders: { headers: Record<string, string> }, code: string) => {
      const cartRes = await api.post(
        '/store/carts',
        { region_id: regionId, sales_channel_id: salesChannelId, items: [{ variant_id: variantId, quantity: 1 }] },
        custHeaders,
      );
      const cartId = cartRes.data.cart.id as string;
      await api.post(`/store/carts/${cartId}/promotions`, { promo_codes: [code] }, custHeaders);

      // 배송은 이 스펙의 대상이 아니다 — 라인아이템을 배송 불필요로 두어 validateShippingStep 을 통과시킨다.
      const cartModule: any = getContainer().resolve(Modules.CART);
      const cartRow = await cartModule.retrieveCart(cartId, { relations: ['items'] });
      await cartModule.updateLineItems(
        (cartRow.items ?? []).map((line: any) => ({ id: line.id, requires_shipping: false })),
      );
      const pcRes = await api.post('/store/payment-collections', { cart_id: cartId }, custHeaders);
      await api.post(
        `/store/payment-collections/${pcRes.data.payment_collection.id}/payment-sessions`,
        { provider_id: 'pp_almond-payment_almond-payment' },
        custHeaders,
      );
      return cartId;
    };

    /** 완료 호출. 워크플로 엔진을 거친 에러는 Error 인스턴스가 아니므로 응답을 그대로 돌려준다. */
    const complete = async (cartId: string, custHeaders: { headers: Record<string, string> }) => {
      try {
        const res = await api.post(`/store/carts/${cartId}/complete`, {}, custHeaders);
        return { status: res.status as number, data: res.data as any };
      } catch (error: any) {
        return { status: error?.response?.status as number, data: error?.response?.data as any };
      }
    };

    const orderIdForCart = async (cartId: string): Promise<string | null> => {
      const query = getContainer().resolve(ContainerRegistrationKeys.QUERY);
      const { data } = await query.graph({
        entity: 'order_cart',
        fields: ['cart_id', 'order_id'],
        filters: { cart_id: cartId },
      });
      return (data[0] as any)?.order_id ?? null;
    };

    afterEach(() => {
      intentStatus = 'AUTHORIZED';
    });

    it('① 완료하면 장이 소모되고 cart_id 가 찍힌다 — 주문이 선다', async () => {
      seq++;
      const { customerId, custHeaders } = await newCustomer();
      const promotionId = await createAssignedPromo(`CONSUME_OK_${seq}`);
      await issueGrant(promotionId, customerId, 'k1');
      const cartId = await cartReadyToComplete(custHeaders, `CONSUME_OK_${seq}`);

      const res = await complete(cartId, custHeaders);

      expect(res.status).toBe(200);
      expect(res.data.type).toBe('order');
      const [grant] = await grantsOf(customerId);
      expect(grant.used_at).not.toBeNull();
      expect(grant.cart_id).toBe(cartId);
      expect(await orderIdForCart(cartId)).toBe(res.data.order.id);
    });

    it('② 같은 고객의 두 카트에 장 하나 — 늦은 쪽은 COUPON_EXPIRED 이고 주문이 서지 않는다 (검사 = 소모)', async () => {
      seq++;
      const { customerId, custHeaders } = await newCustomer();
      const promotionId = await createAssignedPromo(`CONSUME_RACE_${seq}`);
      await issueGrant(promotionId, customerId, 'k1');
      // 둘 다 장이 미사용일 때 붙인다 — 카트 미들웨어는 둘 다 통과시킨다. 옛 구조에선 완료도 둘 다 통과했다.
      const cartA = await cartReadyToComplete(custHeaders, `CONSUME_RACE_${seq}`);
      const cartB = await cartReadyToComplete(custHeaders, `CONSUME_RACE_${seq}`);

      const first = await complete(cartA, custHeaders);
      const second = await complete(cartB, custHeaders);

      expect(first.status).toBe(200);
      expect(second.status).toBe(400);
      expect(second.data.message).toContain('COUPON_EXPIRED');
      expect(await orderIdForCart(cartB)).toBeNull();
      const [grant] = await grantsOf(customerId);
      expect(grant.cart_id).toBe(cartA);
    });

    it('③ validate 뒤 스텝(결제 승인)이 실패하면 훅 보상이 장을 돌려놓는다', async () => {
      seq++;
      const { customerId, custHeaders } = await newCustomer();
      const promotionId = await createAssignedPromo(`CONSUME_COMP_${seq}`);
      await issueGrant(promotionId, customerId, 'k1');
      const cartId = await cartReadyToComplete(custHeaders, `CONSUME_COMP_${seq}`);

      intentStatus = 'FAILED'; // mapStatus → 'error' → 결제 모듈이 NOT_ALLOWED 로 던진다 → 워크플로 보상
      const res = await complete(cartId, custHeaders);

      expect(res.status).toBe(400);
      expect(await orderIdForCart(cartId)).toBeNull();
      const [grant] = await grantsOf(customerId);
      expect(grant.used_at).toBeNull();
      expect(grant.cart_id).toBeNull();
    });

    it('④ 완료된 카트를 다시 완료하면 200 · 같은 주문 · 장은 그대로 (already)', async () => {
      seq++;
      const { customerId, custHeaders } = await newCustomer();
      const promotionId = await createAssignedPromo(`CONSUME_AGAIN_${seq}`);
      await issueGrant(promotionId, customerId, 'k1');
      const cartId = await cartReadyToComplete(custHeaders, `CONSUME_AGAIN_${seq}`);
      const first = await complete(cartId, custHeaders);
      expect(first.status).toBe(200);

      // 옛 구조는 여기서 validate 가 «장이 이미 사용됨» 으로 COUPON_EXPIRED 를 냈다 — 주문이 있는데 거절.
      const again = await complete(cartId, custHeaders);

      expect(again.status).toBe(200);
      expect(again.data.type).toBe('order');
      expect(again.data.order.id).toBe(first.data.order.id);
      const [grant] = await grantsOf(customerId);
      expect(grant.used_at).not.toBeNull();
      expect(grant.cart_id).toBe(cartId);
    });

    it('⑤ 주문 취소 구독자는 order_cart 링크로 카트를 찾아 장을 되돌린다', async () => {
      seq++;
      const { customerId, custHeaders } = await newCustomer();
      const promotionId = await createAssignedPromo(`CONSUME_CANCEL_${seq}`);
      await issueGrant(promotionId, customerId, 'k1');
      const cartId = await cartReadyToComplete(custHeaders, `CONSUME_CANCEL_${seq}`);
      const res = await complete(cartId, custHeaders);
      expect(res.status).toBe(200);

      // 이벤트 버스(in-memory, 비동기)를 기다리지 않고 구독자를 직접 부른다 — 여기서 증명할 것은
      // 링크 조회와 복원이지 이벤트 배선이 아니다(배선은 단위 스펙 `config.event` 가 고정한다).
      await handleCouponGrantRestore({ event: { data: { id: res.data.order.id } }, container: getContainer() } as any);

      const [grant] = await grantsOf(customerId);
      expect(grant.used_at).toBeNull();
      expect(grant.cart_id).toBeNull();
    });

    it('⑥ 스위퍼는 주문 없는 소모만 되돌리고, 주문이 선 소모는 놓지 않는다', async () => {
      seq++;
      // 주문이 선 소모 — 놓으면 안 된다.
      const ordered = await newCustomer();
      const orderedPromo = await createAssignedPromo(`CONSUME_SWEEP_KEEP_${seq}`);
      await issueGrant(orderedPromo, ordered.customerId, 'k1');
      const orderedCart = await cartReadyToComplete(ordered.custHeaders, `CONSUME_SWEEP_KEEP_${seq}`);
      expect((await complete(orderedCart, ordered.custHeaders)).status).toBe(200);

      // 주문 없는 소모 — 훅이 커밋한 뒤 프로세스가 죽은 상태를 모듈 호출로 만든다.
      const stuck = await newCustomer();
      const stuckPromo = await createAssignedPromo(`CONSUME_SWEEP_STUCK_${seq}`);
      await issueGrant(stuckPromo, stuck.customerId, 'k1');
      const stuckCartRes = await api.post(
        '/store/carts',
        { region_id: regionId, sales_channel_id: salesChannelId, items: [{ variant_id: variantId, quantity: 1 }] },
        stuck.custHeaders,
      );
      const stuckCartId = stuckCartRes.data.cart.id as string;
      const outcome = await metaService().consumeOneUsableGrantForCart({
        promotion_id: stuckPromo, customer_id: stuck.customerId, cart_id: stuckCartId, now: new Date(),
      });
      expect(outcome.outcome).toBe('consumed');

      const summary = await restoreStuckCouponConsumptions(getContainer(), { minAgeMs: 0, limit: 100 });

      expect(summary.restored).toBeGreaterThanOrEqual(1);
      const [stuckGrant] = await grantsOf(stuck.customerId);
      expect(stuckGrant.used_at).toBeNull();
      expect(stuckGrant.cart_id).toBeNull();
      const [orderedGrant] = await grantsOf(ordered.customerId);
      expect(orderedGrant.used_at).not.toBeNull();
      expect(orderedGrant.cart_id).toBe(orderedCart);
    });
  },
});
```

- [ ] **Step 2: 돌린다**

Run: `scripts/local/run-medusa-integration.sh --testPathPattern coupon-consume`
Expected: `coupon-consume.spec.ts` 6 PASS, 나머지 쿠폰 스펙도 전부 PASS(Task 2 의 문자열 치환이 그 스펙들을 건드렸다).

빨간 것이 있으면 **먼저 어느 층인지 가른다** — (가) 픽스처(세션 생성·미들웨어·404 스텁 경로)면 스텁의 404 로그 메시지(`not stubbed: …`)를 보고 경로를 더한다 (나) ①이 `customer?.id` 로 빨가면 ADR 측정 4 의 가정이 틀린 것이므로 `complete-cart.ts` 의 `customerId` 정의를 실측값에 맞추고 ADR 측정 4 를 고친다 (다) ③이 400 이 아니라 200 `type: 'cart'` 면 결제 모듈이 `PAYMENT_AUTHORIZATION_ERROR` 로 접은 것이다 — 단언을 `res.data.type).toBe('cart')` 로 바꾸되 장이 돌아왔다는 단언은 그대로 둔다(증명하려는 것은 보상이다).

- [ ] **Step 3: 커밋**

```bash
git add apps/medusa/integration-tests/http/coupon-consume.spec.ts
git commit -m "test(coupon): 소모 경로 HTTP 스펙 — 소모·경합·보상·재완료·취소복원·스위퍼 (PR-3 Task 8)

Claude-Session: https://claude.ai/code/session_01WMT9N3JF3JeZr8p93Cxbtn"
```

---

### Task 9: 마무리 — 전체 게이트 · 문서 정합 · PR

**Files:**
- Modify: `docs/adr/0034-coupon-issuance-writes-go-through-workflows.md` (「이행 순서」 에 실제 파일명 반영, 측정 4 결과 확정)
- Modify: `apps/medusa/integration-tests/http/README.md` — 건드리지 않는다(관례 없음)

- [ ] **Step 1: 전체 게이트**

Run (워크트리 루트):
```
npx tsc --noEmit -p apps/medusa/tsconfig.json
npm --prefix apps/medusa run test:unit
scripts/local/run-medusa-integration.sh --modules --testPathPattern promotion-meta
scripts/local/run-medusa-integration.sh --testPathPattern coupon-
npm run type-check
```
Expected: tsc 기준선 3 · unit 은 기준선 + 16(consume 7 · restore 구독자 +2 · 스위퍼 4 … 실제 수를 적는다) · 모듈 통합 기준선 + 3 · HTTP 전부 PASS · 루트 `type-check` 는 medusa 를 제외하므로 변화 없음(0).

Run: `grep -rn "order_id" apps/medusa/src/modules/promotion-meta apps/medusa/src/subscribers apps/medusa/src/workflows/hooks/cart apps/medusa/src/scripts/backfill-coupon-grants.ts --include=*.ts | grep -v "migrations/"`
Expected: 모델의 컬럼 선언·`CouponGrantRow` 타입·백필 주석·픽스처의 `order_id: null` 뿐. **읽거나 쓰는 코드는 0**.

- [ ] **Step 2: ADR 의 이행 순서를 실제와 맞춘다**

ADR 「이행 순서 (PR-3, 코드는 결정 뒤)」 절의 항목 1~5 옆에 파일명을 적는다:
1. 모듈 — `Migration20260904120000` · `consumeOneUsableGrantForCart` · `restoreGrants` · `restoreGrantsByCart` · `listStuckConsumptions`
2. 훅 — `hooks/cart/consume-coupon-grants.ts` + `complete-cart.ts` 보상 인자, `record-coupon-usage.ts` 삭제
3. 구독자 — `subscribers/coupon-grant-restore.ts`
4. 스위퍼 — `scripts/restore-stuck-coupon-consumptions.ts` + `jobs/restore-stuck-coupon-consumptions.ts` (매시 23분, `COUPON_STUCK_MIN_AGE_MINUTES` 기본 60)
5. HTTP 스펙 — `integration-tests/http/coupon-consume.spec.ts` ①~⑥

측정 4 의 「현행 훅의 `cart.customer_id` 는 조인이 FK 를 남겨줄 때만 맞는다 … 스펙 ① 이 실측을 겸한다」 뒤에 실측 결과 한 줄을 붙인다(①이 `customer?.id` 로 초록이었으면 그렇게, Task 8 Step 2 (나) 로 갔으면 그 값을).

- [ ] **Step 3: 커밋 · 푸시 · PR**

```bash
git add docs/adr/0034-coupon-issuance-writes-go-through-workflows.md
git commit -m "docs(coupon): ADR-0034 이행 순서에 PR-3 실제 파일 반영

Claude-Session: https://claude.ai/code/session_01WMT9N3JF3JeZr8p93Cxbtn"
git push -u origin feat/coupon-consume-seam
```

PR 본문에 넣을 것: ADR 개정 절 링크 · #782 · **마이그 1건(additive `cart_id`)** · 배포 순서 제약 없음(Medusa 부팅 자체 migrate, 옛 태스크는 새 컬럼 무시) · 스위퍼 잡 신설(첫 회 0건 기대, 0 아니면 warn) · 새 env `COUPON_STUCK_MIN_AGE_MINUTES`(선택, 기본 60) · **후속 PR**: 다음 배포 뒤 `order_id` DROP(선행 조건 라이브 `SELECT count(*) FROM coupon_grant WHERE order_id IS NOT NULL` = 0) · 동작 변화: 완료된 카트 재완료가 거절되지 않고 200 · 소모 실패가 주문 거절이 됨(옛 I1 폐기) · `cart.customer_id` 읽기 4곳을 `customer?.id` 우선으로. 끝에 `https://claude.ai/code/session_01WMT9N3JF3JeZr8p93Cxbtn`.
